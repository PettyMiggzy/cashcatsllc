/* ============================================================
   Image proxy — makes external token logos usable inside the PFP canvas.

   Browsers taint a <canvas> when you draw a cross-origin image that has no CORS
   header (DexScreener's CDN sends none), which then blocks PNG export. This
   endpoint fetches the image server-side and re-serves it with
   Access-Control-Allow-Origin:* so the canvas stays clean and export works.

   Locked to the DexScreener CDN only (no open proxy / SSRF), image types only,
   size-capped, and cached.
   ============================================================ */
'use strict';

const ALLOW = /^https:\/\/([a-z0-9-]+\.)?dexscreener\.com\//i;
const MAX_BYTES = 3_000_000;

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  let url;
  try { url = new URL(req.url, 'http://x').searchParams.get('url'); } catch { url = null; }
  if (!url || !ALLOW.test(url)) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'url must be a dexscreener.com image' })); return; }

  try {
    const r = await fetch(url, { headers: { 'user-agent': 'cashcats-pfp/1.0' } });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//.test(ct)) { res.statusCode = 502; res.end(''); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) { res.statusCode = 413; res.end(''); return; }
    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');
    res.statusCode = 200;
    res.end(buf);
  } catch (e) {
    res.statusCode = 502; res.end('');
  }
};
