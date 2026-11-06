// The coffee bench: a tiny physics toy. Pieces can be picked up, thrown,
// knocked about; the French press pours real(ish) liquid that can miss.
// Sleeve threads onto the cup and slides to a snug fit; the lid magnetizes
// and clicks when you push it down past the rim.

import { cupSprites, sleeveSprite, lidSprite, pressSprites, counterSprite, cupGeo, pressGeo, drawSprite, P, K } from './art.js';
import { ellipsePts, liveLine, bezPts, mk } from './sketch.js';
import * as A from './audio.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

const FULL = 0.78;   // fill level that counts as "poured"
const MAXP = 900;    // particle cap

export class Scene {
  constructor(canvas, hooks = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.mode = 'bench';
    this.ptr = null;          // active pointer {id, x, y, piece, offX, offY, ...}
    this.auto = false;
    this.done = false;
    this.t = 0;
    this.idle = 0;
    this.nudged = {};
    this.parts = { x: new Float32Array(MAXP), y: new Float32Array(MAXP), vx: new Float32Array(MAXP), vy: new Float32Array(MAXP), v: new Float32Array(MAXP), f: new Uint8Array(MAXP), g: new Float32Array(MAXP) };
    this.np = 0;
    this.ripples = [];
    this.spilled = 0;
    this.lastSplash = 0;
    this.store = null;
    this._bind();
    this.resize();
    this._loop = this._loop.bind(this);
    this.last = performance.now();
    this._wake();
  }

