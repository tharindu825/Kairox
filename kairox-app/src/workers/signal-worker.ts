import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '@/lib/redis';
import { db } from '@/lib/db';
import { indicatorService, FeatureBundle } from '@/services/indicators';
import { openRouterService } from '@/services/ai/openrouter-service';
import { openAIService } from '@/services/ai/openai-service';
import { riskEngine, PortfolioState } from '@/services/risk-engine';
import { alertQueue } from './queues';
import { NormalizedCandle } from '@/services/market-data/binance';

export interface SignalJobData {
  candle: NormalizedCandle;
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

      // 4. Portfolio State Mock (In production, calculate from DB)
      const mockPortfolio: PortfolioState = {
        balance: 10000,
        openTrades: 1,
        openRiskPercent: 1.5,
        dailyPnLPercent: 0.5,
        correlatedAssets: [],
        consecutiveStopOuts: 0,
      };

      // 5. Risk Engine Validation (always use Primary signal metrics for risk calc)
      const riskAssessment = riskEngine.assess(primarySignal, mockPortfolio, candle.symbol);

      // Force BLOCKED if models disagree completely (e.g. LONG vs SHORT)
      if (primarySignal.side !== 'HOLD' && confSignal.side !== 'HOLD' && !isAgreement) {
        riskAssessment.verdict = 'BLOCKED';
        riskAssessment.reasons.push('Absolute model disagreement (LONG vs SHORT)');
      }

      // 6. Persist Signal to DB
      const asset = await db.asset.findUnique({ where: { symbol: candle.symbol } });
      if (!asset) throw new Error('Asset not found');

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
          status: riskAssessment.verdict === 'APPROVED' || riskAssessment.verdict === 'REDUCED' 
            ? 'APPROVED' 
            : 'BLOCKED',
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
                  modelId: 'anthropic/claude-sonnet-4',
                  apiProvider: 'OPENROUTER',
                  role: 'PRIMARY',
                  side: primarySignal.side,
                  confidence: primarySignal.confidence,
                  reasoning: primarySignal.reasoning,
                  rawResponse: primarySignal as any,
                  latencyMs: 1500, // Mock latency
                  tokenUsage: { prompt: 500, completion: 200, total: 700 }
                },
                {
                  modelId: 'gpt-4o',
                  apiProvider: 'OPENAI',
                  role: 'CONFIRMATION',
                  side: confSignal.side,
                  confidence: confSignal.confidence,
                  reasoning: confSignal.reasoning,
                  rawResponse: confSignal as any,
                  latencyMs: 1200, // Mock latency
                  tokenUsage: { prompt: 500, completion: 200, total: 700 }
                }
              ]
            }
          }
        }
      });

      console.log(`[Signal Worker] Signal created: ${signalRecord.id} (Verdict: ${riskAssessment.verdict})`);

      // 7. Dispatch Alert if Approved
      if (signalRecord.status === 'APPROVED') {
        await alertQueue.add('send-telegram', {
          signalId: signalRecord.id,
          message: `🚨 NEW APPROVED SIGNAL 🚨\n\nAsset: ${candle.symbol}\nSide: ${primarySignal.side}\nEntry: ${primarySignal.entry}\nStop: ${primarySignal.stopLoss}`
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
