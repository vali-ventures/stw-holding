// Saintwood test suite.
//
//   node scripts/test.cjs            quick (~2 min): every scenario on one phone (touch) + one desktop
//                                    (mouse), side by side; layout + signup checks on 7 more devices
//   node scripts/test.cjs --full     every scenario on every device (~6 min)
//   node scripts/test.cjs --only=lid only scenarios whose name contains "lid"
//   URL=https://… node scripts/test.cjs   test a deployed preview instead of a local server
//
// A "scenario" = one self-contained check: fresh page → exact starting state → one action →
// one expected result. Scenarios never depend on each other, so one failure can't cascade.
// The signup API is answered by the test itself: nothing is ever written to a real list.
// Needs Playwright + Chromium (require('playwright')).

const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).toLowerCase();
const OUT = process.env.OUT || '';

const IG_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 356.0.0.24.84 (iPhone14,5; iOS 18_1; en_US; en; scale=3.00; 1170x2532; 657224327)';
const PRIMARY = {
  'iPhone 13': { ...devices['iPhone 13'] },
  'Desktop 1440': { viewport: { width: 1440, height: 900 } },
};
const SECONDARY = {
  'iPhone SE': { ...devices['iPhone SE'] },
  'Pixel 7': { ...devices['Pixel 7'] },
  'Instagram iOS': { viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, userAgent: IG_IOS },
  'Galaxy Fold': { viewport: { width: 280, height: 653 }, isMobile: true, hasTouch: true },
  'Desktop 1280': { viewport: { width: 1280, height: 720 } },
  'Desktop 2560': { viewport: { width: 2560, height: 1440 } },
  'Laptop 1024': { viewport: { width: 1024, height: 768 } },
};

// ── helpers that run in the page ───────────────────────────────────────────
// set up an exact starting state on a freshly loaded page
const SETUP = ({ fill = 0, lid = false, sleeve = false, vol } = {}) => {
  const S = window.__scene, s = S.pieces;
  s.cup.fill = fill; s.cup.slosh = 0; s.cup.sloshV = 0;
  if (lid) { s.lid.attached = true; s.lid.x = s.cup.x; s.lid.y = s.cup.y; }
  if (sleeve) { s.sleeve.attached = true; s.sleeve.threaded = false; s.sleeve.s = S.g.sleeveY; }
  if (vol != null) s.press.vol = vol;
  S._progress(true);
};
const STATE = () => {
  const S = window.__scene, s = S.pieces;
  return {
    fill: s.cup.fill, vol: s.press.vol, lid: s.lid.attached, sleeve: s.sleeve.attached, done: S.done, spilled: S.spilled,
    ticks: [...document.querySelectorAll('.steps li.on')].map((l) => l.dataset.step),
    claimActive: !document.querySelector('.claim').classList.contains('off'),
  };
};
const GEO = () => {
  const S = window.__scene, s = S.pieces, seat = S._seat();
  return {
    W: S.W, Hh: S.H, H: S.hc,
    cup: [s.cup.x, s.cup.y],
    lid: s.lid.attached ? [seat[0], seat[1] - S.hc * 0.05] : [s.lid.x, s.lid.y - S.hc * 0.05],
    sl: S._sleevePos(),
    pr: [s.press.x, s.press.y - S.pg.base - S.pg.gh / 2],
  };
};

