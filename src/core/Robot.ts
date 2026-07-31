import { IBroker, LocalBroker } from './Broker';
import { Simulator } from './Simulator';
import { 
  StrategyConfig, 
  RiskConfig, 
  Trade, 
  LogEntry, 
  BacktestReport, 
  PerformanceReview,
  Candle
} from './Types';
import { Strategies } from './Strategies';
import { ReviewEngine } from './ReviewEngine';

export class Robot {
  private simulator: Simulator;
  private broker: IBroker;

  // Multi-asset registries
  private activeStrategyConfigs: Map<string, StrategyConfig> = new Map();
  private activeRiskConfigs: Map<string, RiskConfig> = new Map();

  private isRunning: boolean = false;
  private isTradingHalted: boolean = false;
  private initialDailyEquity: number = 100000;
  private logs: LogEntry[] = [];
  private positionsCache: any[] = [];
  private lastCacheRefreshTime: number = 0;
  
  // Track currently processing risk alerts to prevent UI modal spamming
  private activeRiskPrompts: Set<string> = new Set();
  
  // Callbacks for UI interaction (now includes symbol in update)
  private onLogCallback: ((entry: LogEntry) => void) | null = null;
  private onTradeCallback: ((trade: Trade) => void) | null = null;
  private onUpdateCallback: ((symbol: string, isNewCandle?: boolean) => void) | null = null;
  private onAdvisorPrompt: ((
    type: 'BUY' | 'SELL',
    asset: string,
    qty: number,
    price: number,
    confirm: () => void
  ) => void) | null = null;

  constructor(
    simulator: Simulator,
    broker: IBroker,
    defaultStrategy: StrategyConfig,
    defaultRisk: RiskConfig
  ) {
    this.simulator = simulator;
    this.broker = broker;
    
    // Seed multi-asset maps with default configurations
    Simulator.assets.forEach(asset => {
      this.activeStrategyConfigs.set(asset.symbol, { ...defaultStrategy });
      this.activeRiskConfigs.set(asset.symbol, { ...defaultRisk });
    });
    
    // Bind simulator multiplex tick stream
    this.simulator.onTick((symbol, price, candle, isNewCandle) => {
      this.handleTick(symbol, price, candle, isNewCandle);
    });
  }

  setBroker(broker: IBroker) {
    this.broker = broker;
    this.positionsCache = [];
    this.lastCacheRefreshTime = 0;
    this.updateDailyEquity();
  }

  async refreshPositionsCache() {
    try {
      this.positionsCache = await this.broker.getPositions();
    } catch (e: any) {
      console.warn('Failed to refresh positions cache:', e.message);
    }
  }

  // Update specific asset's strategy config
  setStrategyConfig(symbol: string, config: StrategyConfig) {
    this.activeStrategyConfigs.set(symbol, config);
    this.log('info', `Strategy configuration updated for ${symbol} to ${config.type.toUpperCase()}`, symbol);
  }

  getStrategyConfig(symbol: string): StrategyConfig {
    return this.activeStrategyConfigs.get(symbol) || Array.from(this.activeStrategyConfigs.values())[0];
  }

  // Update specific asset's risk config
  setRiskConfig(symbol: string, config: RiskConfig) {
    this.activeRiskConfigs.set(symbol, config);
    
    // Sync global account risk controls across all assets
    for (const [sym, risk] of this.activeRiskConfigs.entries()) {
      risk.executionMode = config.executionMode;
      risk.maxPositions = config.maxPositions;
      risk.dailyStopLossPct = config.dailyStopLossPct;
      this.activeRiskConfigs.set(sym, risk);
    }
    
    this.log('info', `Global risk limits updated. Mode: ${config.executionMode.toUpperCase()} | Max Positions: ${config.maxPositions} | Daily SL: ${config.dailyStopLossPct}%`, symbol);
  }

