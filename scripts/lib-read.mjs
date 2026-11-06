// Reads every signup event from wherever they're stored and folds them into
// one row per person, de-duplicated by phone.
//   --source=redis|github|file   (default: redis if configured, else github, else file)
import fs from 'node:fs/promises';
import { redis, REDIS_KEY } from '../lib/signup.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];

export async function readEvents() {
  const src = arg('source') || (process.argv.includes('--local') ? 'file'
    : (env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL')) ? 'redis'
    : env('GITHUB_TOKEN') && env('GITHUB_REPO') ? 'github' : 'file');
  console.error(`(reading from ${src})`);
  if (src === 'redis') return (await redis(['LRANGE', REDIS_KEY, '0', '-1'])).map((s) => JSON.parse(s));
  if (src === 'github') return readGithub();
  const text = await fs.readFile(env('SIGNUPS_FILE') || 'data/signups.jsonl', 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function readGithub() {
  const repo = env('GITHUB_REPO'), branch = env('GITHUB_BRANCH', 'signups'), dir = env('GITHUB_DIR', 'signups');
  const h = { authorization: `Bearer ${env('GITHUB_TOKEN')}`, 'user-agent': 'saintwood-holding' };
  const t = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { headers: { ...h, accept: 'application/vnd.github+json' } });
  if (!t.ok) throw new Error('GitHub tree read failed: ' + t.status);
  const files = (await t.json()).tree.filter((x) => x.type === 'blob' && x.path.startsWith(dir + '/') && x.path.endsWith('.json'));
  const out = [];
  for (let i = 0; i < files.length; i += 16) {
    const batch = await Promise.all(files.slice(i, i + 16).map((f) =>
      fetch(`https://api.github.com/repos/${repo}/git/blobs/${f.sha}`, { headers: { ...h, accept: 'application/vnd.github.raw+json' } }).then((r) => r.text())));
    for (const b of batch) { try { out.push(JSON.parse(b)); } catch {} }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function fold(events) {
  const byId = new Map();
  for (const e of events) {
    const row = byId.get(e.id) || { id: e.id };
    if (e.type === 'signup') Object.assign(row, { phone: e.phone, interest: e.interest, code: row.code || e.code, signedUpAt: row.signedUpAt || e.at, consentVersion: e.consent && e.consent.version, ...flat(e.attribution) });
    if (e.email) Object.assign(row, { email: e.email, emailAt: e.at });
    if (e.instagramClicked) row.instagramClicked = true;
    byId.set(e.id, row);
  }
  // one row per phone: the earliest signup keeps its code
  const byPhone = new Map();
  for (const r of [...byId.values()].filter((r) => r.phone).sort((a, b) => String(a.signedUpAt).localeCompare(String(b.signedUpAt)))) {
    const prev = byPhone.get(r.phone);
    if (!prev) byPhone.set(r.phone, r);
    else if (r.email && !prev.email) prev.email = r.email;
  }
  return [...byPhone.values()];
}

function flat(a) { return a ? Object.fromEntries(Object.entries(a).map(([k, v]) => ['attr_' + k, v])) : {}; }
