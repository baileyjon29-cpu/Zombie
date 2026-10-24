/*
 * App Store screenshots for Last Haven.
 *
 * Stages a settlement in the real game, captures it at Apple's exact sizes, then composes captioned
 * marketing versions. Output: docs/screenshots/{raw,store}/...
 *
 *   npm run build && node scripts/screenshots.cjs
 *
 * Needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 4179;

// Apple's required sizes: 6.9" iPhone (1320×2868) and 13" iPad (2752×2064 landscape)
const DEVICES = [
  { name: 'iphone-6.9', viewport: { width: 440, height: 956 }, scale: 3, mobile: true, caption: { band: 470, title: 118, sub: 50 } },
  { name: 'ipad-13', viewport: { width: 1376, height: 1032 }, scale: 2, mobile: true, caption: { band: 330, title: 104, sub: 44 } },
];

const SHOTS = [
  { id: '1-title', title: 'The dead walk.', accent: 'You build.', sub: 'A zombie survival base builder' },
  { id: '2-base', title: 'Build your', accent: 'Haven', sub: 'Houses, farms, barracks and watchtowers' },
  { id: '3-dusk', title: 'Know where they', accent: 'strike', sub: 'Every dusk the horde shows its hand' },
  { id: '4-night', title: 'Hold the', accent: 'line', sub: 'Towers, guards and walls against the night' },
  { id: '5-bloodmoon', title: 'Survive the', accent: 'Blood Moon', sub: 'Every 5th night brings the Abomination' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs inside the page: builds a fortified settlement around the HQ and reveals the area. */
function stageBase(day) {
  const app = window.__app;
  const s = app.game.s;
  const hq = s.buildings.find((b) => b.kind === 'hq');
  const [hx, hy] = [hq.tx, hq.ty];
  const x0 = hx - 8, y0 = hy - 8, x1 = hx + 10, y1 = hy + 10;
  // clear trees/wrecks inside the walls so the layout reads cleanly
  s.nodes = s.nodes.filter((n) => n.kind === 'ruin' || n.tx < x0 - 1 || n.tx > x1 + 1 || n.ty < y0 - 1 || n.ty > y1 + 1);
  // start from a clean daytime state (a reload may have restored a run mid-night)
  Object.assign(s, { day, isNight: false, phaseTime: 0, warned: false, zombies: [], spawns: [], edges: [], event: null, eventDay: day, gameOver: false });
  s.res = { wood: 9000, scrap: 9000, food: 9000 };
  s.questIndex = 999; // hide the tutorial card
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (Math.hypot(x - hx - 1, y - hy - 1) < 20) s.explored[y * 64 + x] = 1;
  app.startGame(s, false);
  const g = app.game;
  const P = (k, x, y) => (g.canPlace(k, x, y) ? g.place(k, x, y, true) : 'blocked');
  P('house', hx - 4, hy - 4); P('house', hx + 5, hy - 4); P('house', hx - 4, hy + 1); P('house', hx + 5, hy + 5);
  P('farm', hx - 4, hy + 5); P('farm', hx - 1, hy + 5); P('barracks', hx + 5, hy + 1);
  for (const [x, y] of [[x0 + 1, y0 + 1], [x1 - 1, y0 + 1], [x0 + 1, y1 - 1], [x1 - 1, y1 - 1], [hx + 1, y0 + 1], [hx + 1, y1 - 1], [x0 + 1, hy + 1], [x1 - 1, hy + 1]]) P('tower', x, y);
  for (let x = x0; x <= x1; x++) { P('steelwall', x, y0); P('steelwall', x, y1); }
  for (let y = y0 + 1; y < y1; y++) { P('steelwall', x0, y); P('steelwall', x1, y); }
  P('trap', hx + 1, y1 + 1); P('trap', hx + 1, y0 - 1); P('trap', x0 - 1, hy + 1); P('trap', x1 + 1, hy + 1);
  for (const b of g.s.buildings) {
    g.finishNow(b);
    if (b.kind === 'tower') { g.upgrade(b); if (day >= 5) g.upgrade(b); }
    if (b.kind === 'house' || b.kind === 'farm') g.upgrade(b);
  }
  g.upgrade(g.s.buildings.find((b) => b.kind === 'hq'));
  for (let i = 0; i < 10; i++) g.addSurvivor(null);
  const barracks = g.s.buildings.find((b) => b.kind === 'barracks');
  for (let i = 0; i < 3; i++) g.trainGuard(barracks);
  g.hireMercenary();
  for (let i = 0; i < 30 * 20; i++) g.update(0.05); // let guards train and everyone get to work
  for (const j of ['wood', 'wood', 'wood', 'scrap', 'scrap', 'food', 'food', 'food']) g.setJobs(j, 1);
  for (let i = 0; i < 12 * 20; i++) g.update(0.05);
  const hqb = g.s.buildings.find((b) => b.kind === 'hq');
  hqb.hp = hqb.maxHp = 99999; // the base must survive the staged fights
  g.s.res = { wood: 1460, scrap: 985, food: 640 };
  g.events.length = 0;
  app.started = true;
  app.closeModals();
  app.trayOpen = false;
  app.selected = null;
  return { hx, hy };
}

