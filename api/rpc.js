/* ============================================================
   CashCats — RPC failover proxy (Vercel serverless).

   The site talks to the FREE public Robinhood Chain RPC directly in the
   browser (CORS-open). This endpoint is the FALLBACK, hit only when the
   browser's direct free call fails. Server-side it has no CORS limits, so it
   can walk the fuller list:

       1. official free public RPC
       2. ArrowRPC (free, no browser CORS — usable only here)
       3. your PAID RPC  ← from env PAID_RPC_URL, NEVER shipped to the browser

   Free endpoints are tried first on every request, so the paid upstream is
   touched only when every free node is down — keeping paid usage near zero.
   If PAID_RPC_URL is unset, this simply uses the free nodes (no billing).

   Guards: read-only method allowlist, fixed upstreams (can't be used as a
   write/relay), same-site Origin check, and a short in-memory response cache.
   ============================================================ */
'use strict';

const FREE = [
  'https://rpc.mainnet.chain.robinhood.com', // official public
  'https://rpc.arrowrpc.com',                // ArrowRPC — free, no key
];
// Paid upstream is LAST and comes only from the environment, so the key/URL
// never appears in client code. Set PAID_RPC_URL in Vercel to enable it.
const PAID = (process.env.PAID_RPC_URL || process.env.ALCHEMY_RPC_URL || '').trim();
const UPSTREAMS = [...FREE, PAID].filter((u) => /^https?:\/\//i.test(u));

const ALLOWED = new Set([
  'eth_call', 'eth_getLogs', 'eth_blockNumber', 'eth_chainId',
  'eth_getBalance', 'eth_getCode', 'eth_estimateGas', 'eth_gasPrice',
  'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_getTransactionCount', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
  'net_version',
]);

const CACHE_TTL = 15_000; // ms
const CACHE_MAX = 500;
const cache = new Map(); // key -> { t, body }

// The Origin check is not a security control and should not be read as one.
// Any script can send whatever Origin it likes, and requests with no Origin at
// all are let through on purpose so server-side rendering and curl still work.
// What actually stops this endpoint being used as somebody's free RPC is the
// method allowlist, the 15s cache, and the bucket below.
function allowedOrigin(req) {
  const o = (req.headers.origin || req.headers.referer || '').toLowerCase();
  if (!o) return true; // same-origin server-side / curl with no Origin
  return o.includes('cashcatllc') || o.includes('cashcatsll') ||
         o.includes('cashcatsllc') || o.includes('localhost') || o.includes('vercel.app');
}

// Per-IP token bucket. The last entry in UPSTREAMS is the paid one, so an open
// proxy here is a bill, not just load. Held in memory like the cache above, so
// it is per warm instance rather than global -- partial, and still enough to
// stop one client hammering it. A caller with no Origin gets a smaller bucket,
// since that is the shape a scripted abuser has and a browser never does.
const RATE_WINDOW = 60_000;
const RATE_BROWSER = 120;   // requests per minute per IP
const RATE_ANON = 30;
const buckets = new Map(); // ip -> { t, n }

function overRate(req, now) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
             req.socket?.remoteAddress || 'unknown';
  const cap = req.headers.origin || req.headers.referer ? RATE_BROWSER : RATE_ANON;
  const b = buckets.get(ip);
  if (!b || now - b.t >= RATE_WINDOW) {
    buckets.set(ip, { t: now, n: 1 });
    if (buckets.size > 5000) buckets.delete(buckets.keys().next().value);
    return false;
  }
  b.n++;
  return b.n > cap;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  return await new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

async function callUpstream(url, payload, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: ac.signal,
    });
    if (!r.ok) throw new Error('http_' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return; }
  if (!allowedOrigin(req)) { res.statusCode = 403; res.end(JSON.stringify({ error: 'forbidden' })); return; }
  if (overRate(req, Date.now())) {
    res.statusCode = 429;
    res.setHeader('retry-after', '60');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'rate limited' } }));
    return;
  }

  const body = await readBody(req);
  const id = (body && body.id) != null ? body.id : 1;
  if (!body || !ALLOWED.has(body.method)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not allowed' } }));
    return;
  }

  const key = JSON.stringify([body.method, body.params || []]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) {
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-cache', 'HIT');
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: hit.body.result }));
    return;
  }

  const payload = { jsonrpc: '2.0', id, method: body.method, params: body.params || [] };
  let last = { jsonrpc: '2.0', id, error: { code: -32000, message: 'no upstream' } };
  for (let i = 0; i < UPSTREAMS.length; i++) {
    try {
      const j = await callUpstream(UPSTREAMS[i], payload);
      if (j && j.error) { last = j; continue; }        // node-level error → try the next upstream
      if (j && 'result' in j) {
        cache.set(key, { t: Date.now(), body: j });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        res.setHeader('content-type', 'application/json');
        res.setHeader('x-cache', 'MISS');
        res.setHeader('x-upstream', String(i));         // 0/1 = free, last index = paid
        res.end(JSON.stringify(j));
        return;
      }
    } catch (e) { last = { jsonrpc: '2.0', id, error: { code: -32000, message: 'upstream ' + i + ' failed' } }; }
  }
  res.statusCode = 502;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(last));
};
