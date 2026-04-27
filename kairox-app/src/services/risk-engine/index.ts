import type { AISignalResponse, RiskAssessmentResult, RiskVerdict } from '@/types';

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
}

const DEFAULT_POLICY: RiskPolicy = {
  maxRiskPercent: 2.0,
  maxOpenTrades: 5,
  maxCorrelated: 3,
  minRewardRisk: 1.5,
  dailyDrawdownLimit: 5.0,
  cooldownMinutes: 60,
};

export class RiskEngine {
  private policy: RiskPolicy;

  constructor(policy?: Partial<RiskPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  assess(
    signal: AISignalResponse,
    portfolio: PortfolioState,
    assetSymbol: string,
    instrumentValuePerPoint: number = 1
  ): RiskAssessmentResult {
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
    }

    // ─── 2. Position Sizing (% risk model) ──────────────────────────────
    const riskAmount = portfolio.balance * (this.policy.maxRiskPercent / 100);
    const positionSize = stopDistance > 0
      ? riskAmount / (stopDistance * instrumentValuePerPoint)
      : 0;
    const actualRiskPercent = this.policy.maxRiskPercent;

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

    // ─── 8. Confidence Check ────────────────────────────────────────────
    if (signal.confidence < 0.5) {
      reasons.push(`Low confidence: ${(signal.confidence * 100).toFixed(0)}%`);
      verdict = this.escalateVerdict(verdict, 'WATCH_ONLY');
    } else if (signal.confidence < 0.65) {
      reasons.push(`Moderate confidence: ${(signal.confidence * 100).toFixed(0)}% — reduced size recommended`);
      if (verdict === 'APPROVED') verdict = 'REDUCED';
    }

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
   * Simplified correlation check — in production, use correlation matrices
   */
  private areCorrelated(assetA: string, assetB: string): boolean {
    const correlationGroups = [
      ['BTCUSDT', 'ETHUSDT'],  // Major crypto correlation
    ];

    return correlationGroups.some(
      group => group.includes(assetA) && group.includes(assetB)
    );
  }
}

export const riskEngine = new RiskEngine();
