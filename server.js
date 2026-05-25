const http = require('http');
const https = require('https');

// ── PUT YOUR CREDENTIALS HERE ──────────────────────────────────────────────
const CLIENT_ID = '6a1396c5da4ac8000dfec369';
const SECRET    = 'f7085046f60aa13e6b8ebcd5fac458';
const ENV       = 'production'; // change to 'production' for real PNC
// ──────────────────────────────────────────────────────────────────────────

const PLAID_HOST = `${ENV}.plaid.com`;
const PORT = 3001;

function plaid(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body });
    const req = https.request(
      { hostname: PLAID_HOST, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      let result;

      if (req.url === '/api/link-token') {
        result = await plaid('/link/token/create', {
          user: { client_user_id: 'pnc-dashboard' },
          client_name: 'PNC Dashboard',
          products: ['transactions'],
          country_codes: ['US'],
          language: 'en'
        });
      } else if (req.url === '/api/exchange') {
        result = await plaid('/item/public_token/exchange', { public_token: parsed.public_token });
      } else if (req.url === '/api/sync') {
        const syncBody = { access_token: parsed.access_token };
        if (parsed.cursor) syncBody.cursor = parsed.cursor;
        result = await plaid('/transactions/sync', syncBody);
      } else if (req.url === '/api/sandbox-token') {
        const sandboxItem = await plaid('/sandbox/public_token/create', {
          institution_id: 'ins_13',
          initial_products: ['transactions']
        });
        result = await plaid('/item/public_token/exchange', {
          public_token: sandboxItem.public_token
        });
      } else {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return;
      }

      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n✓ PNC Plaid proxy running at http://localhost:${PORT}`);
  console.log(`  Environment: ${ENV}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
