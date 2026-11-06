// POST /api/signup — Vercel serverless function (Node runtime).
// GET  /api/signup — health check: which storage sinks are configured (no data).
// Also used by the local dev server (server/dev.js).
import { handle, health, rateLimited } from '../lib/signup.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET') return send(200, health());
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('allow', 'GET, POST'); return res.end(); }

  // Same-origin only (blocks drive-by cross-site form posts).
  const origin = req.headers.origin, host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin) { try { if (new URL(origin).host !== host) return send(403, { ok: false, error: 'forbidden' }); } catch { return send(403, { ok: false, error: 'forbidden' }); } }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return send(429, { ok: false, error: 'slow down' });
  let body = req.body;
  try {
    if (body == null || typeof body === 'string' || Buffer.isBuffer(body)) body = JSON.parse(String(body ?? '') || (await readBody(req)) || 'null');
  } catch { return send(400, { ok: false, error: 'invalid' }); }
  try {
    send(200, await handle(body, { ip, ua: req.headers['user-agent'] }));
  } catch (e) {
    if (e.status === 200) return send(200, { ok: true });
    send(e.status || 500, { ok: false, error: e.status ? e.message : 'server error', field: e.field });
    if (!e.status || e.status >= 500) console.error('[signup]', e.message);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 20_000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}
