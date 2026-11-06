import { CONFIG, COPY } from './config.js';
import { Scene } from './scene.js';
import { Flow } from './flow.js';
import { brand } from './art.js';
import { paperDataURL } from './sketch.js';
import { flushQueue, send } from './api.js';
import * as A from './audio.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SKEY = 'sw:signup';

// ── copy + links from config ───────────────────────────────
const get = (o, path) => path.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
$$('[data-copy]').forEach((el) => { const v = get(COPY, el.dataset.copy); if (v != null) el.textContent = v; });
$$('[data-href]').forEach((el) => { el.href = CONFIG[el.dataset.href]; });

const loadImg = (src, cors) => new Promise((res) => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

function saved() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch { return null; } }

async function boot() {
  document.body.style.setProperty('--paper-tex', `url(${paperDataURL('#fffcf0')})`);
  // fonts + wordmark are needed before sprites are drawn (they're baked in)
  const fontsReady = Promise.race([
    Promise.all([document.fonts.load('400 20px Ovo'), document.fonts.load('700 12px Almarai')]),
    new Promise((r) => setTimeout(r, 1800)),
  ]).catch(() => {});
  const [wm] = await Promise.all([loadImg('/assets/wordmark.png', true), fontsReady]);
  brand.wordmark = wm;

  // the storefront only shows after signup: fetch it once the person heads that way
  let storeImgP = null;
  const storeImg = () => (storeImgP ||= loadImg(Math.min(screen.width, innerWidth) * Math.min(devicePixelRatio || 1, 2) < 900 ? '/assets/storefront-640.webp' : '/assets/storefront.webp'));

  const intro = $('.intro'), dock = $('.dock'), final = $('.final'), nudge = $('.nudge');
  const claim = $('.claim'), auto = $('.auto');
  let nudgeT, peeks = -1;

  const scene = window.__scene = new Scene($('#stage'), {
    nudgeKeys: ['nudgeEmpty'],
    onGrab() { document.body.classList.add('dragging'); },
    onRelease() { document.body.classList.remove('dragging'); },
    onProgress(st) {
      $$('.steps li').forEach((li) => {
        const k = li.dataset.step;
        li.classList.toggle('on', !!st[k]);
      });
    },
    onNudge(key) {
      nudge.textContent = COPY[key];
      document.documentElement.style.setProperty('--nudge-y', Math.max(0, scene.gt + scene.depth * 1.6) + 'px');
      nudge.classList.add('show');
      clearTimeout(nudgeT); nudgeT = setTimeout(() => nudge.classList.remove('show'), 2400);
    },
    onComplete() {
      $('.headline', intro).textContent = COPY.doneHeadline;
      $('.sub', intro).textContent = COPY.doneSub;
      // already on the list? the button just takes them back to the storefront
      claim.textContent = saved() ? COPY.backToStore : COPY.claim;
      claim.hidden = false;
      $('.aux').hidden = true;
      $('.steps', intro).classList.add('out');
      nudge.classList.remove('show'); clearTimeout(nudgeT);
      setTimeout(() => claim.focus({ preventScroll: true }), 50);
    },
    onIncomplete() {
      // they undid it (spilled, lid or sleeve off): back to building
      $('.headline', intro).textContent = COPY.headline;
      $('.sub', intro).textContent = COPY.sub;
      $('.steps', intro).classList.remove('out');
      claim.hidden = true;
      $('.aux').hidden = false;
    },
    onPeek() {
      const n = $('.peek-note');
      peeks = (peeks + 1) % COPY.peek.length;
      n.textContent = COPY.peek;
      const t = scene.paper.tear;
      n.style.setProperty('--peek-y', (t.y - t.r * 2.6 - 28) + 'px');
      n.style.setProperty('--peek-x', t.x + 'px');
      n.classList.add('show');
      clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('show'), 1700);
    },
  });

  const flow = new Flow($('.sheet'), $('.scrim'), {
    onSaved(info) { try { localStorage.setItem(SKEY, JSON.stringify({ ...info, at: Date.now() })); } catch {} },
    onClose(didSave) { scene.pause(false); if (didSave) toStore(false); },
  });

  const openFlow = () => { A.unlock(); storeImg(); scene.pause(true); flow.open('q'); };
  claim.addEventListener('click', () => (saved() ? toStore(false) : openFlow()));
  auto.addEventListener('click', async () => { A.unlock(); auto.disabled = true; try { await scene.autoplay(); } finally { auto.disabled = false; } });

  // sound toggle
  const snd = $('.sound');
  const syncSnd = () => { const on = !A.isMuted(); snd.setAttribute('aria-pressed', String(on)); snd.setAttribute('aria-label', on ? 'Sound on' : 'Sound off'); };
  snd.addEventListener('click', () => { A.unlock(); A.setMuted(!A.isMuted()); syncSnd(); });
  syncSnd();

  // storefront taps (tear peek) — the scene owns dragging the cup
  $('#stage').addEventListener('pointerup', (e) => {
    if (scene.mode !== 'store' || scene._dragged) return;
    const r = e.currentTarget.getBoundingClientRect();
    scene.tapStore(e.clientX - r.left, e.clientY - r.top);
  });

  function layoutStore() {
    const fr = final.getBoundingClientRect();
    const addr = $('.addr');
    scene.storeTop = fr.bottom + 8;
    scene.storeBottom = (addr.getClientRects().length ? window.innerHeight - addr.getBoundingClientRect().top : 0) + 8;
  }

  async function toStore(instant) {
    const img = await storeImg();
    const swap = () => {
      intro.hidden = true; dock.hidden = true; nudge.classList.remove('show');
      final.hidden = false;
      if (instant) $('.final-sub').textContent = COPY.finalReturning;
      layoutStore();
      if (img) scene.toStore(img); // no image? the confirmation copy still shows
    };
    if (instant) return swap();
    await wipe(swap);
  }

  // Follow on the final screen (most people came from Instagram: send them back)
  $('.final .ig').addEventListener('click', () => {
    const id = (saved() || {}).id;
    if (id) send({ type: 'update', id, instagramClicked: true }).catch(() => {});
  });

  // the hint arrow must stay clear of the headline
  const syncText = () => { scene.textBottom = intro.getBoundingClientRect().bottom; };
  syncText();

  // The page itself never scrolls: block iOS rubber-banding (which also toggles Safari's
  // toolbar and nudges the layout). Only the sheet's own content may scroll.
  document.addEventListener('touchmove', (e) => {
    const sc = e.target.closest && e.target.closest('.sheet-inner');
    if (!sc || sc.scrollHeight <= sc.clientHeight) e.preventDefault();
  }, { passive: false });

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (scene.mode === 'store') layoutStore(); scene.resize(); syncText(); }, 120);
  });

  if (saved()) await toStore(true);
  flushQueue();
}

