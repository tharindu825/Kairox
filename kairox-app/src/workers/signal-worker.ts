import { registerQueueHandler } from './queues';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { Logger } from '@/lib/logger';
import { indicatorService, FeatureBundle } from '@/services/indicators';
import { openRouterService, openRouterConfirmationService } from '@/services/ai/openrouter-service';
import { riskEngine, RiskEngine, PortfolioState } from '@/services/risk-engine';
import { paperTradingService } from '@/services/paper-trading';
import { alertQueue } from './queues';
import { NormalizedCandle } from '@/services/market-data/binance';
import { Decimal } from 'decimal.js';
import { publishNotification } from '@/lib/notify';
import { formatFuturesSymbol, formatPrice } from '@/lib/binance-futures-format';

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
  const correlatedAssets = ordersWithSignals
    .map(o => (o.signal as any)?.symbol)
    .filter((symbol): symbol is string => typeof symbol === 'string');

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

async function signalJobHandler(data: SignalJobData) {
    const { candle } = data;
    await Logger.info(`Processing new candle for ${candle.symbol} (${candle.timeframe})`, 'Signal Worker');

    try {
      const db = await getDb();

      // 1. Cooldown & Duplicate Check
      // Prevent spamming signals for the same asset within 4 hours
      const SIGNAL_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
      const cooldownCutoff = new Date(Date.now() - SIGNAL_COOLDOWN_MS);
      const recentSignal = await db.collection('signals').findOne(
        { symbol: candle.symbol, createdAt: { $gte: cooldownCutoff } },
        { sort: { createdAt: -1 } }
      );
      if (recentSignal) {
        const ageMinutes = Math.floor((Date.now() - new Date(recentSignal.createdAt).getTime()) / 60000);
        await Logger.info(
          `Signal already exists for ${candle.symbol} (${ageMinutes}m ago, cooldown: 4h) — Skipping.`,
          'Signal Worker'
        );
        return { status: 'skipped', reason: 'cooldown_4h' };
      }

      // ── 4-hour loss block (reduced from 24h to allow same-day re-entry) ──
      const LOSS_BLOCK_MS = 4 * 60 * 60 * 1000;
      const lossBlockCutoff = new Date(Date.now() - LOSS_BLOCK_MS);
      const recentLoss = await db.collection('paperOrders').findOne(
        { symbol: candle.symbol, closedAt: { $gte: lossBlockCutoff }, status: 'STOPPED', pnl: { $lt: 0 } },
        { sort: { closedAt: -1 } }
      );
      if (recentLoss) {
        await Logger.info(`4h Loss Block active for ${candle.symbol} — Skipping.`, 'Signal Worker');
        return { status: 'skipped', reason: 'loss_block_4h' };
      }

      // 1. Check for Duplicate Signals or Active Trades
      // Only treat same-candle as duplicate if it was created within the cooldown window
      const [existingSignal, activeTrade] = await Promise.all([
        db.collection('signals').findOne({
          symbol: candle.symbol,
          timeframe: candle.timeframe,
          candleTimestamp: candle.timestamp,
          createdAt: { $gte: cooldownCutoff },
        }),
        db.collection('paperOrders').findOne({
          symbol: candle.symbol,
          status: 'OPEN'
        })
      ]);
      
      if (existingSignal) {
        await Logger.info(`Signal already exists for ${candle.symbol} ${candle.timeframe} at this timestamp — Skipping.`, 'Signal Worker');
        return { status: 'skipped', reason: 'duplicate_timestamp' };
      }

      // 2. Update Indicators & Generate Enhanced Feature Bundle (with SMC + Elliott Wave)
      // Always fetch full candle history for SMC/EW analysis
      const { binanceREST } = await import('@/services/market-data/binance-rest');
      let candleHistory: NormalizedCandle[] = [];

      // Check if indicators are primed for this symbol/timeframe
      const featuresBefore = indicatorService.getFeatureBundle(candle);
      if (featuresBefore.trend === 'NEUTRAL' && featuresBefore.ema200 === candle.close) {
        // Not primed — fetch history and initialize
        await Logger.info(`Priming indicators on-the-fly for ${candle.symbol}...`, 'Signal Worker');
        candleHistory = await binanceREST.getKlines(candle.symbol, candle.timeframe, 250);
        indicatorService.initialize(candle.symbol, candle.timeframe, candleHistory);
      } else {
        // Already primed — still fetch history for SMC/EW analysis
        candleHistory = await binanceREST.getKlines(candle.symbol, candle.timeframe, 250);
      }

      indicatorService.update(candle);

      // Ensure the current candle is included at the end of history
      if (candleHistory.length > 0 && candleHistory[candleHistory.length - 1].timestamp !== candle.timestamp) {
        candleHistory.push(candle);
      } else if (candleHistory.length === 0) {
        candleHistory = [candle];
      }

      // Generate enhanced features with SMC + Elliott Wave + ADX + StochRSI
      const features = indicatorService.getEnhancedFeatureBundle(candleHistory);

      // Log enhanced analysis context
      if (features.smc) {
        await Logger.info(`[SMC] ${candle.symbol}: Structure=${features.smc.structureTrend} | Zone=${features.smc.premiumDiscount} | BOS=${features.smc.lastBOS?.side || 'none'} | CHoCH=${features.smc.lastCHoCH?.side || 'none'}`, 'Signal Worker');
      }
      if (features.elliottWave?.currentWave) {
        await Logger.info(`[EW] ${candle.symbol}: Wave ${features.elliottWave.currentWave.number} (${features.elliottWave.currentWave.type} ${features.elliottWave.currentWave.direction}) confidence=${(features.elliottWave.currentWave.confidence * 100).toFixed(0)}%`, 'Signal Worker');
      }
      await Logger.info(`[Indicators] ${candle.symbol}: ADX=${features.adx.toFixed(1)} | StochRSI K=${features.stochRsi.k.toFixed(1)} D=${features.stochRsi.d.toFixed(1)} | Volatility=${features.volatilityRegime} | SuperTrend=${features.superTrend}`, 'Signal Worker');

      // Allow AI to evaluate even neutral markets (SMC might detect structure)
      if (features.trend === 'NEUTRAL') {
        await Logger.info(`Market is NEUTRAL for ${candle.symbol} — Proceeding with AI evaluation (SMC/EW may provide direction).`, 'Signal Worker');
      }

      // ── Deterministic SMC Counter-Trend Pre-Filter ───────────────────────────────
      // If SMC structure is BEARISH, any BULLISH AI signal is counter-trend.
      // Only allow it when there is a confirmed CHoCH on the execution timeframe
      // (which signals a structural reversal, not a fakeout).
      // This is a deterministic check — no AI overrides allowed here.
      if (features.smc?.structureTrend) {
        const smcTrend = features.smc.structureTrend; // 'BULLISH' | 'BEARISH' | 'RANGING'
        const choch    = features.smc.lastCHoCH;
        const recentChoCH = choch && choch.candlesAgo <= 10;

        if (smcTrend === 'BEARISH' && !recentChoCH) {
          // SMC structure is bearish and no CHoCH — block LONG pre-emptively
          // (we don't know the AI side yet, but we flag this for the AI prompt)
          await Logger.info(`[SMC Pre-Filter] ${candle.symbol}: BEARISH structure, no CHoCH — LONG entries blocked.`, 'Signal Worker');
          // Tag features so the AI knows the hard constraint
          if (!features.marketContext) features.marketContext = {};
          (features.marketContext as any).smcLongBlocked = true;
        }
        if (smcTrend === 'BULLISH' && !recentChoCH) {
          await Logger.info(`[SMC Pre-Filter] ${candle.symbol}: BULLISH structure, no CHoCH — SHORT entries blocked.`, 'Signal Worker');
          if (!features.marketContext) features.marketContext = {};
          (features.marketContext as any).smcShortBlocked = true;
        }
      }


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

      // ── Enforce Market Entry ──
      // To prevent signals from expiring without filling (43% expiry rate historically),
      // we force the entry price to be the current candle close price. 
      if (primarySignal.side !== 'HOLD') {
        primarySignal.entry = candle.close;
      }

      // ── Bulletproof R:R Enforcement ────────────────────────────────────────────
      // Even after the strengthened prompt, the AI occasionally returns targets that
      // are too close to entry. This deterministic post-processor corrects them before
      // the risk engine evaluates the signal — guaranteeing TP1 ≥ 1.0× stop distance.
      if (primarySignal.side !== 'HOLD') {
        const entry      = primarySignal.entry;
        const stopLoss   = primarySignal.stopLoss;
        const stopDist   = Math.abs(entry - stopLoss);
        const isLong     = primarySignal.side === 'LONG';

        if (stopDist > 0 && primarySignal.targets.length > 0) {
          const tp1 = primarySignal.targets[0];
          const tp1Dist = Math.abs(tp1.price - entry);
          const MIN_RR  = 1.0;

          if (tp1Dist < stopDist * MIN_RR) {
            const correctedTP1 = isLong
              ? entry + stopDist * MIN_RR
              : entry - stopDist * MIN_RR;

            await Logger.info(
              `[R:R Enforce] ${candle.symbol}: TP1 too close (${tp1Dist.toFixed(6)} < ${(stopDist * MIN_RR).toFixed(6)} required). ` +
              `Auto-correcting TP1 from ${tp1.price} → ${correctedTP1.toFixed(8)}`,
              'Signal Worker'
            );

            primarySignal.targets[0] = { ...tp1, price: correctedTP1 };

            // Also correct TP2 if it exists and is now behind the corrected TP1
            if (primarySignal.targets.length > 1) {
              const tp2 = primarySignal.targets[1];
              const tp2Dist = Math.abs(tp2.price - entry);
              if (tp2Dist < stopDist * 2.0) {
                const correctedTP2 = isLong
                  ? entry + stopDist * 2.0
                  : entry - stopDist * 2.0;
                primarySignal.targets[1] = { ...tp2, price: correctedTP2 };
              }
            }
          }
        }
      }

      // ── Enforce SMC Counter-Trend Block ──────────────────────────────────────────
      // If the AI returned a direction that violates the SMC structural constraint
      // flagged above (bearish structure + no CHoCH → no LONGs allowed), hard-block it.
      // This makes the SMC filter deterministic, not just advisory.
      const smcLongBlocked  = (features.marketContext as any)?.smcLongBlocked  === true;
      const smcShortBlocked = (features.marketContext as any)?.smcShortBlocked === true;

      if (primarySignal.side === 'LONG' && smcLongBlocked) {
        await Logger.info(`[SMC Enforce] ${candle.symbol}: AI returned LONG but SMC is BEARISH with no CHoCH — overriding to HOLD.`, 'Signal Worker');
        return { status: 'skipped', reason: 'smc_counter_trend_long' };
      }
      if (primarySignal.side === 'SHORT' && smcShortBlocked) {
        await Logger.info(`[SMC Enforce] ${candle.symbol}: AI returned SHORT but SMC is BULLISH with no CHoCH — overriding to HOLD.`, 'Signal Worker');
        return { status: 'skipped', reason: 'smc_counter_trend_short' };
      }

      // 1b. Active Trade Check & Trend Reversal Warning
      if (activeTrade && primarySignal.side !== 'HOLD') {
        if (activeTrade.side === primarySignal.side) {
          await Logger.info(`Active ${activeTrade.side} trade already exists for ${candle.symbol} — Skipping new signal.`, 'Signal Worker');
          return { status: 'skipped', reason: 'active_trade_exists' };
        } else {
          // Trend Reversal!
          await Logger.info(`TREND CHANGE WARNING for ${candle.symbol}: Active ${activeTrade.side} vs New ${primarySignal.side}`, 'Signal Worker');
          primarySignal.reasoning = `⚠️ TREND CHANGE WARNING: Current ${activeTrade.side} position detected while AI suggests ${primarySignal.side}. ${primarySignal.reasoning}`;
        }
      }

      // 3. Model Agreement Check
      const isAgreement = primarySignal.side === confSignal.side;
      const isPrimaryOnly = primarySignal.side !== 'HOLD' && confSignal.side === 'HOLD';
      console.log(`[Signal Worker] Model Agreement: ${isAgreement} (${primarySignal.side} vs ${confSignal.side})`);

      // 3b. Skip saving HOLD signals — don't waste cooldown slots on non-actionable results
      if (primarySignal.side === 'HOLD' && confSignal.side === 'HOLD') {
        await Logger.info(`Both models returned HOLD for ${candle.symbol} — skipping save to preserve cooldown.`, 'Signal Worker');
        return { status: 'skipped', reason: 'both_hold' };
      }
      // If primary is HOLD but confirmation isn't, still skip (primary drives the signal)
      if (primarySignal.side === 'HOLD') {
        await Logger.info(`Primary model returned HOLD for ${candle.symbol} — skipping.`, 'Signal Worker');
        return { status: 'skipped', reason: 'primary_hold' };
      }

      // 4. Get Real Portfolio State from DB
      const portfolio = await getPortfolioState();

      // 5. Risk Engine Validation (always use Primary signal metrics for risk calc)
      const policyDoc = await db.collection('strategyPolicy').findOne({ isActive: true });
      const customRiskEngine = policyDoc ? new RiskEngine({
        maxRiskPercent: policyDoc.maxRiskPercent,
        maxOpenTrades: policyDoc.maxOpenTrades,
        maxCorrelated: policyDoc.maxCorrelated,
        minRewardRisk: policyDoc.minRewardRisk,
        dailyDrawdownLimit: policyDoc.dailyDrawdownLimit,
        cooldownMinutes: policyDoc.cooldownMinutes,
      }) : riskEngine;

      const riskAssessment = await customRiskEngine.assess(primarySignal, portfolio, candle.symbol);

      // Force BLOCKED if models disagree completely (e.g. LONG vs SHORT)
      if (confSignal.side !== 'HOLD' && !isAgreement) {
        riskAssessment.verdict = 'BLOCKED';
        riskAssessment.reasons.push('Absolute model disagreement (LONG vs SHORT)');
      }

      // MTF confirmation is now handled upstream in the auto-selector before hitting the AI.

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
        winProbability: primarySignal.winProbability,
        entry: primarySignal.entry,
        stopLoss: primarySignal.stopLoss,
        targets: primarySignal.targets,
        reasoning: primarySignal.reasoning,
        status: signalStatus,
        marketType: 'CRYPTO',
        // Enhanced analysis context for dashboard review
        analysisContext: {
          adx: features.adx,
          stochRsi: features.stochRsi,
          volatilityRegime: features.volatilityRegime,
          smcStructure: features.smc?.structureTrend || null,
          smcZone: features.smc?.premiumDiscount || null,
          smcSummary: features.smc?.summary || null,
          elliottWaveSummary: features.elliottWave?.summary || null,
          elliottWaveConfidence: features.elliottWave?.currentWave?.confidence || null,
        },
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
          winProbability: primarySignal.winProbability,
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
          winProbability: confSignal.winProbability,
          reasoning: confSignal.reasoning,
          rawResponse: confSignal,
          latencyMs: confirmationResult.latencyMs || 0,
          tokenUsage: confirmationResult.tokenUsage || { prompt: 0, completion: 0, total: 0 },
        }
      ]);
      
      const signalRecord = { id: signalId.toString(), ...signalData };

      await Logger.success(`Signal created: ${signalRecord.id} (${candle.symbol} - ${riskAssessment.verdict})`, 'Signal Worker');

      // 7. Auto-execute Paper Trade if Approved
      // Execute if: (a) both models agree, OR (b) primary-only with confidence (≥0.60) at reduced size
      // Note: AI models consistently return ~62% for confident directional calls; 0.70 was too restrictive.
      const canExecute = signalStatus === 'APPROVED' && riskAssessment.positionSize > 0;
      const executionSize = isAgreement
        ? riskAssessment.positionSize
        : (isPrimaryOnly && primarySignal.winProbability >= 0.60)
          ? riskAssessment.positionSize * 0.5  // Half size for primary-only signals
          : 0;

      if (canExecute && executionSize > 0) {
        try {
          await paperTradingService.executeApprovedSignal(
            signalRecord.id,
            executionSize
          );
          const mode = isAgreement ? 'agreed' : 'primary-only (reduced)';
          await Logger.info(`Paper trade prepared for signal ${signalRecord.id} (${mode}, size=${executionSize.toFixed(4)})`, 'Signal Worker');
        } catch (err) {
          await Logger.error(`Failed to open paper trade: ${(err as Error).message}`, 'Signal Worker');
        }
      }

      // 8. Dispatch Alert if Approved (agreed or primary-only with ≥60% confidence)
      if (signalStatus === 'APPROVED' && (isAgreement || (isPrimaryOnly && primarySignal.winProbability >= 0.60))) {
        const agreementLabel = isAgreement ? '✅ Agree' : '⚠️ Primary Only (high confidence)';
        const riskNote = riskAssessment.verdict === 'REDUCED' ? '⚠️ REDUCED SIZE (High Risk Trade)' : '✅ NORMAL';
        
        const { displaySymbol, multiplier } = formatFuturesSymbol(candle.symbol);
        const displayEntry = formatPrice(primarySignal.entry, multiplier);
        const displayTarget = primarySignal.targets[0] ? formatPrice(primarySignal.targets[0].price, multiplier) : 'N/A';
        const displayStop = formatPrice(primarySignal.stopLoss, multiplier);
        const displaySize = (executionSize / multiplier).toFixed(4);

        const message = `🚨 NEW APPROVED SIGNAL 🚨\n\n` +
          `Type: Cryptocurrency\n` +
          `Asset: ${displaySymbol}\n` +
          `Side: ${primarySignal.side}\n` +
          `Win Prob: ${(primarySignal.winProbability * 100).toFixed(0)}%\n` +
          `Entry: ${displayEntry}\n` +
          `Target: ${displayTarget}\n` +
          `Stop: ${displayStop}\n` +
          `R:R: ${riskAssessment.rewardToRisk.toFixed(2)}\n` +
          `Size: ${displaySize} units\n` +
          `Risk: ${riskNote}\n\n` +
          `Models: ${agreementLabel}`;

        await alertQueue.add('send-telegram', {
          signalId: signalRecord.id,
          message: message
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
}

/** No-op close for compatibility with worker-entry.ts */
export const signalWorker = {
  name: 'signal-generation',
  close: async () => {},
};

// Register handler with the in-process queue shim
registerQueueHandler('signal-generation', signalJobHandler);