/** Moves the horde up to the walls on its side so the fight is in frame, then lets it play out briefly. */
function rally([hx, hy]) {
  const g = window.__app.game;
  const s = g.s;
  const cx = hx + 1.5, cy = hy + 1.5;
  let k = 0;
  for (const z of s.zombies) {
    const e = s.edges[0] ?? 0; // one front keeps the shot readable
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][e];
    const along = ((k * 7919) % 17) - 8, out = z.kind === 'abomination' ? 11.2 : 10.8 + ((k * 31) % 5) * 0.9;
    z.x = cx + dx * out + dy * along * 0.9;
    z.y = cy + dy * out + dx * along * 0.9;
    if (z.kind === 'abomination') { z.x = cx + dx * out; z.y = cy + dy * out; z.hp = z.maxHp * 0.62; }
    k++;
  }
  for (let i = 0; i < 30; i++) g.update(0.05);
  return s.edges[0] ?? 0;
}

function sim(seconds) {
  const g = window.__app.game;
  for (let i = 0; i < seconds * 20; i++) g.update(0.05);
}

async function prep(page) {
  // a clean frame: no toasts, HUD settled
  await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; window.__app.renderHud(true); });
}

async function captureDevice(browser, dev, raw) {
  const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: dev.scale, isMobile: dev.mobile, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  const url = `http://localhost:${PORT}/`;
  const shot = async (id) => {
    const file = path.join(raw, `${dev.name}_${id}.png`);
    await page.screenshot({ path: file });
    console.log('  ', path.relative(ROOT, file));
  };
  const centre = (x, y, zoom) => page.evaluate(([x, y, zoom]) => { const a = window.__app; a.cam.zoom = zoom; a.centerOn(x, y); }, [x, y, zoom]);
  const zoom = dev.name.startsWith('ipad') ? 1.25 : 1.05;

  // 1. title over a built-up base
  await page.goto(url);
  await page.waitForFunction(() => window.__app);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__app);
  const { hx, hy } = await page.evaluate(stageBase, 7);
  await page.evaluate(() => { window.__app.save(); });
  await page.reload();
  await page.waitForFunction(() => window.__app);
  await page.evaluate(([x, y, z]) => { const a = window.__app; a.cam.zoom = z; a.centerOn(x, y); }, [hx + 1.5, hy + 1.5, zoom * 0.9]);
  await sleep(1200);
  await shot('1-title');

  // 2. the base by day
  await page.evaluate(() => { const a = window.__app; a.closeModals(); a.paused = false; a.started = true; });
  await centre(hx + 1.5, hy + 2, zoom);
  await sleep(2500);
  await page.evaluate(() => { window.__app.paused = true; });
  await prep(page);
  await sleep(400);
  await shot('2-base');

  // 3. dusk: the horde warning
  await page.evaluate(() => { const a = window.__app; a.game.s.phaseTime = 110 - 15.2; a.paused = false; });
  await sleep(600);
  await page.evaluate(() => { document.querySelectorAll('#toasts .toast:not(.warn)').forEach((t) => t.remove()); });
  await sleep(1800);
  await page.evaluate(() => { window.__app.paused = true; });
  await sleep(300);
  await shot('3-dusk');

  // 4. night battle on the threatened side
  await page.evaluate(sim, 15.5 + 30);
  const edge = await page.evaluate(rally, [hx, hy]);
  const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][edge];
  await page.evaluate(() => { window.__app.paused = false; });
  await centre(hx + 1.5 + dx * 8, hy + 1.5 + dy * 8, zoom * 1.1);
  await sleep(900);
  await page.evaluate(() => { window.__app.paused = true; });
  await prep(page);
  await sleep(300);
  await shot('4-night');

  // 5. Blood Moon: a fresh run on night 10 with the Abomination at the walls
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__app);
  await page.evaluate(stageBase, 10);
  await page.evaluate(() => { const a = window.__app; a.closeModals(); a.game.s.phaseTime = 110 - 15.2; });
  await page.evaluate(sim, 15.5 + 22);
  const bossEdge = await page.evaluate(rally, [hx, hy]);
  const [bx, by] = [[0, -1], [1, 0], [0, 1], [-1, 0]][bossEdge];
  await page.evaluate(() => { const a = window.__app; a.paused = false; a.started = true; });
  await centre(hx + 1.5 + bx * 7, hy + 1.5 + by * 7, zoom);
  await sleep(900);
  await page.evaluate(() => { window.__app.paused = true; });
  await prep(page);
  await sleep(300);
  await shot('5-bloodmoon');

  // in-app purchase review screenshot (App Store Connect asks for one per product)
  if (dev.name.startsWith('iphone')) {
    await page.evaluate(() => { window.__app.openShop(); });
    await page.addStyleTag({ content: '.testbadge { display: none !important; }' });
    await sleep(500);
    const file = path.join(OUT, 'iap-review_trading-post.png');
    await page.screenshot({ path: file });
    console.log('  ', path.relative(ROOT, file));
  }
  await ctx.close();
}

