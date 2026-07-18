import type { AISignalResponse, RiskAssessmentResult, RiskVerdict } from '@/types';
import { calibrationTracker } from '../signals/calibration-tracker';

export interface PortfolioState {
  balance: number;
  openTrades: number;
  openRiskPercent: number;
  dailyPnLPercent: number;
  correlatedAssets: string[];
  lastStopOutTime?: Date;
  consecutiveStopOuts: number;
}

export interface RiskPolicy {
  maxRiskPercent: number;
  maxOpenTrades: number;
  maxCorrelated: number;
  minRewardRisk: number;
  dailyDrawdownLimit: number;
  cooldownMinutes: number;
  /** EV threshold (in terms of Risk multiples) to approve a signal */
  evThresholdApproved: number;
  /** EV threshold (in terms of Risk multiples) to reduce a signal rather than block */
  evThresholdReduced: number;
  /** Fractional Kelly multiplier (e.g. 0.5 for Half Kelly) */
  kellyFraction: number;
}

const DEFAULT_POLICY: RiskPolicy = {
  maxRiskPercent: 2.0,
  maxOpenTrades: 10,
  maxCorrelated: 3,
  minRewardRisk: 1.5,       // Restored to 1.5 to protect against poor win rates
  dailyDrawdownLimit: 10.0,
  cooldownMinutes: 30,
  evThresholdApproved: 0.15, // Lowered from 0.5R — allow moderate-EV setups at full size
  evThresholdReduced: 0.0,   // Lowered from 0.1R — any positive EV is allowed at reduced size
  kellyFraction: 0.5,
};

export class RiskEngine {
  private policy: RiskPolicy;

