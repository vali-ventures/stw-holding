// Client side of the signup plumbing. Every submission is an "event" sent to
// CONFIG.endpoint. If the network fails, it's queued in localStorage and
// retried on the next visit, so a flaky connection never loses a signup.

import { CONFIG } from './config.js';

const QKEY = 'sw:queue';

function readQ() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } }
function writeQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-20))); } catch {} }

async function post(body, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(CONFIG.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal, keepalive: true,
      });
      clearTimeout(to);
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      if (r.status >= 400 && r.status < 500) { const e = new Error(j.error || 'invalid'); e.fatal = true; e.field = j.field; throw e; }
      err = new Error('server ' + r.status);
    } catch (e) {
      if (e.fatal) throw e;
      err = e;
    }
    await new Promise((res) => setTimeout(res, 400 * 2 ** i));
  }
  throw err;
}

function attribution() {
  const p = new URLSearchParams(location.search), out = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref']) if (p.get(k)) out[k] = p.get(k).slice(0, 120);
  if (document.referrer) out.referrer = document.referrer.slice(0, 300);
  return out;
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
}

// Returns a promise, but callers never block the UI on it: the person has
// already done their part. Errors that mean "the data is wrong" (4xx) are
// surfaced; transient ones are queued.
export async function send(event) {
  const body = { ...event, ts: new Date().toISOString(), page: location.pathname, ...(event.type === 'signup' ? { attribution: attribution() } : {}) };
  try {
    return await post(body);
  } catch (e) {
    if (e.fatal) throw e;
    const q = readQ(); q.push(body); writeQ(q);
    return { ok: true, queued: true };
  }
}

export async function flushQueue() {
  const q = readQ();
  if (!q.length) return;
  const left = [];
  for (const b of q) { try { await post(b, 1); } catch (e) { if (!e.fatal) left.push(b); } }
  writeQ(left);
}
