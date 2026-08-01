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

function runMockBacktest(candles, fast, slow) {
  let cash = 10000;
  let holdings = 0;
  for (let i = 15; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const signal = getSignal(slice, fast, slow);
    const price = candles[i].close;
    if (signal === 'BUY' && holdings === 0) {
      holdings = (cash - cash * 0.001) / price;
      cash = 0;
    } else if (signal === 'SELL' && holdings > 0) {
      cash = (holdings * price) - (holdings * price * 0.001);
      holdings = 0;
    }
  }
  return cash + holdings * candles[candles.length - 1].close;
}

function optimizeParameters(candles) {
  const fastOptions = [5, 10, 15, 20];
  const slowOptions = [20, 30, 45, 60];
  let bestEquity = 0;
  let bestParams = { fast: 10, slow: 30 };
  fastOptions.forEach(fast => {
    slowOptions.forEach(slow => {
      if (fast >= slow) return;
      const eq = runMockBacktest(candles, fast, slow);
      if (eq > bestEquity) {
        bestEquity = eq;
        bestParams = { fast, slow };
      }
    });
  });
  return bestParams;
}

async function main() {
  let candles = [];
  const filepath = path.join(__dirname, '../data/history/BTC_USD_history.json');
  if (fs.existsSync(filepath)) {
    candles = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }
  
  if (candles.length < 200) {
    // Generate identical synthetic trend
    let price = 50000;
    let time = Math.floor(Date.now() / 1000) - 500 * 24 * 3600;
    for (let i = 0; i < 500; i++) {
      const change = price * (0.0003 + 0.018 * (Math.random() - 0.49));
      price += change;
      candles.push({ time, close: price });
      time += 24 * 3600;
    }
  }

  let v1_cash = 10000, v1_holdings = 0, v1_fast = 10, v1_slow = 30;
  let v1_history = [];
  for (let i = 120; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const recent60 = candles.slice(i - 60, i);
    const price = candles[i].close;
    const opt = optimizeParameters(recent60);
    v1_fast = opt.fast; v1_slow = opt.slow;
    const signal = getSignal(slice, v1_fast, v1_slow);
    if (signal === 'BUY' && v1_holdings === 0) {
      v1_holdings = (v1_cash - v1_cash * 0.001) / price; v1_cash = 0;
    } else if (signal === 'SELL' && v1_holdings > 0) {
      v1_cash = (v1_holdings * price) - (v1_holdings * price * 0.001); v1_holdings = 0;
    }
    v1_history.push(v1_cash + v1_holdings * price);
  }

  let v2_cash = 10000, v2_holdings = 0, v2_fast = 10, v2_slow = 30;
  let v2_history = [];
  for (let i = 120; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const price = candles[i].close;
    if (i % 4 === 0) {
      const recentWindow = candles.slice(i - 60, i);
      let sumChanges = 0;
      for (let j = recentWindow.length - 10; j < recentWindow.length; j++) {
        if (j > 0) sumChanges += Math.abs(recentWindow[j].close - recentWindow[j-1].close) / recentWindow[j-1].close;
      }
      const vol = (sumChanges / 10) * 100;
      const oosRatio = 0.20 + Math.min(0.20, vol * 0.15);
      const oosCount = Math.floor(recentWindow.length * oosRatio);
      const inSampleCount = recentWindow.length - oosCount;
      const inSample = recentWindow.slice(0, inSampleCount);
      const outOfSample = recentWindow.slice(inSampleCount);
      const candidate = optimizeParameters(inSample);
      if (candidate.fast !== v2_fast || candidate.slow !== v2_slow) {
        const curInSample = runMockBacktest(inSample, v2_fast, v2_slow);
        const candInSample = runMockBacktest(inSample, candidate.fast, candidate.slow);
        const curOos = runMockBacktest(outOfSample, v2_fast, v2_slow);
        const candOos = runMockBacktest(outOfSample, candidate.fast, candidate.slow);
        // Dummy mock count check
        if (candInSample > curInSample && candOos > curOos) {
          v2_fast = candidate.fast; v2_slow = candidate.slow;
        }
      }
    }
    const signal = getSignal(slice, v2_fast, v2_slow);
    if (signal === 'BUY' && v2_holdings === 0) {
      v2_holdings = (v2_cash - v2_cash * 0.001) / price; v2_cash = 0;
    } else if (signal === 'SELL' && v2_holdings > 0) {
      v2_cash = (v2_holdings * price) - (v2_holdings * price * 0.001); v2_holdings = 0;
    }
    v2_history.push(v2_cash + v2_holdings * price);
  }

  // Draw ASCII Chart (15 rows x 65 columns)
  const rows = 15;
  const cols = 65;
  const grid = Array(rows).fill(null).map(() => Array(cols).fill(' '));

  const minV = Math.min(...v1_history, ...v2_history) * 0.98;
  const maxV = Math.max(...v1_history, ...v2_history) * 1.02;

  function setPoint(history, char) {
    const len = history.length;
    for (let c = 0; c < cols; c++) {
      const idx = Math.floor((len - 1) * (c / (cols - 1)));
      const eq = history[idx];
      const r = rows - 1 - Math.floor(((eq - minV) / (maxV - minV)) * (rows - 1));
      if (r >= 0 && r < rows) {
        grid[r][c] = char;
      }
    }
  }

  // V1 is '.' and V2 is '#'
  setPoint(v1_history, '░');
  setPoint(v2_history, '█');

  // Print grid
  console.log("\n  AEGIS TRADER - HISTORICAL EQUITY CURVES (ASCII PLOT)");
  console.log("  ----------------------------------------------------");
  for (let r = 0; r < rows; r++) {
    const val = maxV - (r / (rows - 1)) * (maxV - minV);
    const label = `$${Math.round(val).toLocaleString()}`;
    const paddedLabel = label.padEnd(8, ' ');
    console.log(`${paddedLabel} | ${grid[r].join('')}`);
  }
  console.log("           +-----------------------------------------------------------------");
  console.log("             Start                                                      End\n");
  console.log("  Legend: ░ = V1 (45s In-Sample) | █ = V2 (Gated Walk-Forward)\n");
}

main().catch(err => console.error(err));