  getRiskConfig(symbol: string): RiskConfig {
    return this.activeRiskConfigs.get(symbol) || Array.from(this.activeRiskConfigs.values())[0];
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  // Subscribe UI handlers
  onLog(cb: (entry: LogEntry) => void) { this.onLogCallback = cb; }
  onTrade(cb: (trade: Trade) => void) { this.onTradeCallback = cb; }
  onUpdate(cb: (symbol: string, isNewCandle?: boolean) => void) { this.onUpdateCallback = cb; }
  onAdvisor(cb: any) { this.onAdvisorPrompt = cb; }

  log(level: LogEntry['level'], message: string, asset?: string) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      asset
    };
    this.logs.unshift(entry); // New logs at front
    if (this.logs.length > 500) this.logs.pop();
    if (this.onLogCallback) this.onLogCallback(entry);
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isTradingHalted = false;
    this.positionsCache = [];
    this.lastCacheRefreshTime = 0;
    await this.refreshPositionsCache();
    await this.updateDailyEquity();
    this.simulator.start('live');
    this.log('info', 'Trading robot started.');
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.simulator.stop();
    this.log('info', 'Trading robot paused.');
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  async updateDailyEquity() {
    try {
      const balance = await this.broker.getAccountBalance();
      this.initialDailyEquity = balance.equity;
    } catch (e) {
      this.initialDailyEquity = 100000;
    }
  }

  // Multi-asset tick handler
  private async handleTick(symbol: string, price: number, _candle: Candle, isNewCandle: boolean) {
    // If local simulator, keep its position price updated for PnL calculation
    if (this.broker instanceof LocalBroker) {
      this.broker.updateCurrentPrice(symbol, price);
    }

    if (this.onUpdateCallback) this.onUpdateCallback(symbol, isNewCandle);

    // Check individual Stop Loss & Take Profit limits on every price tick
    if (this.isRunning && !this.isTradingHalted) {
      // Background refresh of positions cache every 10 seconds
      const now = Date.now();
      if (now - this.lastCacheRefreshTime > 10000) {
        this.lastCacheRefreshTime = now;
        this.refreshPositionsCache();
      }

      try {
        await this.checkPositionRiskLimits(symbol, price);
      } catch (e: any) {
        this.log('error', `Risk limits evaluation failed for ${symbol}: ${e.message}`, symbol);
      }
    }

    // Only evaluate trading strategies when a candle closes to avoid mid-candle noise
    if (!isNewCandle || !this.isRunning || this.isTradingHalted) return;

    const candles = this.simulator.getCandles(symbol);
    if (candles.length < 5) return;

    const config = this.activeStrategyConfigs.get(symbol);
    if (!config) return;

    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (config.type === 'ml_predict') {
      signal = await this.queryMLPredictor(symbol, candles);
    } else {
      signal = Strategies.evaluate(candles, config);
    }

    if (signal === 'HOLD') return;

    try {
      await this.processSignal(symbol, signal, price);
    } catch (e: any) {
      this.log('error', `Execution failed for ${symbol}: ${e.message}`, symbol);
    }
  }

