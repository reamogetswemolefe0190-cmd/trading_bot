import { Candle, AssetInfo } from './Types';

export type SimulatorMode = 'live' | 'backtest';

export class Simulator {
  private mode: SimulatorMode = 'live';
  private currentAsset: AssetInfo;
  
  // Multi-asset state maps
  private activePriceMap: Map<string, number> = new Map();
  private activeCandlesMap: Map<string, Candle[]> = new Map();
  private activeCurrentCandleMap: Map<string, Candle> = new Map();
  
  // Replay variables (for single asset backtesting)
  private backtestData: Candle[] = [];
  private backtestIndex: number = 0;
  
  // Live simulation tick intervals
  private tickIntervalId: any = null;
  private updateIntervalMs: number = 1000; // Tick rate
  
  // Callbacks: now passes symbol name
  private onTickCallback: ((symbol: string, price: number, candle: Candle, isNewCandle: boolean) => void) | null = null;

  // Active assets configuration
  public static assets: AssetInfo[] = [
    { symbol: 'BTC/USD', name: 'Bitcoin / US Dollar', type: 'crypto', defaultPrice: 65000, volatility: 0.015, drift: 0.0001 },
    { symbol: 'ETH/USD', name: 'Ethereum / US Dollar', type: 'crypto', defaultPrice: 3400, volatility: 0.02, drift: 0.0001 },
    { symbol: 'SOL/USD', name: 'Solana / US Dollar', type: 'crypto', defaultPrice: 150, volatility: 0.03, drift: 0.0002 },
    { symbol: 'DOGE/USD', name: 'Dogecoin / US Dollar', type: 'crypto', defaultPrice: 0.12, volatility: 0.045, drift: -0.0001 },
    { symbol: 'LTC/USD', name: 'Litecoin / US Dollar', type: 'crypto', defaultPrice: 80, volatility: 0.022, drift: 0.00005 },
    { symbol: 'AAPL', name: 'Apple Inc. Common Stock', type: 'stock', defaultPrice: 180, volatility: 0.008, drift: 0.0002 },
    { symbol: 'TSLA', name: 'Tesla Inc. Common Stock', type: 'stock', defaultPrice: 220, volatility: 0.025, drift: -0.0001 },
    { symbol: 'NVDA', name: 'Nvidia Inc. Common Stock', type: 'stock', defaultPrice: 120, volatility: 0.028, drift: 0.0003 },
    { symbol: 'MSFT', name: 'Microsoft Corp. Common Stock', type: 'stock', defaultPrice: 420, volatility: 0.009, drift: 0.00015 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. Common Stock', type: 'stock', defaultPrice: 175, volatility: 0.01, drift: 0.0002 }
  ];

  constructor(defaultAssetSymbol: string = 'BTC/USD') {
    this.currentAsset = Simulator.assets.find(a => a.symbol === defaultAssetSymbol) || Simulator.assets[0];
    
    // Initialize price maps with defaults
    Simulator.assets.forEach(asset => {
      this.activePriceMap.set(asset.symbol, asset.defaultPrice);
      this.activeCandlesMap.set(asset.symbol, []);
    });
  }

  setAsset(symbol: string) {
    const asset = Simulator.assets.find(a => a.symbol === symbol);
    if (asset) {
      this.currentAsset = asset;
      this.backtestData = [];
      this.backtestIndex = 0;
    }
  }

  getAsset(): AssetInfo {
    return this.currentAsset;
  }

  getCurrentPrice(symbol: string = this.currentAsset.symbol): number {
    return this.activePriceMap.get(symbol) || 0;
  }

  getCandles(symbol: string = this.currentAsset.symbol): Candle[] {
    return this.activeCandlesMap.get(symbol) || [];
  }

  getMode(): SimulatorMode {
    return this.mode;
  }

  onTick(callback: (symbol: string, price: number, candle: Candle, isNewCandle: boolean) => void) {
    this.onTickCallback = callback;
  }

  // Load historical data for active symbol
  async loadHistoricalData(days: number = 150): Promise<Candle[]> {
    return this.loadHistoricalDataForSymbol(this.currentAsset.symbol, days);
  }

  // Load historical data from API (or generate deterministic mock data if API fails)
  async loadHistoricalDataForSymbol(symbol: string, days: number = 150): Promise<Candle[]> {
    const asset = Simulator.assets.find(a => a.symbol === symbol) || this.currentAsset;
    let candlesList: Candle[] = [];

    // For cryptos, fetch from CryptoCompare
    if (asset.type === 'crypto') {
      try {
        const coin = symbol.split('/')[0]; // e.g. BTC
        const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${coin}&tsym=USD&limit=${days}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const json = await response.json();
        
        if (json.Response === 'Success' && json.Data && json.Data.Data) {
          const rawCandles = json.Data.Data;
          candlesList = rawCandles.map((c: any) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volumeto || c.volumefrom
          }));
        }
      } catch (e) {
        console.warn(`Failed to fetch ${symbol} from CryptoCompare API, falling back to synthetic generator...`, e);
      }
    }

    // Fallback/stocks: generate synthetic data if list remains empty
    if (candlesList.length === 0) {
      candlesList = this.generateSyntheticHistoryForAsset(asset, days);
    }

    // Cache results in internal state maps so they are immediately queryable
    this.activeCandlesMap.set(symbol, [...candlesList]);
    if (candlesList.length > 0) {
      this.activePriceMap.set(symbol, candlesList[candlesList.length - 1].close);
    }

