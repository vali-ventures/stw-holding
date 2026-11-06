// Client side of the signup plumbing. Every submission is an "event" sent to
// CONFIG.endpoint. If the network (or the server) fails, the event is queued
// in localStorage and re-sent when the connection returns, when the tab is
// hidden (sendBeacon), and on the next visit — a flaky connection never
// loses a signup.

import { CONFIG } from './config.js';

const QKEY = 'sw:queue';
const RETRYABLE = new Set([408, 425, 429]);

function readQ() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } }
function writeQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-20))); } catch {} }

async function post(body, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(CONFIG.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal, keepalive: true,
      });
      clearTimeout(to);
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      if (r.status >= 400 && r.status < 500 && !RETRYABLE.has(r.status)) { const e = new Error(j.error || 'invalid'); e.fatal = true; e.field = j.field; throw e; }
      err = new Error('server ' + r.status);
    } catch (e) {
      if (e.fatal) throw e;
      err = e;
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 600 * 2 ** i));
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

// Resolves { ok, queued? }. Rejects only when the server says the data itself
// is wrong (e.g. an invalid number), so the UI can show that.
export async function send(event) {
  const body = { ...event, ts: new Date().toISOString(), ...(event.type === 'signup' ? { attribution: attribution() } : {}) };
  // keep events in order: if anything is already waiting, queue behind it
  if (readQ().length) { enqueue(body); flushQueue(); return { ok: true, queued: true }; }
  try {
    return await post(body);
  } catch (e) {
    if (e.fatal) throw e;
    enqueue(body);
    return { ok: true, queued: true };
  }
}

function enqueue(b) { const q = readQ(); q.push(b); writeQ(q); }

let flushing = false;
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    let q = readQ();
    while (q.length) {
      try { await post(q[0], 1); } catch (e) { if (!e.fatal) break; }
      q = readQ(); q.shift(); writeQ(q);
    }
  } finally { flushing = false; }
}

// Last-ditch: hand whatever is queued to the browser as the page goes away.
function beacon() {
  const q = readQ();
  if (!q.length || !navigator.sendBeacon) return;
  const sent = q.filter((b) => navigator.sendBeacon(CONFIG.endpoint, JSON.stringify(b)));
  if (sent.length === q.length) writeQ([]);
}
addEventListener('online', flushQueue);
addEventListener('pagehide', beacon);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon(); else flushQueue(); });

export function hasQueued() { return readQ().length > 0; }