  private async processSignal(symbol: string, signal: 'BUY' | 'SELL', price: number) {
    const balance = await this.broker.getAccountBalance();
    const positions = await this.broker.getPositions();
    const activePosition = positions.find(p => p.asset === symbol);
    const assetRisk = this.activeRiskConfigs.get(symbol) || Array.from(this.activeRiskConfigs.values())[0];

    // 1. Check Daily Stop Loss Halt Constraint (Global)
    const dailyPnL = ((balance.equity - this.initialDailyEquity) / this.initialDailyEquity) * 100;
    if (dailyPnL <= -assetRisk.dailyStopLossPct) {
      this.isTradingHalted = true;
      this.log('error', `CRITICAL: Daily stop loss of ${assetRisk.dailyStopLossPct}% breached. Halted all active trading.`);
      await this.emergencyKill();
      return;
    }

    if (signal === 'BUY') {
      // 2. Buy safety validations
      if (activePosition && activePosition.quantity > 0) {
        return; // Position already exists in symbol
      }
      if (positions.length >= assetRisk.maxPositions) {
        this.log('warn', `Signal BUY in ${symbol} ignored: Global max positions limit (${assetRisk.maxPositions}) reached.`, symbol);
        return;
      }

      // Quantity calculation based on Max Position Size limit
      const orderValue = Math.min(balance.cash, assetRisk.maxPositionSize);
      if (orderValue < 10) {
        this.log('warn', `Signal BUY in ${symbol} ignored: Insufficient cash balance (Available: $${balance.cash.toFixed(2)}).`, symbol);
        return;
      }
      const qty = parseFloat((orderValue / price).toFixed(4));

      if (assetRisk.executionMode === 'advisor') {
        this.log('info', `Advisor Signal: Triggered BUY in ${symbol} at $${price.toFixed(2)}.`, symbol);
        if (this.onAdvisorPrompt) {
          this.onAdvisorPrompt('BUY', symbol, qty, price, async () => {
            await this.executeOrder(symbol, 'BUY', qty, price);
          });
        }
      } else {
        await this.executeOrder(symbol, 'BUY', qty, price);
      }
    } else if (signal === 'SELL') {
      // 3. Sell safety validations
      if (!activePosition || activePosition.quantity <= 0) {
        return; // Nothing to sell
      }
      const qty = activePosition.quantity;

      if (assetRisk.executionMode === 'advisor') {
        this.log('info', `Advisor Signal: Triggered SELL in ${symbol} at $${price.toFixed(2)}.`, symbol);
        if (this.onAdvisorPrompt) {
          this.onAdvisorPrompt('SELL', symbol, qty, price, async () => {
            await this.executeOrder(symbol, 'SELL', qty, price);
          });
        }
      } else {
        await this.executeOrder(symbol, 'SELL', qty, price);
      }
    }
  }

  // Check trade specific Stop Loss / Take Profit boundaries on every price tick
  private async checkPositionRiskLimits(symbol: string, price: number) {
    if (this.activeRiskPrompts.has(symbol)) return;

    const activePosition = this.positionsCache.find(p => p.asset === symbol);

    if (!activePosition || activePosition.quantity <= 0) return;

    const assetRisk = this.activeRiskConfigs.get(symbol) || Array.from(this.activeRiskConfigs.values())[0];
    const stopLossTriggerPrice = activePosition.averagePrice * (1 - assetRisk.positionStopLossPct / 100);
    const takeProfitTriggerPrice = activePosition.averagePrice * (1 + assetRisk.positionTakeProfitPct / 100);

    if (price <= stopLossTriggerPrice) {
      this.activeRiskPrompts.add(symbol);
      this.log('warn', `STOP LOSS TRIGGERED: ${symbol} price $${price.toFixed(2)} hit trigger $${stopLossTriggerPrice.toFixed(2)} (-${assetRisk.positionStopLossPct}%).`, symbol);

      if (assetRisk.executionMode === 'advisor') {
        if (this.onAdvisorPrompt) {
          this.onAdvisorPrompt('SELL', symbol, activePosition.quantity, price, async () => {
            try {
              await this.executeOrder(symbol, 'SELL', activePosition.quantity, price);
            } finally {
              this.activeRiskPrompts.delete(symbol);
            }
          });
          // Unlock in 10s if dismissed
          setTimeout(() => { this.activeRiskPrompts.delete(symbol); }, 10000);
        } else {
          this.activeRiskPrompts.delete(symbol);
        }
      } else {
        try {
          await this.executeOrder(symbol, 'SELL', activePosition.quantity, price);
        } finally {
          this.activeRiskPrompts.delete(symbol);
        }
      }
    } else if (price >= takeProfitTriggerPrice) {
      this.activeRiskPrompts.add(symbol);
      this.log('buy', `TAKE PROFIT TRIGGERED: ${symbol} price $${price.toFixed(2)} hit trigger $${takeProfitTriggerPrice.toFixed(2)} (+${assetRisk.positionTakeProfitPct}%).`, symbol);

      if (assetRisk.executionMode === 'advisor') {
        if (this.onAdvisorPrompt) {
          this.onAdvisorPrompt('SELL', symbol, activePosition.quantity, price, async () => {
            try {
              await this.executeOrder(symbol, 'SELL', activePosition.quantity, price);
            } finally {
              this.activeRiskPrompts.delete(symbol);
            }
          });
          // Unlock in 10s if dismissed
          setTimeout(() => { this.activeRiskPrompts.delete(symbol); }, 10000);
        } else {
          this.activeRiskPrompts.delete(symbol);
        }
      } else {
        try {
          await this.executeOrder(symbol, 'SELL', activePosition.quantity, price);
        } finally {
          this.activeRiskPrompts.delete(symbol);
        }
      }
    }
  }

