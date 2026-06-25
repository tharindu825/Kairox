import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '@/lib/redis';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { Logger } from '@/lib/logger';
import { IndicatorService } from '@/services/indicators';
import { forexOpenRouterService, forexOpenRouterConfirmationService } from '@/services/ai/forex-openrouter-service';
import { riskEngine, RiskEngine, PortfolioState } from '@/services/risk-engine';
import { alertQueue } from './queues';
import { yahooFinanceService } from '@/services/market-data/yahoo-finance';
import { twelveDataService } from '@/services/market-data/twelve-data';
import { publishNotification } from '@/lib/notify';
import type { NormalizedCandle } from '@/services/market-data/binance';
import type { ForexOrderType } from '@/types';

/** Yahoo Finance (free/no key) first, Twelve Data fallback */
async function getForexKlines(symbol: string, timeframe: string, limit = 250): Promise<NormalizedCandle[]> {
  const yf = await yahooFinanceService.getKlines(symbol, timeframe, limit);
  if (yf.length >= 50) return yf;
  console.warn(`[Forex Worker] Yahoo Finance insufficient for ${symbol} — trying Twelve Data...`);
  return twelveDataService.getKlines(symbol, timeframe, limit);
}

export interface ForexSignalJobData {
  candle:     NormalizedCandle;
  /** The Twelve Data slash-format symbol, e.g. "XAU/USD". Used in Telegram output. */
  displaySymbol: string;
}

// ── Telegram format builder ───────────────────────────────────────────────────

function buildForexTelegramMessage(
  displaySymbol: string,
  orderType:     ForexOrderType,
  entry:         number,
  stopLoss:      number,
  targets:       Array<{ label: string; price: number }>,
): string {
  // Convert order type enum to human-readable label
  const orderLabel: Record<ForexOrderType, string> = {
    BUY_LIMIT:  'Buy Limit',
    SELL_LIMIT: 'Sell Limit',
    BUY_STOP:   'Buy Stop',
    SELL_STOP:  'Sell Stop',
  };

  // Format entry — show as single price or tiny range (entry ± ~5 pips for non-JPY/gold)
  const sym      = displaySymbol.replace('/', '');
  const isJPY    = sym.includes('JPY');
  const isGold   = sym.includes('XAU') || sym.includes('XAG');
  const decimals = isJPY ? 3 : isGold ? 2 : 5;
  const fp       = (n: number) => n.toFixed(decimals);

  // Build TP lines — pad up to 3 targets; mark missing/zero ones as "open"
  const tpLines: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const tp = targets.find(t => t.label === `TP${i}`);
    tpLines.push(`TP${i}: ${tp && tp.price > 0 ? fp(tp.price) : 'open'}`);
  }

  return [
    `#${sym}  ${orderLabel[orderType]} Trade ${fp(entry)}`,
    '',
    `SL : ${fp(stopLoss)}`,
    '',
    tpLines.join('\n'),
  ].join('\n');
}

// ── Portfolio state (reuses logic from signal-worker) ────────────────────────

