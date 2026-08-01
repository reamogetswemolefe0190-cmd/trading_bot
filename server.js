import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// Proxy handler to route Alpaca requests from browser securely to Alpaca servers
async function proxyAlpaca(req, res, targetUrl) {
  const headers = {};
  
  if (req.headers['apca-api-key-id']) {
    headers['APCA-API-KEY-ID'] = req.headers['apca-api-key-id'];
  }
  if (req.headers['apca-api-secret-key']) {
    headers['APCA-API-SECRET-KEY'] = req.headers['apca-api-secret-key'];
  }
  headers['Content-Type'] = 'application/json';

  const fetchOptions = {
    method: req.method,
    headers: headers
  };

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    fetchOptions.body = JSON.stringify(req.body);
  }

  try {
    const apiRes = await fetch(targetUrl, fetchOptions);
    const data = await apiRes.text();
    res.status(apiRes.status).send(data);
  } catch (e) {
    res.status(500).json({ error: 'Proxy Request Failed: ' + e.message });
  }
}

app.all('/api/alpaca-paper/{*splat}', (req, res) => {
  const cleanPath = req.url.replace(/^\/api\/alpaca-paper/, '');
  proxyAlpaca(req, res, `https://paper-api.alpaca.markets${cleanPath}`);
});

app.all('/api/alpaca-live/{*splat}', (req, res) => {
  const cleanPath = req.url.replace(/^\/api\/alpaca-live/, '');
  proxyAlpaca(req, res, `https://api.alpaca.markets${cleanPath}`);
});

app.all('/api/alpaca-data/{*splat}', (req, res) => {
  const cleanPath = req.url.replace(/^\/api\/alpaca-data/, '');
  proxyAlpaca(req, res, `https://data.alpaca.markets${cleanPath}`);
});

// Serve frontend assets built in dist
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Production Server] Server listening on port ${PORT}`);
});
