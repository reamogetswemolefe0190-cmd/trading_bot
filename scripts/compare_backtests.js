import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SMA Calculations
function getSMA(prices, period) {
  if (prices.length < period) return 0;
  let sum = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    sum += prices[i];
  }
  return sum / period;
}

// Generate buy/sell signals based on SMA Crossover
function getSignal(candles, fastPeriod, slowPeriod) {
  const prices = candles.map(c => c.close);
  if (prices.length < slowPeriod + 1) return 'HOLD';
  
  const curFast = getSMA(prices, fastPeriod);
  const curSlow = getSMA(prices, slowPeriod);
  const prevPrices = prices.slice(0, -1);
  const prevFast = getSMA(prevPrices, fastPeriod);
  const prevSlow = getSMA(prevPrices, slowPeriod);
  
  if (prevFast <= prevSlow && curFast > curSlow) return 'BUY';
  if (prevFast >= prevSlow && curFast < curSlow) return 'SELL';
  return 'HOLD';
}

// Mock backtest returning final equity and trade count (net of 0.1% fees)
function runMockBacktest(candles, fast, slow) {
  let cash = 10000;
  let holdings = 0;
  let tradeCount = 0;
  
  for (let i = 15; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const signal = getSignal(slice, fast, slow);
    const price = candles[i].close;
    
    if (signal === 'BUY' && holdings === 0) {
      const commission = cash * 0.001;
      holdings = (cash - commission) / price;
      cash = 0;
      tradeCount++;
    } else if (signal === 'SELL' && holdings > 0) {
      const value = holdings * price;
      const commission = value * 0.001;
      cash = value - commission;
      holdings = 0;
      tradeCount++;
    }
  }
  const finalPrice = candles[candles.length - 1].close;
  return {
    equity: cash + holdings * finalPrice,
    tradeCount
  };
}

// Run Grid-Search Parameter Optimization
function optimizeParameters(candles) {
  const fastOptions = [5, 10, 15, 20];
  const slowOptions = [20, 30, 45, 60];
  let bestEquity = 0;
  let bestParams = { fast: 10, slow: 30 };
  
  fastOptions.forEach(fast => {
    slowOptions.forEach(slow => {
      if (fast >= slow) return;
      const res = runMockBacktest(candles, fast, slow);
      if (res.equity > bestEquity) {
        bestEquity = res.equity;
        bestParams = { fast, slow };
      }
    });
  });
  
  return bestParams;
}

