// Sprite builders for every piece, drawn in Saintwood's house style:
// dark forest-green pencil line art with hatching on cream paper,
// plus their forest green (sleeve) + coffee brown as the only solid colors.

import { Sketch, ellipsePts, polyPts, bezPts, mk } from './sketch.js';

export const P = {
  cream: '#fffcf0',
  ink: '#283427',     // line art green (sampled from the storefront drawing)
  inkSoft: '#4c5a4a',
  forest: '#07220f',  // "Worth Repeating" section
  oxblood: '#3d0905', // header
  brown: '#2b1303',   // footer / text
  coffee: '#3a1c0b',
  coffeeHi: '#6b3a1c',
  crema: '#9a6a3c',
  shade: '#c9cfc0',   // pale green-grey wash for shadows
  glass: '#e3ebe2',
};

export const K = 0.22; // perspective: ellipse ry / rx

// Brand marks (loaded once by main.js before sprites are built)
export const brand = { wordmark: null };
export function tinted(img, color, w) {
  const h = (img.height / img.width) * w;
  const c = mk(w, h), x = c.getContext('2d');
  x.drawImage(img, 0, 0, w, h);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, w, h);
  return c;
}

export function cupGeo(H) {
  const tw = 0.84 * H, bw = 0.6 * H;
  return {
    H, tw, bw,
    rx: tw / 2, ry: (tw / 2) * K,
    widthAt: (y) => bw + (tw - bw) * (y / H), // y = height above bottom
    sleeveH: 0.34 * H,
    sleeveY: 0.42 * H, // snug center, height above bottom
    lidW: tw * 1.07,
  };
}

function sprite(w, h, ax, ay, scale, seed, draw, finishOpts) {
  const sk = new Sketch(w, h, scale, seed);
  sk.ctx.translate(ax, ay);
  draw(sk);
  sk.finish(finishOpts);
  return { c: sk.canvas, ax, ay, w, h };
}

export function drawSprite(ctx, s, sx = 1, sy = 1) {
  ctx.drawImage(s.c, -s.ax * sx, -s.ay * sy, s.w * sx, s.h * sy);
}

function wordmarkOn(sk, x, y, w, color, alpha = 1, rot = 0) {
  if (!brand.wordmark) {
    sk.text('Saintwood', x, y, { font: `italic 400 ${w * 0.2}px Ovo, Georgia, serif`, color, alpha });
    return;
  }
  const t = tinted(brand.wordmark, color, Math.ceil(w * sk.scale));
  const h = (t.height / t.width) * w;
  const c = sk.ctx;
  c.save(); c.translate(x, y); c.rotate(rot); c.globalAlpha = alpha;
  c.drawImage(t, -w / 2, -h / 2, w, h);
  c.restore();
}