  private async executeOrder(symbol: string, side: 'BUY' | 'SELL', qty: number, price: number) {
    this.log('info', `Placing ${side} order: ${qty} ${symbol} at $${price.toFixed(2)}...`, symbol);
    const trade = await this.broker.placeOrder(symbol, side, qty, price);
    
    this.log(
      side === 'BUY' ? 'buy' : 'sell', 
      `SUCCESS: Executed ${side} ${qty} ${symbol} at $${trade.price.toFixed(2)} (PnL: $${(trade.pnl || 0).toFixed(2)})`,
      symbol
    );

    if (this.onTradeCallback) this.onTradeCallback(trade);
    await this.refreshPositionsCache(); // Sync cache immediately after order is executed
    if (this.onUpdateCallback) this.onUpdateCallback(symbol, false);
  }

  // Emergency liquidation of all holdings
  async emergencyKill() {
    this.log('warn', 'EMERGENCY: Executing kill switch. Closing all positions...');
    try {
      await this.broker.liquidateAll();
      this.log('error', 'EMERGENCY: All positions liquidated successfully.');
      if (this.onUpdateCallback) this.onUpdateCallback(this.simulator.getAsset().symbol, false);
    } catch (e: any) {
      this.log('error', `Emergency liquidation failed: ${e.message}`);
    }
  }

  // Runs a complete backtest using historical data loaded in simulator (single selected asset)
  async runBacktest(days: number = 180): Promise<BacktestReport> {
    const symbol = this.simulator.getAsset().symbol;
    this.log('info', `Starting backtest on ${symbol} over the last ${days} days...`, symbol);
    this.stop();

    const history = await this.simulator.loadHistoricalData(days);
    let cash = 10000;
    let holdings = 0;
    let avgBuyPrice = 0;
    const trades: Trade[] = [];
    
    let maxDrawdown = 0;
    let peakEquity = 10000;
    
    const activeConfig = this.activeStrategyConfigs.get(symbol) || Array.from(this.activeStrategyConfigs.values())[0];

    // Process candles chronologically
    for (let i = 15; i < history.length; i++) {
      const slice = history.slice(0, i + 1);
      const signal = Strategies.evaluate(slice, activeConfig);
      const price = history[i].close;
      
      const currentEquity = cash + holdings * price;
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const drawdown = ((peakEquity - currentEquity) / peakEquity) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      if (signal === 'BUY' && holdings === 0) {
        // Buy full allocation
        const commission = cash * 0.001;
        const cost = cash - commission;
        holdings = cost / price;
        avgBuyPrice = price;
        
        trades.push({
          id: `bt-buy-${i}`,
          type: 'BUY',
          asset: symbol,
          price,
          quantity: holdings,
          cost,
          timestamp: history[i].time * 1000,
          pnl: 0
        });
        cash = 0;
      } else if (signal === 'SELL' && holdings > 0) {
        // Sell everything
        const value = holdings * price;
        const commission = value * 0.001;
        const proceeds = value - commission;
        const realizedPnl = (price - avgBuyPrice) * holdings - (commission + (avgBuyPrice * holdings * 0.001));
        
        trades.push({
          id: `bt-sell-${i}`,
          type: 'SELL',
          asset: symbol,
          price,
          quantity: holdings,
          cost: value,
          timestamp: history[i].time * 1000,
          pnl: realizedPnl
        });
        
        cash = proceeds;
        holdings = 0;
      }
    }

    const finalPrice = history[history.length - 1].close;
    const endingEquity = cash + holdings * finalPrice;
    const netProfit = endingEquity - 10000;
    const netProfitPct = (netProfit / 10000) * 100;
    
    // Analyze backtest trades
    const sells = trades.filter(t => t.type === 'SELL');
    let wins = 0;
    sells.forEach(t => { if ((t.pnl || 0) > 0) wins++; });
    const winRate = sells.length === 0 ? 0 : (wins / sells.length) * 100;

    // Estimate Sharpe ratio (simplified)
    const sharpeRatio = sells.length === 0 ? 0 : (netProfitPct / (maxDrawdown || 1)) * 0.5;

    this.log('info', `Backtest complete for ${symbol}. Profit: $${netProfit.toFixed(2)} (${netProfitPct.toFixed(1)}%). Win rate: ${winRate.toFixed(1)}%`, symbol);

    return {
      initialEquity: 10000,
      endingEquity,
      netProfit,
      netProfitPct,
      totalTrades: trades.length,
      winRate,
      maxDrawdownPct: maxDrawdown,
      sharpeRatio
    };
  }

