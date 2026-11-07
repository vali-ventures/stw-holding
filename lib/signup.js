// Signup core: validate → normalize → fan out to every configured "sink".
// Sinks switch on purely from environment variables, so plugging in a CRM,
// Twilio, etc. later is config, not code.
//
// STORAGE (at least one must succeed for a signup to count):
//   REDIS    UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN   ← recommended on Vercel
//            (or KV_REST_API_URL + KV_REST_API_TOKEN). Atomic RPUSH onto list "saintwood:signups".
//   GITHUB   GITHUB_TOKEN + GITHUB_REPO ("owner/name") [+ GITHUB_BRANCH, default "signups"]
//            One small JSON file per event (no size ceiling, no write conflicts).
//            Use a separate PRIVATE repo + fine-grained token (Contents: read/write on that repo only).
//   WEBHOOK  WEBHOOK_URL [+ WEBHOOK_SECRET] → POST JSON to Zapier/Make/a CRM/Google Apps Script.
//            Signature header: X-Saintwood-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">
//   FILE     data/signups.jsonl — on automatically for local dev; on serverless only if SIGNUPS_FILE is set.
//
// NOTIFY (best effort):
//   TWILIO   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + (TWILIO_FROM | TWILIO_MESSAGING_SERVICE_SID)
//            + TWILIO_CONFIRM=1 to text a confirmation at signup.
//
// Every record is an event; scripts/export.mjs folds them into one row per person:
//   {"type":"signup","id":"…","phone":"+17025550123","interest":"coffee","code":"SW-7KQ2",…}
//   {"type":"update","id":"…","email":"a@b.com"}

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG, COPY } from '../js/config.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const T = (ms = 5000) => AbortSignal.timeout(ms);

// The exact wording each consent version showed. The server records its own
// copy rather than trusting text sent by the browser. When the disclosure
// changes, bump CONFIG.consentVersion and keep the old entry here.
export const CONSENT = {
  [CONFIG.consentVersion]: COPY.smsDisclosure,
};

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

// Short, unambiguous redemption code, derived from the signup id so a
// retried request always produces the same code.
export function codeFor(id) {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const h = crypto.createHmac('sha256', env('CODE_SECRET', 'saintwood-first-pour')).update(String(id)).digest();
  return 'SW-' + [...h.subarray(0, 4)].map((x) => A[x % A.length]).join('');
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
    if (c.sms !== true || !CONSENT[c.version]) throw httpErr(400, 'consent required', 'consent');
    return {
      ...base, phone,
      interest: INTERESTS.has(body.interest) ? body.interest : null,
      code: codeFor(base.id),
      consent: { sms: true, version: c.version, text: CONSENT[c.version], ip: meta.ip, userAgent: clip(meta.ua, 300) },
      attribution: sanitizeObj(body.attribution, 300),
    };
  }
  const rec = { ...base };
  if (body.email != null) {
    const email = normalizeEmail(body.email);
    if (!email) throw httpErr(400, 'invalid', 'email');
    rec.email = email;
    rec.emailConsent = { text: COPY.emailDisclosure, ip: meta.ip };
  }
  if (body.instagramClicked === true) rec.instagramClicked = true;
  if (!rec.email && !rec.instagramClicked) throw httpErr(400, 'empty update');
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
const redisCfg = () => ({
  url: env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL'),
  token: env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN'),
});
export const REDIS_KEY = 'saintwood:signups';

export async function redis(cmd) {
  const { url, token } = redisCfg();
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(cmd), signal: T() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('redis ' + r.status + ' ' + (j.error || ''));
  return j.result;
}

const sinks = {
  async redis(rec) { await redis(['RPUSH', REDIS_KEY, JSON.stringify(rec)]); },

  async file(rec) {
    const p = env('SIGNUPS_FILE') || path.join(process.cwd(), 'data', 'signups.jsonl');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, JSON.stringify(rec) + '\n');
  },

  // One file per event → create-only writes: no sha conflicts, no 1 MB ceiling.
  async github(rec) {
    const repo = env('GITHUB_REPO'), branch = env('GITHUB_BRANCH', 'signups'), dir = env('GITHUB_DIR', 'signups');
    const api = `https://api.github.com/repos/${repo}`;
    const h = { authorization: `Bearer ${env('GITHUB_TOKEN')}`, accept: 'application/vnd.github+json', 'user-agent': 'saintwood-holding', 'x-github-api-version': '2022-11-28' };
    await ensureBranch(api, h, branch);
    const day = rec.at.slice(0, 10);
    const file = `${dir}/${day}/${rec.at.replace(/[:.]/g, '-')}_${rec.type}_${rec.id.slice(0, 8)}_${crypto.randomBytes(2).toString('hex')}.json`;
    const r = await fetch(`${api}/contents/${file}`, {
      method: 'PUT', headers: h, signal: T(8000),
      body: JSON.stringify({ message: `${rec.type} ${rec.id.slice(0, 8)}`, branch, content: Buffer.from(JSON.stringify(rec) + '\n').toString('base64') }),
    });
    if (!r.ok) throw new Error('github write ' + r.status);
  },

  async webhook(rec) {
    const body = JSON.stringify({ source: 'saintwood-holding', event: rec });
    const h = { 'content-type': 'application/json' };
    if (env('WEBHOOK_SECRET')) {
      const t = Math.floor(Date.now() / 1000);
      h['x-saintwood-signature'] = `t=${t},v1=` + crypto.createHmac('sha256', env('WEBHOOK_SECRET')).update(`${t}.${body}`).digest('hex');
    }
    const r = await fetch(env('WEBHOOK_URL'), { method: 'POST', headers: h, body, signal: T(6000), redirect: 'follow' });
    if (!r.ok) throw new Error('webhook ' + r.status);
  },
};