// ── Cup ──────────────────────────────────────────────────────
export function cupSprites(H, scale) {
  const g = cupGeo(H), pad = 8;
  const w = g.tw + pad * 2, h = H + g.ry * 2 + pad * 2;
  const ax = w / 2, ay = h - pad - g.ry * 0.7;
  const bry = (g.bw / 2) * K;
  // left side down, bottom front arc (left→right), right side up, mouth front arc (right→left)
  const bodyPts = [
    ...polyPts([[-g.rx, -H], [-g.bw / 2, 0]]),
    ...ellipsePts(0, 0, g.bw / 2, bry, 24, Math.PI, 0),
    ...polyPts([[g.bw / 2, 0], [g.rx, -H]]),
    ...ellipsePts(0, -H, g.rx, g.ry, 28, 0, Math.PI),
  ];

  const body = sprite(w, h, ax, ay, scale, 3, (sk) => {
    sk.fill(bodyPts, P.cream);
    // pencil shading on the right flank + under the rim
    sk.hatch(bodyPts, P.ink, { angle: -1.25, gap: 2.4, width: 0.7, alpha: 0.45, from: 0.7, to: 1 });
    sk.hatch(bodyPts, P.ink, { angle: -1.25, gap: 3.6, width: 0.6, alpha: 0.25, from: 0.6, to: 0.7 });
    sk.hatch(bodyPts, P.ink, { angle: -0.15, gap: 2.6, width: 0.6, alpha: 0.3, from: 0, to: 0.12 });
    sk.line(bodyPts, P.ink, { width: 1.7, alpha: 0.95, close: true, passes: 3 });
    // inner back wall seen through the mouth
    const mouth = ellipsePts(0, -H, g.rx * 0.95, g.ry * 0.88, 40);
    sk.fill(mouth, '#f1eee0');
    sk.hatch(mouth, P.ink, { angle: -0.35, gap: 2.2, width: 0.6, alpha: 0.4, from: 0.45, to: 1 });
  }, { toothAlpha: 0.2, gritAlpha: 0.15 });

  const rim = sprite(w, g.ry * 2 + pad * 2, ax, g.ry + pad, scale, 4, (sk) => {
    sk.line(ellipsePts(0, 0, g.rx + 1.5, g.ry + 1.2, 52), P.ink, { width: 1.8, alpha: 0.95, close: true, passes: 3 });
    sk.line(ellipsePts(0, 0, g.rx * 0.95, g.ry * 0.86, 52), P.ink, { width: 0.9, alpha: 0.7, close: true });
  }, { toothAlpha: 0.2, gritAlpha: 0 });

  return { body, rim, geo: g };
}

// ── Sleeve: Saintwood forest-green band with the cream wordmark ─
export function sleeveSprite(H, scale, free = false) {
  const g = cupGeo(H), sh = g.sleeveH;
  const wTop = g.widthAt(g.sleeveY + sh / 2) + 4, wBot = g.widthAt(g.sleeveY - sh / 2) + 4;
  const ryT = (wTop / 2) * K, ryB = (wBot / 2) * K, pad = 6;
  const w = wTop + pad * 2, h = sh + ryT + ryB + pad * 2;
  const ax = w / 2, ay = h / 2;
  const top = -sh / 2, bot = sh / 2;
  const pts = [
    ...ellipsePts(0, top, wTop / 2, ryT, 28, Math.PI, 0),
    ...polyPts([[wTop / 2, top], [wBot / 2, bot]]),
    ...ellipsePts(0, bot, wBot / 2, ryB, 28, 0, Math.PI),
    ...polyPts([[-wBot / 2, bot], [-wTop / 2, top]]),
  ];
  const s = sprite(w, h, ax, ay, scale, 9, (sk) => {
    if (free) {
      // standing alone it's a ring: you can see in through the top
      const rim = ellipsePts(0, top, wTop / 2, ryT, 36);
      sk.fill(rim, '#020d06');
      sk.hatch(rim, '#000', { angle: -0.3, gap: 2, width: 0.5, alpha: 0.4, from: 0, to: 0.5 });
      const inner = ellipsePts(0, top + ryT * 0.35, wTop / 2 * 0.86, ryT * 0.55, 30);
      sk.fill(inner, '#f1ecdc');
    }
    sk.fill(pts, P.forest);
    // subtle corrugation ribs
    const c = sk.ctx; c.save(); c.strokeStyle = '#000'; c.lineWidth = 0.6;
    for (let i = -12; i <= 12; i++) {
      const t = i / 12, k = Math.sqrt(Math.max(0, 1 - t * t));
      c.globalAlpha = 0.12 + 0.22 * Math.abs(t);
      c.beginPath();
      c.moveTo(t * wTop / 2 * 0.98, top + ryT * k + 1);
      c.lineTo(t * wBot / 2 * 0.98, bot + ryB * k - 1);
      c.stroke();
    }
    c.restore();
    sk.hatch(pts, '#000', { angle: -1.25, gap: 2.2, width: 0.6, alpha: 0.35, from: 0.66, to: 1 });
    sk.hatch(pts, '#000', { angle: -1.25, gap: 3, width: 0.5, alpha: 0.2, from: 0, to: 0.12 });
    wordmarkOn(sk, 0, -sh * 0.06 + ryT * 0.5, wTop * 0.66, "#ffffff", 1);
    if (sh > 26) sk.text('BAGELS & BURGERS', 0, sh * 0.29 + ryT * 0.4, { font: `700 ${sh * 0.1}px Almarai, sans-serif`, color: "#ffffff", alpha: 0.9, spacing: sh * 0.022 });
    sk.line(pts, '#020d06', { width: 1.3, alpha: 0.9, close: true });
    if (free) sk.line(ellipsePts(0, top, wTop / 2, ryT, 40), '#020d06', { width: 1.1, alpha: 0.9, close: true });
  }, { toothAlpha: 0.14, gritAlpha: 0.1 });
  s.wTop = wTop; s.wBot = wBot;
  return s;
}