  // Generates self-recommendation report card for a specific symbol (or current selection)
  async generateSelfReview(symbol: string = this.simulator.getAsset().symbol): Promise<PerformanceReview> {
    const candles = this.simulator.getCandles(symbol);
    const activeConfig = this.activeStrategyConfigs.get(symbol) || Array.from(this.activeStrategyConfigs.values())[0];
    
    // Gather all trades in active broker specifically for this symbol
    const activeTrades = this.logs
      .filter(l => l.asset === symbol && (l.level === 'buy' || l.level === 'sell'))
      .map(l => {
        const regex = /Executed (BUY|SELL) ([\d\.]+) (\S+) at \$([\d\.]+)(?: \(PnL: \$([-\d\.]+)\))?/;
        const match = l.message.match(regex);
        if (match) {
          return {
            id: Math.random().toString(),
            type: match[1] as any,
            quantity: parseFloat(match[2]),
            asset: match[3],
            price: parseFloat(match[4]),
            cost: parseFloat(match[2]) * parseFloat(match[4]),
            pnl: match[5] ? parseFloat(match[5]) : 0,
            timestamp: l.timestamp
          };
        }
        return null;
      })
      .filter(t => t !== null) as Trade[];

    // Generate review report using review engine
    return ReviewEngine.generateReport(activeTrades, candles, activeConfig);
  }

  // Execute manual trades bypassing mathematical indicators
  async executeManualOrder(symbol: string, side: 'BUY' | 'SELL') {
    const price = this.simulator.getCurrentPrice(symbol);
    const balance = await this.broker.getAccountBalance();
    const assetRisk = this.activeRiskConfigs.get(symbol) || Array.from(this.activeRiskConfigs.values())[0];
    
    if (side === 'BUY') {
      const orderValue = Math.min(balance.cash, assetRisk.maxPositionSize);
      if (orderValue < 10) {
        this.log('warn', `Manual BUY in ${symbol} ignored: Insufficient cash balance.`, symbol);
        return;
      }
      const qty = parseFloat((orderValue / price).toFixed(4));
      await this.executeOrder(symbol, 'BUY', qty, price);
    } else {
      const positions = await this.broker.getPositions();
      const activePosition = positions.find(p => p.asset === symbol);
      if (!activePosition || activePosition.quantity <= 0) {
        this.log('warn', `Manual SELL in ${symbol} ignored: No active position.`, symbol);
        return;
      }
      await this.executeOrder(symbol, 'SELL', activePosition.quantity, price);
    }
  }

  // Intercept helper to query the Python Flask/FastAPI ML server for predictions
  private async queryMLPredictor(symbol: string, candles: Candle[]): Promise<'BUY' | 'SELL' | 'HOLD'> {
    try {
      // Send the last 50 candles to fit feature expectations of ML backend
      const recent = candles.slice(-50);
      const res = await fetch('http://localhost:5000/predict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol,
          candles: recent
        })
      });
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}`);
      }
      const data = await res.json();
      return data.prediction || 'HOLD';
    } catch (e: any) {
      console.warn(`[Robot] Python ML Predictor failed: ${e.message}. Defaulting to HOLD.`);
      return 'HOLD';
    }
  }
}