// Main execution function
async function main() {
  console.log("==================================================================");
  console.log("   AEGIS TRADER - QUANTITATIVE ALTON V1 VS V2 BACKTEST HARNESS   ");
  console.log("==================================================================");

  let candles = [];
  const filepath = path.join(__dirname, '../data/history/BTC_USD_history.json');

  if (fs.existsSync(filepath)) {
    try {
      candles = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      console.log(`[Data] Successfully loaded ${candles.length} historical candles for BTC/USD.`);
    } catch (e) {
      console.warn("[Data] Failed to parse history file, generating synthetic data instead.");
    }
  }

  if (candles.length < 200) {
    console.log("[Data] Generating synthetic trend history (500 daily candles)...");
    let price = 50000;
    let time = Math.floor(Date.now() / 1000) - 500 * 24 * 3600;
    
    // Generate synthetic trend with random walk noise
    for (let i = 0; i < 500; i++) {
      const change = price * (0.0003 + 0.018 * (Math.random() - 0.49)); // positive drift
      price += change;
      candles.push({
        time,
        open: price - change,
        high: price + Math.abs(price * 0.01 * Math.random()),
        low: price - Math.abs(price * 0.01 * Math.random()),
        close: price,
        volume: 1000000
      });
      time += 24 * 3600;
    }
  }

  // ---------------------------------------------------------
  // SIMULATION V1: 45-Second Cadence (Every Candle Check, In-Sample Swap)
  // ---------------------------------------------------------
  let v1_cash = 10000;
  let v1_holdings = 0;
  let v1_swaps = 0;
  let v1_fast = 10;
  let v1_slow = 30;
  let v1_trades = 0;
  let v1_wins = 0;
  let v1_entry = 0;

  for (let i = 120; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const recent60 = candles.slice(i - 60, i);
    const price = candles[i].close;

    // V1 audits every single step
    const opt = optimizeParameters(recent60);
    if (opt.fast !== v1_fast || opt.slow !== v1_slow) {
      v1_fast = opt.fast;
      v1_slow = opt.slow;
      v1_swaps++;
    }

    const signal = getSignal(slice, v1_fast, v1_slow);
    if (signal === 'BUY' && v1_holdings === 0) {
      const commission = v1_cash * 0.001;
      v1_holdings = (v1_cash - commission) / price;
      v1_cash = 0;
      v1_entry = price;
    } else if (signal === 'SELL' && v1_holdings > 0) {
      const value = v1_holdings * price;
      const commission = value * 0.001;
      v1_cash = value - commission;
      v1_holdings = 0;
      v1_trades++;
      if (price > v1_entry) v1_wins++;
    }
  }
  const v1_final_equity = v1_cash + v1_holdings * candles[candles.length - 1].close;

  // ---------------------------------------------------------
  // SIMULATION V2: Validation Gated (Every 4 Ticks Check, Out-of-Sample Gate)
  // ---------------------------------------------------------
  let v2_cash = 10000;
  let v2_holdings = 0;
  let v2_swaps = 0;
  let v2_fast = 10;
  let v2_slow = 30;
  let v2_trades = 0;
  let v2_wins = 0;
  let v2_entry = 0;

  for (let i = 120; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const price = candles[i].close;

    // V2 checks optimizer only on interval (simulated 4-period check)
    if (i % 4 === 0) {
      const recentWindow = candles.slice(i - 60, i);
      
      // Dynamic Volatility split
      let sumChanges = 0;
      for (let j = recentWindow.length - 10; j < recentWindow.length; j++) {
        if (j > 0) {
          sumChanges += Math.abs(recentWindow[j].close - recentWindow[j-1].close) / recentWindow[j-1].close;
        }
      }
      const vol = (sumChanges / 10) * 100;
      const oosRatio = 0.20 + Math.min(0.20, vol * 0.15);
      const oosCount = Math.floor(recentWindow.length * oosRatio);
      const inSampleCount = recentWindow.length - oosCount;
      
      const inSample = recentWindow.slice(0, inSampleCount);
      const outOfSample = recentWindow.slice(inSampleCount);
      
      const candidate = optimizeParameters(inSample);
      
      if (candidate.fast !== v2_fast || candidate.slow !== v2_slow) {
        // Validate candidate vs active
        const curInSample = runMockBacktest(inSample, v2_fast, v2_slow).equity;
        const candInSample = runMockBacktest(inSample, candidate.fast, candidate.slow).equity;
        
        const curOos = runMockBacktest(outOfSample, v2_fast, v2_slow);
        const candOos = runMockBacktest(outOfSample, candidate.fast, candidate.slow);
        
        // Out of Sample Validation Gate!
        if (candInSample > curInSample && candOos.equity > curOos.equity && candOos.tradeCount >= 2) {
          v2_fast = candidate.fast;
          v2_slow = candidate.slow;
          v2_swaps++;
        }
      }
    }

    const signal = getSignal(slice, v2_fast, v2_slow);
    if (signal === 'BUY' && v2_holdings === 0) {
      const commission = v2_cash * 0.001;
      v2_holdings = (v2_cash - commission) / price;
      v2_cash = 0;
      v2_entry = price;
    } else if (signal === 'SELL' && v2_holdings > 0) {
      const value = v2_holdings * price;
      const commission = value * 0.001;
      v2_cash = value - commission;
      v2_holdings = 0;
      v2_trades++;
      if (price > v2_entry) v2_wins++;
    }
  }
  const v2_final_equity = v2_cash + v2_holdings * candles[candles.length - 1].close;

  // ---------------------------------------------------------
  // COMPILE RESULTS TABLE
  // ---------------------------------------------------------
  const v1_return = ((v1_final_equity - 10000) / 10000) * 100;
  const v2_return = ((v2_final_equity - 10000) / 10000) * 100;
  const v1_winrate = v1_trades === 0 ? 0 : (v1_wins / v1_trades) * 100;
  const v2_winrate = v2_trades === 0 ? 0 : (v2_wins / v2_trades) * 100;

  console.log("\n+------------------------------+--------------------+--------------------+");
  console.log("| Performance Metric           | V1 (45s In-Sample) | V2 (Gated Walk-F)  |");
  console.log("+------------------------------+--------------------+--------------------+");
  console.log(`| Initial Capital              | $10,000.00         | $10,000.00         |`);
  console.log(`| Final Portfolio Value        | $${v1_final_equity.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}         | $${v2_final_equity.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}         |`);
  console.log(`| Net Return (%)               | ${v1_return >= 0 ? '+' : ''}${v1_return.toFixed(2)}%             | ${v2_return >= 0 ? '+' : ''}${v2_return.toFixed(2)}%             |`);
  console.log(`| Total Executed Trades        | ${v1_trades}                  | ${v2_trades}                  |`);
  console.log(`| Strategy Win Rate (%)        | ${v1_winrate.toFixed(1)}%              | ${v2_winrate.toFixed(1)}%              |`);
  console.log(`| Parameter Swaps Triggered    | ${v1_swaps}                 | ${v2_swaps}                  |`);
  console.log("+------------------------------+--------------------+--------------------+");

  console.log("\n[Conclusion]");
  if (v2_final_equity > v1_final_equity) {
    console.log("👉 V2 (Validation Gated) outperformed V1. Slowing down parameter changes and verifying");
    console.log("   out-of-sample data mitigated overfitting/churning, leading to superior net returns.");
  } else {
    console.log("👉 V1 (Continuous Optimization) yielded higher nominal return on this specific sample,");
    console.log("   but experienced higher transaction friction (parameter swaps). Verify multi-asset variance.");
  }
  console.log("==================================================================\n");
}

main().catch(err => console.error("Error in comparative harness:", err));