let branchChecked = false;
async function ensureBranch(api, h, branch) {
  if (branchChecked) return;
  const r = await fetch(`${api}/branches/${encodeURIComponent(branch)}`, { headers: h, signal: T() });
  if (r.status === 404) {
    const repo = await fetch(api, { headers: h, signal: T() });
    if (!repo.ok) throw new Error('github repo ' + repo.status);
    const { default_branch } = await repo.json();
    const ref = await fetch(`${api}/git/ref/heads/${default_branch}`, { headers: h, signal: T() });
    if (!ref.ok) throw new Error('github ref ' + ref.status);
    const { object } = await ref.json();
    const mk = await fetch(`${api}/git/refs`, { method: 'POST', headers: h, signal: T(), body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: object.sha }) });
    if (!mk.ok && mk.status !== 422) throw new Error('github branch ' + mk.status);
  } else if (!r.ok) throw new Error('github branch check ' + r.status);
  branchChecked = true;
}

export async function sendSms(to, text) {
  const sid = env('TWILIO_ACCOUNT_SID'), tok = env('TWILIO_AUTH_TOKEN');
  const form = new URLSearchParams({ To: to, Body: text });
  if (env('TWILIO_MESSAGING_SERVICE_SID')) form.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID'));
  else form.set('From', env('TWILIO_FROM'));
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', signal: T(8000),
    headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`twilio ${r.status} ${j.code || ''} ${j.message ? j.message.replace(/\+?\d[\d\s-]{7,}/g, '[number]') : ''}`);
  return j;
}

export function activeSinks() {
  const on = [];
  const serverless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const rc = redisCfg();
  if (rc.url && rc.token) on.push('redis');
  if (env('GITHUB_TOKEN') && env('GITHUB_REPO')) on.push('github');
  if (env('WEBHOOK_URL')) on.push('webhook');
  if (!serverless || env('SIGNUPS_FILE')) on.push('file');
  const notify = env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && (env('TWILIO_FROM') || env('TWILIO_MESSAGING_SERVICE_SID')) && env('TWILIO_CONFIRM') === '1';
  return { storage: on, notify: notify ? ['twilio'] : [] };
}

// Confirmation texts already sent by this warm instance (stops a retried
// request double-texting someone).
const texted = new Set();

export async function handle(body, meta) {
  const rec = buildRecord(body, meta);
  const { storage, notify } = activeSinks();
  if (!storage.length) {
    console.error('[signup] NO STORAGE CONFIGURED — set UPSTASH_REDIS_REST_URL/TOKEN, GITHUB_TOKEN/REPO or WEBHOOK_URL. Signup NOT saved.');
    throw httpErr(503, 'not configured');
  }
  const results = await Promise.allSettled(storage.map((s) => sinks[s](rec)));
  results.forEach((r, i) => r.status === 'rejected' && console.error(`[signup] ${storage[i]} failed:`, r.reason && r.reason.message));
  if (!results.some((r) => r.status === 'fulfilled')) throw httpErr(502, 'storage failed');
  if (notify.length && rec.type === 'signup' && !texted.has(rec.id)) {
    texted.add(rec.id);
    await sendSms(rec.phone, env('TWILIO_CONFIRM_TEXT', "Saintwood: you're on the list. We'll text your free coffee opening week. Reply STOP to opt out."))
      .catch((e) => console.error('[signup] twilio failed:', e.message));
  }
  return { ok: true, id: rec.id };
}

// Counts only (no phone numbers or emails), for "are signups coming in?".
// GET /api/signup?stats with  Authorization: Bearer <STATS_TOKEN>
export async function stats() {
  const { storage } = activeSinks();
  if (!storage.includes('redis')) return { ok: false, error: 'stats need the Redis store' };
  const events = (await redis(['LRANGE', REDIS_KEY, '0', '-1'])).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  const byId = new Map();
  for (const e of events) {
    const r = byId.get(e.id) || {};
    if (e.type === 'signup') Object.assign(r, { phone: e.phone, interest: e.interest, at: r.at || e.at, test: !!(e.attribution && /qa|test/i.test(e.attribution.utm_source || '')) || /^\+1702555/.test(e.phone || '') });
    if (e.email) r.email = true;
    if (e.instagramClicked) r.ig = true;
    byId.set(e.id, r);
  }
  const people = [...byId.values()].filter((r) => r.phone);
  const phones = new Set(people.map((r) => r.phone));
  const real = people.filter((r) => !r.test);
  const count = (arr, k) => arr.reduce((m, r) => ((m[r[k] || 'none'] = (m[r[k] || 'none'] || 0) + 1), m), {});
  return {
    ok: true,
    events: events.length,
    signups: people.length,
    uniquePhones: phones.size,
    testSignups: people.length - real.length,
    real: { signups: real.length, withEmail: real.filter((r) => r.email).length, tappedInstagram: real.filter((r) => r.ig).length, interest: count(real, 'interest') },
    latestSignupAt: people.map((r) => r.at).sort().pop() || null,
  };
}

export function health() {
  const { storage, notify } = activeSinks();
  return { ok: storage.length > 0, storage, notify, consentVersion: CONFIG.consentVersion };
}

// Small in-memory rate limit (per warm instance; enough to blunt casual abuse
// without catching a café full of people on the same wifi).
const hits = new Map();
export function rateLimited(key, max = 30, windowMs = 60_000) {
  const now = Date.now(), h = (hits.get(key) || []).filter((t) => now - t < windowMs);
  h.push(now); hits.set(key, h);
  if (hits.size > 5000) hits.clear();
  return h.length > max;
}