/** Puts a caption band above each raw capture at the same pixel size. */
async function compose(browser, dev, raw, store) {
  const W = dev.viewport.width * dev.scale, H = dev.viewport.height * dev.scale;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const c = dev.caption;
  for (const s of SHOTS) {
    const img = fs.readFileSync(path.join(raw, `${dev.name}_${s.id}.png`)).toString('base64');
    const pad = Math.round(W * 0.045);
    const availH = H - c.band - pad, availW = W - pad * 2;
    const ratio = Math.min(availW / W, availH / H);
    const iw = Math.round(W * ratio), ih = Math.round(H * ratio);
    await page.setContent(`<!doctype html><html><head><style>
      * { margin: 0; box-sizing: border-box; }
      body { width: ${W}px; height: ${H}px; overflow: hidden; font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;
        background: radial-gradient(ellipse at 50% 0%, #3a1510 0%, #160d0a 45%, #0b0c09 100%); color: #ece6d6; }
      .cap { height: ${c.band}px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 ${pad}px; }
      h1 { font-size: ${c.title}px; font-weight: 900; letter-spacing: -1px; line-height: 1.02; text-shadow: 0 6px 0 rgba(0,0,0,0.5); }
      h1 span { color: #f2c94c; }
      p { font-size: ${c.sub}px; color: #c8bfa8; margin-top: ${Math.round(c.sub * 0.45)}px; font-weight: 500; }
      .shot { position: absolute; left: ${(W - iw) / 2}px; top: ${c.band}px; width: ${iw}px; height: ${ih}px; border-radius: ${Math.round(W * 0.035)}px;
        overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.75), 0 0 0 ${Math.max(3, Math.round(W * 0.004))}px #2b2a24; }
      .shot img { width: 100%; height: 100%; display: block; }
    </style></head><body>
      <div class="cap"><h1>${s.title} <span>${s.accent}</span></h1><p>${s.sub}</p></div>
      <div class="shot"><img src="data:image/png;base64,${img}"></div>
    </body></html>`);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const file = path.join(store, `${dev.name}_${s.id}.png`);
    await page.screenshot({ path: file });
    console.log('  ', path.relative(ROOT, file));
  }
  await ctx.close();
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('Run `npm run build` first.');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* starting */ }
      await sleep(250);
    }
    const raw = path.join(OUT, 'raw'), store = path.join(OUT, 'store');
    fs.mkdirSync(raw, { recursive: true });
    fs.mkdirSync(store, { recursive: true });
    const browser = await chromium.launch();
    for (const dev of DEVICES) {
      console.log(`${dev.name}: capturing`);
      await captureDevice(browser, dev, raw);
      console.log(`${dev.name}: composing captions`);
      await compose(browser, dev, raw, store);
    }
    await browser.close();
  } finally {
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
