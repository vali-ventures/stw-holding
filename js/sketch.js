// Hand-drawn rendering kit: colored-pencil lines, watercolor washes and
// hatching on canvas. Everything is drawn procedurally once into sprite
// canvases (no image downloads), then blitted each frame.

export function rng(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ── Paper textures ───────────────────────────────────────────
let _tooth, _grit, _paper;

// Sparse alpha holes: "paper tooth" that breaks up pencil strokes.
export function tooth() {
  if (_tooth) return _tooth;
  const n = 192, c = mk(n, n), x = c.getContext('2d'), r = rng(11);
  const img = x.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = r();
    // fibrous: correlate with the pixel to the left
    const a = v > 0.62 ? (v - 0.62) * 600 : 0;
    img.data[i * 4 + 3] = Math.min(255, a);
  }
  x.putImageData(img, 0, 0);
  return (_tooth = c);
}

// Dark speckle, applied source-atop to give fills some grit.
export function grit() {
  if (_grit) return _grit;
  const n = 160, c = mk(n, n), x = c.getContext('2d'), r = rng(23);
  const img = x.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = r();
    img.data[i * 4] = 40; img.data[i * 4 + 1] = 28; img.data[i * 4 + 2] = 18;
    img.data[i * 4 + 3] = v > 0.86 ? (v - 0.86) * 900 : 0;
  }
  x.putImageData(img, 0, 0);
  return (_grit = c);
}

// Background paper (used as a CSS background via data URL).
export function paperDataURL(color = '#f3ecdf') {
  if (_paper) return _paper;
  const n = 220, c = mk(n, n), x = c.getContext('2d'), r = rng(5);
  x.fillStyle = color; x.fillRect(0, 0, n, n);
  const img = x.getImageData(0, 0, n, n);
  for (let i = 0; i < n * n; i++) {
    const d = (r() - 0.5) * 14 + (r() > 0.985 ? -18 : 0);
    img.data[i * 4] += d; img.data[i * 4 + 1] += d; img.data[i * 4 + 2] += d * 0.9;
  }
  x.putImageData(img, 0, 0);
  // a few long fibres
  x.globalAlpha = 0.05; x.strokeStyle = '#5a4630'; x.lineWidth = 0.6;
  for (let i = 0; i < 26; i++) {
    const px = r() * n, py = r() * n, a = r() * Math.PI;
    x.beginPath(); x.moveTo(px, py);
    x.quadraticCurveTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9 + 3, px + Math.cos(a) * 18, py + Math.sin(a) * 18);
    x.stroke();
  }
  return (_paper = c.toDataURL('image/png'));
}

export function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ── Geometry helpers (return point arrays) ───────────────────
export function ellipsePts(cx, cy, rx, ry, n = 48, a0 = 0, a1 = Math.PI * 2) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return p;
}
export function polyPts(pts, seg = 6) {
  // subdivide straight segments so jitter looks hand drawn
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / seg));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * (k / n), ay + (by - ay) * (k / n)]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
export function bezPts(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}
export function tracePath(ctx, pts, close = false) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

