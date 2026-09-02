/* ============================================================
   CashCats — Telegram Mini App: send the generated PFP into the chat.

   The PFP generator runs client-side; the browser can't attach a file to a
   Telegram message (WebApp.sendData caps at 4KB), so the Mini App POSTs the
   PNG here and this endpoint delivers it with the bot.

   Security:
     • bot token lives ONLY in env BOT_TOKEN (never shipped to the browser)
     • Telegram initData is HMAC-validated so we send to the REAL viewer's chat
       and nobody can spoof a chat_id
     • auth_date freshness + payload size guards
   Set BOT_TOKEN in Vercel to enable; unset → returns a clear "not configured".
   ============================================================ */
'use strict';

const crypto = require('crypto');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const MAX_AGE = 86400;            // initData older than 24h is rejected
const MAX_IMG_BYTES = 4_000_000;  // decoded PNG cap (Vercel body limit is ~4.5MB)

// Validate Telegram Mini App initData. Returns the parsed user or null.
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const check = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  // Compare as hex bytes, not as text.
  //
  // The length guard was on the two STRINGS, and the buffers were built with
  // no encoding, so a 64-character hash containing anything non-ASCII made a
  // buffer longer than 32 bytes and timingSafeEqual threw a RangeError out of
  // the handler. It failed closed, but as a 500 rather than a 403. Decoding as
  // hex makes a malformed hash a short buffer and an ordinary rejection.
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || (Date.now() / 1000 - authDate) > MAX_AGE) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  return await new Promise((resolve) => {
    let d = ''; let tooBig = false;
    req.on('data', (c) => { d += c; if (d.length > MAX_IMG_BYTES * 1.5 + 4096) { tooBig = true; req.destroy(); } });
    req.on('end', () => { if (tooBig) return resolve(null); try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('content-type', 'application/json');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'POST only' })); return; }
  if (!BOT_TOKEN) { res.statusCode = 503; res.end(JSON.stringify({ ok: false, error: 'bot not configured' })); return; }

  const body = await readJson(req);
  if (!body || !body.img || !body.initData) {
    res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'missing img/initData' })); return;
  }

  let user = null;
  try { user = verifyInitData(body.initData); } catch { user = null; }
  if (!user || !user.id) {
    res.statusCode = 403; res.end(JSON.stringify({ ok: false, error: 'invalid Telegram session' })); return;
  }

  const b64 = String(body.img).replace(/^data:image\/\w+;base64,/, '');
  let png;
  try { png = Buffer.from(b64, 'base64'); } catch { png = null; }
  if (!png || !png.length || png.length > MAX_IMG_BYTES) {
    res.statusCode = 413; res.end(JSON.stringify({ ok: false, error: 'image missing or too large' })); return;
  }

  try {
    const form = new FormData();
    form.append('chat_id', String(user.id));
    form.append('caption', 'Your CashCats PFP 🐱  ·  cashcatllc.help');
    form.append('photo', new Blob([png], { type: 'image/png' }), 'cashcat-pfp.png');
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
    const j = await r.json();
    if (!j.ok) { res.statusCode = 502; res.end(JSON.stringify({ ok: false, error: j.description || 'telegram error' })); return; }
    res.statusCode = 200; res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.statusCode = 502; res.end(JSON.stringify({ ok: false, error: 'send failed' }));
  }
};
