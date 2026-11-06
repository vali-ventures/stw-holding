// Signup core: validate → normalize → fan out to every configured "sink".
// Sinks are switched on purely by environment variables, so plugging in a
// CRM / Twilio later is config, not code.
//
//   FILE    always on locally (data/signups.jsonl); off on serverless unless SIGNUPS_FILE is set
//   GITHUB  GITHUB_TOKEN + GITHUB_REPO ("owner/name") [+ GITHUB_BRANCH, default "signups"]
//   WEBHOOK WEBHOOK_URL [+ WEBHOOK_SECRET → X-Saintwood-Signature: sha256=HMAC(body)]
//   TWILIO  TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + (TWILIO_FROM | TWILIO_MESSAGING_SERVICE_SID)
//           + TWILIO_CONFIRM=1 to send a confirmation text at signup.
//
// Storage is an append-only event log (one JSON object per line):
//   {"type":"signup","id":"…","phone":"+17025550123","interest":"coffee","code":"SW-7KQ2",…}
//   {"type":"update","id":"…","email":"a@b.com"}
// scripts/export.mjs folds events into one row per person.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const env = (k, d = '') => (process.env[k] ?? d).trim();

// ── validation ─────────────────────────────────────────────
export function normalizePhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null; // US / NANP only
  return '+1' + d;
}
export function normalizeEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(s) && s.length <= 254 ? s : null;
}
const ID_RE = /^[0-9a-f-]{16,40}$/i;
const INTERESTS = new Set(['bagels', 'burgers', 'coffee']);

// Short, unambiguous redemption code shown at the counter.
export function makeCode() {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const b = crypto.randomBytes(4);
  return 'SW-' + [...b].map((x) => A[x % A.length]).join('');
}

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : undefined);

export function buildRecord(body, meta = {}) {
  if (!body || typeof body !== 'object') throw httpErr(400, 'invalid');
  if (body.company) throw httpErr(200, 'ok'); // honeypot: pretend success
  const type = body.type === 'update' ? 'update' : 'signup';
  if (!ID_RE.test(String(body.id || ''))) throw httpErr(400, 'invalid', 'id');
  const base = { type, id: String(body.id), at: new Date().toISOString(), clientTs: clip(body.ts, 40) };

  if (type === 'signup') {
    const phone = normalizePhone(body.phone);
    if (!phone) throw httpErr(400, 'invalid', 'phone');
    const c = body.consent || {};
    if (c.sms !== true) throw httpErr(400, 'consent required', 'consent');
    return {
      ...base, phone,
      interest: INTERESTS.has(body.interest) ? body.interest : null,
      code: makeCode(),
      consent: { sms: true, text: clip(c.text, 800), version: clip(c.version, 40), ip: meta.ip, userAgent: clip(meta.ua, 300) },
      attribution: sanitizeObj(body.attribution, 300),
    };
  }
  const rec = { ...base };
  if (body.email != null) {
    const email = normalizeEmail(body.email);
    if (!email) throw httpErr(400, 'invalid', 'email');
    rec.email = email;
    rec.emailConsent = { text: clip(body.consent && body.consent.text, 300), ip: meta.ip };
  }
  if (body.instagramClicked) rec.instagramClicked = true;
  return rec;
}

function sanitizeObj(o, n) {
  if (!o || typeof o !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(o).slice(0, 12)) if (typeof v === 'string') out[k.slice(0, 40)] = v.slice(0, n);
  return out;
}

function httpErr(status, msg, field) { const e = new Error(msg); e.status = status; e.field = field; return e; }

