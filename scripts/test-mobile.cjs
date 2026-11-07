// Regression suite: plays the game end to end. Phones use real touch input (iPhone 13, iPhone SE,
// Pixel 7, Instagram iOS); desktops use a real mouse (1024 to 2560 wide).
// Run: node server/dev.js, then: SUITE=all OUT=/tmp/shots node scripts/test-mobile.cjs  (mobile | desktop | all)
// Mobile test suite — real touch input (Chromium CDP touch events), mobile devices.
const { chromium, devices } = require('playwright');
const OUT = process.env.OUT, URL = process.env.URL || 'http://localhost:5173/';
const IG_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 356.0.0.24.84 (iPhone14,5; iOS 18_1; en_US; en; scale=3.00; 1170x2532; 657224327)';
const MOBILE = {
  'iPhone 13': { ...devices['iPhone 13'] },
  'iPhone SE': { ...devices['iPhone SE'] },
  'Pixel 7': { ...devices['Pixel 7'] },
  'Instagram iOS': { viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, userAgent: IG_IOS },
};
const DESKTOP = {
  'Desktop 1280': { viewport: { width: 1280, height: 720 } },
  'Desktop 1440': { viewport: { width: 1440, height: 900 } },
  'Desktop 1920': { viewport: { width: 1920, height: 1080 } },
  'Desktop 2560': { viewport: { width: 2560, height: 1440 } },
  'Laptop 1024': { viewport: { width: 1024, height: 768 } },
};
// SUITE=mobile (default) | desktop | all
const DEVICES = { ...(process.env.SUITE !== 'desktop' ? MOBILE : {}), ...(process.env.SUITE === 'desktop' || process.env.SUITE === 'all' ? DESKTOP : {}) };
const results = [];
const check = (dev, name, ok, detail = '') => { results.push({ dev, name, ok, detail }); console.log((ok ? 'pass ' : 'FAIL ') + dev + ' | ' + name + (detail ? '  — ' + detail : '')); };

