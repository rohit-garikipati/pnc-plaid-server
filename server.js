const http = require('http');
const https = require('https');

const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID';
const SECRET    = process.env.SECRET    || 'YOUR_SECRET';
const ENV       = process.env.PLAID_ENV || 'production';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const PLAID_HOST = `${ENV}.plaid.com`;
const PORT = process.env.PORT || 3001;
const REDIRECT_URI = 'https://pnc-plaid-server.onrender.com/oauth-response.html';

const OAUTH_HTML = `<!DOCTYPE html><html><head><title>Connecting...</title>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
</head><body>
<p style="font-family:sans-serif;padding:2rem">Completing PNC connection...</p>
<script>
  if(window.opener) {
    window.opener.postMessage({type:'oauth_complete', search: window.location.search}, '*');
  }
  // Re-initialize Link to complete OAuth using the stored link token
  const lt = localStorage.getItem('plaid_link_token');
  if(lt){
    const handler = Plaid.create({
      token: lt,
      receivedRedirectUri: window.location.href,
      onSuccess: (public_token) => {
        if(window.opener){ window.opener.postMessage({type:'plaid_success', public_token}, '*'); }
        document.querySelector('p').textContent = 'Connected. You can close this window.';
        setTimeout(()=>window.close(), 800);
      },
      onExit: () => { document.querySelector('p').textContent = 'Connection complete. You can close this window.'; }
    });
    handler.open();
  } else {
    document.querySelector('p').textContent = 'Connection complete. You can close this window.';
  }
</script>
</body></html>`;

