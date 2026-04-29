import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '@/lib/redis';
import { db } from '@/lib/firebase-admin';
import { indicatorService, FeatureBundle } from '@/services/indicators';
import { openRouterService } from '@/services/ai/openrouter-service';
import { openAIService } from '@/services/ai/openai-service';
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
  const PAPER_BALANCE = 10000;

  // Count open trades
  const openOrdersSnapshot = await db.collection('paperOrders').where('status', '==', 'OPEN').get();
  
  const openOrders = await Promise.all(openOrdersSnapshot.docs.map(async (doc) => {
    const order = doc.data();
    let signal = null;
    if (order.signalId) {
       const sigSnap = await db.collection('signals').doc(order.signalId).get();
       if (sigSnap.exists) {
          const riskSnap = await db.collection('riskAssessments').where('signalId', '==', order.signalId).limit(1).get();
          signal = { ...sigSnap.data(), riskAssessment: riskSnap.empty ? null : riskSnap.docs[0].data() } as any;
       }
    }
    return { ...order, signal };
  }));

  const openTrades = openOrders.length;

  // Sum risk exposure
  const openRiskPercent = openOrders.reduce((sum, o) => {
    return sum + (o.signal.riskAssessment?.riskPercent || 0);
  }, 0);

  // Daily P&L
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const closedTodaySnapshot = await db.collection('paperOrders')
    .where('status', 'in', ['CLOSED', 'STOPPED'])
    .where('closedAt', '>=', todayStart)
    .get();

  const closedToday = closedTodaySnapshot.docs.map(d => d.data());

  const dailyPnL = closedToday.reduce((sum, o) => sum + (o.pnl ? new Decimal(o.pnl).toNumber() : 0), 0);
  const dailyPnLPercent = PAPER_BALANCE > 0 ? (dailyPnL / PAPER_BALANCE) * 100 : 0;

  // Correlated assets
  const correlatedAssets = openOrders.map(o => o.signal?.symbol).filter(Boolean);

  // Consecutive stop-outs
  const recentOrdersSnapshot = await db.collection('paperOrders')
    .where('status', 'in', ['CLOSED', 'STOPPED'])
    .orderBy('closedAt', 'desc')
    .limit(10)
    .get();

  const recentOrders = recentOrdersSnapshot.docs.map(d => d.data());

  let consecutiveStopOuts = 0;
  let lastStopOutTime: Date | undefined;
  for (const order of recentOrders) {
    if (order.status === 'STOPPED') {
      consecutiveStopOuts++;
      if (!lastStopOutTime && order.closedAt) {
        lastStopOutTime = order.closedAt.toDate ? order.closedAt.toDate() : new Date(order.closedAt);
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
      const assetSnapshot = await db.collection('assets').where('symbol', '==', candle.symbol).limit(1).get();
      if (assetSnapshot.empty) throw new Error('Asset not found');

      const signalStatus = riskAssessment.verdict === 'APPROVED' || riskAssessment.verdict === 'REDUCED'
        ? 'APPROVED'
        : 'BLOCKED';

      const batch = db.batch();
      
      const signalRef = db.collection('signals').doc();
      const signalData = {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
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
      batch.set(signalRef, signalData);

      const riskRef = db.collection('riskAssessments').doc();
      batch.set(riskRef, {
        signalId: signalRef.id,
        positionSize: riskAssessment.positionSize,
        riskPercent: riskAssessment.riskPercent,
        rewardToRisk: riskAssessment.rewardToRisk,
        exposureCheck: riskAssessment.exposureCheck,
        correlationFlag: riskAssessment.correlationFlag,
        verdict: riskAssessment.verdict,
        reasons: riskAssessment.reasons,
      });

      const primaryVoteRef = db.collection('signalVotes').doc();
      batch.set(primaryVoteRef, {
        signalId: signalRef.id,
        modelId: process.env.PRIMARY_MODEL || 'anthropic/claude-sonnet-4',
        apiProvider: 'OPENROUTER',
        role: 'PRIMARY',
        side: primarySignal.side,
        confidence: primarySignal.confidence,
        reasoning: primarySignal.reasoning,
        rawResponse: primarySignal,
        latencyMs: primaryResult.latencyMs || 0,
        tokenUsage: primaryResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
      });

      const confVoteRef = db.collection('signalVotes').doc();
      batch.set(confVoteRef, {
        signalId: signalRef.id,
        modelId: process.env.CONFIRMATION_MODEL || 'gpt-4o',
        apiProvider: 'OPENAI',
        role: 'CONFIRMATION',
        side: confSignal.side,
        confidence: confSignal.confidence,
        reasoning: confSignal.reasoning,
        rawResponse: confSignal,
        latencyMs: confirmationResult.latencyMs || 0,
        tokenUsage: confirmationResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
      });

      await batch.commit();
      
      const signalRecord = { id: signalRef.id, ...signalData };

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

signalWorker.on('failed', (job, err) => {
  console.error(`[Signal Worker] Job ${job?.id} failed:`, err);
});