async function getPortfolioState(): Promise<PortfolioState> {
  const PAPER_BALANCE = Number(process.env.PAPER_BALANCE || 10000);
  const db            = await getDb();

  const openOrders = await db.collection('paperOrders')
    .find({ status: 'OPEN' })
    .toArray();

  const ordersWithSignals = await Promise.all(openOrders.map(async order => {
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

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const closedToday = await db.collection('paperOrders')
    .find({ closedAt: { $gte: todayStart }, status: { $in: ['CLOSED', 'STOPPED'] } })
    .toArray();

  const dailyPnL        = closedToday.reduce((sum, o) => sum + (o.pnl || 0), 0);
  const dailyPnLPercent = PAPER_BALANCE > 0 ? (dailyPnL / PAPER_BALANCE) * 100 : 0;

  const correlatedAssets = ordersWithSignals
    .map(o => (o.signal as any)?.symbol)
    .filter((s): s is string => typeof s === 'string');

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
    } else { break; }
  }

  return {
    balance: PAPER_BALANCE,
    openTrades: ordersWithSignals.length,
    openRiskPercent: ordersWithSignals.reduce((sum, o) => sum + (o.signal?.riskAssessment?.riskPercent || 0), 0),
    dailyPnLPercent,
    correlatedAssets,
    consecutiveStopOuts,
    lastStopOutTime,
  };
}

// ── Worker ────────────────────────────────────────────────────────────────────

export const forexSignalWorker = new Worker(
  'forex-signal-generation',
  async (job: Job<ForexSignalJobData>) => {
    const { candle, displaySymbol } = job.data;
    await Logger.info(`[Forex] Processing ${candle.symbol} (${candle.timeframe})`, 'Forex Signal Worker');

    try {
      const db = await getDb();

      // ── 0. Cooldown — 8 hours per symbol ──────────────────────────────────
      const SIGNAL_COOLDOWN_MS = 8 * 60 * 60 * 1000;
      const cooldownCutoff     = new Date(Date.now() - SIGNAL_COOLDOWN_MS);
      const recentSignal       = await db.collection('signals').findOne(
        { symbol: candle.symbol, marketType: 'FOREX', createdAt: { $gte: cooldownCutoff } },
        { sort: { createdAt: -1 } }
      );
      if (recentSignal) {
        const ageMin = Math.floor((Date.now() - new Date(recentSignal.createdAt).getTime()) / 60000);
        await Logger.info(`[Forex] Cooldown active for ${candle.symbol} (${ageMin}m ago) — Skipping.`, 'Forex Signal Worker');
        return { status: 'skipped', reason: 'cooldown_8h' };
      }

      // ── 1. Duplicate check ────────────────────────────────────────────────
      const existingSignal = await db.collection('signals').findOne({
        symbol:          candle.symbol,
        marketType:      'FOREX',
        timeframe:       candle.timeframe,
        candleTimestamp: candle.timestamp,
        createdAt:       { $gte: cooldownCutoff },
      });
      if (existingSignal) {
        await Logger.info(`[Forex] Duplicate signal for ${candle.symbol} — Skipping.`, 'Forex Signal Worker');
        return { status: 'skipped', reason: 'duplicate_timestamp' };
      }

      // ── 2. Fetch candle history & compute indicators ──────────────────────
      await Logger.info(`[Forex] Fetching candle history for ${candle.symbol}...`, 'Forex Signal Worker');
      const candleHistory = await getForexKlines(candle.symbol, candle.timeframe, 250);
      if (!candleHistory || candleHistory.length < 50) {
        throw new Error(`Insufficient candle data for ${candle.symbol}`);
      }

      // Include latest candle
      if (candleHistory[candleHistory.length - 1].timestamp !== candle.timestamp) {
        candleHistory.push(candle);
      }

      const indicatorSvc = new IndicatorService();
      indicatorSvc.initialize(candle.symbol, candle.timeframe, candleHistory);
      indicatorSvc.update(candle);

      const features = indicatorSvc.getEnhancedFeatureBundle(candleHistory);

      await Logger.info(
        `[Forex] ${candle.symbol}: ADX=${features.adx.toFixed(1)} | RSI=${features.rsi.toFixed(1)} | Trend=${features.trend}`,
        'Forex Signal Worker'
      );

      // ── 3. Dual AI model execution ─────────────────────────────────────────
      await Logger.info(`[Forex] Requesting AI analysis for ${candle.symbol}...`, 'Forex Signal Worker');
      const [primaryResult, confirmResult] = await Promise.all([
        forexOpenRouterService.generateCompletion(candle.symbol, candle.timeframe, features),
        forexOpenRouterConfirmationService.generateCompletion(candle.symbol, candle.timeframe, features),
      ]);

      if (!primaryResult.success || !primaryResult.data) throw new Error(`Primary model failed: ${primaryResult.error}`);
      if (!confirmResult.success || !confirmResult.data) throw new Error(`Confirmation model failed: ${confirmResult.error}`);

      const primarySignal = primaryResult.data;
      const confSignal    = confirmResult.data;

      // ── 4. Model agreement ────────────────────────────────────────────────
      const isAgreement = primarySignal.side === confSignal.side;

      // ── 5. Portfolio state & risk engine ─────────────────────────────────
      const portfolio = await getPortfolioState();
      const policyDoc = await db.collection('strategyPolicy').findOne({ isActive: true });

      const customRiskEngine = policyDoc ? new RiskEngine({
        maxRiskPercent:    policyDoc.maxRiskPercent,
        maxOpenTrades:     policyDoc.maxOpenTrades,
        maxCorrelated:     policyDoc.maxCorrelated,
        minRewardRisk:     policyDoc.minRewardRisk,
        dailyDrawdownLimit:policyDoc.dailyDrawdownLimit,
        cooldownMinutes:   policyDoc.cooldownMinutes,
      }) : riskEngine;

      const riskAssessment = customRiskEngine.assess(primarySignal, portfolio, candle.symbol);

      if (primarySignal.side !== 'HOLD' && confSignal.side !== 'HOLD' && !isAgreement) {
        riskAssessment.verdict = 'BLOCKED';
        riskAssessment.reasons.push('Absolute model disagreement (LONG vs SHORT)');
      }

      // ── 6. Persist signal ─────────────────────────────────────────────────
      const signalStatus = riskAssessment.verdict === 'APPROVED' || riskAssessment.verdict === 'REDUCED'
        ? 'APPROVED'
        : 'BLOCKED';

      // Ensure 3 targets — pad with open (price=0) if AI returns fewer
      const targets = [...primarySignal.targets];
      for (let i = targets.length + 1; i <= 3; i++) {
        targets.push({ label: `TP${i}`, price: 0 });
      }

      const signalId   = new ObjectId();
      const signalData = {
        _id:             signalId,
        symbol:          candle.symbol,
        displaySymbol,                   // e.g. "XAU/USD" for UI display
        marketType:      'FOREX',
        forexOrderType:  primarySignal.forexOrderType,
        timeframe:       candle.timeframe,
        candleTimestamp: candle.timestamp,
        side:            primarySignal.side,
        confidence:      primarySignal.confidence,
        entry:           primarySignal.entry,
        stopLoss:        primarySignal.stopLoss,
        targets,
        reasoning:       primarySignal.reasoning,
        status:          signalStatus,
        analysisContext: {
          adx:              features.adx,
          stochRsi:         features.stochRsi,
          volatilityRegime: features.volatilityRegime,
          smcStructure:     features.smc?.structureTrend || null,
          smcZone:          features.smc?.premiumDiscount || null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.collection('signals').insertOne(signalData);

      await db.collection('riskAssessments').insertOne({
        signalId:       signalId.toString(),
        positionSize:   riskAssessment.positionSize,
        riskPercent:    riskAssessment.riskPercent,
        rewardToRisk:   riskAssessment.rewardToRisk,
        exposureCheck:  riskAssessment.exposureCheck,
        correlationFlag:riskAssessment.correlationFlag,
        verdict:        riskAssessment.verdict,
        reasons:        riskAssessment.reasons,
      });

      await db.collection('signalVotes').insertMany([
        {
          signalId:     signalId.toString(),
          modelId:      process.env.PRIMARY_MODEL || 'deepseek/deepseek-chat-v3.1',
          apiProvider:  'OPENROUTER',
          role:         'PRIMARY',
          side:         primarySignal.side,
          confidence:   primarySignal.confidence,
          reasoning:    primarySignal.reasoning,
          rawResponse:  primarySignal,
          latencyMs:    primaryResult.latencyMs || 0,
          tokenUsage:   primaryResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
        },
        {
          signalId:     signalId.toString(),
          modelId:      process.env.CONFIRMATION_MODEL || 'google/gemini-2.5-flash',
          apiProvider:  'OPENROUTER',
          role:         'CONFIRMATION',
          side:         confSignal.side,
          confidence:   confSignal.confidence,
          reasoning:    confSignal.reasoning,
          rawResponse:  confSignal,
          latencyMs:    confirmResult.latencyMs || 0,
          tokenUsage:   confirmResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
        },
      ]);

      const signalRecord = { id: signalId.toString(), ...signalData };
      await Logger.success(`[Forex] Signal created: ${signalRecord.id} (${candle.symbol} ${primarySignal.forexOrderType} — ${riskAssessment.verdict})`, 'Forex Signal Worker');

      // ── 7. Dispatch Telegram alert in exact forex format ──────────────────
      if (signalStatus === 'APPROVED' && isAgreement) {
        const telegramMessage = buildForexTelegramMessage(
          displaySymbol,
          primarySignal.forexOrderType,
          primarySignal.entry,
          primarySignal.stopLoss,
          targets,
        );

        await alertQueue.add('send-telegram', {
          signalId: signalRecord.id,
          message:  telegramMessage,
        });
      }

      // ── 8. Push SSE notification to UI ────────────────────────────────────
      await publishNotification({ type: 'NEW_SIGNAL', data: signalRecord });

      return { status: 'success', signalId: signalRecord.id };

    } catch (error) {
      console.error(`[Forex Signal Worker] Error:`, error);
      throw error;
    }
  },
  { connection: createBullMQConnection() }
);

forexSignalWorker.on('failed', (job: Job<ForexSignalJobData> | undefined, err: Error) => {
  console.error(`[Forex Signal Worker] Job ${job?.id} failed:`, err);
});
