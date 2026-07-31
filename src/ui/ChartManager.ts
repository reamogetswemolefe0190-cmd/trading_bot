import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { Candle, Trade } from '../core/Types';
import { Strategies } from '../core/Strategies';

export class ChartManager {
  private container: HTMLElement;
  private chart: IChartApi | null = null;
  private candleSeries: ISeriesApi<'Candlestick'> | null = null;
  private fastSmaSeries: ISeriesApi<'Line'> | null = null;
  private slowSmaSeries: ISeriesApi<'Line'> | null = null;
  
  private markers: any[] = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Chart container element #${containerId} not found.`);
    this.container = el;
    this.initChart();
  }

  private initChart() {
    this.chart = createChart(this.container, {
      width: this.container.clientWidth || 600,
      height: 350, // default solid initial height
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: "'Outfit', sans-serif",
        fontSize: 11
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.02)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.02)' }
      },
      crosshair: {
        mode: 1, // Normal crosshair
        vertLine: {
          color: '#38bdf8',
          width: 1,
          style: 3 // dashed
        },
        horzLine: {
          color: '#38bdf8',
          width: 1,
          style: 3
        }
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true
      },
      rightPriceScale: {
        borderVisible: false,
        alignLabels: true
      }
    });

    // Add candlestick series
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e'
    });

    // Add indicator overlays (Fast & Slow SMA lines)
    this.fastSmaSeries = this.chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      priceLineVisible: false,
      title: 'Fast SMA'
    });

    this.slowSmaSeries = this.chart.addLineSeries({
      color: '#fbbf24',
      lineWidth: 2,
      priceLineVisible: false,
      title: 'Slow SMA'
    });

    // Responsive scaling (prevent 0x0 rendering collapse)
    this.resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || !this.chart) return;
      const { width, height } = entries[0].contentRect;
      if (width > 50 && height > 50) {
        this.chart.resize(width, height);
      }
    });
    this.resizeObserver.observe(this.container);
  }

  // Reloads chart data
  updateData(candles: Candle[], trades: Trade[], strategyType: string, strategyParams: any) {
    if (!this.candleSeries || !this.fastSmaSeries || !this.slowSmaSeries) return;

    // 1. Candlesticks
    this.candleSeries.setData(candles as any);

    // 2. Technical Indicators Overlay
    const closes = candles.map(c => c.close);
    
    if (strategyType === 'sma_crossover') {
      const fast = Strategies.calculateSMA(closes, strategyParams.smaFastPeriod);
      const slow = Strategies.calculateSMA(closes, strategyParams.smaSlowPeriod);

      const fastData = candles.map((c, i) => ({ time: c.time as any, value: fast[i] })).filter(d => !isNaN(d.value));
      const slowData = candles.map((c, i) => ({ time: c.time as any, value: slow[i] })).filter(d => !isNaN(d.value));

      this.fastSmaSeries.setData(fastData as any);
      this.slowSmaSeries.setData(slowData as any);
    } else {
      // Hide lines
      this.fastSmaSeries.setData([]);
      this.slowSmaSeries.setData([]);
    }

    // 3. Trade Markers
    this.markers = [];
    trades.forEach(t => {
      // Find the closest candle timestamp to this trade
      const tradeTimeSec = Math.floor(t.timestamp / 1000);
      const match = candles.find(c => Math.abs(c.time - tradeTimeSec) <= 120); // within 2 minutes matching window

      if (match) {
        this.markers.push({
          time: match.time,
          position: t.type === 'BUY' ? 'belowBar' : 'aboveBar',
          color: t.type === 'BUY' ? '#10b981' : '#f43f5e',
          shape: t.type === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `${t.type} @ $${t.price.toFixed(2)}`
        });
      }
    });

    // Sort markers chronologically (required by lightweight-charts)
    this.markers.sort((a, b) => a.time - b.time);
    this.candleSeries.setMarkers(this.markers);
  }

  // Update chart in real-time with a single tick
  updateTick(_price: number, lastCandle: Candle) {
    if (!this.candleSeries) return;
    this.candleSeries.update(lastCandle as any);
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
  }
}
