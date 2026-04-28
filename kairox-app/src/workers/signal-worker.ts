import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '@/lib/redis';
import { db } from '@/lib/db';
import { indicatorService, FeatureBundle } from '@/services/indicators';
import { openRouterService } from '@/services/ai/openrouter-service';
import { openAIService } from '@/services/ai/openai-service';
import { riskEngine, PortfolioState } from '@/services/risk-engine';
import { paperTradingService } from '@/services/paper-trading';
import { alertQueue } from './queues';
import { NormalizedCandle } from '@/services/market-data/binance';
import { Decimal } from 'decimal.js';

export interface SignalJobData {
  candle: NormalizedCandle;
}

/**
 * Build real portfolio state from the database
 */
async function getPortfolioState(): Promise<PortfolioState> {
  const PAPER_BALANCE = 10000;

  // Count open trades
  const openOrders = await db.paperOrder.findMany({
    where: { status: 'OPEN' },
    include: { signal: { include: { asset: true, riskAssessment: true } } },
  });

  const openTrades = openOrders.length;

  // Sum risk exposure
  const openRiskPercent = openOrders.reduce((sum, o) => {
    return sum + (o.signal.riskAssessment?.riskPercent || 0);
  }, 0);

  // Daily P&L
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const closedToday = await db.paperOrder.findMany({
    where: { closedAt: { gte: todayStart }, status: { in: ['CLOSED', 'STOPPED'] } },
  });

  const dailyPnL = closedToday.reduce((sum, o) => sum + (o.pnl ? new Decimal(o.pnl).toNumber() : 0), 0);
  const dailyPnLPercent = PAPER_BALANCE > 0 ? (dailyPnL / PAPER_BALANCE) * 100 : 0;

  // Correlated assets
  const correlatedAssets = openOrders.map(o => o.signal.asset.symbol);

  // Consecutive stop-outs
  const recentOrders = await db.paperOrder.findMany({
    where: { status: { in: ['CLOSED', 'STOPPED'] } },
    orderBy: { closedAt: 'desc' },
    take: 10,
  });

  let consecutiveStopOuts = 0;
  let lastStopOutTime: Date | undefined;
  for (const order of recentOrders) {
    if (order.status === 'STOPPED') {
      consecutiveStopOuts++;
      if (!lastStopOutTime && order.closedAt) lastStopOutTime = order.closedAt;
    } else {
      break;
    }
  }

  return {
    balance: PAPER_BALANCE,
    openTrades,
    openRiskPercent,
    dailyPnLPercent,
    correlatedAssets,
    consecutiveStopOuts,
    lastStopOutTime,
  };
}

