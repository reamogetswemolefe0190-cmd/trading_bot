import './styles/main.css';
import { Simulator } from './core/Simulator';
import { LocalBroker, AlpacaBroker, IBroker } from './core/Broker';
import { Robot } from './core/Robot';
import { Dashboard } from './ui/Dashboard';
import { ChartManager } from './ui/ChartManager';
import { BrokerConfig, RiskConfig, StrategyConfig, Trade } from './core/Types';
import { SonOfAlton } from './core/SonOfAlton';

// Application State Managers
let simulator: Simulator;
let activeBroker: IBroker;
let localBroker: LocalBroker; // Persists virtual cash across session settings
let robot: Robot;
let dashboard: Dashboard;
let chartManager: ChartManager;
let alton: SonOfAlton;

const allSessionTrades: Trade[] = [];

async function bootstrap() {
  // 1. Initialize core managers
  simulator = new Simulator('BTC/USD');
  localBroker = new LocalBroker(100000); // starts with $100,000 virtual cash
  activeBroker = localBroker;

  // Setup initial default configs
  const defaultStrategy: StrategyConfig = {
    type: 'sma_crossover',
    parameters: {
      smaFastPeriod: 10, smaSlowPeriod: 30,
      rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
      macdFastPeriod: 12, macdSlowPeriod: 26, macdSignalPeriod: 9
    }
  };

  const defaultRisk: RiskConfig = {
    executionMode: 'advisor',
    maxPositionSize: 1000,
    maxPositions: 3,
    dailyStopLossPct: 5,
    positionStopLossPct: 2.0,
    positionTakeProfitPct: 5.0
  };

  // 2. Initialize Robot
  robot = new Robot(simulator, activeBroker, defaultStrategy, defaultRisk);

  // 3. Mount Dashboard UI
  dashboard = new Dashboard('app', simulator);
  dashboard.mount();

  // 4. Initialize Chart Manager
  chartManager = new ChartManager('trading-chart');

  // 5. Connect Robot Events to Dashboard
  robot.onLog(entry => {
    dashboard.addLog(entry);
    if (entry.level === 'ai') {
      dashboard.addAltonLog(entry);
    }
  });

  robot.onTrade(trade => {
    allSessionTrades.unshift(trade); // Add to trade ledger history list
    updateStatsAndChart(true); // force redraw on new trade to place markers
  });

  robot.onUpdate((symbol, isNewCandle) => {
    // Render Watchlist prices and statuses
    const prices = new Map<string, number>();
    const activeBots = new Map<string, boolean>();
    
    Simulator.assets.forEach(asset => {
      prices.set(asset.symbol, simulator.getCurrentPrice(asset.symbol));
      activeBots.set(asset.symbol, robot.getIsRunning());
    });
    
    const activeSymbol = simulator.getAsset().symbol;
    dashboard.renderWatchlist(activeSymbol, prices, activeBots);

    // If tick is for the currently selected chart symbol, update the chart
    if (symbol === activeSymbol) {
      const curPrice = simulator.getCurrentPrice(symbol);
      const candles = simulator.getCandles(symbol);
      if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        chartManager.updateTick(curPrice, lastCandle);
      }
      updateStatsAndChart(isNewCandle); // redraw indicator lines on candle close
    } else {
      // Background symbol update, just refresh stats (portfolio NAV, position counts)
      updateStatsAndChart(false);
    }
  });

  robot.onAdvisor((type: 'BUY' | 'SELL', asset: string, qty: number, price: number, confirm: () => void) => {
    dashboard.showAdvisorModal(type, asset, qty, price, confirm);
  });

  // 6. Connect Dashboard Buttons/Controls to Robot
  dashboard.bindStartStop(async (running) => {
    if (running) {
      try {
        await robot.start();
      } catch (e: any) {
        robot.log('error', `Failed to start robot: ${e.message}`);
      }
    } else {
      robot.stop();
    }
  });

  dashboard.bindKill(async () => {
    await robot.emergencyKill();
    updateStatsAndChart(true);
  });

  dashboard.bindAssetChange(async (symbol) => {
    simulator.setAsset(symbol);
    robot.log('info', `Swapped active chart view to ${symbol}.`);
    
    // Fetch configs of target symbol and update dashboard UI controls
    const strategy = robot.getStrategyConfig(symbol);
    const risk = robot.getRiskConfig(symbol);
    dashboard.setConfigs(strategy, risk, symbol);

    // Redraw chart view
    const history = simulator.getCandles(symbol);
    chartManager.updateData(
      history, 
      allSessionTrades.filter(t => t.asset === symbol),
      strategy.type, 
      strategy.parameters
    );

    updateStatsAndChart(true);
  });

  dashboard.bindConfigChange(async (brokerConfig: BrokerConfig, riskConfig: RiskConfig, strategyConfig: StrategyConfig) => {
    const symbol = simulator.getAsset().symbol;

    // A. Handle Broker Configuration swap
    if (brokerConfig.type === 'simulator') {
      if (activeBroker !== localBroker) {
        activeBroker = localBroker;
        robot.setBroker(activeBroker);
        robot.log('info', 'Swapped broker back to Local Simulator (Virtual).');
      }
    } else {
      if (!brokerConfig.apiKey || !brokerConfig.apiSecret) {
        // Do not attempt authentication until both fields are populated
        return;
      }
      // Initialize Alpaca connection
      robot.log('info', `Connecting to ${brokerConfig.type === 'alpaca-live' ? 'Alpaca Live' : 'Alpaca Paper Sandbox'}...`);
      try {
        const alpaca = new AlpacaBroker(brokerConfig);
        await alpaca.init(); // auth check
        activeBroker = alpaca;
        robot.setBroker(activeBroker);
        robot.log('info', 'Alpaca API connection successfully verified. Ready for execution.');
      } catch (e: any) {
        robot.log('error', `Alpaca Connection Failed: ${e.message}. Please verify your Key ID and Secret.`);
        // Do not force-collapse the inputs, keeping them open for user correction
        activeBroker = localBroker;
        robot.setBroker(activeBroker);
      }
    }

    // B. Save risk controls specifically for the active symbol
    robot.setRiskConfig(symbol, riskConfig);

    // C. Save strategy settings specifically for the active symbol
    robot.setStrategyConfig(symbol, strategyConfig);

    // D. Redraw indicators on chart
    updateStatsAndChart(true);
  });

  dashboard.bindBacktest(async (days) => {
    return await robot.runBacktest(days);
  });

  dashboard.bindGenerateReview(async () => {
    const symbol = simulator.getAsset().symbol;
    return await robot.generateSelfReview(symbol);
  });

  dashboard.bindQuickOrder(async (side) => {
    const symbol = simulator.getAsset().symbol;
    try {
      await robot.executeManualOrder(symbol, side);
      updateStatsAndChart(true);
    } catch (e: any) {
      robot.log('error', `Manual trade execution failed for ${symbol}: ${e.message}`, symbol);
    }
  });

  // 6. Initialize Son of Alton AI Optimizer
  alton = new SonOfAlton(robot, simulator);
  alton.onReport((reports) => {
    dashboard.renderAltonReports(reports);
    const sentiment = alton.getSentimentData();
    dashboard.updateAltonSentiment(sentiment.scores, sentiment.headlines);
  });
  dashboard.bindAltonToggle((enabled) => {
    if (enabled) {
      alton.enable();
    } else {
      alton.disable();
    }
  });

  // 7. Warm up Simulator History for all watchlist assets
  robot.log('info', 'Warm-up: Fetching market history for watchlist assets...');
  for (const asset of Simulator.assets) {
    await simulator.loadHistoricalDataForSymbol(asset.symbol, 60);
  }

  // Draw chart with current symbol history
  const activeSymbol = simulator.getAsset().symbol;
  const initialHistory = simulator.getCandles(activeSymbol);
  chartManager.updateData(initialHistory, allSessionTrades, defaultStrategy.type, defaultStrategy.parameters);
  
  // Sync inputs from localStorage values
  dashboard.triggerConfigChange();

  // Trigger initial UI update
  updateStatsAndChart(true);
  robot.log('info', 'Warm-up complete. Multi-asset engine ready.');
}

let lastStatsFetchTime = 0;

// Aggregates balances/positions from broker and updates dashboard visuals
async function updateStatsAndChart(forceRedraw = false) {
  try {
    const now = Date.now();
    // Only query broker for balance/positions if forced or if 10 seconds have elapsed since last check
    const shouldFetchFromBroker = forceRedraw || (now - lastStatsFetchTime > 10000);

    if (shouldFetchFromBroker) {
      const balance = await activeBroker.getAccountBalance();
      const positions = await activeBroker.getPositions();
      dashboard.updateStats(balance, positions, allSessionTrades);
      lastStatsFetchTime = now;
    }

    // Draw lines/markers on chart
    const symbol = simulator.getAsset().symbol;
    const candles = simulator.getCandles(symbol);
    if (candles.length > 0 && forceRedraw) {
      const config = robot.getStrategyConfig(symbol);
      chartManager.updateData(
        candles, 
        allSessionTrades.filter(t => t.asset === symbol),
        config.type, 
        config.parameters
      );
    }
  } catch (e: any) {
    console.error('Failed to update dashboard stats:', e);
  }
}

// Start application bootstrap
window.addEventListener('DOMContentLoaded', bootstrap);