  // ── layout ────────────────────────────────────────────────
  resize() {
    const r = this.cv.getBoundingClientRect();
    const W = Math.round(r.width), H = Math.round(r.height);
    if (!W || !H) return;
    const prev = this.W ? { W: this.W, gt: this.gt } : null;
    this.W = W; this.H = H;
    // ≤2x, and never more than ~4.5M canvas pixels (big desktop screens)
    this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4.5e6 / (W * H))));
    this.cv.width = Math.round(W * this.dpr); this.cv.height = Math.round(H * this.dpr);
    this.stains = mk(this.cv.width, this.cv.height);
    if (this.mode === 'store') return this._layoutStore();

    const portrait = H > W;
    const hc = clamp(Math.min(W * (portrait ? 0.315 : 0.22), H * (portrait ? 0.21 : 0.27)), 70, 270);
    this._build(hc);
    this.depth = hc * 0.62;
    this.gt = Math.round(Math.min(H * (portrait ? 0.68 : 0.65), H - this.depth - (portrait ? 128 : 104))); // ground top
    this.counter = counterSprite(W + 20, this.depth * 1.3, this.dpr, Math.max(40, H - this.gt));
    const spread = Math.min(W * (portrait ? 0.33 : 0.28), hc * 1.75);
    const cx = W / 2;
    this.home = {
      cup: [cx, this.gt + this.depth * 0.55],
      press: [cx - spread, this.gt + this.depth * 0.3],
      lid: [cx + spread * 1.04, this.gt + this.depth * 0.02],
      sleeve: [cx + spread * 0.8, this.gt + this.depth * 1.0],
    };
    if (!this.pieces) this._spawn();
    else {
      // keep progress, re-home anything resting
      // a resize/rotation mid-game: let go of everything and put pieces back on the new counter
      this.ptr = null; this._gen = (this._gen || 0) + 1; this._upright = false;
      const sl = this.pieces.sleeve;
      if (sl.threaded && !sl.attached) { sl.threaded = false; sl.sliding = false; }
      for (const k of ['cup', 'press', 'lid', 'sleeve']) {
        const p = this.pieces[k];
        p.held = false; p.groundY = undefined; p.vx = p.vy = 0; p.a = 0; p.va = 0;
        if (p.attached) continue;
        p.x = this.home[k][0]; p.y = this.home[k][1];
      }
      this.pieces.press.tilt = 0; this.np = 0; this.pieces.cup.lidOff = 0; this.pieces.cup.lidOffV = 0;
      this.stains.getContext('2d').clearRect(0, 0, this.stains.width, this.stains.height);
    }
  }

  _build(hc) {
    this.hc = hc;
    this.g = cupGeo(hc);
    this.pg = pressGeo(hc);
    const s = this.dpr;
    this.spr = { cup: cupSprites(hc, s), sleeve: sleeveSprite(hc, s), sleeveFree: sleeveSprite(hc, s, true), lid: lidSprite(hc, s), press: pressSprites(hc, s) };
    this.grav = hc * 16;
  }

  _spawn() {
    const mkp = (kind, extra = {}) => ({ kind, x: this.home[kind][0], y: this.home[kind][1], vx: 0, vy: 0, a: 0, va: 0, held: false, attached: false, ...extra });
    this.pieces = {
      cup: mkp('cup', { fill: 0, slosh: 0, sloshV: 0, squash: 0, squashV: 0, lidOff: 0, lidOffV: 0 }),
      press: mkp('press', { vol: this.pg.capacity, tilt: 0, face: 1, rate: 0 }),
      lid: mkp('lid'),
      sleeve: mkp('sleeve', { s: 0, threaded: false, sliding: false, sv: 0, squeeze: 0 }),
    };
  }

  reset() {
    this.done = false;
    this.np = 0; this.ripples = []; this.spilled = 0; this.nudged = {};
    this.stains.getContext('2d').clearRect(0, 0, this.stains.width, this.stains.height);
    this.pieces = null;
    this.mode = 'bench';
    this.resize();
    this._progress(true);
  }

  // ── input ─────────────────────────────────────────────────
  _bind() {
    const el = this.cv;
    const pos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener('pointerdown', (e) => {
      this._dragged = false;
      if (this.auto || this.ptr) return;
      A.unlock();
      const [x, y] = pos(e);
      if (this.down(x, y, e.pointerId)) { el.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    el.addEventListener('pointermove', (e) => {
      if (this.auto) return;
      const [x, y] = pos(e);
      if (this.ptr && this.ptr.id === e.pointerId) this.move(x, y);
      else if (!this.ptr && e.pointerType === 'mouse') el.style.cursor = this._hit(x, y) ? 'grab' : 'default';
    });
    const up = (e) => { if (!this.auto && this.ptr && this.ptr.id === e.pointerId) this.up(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  _toLocal(p, x, y) {
    const dx = x - p.x, dy = y - p.y, c = Math.cos(-p.a), s = Math.sin(-p.a);
    return [dx * c - dy * s, dx * s + dy * c];
  }

  _hit(x, y) {
    const { cup, lid, sleeve, press } = this.pieces || {};
    if (!cup) return null;
    if (this.mode === 'store') return this._inCup(x, y) ? 'cup' : null;
    const H = this.hc, g = this.g, pg = this.pg, pad = Math.max(10, H * 0.08);
    const tests = {
      lid: () => {
        const [lx, ly] = lid.attached ? this._seat() : [lid.x, lid.y];
        return Math.abs(x - lx) < g.lidW / 2 + pad * 0.5 && y > ly - H * 0.15 - pad && y < ly + g.ry + pad * 0.6;
      },
      sleeve: () => {
        const [sx, sy] = this._sleevePos();
        return Math.abs(x - sx) < g.tw * 0.55 && Math.abs(y - sy) < g.sleeveH * 0.62 + pad * 0.3;
      },
      press: () => {
        const [lx, ly] = this._toLocal(press, x, y), fx = lx * press.face;
        return fx > -pg.gw / 2 - pg.handle - pad && fx < pg.gw / 2 + pad && ly < pad && ly > -(pg.base + pg.gh + pg.cap + pg.rod + pg.knob * 2) - pad;
      },
      cup: () => this._inCup(x, y),
    };
    // front-most first: attached lid/sleeve ride on the cup; free pieces by depth
    const z = (k) => {
      const p = this.pieces[k];
      if (k === 'lid' && p.attached) return cup.y + 2;
      if (k === 'sleeve' && (p.attached || p.threaded)) return cup.y + 1;
      return p.y;
    };
    const order = ['lid', 'sleeve', 'press', 'cup'].sort((a, b) => z(b) - z(a));
    for (const k of order) if (tests[k]()) return k;
    return null;
  }
  _inCup(x, y) {
    const c = this.pieces.cup, H = this.hc;
    return Math.abs(x - c.x) < this.g.tw / 2 + 12 && y < c.y + 14 && y > c.y - H - this.g.ry - 16;
  }

  down(x, y, id = 'auto', force) {
    const k = force || this._hit(x, y);
    if (!k) return false;
    const P0 = this.pieces, p = P0[k];
    this.idle = 0; this._dragged = false;
    this.ptr = { id, x, y, sx: x, sy: y, kind: k, mode: null, t: this.t };
    if (k === 'lid' && p.attached) { this.ptr.mode = 'pry'; return true; }
    if (k === 'sleeve' && p.attached) { this.ptr.mode = 'sleeve?'; return true; }
    this._grab(k, x, y);
    return true;
  }

  _grab(k, x, y) {
    const p = this.pieces[k];
    if (k === 'sleeve' && (p.attached || p.threaded)) {
      // pulling the sleeve along the cup axis
      p.attached = false; p.threaded = true; p.sliding = false;
      this.ptr.mode = 'thread'; this.ptr.offS = p.s - (this.pieces.cup.y - y);
    } else {
      if (k === 'lid' && p.attached) { const [lx, ly] = this._seat(); p.x = lx; p.y = ly; p.attached = false; }
      this.ptr.mode = 'drag';
      this.ptr.offX = x - p.x; this.ptr.offY = y - p.y;
    }
    p.held = true; p.vx = p.vy = 0; if (k === 'press') p.intent = 0;
    this.ptr.kind = k; this._grabbing = true;
    this.ptr.groundY = clamp(p.y, this.gt, this.gt + this.depth);
    if (k === 'cup') this.ptr.groundY = clamp(p.y, this.gt, this.gt + this.depth);
    this.hooks.onGrab && this.hooks.onGrab(k);
  }

  move(x, y) {
    const q = this.ptr; if (!q) return;
    q.x = x; q.y = y; this.idle = 0;
    const d = Math.hypot(x - q.sx, y - q.sy);
    if (d > 6) this._dragged = true;
    if (q.mode === 'pry') {
      // the lid resists before it pops off
      const lift = Math.max(0, q.sy - y);
      this.pieces.cup.lidOff = -Math.min(lift * 0.25, 7);
      if (lift > this.hc * 0.22 || d > this.hc * 0.35) {
        this.pieces.cup.lidOff = 0;
        A.pop(); A.haptic(8);
        this.pieces.lid.attached = false;
        this._progress();
        this._grab('lid', x, y);
      }
    } else if (q.mode === 'sleeve?') {
      if (d > 8) {
        if (Math.abs(y - q.sy) > Math.abs(x - q.sx)) this._grab('sleeve', q.sx, q.sy);
        else this._grab('cup', q.sx, q.sy);
        this.move(x, y);
      }
    }
  }

  up() {
    const q = this.ptr; if (!q) return;
    this.ptr = null;

    const P0 = this.pieces;
    if (q.mode === 'pry') { P0.cup.lidOff = 0; return; }
    if (q.mode === 'sleeve?') return;
    const p = P0[q.kind];
    p.held = false;
    if (q.kind === 'lid' && this._lidMagnet()) {
      const [, sy] = this._seat();
      if (p.y > sy - this.hc * 0.35) return this._snapLid();
    }
    if (q.kind === 'sleeve' && p.threaded) { p.sliding = true; p.sv = Math.min(0, p.sv); return; }
    if (q.kind === 'sleeve' && this._dropSleeve(p)) return;
    if (q.kind === 'sleeve') p._wasAbove = false;
    p.groundY = q.groundY;
    // a light toss keeps some momentum; clamp so it can't leave the screen
    p.vx = clamp(p.vx, -1600, 1600); p.vy = clamp(p.vy, -1600, 1600);
  }

  // ── geometry helpers ─────────────────────────────────────
  _seat() {
    const c = this.pieces.cup, H = this.hc * (1 - c.squash);
    return [c.x + Math.sin(c.a) * H, c.y - Math.cos(c.a) * H + c.lidOff];
  }
  _sleevePos() {
    const s = this.pieces.sleeve, c = this.pieces.cup;
    if (s.attached || s.threaded) return [c.x + Math.sin(c.a) * s.s, c.y - Math.cos(c.a) * s.s];
    return [s.x, s.y - this.g.sleeveH / 2];
  }
  _lidMagnet() {
    const l = this.pieces.lid, c = this.pieces.cup;
    if (l.attached) return false;
    const [sx, sy] = this._seat();
    return Math.abs(l.x - sx) < this.g.rx * 0.75 && l.y > sy - this.hc * 0.6 && l.y < sy + this.hc * 0.25 && !c.held;
  }
  _snapLid() {
    const l = this.pieces.lid, c = this.pieces.cup;
    l.attached = true; l.held = false;
    c.lidOff = -this.hc * 0.05; c.lidOffV = this.hc * 4;
    c.squash = 0; c.squashV = 0.9;
    A.lidClick(); A.haptic(14);
    if (c.fill < FULL) this._nudge('lid', 'nudgeLidFirst');
    // overfilled? a little geyser out of the sip hole
    if (c.fill > 0.97) {
      const [sx, sy] = this._seat();
      for (let i = 0; i < 14; i++) this._emit(sx, sy - this.hc * 0.1, (Math.random() - 0.5) * 260, -300 - Math.random() * 350, 0.004, 0);
      c.fill = 0.94;
    }
    this._progress();
  }

  // ── simulation ───────────────────────────────────────────
  pause(on) {
    this.paused = on;
    if (!on) { this.last = performance.now(); this._wake(); }
  }
  _wake() { if (!this._raf) this._raf = requestAnimationFrame(this._loop); }

  // Busy = something is moving. When nothing is, we only redraw at ~20fps for
  // the ambient bits (steam, the bobbing arrow), and not at all under the sheet.
  _busy() {
    if (this.ptr || this.auto || this.np || this.ripples.length) return true;
    for (const p of Object.values(this.pieces)) if (p.held || Math.abs(p.vx) > 1 || Math.abs(p.vy) > 1 || Math.abs(p.va || 0) > 0.01 || p.sliding || p.brewing) return true;
    const c = this.pieces.cup;
    return Math.abs(c.sloshV) > 0.01 || Math.abs(c.squashV) > 0.01 || Math.abs(c.lidOffV) > 0.5 || (this._doneT > 0 && !this.done) || (this.peekT != null && this.t - this.peekT < 2.4);
  }

  _loop(now) {
    this._raf = 0;
    if (this.paused) return;
    const gap = now - this.last;
    const busy = this.pieces && this._busy();
    if (busy || gap > 48) {
      const dt = Math.min(0.033, gap / 1000);
      this.last = now; this.t += dt;
      if (this.pieces && this.W) {
        for (let i = 0; i < 2; i++) this._step(dt / 2);
        this._render();
      }
    }
    this._wake();
  }

  _step(dt) {
    const { cup, press, lid, sleeve } = this.pieces;
    // however a drag ends (release, snap, resize), tell the UI once
    if (this._grabbing && !this.ptr) { this._grabbing = false; this.hooks.onRelease && this.hooks.onRelease(); }
    this.idle += dt;
    const q = this.ptr;
    const groundOf = (p) => p.groundY ?? clamp(p.y, this.gt, this.gt + this.depth);

    // held pieces chase the pointer with a little weight
    for (const k of ['cup', 'press', 'lid', 'sleeve']) {
      const p = this.pieces[k];
      if (p.attached) continue;
      if (p.held && q && q.mode === 'drag' && q.kind === k) {
        let tx = q.x - q.offX, ty = q.y - q.offY;
        if (k === 'lid' && this._lidMagnet()) {
          // magnet: centre over the cup; pushing past the rim clicks it on
          const [sx, sy] = this._seat();
          tx = lerp(tx, sx, 0.85);
          if (ty > sy + this.hc * 0.06) { p.x = sx; p.y = sy; this.ptr = null; this._snapLid(); continue; }
          ty = Math.min(ty, sy);
        }
        if (k === 'sleeve') this._maybeThread(p, tx, ty);
        if (k === 'sleeve' && p.threaded) continue;
        if (k !== 'cup') {
          // keep the whole piece on screen
          const m = k === 'press' ? this.pg.gw / 2 + this.pg.handle + 4 : k === 'lid' ? this.g.lidW / 2 + 4 : this.g.tw / 2 + 4;
          tx = clamp(tx, m, this.W - m); ty = clamp(ty, this.hc * 0.9, this.gt + this.depth);
        } else {
          const minY = this.mode === 'store' ? this.storeBox.y + this.hc * 1.2 : this.hc + 30;
          tx = clamp(tx, this.g.tw / 2, this.W - this.g.tw / 2); ty = clamp(ty, minY, this.gt + this.depth);
        }
        const k1 = Math.min(1, dt * 28);
        const nx = lerp(p.x, tx, k1), ny = lerp(p.y, ty, k1);
        const nvx = (nx - p.x) / dt, nvy = (ny - p.y) / dt;
        p.ax = (nvx - p.vx) / dt;
        p.vx = lerp(p.vx, nvx, 0.5); p.vy = lerp(p.vy, nvy, 0.5);
        p.x = nx; p.y = ny;
        // swing: tilt with horizontal motion (press handles its own tilt)
        if (k !== 'press') {
          const ta = clamp(-p.vx * 0.00035, -0.35, 0.35) * (k === 'cup' ? 0.6 : 1);
          p.va += ((ta - p.a) * 220 - p.va * 22) * dt; p.a += p.va * dt;
        }
      } else if (!(k === 'sleeve' && (p.threaded))) {
        // free: gravity, settle on the counter
        const gy = groundOf(p);
        p.vy += this.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y >= gy) {
          if (p.vy > this.hc * 3) { A.thud(Math.min(1, p.vy / (this.hc * 14))); if (k === 'cup') this._jolt(p.vy); }
          p.y = gy; p.vy = p.vy > this.hc * 3 ? -p.vy * 0.22 : 0;
          p.vx *= Math.pow(0.0005, dt);
        }
        const topY = k === 'press' ? this.pg.gh + this.pg.cap + this.pg.rod + 10 : k === 'cup' ? this.hc + this.g.ry + 10 : this.hc * 0.3 + 10;
        if (p.y < topY) { p.y = topY; p.vy = Math.abs(p.vy) * 0.3; }
        const m = k === 'cup' ? this.g.tw / 2 : k === 'press' ? this.pg.gw / 2 + this.pg.handle + 4 : k === 'lid' ? this.g.lidW / 2 + 4 : this.g.tw / 2 + 4;
        if (p.x < m) { p.x = m; p.vx = Math.abs(p.vx) * 0.4; }
        if (p.x > this.W - m) { p.x = this.W - m; p.vx = -Math.abs(p.vx) * 0.4; }
        p.va += ((0 - p.a) * 260 - p.va * 20) * dt; p.a += p.va * dt;
        if (Math.abs(p.vx) < 1 && p.y >= gy) p.groundY = gy;
      }
    }

    // pieces left touching the cup ease apart so the finished shot stays clean
    if (this.mode === 'bench' && !cup.held) {
      for (const k of ['press', 'lid', 'sleeve']) {
        const p = this.pieces[k];
        if (p.held || p.attached || p.threaded) continue;
        const half = k === 'press' ? this.pg.gw / 2 + (p.face > 0 ? 4 : this.pg.handle) : k === 'lid' ? this.g.lidW / 2 : this.g.tw / 2;
        const need = this.g.tw / 2 + half + 6, dx = p.x - cup.x;
        if (Math.abs(dx) < need && Math.abs(p.y - cup.y) < this.depth * 1.5 && p.y >= (p.groundY ?? p.y) - 1) {
          p.x += Math.sign(dx || (p.x < this.W / 2 ? -1 : 1)) * Math.min(need - Math.abs(dx), 260 * dt);
        }
      }
    }
    this._stepPress(dt);
    this._stepSleeve(dt);
    this._stepCup(dt);
    this._stepParticles(dt);

    // lid follows the cup if attached
    if (lid.attached) { lid.x = cup.x; lid.y = cup.y; lid.a = cup.a; }

    if (!this.done && this._complete()) {
      this._doneT = (this._doneT || 0) + dt;
      if (this._doneT > 0.45) { this.done = true; A.chime(); A.haptic(20); this.hooks.onComplete && this.hooks.onComplete(); }
    } else this._doneT = 0;
  }

  _complete() {
    const { cup, lid, sleeve } = this.pieces;
    return this.mode === 'bench' && cup.fill >= FULL && lid.attached && sleeve.attached && !cup.held;
  }

  _maybeThread(p, tx, ty) {
    const c = this.pieces.cup, g = this.g;
    // the sleeve centre is ~sleeveH/2 above its foot; s = height above the cup bottom
    const s = c.y - (ty - g.sleeveH / 2);
    const over = Math.abs(tx - c.x) < g.rx * 0.6;
    // it only goes on from above the rim, like the real thing (no ghosting through the side)
    if (!p.threaded && over && p._wasAbove && s <= this.hc + g.sleeveH * 0.35 && s > g.sleeveY - 4 && !c.held) {
      p.threaded = true; p.s = Math.max(s, g.sleeveY);
      this.ptr.mode = 'thread'; this.ptr.offS = p.s - (c.y - this.ptr.y);
      A.tick(); A.haptic(5);
    }
    p._wasAbove = over ? (p._wasAbove || s > this.hc + g.sleeveH * 0.2) : s > this.hc + g.sleeveH * 0.2;
  }

  // Dropped near the top of the cup? Let it fall on and slide down.
  _dropSleeve(p) {
    const c = this.pieces.cup, g = this.g;
    const s = c.y - (p.y - g.sleeveH / 2);
    if (Math.abs(p.x - c.x) < g.rx * 0.7 && s > g.sleeveY && s < this.hc + g.sleeveH * 1.4 && !c.held) {
      p.threaded = true; p.sliding = true; p.s = Math.min(s, this.hc + g.sleeveH * 0.3); p.sv = Math.min(0, -p.vy * 0.3);
      A.tick();
      return true;
    }
    return false;
  }

  _stepSleeve(dt) {
    const p = this.pieces.sleeve, c = this.pieces.cup, g = this.g, q = this.ptr;
    if (!p.threaded) { A.slide(0); return; }
    const snug = g.sleeveY;
    const prevS = p.s;
    if (q && q.mode === 'thread' && q.kind === 'sleeve') {
      let s = (c.y - q.y) + q.offS;
      // pull it off sideways or off the top
      if (Math.abs(q.x - c.x) > g.tw * 0.9 || s > this.hc + g.sleeveH * 0.9) {
        p.threaded = false;
        const [sx, sy] = this._sleevePos();
        p.x = sx; p.y = sy + g.sleeveH / 2;
        q.mode = 'drag'; q.offX = q.x - p.x; q.offY = q.y - p.y;
        A.slide(0);
        return;
      }
      if (s < snug) s = snug - Math.min(6, (snug - s) * 0.12); // rubber band at the snug point
      p.sv = (s - p.s) / dt;
      p.s = lerp(p.s, s, Math.min(1, dt * 30));
      p.held = true;
    } else if (p.sliding) {
      // released on the cup: it slides down under its own weight with friction
      p.sv -= this.grav * 0.35 * dt;
      p.sv *= Math.pow(0.08, dt);
      p.s += p.sv * dt;
      if (p.s <= snug) {
        p.s = snug; p.sliding = false; p.threaded = false; p.attached = true; p.held = false;
        p.squeeze = 1;
        A.sleeveSeat(); A.haptic(8);
        this._progress();
      }
    }
    A.slide(Math.abs(p.s - prevS) / dt / (this.hc * 6));
  }

  _stepPress(dt) {
    const p = this.pieces.press, c = this.pieces.cup, pg = this.pg, g = this.g, H = this.hc;
    const pivot = [0, -pg.base - pg.gh * 0.5];
    if (!p.held) {
      p.intent = 0;
      p.tilt = lerp(p.tilt, 0, Math.min(1, dt * 10));
      // run it dry, set it down, and a fresh pot brews (slowly fills back up)
      if (p.vol < 0.05 && !p.brewing && Math.abs(p.tilt) < 0.05 && p.vy === 0) { p.brewing = true; }
      if (p.brewing) { p.vol = Math.min(pg.capacity, p.vol + dt * 0.45); if (p.vol >= pg.capacity) p.brewing = false; }
      p.rate = 0; A.pour(0); return;
    }
    // which way to pour: toward the cup
    // only re-decide which way to pour when clearly to one side of the cup (no flip-flopping overhead)
    if (Math.abs(p.tilt) < 0.15 && Math.abs(c.x - p.x) > g.rx * 0.9) p.face = c.x >= p.x ? 1 : -1;
    const f = p.face;
    // predicted spout position at a typical pour angle
    const th = 1.35 * f;
    const sx = pg.spout[0] * f - pivot[0], sy = pg.spout[1] - pivot[1];
    const px = p.x + pivot[0], py = p.y + pivot[1];
    const psx = px + sx * Math.cos(th) - sy * Math.sin(th);
    const psy = py + sx * Math.sin(th) + sy * Math.cos(th);
    const mouthY = c.y - H;
    const hx = Math.abs(psx - c.x), above = mouthY - psy;
    const prox = (1 - smooth(g.rx * 0.9, g.rx * 3.0, hx)) * smooth(-H * 0.05, H * 0.15, above) * (1 - smooth(H * 1.3, H * 2.2, above));
    // Pour intent: push the press toward its spout and it starts to pour, and keeps
    // pouring while you hold it there. Pull it back (or let go) and it rights itself.
    // It tips as far as it needs to for a steady stream, so it keeps flowing as it empties.
    const fwd = (p.vx || 0) * f;
    if (this.auto) p.intent = 0;
    else if (fwd > H * 0.45) p.intent = Math.min(1, (p.intent || 0) + dt * 5);
    else if (fwd < -H * 0.6) p.intent = Math.max(0, (p.intent || 0) - dt * 8);
    // One rule for people: push toward the spout to pour, pull back to stop.
    // (Hovering over the cup only steers "Make it for me".)
    const want = this.auto ? prox : (p.intent || 0);
    // nothing left? level it out instead of tipping it upside down
    const target = this._upright || p.vol < 0.03 ? 0 : f * want * this._pourAngle(p.vol);
    // tip in smoothly, right it a little quicker (that's what stops the dribble)
    p.tilt = lerp(p.tilt, target, Math.min(1, dt * (Math.abs(target) < Math.abs(p.tilt) ? 6 : 3.5)));
    p.a = p.tilt;

    // flow: how far the spout sits below the liquid surface
    const depth = p.tilt * f > 0 ? this._spoutDepth(p.vol, Math.abs(p.tilt)) : -1;
    const rate = depth > 0 ? Math.min(0.5, 0.06 + depth / (H * 0.14) * 0.3) : 0;
    p.rate = lerp(p.rate, rate, Math.min(1, dt * 12));
    if (p.rate > 0.01 && p.vol > 0) {
      const dv = Math.min(p.vol, p.rate * dt);
      p.vol -= dv;
      const ca = Math.cos(p.tilt), sa = Math.sin(p.tilt);
      const wx = px + sx * ca - sy * sa, wy = py + sx * sa + sy * ca;
      // spout direction: local +x (mirrored), rotated
      const dx = f * ca, dy = f * sa;
      const n = 3;
      for (let i = 0; i < n; i++) this._emit(wx + (Math.random() - 0.5) * 1.5, wy, dx * H * 0.6 + p.vx * 0.4, dy * H * 0.6 + p.vy * 0.4, dv / n, 1);
      const intoCup = !this.pieces.lid.attached && Math.abs(wx - c.x) < g.rx;
      A.pour(Math.min(1, p.rate * 1.6), c.fill, intoCup);
      if (this.pieces.lid.attached && Math.abs(wx - c.x) < g.rx * 1.2) this._nudge('lid', 'nudgeLidFirst');
    } else A.pour(0);
    if (p.vol <= 0.02 && Math.abs(p.tilt) > 1 && this.pieces.cup.fill < FULL) this._nudge('empty', 'nudgeEmpty');
  }

  _spoutWorld() {
    const p = this.pieces.press, pg = this.pg, f = p.face;
    const pivot = [0, -pg.base - pg.gh * 0.5];
    const sx = pg.spout[0] * f - pivot[0], sy = pg.spout[1] - pivot[1];
    const ca = Math.cos(p.tilt), sa = Math.sin(p.tilt);
    return [p.x + pivot[0] + sx * ca - sy * sa, p.y + pivot[1] + sx * sa + sy * ca];
  }

  // liquid polygon of the glass at a tilt (local frame, spout at +x)
  _liquid(vol, tilt) {
    const gl = this.pg.glass;
    const rect = [[gl.x0, gl.y0], [gl.x1, gl.y0], [gl.x1, gl.y1], [gl.x0, gl.y1]];
    const area = (gl.x1 - gl.x0) * (gl.y1 - gl.y0);
    const frac = clamp(vol / (this.pg.capacity / 0.8), 0, 1);
    const n = [Math.sin(tilt), Math.cos(tilt)]; // world-down expressed locally
    const dot = (p) => p[0] * n[0] + p[1] * n[1];
    let lo = Math.min(...rect.map(dot)), hi = Math.max(...rect.map(dot));
    let poly = [];
    for (let i = 0; i < 18; i++) {
      const d = (lo + hi) / 2;
      poly = clipHalf(rect, n, d);
      if (polyArea(poly) > frac * area) lo = d; else hi = d;
    }
    return { poly, d: (lo + hi) / 2, n };
  }
  _spoutDepth(vol, tilt) {
    if (vol <= 0.001) return -1;
    const { d, n } = this._liquid(vol, tilt);
    const sp = [this.pg.glass.x1, this.pg.glass.y0];
    return sp[0] * n[0] + sp[1] * n[1] - d;
  }
  // The angle that gives a steady stream at this fill level: the spout sits a fixed
  // depth under the surface. Fuller pot → small tilt; nearly empty → tipped right over.
  _pourAngle(vol) {
    const key = this.hc + ':' + Math.round(vol * 60);
    this._angCache = this._angCache || {};
    if (this._angCache[key] !== undefined) return this._angCache[key];
    const want = this.hc * 0.12;
    let a = 0.1;
    for (; a < 2.9; a += 0.03) if (this._spoutDepth(vol, a) >= want) break;
    return (this._angCache[key] = Math.min(a, 2.9));
  }

  _jolt(v) {
    const c = this.pieces.cup;
    c.sloshV += (Math.random() - 0.5) * v * 0.004;
    c.squashV += v / (this.hc * 60);
  }

  _stepCup(dt) {
    const c = this.pieces.cup, g = this.g, H = this.hc;
    // slosh: surface offset driven by cup acceleration
    const ax = c.held ? (c.ax || 0) : 0;
    c.sloshV += (-c.slosh * 90 - c.sloshV * 6 - ax * 0.0009) * dt;
    c.slosh += c.sloshV * dt;
    c.slosh = clamp(c.slosh, -1.2, 1.2);
    if (!this.pieces.lid.attached && c.fill > 0.7 && Math.abs(c.slosh) > 0.45) {
      // it sloshes over the rim
      const side = Math.sign(c.slosh);
      const amt = Math.min(c.fill - 0.6, dt * 0.6 * Math.abs(c.slosh));
      c.fill -= amt;
      const [sx, sy] = [c.x + side * g.rx * 0.9, c.y - H];
      for (let i = 0; i < 2; i++) this._emit(sx, sy, side * (60 + Math.random() * 120) + c.vx * 0.5, -40 - Math.random() * 60 + c.vy * 0.3, amt / 2, 0);
    }
    // overflow: pour too much and it runs down the side
    if (c.fill > 1.0) {
      const extra = c.fill - 1.0; c.fill = 1.0;
      const side = Math.random() < 0.5 ? -1 : 1;
      this._emit(c.x + side * g.rx * 0.97, c.y - H + 2, side * 20, 10, extra, 2);
    }
    // lid seat spring + squash spring
    c.lidOffV += (-c.lidOff * 900 - c.lidOffV * 28) * dt; if (!this.ptr || this.ptr.mode !== 'pry') c.lidOff += c.lidOffV * dt;
    c.squashV += (-c.squash * 700 - c.squashV * 20) * dt; c.squash += c.squashV * dt;
    c.squash = clamp(c.squash, -0.06, 0.06);
    const sl = this.pieces.sleeve; sl.squeeze = Math.max(0, sl.squeeze - dt * 4);
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 0.9);
  }

  _emit(x, y, vx, vy, v, flag) {
    const P = this.parts;
    let i = this.np < MAXP ? this.np++ : Math.floor(Math.random() * MAXP);
    P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy; P.v[i] = v; P.f[i] = flag; P.g[i] = this.pieces.cup.y + 2 + Math.random() * this.depth * 0.25;
  }

  _stepParticles(dt) {
    const Q = this.parts, c = this.pieces.cup, g = this.g, H = this.hc;
    const lidOn = this.pieces.lid.attached;
    const mouthY = c.y - H * (1 - c.squash) + g.ry * 0.1;
    const sctx = this.stains.getContext('2d');
    let w = 0;
    for (let i = 0; i < this.np; i++) {
      let x = Q.x[i], y = Q.y[i], vx = Q.vx[i], vy = Q.vy[i];
      const py = y;
      if (Q.f[i] === 2) { vy = Math.min(vy + this.grav * 0.25 * dt, H * 1.2); vx *= 0.9; } // drip clinging to the cup
      else vy += this.grav * dt;
      x += vx * dt; y += vy * dt;
      let dead = false;
      const dx = Math.abs(x - c.x);
      if (Q.f[i] !== 2 && py < mouthY && y >= mouthY && dx < g.rx * 0.92) {
        if (lidOn) {
          // bounces off the lid
          vy = -Math.abs(vy) * 0.25; vx = (x > c.x ? 1 : -1) * (80 + Math.random() * 160); y = mouthY - 2;
          Q.f[i] = 3;
          this._splashSound();
        } else if (Q.f[i] !== 3) {
          c.fill += Q.v[i];
          if (Math.random() < 0.25) this.ripples.push({ x: (x - c.x) / g.rx, t: 0 });
          c.sloshV += (Math.random() - 0.5) * 0.4;
          dead = true;
        }
      }
      if (!dead && y >= Q.g[i]) {
        // lands on the counter: leaves a stain
        this.spilled += Q.v[i];
        const r = H * (0.045 + Math.min(0.08, Q.v[i] * 3)) * (0.7 + Math.random() * 0.6);
        sctx.save(); sctx.scale(this.dpr, this.dpr);
        // a little coffee puddle: pale wash, darker ring where it dries
        // soft overlapping washes merge into a puddle; only a faint drying edge
        sctx.fillStyle = P.coffeeHi; sctx.globalAlpha = 0.12;
        sctx.beginPath(); sctx.ellipse(x + (Math.random() - 0.5) * 6, Q.g[i], r * 1.8, r * 0.55, 0, 0, Math.PI * 2); sctx.fill();
        if (Math.random() < 0.3) { sctx.globalAlpha = 0.12; sctx.lineWidth = 0.6; sctx.strokeStyle = P.coffee; sctx.stroke(); }
        sctx.restore();
        if (Math.random() < 0.08 && Q.f[i] !== 4) { this._emit(x, Q.g[i] - 1, (Math.random() - 0.5) * 160, -120 - Math.random() * 120, 0, 4); }
        this._splashSound();
        dead = true;
      }
      if (!dead && (x < -50 || x > this.W + 50 || y > this.H + 50)) dead = true;
      if (!dead) { Q.x[w] = x; Q.y[w] = y; Q.vx[w] = vx; Q.vy[w] = vy; Q.v[w] = Q.v[i]; Q.f[w] = Q.f[i]; Q.g[w] = Q.g[i]; w++; }
    }
    this.np = w;
    if (c.fill > 0.02 && this._lastFillReport !== Math.round(c.fill * 20)) { this._lastFillReport = Math.round(c.fill * 20); this._progress(); }
  }

  _splashSound() { if (this.t - this.lastSplash > 0.09) { this.lastSplash = this.t; A.splash(); } }

  _nudge(key, copyKey) {
    if (this.nudged[key] || this.auto || this.done || this._doneT > 0 || this.mode !== 'bench') return;
    if (!this.hooks.nudgeKeys || !this.hooks.nudgeKeys.includes(copyKey)) return;
    this.nudged[key] = true;
    this.hooks.onNudge && this.hooks.onNudge(copyKey);
  }

  _progress(force) {
    const { cup, lid, sleeve } = this.pieces || {};
    if (!cup) return;
    const st = { pour: cup.fill >= FULL, sleeve: sleeve.attached, lid: lid.attached, fill: Math.min(1, cup.fill / FULL) };
    const key = JSON.stringify([st.pour, st.sleeve, st.lid]);
    if (force || key !== this._pkey) { this._pkey = key; this.hooks.onProgress && this.hooks.onProgress(st); }
  }

  next() {
    const { cup, lid, sleeve } = this.pieces;
    if (cup.fill < FULL) return lid.attached ? 'lid' : 'press';
    if (!sleeve.attached) return 'sleeve';
    if (!lid.attached) return 'lid';
    return null;
  }

  // ── rendering ─────────────────────────────────────────────
  _render() {
    const x = this.ctx, d = this.dpr;
    x.setTransform(d, 0, 0, d, 0, 0);
    x.clearRect(0, 0, this.W, this.H);
    if (this.mode === 'store') this._renderStoreBg(x);
    if (this.mode === 'bench') { x.save(); x.setTransform(d, 0, 0, d, -10 * d, (this.gt - this.depth * 0.12) * d); drawSprite(x, this.counter); x.restore(); }
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(this.stains, 0, 0); x.setTransform(d, 0, 0, d, 0, 0);

    const { cup, press, lid, sleeve } = this.pieces;
    const list = [];
    if (this.mode === 'bench') {
      list.push({ z: press.held ? 1e5 : press.y, f: () => this._drawPress(x) });
      if (!lid.attached) list.push({ z: lid.held ? 1e5 + 1 : lid.y, f: () => this._drawLid(x, lid.x, lid.y, lid.a, false) });
      if (!sleeve.attached && !sleeve.threaded) list.push({ z: sleeve.held ? 1e5 + 1 : sleeve.y, f: () => this._drawSleeveFree(x) });
    }
    list.push({ z: cup.held ? 1e5 : cup.y + 0.5, f: () => this._drawCup(x) });
    list.sort((a, b) => a.z - b.z).forEach((it) => it.f());
    this._drawParticles(x);
    if (this.mode === 'bench') this._drawHint(x);
    if (this.mode === 'store') this._drawStoreFg(x);
  }

  _ground(x, px, py, w, lift = 0) {
    x.save();
    x.globalAlpha = 0.16 * (1 - Math.min(1, lift / (this.hc * 1.2)));
    x.fillStyle = P.ink;
    x.beginPath(); x.ellipse(px, py + 2, w * (0.55 + 0.15 * Math.min(1, lift / this.hc)), w * 0.1, 0, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  _drawCup(x) {
    const c = this.pieces.cup, g = this.g, H = this.hc, S = this.spr;
    const gy = c.held ? (this.ptr ? this.ptr.groundY : c.y) : (c.groundY ?? c.y);
    this._ground(x, c.x, Math.max(gy, c.y), g.bw, Math.max(0, gy - c.y));
    x.save();
    x.translate(c.x, c.y); x.rotate(c.a); x.scale(1 + c.squash * 0.6, 1 - c.squash);
    drawSprite(x, S.cup.body);
    // coffee surface, seen through the mouth
    if (c.fill > 0.004) {
      const f = Math.min(1, c.fill);
      x.save();
      x.beginPath(); x.ellipse(0, -H, g.rx * 0.95, g.ry * 0.88, 0, 0, Math.PI * 2); x.clip();
      const cy = -H + (1 - f) * g.ry * 1.7;
      const rx = g.rx * 0.95 * (0.8 + 0.2 * f), ry = rx * K;
      const ox = c.slosh * rx * 0.22;
      const grd = x.createRadialGradient(ox - rx * 0.3, cy - ry * 0.3, 1, ox, cy, rx);
      grd.addColorStop(0, P.crema); grd.addColorStop(0.55, P.coffeeHi); grd.addColorStop(1, P.coffee);
      x.fillStyle = grd;
      x.beginPath(); x.ellipse(ox, cy, rx, ry, c.slosh * 0.06, 0, Math.PI * 2); x.fill();
      // ripples from the pour
      x.strokeStyle = '#e8c79c'; x.lineWidth = 0.9;
      for (const r of this.ripples) {
        const k = r.t / 0.9;
        x.globalAlpha = 0.5 * (1 - k);
        x.beginPath(); x.ellipse(ox + r.x * rx * 0.6, cy, rx * (0.1 + k * 0.5), ry * (0.1 + k * 0.5), 0, 0, Math.PI * 2); x.stroke();
      }
      x.restore();
    }
    x.translate(0, -H); drawSprite(x, S.cup.rim);
    x.restore();

    // sleeve (attached / threaded) + lid on top, in cup frame
    const sl = this.pieces.sleeve;
    if (sl.attached || sl.threaded) {
      const [sx, sy] = this._sleevePos();
      const w0 = g.widthAt(g.sleeveY);
      const sc = clamp(g.widthAt(Math.min(sl.s, H)) / w0, 0.9, 1.3);
      x.save(); x.translate(sx, sy); x.rotate(c.a);
      x.scale(sc * (1 + sl.squeeze * 0.03), 1 - sl.squeeze * 0.03);
      drawSprite(x, S.sleeve);
      x.restore();
    }
    if (this.pieces.lid.attached) {
      const [lx, ly] = this._seat();
      this._drawLid(x, lx, ly, c.a, true);
    }
    if (this.done || this.mode === 'store') this._steam(x);
  }

  _drawLid(x, px, py, a, attached) {
    const l = this.pieces.lid;
    if (!attached) {
      const mag = this.mode === 'bench' && l.held && this._lidMagnet();
      if (mag) {
        // ghost guide: where it'll seat
        const [sx, sy] = this._seat();
        x.save(); x.globalAlpha = 0.18 + 0.1 * Math.sin(this.t * 8);
        x.strokeStyle = P.ink; x.setLineDash([4, 4]); x.lineWidth = 1.2;
        x.beginPath(); x.ellipse(sx, sy, this.g.lidW / 2, this.g.lidW / 2 * K, 0, 0, Math.PI * 2); x.stroke();
        x.restore();
      }
      const gy = l.held ? (this.ptr ? this.ptr.groundY : l.y) : (l.groundY ?? l.y);
      if (!mag) this._ground(x, l.x, Math.max(gy, l.y), this.g.lidW * 0.9, Math.max(0, gy - l.y));
    }
    x.save(); x.translate(px, py); x.rotate(a); drawSprite(x, this.spr.lid); x.restore();
  }

  _drawSleeveFree(x) {
    const s = this.pieces.sleeve, g = this.g;
    const gy = s.held ? (this.ptr ? this.ptr.groundY : s.y) : (s.groundY ?? s.y);
    this._ground(x, s.x, Math.max(gy, s.y), g.tw * 0.8, Math.max(0, gy - s.y));
    x.save(); x.translate(s.x, s.y - g.sleeveH / 2); x.rotate(s.a); drawSprite(x, this.spr.sleeveFree); x.restore();
  }

  _drawPress(x) {
    const p = this.pieces.press, pg = this.pg, S = this.spr.press;
    const pivot = [0, -pg.base - pg.gh * 0.5];
    const gy = p.held ? (this.ptr ? this.ptr.groundY : p.y) : (p.groundY ?? p.y);
    this._ground(x, p.x, Math.max(gy, p.y), pg.gw * 1.2, Math.max(0, gy - p.y));
    x.save();
    x.translate(p.x + pivot[0], p.y + pivot[1]); x.rotate(p.tilt); x.translate(-pivot[0], -pivot[1]);
    x.scale(p.face, 1);
    drawSprite(x, S.back);
    // liquid stays level in world space
    if (p.vol > 0.003) {
      const { poly } = this._liquid(p.vol, p.tilt * p.face);
      if (poly.length > 2) {
        x.fillStyle = P.coffee; x.globalAlpha = 0.92;
        x.beginPath(); poly.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.fill();
        x.globalAlpha = 1;
      }
    }
    // plunger screen sits above the coffee
    drawSprite(x, S.front);
    x.restore();
  }

  _drawParticles(x) {
    const Q = this.parts, n = this.np;
    if (!n) return;
    const r0 = Math.max(1.4, this.hc * 0.02), link = this.hc * 0.3;
    x.save();
    x.strokeStyle = P.coffee; x.fillStyle = P.coffee; x.lineCap = 'round'; x.lineJoin = 'round';
    x.globalAlpha = 0.92;
    // consecutive particles from the same pour are joined into one ribbon: reads as liquid
    x.lineWidth = r0 * 1.7;
    x.beginPath();
    let open = false;
    for (let i = 0; i < n; i++) {
      const cont = i > 0 && (Q.f[i] === 1 || Q.f[i] === 2) && Q.f[i - 1] === Q.f[i] && Math.abs(Q.x[i] - Q.x[i - 1]) + Math.abs(Q.y[i] - Q.y[i - 1]) < link;
      if (cont) { if (!open) { x.moveTo(Q.x[i - 1], Q.y[i - 1]); open = true; } x.lineTo(Q.x[i], Q.y[i]); }
      else open = false;
    }
    x.stroke();
    // loose drops: small, round, slightly stretched by speed
    for (let i = 0; i < n; i++) {
      const lk = Q.f[i] === 1 || Q.f[i] === 2;
      const joined = lk && ((i > 0 && Q.f[i - 1] === Q.f[i]) || (i < n - 1 && Q.f[i + 1] === Q.f[i]));
      if (joined) continue;
      const r = Q.f[i] === 1 ? r0 * 0.8 : r0 * 0.6;
      const sp = Math.hypot(Q.vx[i], Q.vy[i]);
      x.beginPath();
      x.ellipse(Q.x[i], Q.y[i], r + Math.min(r * 1.5, sp * 0.002), r, Math.atan2(Q.vy[i], Q.vx[i]), 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  _steam(x) {
    const c = this.pieces.cup, [sx, sy] = this._seat();
    x.save();
    for (let k = 0; k < 3; k++) {
      const ph = (this.t * 0.35 + k / 3) % 1;
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const u = i / 14;
        pts.push([sx + (k - 1) * this.hc * 0.07 + Math.sin(u * 5 + this.t * 2 + k * 2) * this.hc * 0.05 * u, sy - this.hc * 0.12 - u * this.hc * 0.5 - ph * this.hc * 0.15]);
      }
      liveLine(x, pts, P.ink, 1.1, 0.35 * Math.sin(ph * Math.PI), k);
    }
    x.restore();
  }

  // the arrow — a nod to the arrow on the papered window
  _drawHint(x) {
    if (this.done || this.ptr || this.auto || this.idle < 1.1) return;
    const k = this.next(); if (!k) return;
    let tx, ty;
    if (k === 'press') { const p = this.pieces.press; tx = p.x + this.pg.gw * 0.1 * p.face; ty = p.y - this.pg.gh - this.pg.cap - this.pg.rod - this.hc * 0.12; }
    else if (k === 'sleeve') { const [sx, sy] = this._sleevePos(); tx = sx; ty = sy - this.g.sleeveH * 0.6; }
    else { const l = this.pieces.lid; const [lx, ly] = l.attached ? this._seat() : [l.x, l.y]; tx = lx; ty = ly - this.hc * 0.16; }
    const bob = Math.sin(this.t * 4) * 4;
    const a = Math.min(1, (this.idle - 1.1) * 2);
    const side = tx < this.W / 2 ? 1 : -1;
    let p0 = [tx + side * this.hc * 0.55, ty - this.hc * 0.55 + bob];
    const p1 = [tx + side * 4, ty - 6 + bob];
    const ceil = (this.textBottom || 0) + 10;
    if (p0[1] < ceil) p0 = [tx + side * this.hc * 0.75, Math.max(ceil, ty - this.hc * 0.2) + bob];
    const pts = bezPts(p0, [p0[0] - side * this.hc * 0.05, p0[1] + this.hc * 0.3], [p1[0] + side * this.hc * 0.25, p1[1] - this.hc * 0.05], p1, 18);
    liveLine(x, pts, P.ink, 2, 0.85 * a, 1);
    const ang = Math.atan2(p1[1] - pts[15][1], p1[0] - pts[15][0]);
    const h = 9;
    liveLine(x, [[p1[0] - Math.cos(ang - 0.5) * h, p1[1] - Math.sin(ang - 0.5) * h], p1, [p1[0] - Math.cos(ang + 0.5) * h, p1[1] - Math.sin(ang + 0.5) * h]], P.ink, 2, 0.85 * a, 2);
  }

  // ── autoplay ("Make it for me") ───────────────────────────
  async autoplay() {
    if (this.auto || this.done) return;
    this.auto = true; A.unlock();
    const P0 = this.pieces, H = this.hc, g = this.g, pg = this.pg;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms)).then(() => { if (gen !== this._gen) throw new Error('layout changed'); });
    const gen = this._gen;
    const glide = async (x0, y0, x1, y1, ms) => {
      const t0 = performance.now();
      while (true) {
        if (gen !== this._gen) throw new Error('layout changed');
        const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.move(lerp(x0, x1, e), lerp(y0, y1, e));
        if (k >= 1) break;
        await new Promise(requestAnimationFrame);
      }
    };
    try {
      if (P0.lid.attached) { const [lx, ly] = this._seat(); this.down(lx, ly - H * 0.05, 'auto', 'lid'); await glide(lx, ly - H * 0.05, lx, ly - H * 0.5, 350); await glide(lx, ly - H * 0.5, this.home.lid[0], this.home.lid[1] - H * 0.4, 400); this.up(); await wait(400); }
      if (P0.cup.fill < FULL) {
        const p = P0.press, gx = p.x, gy = p.y - pg.base - pg.gh * 0.5;
        if (p.vol < 1) { p.vol = pg.capacity; p.brewing = false; }
        this.down(gx, gy, 'auto', 'press');
        const c = P0.cup, f = c.x >= p.x ? 1 : -1;
        const tx = c.x - f * (pg.gh * 0.5 + H * 0.05), ty = c.y - H - H * 0.42;
        const ox = this.ptr.offX, oy = this.ptr.offY;
        await glide(gx, gy, tx + ox - 0, ty + oy - (-pg.base - pg.gh * 0.5) * 0 - 0, 900);
        const t0 = performance.now();
        let px0 = tx + ox;
        // steer like a person would: keep the stream landing mid-cup
        while (c.fill < FULL + 0.05 && p.vol > 0.03 && performance.now() - t0 < 9000) {
          if (gen !== this._gen) throw new Error('layout changed');
          if (Math.abs(p.tilt) > 0.6) { const [sxw] = this._spoutWorld(); px0 += ((c.x - f * g.rx * 0.12) - sxw) * 0.12; this.move(px0, ty + oy); }
          await new Promise(requestAnimationFrame);
        }
        this._upright = true;
        await wait(450);
        const bx = px0 - f * H * 0.6, by = ty + oy;
        await glide(px0, ty + oy, bx, by, 350);
        await glide(bx, by, this.home.press[0] + ox, this.home.press[1] - H * 0.3 + oy, 600);
        this.up(); this._upright = false; await wait(450);
      }
      if (!P0.sleeve.attached) {
        const [sx, sy] = this._sleevePos(); this.down(sx, sy, 'auto', 'sleeve');
        const c = P0.cup, top = c.y - H - g.sleeveH * 0.9;
        await glide(sx, sy, sx, top, 420);
        await glide(sx, top, c.x, top, 520);
        await wait(120);
        await glide(c.x, top, c.x, c.y - g.sleeveY - H * 0.05, 520);
        this.up(); await wait(700);
      }
      if (!P0.lid.attached) {
        const l = P0.lid; this.down(l.x, l.y - H * 0.05, 'auto', 'lid');
        const [sx, sy] = this._seat();
        await glide(l.x, l.y - H * 0.05, sx, sy - H * 0.4, 700);
        await glide(sx, sy - H * 0.4, sx, sy + H * 0.15, 380);
        if (this.ptr) this.up();
      }
    } catch (e) {
      // layout changed mid-run (rotation): stop cleanly; tapping again restarts
      this.ptr = null;
    } finally {
      this._upright = false;
      if (this.ptr && this.auto) this.up();
      this.auto = false;
    }
  }

  // ── storefront mode ──────────────────────────────────────
  toStore(img) {
    this.mode = 'store';
    this.storeImg = img;
    this.np = 0; this.ripples = [];
    this.stains.getContext('2d').clearRect(0, 0, this.stains.width, this.stains.height);
    this._layoutStore();
  }

  _layoutStore() {
    const W = this.W, H = this.H, img = this.storeImg;
    const ar = img.naturalWidth / img.naturalHeight;
    const top = this.storeTop || H * 0.3;
    const bottom = H - (this.storeBottom || 24);
    let iw = Math.min(W - 24, 820, (bottom - top) * ar);
    const ih = iw / ar;
    const ix = (W - iw) / 2, iy = top + Math.max(0, (bottom - top - ih) * 0.45);
    this.storeBox = { x: ix, y: iy, w: iw, h: ih };
    const hc = clamp(iw * 0.1, 40, 110);
    this._build(hc);
    this.gt = iy + ih * 0.895; this.depth = ih * 0.07;
    if (!this.pieces) this._spawn();
    const c = this.pieces.cup;
    c.x = ix + iw * 0.335; c.y = this.gt + this.depth * 0.6; c.vx = c.vy = 0; c.a = 0; c.held = false; c.groundY = c.y;
    c.fill = Math.max(c.fill, FULL);
    this.pieces.lid.attached = true; this.pieces.sleeve.attached = true; this.pieces.sleeve.threaded = false; this.pieces.sleeve.s = this.g.sleeveY;
    this.home = { cup: [c.x, c.y] };
    this.paper = buildPaper(this.storeBox, this.dpr);
    this.peek = 0;
  }

  tapStore(x, y) {
    const t = this.paper && this.paper.tear;
    if (!t) return false;
    if (Math.hypot(x - t.x, y - t.y) < t.r * 2.2) { this.peekT = this.t; A.unlock(); A.pop(); A.haptic(10); this.hooks.onPeek && this.hooks.onPeek(); return true; }
    return false;
  }

  _renderStoreBg(x) {
    const b = this.storeBox;
    x.save(); x.globalCompositeOperation = 'multiply';
    x.drawImage(this.storeImg, b.x, b.y, b.w, b.h);
    x.restore();
    // the tear opens a little when tapped, then settles back
    const since = this.peekT != null ? this.t - this.peekT : 9;
    const open = since < 2.2 ? Math.sin(Math.min(1, since / 0.35) * Math.PI / 2) * (1 - smooth(1.6, 2.2, since)) : 0;
    drawPaper(x, this.paper, b, open, this.storeImg, this.t);
  }
  _drawStoreFg() {}
}

// ── polygon helpers ──────────────────────────────────────────
function clipHalf(poly, n, d) {
  // keep points p with dot(p,n) >= d
  const out = [], dot = (p) => p[0] * n[0] + p[1] * n[1] - d;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = dot(a), db = dot(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

// ── storefront paper (kraft paper over the windows, one tear + arrow) ─
// Window rectangles in the illustration's own pixel space (1024 × 943).
const PANES = [
  [246, 423, 414, 832],
  [430, 424, 604, 832],
  [617, 423, 798, 832],
  [897, 408, 1024, 838],
];
const TEAR = [700, 560]; // on the right-hand window
const TEAR_R = 34;

function buildPaper(box, dpr) {
  const s = box.w / 1024;
  const c = mk(box.w * dpr, box.h * dpr), x = c.getContext('2d');
  x.scale(dpr * s, dpr * s);
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [x0, y0, x1, y1] of PANES) {
    x.save(); x.globalAlpha = 1;
    x.beginPath(); x.rect(x0, y0, x1 - x0, y1 - y0); x.clip();
    x.fillStyle = '#d9c3a0'; x.fillRect(x0, y0, x1 - x0, y1 - y0);
    // sheets of paper with seams, creases and hatch
    x.strokeStyle = P.ink; x.lineCap = 'round';
    for (let k = 0; k < 160; k++) {
      x.globalAlpha = 0.08 + r() * 0.08; x.lineWidth = 0.8;
      const yy = y0 + r() * (y1 - y0), xx = x0 + r() * (x1 - x0);
      x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx + 14 + r() * 10, yy - 22 - r() * 10); x.stroke();
    }
    x.globalAlpha = 0.5; x.lineWidth = 1.4;
    const seam = y0 + (y1 - y0) * (0.42 + r() * 0.1);
    x.beginPath(); x.moveTo(x0, seam); for (let xx = x0; xx <= x1; xx += 8) x.lineTo(xx, seam + Math.sin(xx * 0.3) * 0.8); x.stroke();
    x.globalAlpha = 0.25; x.lineWidth = 1;
    x.beginPath(); x.moveTo(x0 + (x1 - x0) * 0.2, y0); x.lineTo(x0 + (x1 - x0) * 0.6, y1); x.stroke();
    x.beginPath(); x.moveTo(x1, y0 + (y1 - y0) * 0.15); x.lineTo(x0, y0 + (y1 - y0) * 0.7); x.stroke();
    // tape tabs
    x.globalAlpha = 0.75; x.fillStyle = '#efe8d2';
    for (const [tx, ty, a] of [[x0 + 14, y0 + 12, -0.6], [x1 - 14, y0 + 12, 0.6], [x0 + 14, y1 - 12, 0.6], [x1 - 14, y1 - 12, -0.6]]) {
      x.save(); x.translate(tx, ty); x.rotate(a); x.fillRect(-16, -6, 32, 12); x.restore();
    }
    x.restore();
    x.globalAlpha = 0.9; x.strokeStyle = P.ink; x.lineWidth = 2.2; x.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  x.globalAlpha = 1;
  return { c, tear: { x: box.x + TEAR[0] * s, y: box.y + TEAR[1] * s, r: Math.max(14, TEAR_R * s) } };
}

function drawPaper(x, paper, box, open, img, t) {
  const s = box.w / 1024, tr = TEAR_R * s * (1 + open * 1.7);
  const tx = box.x + TEAR[0] * s, ty = box.y + TEAR[1] * s;
  // paper layer, with a hole punched where the tear is
  const tmp = paper._tmp || (paper._tmp = mk(paper.c.width, paper.c.height));
  const tc = tmp.getContext('2d');
  const d = paper.c.width / box.w;
  tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(0, 0, tmp.width, tmp.height);
  tc.drawImage(paper.c, 0, 0);
  const pts = [];
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2, rr = tr * (0.72 + ((k * 7919) % 13) / 30);
    pts.push([(TEAR[0] * s) + Math.cos(a) * rr * 0.8, (TEAR[1] * s) + Math.sin(a) * rr]);
  }
  tc.setTransform(d, 0, 0, d, 0, 0);
  tc.globalCompositeOperation = 'destination-out';
  tc.beginPath(); pts.forEach(([a, b], i) => (i ? tc.lineTo(a, b) : tc.moveTo(a, b))); tc.closePath(); tc.fill();
  tc.globalCompositeOperation = 'source-over';
  // torn edge: lighter fibres curling outward
  tc.strokeStyle = '#f6efdc'; tc.lineWidth = 3 * s + 1; tc.globalAlpha = 0.95; tc.stroke();
  tc.strokeStyle = P.ink; tc.lineWidth = 1; tc.globalAlpha = 0.6; tc.stroke();
  tc.globalAlpha = 1;
  // warm glow inside the tear
  x.save();
  x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(box.x + a, box.y + b) : x.moveTo(box.x + a, box.y + b))); x.closePath(); x.clip();
  // behind the paper: the lights are on
  x.fillStyle = '#1d140c'; x.fillRect(tx - tr * 2, ty - tr * 2, tr * 4, tr * 4);
  const gr = x.createRadialGradient(tx - tr * 0.2, ty - tr * 0.3, 0, tx, ty, tr * 1.3);
  gr.addColorStop(0, `rgba(255,212,140,${0.55 + open * 0.45})`); gr.addColorStop(0.6, `rgba(232,150,70,${0.25 + open * 0.3})`); gr.addColorStop(1, 'rgba(60,30,10,0)');
  x.fillStyle = gr; x.fillRect(tx - tr * 2, ty - tr * 2, tr * 4, tr * 4);
  // a pendant lamp and the edge of the counter, just visible
  x.strokeStyle = 'rgba(255,236,200,.85)'; x.lineWidth = Math.max(1, 1.6 * s);
  x.beginPath(); x.moveTo(tx + tr * 0.15, ty - tr * 1.2); x.lineTo(tx + tr * 0.15, ty - tr * 0.35); x.stroke();
  x.beginPath(); x.arc(tx + tr * 0.15, ty - tr * 0.18, tr * 0.18, 0, Math.PI * 2); x.stroke();
  x.fillStyle = `rgba(255,240,205,${0.6 + open * 0.4})`; x.beginPath(); x.arc(tx + tr * 0.15, ty - tr * 0.18, tr * 0.1, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.moveTo(tx - tr * 1.2, ty + tr * 0.55); x.lineTo(tx + tr * 1.2, ty + tr * 0.45); x.stroke();
  x.restore();
  x.drawImage(tmp, box.x, box.y, box.w, box.h);
  // the arrow pointing into the tear (wiggles a touch)
  const w = Math.sin(t * 3) * 2 * s;
  const a0 = [tx - 120 * s, ty + 150 * s + w], a1 = [tx - tr * 0.9 - 4 * s, ty + tr * 0.9 + 4 * s + w];
  const pth = bezPts(a0, [a0[0] + 10 * s, a0[1] - 70 * s], [a1[0] - 60 * s, a1[1] + 20 * s], a1, 20);
  liveLine(x, pth, P.ink, Math.max(1.8, 4 * s), 0.95, 3);
  const ang = Math.atan2(a1[1] - pth[17][1], a1[0] - pth[17][0]), h = 22 * s;
  liveLine(x, [[a1[0] - Math.cos(ang - 0.55) * h, a1[1] - Math.sin(ang - 0.55) * h], a1, [a1[0] - Math.cos(ang + 0.55) * h, a1[1] - Math.sin(ang + 0.55) * h]], P.ink, Math.max(1.8, 4 * s), 0.95, 4);
}