export const signalWorker = new Worker(
  'signal-generation',
  async (job: Job<SignalJobData>) => {
    const { candle } = job.data;
    console.log(`[Signal Worker] Processing new candle for ${candle.symbol} (${candle.timeframe})`);

    try {
      // 1. Update Indicators & Generate Feature Bundle
      indicatorService.update(candle);
      const features = indicatorService.getFeatureBundle(candle);

      // We only generate signals if there's a strong trend or clear setup
      if (features.trend === 'NEUTRAL') {
        console.log(`[Signal Worker] Skipping generation for ${candle.symbol} — Market is NEUTRAL.`);
        return { status: 'skipped', reason: 'neutral_market' };
      }

      // 2. Dual API Model Execution (Run concurrently)
      console.log(`[Signal Worker] Requesting AI analysis for ${candle.symbol}...`);
      const [primaryResult, confirmationResult] = await Promise.all([
        openRouterService.generateCompletion(candle.symbol, candle.timeframe, features),
        openAIService.generateCompletion(candle.symbol, candle.timeframe, features),
      ]);

      if (!primaryResult.success || !primaryResult.data) {
        throw new Error(`Primary model failed: ${primaryResult.error}`);
      }
      if (!confirmationResult.success || !confirmationResult.data) {
        throw new Error(`Confirmation model failed: ${confirmationResult.error}`);
      }

      const primarySignal = primaryResult.data;
      const confSignal = confirmationResult.data;

      // 3. Model Agreement Check
      const isAgreement = primarySignal.side === confSignal.side;
      console.log(`[Signal Worker] Model Agreement: ${isAgreement} (${primarySignal.side} vs ${confSignal.side})`);

      // 4. Get Real Portfolio State from DB
      const portfolio = await getPortfolioState();

      // 5. Risk Engine Validation (always use Primary signal metrics for risk calc)
      const riskAssessment = riskEngine.assess(primarySignal, portfolio, candle.symbol);

      // Force BLOCKED if models disagree completely (e.g. LONG vs SHORT)
      if (primarySignal.side !== 'HOLD' && confSignal.side !== 'HOLD' && !isAgreement) {
        riskAssessment.verdict = 'BLOCKED';
        riskAssessment.reasons.push('Absolute model disagreement (LONG vs SHORT)');
      }

      // 6. Persist Signal to DB
      const asset = await db.asset.findUnique({ where: { symbol: candle.symbol } });
      if (!asset) throw new Error('Asset not found');

      const signalStatus = riskAssessment.verdict === 'APPROVED' || riskAssessment.verdict === 'REDUCED'
        ? 'APPROVED'
        : 'BLOCKED';

      const signalRecord = await db.signal.create({
        data: {
          assetId: asset.id,
          timeframe: candle.timeframe,
          side: primarySignal.side,
          confidence: primarySignal.confidence,
          entry: primarySignal.entry,
          stopLoss: primarySignal.stopLoss,
          targets: primarySignal.targets,
          reasoning: primarySignal.reasoning,
          status: signalStatus,
          riskAssessment: {
            create: {
              positionSize: riskAssessment.positionSize,
              riskPercent: riskAssessment.riskPercent,
              rewardToRisk: riskAssessment.rewardToRisk,
              exposureCheck: riskAssessment.exposureCheck,
              correlationFlag: riskAssessment.correlationFlag,
              verdict: riskAssessment.verdict,
              reasons: riskAssessment.reasons,
            }
          },
          votes: {
            createMany: {
              data: [
                {
                  modelId: process.env.PRIMARY_MODEL || 'anthropic/claude-sonnet-4',
                  apiProvider: 'OPENROUTER',
                  role: 'PRIMARY',
                  side: primarySignal.side,
                  confidence: primarySignal.confidence,
                  reasoning: primarySignal.reasoning,
                  rawResponse: primarySignal as any,
                  latencyMs: primaryResult.latencyMs || 0,
                  tokenUsage: primaryResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
                },
                {
                  modelId: process.env.CONFIRMATION_MODEL || 'gpt-4o',
                  apiProvider: 'OPENAI',
                  role: 'CONFIRMATION',
                  side: confSignal.side,
                  confidence: confSignal.confidence,
                  reasoning: confSignal.reasoning,
                  rawResponse: confSignal as any,
                  latencyMs: confirmationResult.latencyMs || 0,
                  tokenUsage: confirmationResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
                }
              ]
            }
          }
        }
      });

      console.log(`[Signal Worker] Signal created: ${signalRecord.id} (Verdict: ${riskAssessment.verdict})`);

      // 7. Auto-execute Paper Trade if Approved
      if (signalStatus === 'APPROVED' && riskAssessment.positionSize > 0) {
        try {
          await paperTradingService.executeApprovedSignal(
            signalRecord.id,
            riskAssessment.positionSize
          );
          console.log(`[Signal Worker] Paper trade opened for signal ${signalRecord.id}`);
        } catch (err) {
          console.error(`[Signal Worker] Failed to open paper trade:`, err);
        }
      }

      // 8. Dispatch Alert if Approved
      if (signalStatus === 'APPROVED') {
        await alertQueue.add('send-telegram', {
          signalId: signalRecord.id,
          message: `🚨 NEW APPROVED SIGNAL 🚨\n\nAsset: ${candle.symbol}\nSide: ${primarySignal.side}\nConfidence: ${(primarySignal.confidence * 100).toFixed(0)}%\nEntry: ${primarySignal.entry}\nStop: ${primarySignal.stopLoss}\nTarget: ${primarySignal.targets[0]?.price}\nR:R: ${riskAssessment.rewardToRisk.toFixed(2)}\nSize: ${riskAssessment.positionSize.toFixed(4)} units\n\nModels: ${isAgreement ? '✅ Agree' : '⚠️ Disagree'}`
        });
      }

      return { status: 'success', signalId: signalRecord.id };

    } catch (error) {
      console.error(`[Signal Worker] Error processing job:`, error);
      throw error;
    }
  },
  { connection: createBullMQConnection() }
);

signalWorker.on('failed', (job, err) => {
  console.error(`[Signal Worker] Job ${job?.id} failed:`, err);
});