// ── Lid ──────────────────────────────────────────────────────
export function lidSprite(H, scale) {
  const g = cupGeo(H), lw = g.lidW, rx = lw / 2, ry = rx * K;
  const band = H * 0.065, dome = H * 0.05, pad = 6;
  const w = lw + pad * 2, h = band + dome + ry * 2 + pad * 2;
  const ax = w / 2, ay = h - pad - ry; // anchor = seat plane center
  const bandPts = [
    ...polyPts([[-rx, -band], [-rx, 0]]),
    ...ellipsePts(0, 0, rx, ry, 30, Math.PI, 0),
    ...polyPts([[rx, 0], [rx, -band]]),
    ...ellipsePts(0, -band, rx, ry, 30, 0, Math.PI),
  ];
  const topPts = ellipsePts(0, -band, rx * 0.98, ry * 0.98, 44);
  const domePts = ellipsePts(0, -band - dome * 0.5, rx * 0.78, ry * 0.78, 40);
  return sprite(w, h, ax, ay, scale, 13, (sk) => {
    // cream plastic lid, drawn in the same green ink as the storefront
    sk.fill(bandPts, '#f6f2e4');
    sk.hatch(bandPts, P.ink, { angle: -1.25, gap: 2.2, width: 0.65, alpha: 0.55, from: 0.62, to: 1 });
    sk.hatch(bandPts, P.ink, { angle: -1.25, gap: 3.4, width: 0.55, alpha: 0.3, from: 0, to: 0.14 });
    sk.line(bandPts, P.ink, { width: 1.6, alpha: 0.95, close: true, passes: 3 });
    sk.fill(topPts, P.cream);
    sk.hatch(topPts, P.ink, { angle: -0.25, gap: 2.6, width: 0.55, alpha: 0.32, from: 0.62, to: 1 });
    sk.line(topPts, P.ink, { width: 1.3, alpha: 0.9, close: true, passes: 2 });
    sk.fill(domePts, '#fbf8ee');
    sk.line(domePts, P.ink, { width: 1.1, alpha: 0.8, close: true, passes: 2 });
    sk.line(ellipsePts(0, -band - dome * 0.5, rx * 0.66, ry * 0.62, 30, Math.PI * 0.05, Math.PI * 0.95), P.ink, { width: 0.7, alpha: 0.45, passes: 1 });
    // sip hole near the front
    const hole = ellipsePts(0, -band - dome * 0.5 + ry * 0.42, rx * 0.17, ry * 0.16, 20);
    sk.fill(hole, P.ink, 0.92);
  }, { toothAlpha: 0.16, gritAlpha: 0.1 });
}

// ── French press ─────────────────────────────────────────────
export function pressGeo(H) {
  const gw = 0.58 * H, gh = 0.78 * H, base = 0.07 * H, cap = 0.075 * H;
  return {
    gw, gh, base, cap,
    rod: 0.2 * H, knob: 0.05 * H, handle: 0.2 * H,
    glass: { x0: -gw / 2 + 2, x1: gw / 2 - 2, y0: -base - gh + 3, y1: -base - 2 },
    spout: [gw / 2 + 0.035 * H, -base - gh - 0.005 * H],
    capacity: 1.4,
  };
}

