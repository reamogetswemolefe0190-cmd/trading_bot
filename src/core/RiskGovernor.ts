import { Position, OrderType } from './Types';

export interface GovernorConfig {
  maxDailyLossPct: number;       // e.g. 5%
  maxDrawdownPct: number;        // e.g. 10%
  maxConcentrationPct: number;   // e.g. 30% of NAV max size for a single asset
  manualFreeze: boolean;         // Freeze all trading activity
}

export class RiskGovernor {
  private config!: GovernorConfig;
  private peakEquity: number = 0;
  private dailyStartEquity: number = 0;

  constructor() {
    this.loadConfig();
  }

  public loadConfig() {
    this.config = {
      maxDailyLossPct: parseFloat(localStorage.getItem('gov_max_daily_loss') || '5'),
      maxDrawdownPct: parseFloat(localStorage.getItem('gov_max_drawdown') || '10'),
      maxConcentrationPct: parseFloat(localStorage.getItem('gov_max_concentration') || '30'),
      manualFreeze: localStorage.getItem('gov_manual_freeze') === 'true'
    };
  }

  public updateConfig(newConfig: Partial<GovernorConfig>) {
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem('gov_max_daily_loss', this.config.maxDailyLossPct.toString());
    localStorage.setItem('gov_max_drawdown', this.config.maxDrawdownPct.toString());
    localStorage.setItem('gov_max_concentration', this.config.maxConcentrationPct.toString());
    localStorage.setItem('gov_manual_freeze', this.config.manualFreeze ? 'true' : 'false');
  }

  public getConfig(): GovernorConfig {
    return this.config;
  }

  public recordEquity(currentEquity: number) {
    if (this.dailyStartEquity === 0) {
      this.dailyStartEquity = currentEquity;
    }
    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
    }
  }

  public resetDailyStart(currentEquity: number) {
    this.dailyStartEquity = currentEquity;
  }

  /**
   * Primary gate to approve or reject order submissions.
   * Returns a validation result with a boolean and description.
   */
  public evaluateOrder(
    symbol: string,
    side: OrderType,
    quantity: number,
    price: number,
    currentEquity: number,
    activePositions: Position[]
  ): { allowed: boolean; reason: string } {
    
    // 1. Manual Freeze Check
    if (this.config.manualFreeze) {
      return { allowed: false, reason: "Manual freeze is active. All trading is paused by operator override." };
    }

    // 2. Max Daily Loss Check
    if (this.dailyStartEquity > 0) {
      const dailyLoss = this.dailyStartEquity - currentEquity;
      const dailyLossPct = (dailyLoss / this.dailyStartEquity) * 100;
      if (dailyLoss > 0 && dailyLossPct >= this.config.maxDailyLossPct) {
        return { 
          allowed: false, 
          reason: `Daily Stop Loss limit exceeded (-${dailyLossPct.toFixed(2)}% vs limit -${this.config.maxDailyLossPct}%).` 
        };
      }
    }

    // 3. Max Drawdown Check
    if (this.peakEquity > 0) {
      const drawdown = ((this.peakEquity - currentEquity) / this.peakEquity) * 100;
      if (drawdown >= this.config.maxDrawdownPct) {
        return { 
          allowed: false, 
          reason: `Max Drawdown limit exceeded (-${drawdown.toFixed(2)}% vs limit -${this.config.maxDrawdownPct}%).` 
        };
      }
    }

    // Only apply concentration check for BUY orders (increases size)
    if (side === 'BUY') {
      // 4. Max Position Concentration Check
      const orderValue = quantity * price;
      
      const activePosition = activePositions.find(p => p.asset === symbol);
      const activeValue = activePosition ? activePosition.quantity * activePosition.currentPrice : 0;
      
      const targetValueAfterOrder = activeValue + orderValue;
      const concentrationPct = (targetValueAfterOrder / (currentEquity || 1)) * 100;

      if (concentrationPct > this.config.maxConcentrationPct) {
        return {
          allowed: false,
          reason: `Order would exceed single position concentration limit of ${this.config.maxConcentrationPct}% (would hit ${concentrationPct.toFixed(1)}%).`
        };
      }
    }

    return { allowed: true, reason: "Order approved by Risk Governor." };
  }
}
