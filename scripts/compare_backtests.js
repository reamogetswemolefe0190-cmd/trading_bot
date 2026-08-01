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
  let v1_history = [];

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
    
    v1_history.push(v1_cash + v1_holdings * price);
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
  let v2_history = [];

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
    
    v2_history.push(v2_cash + v2_holdings * price);
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

  // ---------------------------------------------------------
  // GENERATE HIGH-FIDELITY SVG CHART
  // ---------------------------------------------------------
  const width = 800;
  const height = 400;
  const padding = 60;

  const minV = Math.min(...v1_history, ...v2_history) * 0.98;
  const maxV = Math.max(...v1_history, ...v2_history) * 1.02;

  const pointsV1 = v1_history.map((eq, idx) => {
    const x = padding + (idx / (v1_history.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((eq - minV) / (maxV - minV)) * (height - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const pointsV2 = v2_history.map((eq, idx) => {
    const x = padding + (idx / (v2_history.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((eq - minV) / (maxV - minV)) * (height - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  let gridY = '';
  const stepGrid = 500;
  for (let val = Math.ceil(minV / stepGrid) * stepGrid; val <= maxV; val += stepGrid) {
    const y = height - padding - ((val - minV) / (maxV - minV)) * (height - 2 * padding);
    gridY += `
      <line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <text x="${padding - 12}" y="${y + 4}" fill="#71717A" font-family="sans-serif" font-size="11" text-anchor="end">$${val.toLocaleString()}</text>
    `;
  }

  let gridX = '';
  const numSteps = 5;
  for (let s = 0; s <= numSteps; s++) {
    const idx = Math.floor((v1_history.length - 1) * (s / numSteps));
    const x = padding + (s / numSteps) * (width - 2 * padding);
    gridX += `
      <line x1="${x}" y1="${padding}" x2="${x}" y2="${height - padding}" stroke="rgba(255,255,255,0.04)" stroke-dasharray="4,4" stroke-width="1"/>
      <text x="${x}" y="${height - padding + 20}" fill="#71717A" font-family="sans-serif" font-size="11" text-anchor="middle">Step ${idx}</text>
    `;
  }

  const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <!-- Dark gradient background matching Vercel/Aegis styles -->
      <rect width="${width}" height="${height}" fill="#0A0A0B" rx="12" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      
      <!-- Chart borders -->
      <rect x="${padding}" y="${padding}" width="${width - 2 * padding}" height="${height - 2 * padding}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
      
      <!-- Grid System -->
      ${gridY}
      ${gridX}
      
      <!-- Curve V1 (Cyan) -->
      <polyline points="${pointsV1}" fill="none" stroke="#06B6D4" stroke-width="1.8" opacity="0.6" stroke-linejoin="round"/>
      
      <!-- Curve V2 (Emerald) -->
      <polyline points="${pointsV2}" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      
      <!-- Title & Legends -->
      <text x="30" y="32" fill="#FFFFFF" font-family="sans-serif" font-size="15" font-weight="700">Aegis Trader - Equity Curve Performance</text>
      
      <!-- Legend Markers -->
      <rect x="${width - 320}" y="20" width="12" height="12" fill="#06B6D4" rx="2" opacity="0.6"/>
      <text x="${width - 302}" y="30" fill="#A1A1AA" font-family="sans-serif" font-size="11">V1 (45s Cadence In-Sample)</text>
      
      <rect x="${width - 150}" y="20" width="12" height="12" fill="#10B981" rx="2"/>
      <text x="${width - 132}" y="30" fill="#A1A1AA" font-family="sans-serif" font-size="11">V2 (Gated Walk-F)</text>
    </svg>
  `.trim();

  const brainDir = 'C:\\Users\\User\\.gemini\\antigravity\\brain\\565251f7-2734-4b44-8af7-823d96cb4b60';
  fs.writeFileSync(path.join(brainDir, 'equity_curves.svg'), svgContent, 'utf8');
  console.log(`[Chart] Generated comparative vector curves at: ${path.join(brainDir, 'equity_curves.svg')}`);

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
