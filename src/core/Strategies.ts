import { Candle, StrategyConfig } from './Types';

export class Strategies {
  // Helper: Simple Moving Average (SMA)
  static calculateSMA(prices: number[], period: number): number[] {
    const sma: number[] = [];
    for (let i = 0; i < prices.length; i++) {
      if (i < period - 1) {
        sma.push(NaN); // Not enough data
      } else {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += prices[i - j];
        }
        sma.push(sum / period);
      }
    }
    return sma;
  }

  // Helper: Exponential Moving Average (EMA)
  static calculateEMA(prices: number[], period: number): number[] {
    const ema: number[] = [];
    if (prices.length === 0) return ema;

    const k = 2 / (period + 1);
    let emaPrev = prices[0]; // Seed with first close
    ema.push(emaPrev);

    for (let i = 1; i < prices.length; i++) {
      if (i < period - 1) {
        ema.push(NaN);
        if (i === period - 2) {
          // Warm up SMA for the first period
          let sum = 0;
          for (let j = 0; j < period; j++) sum += prices[i - j];
          emaPrev = sum / period;
        }
      } else {
        const val = prices[i] * k + emaPrev * (1 - k);
        ema.push(val);
        emaPrev = val;
      }
    }
    return ema;
  }

  // Helper: Relative Strength Index (RSI)
  static calculateRSI(prices: number[], period: number): number[] {
    const rsi: number[] = [];
    if (prices.length <= period) {
      return Array(prices.length).fill(NaN);
    }

    let gains = 0;
    let losses = 0;

    // First RSI computation
    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) {
        gains += diff;
      } else {
        losses -= diff;
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = 0; i < prices.length; i++) {
      if (i < period) {
        rsi.push(NaN);
      } else if (i === period) {
        const rs = avgGain / (avgLoss === 0 ? 0.00001 : avgLoss);
        rsi.push(100 - 100 / (1 + rs));
      } else {
        const diff = prices[i] - prices[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;

        // Wilder's smoothing technique
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs = avgGain / (avgLoss === 0 ? 0.00001 : avgLoss);
        rsi.push(100 - 100 / (1 + rs));
      }
    }

    return rsi;
  }

  // Helper: Standard Deviation
  static calculateStdDev(prices: number[], sma: number[], period: number): number[] {
    const stdDev: number[] = [];
    for (let i = 0; i < prices.length; i++) {
      if (i < period - 1 || isNaN(sma[i])) {
        stdDev.push(NaN);
      } else {
        let sumSqDiff = 0;
        for (let j = 0; j < period; j++) {
          const diff = prices[i - j] - sma[i];
          sumSqDiff += diff * diff;
        }
        stdDev.push(Math.sqrt(sumSqDiff / period));
      }
    }
    return stdDev;
  }

  // Helper: MACD
  static calculateMACD(
    prices: number[], 
    fastPeriod: number, 
    slowPeriod: number, 
    signalPeriod: number
  ): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
    const len = prices.length;
    const macdLine: number[] = [];
    const signalLine: number[] = [];
    const histogram: number[] = [];

    const fastEma = this.calculateEMA(prices, fastPeriod);
    const slowEma = this.calculateEMA(prices, slowPeriod);

    for (let i = 0; i < len; i++) {
      if (isNaN(fastEma[i]) || isNaN(slowEma[i])) {
        macdLine.push(NaN);
      } else {
        macdLine.push(fastEma[i] - slowEma[i]);
      }
    }

    // Filter out NaN values to run EMA for signal line
    const validMacd: number[] = [];
    const macdStartIndex = macdLine.findIndex(v => !isNaN(v));

    if (macdStartIndex === -1 || macdLine.length - macdStartIndex < signalPeriod) {
      return {
        macdLine: Array(len).fill(NaN),
        signalLine: Array(len).fill(NaN),
        histogram: Array(len).fill(NaN)
      };
    }

    for (let i = macdStartIndex; i < len; i++) {
      validMacd.push(macdLine[i]);
    }

    const validSignal = this.calculateEMA(validMacd, signalPeriod);
    
    // Align back to original prices array length
    for (let i = 0; i < len; i++) {
      if (i < macdStartIndex + signalPeriod - 1) {
        signalLine.push(NaN);
        histogram.push(NaN);
      } else {
        const sigIndex = i - macdStartIndex;
        signalLine.push(validSignal[sigIndex]);
        histogram.push(macdLine[i] - validSignal[sigIndex]);
      }
    }

    return { macdLine, signalLine, histogram };
  }

  // Strategy Execution Entry
  static evaluate(candles: Candle[], config: StrategyConfig): 'BUY' | 'SELL' | 'HOLD' {
    if (candles.length < 3) return 'HOLD';
    const closes = candles.map(c => c.close);
    const len = closes.length;

    switch (config.type) {
      case 'sma_crossover': {
        const { smaFastPeriod, smaSlowPeriod } = config.parameters;
        if (len < smaSlowPeriod + 2) return 'HOLD';

        const fastSma = this.calculateSMA(closes, smaFastPeriod);
        const slowSma = this.calculateSMA(closes, smaSlowPeriod);

        const curFast = fastSma[len - 1];
        const prevFast = fastSma[len - 2];
        const curSlow = slowSma[len - 1];
        const prevSlow = slowSma[len - 2];

        if (isNaN(curFast) || isNaN(curSlow) || isNaN(prevFast) || isNaN(prevSlow)) return 'HOLD';

        // Fast crosses ABOVE Slow -> Buy
        if (prevFast <= prevSlow && curFast > curSlow) {
          return 'BUY';
        }
        // Fast crosses BELOW Slow -> Sell
        if (prevFast >= prevSlow && curFast < curSlow) {
          return 'SELL';
        }
        return 'HOLD';
      }

      case 'rsi_mean_reversion': {
        const { rsiPeriod, rsiOversold, rsiOverbought } = config.parameters;
        if (len < rsiPeriod + 2) return 'HOLD';

        const rsi = this.calculateRSI(closes, rsiPeriod);
        const curRsi = rsi[len - 1];
        const prevRsi = rsi[len - 2];

        if (isNaN(curRsi) || isNaN(prevRsi)) return 'HOLD';

        // RSI crosses above oversold line -> Buy
        if (prevRsi <= rsiOversold && curRsi > rsiOversold) {
          return 'BUY';
        }
        // RSI crosses below overbought line -> Sell
        if (prevRsi >= rsiOverbought && curRsi < rsiOverbought) {
          return 'SELL';
        }
        return 'HOLD';
      }

      case 'macd': {
        const { macdFastPeriod, macdSlowPeriod, macdSignalPeriod } = config.parameters;
        if (len < macdSlowPeriod + macdSignalPeriod + 2) return 'HOLD';

        const { macdLine, signalLine } = this.calculateMACD(closes, macdFastPeriod, macdSlowPeriod, macdSignalPeriod);
        const curMacd = macdLine[len - 1];
        const prevMacd = macdLine[len - 2];
        const curSignal = signalLine[len - 1];
        const prevSignal = signalLine[len - 2];

        if (isNaN(curMacd) || isNaN(curSignal) || isNaN(prevMacd) || isNaN(prevSignal)) return 'HOLD';

        // MACD crosses above Signal Line -> Buy
        if (prevMacd <= prevSignal && curMacd > curSignal) {
          return 'BUY';
        }
        // MACD crosses below Signal Line -> Sell
        if (prevMacd >= prevSignal && curMacd < curSignal) {
          return 'SELL';
        }
        return 'HOLD';
      }

      case 'bollinger_bands': {
        const bbPeriod = config.parameters.bbPeriod || 20;
        const bbMultiplier = config.parameters.bbMultiplier || 2.0;
        if (len < bbPeriod + 2) return 'HOLD';

        const sma = this.calculateSMA(closes, bbPeriod);
        const stdDev = this.calculateStdDev(closes, sma, bbPeriod);

        const curClose = closes[len - 1];
        const prevClose = closes[len - 2];
        const curSma = sma[len - 1];
        const curStd = stdDev[len - 1];

        if (isNaN(curSma) || isNaN(curStd)) return 'HOLD';

        const upperBand = curSma + bbMultiplier * curStd;
        const lowerBand = curSma - bbMultiplier * curStd;

        // Buy if price drops below lower band (oversold rebound expected)
        if (prevClose >= lowerBand && curClose < lowerBand) {
          return 'BUY';
        }
        // Sell if price spikes above upper band (overbought correction expected)
        if (prevClose <= upperBand && curClose > upperBand) {
          return 'SELL';
        }
        return 'HOLD';
      }

      default:
        return 'HOLD';
    }
  }
}