  constructor(policy?: Partial<RiskPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  async assess(
    signal: AISignalResponse,
    portfolio: PortfolioState,
    assetSymbol: string,
    instrumentValuePerPoint: number = 1
  ): Promise<RiskAssessmentResult> {
    const reasons: string[] = [];
    let verdict: RiskVerdict = 'APPROVED';

    // Skip risk sizing for HOLD signals
    if (signal.side === 'HOLD') {
      return {
        positionSize: 0,
        riskPercent: 0,
        rewardToRisk: 0,
        exposureCheck: true,
        correlationFlag: false,
        verdict: 'WATCH_ONLY',
        reasons: ['HOLD signal — no position to size'],
      };
    }

    // ─── 1. Calculate Risk-Reward Ratio ─────────────────────────────────
    const stopDistance = Math.abs(signal.entry - signal.stopLoss);
    const firstTarget = signal.targets[0]?.price || signal.entry;
    const targetDistance = Math.abs(firstTarget - signal.entry);
    const rewardToRisk = stopDistance > 0 ? targetDistance / stopDistance : 0;

    if (rewardToRisk < this.policy.minRewardRisk) {
      reasons.push(`R:R ratio ${rewardToRisk.toFixed(2)} below minimum ${this.policy.minRewardRisk}`);
      verdict = 'BLOCKED';
    } else if (rewardToRisk < 1.5) {
      reasons.push(`R:R ratio ${rewardToRisk.toFixed(2)} is marginal (below 1.5) — reduced position size`);
      verdict = this.escalateVerdict(verdict, 'REDUCED');
    }

    // ─── 2. Expectancy & Position Sizing (Kelly) ────────────────────────
    
    // Calibrate the AI's win probability
    // Assuming modelId 'gemini' and timeframe '4h' as defaults for now
    const winProb = await calibrationTracker.calibrate(signal.winProbability, 'gemini', '4h');
    const lossProb = 1 - winProb;
    
    // Calculate Expected Value (in terms of Risk Multiples)
    // EV = (Win% * Reward) - (Loss% * Risk)
    // Since Risk = 1, Reward = rewardToRisk
    const evRiskMultiples = (winProb * rewardToRisk) - (lossProb * 1);
    
    if (evRiskMultiples <= 0) {
      reasons.push(`Negative Expectancy: EV = ${evRiskMultiples.toFixed(2)}R. Win probability (${(winProb*100).toFixed(1)}%) too low for ${rewardToRisk.toFixed(2)} R:R.`);
      verdict = 'BLOCKED';
    } else if (evRiskMultiples < this.policy.evThresholdReduced) {
      reasons.push(`Poor Expectancy: EV = ${evRiskMultiples.toFixed(2)}R < ${this.policy.evThresholdReduced}R. Blocking marginal setup.`);
      verdict = 'BLOCKED';
    } else if (evRiskMultiples < this.policy.evThresholdApproved) {
      reasons.push(`Moderate Expectancy: EV = ${evRiskMultiples.toFixed(2)}R < ${this.policy.evThresholdApproved}R. Position size reduced.`);
      verdict = this.escalateVerdict(verdict, 'REDUCED');
    } else {
      reasons.push(`Strong Expectancy: EV = ${evRiskMultiples.toFixed(2)}R. AI Probability: ${(winProb*100).toFixed(1)}%.`);
    }

    // Kelly Criterion Sizing
    // Kelly % = W - ((1 - W) / R)
    let kellyPercent = winProb - (lossProb / (rewardToRisk || 1));
    kellyPercent = Math.max(0, kellyPercent);
    
    // Apply fractional Kelly and cap at maxRiskPercent
    let actualRiskPercent = (kellyPercent * 100) * this.policy.kellyFraction;
    actualRiskPercent = Math.min(actualRiskPercent, this.policy.maxRiskPercent);
    
    // Fallback if EV is positive but Kelly is very small or negative
    if (verdict === 'APPROVED' && actualRiskPercent < 0.25) actualRiskPercent = 0.5;
    
    const riskAmount = portfolio.balance * (actualRiskPercent / 100);
    const positionSize = stopDistance > 0
      ? riskAmount / (stopDistance * instrumentValuePerPoint)
      : 0;

    // ─── 3. Max Open Trades ─────────────────────────────────────────────
    if (portfolio.openTrades >= this.policy.maxOpenTrades) {
      reasons.push(`Max open trades reached (${portfolio.openTrades}/${this.policy.maxOpenTrades})`);
      verdict = this.escalateVerdict(verdict, 'BLOCKED');
    }

    // ─── 4. Total Open Risk Exposure ────────────────────────────────────
    const totalRiskAfter = portfolio.openRiskPercent + actualRiskPercent;
    const exposureCheck = totalRiskAfter <= this.policy.maxRiskPercent * this.policy.maxOpenTrades;
    if (!exposureCheck) {
      reasons.push(`Total exposure ${totalRiskAfter.toFixed(1)}% exceeds limit`);
      verdict = this.escalateVerdict(verdict, 'REDUCED');
    }

    // ─── 5. Daily Drawdown Lock ─────────────────────────────────────────
    if (Math.abs(portfolio.dailyPnLPercent) >= this.policy.dailyDrawdownLimit) {
      reasons.push(`Daily drawdown limit hit (${portfolio.dailyPnLPercent.toFixed(1)}%/${this.policy.dailyDrawdownLimit}%)`);
      verdict = this.escalateVerdict(verdict, 'BLOCKED');
    }

    // ─── 6. Correlation Check ───────────────────────────────────────────
    const correlatedCount = portfolio.correlatedAssets.filter(a => 
      this.areCorrelated(a, assetSymbol)
    ).length;
    const correlationFlag = correlatedCount >= this.policy.maxCorrelated;
    if (correlationFlag) {
      reasons.push(`Correlated exposure: ${correlatedCount} similar assets already open`);
      verdict = this.escalateVerdict(verdict, 'REDUCED');
    }

    // ─── 7. Cooldown After Stop-Outs ────────────────────────────────────
    if (portfolio.lastStopOutTime && portfolio.consecutiveStopOuts >= 2) {
      const minutesSinceLastStop = (Date.now() - portfolio.lastStopOutTime.getTime()) / 60000;
      if (minutesSinceLastStop < this.policy.cooldownMinutes) {
        reasons.push(`Cooldown active: ${Math.ceil(this.policy.cooldownMinutes - minutesSinceLastStop)}min remaining after ${portfolio.consecutiveStopOuts} consecutive stops`);
        verdict = this.escalateVerdict(verdict, 'BLOCKED');
      }
    }

    // (Confidence logic has been replaced by Expected Value / Kelly logic)

    // ─── Final Position Size Adjustment ─────────────────────────────────
    let adjustedSize = positionSize;
    if (verdict === 'REDUCED') {
      adjustedSize = positionSize * 0.5;
      reasons.push('Position size halved due to risk flags');
    } else if (verdict === 'WATCH_ONLY' || verdict === 'BLOCKED') {
      adjustedSize = 0;
    }

    if (reasons.length === 0) {
      reasons.push('All risk checks passed');
    }

    return {
      positionSize: adjustedSize,
      riskPercent: verdict === 'BLOCKED' || verdict === 'WATCH_ONLY' ? 0 : actualRiskPercent,
      rewardToRisk,
      exposureCheck,
      correlationFlag,
      verdict,
      reasons,
    };
  }

  /**
   * Escalate verdict to a stricter level, never downgrade
   */
  private escalateVerdict(current: RiskVerdict, proposed: RiskVerdict): RiskVerdict {
    const severity: Record<RiskVerdict, number> = {
      APPROVED: 0,
      REDUCED: 1,
      WATCH_ONLY: 2,
      BLOCKED: 3,
    };
    return severity[proposed] > severity[current] ? proposed : current;
  }

  /**
   * Sector-based correlation check — groups crypto assets by sector
   * to prevent over-exposure to correlated assets.
   */
  private areCorrelated(assetA: string, assetB: string): boolean {
    const correlationGroups = [
      // Major Crypto (highly correlated)
      ['BTCUSDT', 'ETHUSDT'],
      // Layer 1s (correlated during risk-on/off moves)
      ['ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'NEARUSDT', 'SUIUSDT', 'APTUSDT', 'DOTUSDT', 'ADAUSDT', 'ATOMUSDT'],
      // DeFi tokens
      ['UNIUSDT', 'AAVEUSDT', 'LINKUSDT'],
      // AI / Data tokens
      ['FETUSDT', 'RENDERUSDT'],
      // Meme coins (extremely correlated in pumps/dumps)
      ['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'WIFUSDT'],
      // Layer 2s
      ['ARBUSDT', 'OPUSDT', 'MATICUSDT'],
    ];

    return correlationGroups.some(
      group => group.includes(assetA) && group.includes(assetB)
    );
  }
}

export const riskEngine = new RiskEngine();
