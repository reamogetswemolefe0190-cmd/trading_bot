const fs = require('fs');
const path = require('path');
const https = require('https');

// Helper to make HTTPS requests
function makeRequest(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || 'AAPL';
  const limitDays = parseInt(args[1]) || 365;
  const apiKey = args[2] || process.env.ALPCA_API_KEY_ID;
  const apiSecret = args[3] || process.env.ALPCA_API_SECRET_KEY;

  if (!apiKey || !apiSecret) {
    console.error('Error: Please provide Alpaca API Key and Secret Key.');
    console.log('Usage: node fetch_history.js <symbol> <days> <apiKey> <apiSecret>');
    process.exit(1);
  }

  console.log(`[Fetcher] Fetching ${limitDays} days of daily history for ${symbol}...`);

  // Calculate timeframe ISO strings
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - limitDays);

  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // Determine if crypto or stock (e.g. BTCUSD vs AAPL)
  const isCrypto = symbol.includes('/') || symbol.includes('BTC') || symbol.includes('ETH');
  
  // Alpaca Data URLs
  let url = '';
  const headers = {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': apiSecret
  };

  if (isCrypto) {
    // Standardize symbol for Alpaca Crypto data format (e.g. BTC/USD -> BTC/USD)
    const formattedSym = symbol.replace('/', '');
    url = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${formattedSym}&timeframe=1Day&start=${startISO}&end=${endISO}&limit=1000`;
  } else {
    url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&start=${startISO}&end=${endISO}&limit=1000&adjustment=raw`;
  }

  try {
    const response = await makeRequest(url, headers);
    let bars = [];

    if (isCrypto) {
      const formattedSym = symbol.replace('/', '');
      bars = response.bars[formattedSym] || [];
    } else {
      bars = response.bars || [];
    }

    if (bars.length === 0) {
      console.log(`[Fetcher] No bars found for ${symbol} within the specified timeframe.`);
      return;
    }

    // Format bars to fit simulator schema
    const formattedData = bars.map(b => ({
      time: b.t.split('T')[0], // YYYY-MM-DD
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v
    }));

    // Ensure target folder exists
    const targetDir = path.join(__dirname, '../data/history');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filepath = path.join(targetDir, `${symbol.replace('/', '_')}_history.json`);
    fs.writeFileSync(filepath, JSON.stringify(formattedData, null, 2));

    console.log(`[Fetcher] SUCCESS! Downloaded ${formattedData.length} candles for ${symbol}. Saved to ${filepath}`);
  } catch (e) {
    console.error(`[Fetcher] API request failed: ${e.message}`);
  }
}

main();