// Kraft paper wipes across, like the paper on the windows.
function wipe(mid) {
  const el = $('.wipe');
  const pts = (side) => {
    const out = [];
    for (let i = 0; i <= 24; i++) out.push(`${side === 'l' ? 40 + Math.random() * 22 : `calc(100% - ${40 + Math.random() * 22}px)`} ${(i / 24) * 100}%`);
    return side === 'l' ? out : out.reverse();
  };
  el.style.clipPath = `polygon(${[...pts('l'), ...pts('r')].join(',')})`;
  el.style.webkitClipPath = el.style.clipPath;
  if (!el.style.getPropertyValue('--kraft-tex')) el.style.setProperty('--kraft-tex', `url(${kraftTex()})`);
  el.classList.add('run');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = reduce ? 1 : 520;
  return new Promise((res) => {
    const a = el.animate([{ transform: 'translateX(110%) rotate(1.5deg)' }, { transform: 'translateX(0) rotate(0deg)' }], { duration: d, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
    a.onfinish = () => {
      mid();
      setTimeout(() => {
        const b = el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-110%) rotate(-1.5deg)' }], { duration: d, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
        b.onfinish = () => { el.classList.remove('run'); a.cancel(); b.cancel(); res(); };
      }, reduce ? 0 : 160);
    };
  });
}

let _kt;
function kraftTex() {
  if (_kt) return _kt;
  const c = document.createElement('canvas'); c.width = c.height = 220;
  const x = c.getContext('2d'); x.fillStyle = '#d9c3a0'; x.fillRect(0, 0, 220, 220);
  const img = x.getImageData(0, 0, 220, 220);
  for (let i = 0; i < img.data.length; i += 4) { const d = (Math.random() - 0.5) * 18; img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d * 0.8; }
  x.putImageData(img, 0, 0);
  x.strokeStyle = 'rgba(40,52,39,.12)';
  for (let i = 0; i < 40; i++) { const px = Math.random() * 220, py = Math.random() * 220; x.beginPath(); x.moveTo(px, py); x.lineTo(px + 10, py - 16); x.stroke(); }
  return (_kt = c.toDataURL());
}

boot().catch((e) => console.error(e)).finally(() => document.body.classList.remove('is-loading'));
