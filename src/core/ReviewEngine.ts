import { Trade, Candle, StrategyConfig, PerformanceReview } from './Types';
import { Strategies } from './Strategies';

export class ReviewEngine {
  // Analyze a set of trades executed by the user/bot
  static analyzeTrades(trades: Trade[]): {
    winRate: number;
    totalTrades: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
  } {
    const sells = trades.filter(t => t.type === 'SELL');
    const totalTrades = sells.length;
    if (totalTrades === 0) {
      return { winRate: 0, totalTrades: 0, profitFactor: 0, avgWin: 0, avgLoss: 0 };
    }

    let winsCount = 0;
    let totalWinsValue = 0;
    let totalLossesValue = 0;
    let lossesCount = 0;

    sells.forEach(t => {
      const pnl = t.pnl || 0;
      if (pnl > 0) {
        winsCount++;
        totalWinsValue += pnl;
      } else {
        lossesCount++;
        totalLossesValue += Math.abs(pnl);
      }
    });

    const winRate = (winsCount / totalTrades) * 100;
    const profitFactor = totalLossesValue === 0 ? totalWinsValue : totalWinsValue / totalLossesValue;
    const avgWin = winsCount === 0 ? 0 : totalWinsValue / winsCount;
    const avgLoss = lossesCount === 0 ? 0 : totalLossesValue / lossesCount;

    return {
      winRate,
      totalTrades,
      profitFactor,
      avgWin,
      avgLoss
    };
  }

  // Runs a grid-search optimizer across historical data to recommend parameters
  static optimizeParameters(
    candles: Candle[],
    currentConfig: StrategyConfig
  ): { optimalParams: Record<string, number>; recommendationText: string } {
    if (candles.length < 50) {
      return {
        optimalParams: {},
        recommendationText: 'Insufficient historical data to run parameters optimization. Accumulate more data first.'
      };
    }

    const type = currentConfig.type;
    let bestEquity = 0;
    let bestParams: Record<string, number> = {};
    const initialEquity = 10000;

    if (type === 'sma_crossover') {
      const fastOptions = [5, 10, 15, 20];
      const slowOptions = [20, 30, 45, 60];

      fastOptions.forEach(fast => {
        slowOptions.forEach(slow => {
          if (fast >= slow) return;
          const finalEquity = this.runMockBacktest(candles, initialEquity, {
            type: 'sma_crossover',
            parameters: {
              ...currentConfig.parameters,
              smaFastPeriod: fast,
              smaSlowPeriod: slow
            }
          });
          if (finalEquity > bestEquity) {
            bestEquity = finalEquity;
            bestParams = { smaFastPeriod: fast, smaSlowPeriod: slow };
          }
        });
      });
    } else if (type === 'rsi_mean_reversion') {
      const periods = [9, 14, 21];
      const oversolds = [25, 30, 35];
      const overboughts = [65, 70, 75];

      periods.forEach(p => {
        oversolds.forEach(os => {
          overboughts.forEach(ob => {
            const finalEquity = this.runMockBacktest(candles, initialEquity, {
              type: 'rsi_mean_reversion',
              parameters: {
                ...currentConfig.parameters,
                rsiPeriod: p,
                rsiOversold: os,
                rsiOverbought: ob
              }
            });
            if (finalEquity > bestEquity) {
              bestEquity = finalEquity;
              bestParams = { rsiPeriod: p, rsiOversold: os, rsiOverbought: ob };
            }
          });
        });
      });
    } else if (type === 'macd') {
      const fasts = [8, 12, 15];
      const slows = [22, 26, 30];
      const signals = [7, 9, 11];

      fasts.forEach(f => {
        slows.forEach(sl => {
          signals.forEach(sig => {
            if (f >= sl) return;
            const finalEquity = this.runMockBacktest(candles, initialEquity, {
              type: 'macd',
              parameters: {
                ...currentConfig.parameters,
                macdFastPeriod: f,
                macdSlowPeriod: sl,
                macdSignalPeriod: sig
              }
            });
            if (finalEquity > bestEquity) {
              bestEquity = finalEquity;
              bestParams = { macdFastPeriod: f, macdSlowPeriod: sl, macdSignalPeriod: sig };
            }
          });
        });
      });
    }

    const currentEquity = this.runMockBacktest(candles, initialEquity, currentConfig);
    const improvementPct = currentEquity === 0 ? 0 : ((bestEquity - currentEquity) / currentEquity) * 100;
    
    let recommendationText = '';
    if (improvementPct > 2.0) {
      recommendationText = `We simulated alternative parameter settings over the last ${candles.length} candles. Changing your active parameters to the recommended ones would have improved backtest returns by ${improvementPct.toFixed(1)}% (Portfolio equity: $${bestEquity.toFixed(2)} vs $${currentEquity.toFixed(2)}).`;
    } else {
      recommendationText = `Your current strategy parameters are highly optimal. Alternative configuration search yielded no significant improvements (less than 2% edge). Maintain current settings.`;
    }

    return {
      optimalParams: bestParams,
      recommendationText
    };
  }

  // Fast backtester helper that simulates a simple strategy on historical data
  private static runMockBacktest(candles: Candle[], initialEquity: number, config: StrategyConfig): number {
    let cash = initialEquity;
    let holdings = 0;

    for (let i = 15; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const signal = Strategies.evaluate(slice, config);
      const price = candles[i].close;

      if (signal === 'BUY' && holdings === 0) {
        // Buy full allocation (simplified)
        const commission = cash * 0.001;
        const deployable = cash - commission;
        holdings = deployable / price;
        cash = 0;
      } else if (signal === 'SELL' && holdings > 0) {
        // Sell everything
        const value = holdings * price;
        const commission = value * 0.001;
        cash = value - commission;
        holdings = 0;
      }
    }

    const finalPrice = candles[candles.length - 1].close;
    return cash + holdings * finalPrice;
  }

  // Creates the final review report card
  static generateReport(
    trades: Trade[],
    candles: Candle[],
    currentConfig: StrategyConfig
  ): PerformanceReview {
    const stats = this.analyzeTrades(trades);
    const optimization = this.optimizeParameters(candles, currentConfig);
    
    const recommendations: string[] = [];

    // Rule 1: High drawdown / Low winrate checks
    if (stats.totalTrades > 3) {
      if (stats.winRate < 40) {
        recommendations.push('Warning: Win rate is below 40%. Consider increasing technical indicator confirmation (e.g. higher RSI thresholds or slower SMA combinations) to filter out noise.');
      } else if (stats.winRate > 65) {
        recommendations.push('Excellent! Win rate is above 65%. You are picking trades with high hit rates.');
      }

      if (stats.profitFactor < 1.0) {
        recommendations.push('Critical: Profit Factor is below 1.0, meaning your losses outweigh your wins. Check your average trade risk sizing and consider enabling Advisor manual confirmation to check chart patterns before execution.');
      } else if (stats.profitFactor > 1.8) {
        recommendations.push('Superb: Profit factor is above 1.8. The current strategy holds a strong mathematical edge under active market conditions.');
      }
    } else {
      recommendations.push('Accumulate at least 3 completed trade pairs to unlock detailed risk-adjusted performance metrics.');
    }

    // Include the parameter optimization recommendations
    recommendations.push(optimization.recommendationText);

    return {
      ...stats,
      recommendations,
      optimalParams: optimization.optimalParams
    };
  }
}
