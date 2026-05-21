// ═══════════════════════════════════════════════════════════════
// Kalshi BTC Signal — Backend Proxy
// Railway / Render deployment
// ═══════════════════════════════════════════════════════════════
const express  = require('express');
const cors     = require('cors');
const crypto   = require('crypto');
const https    = require('https');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── ENV vars (set these in Railway/Render dashboard) ──
const KALSHI_KEY_ID     = process.env.KALSHI_KEY_ID;      // your UUID key id
const KALSHI_PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY; // full PEM string
const DEMO_MODE         = process.env.DEMO_MODE === 'true'; // 'true' = demo api

const KALSHI_BASE = DEMO_MODE
  ? 'https://demo-api.kalshi.co/trade-api/v2'
  : 'https://trading-api.kalshi.com/trade-api/v2';

app.use(cors());
app.use(express.json());

// ════════════════════════════════════════
// SERVE DASHBOARD AT ROOT
// ════════════════════════════════════════
const path = require('path');
const fs   = require('fs');

app.get('/', (req, res) => {
  const file = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(file)) {
    res.sendFile(file);
  } else {
    res.status(404).send('Dashboard not found — make sure public/index.html exists');
  }
});

app.use(express.static(path.join(__dirname, 'public')));


// ════════════════════════════════════════
// RSA-PSS SIGNING (Kalshi auth method)
// ════════════════════════════════════════
function signRequest(method, path) {
  const ts  = String(Date.now());
  const msg = ts + method.toUpperCase() + path;

  const sig = crypto.sign(
    'sha256',
    Buffer.from(msg),
    {
      key: KALSHI_PRIVATE_KEY,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }
  );

  return {
    'KALSHI-ACCESS-KEY':       KALSHI_KEY_ID,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': sig.toString('base64'),
    'Content-Type': 'application/json',
  };
}

// ════════════════════════════════════════
// GENERIC KALSHI FETCH
// ════════════════════════════════════════
function kalshiFetch(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const headers = signRequest(method, path);
    const url     = new URL(KALSHI_BASE + path);

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   method.toUpperCase(),
      headers,
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    demo_mode: DEMO_MODE,
    key_set:   !!KALSHI_KEY_ID,
    timestamp: new Date().toISOString(),
  });
});

// ════════════════════════════════════════
// EXCHANGE STATUS
// ════════════════════════════════════════
app.get('/api/status', async (req, res) => {
  try {
    const r = await kalshiFetch('GET', '/exchange/status');
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// FIND OPEN BTC MARKETS
// Returns the active BTC 15-min contracts
// ════════════════════════════════════════
app.get('/api/btc-markets', async (req, res) => {
  try {
    // KXBTC = Kalshi's BTC price series
    const r = await kalshiFetch('GET', '/markets?series_ticker=KXBTC&status=open&limit=20');
    if (r.status !== 200) return res.status(r.status).json(r.body);

    const markets = (r.body.markets || []).map(m => ({
      ticker:          m.ticker,
      title:           m.title,
      yes_bid:         m.yes_bid,    // cents (100 = $1.00)
      yes_ask:         m.yes_ask,
      no_bid:          m.no_bid,
      no_ask:          m.no_ask,
      last_price:      m.last_price,
      volume:          m.volume,
      open_interest:   m.open_interest,
      expiration_time: m.expiration_time,
      status:          m.status,
      close_time:      m.close_time,
    }));

    res.json({ markets, demo: DEMO_MODE });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// SINGLE MARKET DETAIL
// ════════════════════════════════════════
app.get('/api/market/:ticker', async (req, res) => {
  try {
    const r = await kalshiFetch('GET', `/markets/${req.params.ticker}`);
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// MARKET ORDERBOOK
// ════════════════════════════════════════
app.get('/api/orderbook/:ticker', async (req, res) => {
  try {
    const r = await kalshiFetch('GET', `/markets/${req.params.ticker}/orderbook`);
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// ACCOUNT BALANCE
// ════════════════════════════════════════
app.get('/api/balance', async (req, res) => {
  try {
    const r = await kalshiFetch('GET', '/portfolio/balance');
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// OPEN POSITIONS
// ════════════════════════════════════════
app.get('/api/positions', async (req, res) => {
  try {
    const r = await kalshiFetch('GET', '/portfolio/positions?limit=25');
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// ORDER HISTORY
// ════════════════════════════════════════
app.get('/api/orders', async (req, res) => {
  try {
    const r = await kalshiFetch('GET', '/portfolio/orders?limit=20&status=resting');
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// START
// ════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n✅ Kalshi Signal Backend running on port ${PORT}`);
  console.log(`   Mode:    ${DEMO_MODE ? '🟡 DEMO' : '🟢 LIVE'}`);
  console.log(`   Key set: ${KALSHI_KEY_ID ? '✅' : '❌ MISSING — set KALSHI_KEY_ID env var'}`);
  console.log(`   PEM set: ${KALSHI_PRIVATE_KEY ? '✅' : '❌ MISSING — set KALSHI_PRIVATE_KEY env var'}\n`);
});