export function pressSprites(H, scale) {
  const g = pressGeo(H), pad = 8;
  const left = g.gw / 2 + g.handle + pad, right = g.gw / 2 + 0.06 * H + pad;
  const topY = g.base + g.gh + g.cap + g.rod + g.knob * 2 + pad;
  const w = left + right, h = topY + pad + 4;
  const ax = left, ay = topY;
  const gx0 = -g.gw / 2, gx1 = g.gw / 2, gy0 = -g.base - g.gh, gy1 = -g.base;
  const glass = [...polyPts([[gx0, gy0], [gx0, gy1], [gx1, gy1], [gx1, gy0]]), [gx0, gy0]];

  const back = sprite(w, h, ax, ay, scale, 21, (sk) => {
    sk.fill(glass, '#eef1e6', 0.6);
    sk.hatch(glass, P.ink, { angle: -1.3, gap: 3.2, width: 0.5, alpha: 0.18, from: 0.75 });
  }, { toothAlpha: 0.1, gritAlpha: 0 });

  const front = sprite(w, h, ax, ay, scale, 22, (sk) => {
    sk.line(glass, P.ink, { width: 1.4, alpha: 0.9, close: true, passes: 3 });
    sk.line(polyPts([[gx0 + g.gw * 0.14, gy0 + 8], [gx0 + g.gw * 0.14, gy1 - 10]]), '#ffffff', { width: 2.6, alpha: 0.8, passes: 1 });
    sk.line(polyPts([[gx0 + g.gw * 0.24, gy0 + 12], [gx0 + g.gw * 0.24, gy0 + g.gh * 0.38]]), '#ffffff', { width: 1.2, alpha: 0.7, passes: 1 });
    // frame: base, top band, side straps — green ink + hatch, like the drawing
    const baseP = [...polyPts([[gx0 - 3, gy1], [gx0 - 3, 0], [gx1 + 3, 0], [gx1 + 3, gy1]]), [gx0 - 3, gy1]];
    sk.fill(baseP, P.cream);
    sk.hatch(baseP, P.ink, { gap: 2, width: 0.7, alpha: 0.75 });
    sk.line(baseP, P.ink, { width: 1.4, alpha: 0.95, close: true });
    const bandY = gy0 + 0.07 * g.gh;
    const band = [...polyPts([[gx0 - 3, gy0 + 1], [gx0 - 3, bandY], [gx1 + 3, bandY], [gx1 + 3, gy0 + 1]]), [gx0 - 3, gy0 + 1]];
    sk.fill(band, P.cream);
    sk.hatch(band, P.ink, { gap: 2, width: 0.7, alpha: 0.7 });
    sk.line(band, P.ink, { width: 1.3, alpha: 0.95, close: true });
    for (const sx of [gx0 - 1.5, gx1 + 1.5]) sk.line(polyPts([[sx, bandY], [sx, gy1]]), P.ink, { width: 2.4, alpha: 0.95 });
    // spout lip
    sk.line(bezPts([gx1, gy0 + 2], [gx1 + 4, gy0], [g.spout[0] - 2, g.spout[1] + 2], g.spout), P.ink, { width: 1.5, alpha: 0.95 });
    // cap
    const cy0 = gy0 - g.cap;
    const cap = [...polyPts([[gx0 - 2, gy0], [gx0 + 3, cy0], [gx1 - 3, cy0], [gx1 + 2, gy0]]), [gx0 - 2, gy0]];
    sk.fill(cap, P.cream);
    sk.hatch(cap, P.ink, { angle: -0.9, gap: 1.6, width: 0.8, alpha: 0.85 });
    sk.line(cap, P.ink, { width: 1.4, alpha: 0.95, close: true, passes: 2 });
    // rod + knob
    sk.line(polyPts([[0, cy0], [0, cy0 - g.rod]]), P.ink, { width: 2.2, alpha: 0.95 });
    const knob = ellipsePts(0, cy0 - g.rod - g.knob, g.knob, g.knob, 24);
    sk.fill(knob, P.cream);
    sk.hatch(knob, P.ink, { angle: -0.9, gap: 1.4, width: 0.8, alpha: 0.85, from: 0.3 });
    sk.line(knob, P.ink, { width: 1.3, alpha: 0.95, close: true });
    // handle (C shape) on the left
    const hx = gx0 - 2, hy0 = gy0 + g.gh * 0.12, hy1 = gy0 + g.gh * 0.78;
    const outer = bezPts([hx, hy0], [hx - g.handle * 1.3, hy0], [hx - g.handle * 1.3, hy1], [hx, hy1], 28);
    const inner = bezPts([hx, hy1 - 8], [hx - g.handle * 0.7, hy1 - 8], [hx - g.handle * 0.7, hy0 + 8], [hx, hy0 + 8], 28);
    const handle = [...outer, ...inner, outer[0]];
    sk.fill(handle, P.cream);
    sk.hatch(handle, P.ink, { angle: -0.9, gap: 1.7, width: 0.8, alpha: 0.8 });
    sk.line(handle, P.ink, { width: 1.4, alpha: 0.95, close: true, passes: 2 });
  }, { toothAlpha: 0.16, gritAlpha: 0.08 });
  return { back, front, geo: g };
}

