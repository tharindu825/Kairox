import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '@/lib/redis';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { Logger } from '@/lib/logger';
import { indicatorService, FeatureBundle } from '@/services/indicators';
import { openRouterService, openRouterConfirmationService } from '@/services/ai/openrouter-service';
import { riskEngine, PortfolioState } from '@/services/risk-engine';
import { paperTradingService } from '@/services/paper-trading';
import { alertQueue } from './queues';
import { NormalizedCandle } from '@/services/market-data/binance';
import { Decimal } from 'decimal.js';
import { publishNotification } from '@/lib/notify';

export interface SignalJobData {
  candle: NormalizedCandle;
}

/**
 * Build real portfolio state from the database
 */
async function getPortfolioState(): Promise<PortfolioState> {
  const PAPER_BALANCE = Number(process.env.PAPER_BALANCE || 10000);

  const db = await getDb();
  
  // Count open trades
  const openOrders = await db.collection('paperOrders')
    .find({ status: 'OPEN' })
    .toArray();
  
  const ordersWithSignals = await Promise.all(openOrders.map(async (order) => {
    let signal = null;
    if (order.signalId) {
       const sig = await db.collection('signals').findOne({ _id: new ObjectId(order.signalId) });
       if (sig) {
          const riskAssessment = await db.collection('riskAssessments').findOne({ signalId: order.signalId });
          signal = { ...sig, id: sig._id.toString(), riskAssessment };
       }
    }
    return { ...order, id: order._id.toString(), signal };
  }));

  const openTrades = ordersWithSignals.length;

  // Sum risk exposure
  const openRiskPercent = ordersWithSignals.reduce((sum, o) => {
    return sum + (o.signal?.riskAssessment?.riskPercent || 0);
  }, 0);

  // Daily P&L
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const closedToday = await db.collection('paperOrders')
    .find({
      closedAt: { $gte: todayStart },
      status: { $in: ['CLOSED', 'STOPPED'] }
    })
    .toArray();

  const dailyPnL = closedToday.reduce((sum, o) => sum + (o.pnl ? new Decimal(o.pnl).toNumber() : 0), 0);
  const dailyPnLPercent = PAPER_BALANCE > 0 ? (dailyPnL / PAPER_BALANCE) * 100 : 0;

  // Correlated assets
  const correlatedAssets = ordersWithSignals.map(o => o.signal?.symbol).filter(Boolean);

  // Consecutive stop-outs
  const recentOrders = await db.collection('paperOrders')
    .find({ status: { $in: ['CLOSED', 'STOPPED'] } })
    .sort({ closedAt: -1 })
    .limit(10)
    .toArray();

  let consecutiveStopOuts = 0;
  let lastStopOutTime: Date | undefined;
  for (const order of recentOrders) {
    if (order.status === 'STOPPED') {
      consecutiveStopOuts++;
      if (!lastStopOutTime && order.closedAt) {
        lastStopOutTime = order.closedAt instanceof Date ? order.closedAt : new Date(order.closedAt);
      }
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
    await Logger.info(`Processing new candle for ${candle.symbol} (${candle.timeframe})`, 'Signal Worker');

    try {
      const db = await getDb();
      // 1. Check for Duplicate Signals
      const existingSignal = await db.collection('signals').findOne({
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        candleTimestamp: candle.timestamp
      });

      if (existingSignal) {
        await Logger.info(`Signal already exists for ${candle.symbol} ${candle.timeframe} at this timestamp — Skipping.`, 'Signal Worker');
        return { status: 'skipped', reason: 'duplicate_timestamp' };
      }

      // 2. Update Indicators & Generate Feature Bundle
      indicatorService.update(candle);
      const features = indicatorService.getFeatureBundle(candle);

      // We only generate signals if there's a strong trend or clear setup
      // Note: We relaxed this to allow the AI to evaluate neutral markets for potential reversals or specific setups
      if (features.trend === 'NEUTRAL') {
        await Logger.info(`Market is NEUTRAL for ${candle.symbol} — Proceeding with AI evaluation.`, 'Signal Worker');
      }

      // 2. Dual API Model Execution (Run concurrently)
      await Logger.info(`Requesting AI analysis for ${candle.symbol}...`, 'Signal Worker');
      const [primaryResult, confirmationResult] = await Promise.all([
        openRouterService.generateCompletion(candle.symbol, candle.timeframe, features),
        openRouterConfirmationService.generateCompletion(candle.symbol, candle.timeframe, features),
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
      const asset = await db.collection('assets').findOne({ symbol: candle.symbol });
      if (!asset) throw new Error('Asset not found');

      const signalStatus = riskAssessment.verdict === 'APPROVED' || riskAssessment.verdict === 'REDUCED'
        ? 'APPROVED'
        : 'BLOCKED';

      const signalId = new ObjectId();
      const signalData = {
        _id: signalId,
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        candleTimestamp: candle.timestamp,
        side: primarySignal.side,
        confidence: primarySignal.confidence,
        entry: primarySignal.entry,
        stopLoss: primarySignal.stopLoss,
        targets: primarySignal.targets,
        reasoning: primarySignal.reasoning,
        status: signalStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.collection('signals').insertOne(signalData);

      await db.collection('riskAssessments').insertOne({
        signalId: signalId.toString(),
        positionSize: riskAssessment.positionSize,
        riskPercent: riskAssessment.riskPercent,
        rewardToRisk: riskAssessment.rewardToRisk,
        exposureCheck: riskAssessment.exposureCheck,
        correlationFlag: riskAssessment.correlationFlag,
        verdict: riskAssessment.verdict,
        reasons: riskAssessment.reasons,
      });

      await db.collection('signalVotes').insertMany([
        {
          signalId: signalId.toString(),
          modelId: process.env.PRIMARY_MODEL || 'anthropic/claude-sonnet-4',
          apiProvider: 'OPENROUTER',
          role: 'PRIMARY',
          side: primarySignal.side,
          confidence: primarySignal.confidence,
          reasoning: primarySignal.reasoning,
          rawResponse: primarySignal,
          latencyMs: primaryResult.latencyMs || 0,
          tokenUsage: primaryResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
        },
        {
          signalId: signalId.toString(),
          modelId: process.env.CONFIRMATION_MODEL || 'google/gemini-pro-1.5',
          apiProvider: 'OPENROUTER',
          role: 'CONFIRMATION',
          side: confSignal.side,
          confidence: confSignal.confidence,
          reasoning: confSignal.reasoning,
          rawResponse: confSignal,
          latencyMs: confirmationResult.latencyMs || 0,
          tokenUsage: confirmationResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
        }
      ]);
      
      const signalRecord = { id: signalId.toString(), ...signalData };

      await Logger.success(`Signal created: ${signalRecord.id} (${candle.symbol} - ${riskAssessment.verdict})`, 'Signal Worker');

      // 7. Auto-execute Paper Trade if Approved
      if (signalStatus === 'APPROVED' && riskAssessment.positionSize > 0) {
        try {
          await paperTradingService.executeApprovedSignal(
            signalRecord.id,
            riskAssessment.positionSize
          );
          await Logger.info(`Paper trade opened for signal ${signalRecord.id}`, 'Signal Worker');
        } catch (err) {
          await Logger.error(`Failed to open paper trade: ${(err as Error).message}`, 'Signal Worker');
        }
      }

      // 8. Dispatch Alert if Approved
      if (signalStatus === 'APPROVED') {
        await alertQueue.add('send-telegram', {
          signalId: signalRecord.id,
          message: `🚨 NEW APPROVED SIGNAL 🚨\n\nAsset: ${candle.symbol}\nSide: ${primarySignal.side}\nConfidence: ${(primarySignal.confidence * 100).toFixed(0)}%\nEntry: ${primarySignal.entry}\nStop: ${primarySignal.stopLoss}\nTarget: ${primarySignal.targets[0]?.price}\nR:R: ${riskAssessment.rewardToRisk.toFixed(2)}\nSize: ${riskAssessment.positionSize.toFixed(4)} units\n\nModels: ${isAgreement ? '✅ Agree' : '⚠️ Disagree'}`
        });
      }

      // 9. Push SSE Notification to UI
      await publishNotification({
        type: 'NEW_SIGNAL',
        data: signalRecord
      });

      return { status: 'success', signalId: signalRecord.id };

    } catch (error) {
      console.error(`[Signal Worker] Error processing job:`, error);
      throw error;
    }
  },
  { connection: createBullMQConnection() }
);

signalWorker.on('failed', (job: Job<SignalJobData> | undefined, err: Error) => {
  console.error(`[Signal Worker] Job ${job?.id} failed:`, err);
});