// ── scenarios: { name, setup, run(t) → [ok, detail] } ───────────────────────
const SCENARIOS = [
  { name: 'claim is inactive until the cup is made', async run(t) {
      await t.page.click('.claim', { force: true }); await t.wait(300);
      const s = await t.state();
      return [!(await t.page.isVisible('.sheet')) && !s.claimActive, ''];
  } },
  { name: 'push toward the spout and hold: pours and fills', async run(t) {
      await t.pour(3600); const s = await t.state();
      return [s.fill >= 0.78 && s.ticks.includes('pour'), `fill ${s.fill.toFixed(2)}`];
  } },
  { name: 'pull back: stops pouring', async run(t) {
      const g = await t.geo(), side = g.pr[0] > g.cup[0] ? 1 : -1;
      await t.press([g.pr, [g.cup[0] + side * g.H * 1.6, g.cup[1] - g.H * 1.6], [g.cup[0] + side * g.H * 0.75, g.cup[1] - g.H * 1.6]]);
      await t.wait(1200); await t.move([g.cup[0] + side * g.H * 1.4, g.cup[1] - g.H * 1.6]); await t.wait(500);
      const rate = await t.page.evaluate(() => window.__scene.pieces.press.rate); await t.release();
      return [rate < 0.01, `rate after pulling back ${rate.toFixed(3)}`];
  } },
  { name: 'lid dropped from above clicks on', async run(t) {
      const g = await t.geo(); await t.drag([g.lid, [g.cup[0] + 6, g.cup[1] - g.H * 2.1]]);
      const s = await t.state(); return [s.lid && s.ticks.includes('lid'), ''];
  } },
  { name: 'lid dropped onto the cup body clicks on', async run(t) {
      const g = await t.geo(); await t.drag([g.lid, [g.cup[0] + 3, g.cup[1] - g.H * 0.5]]);
      return [(await t.state()).lid, ''];
  } },
  { name: 'pouring onto the lid: cup stays empty', setup: { lid: true }, async run(t) {
      await t.pour(1500); const s = await t.state();
      return [s.fill < 0.02 && s.spilled > 0.05, `fill ${s.fill.toFixed(2)} spilled ${s.spilled.toFixed(2)}`];
  } },
  { name: 'lid tugged off: unticks', setup: { lid: true }, async run(t) {
      const g = await t.geo(), away = g.pr[0] > g.cup[0] ? -1 : 1;
      await t.drag([g.lid, [g.lid[0], g.lid[1] - g.H * 0.6], [g.lid[0] + away * g.H * 1.1, g.lid[1] - g.H * 0.3]]);
      const s = await t.state(); return [!s.lid && !s.ticks.includes('lid'), ''];
  } },
  { name: 'sleeve dropped low on the cup goes on', async run(t) {
      const g = await t.geo(); await t.drag([g.sl, [g.cup[0] - 4, g.cup[1] - g.H * 0.2]]);
      const s = await t.state(); return [s.sleeve && s.ticks.includes('sleeve'), ''];
  } },
  { name: 'sleeve dropped above the cup slides on', async run(t) {
      const g = await t.geo(); await t.drag([g.sl, [g.cup[0] + 5, g.cup[1] - g.H * 1.35]]);
      return [(await t.state()).sleeve, ''];
  } },
  { name: 'sleeve slid up and away: unticks', setup: { sleeve: true }, async run(t) {
      const g = await t.geo(), away = g.pr[0] > g.cup[0] ? -1 : 1;
      await t.drag([g.sl, [g.sl[0], g.sl[1] - g.H * 0.9], [g.sl[0] + away * g.H * 1.4, g.cup[1] - g.H * 1.6]]);
      const s = await t.state(); return [!s.sleeve && !s.ticks.includes('sleeve'), ''];
  } },
  { name: 'full open cup moved briskly spills', setup: { fill: 0.9, sleeve: true }, async run(t) {
      await t.shakeCup(); const s = await t.state();
      return [s.fill < 0.85, `fill 0.90 → ${s.fill.toFixed(2)}`];
  } },
  { name: 'lidded cup shaken: nothing spills', setup: { fill: 0.9, sleeve: true, lid: true }, async run(t) {
      await t.shakeCup(); const s = await t.state();
      return [Math.abs(s.fill - 0.9) < 0.005, `fill 0.90 → ${s.fill.toFixed(2)}`];
  } },
  { name: 'cup made: claim activates', setup: { fill: 0.9, sleeve: true, lid: true }, async run(t) {
      await t.wait(900); const s = await t.state(); return [s.done && s.claimActive, ''];
  } },
  { name: 'taking it apart afterwards keeps the claim', setup: { fill: 0.9, sleeve: true, lid: true }, async run(t) {
      await t.wait(900);
      const g = await t.geo(), away = g.pr[0] > g.cup[0] ? -1 : 1;
      await t.drag([g.lid, [g.lid[0], g.lid[1] - g.H * 0.6], [g.lid[0] + away * g.H * 1.1, g.lid[1] - g.H * 0.3]]);
      const s = await t.state(); return [!s.lid && s.claimActive, ''];
  } },
  { name: 'press set down part-empty refills', setup: { vol: 0.3 }, async run(t) {
      await t.wait(4500); const v = (await t.state()).vol; return [v > 1.2, `vol 0.30 → ${v.toFixed(2)}`];
  } },
  { name: 'flung at the edge: settles on screen, no jitter', async run(t) {
      const g = await t.geo(), edge = g.pr[0] > g.cup[0] ? g.W - 4 : 4;
      await t.drag([g.pr, [edge, g.pr[1] - g.H * 0.5]], { steps: 4, frame: 10, wait: 2000 });
      const xs = []; for (let i = 0; i < 10; i++) { xs.push(await t.page.evaluate(() => window.__scene.pieces.press.x)); await t.wait(80); }
      const e = await t.page.evaluate(() => { const S = window.__scene, p = S.pieces.press, h = S.pg.gw / 2 + S.pg.handle; return [p.x - h, p.x + h, S.W]; });
      const drift = Math.max(...xs) - Math.min(...xs);
      return [e[0] >= -1 && e[1] <= e[2] + 1 && drift < 0.5, `extent ${Math.round(e[0])}..${Math.round(e[1])}/${e[2]} drift ${drift.toFixed(2)}`];
  } },
  { name: 'Make it for me completes the cup', async run(t) {
      await t.page.click('.auto'); await t.page.waitForFunction(() => window.__scene.done, null, { timeout: 20000 }).catch(() => {});
      return [(await t.state()).claimActive, ''];
  } },
  { name: 'signup: question → phone → email → storefront', setup: { fill: 0.9, sleeve: true, lid: true }, async run(t) {
      await t.wait(900); await t.page.click('.claim'); await t.wait(800);
      await t.page.click('.choice[data-value="coffee"]'); await t.wait(900);
      const vp = t.cfg.viewport;
      if (t.touch) { await t.page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.58) }); await t.wait(400); }
      await t.page.keyboard.type('7025550142', { delay: 25 }); await t.wait(400);
      const sendOk = await t.page.evaluate(() => { const b = document.querySelector('.send'), r = b.getBoundingClientRect(); return !b.disabled && r.top >= 0 && r.bottom <= innerHeight; });
      if (t.touch) { await t.page.setViewportSize(vp); await t.wait(300); }
      await t.page.click('.send'); await t.wait(1200);
      await t.page.fill('#email', 'qa@example.com'); await t.page.click('.add'); await t.wait(2800);
      const ok = sendOk && t.posts.some((x) => x.type === 'signup' && x.phone === '+17025550142' && x.interest === 'coffee') && t.posts.some((x) => x.email === 'qa@example.com') && await t.page.isVisible('.final');
      return [ok, sendOk ? '' : 'send button hidden or disabled (keyboard up)'];
  } },
  { name: 'desktop: cursor, keyboard and the signup card', desktopOnly: true, setup: { fill: 0.9, sleeve: true, lid: true }, async run(t) {
      await t.wait(900);
      const g = await t.geo(); await t.page.mouse.move(g.pr[0], g.pr[1]); await t.wait(120);
      const cursor = await t.page.evaluate(() => document.getElementById('stage').style.cursor === 'grab');
      await t.page.mouse.move(5, 5);
      let focused = false;
      for (let i = 0; i < 6 && !focused; i++) { focused = await t.page.evaluate(() => document.activeElement && document.activeElement.classList.contains('claim')); if (!focused) await t.page.keyboard.press('Tab'); }
      await t.page.keyboard.press('Enter'); await t.wait(800);
      const card = await t.page.evaluate(() => { const r = document.querySelector('.sheet').getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 3 && r.width <= 480 && r.width > 0; });
      await t.page.keyboard.press('Escape'); await t.wait(700);
      const back = await t.page.evaluate(() => document.querySelector('.sheet').hidden && document.activeElement.classList.contains('claim'));
      return [cursor && focused && card && back, `cursor ${cursor} · Tab ${focused} · card ${card} · Escape ${back}`];
  } },
];