// ── sinks ──────────────────────────────────────────────────
const sinks = {
  async file(rec) {
    const p = env('SIGNUPS_FILE') || path.join(process.cwd(), 'data', 'signups.jsonl');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, JSON.stringify(rec) + '\n');
  },

  // Appends to a file in a GitHub repo via the contents API. Uses its own
  // branch so signups never trigger a site redeploy. Retries on conflicts.
  async github(rec) {
    const repo = env('GITHUB_REPO'), branch = env('GITHUB_BRANCH', 'signups'), file = env('GITHUB_PATH', 'data/signups.jsonl');
    const api = `https://api.github.com/repos/${repo}`;
    const h = { authorization: `Bearer ${env('GITHUB_TOKEN')}`, accept: 'application/vnd.github+json', 'user-agent': 'saintwood-holding', 'x-github-api-version': '2022-11-28' };
    await ensureBranch(api, h, branch);
    for (let i = 0; i < 5; i++) {
      const g = await fetch(`${api}/contents/${file}?ref=${encodeURIComponent(branch)}`, { headers: h });
      let sha, text = '';
      if (g.ok) { const j = await g.json(); sha = j.sha; text = Buffer.from(j.content || '', 'base64').toString('utf8'); }
      else if (g.status !== 404) throw new Error('github read ' + g.status);
      const body = { message: `${rec.type} ${rec.id.slice(0, 8)}`, branch, content: Buffer.from(text + JSON.stringify(rec) + '\n').toString('base64'), ...(sha ? { sha } : {}) };
      const p = await fetch(`${api}/contents/${file}`, { method: 'PUT', headers: h, body: JSON.stringify(body) });
      if (p.ok) return;
      if (p.status !== 409 && p.status !== 422) throw new Error('github write ' + p.status);
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 400 * (i + 1)));
    }
    throw new Error('github write: too many conflicts');
  },

  async webhook(rec) {
    const body = JSON.stringify({ source: 'saintwood-holding', event: rec });
    const h = { 'content-type': 'application/json' };
    if (env('WEBHOOK_SECRET')) h['x-saintwood-signature'] = 'sha256=' + crypto.createHmac('sha256', env('WEBHOOK_SECRET')).update(body).digest('hex');
    const r = await fetch(env('WEBHOOK_URL'), { method: 'POST', headers: h, body });
    if (!r.ok) throw new Error('webhook ' + r.status);
  },

  async twilio(rec) {
    if (rec.type !== 'signup' || env('TWILIO_CONFIRM') !== '1') return;
    await sendSms(rec.phone, env('TWILIO_CONFIRM_TEXT', "Saintwood: you're on the list. We'll text your free coffee the week we open. Reply STOP to opt out."));
  },
};

let branchChecked = false;
async function ensureBranch(api, h, branch) {
  if (branchChecked) return;
  const r = await fetch(`${api}/branches/${encodeURIComponent(branch)}`, { headers: h });
  if (r.status === 404) {
    const repo = await (await fetch(api, { headers: h })).json();
    const ref = await (await fetch(`${api}/git/ref/heads/${repo.default_branch}`, { headers: h })).json();
    await fetch(`${api}/git/refs`, { method: 'POST', headers: h, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
  }
  branchChecked = true;
}

export async function sendSms(to, text) {
  const sid = env('TWILIO_ACCOUNT_SID'), tok = env('TWILIO_AUTH_TOKEN');
  const form = new URLSearchParams({ To: to, Body: text });
  if (env('TWILIO_MESSAGING_SERVICE_SID')) form.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID'));
  else form.set('From', env('TWILIO_FROM'));
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!r.ok) throw new Error('twilio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

export function activeSinks() {
  const on = [];
  const serverless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!serverless || env('SIGNUPS_FILE')) on.push('file');
  if (env('GITHUB_TOKEN') && env('GITHUB_REPO')) on.push('github');
  if (env('WEBHOOK_URL')) on.push('webhook');
  if (env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && (env('TWILIO_FROM') || env('TWILIO_MESSAGING_SERVICE_SID'))) on.push('twilio');
  return on;
}

// Storage sinks must succeed (at least one); notification sinks are best-effort.
export async function handle(body, meta) {
  const rec = buildRecord(body, meta);
  const on = activeSinks();
  const storage = on.filter((s) => s === 'file' || s === 'github' || s === 'webhook');
  if (!storage.length) throw httpErr(500, 'no storage configured');
  const results = await Promise.allSettled(storage.map((s) => sinks[s](rec)));
  results.forEach((r, i) => r.status === 'rejected' && console.error(`[signup] ${storage[i]} failed:`, r.reason && r.reason.message));
  if (!results.some((r) => r.status === 'fulfilled')) throw httpErr(502, 'storage failed');
  if (on.includes('twilio')) await sinks.twilio(rec).catch((e) => console.error('[signup] twilio failed:', e.message));
  return { ok: true, id: rec.id };
}

// Small in-memory rate limit (per warm instance; good enough against casual abuse).
const hits = new Map();
export function rateLimited(ip, max = 12, windowMs = 60_000) {
  const now = Date.now(), h = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > max;
}