const CONNECT_HTML = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect PNC to Plaid</title>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f3;color:#1a1a1a;padding:3rem 2rem;max-width:640px;margin:0 auto}
h1{font-size:22px;font-weight:500;margin-bottom:8px}
p.sub{color:#888;font-size:13px;margin-bottom:2rem}
.card{background:#fff;border:1px solid #e8e8e8;border-radius:12px;padding:1.5rem;margin-bottom:1rem}
.btn{background:#1a56db;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:14px;cursor:pointer;font-weight:500}
.btn:hover{background:#1447c0}.btn:disabled{opacity:.5;cursor:default}
.step{display:flex;gap:10px;align-items:flex-start;margin-bottom:14px}
.num{width:24px;height:24px;border-radius:50%;background:#1a56db;color:#fff;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.num.done{background:#16a34a}
.token-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-top:12px;font-family:monospace;font-size:12px;word-break:break-all;color:#166534}
.status{font-size:13px;margin-top:12px}.err{color:#dc2626}
</style></head><body>
<h1>Connect your PNC account</h1>
<p class="sub">Prepare, then open PNC login. Served over HTTPS so Plaid works correctly.</p>
<div class="card">
  <div class="step"><div class="num" id="n1">1</div><div>Prepare the connection.</div></div>
  <button class="btn" id="prep-btn" onclick="prepare()">Prepare connection</button>
  <div class="step" style="margin-top:18px"><div class="num" id="n2">2</div><div>Open Plaid Link and log into PNC.</div></div>
  <button class="btn" id="open-btn" onclick="openLink()" disabled>Open PNC login</button>
  <p class="status" id="status"></p>
</div>
<div class="card" id="result-card" style="display:none">
  <div class="step"><div class="num done">&#10003;</div><div><strong>Your access token</strong> — copy this into your dashboard:</div></div>
  <div class="token-box" id="token-out"></div>
</div>
<script>
const SERVER = '';
let handler = null;
const setStatus = (m,e)=>{const s=document.getElementById('status');s.textContent=m;s.className='status'+(e?' err':'');};

window.addEventListener('message',(ev)=>{
  if(ev.data && ev.data.type==='plaid_success' && ev.data.public_token){
    exchange(ev.data.public_token);
  }
});

async function prepare(){
  const btn=document.getElementById('prep-btn');btn.disabled=true;
  setStatus('Getting link token...');
  let linkToken;
  try{
    const r=await fetch('/api/link-token',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const d=await r.json();linkToken=d.link_token;
    if(!linkToken)throw new Error(d.error_message||JSON.stringify(d));
  }catch(e){setStatus('Error: '+e.message,true);btn.disabled=false;return;}
  localStorage.setItem('plaid_link_token', linkToken);
  handler=Plaid.create({
    token:linkToken,
    onSuccess:(public_token)=>exchange(public_token),
    onExit:(err)=>{if(err)setStatus('Plaid exited: '+(err.error_message||err.error_code||'closed'),true);}
  });
  document.getElementById('n1').classList.add('done');document.getElementById('n1').innerHTML='&#10003;';
  document.getElementById('open-btn').disabled=false;
  setStatus('Ready. Click "Open PNC login".');
}
function openLink(){if(handler)handler.open();else setStatus('Click Prepare first.',true);}
async function exchange(public_token){
  setStatus('Connected! Exchanging token...');
  try{
    const r=await fetch('/api/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({public_token})});
    const d=await r.json();
    if(d.access_token){
      document.getElementById('token-out').textContent=d.access_token;
      document.getElementById('result-card').style.display='block';
      setStatus('Done! Copy your access token below.');
    }else setStatus('Exchange failed: '+(d.error_message||JSON.stringify(d)),true);
  }catch(e){setStatus('Exchange error: '+e.message,true);}
}
</script></body></html>`;

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

function anthropic(payloadObj) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(payloadObj);
    const req = https.request(
      { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        } },
      res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); }
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
    res.setHeader('Content-Type', 'text/html'); res.writeHead(200); res.end(OAUTH_HTML); return;
  }
  if (req.url === '/connect' || req.url === '/connect.html') {
    res.setHeader('Content-Type', 'text/html'); res.writeHead(200); res.end(CONNECT_HTML); return;
  }

  res.setHeader('Content-Type', 'application/json');
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
          transactions: { days_requested: 730 },
          country_codes: ['US'],
          language: 'en',
          redirect_uri: REDIRECT_URI
        });
      } else if (req.url === '/api/exchange') {
        result = await plaid('/item/public_token/exchange', { public_token: parsed.public_token });
      } else if (req.url === '/api/sync') {
        const syncBody = { access_token: parsed.access_token };
        if (parsed.cursor) syncBody.cursor = parsed.cursor;
        result = await plaid('/transactions/sync', syncBody);
      } else if (req.url === '/api/parse-screenshot') {
        if (!ANTHROPIC_KEY) { res.writeHead(500); res.end(JSON.stringify({error:'ANTHROPIC_API_KEY not set on server'})); return; }
        const media = parsed.media_type || 'image/png';
        const aiResp = await anthropic({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: media, data: parsed.image_base64 } },
              { type: 'text', text: 'This is a screenshot of Apple Card transactions. Extract every transaction. Respond with ONLY a JSON array, no prose, no markdown fences. Each element: {"date":"YYYY-MM-DD","name":"merchant","amount":12.34,"category":"..."}. Amount is a positive number for purchases (money spent) and negative for payments/credits/refunds. Category must be exactly one of: Living expenses, Utilities, Food & dining, Groceries, Transport, Shopping, Entertainment, Subscriptions, Health, Travel, Other. If the year is not shown, infer the most recent plausible year. Skip the "Total" / balance rows and any pending header text.' }
            ]
          }]
        });
        let txns = [];
        try {
          const text = (aiResp.content || []).filter(b=>b.type==='text').map(b=>b.text).join('');
          const clean = text.replace(/```json|```/g,'').trim();
          txns = JSON.parse(clean);
        } catch(parseErr) {
          res.writeHead(502); res.end(JSON.stringify({error:'Could not parse AI response', raw: aiResp})); return;
        }
        result = { transactions: txns, usage: aiResp.usage||null, model: 'sonnet' };
      } else if (req.url === '/api/advice') {
        if (!ANTHROPIC_KEY) { res.writeHead(500); res.end(JSON.stringify({error:'ANTHROPIC_API_KEY not set on server'})); return; }
        const aiResp = await anthropic({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 900,
          messages: [{
            role: 'user',
            content: `You are a concise personal finance assistant. Based on this 2-month spending summary, give specific, grounded budgeting advice. Reference actual numbers and categories, and comment on how the user is tracking against the 50/30/20 targets shown (needs/wants/savings). Note that living expenses (rent) are paid at the start of each month, so don't misread early-month outflow as overspending. Give 3-5 short observations or suggestions, each one or two sentences, focused on what they can adjust. Be direct and practical, not generic. Do not use markdown headers. Here is the data:\n\n${parsed.summary}`
          }]
        });
        const text=(aiResp.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
        if(!text){ res.writeHead(502); res.end(JSON.stringify({error:'No advice returned',raw:aiResp})); return; }
        result = { advice: text, usage: aiResp.usage||null, model: 'haiku' };
      } else if (req.url === '/api/ask') {
        if (!ANTHROPIC_KEY) { res.writeHead(500); res.end(JSON.stringify({error:'ANTHROPIC_API_KEY not set on server'})); return; }
        const aiResp = await anthropic({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
          messages: [{
            role: 'user',
            content: `You are a personal finance assistant answering a question about the user's spending. Use ONLY the data below. Be concise and specific with dollar figures. If the data can't answer it, say so briefly. Do not use markdown headers.\n\nSPENDING DATA (last 2 months):\n${parsed.context}\n\nQUESTION: ${parsed.question}`
          }]
        });
        const text=(aiResp.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
        result = { answer: text, usage: aiResp.usage||null, model: 'haiku' };
      } else {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return;
      }
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => console.log(`\n✓ PNC Plaid proxy on port ${PORT} (${ENV})\n`));
