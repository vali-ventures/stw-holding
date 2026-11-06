// Zero-dependency local server: static files + /api/signup.
//   node server/dev.js        → http://localhost:5173   (HOST=0.0.0.0 to test from a phone on your wifi)
// Signups land in data/signups.jsonl.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/signup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173), HOST = process.env.HOST || '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain' };
// Only these are public — everything else (data/, lib/, .env, …) is not served.
const PUBLIC = /^\/(?:[\w-]+\.html|(?:js|css|assets)\/[\w./-]+)$/;

http.createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.statusCode = 400; return res.end('bad request'); }
  if (p === '/api/signup') return handler(req, res);
  if (p === '/') p = '/index.html';
  if (!PUBLIC.test(p) || p.includes('..')) { res.statusCode = 404; return res.end('not found'); }
  try {
    const buf = await fs.readFile(path.join(root, p));
    res.setHeader('content-type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-cache');
    res.end(buf);
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(PORT, HOST, () => console.log(`Saintwood holding page → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
