const http = require('http');
const https = require('https');

const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID';
const SECRET    = process.env.SECRET    || 'YOUR_SECRET';
const ENV       = process.env.PLAID_ENV || 'production';
const PLAID_HOST = `${ENV}.plaid.com`;
const PORT = process.env.PORT || 3001;

const OAUTH_HTML = `<!DOCTYPE html><html><head><title>Connecting...</title>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
</head><body>
<p style="font-family:sans-serif;padding:2rem">Completing PNC connection...</p>
<script>
  const params = new URLSearchParams(window.location.search);
  const token = params.get('oauth_state_id') || params.get('link_token');
  if(window.opener) {
    window.opener.postMessage({type:'oauth_complete', search: window.location.search}, '*');
    window.close();
  } else {
    document.querySelector('p').textContent = 'Connection complete. You can close this window.';
  }
</script>
</body></html>`;

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

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/oauth-response.html' || req.url.startsWith('/oauth-response.html?')) {
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(OAUTH_HTML);
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      let result;

      if (req.url === '/api/link-token') {
        const linkBody = {
          user: { client_user_id: 'pnc-dashboard' },
          client_name: 'PNC Dashboard',
          products: ['transactions'],
          country_codes: ['US'],
          language: 'en',
          redirect_uri: 'https://pnc-plaid-server.onrender.com/oauth-response.html'
        };
        result = await plaid('/link/token/create', linkBody);
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
        result = await plaid('/item/public_token/exchange', { public_token: sandboxItem.public_token });
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
  console.log(`\n✓ PNC Plaid proxy running on port ${PORT}`);
  console.log(`  Environment: ${ENV}\n`);
});