(async () => {
  const b = await chromium.launch();
  for (const [dev, cfg] of Object.entries(DEVICES)) {
    const ctx = await b.newContext({ ...cfg, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    const posts = [];
    await p.route('**/api/signup', (r) => { posts.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"t"}' }); });
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1300);
    const cdp = await ctx.newCDPSession(p);
    const isTouch = !!cfg.hasTouch;
    let mx = 0, my = 0;
    const touch = async (type, x, y) => {
      if (isTouch) return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      if (type === 'touchStart') { mx = x; my = y; await p.mouse.move(x, y); return p.mouse.down(); }
      if (type === 'touchMove') { mx = x; my = y; return p.mouse.move(x, y); }
      return p.mouse.up();
    };
    const drag = async (path, { hold = 0, steps = 10, wait = 900, frame = 16 } = {}) => {
      await touch('touchStart', path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) {
        const [x0, y0] = path[i - 1], [x1, y1] = path[i];
        for (let k = 1; k <= steps; k++) { await touch('touchMove', x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps); await p.waitForTimeout(frame); }
      }
      if (hold) await p.waitForTimeout(hold);
      await touch('touchEnd'); await p.waitForTimeout(wait);
    };
    const S = () => p.evaluate(() => { const S = window.__scene, s = S.pieces; return { fill: s.cup.fill, vol: s.press.vol, sleeve: s.sleeve.attached, lid: s.lid.attached, done: S.done, spilled: S.spilled, ticks: [...document.querySelectorAll('.steps li.on')].map((l) => l.dataset.step).join(',') }; });
    const G = () => p.evaluate(() => { const S = window.__scene, s = S.pieces; const seat = S._seat(); return { W: S.W, H: S.hc, cup: [s.cup.x, s.cup.y], lid: s.lid.attached ? [seat[0], seat[1] - S.hc * 0.05] : [s.lid.x, s.lid.y - S.hc * 0.05], sl: S._sleevePos(), pr: [s.press.x, s.press.y - S.pg.base - S.pg.gh / 2] }; });
    // approach the cup from whichever side the press is on (its spout faces the cup)
    const pour = async (ms) => { const g = await G(); const side = g.pr[0] < g.cup[0] ? -1 : 1; await drag([g.pr, [g.cup[0] + side * g.H * 1.6, g.cup[1] - g.H * 1.6], [g.cup[0] + side * g.H * 0.75, g.cup[1] - g.H * 1.6]], { hold: ms }); };
    let g;

    // ── 0. the claim button is there from the start, but inactive: tapping it doesn't open anything
    await p.click('.claim', { force: true }); await p.waitForTimeout(300);
    check(dev, 'inactive claim button does nothing yet', !(await p.isVisible('.sheet')) && await p.evaluate(() => document.querySelector('.claim').classList.contains('off')));
    // ── A. any order: lid → pour on lid → lid off → sleeve low → pour → lid on
    g = await G(); await drag([g.lid, [g.cup[0] + 6, g.cup[1] - g.H * 2.1]]);
    let s = await S(); check(dev, 'lid dropped from above clicks on', s.lid && s.ticks.includes('lid'));
    await pour(1500); s = await S(); check(dev, 'pour with lid on: cup stays empty', s.fill < 0.02, `fill=${s.fill.toFixed(2)} spilled=${s.spilled.toFixed(2)}`);
    g = await G(); const away = g.pr[0] > g.cup[0] ? -1 : 1; // put things down on the side away from the press
    await drag([g.lid, [g.lid[0], g.lid[1] - g.H * 0.6], [g.lid[0] + away * g.H * 1.1, g.lid[1] - g.H * 0.3]]);
    s = await S(); check(dev, 'lid tugged off → unticks', !s.lid && !s.ticks.includes('lid'));
    g = await G(); await drag([g.sl, [g.cup[0] - 4, g.cup[1] - g.H * 0.2]]);
    s = await S(); check(dev, 'sleeve dropped low goes on', s.sleeve && s.ticks.includes('sleeve'));
    g = await G(); await drag([g.sl, [g.sl[0], g.sl[1] - g.H * 0.9], [g.sl[0] + (g.pr[0] > g.cup[0] ? -1 : 1) * g.H * 1.4, g.cup[1] - g.H * 1.6]]);
    s = await S(); check(dev, 'sleeve slid off → unticks', !s.sleeve && !s.ticks.includes('sleeve'));
    g = await G(); await drag([g.sl, [g.cup[0] + 5, g.cup[1] - g.H * 1.35]]);
    s = await S(); check(dev, 'sleeve dropped high goes on', s.sleeve);
    if ((await S()).vol < 0.9) await p.waitForTimeout(3500); // press refills if it ran dry
    await pour(3700); s = await S(); check(dev, 'push-and-hold pour fills cup', s.fill >= 0.78, `fill=${s.fill.toFixed(2)}`);
    // ── B. shake the open cup: coffee should slop out
    g = await G();
    const before = s.fill;
    const c0 = [g.cup[0], g.cup[1] - g.H * 0.75];
    const zig = [c0]; for (let i = 0; i < 8; i++) zig.push([c0[0] + (i % 2 ? -1 : 1) * g.H * 0.55, c0[1] - g.H * 0.4]);
    await drag(zig, { steps: 3, frame: 16, wait: 1200 });
    s = await S(); check(dev, 'shaking an open full cup spills', s.fill < before - 0.05, `fill ${before.toFixed(2)} → ${s.fill.toFixed(2)}`);
    // put the cup back in the middle (it got thrown about), top up, lid on, shake: nothing comes out
    g = await G(); await drag([[g.cup[0], g.cup[1] - g.H * 0.75], [g.W / 2, g.cup[1] - g.H * 1.1], [g.W / 2, g.cup[1] - g.H * 0.7]], { steps: 14, frame: 20 });
    await p.waitForTimeout(3500); await pour(3600);
    g = await G(); await drag([g.lid, [g.cup[0] + 3, g.cup[1] - g.H * 0.5]]);
    s = await S(); const lidded = s.fill;
    g = await G(); const c1 = [g.cup[0], g.cup[1] - g.H * 0.75]; const zig2 = [c1]; for (let i = 0; i < 8; i++) zig2.push([c1[0] + (i % 2 ? -1 : 1) * g.H * 0.55, c1[1] - g.H * 0.4]);
    await drag(zig2, { steps: 3, frame: 16, wait: 1200 });
    s = await S(); check(dev, 'shaking a lidded cup: no spill', Math.abs(s.fill - lidded) < 0.005 && s.lid, `fill ${lidded.toFixed(2)} → ${s.fill.toFixed(2)}`);
    check(dev, 'done → claim button', s.done && await p.evaluate(() => !document.querySelector('.claim').classList.contains('off')), `ticks=${s.ticks}`);
    // once made, taking it apart again doesn't take the claim away
    await p.evaluate(() => { const S = window.__scene; S.pieces.lid.attached = false; S._progress(); }); await p.waitForTimeout(500);
    check(dev, 'claim stays active after taking the cup apart', await p.evaluate(() => !document.querySelector('.claim').classList.contains('off')));
    await p.screenshot({ path: `${OUT}/${dev.replace(/ /g, '_')}-done.png` });
    if (!isTouch) { await p.mouse.move(5, 5); }

    // ── C. edges: fling pieces at the walls, then check they settle fully on screen with no jitter
    g = await G();
    await drag([g.pr, [g.W - 4, g.pr[1] - g.H * 0.5]], { steps: 4, frame: 10, wait: 200 });
    const lidFree = await p.evaluate(() => !window.__scene.pieces.lid.attached);
    await p.waitForTimeout(2000);
    const samples = [];
    for (let i = 0; i < 12; i++) { samples.push(await p.evaluate(() => { const S = window.__scene; return ['press', 'lid', 'sleeve'].map((k) => S.pieces[k]).filter((x) => !x.attached).map((x) => ({ k: x.kind, x: x.x })); })); await p.waitForTimeout(80); }
    const ext = await p.evaluate(() => { const S = window.__scene; const half = { press: S.pg.gw / 2 + S.pg.handle, lid: S.g.lidW / 2, sleeve: S.g.tw / 2 }; return ['press', 'lid', 'sleeve'].map((k) => S.pieces[k]).filter((x) => !x.attached).map((x) => ({ k: x.kind, l: x.x - half[x.kind], r: x.x + half[x.kind], W: S.W })); });
    const jitter = Math.max(0, ...samples[0].map((_, j) => { const xs = samples.map((sm) => sm[j].x); return Math.max(...xs) - Math.min(...xs); }));
    check(dev, 'flung press settles on screen', ext.every((e) => e.l >= -1 && e.r <= e.W + 1), JSON.stringify(ext.map((e) => `${e.k}:${Math.round(e.l)}..${Math.round(e.r)}/${e.W}`)));
    check(dev, 'no jitter at the edges', jitter < 0.5, `max drift ${jitter.toFixed(2)}px`);

    if (!isTouch) {
      // hover cursor over a piece, keyboard path to the claim button, Escape closes the card
      g = await G(); await p.mouse.move(g.pr[0], g.pr[1]); await p.waitForTimeout(100);
      check(dev, 'hand cursor over a piece', await p.evaluate(() => document.getElementById('stage').style.cursor === 'grab'));
      await p.mouse.move(5, 5);
      // focus moves to the claim button when the cup is ready; otherwise it's a few Tabs away
      let focusedClaim = false;
      for (let i = 0; i < 6 && !focusedClaim; i++) { focusedClaim = await p.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('claim')); if (!focusedClaim) await p.keyboard.press('Tab'); }
      check(dev, 'claim reachable by keyboard (Tab)', focusedClaim);
      await p.focus('.claim'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
      const card = await p.evaluate(() => { const r = document.querySelector('.sheet').getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), W: innerWidth, H: innerHeight }; });
      check(dev, 'signup opens as a centred card', Math.abs(card.cx - card.W / 2) < 3 && Math.abs(card.cy - card.H / 2) < 40 && card.w <= 480, JSON.stringify(card));
      await p.keyboard.press('Escape'); await p.waitForTimeout(700);
      check(dev, 'Escape closes it and returns focus', await p.evaluate(() => document.querySelector('.sheet').hidden && document.activeElement.classList.contains('claim')));
    }
    // ── D. signup with the keyboard up
    if (!(await p.evaluate(() => !document.querySelector('.claim').classList.contains('off')))) { check(dev, 'reached claim', false, JSON.stringify(await S())); await ctx.close(); continue; }
    await p.click('.claim'); await p.waitForTimeout(800);
    await p.click('.choice[data-value="coffee"]'); await p.waitForTimeout(900);
    const vp = cfg.viewport; if (isTouch) { await p.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.58) }); await p.waitForTimeout(400); }
    await p.keyboard.type('7025550142', { delay: 30 }); await p.waitForTimeout(400);
    const sendOk = await p.evaluate(() => { const r = document.querySelector('.send').getBoundingClientRect(); return !document.querySelector('.send').disabled && r.bottom <= innerHeight && r.top >= 0; });
    check(dev, isTouch ? 'phone step usable with keyboard up' : 'phone step: typed number enables Send', sendOk);
    await p.setViewportSize(vp); await p.waitForTimeout(400);
    await p.click('.send'); await p.waitForTimeout(1200);
    await p.fill('#email', 'qa@example.com'); await p.click('.add'); await p.waitForTimeout(2800);
    check(dev, 'signup + email sent; storefront shown', posts.some((x) => x.type === 'signup' && x.phone === '+17025550142' && x.interest === 'coffee') && posts.some((x) => x.email === 'qa@example.com') && await p.isVisible('.final'));
    await p.screenshot({ path: `${OUT}/${dev.replace(/ /g, '_')}-store.png` });
    check(dev, 'no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.dev.padEnd(14)} ${r.name}${r.detail ? '  — ' + r.detail : ''}`); }
  console.log(`\n${results.length - fail}/${results.length} passed`);
})();
