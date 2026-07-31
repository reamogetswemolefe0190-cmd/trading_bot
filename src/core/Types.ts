export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type OrderType = 'BUY' | 'SELL';

export interface Trade {
  id: string;
  type: OrderType | 'LIQUIDATE';
  asset: string;
  price: number;
  quantity: number;
  cost: number;
  timestamp: number;
  pnl?: number; // Realized PnL (only relevant for sells)
}

export interface Position {
  asset: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
}

export type BrokerType = 'simulator' | 'alpaca-paper' | 'alpaca-live';

export interface BrokerConfig {
  type: BrokerType;
  apiKey: string;
  apiSecret: string;
}

export type StrategyType = 'sma_crossover' | 'rsi_mean_reversion' | 'macd' | 'bollinger_bands' | 'ml_predict';

export interface StrategyConfig {
  type: StrategyType;
  parameters: {
    // SMA
    smaFastPeriod: number;
    smaSlowPeriod: number;
    // RSI
    rsiPeriod: number;
    rsiOversold: number;
    rsiOverbought: number;
    // MACD
    macdFastPeriod: number;
    macdSlowPeriod: number;
    macdSignalPeriod: number;
    // Bollinger Bands
    bbPeriod?: number;
    bbMultiplier?: number;
  };
}

export type ExecutionMode = 'advisor' | 'autopilot';

export interface RiskConfig {
  maxPositionSize: number; // Max USD spent per trade
  maxPositions: number; // Max active positions allowed
  dailyStopLossPct: number; // Max percentage loss per day before trading stops
  positionStopLossPct: number; // Individual position Stop Loss %
  positionTakeProfitPct: number; // Individual position Take Profit %
  executionMode: ExecutionMode;
}

export interface BacktestReport {
  initialEquity: number;
  endingEquity: number;
  netProfit: number;
  netProfitPct: number;
  totalTrades: number;
  winRate: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
}

export interface PerformanceReview {
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  recommendations: string[];
  optimalParams?: Record<string, number>;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'buy' | 'sell' | 'warn' | 'error' | 'ai';
  message: string;
  asset?: string;
}

export interface SonOfAltonReport {
  timestamp: number;
  reportMarkdown: string;
}

export interface AssetInfo {
  symbol: string;
  name: string;
  type: 'crypto' | 'stock';
  defaultPrice: number;
  volatility: number; // For simulator
  drift: number; // For simulator
}