// fast checks for the secondary devices: layout fits, nothing spills off screen, the sheet works
const LAYOUT = { name: 'layout fits and the signup sheet works', async run(t) {
    const l = await t.page.evaluate(() => {
      const r = (q) => document.querySelector(q).getBoundingClientRect();
      const inView = (b) => b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight + 0.5 && b.right <= innerWidth + 0.5;
      const S = window.__scene, c = S.pieces.cup;
      return { noHScroll: document.documentElement.scrollWidth <= innerWidth, claim: inView(r('.claim')), auto: inView(r('.auto')), headline: inView(r('.headline')),
        cupBelowText: c.y - S.hc > r('.intro').bottom - 4, counterAboveButton: S.gt + S.depth < r('.claim').top + 4 };
    });
    await t.page.evaluate(SETUP, { fill: 0.9, sleeve: true, lid: true }); await t.wait(900);
    await t.page.click('.claim'); await t.wait(800); await t.page.click('.choice[data-value="bagels"]'); await t.wait(900);
    await t.page.keyboard.type('7025550142', { delay: 20 }); await t.wait(300);
    const sheet = await t.page.evaluate(() => { const b = document.querySelector('.send'), r = b.getBoundingClientRect(); return !b.disabled && r.bottom <= innerHeight; });
    const bad = Object.entries({ ...l, sheet }).filter(([, v]) => !v).map(([k]) => k);
    return [bad.length === 0, bad.length ? 'problem: ' + bad.join(', ') : ''];
} };