// ── Counter: checkerboard floor tile strip, like their drawing ─
export function counterSprite(w, depth, scale, faceH = 120) {
  const h = depth + faceH + 20;
  const spr = sprite(w, h, 0, 14, scale, 41, (sk) => {
    // counter top edge
    sk.line(polyPts([[-10, 0], [w + 10, 0]], 12), P.ink, { width: 1.8, alpha: 0.95, passes: 3 });
    sk.line(polyPts([[-10, 4], [w + 10, 4]], 12), P.ink, { width: 0.8, alpha: 0.55 });
    // marble-ish top: sparse pencil veins
    const r = sk.r;
    for (let i = 0; i < Math.round(w / 110); i++) {
      const x = r() * w, y = 12 + r() * (depth * 0.55);
      sk.line(bezPts([x, y], [x + 30, y - 6 + r() * 12], [x + 60, y + r() * 12], [x + 90 + r() * 40, y + 4]), P.ink, { width: 0.5, alpha: 0.22, passes: 1 });
    }
    // front edge + hatched counter face
    const fy = depth;
    sk.line(polyPts([[-10, fy], [w + 10, fy]], 12), P.ink, { width: 1.5, alpha: 0.9, passes: 2 });
    sk.line(polyPts([[-10, fy + 5], [w + 10, fy + 5]], 12), P.ink, { width: 0.7, alpha: 0.5, passes: 1 });
    const face = [[-10, fy + 5], [w + 10, fy + 5], [w + 10, fy + faceH + 20], [-10, fy + faceH + 20]];
    sk.hatch(face, P.ink, { angle: -1.1, gap: 3.6, width: 0.6, alpha: 0.32 });
    // vertical panel lines, like the booth in their drawing
    for (let x = 22; x < w; x += 48) sk.line(polyPts([[x, fy + 6], [x, fy + faceH + 20]]), P.ink, { width: 0.7, alpha: 0.38, passes: 1 });
  }, { toothAlpha: 0.2, gritAlpha: 0.1 });
  // fade the face out toward the bottom of the screen
  const c = spr.c.getContext('2d');
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'destination-out';
  const top = (14 + depth + 6) * scale, bot = spr.c.height;
  const g = c.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.15, 'rgba(0,0,0,0.25)'); g.addColorStop(0.75, 'rgba(0,0,0,1)');
  c.fillStyle = g; c.fillRect(0, top, spr.c.width, bot - top);
  c.restore();
  return spr;
}