// ── Sketch: a sprite canvas with pencil/watercolor tools ─────
export class Sketch {
  constructor(w, h, scale = 2, seed = 1) {
    this.w = w; this.h = h; this.scale = scale;
    this.canvas = mk(w * scale, h * scale);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(scale, scale);
    this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round';
    this.r = rng(seed);
  }
  _jit(pts, amt, phase) {
    const r = this.r;
    return pts.map(([x, y], i) => [
      x + Math.sin(i * 0.37 + phase) * amt * 0.6 + (r() - 0.5) * amt * 0.5,
      y + Math.cos(i * 0.29 + phase * 1.3) * amt * 0.6 + (r() - 0.5) * amt * 0.5,
    ]);
  }
  // Watercolor wash: several translucent, slightly offset fills with a
  // darker pooled edge, like pigment drying at the boundary.
  wash(pts, color, { passes = 3, jitter = 1.4, alpha = 0.42, edge = 0.35 } = {}) {
    const c = this.ctx;
    c.save();
    c.fillStyle = color;
    for (let i = 0; i < passes; i++) {
      c.globalAlpha = alpha;
      tracePath(c, this._jit(pts, jitter, this.r() * 9), true);
      c.fill();
    }
    if (edge) {
      c.globalAlpha = edge * 0.5;
      c.strokeStyle = color; c.lineWidth = 1.6;
      tracePath(c, this._jit(pts, jitter * 0.7, this.r() * 9), true);
      c.stroke();
    }
    c.restore();
  }
  // Solid-ish fill (for opaque bodies), still with a soft edge.
  fill(pts, color, alpha = 1) {
    const c = this.ctx;
    c.save(); c.globalAlpha = alpha; c.fillStyle = color;
    tracePath(c, this._jit(pts, 0.5, this.r() * 9), true); c.fill();
    c.restore();
  }
  // Colored pencil line: 2–3 jittery passes of varying weight.
  line(pts, color, { width = 1.4, passes = 2, jitter = 0.9, alpha = 0.85, close = false } = {}) {
    const c = this.ctx;
    c.save(); c.strokeStyle = color;
    for (let i = 0; i < passes; i++) {
      c.globalAlpha = alpha * (i === 0 ? 1 : 0.55);
      c.lineWidth = width * (i === 0 ? 1 : 0.6 + this.r() * 0.5);
      tracePath(c, this._jit(pts, jitter, this.r() * 9), close);
      c.stroke();
    }
    c.restore();
  }
  // Diagonal hatching clipped to a shape — pencil shading.
  hatch(pts, color, { angle = -0.9, gap = 3.2, width = 0.8, alpha = 0.5, from = 0, to = 1 } = {}) {
    const c = this.ctx;
    c.save();
    tracePath(c, pts, true); c.clip();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, R = Math.hypot(maxX - minX, maxY - minY) / 2 + 4;
    const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
    c.strokeStyle = color; c.lineWidth = width;
    const steps = Math.ceil((2 * R) / gap);
    for (let i = Math.floor(steps * from); i < steps * to; i++) {
      const o = -R + i * gap + (this.r() - 0.5) * gap * 0.5;
      const len = R * (0.85 + this.r() * 0.3);
      c.globalAlpha = alpha * (0.6 + this.r() * 0.4);
      c.beginPath();
      c.moveTo(cx + nx * o - dx * len, cy + ny * o - dy * len);
      c.lineTo(cx + nx * o + dx * len + (this.r() - 0.5) * 2, cy + ny * o + dy * len);
      c.stroke();
    }
    c.restore();
  }
  // Soft radial highlight/shadow inside a shape.
  glow(pts, x, y, r, color, alpha = 0.5) {
    const c = this.ctx;
    c.save(); tracePath(c, pts, true); c.clip();
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = alpha; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    c.restore();
  }
  text(str, x, y, { font = '600 12px Fraunces, serif', color = '#2b2420', align = 'center', alpha = 0.9, spacing = 0, rotate = 0 } = {}) {
    const c = this.ctx;
    c.save(); c.translate(x, y); c.rotate(rotate);
    c.font = font; c.fillStyle = color; c.globalAlpha = alpha; c.textAlign = align; c.textBaseline = 'middle';
    if (spacing && 'letterSpacing' in c) c.letterSpacing = spacing + 'px';
    c.fillText(str, 0, 0);
    c.restore();
  }
  // Paper tooth + grit over everything drawn so far.
  finish({ toothAlpha = 0.28, gritAlpha = 0.35 } = {}) {
    const c = this.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = toothAlpha;
    c.fillStyle = c.createPattern(tooth(), 'repeat');
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.globalCompositeOperation = 'source-atop';
    c.globalAlpha = gritAlpha;
    c.fillStyle = c.createPattern(grit(), 'repeat');
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.restore();
    return this;
  }
}

// Live (per-frame) pencil stroke, cheap: one jittered pass.
export function liveLine(ctx, pts, color, width = 1.4, alpha = 0.85, seed = 0) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const j = Math.sin(i * 1.7 + seed) * 0.5;
    const [x, y] = pts[i];
    i ? ctx.lineTo(x + j, y - j) : ctx.moveTo(x + j, y - j);
  }
  ctx.stroke();
  ctx.restore();
}