// ── runner ─────────────────────────────────────────────────────────────────
async function runDevice(browser, base, dev, cfg, list) {
  const out = [];
  const touch = !!cfg.hasTouch;
  for (const sc of list) {
    if (sc.desktopOnly && touch) continue;
    if (ONLY && !sc.name.toLowerCase().includes(ONLY)) continue;
    const ctx = await browser.newContext({ ...cfg, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [], posts = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.route('**/api/signup', (r) => { posts.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"t"}' }); });
    await page.goto(base + '/?reset'); await page.waitForFunction(() => window.__scene && window.__scene.pieces);
    await page.waitForTimeout(500);
    if (sc.setup) await page.evaluate(SETUP, sc.setup);
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    const t = makeDriver(page, cdp, touch, cfg, posts);
    let ok = false, detail = '';
    try { [ok, detail] = await sc.run(t); } catch (e) { ok = false; detail = 'threw: ' + e.message.split('\n')[0]; }
    if (errors.length) { ok = false; detail += (detail ? ' · ' : '') + 'page error: ' + errors[0]; }
    if (!ok && OUT) await page.screenshot({ path: path.join(OUT, `${dev}-${sc.name}`.replace(/[^\w-]+/g, '_') + '.png') }).catch(() => {});
    out.push({ dev, name: sc.name, ok, detail });
    console.log(`${ok ? 'pass' : 'FAIL'}  ${dev.padEnd(14)} ${sc.name}${detail && !ok ? '  — ' + detail : ''}`);
    await ctx.close();
  }
  return out;
}

function makeDriver(page, cdp, touch, cfg, posts) {
  const wait = (ms) => page.waitForTimeout(ms);
  const send = async (type, x, y) => {
    if (touch) return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    if (type === 'touchStart') { await page.mouse.move(x, y); return page.mouse.down(); }
    if (type === 'touchMove') return page.mouse.move(x, y);
    return page.mouse.up();
  };
  let at = null;
  const glide = async (pts, steps = 10, frame = 16) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      for (let k = 1; k <= steps; k++) { await send('touchMove', x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps); await wait(frame); }
    }
    at = pts[pts.length - 1];
  };
  const t = {
    page, touch, cfg, posts, wait,
    state: () => page.evaluate(STATE),
    geo: () => page.evaluate(GEO),
    press: async (pts) => { await send('touchStart', pts[0][0], pts[0][1]); at = pts[0]; await glide(pts); },
    move: async (pt) => glide([at, pt], 6),
    release: async () => { await send('touchEnd'); await wait(700); },
    drag: async (pts, { steps = 10, frame = 16, wait: w = 900 } = {}) => { await send('touchStart', pts[0][0], pts[0][1]); at = pts[0]; await glide(pts, steps, frame); await send('touchEnd'); await wait(w); },
    // grab the press, come at the cup from its own side, push toward the spout, hold
    pour: async (ms) => {
      const g = await t.geo(), side = g.pr[0] > g.cup[0] ? 1 : -1;
      await t.press([g.pr, [g.cup[0] + side * g.H * 1.6, g.cup[1] - g.H * 1.6], [g.cup[0] + side * g.H * 0.75, g.cup[1] - g.H * 1.6]]);
      await wait(ms); await t.release();
    },
    // pick the cup up by its body and swing it side to side, hard
    shakeCup: async () => {
      const g = await t.geo(), c0 = [g.cup[0], g.cup[1] - g.H * 0.75], pts = [c0];
      for (let i = 0; i < 8; i++) pts.push([c0[0] + (i % 2 ? -1 : 1) * g.H * 0.55, c0[1] - g.H * 0.4]);
      await t.drag(pts, { steps: 3, frame: 16, wait: 1200 });
    },
  };
  return t;
}

(async () => {
  let server = null, base = process.env.URL;
  if (!base) {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'dev.js')], { env: { ...process.env, PORT: '5179' }, stdio: 'ignore' });
    base = 'http://127.0.0.1:5179';
    await new Promise((r) => setTimeout(r, 700));
  }
  base = base.replace(/\/$/, '');
  const t0 = Date.now();
  const browser = await chromium.launch();
  const jobs = [];
  const primary = FULL ? { ...PRIMARY, ...SECONDARY } : PRIMARY;
  // primary devices play every scenario; run them two at a time
  const entries = Object.entries(primary);
  for (let i = 0; i < entries.length; i += 2) {
    const batch = entries.slice(i, i + 2).map(([d, c]) => runDevice(browser, base, d, c, SCENARIOS));
    jobs.push(...(await Promise.all(batch)));
  }
  if (!FULL && !ONLY) {
    const sec = Object.entries(SECONDARY);
    for (let i = 0; i < sec.length; i += 4) jobs.push(...(await Promise.all(sec.slice(i, i + 4).map(([d, c]) => runDevice(browser, base, d, c, [LAYOUT])))));
  }
  await browser.close();
  if (server) server.kill();
  const all = jobs.flat(), fails = all.filter((r) => !r.ok);
  console.log(`\n${all.length - fails.length}/${all.length} passed in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(fails.length ? 1 : 0);
})();