    return candlesList;
  }

  private generateSyntheticHistoryForAsset(asset: AssetInfo, days: number): Candle[] {
    const data: Candle[] = [];
    let price = asset.defaultPrice;
    let time = Math.floor(Date.now() / 1000) - days * 24 * 3600;
    const vol = asset.volatility;
    const drift = asset.drift;

    for (let i = 0; i < days; i++) {
      const open = price;
      // Geometric Brownian Motion step
      const dailyChange = price * (drift + vol * this.boxMullerRandom());
      const close = price + dailyChange;
      const high = Math.max(open, close) + Math.abs(price * vol * 0.5 * Math.random());
      const low = Math.min(open, close) - Math.abs(price * vol * 0.5 * Math.random());
      const volume = 500000 + Math.random() * 1000000;

      data.push({
        time,
        open,
        high,
        low,
        close,
        volume
      });

      price = close;
      time += 24 * 3600;
    }
    return data;
  }

  // Gaussian noise helper (Box-Muller transform)
  private boxMullerRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // Starts the simulator (mode: 'live' runs tick updates, 'backtest' can be manually stepped/run)
  start(mode: SimulatorMode = 'live', tickRateMs: number = 1000) {
    this.stop();
    this.mode = mode;
    this.updateIntervalMs = tickRateMs;

    if (mode === 'live') {
      // Warm up all assets with historical data first in parallel
      const promises = Simulator.assets.map(async (asset) => {
        const history = await this.loadHistoricalDataForSymbol(asset.symbol, 60);
        this.activeCandlesMap.set(asset.symbol, [...history]);
        if (history.length > 0) {
          this.activePriceMap.set(asset.symbol, history[history.length - 1].close);
        } else {
          this.activePriceMap.set(asset.symbol, asset.defaultPrice);
        }
        
        // Initialize live candle anchor
        this.activeCurrentCandleMap.set(asset.symbol, this.createNewLiveCandleForSymbol(asset.symbol));
      });

      Promise.all(promises).then(() => {
        // Start live ticking for all assets on the interval loop
        this.tickIntervalId = setInterval(() => {
          this.tickLiveAll();
        }, this.updateIntervalMs);
      });
    } else {
      // Backtest mode (single selected asset)
      this.loadHistoricalData(180).then(history => {
        this.backtestData = history;
        this.activeCandlesMap.set(this.currentAsset.symbol, []);
        this.backtestIndex = 0;
      });
    }
  }

  stop() {
    if (this.tickIntervalId) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
    }
  }

  private createNewLiveCandleForSymbol(symbol: string): Candle {
    const time = Math.floor(Date.now() / 1000);
    const price = this.getCurrentPrice(symbol);
    return {
      time,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0
    };
  }

  // Tick generator step (runs in parallel for all symbols in live mode)
  private tickLiveAll() {
    Simulator.assets.forEach(asset => {
      const symbol = asset.symbol;
      let currentPrice = this.getCurrentPrice(symbol);
      let currentCandle = this.activeCurrentCandleMap.get(symbol);
      if (!currentCandle) {
        currentCandle = this.createNewLiveCandleForSymbol(symbol);
        this.activeCurrentCandleMap.set(symbol, currentCandle);
      }

      const vol = asset.volatility / 10; // lower volatility for seconds-ticks
      const drift = asset.drift / 10;
      
      // GBM formula
      const change = currentPrice * (drift + vol * this.boxMullerRandom());
      currentPrice += change;
      this.activePriceMap.set(symbol, currentPrice);
      
      // Update active candle
      currentCandle.close = currentPrice;
      currentCandle.high = Math.max(currentCandle.high, currentPrice);
      currentCandle.low = Math.min(currentCandle.low, currentPrice);
      currentCandle.volume += Math.random() * 100;

      const timeDiff = Math.floor(Date.now() / 1000) - currentCandle.time;
      // Form a new candle every 15 seconds (accelerated live simulation)
      const isNewCandle = timeDiff >= 15;

      if (this.onTickCallback) {
        this.onTickCallback(symbol, currentPrice, { ...currentCandle }, isNewCandle);
      }

      if (isNewCandle) {
        const candles = this.activeCandlesMap.get(symbol) || [];
        candles.push({ ...currentCandle });
        // Remove oldest candle to limit size in browser memory
        if (candles.length > 500) candles.shift();
        this.activeCandlesMap.set(symbol, candles);
        
        // Reset active candle anchor
        const newCandle = {
          time: Math.floor(Date.now() / 1000),
          open: currentPrice,
          high: currentPrice,
          low: currentPrice,
          close: currentPrice,
          volume: 0
        };
        this.activeCurrentCandleMap.set(symbol, newCandle);
      }
    });
  }

  // Steps one day forward in historical backtest data (single asset)
  stepBacktest(): boolean {
    const symbol = this.currentAsset.symbol;
    if (this.backtestIndex >= this.backtestData.length) {
      return false; // Backtest finished
    }

    const nextCandle = this.backtestData[this.backtestIndex];
    const price = nextCandle.close;
    this.activePriceMap.set(symbol, price);
    
    const candles = this.activeCandlesMap.get(symbol) || [];
    candles.push(nextCandle);
    this.activeCandlesMap.set(symbol, candles);
    this.backtestIndex++;

    if (this.onTickCallback) {
      this.onTickCallback(symbol, price, nextCandle, true);
    }
    return true;
  }

  getBacktestData(): Candle[] {
    return this.backtestData;
  }
}
