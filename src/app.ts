import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import {
  BUILDINGS, BUILD_MENU, CAPS, DAY_LEN, GUARD_TRAIN, MAP_H, MAP_W, NIGHT_LEN, TILE, UPGRADES,
  canAfford, costLabel, type BuildingKind,
} from './game/config';
import { Game, type GameEvent } from './game/game';
import { QUESTS } from './game/quests';
import { Renderer, type Camera, type Overlay } from './game/render';
import type { Building, ResNode, Unit, WorkJob } from './game/state';
import { HQ_CX, HQ_CY, newGame, type Perks } from './game/world';
import { Music, Sfx } from './platform/audio';
import { BUILDING_ICO, costHtml, ico } from './ui/icons';
import { loadProfile, loadRun, saveProfile, saveRun, type Profile } from './platform/profile';
import { PRODUCTS, createStore, type Store } from './platform/store';

type Mode = 'none' | 'build' | 'post' | 'patrol' | 'airstrike';
type Tab = 'build' | 'jobs' | 'powers';
type Sel = Overlay['selected'];

const T = TILE;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const CAP = '<i class="cap"></i>';

/** Shop artwork: stacks of caps for currency packs, icons for unlocks. */
function productArt(id: string): string {
  const stack = (n: number) => `<span class="capstack">${'<i class="cap"></i>'.repeat(n)}</span>`;
  switch (id) {
    case 'lasthaven.caps.small': return stack(1);
    case 'lasthaven.caps.medium': return stack(3);
    case 'lasthaven.caps.large': return stack(5);
    case 'lasthaven.starter': return ico('crate', 'big');
    default: return ico('ruin', 'big');
  }
}

export class App {
  game!: Game;
  profile: Profile;
  store: Store;
  sfx = new Sfx();
  music = new Music(this.sfx);
  renderer: Renderer;
  cam: Camera = { x: 0, y: 0, zoom: 1 };

  mode: Mode = 'none';
  buildKind: BuildingKind = 'wall';
  tab: Tab = 'build';
  trayOpen = true;
  selected: Sel = null;
  pointer: { x: number; y: number } | null = null;
  ghost: Overlay['ghost'] = null;
  paused = true;
  /** true once the player has left the title screen, so a run is worth saving */
  started = false;
  speed = 1;
  shake = 0;
  private last = performance.now();
  private hudTimer = 0;
  private saveTimer = 0;
  private lastPaint: { tx: number; ty: number } | null = null;
  private paintFailed = false;
  private html = new Map<string, string>();
  private ui: HTMLElement;
  private modalStack: string[] = [];

  constructor(private canvas: HTMLCanvasElement, root: HTMLElement) {
    this.ui = root;
    this.profile = loadProfile();
    this.sfx.enabled = this.profile.sound;
    this.music.enabled = this.profile.music;
    this.renderer = new Renderer(canvas);
    this.store = createStore(
      (id, tx) => this.grant(id, tx),
      () => this.refreshShop(),
      (title, price) => this.confirm('Test purchase', `This is the browser TEST STORE. No money will be charged.<br><br>Buy <b>${esc(title)}</b> for ${price}?`, 'Buy'),
    );
    this.buildDom();
    this.bindInput();
    window.addEventListener('resize', () => { this.renderer.resize(); this.clampCam(); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      this.save();
      // pause mid-game when the player leaves the app (phone call, home button…)
      if (this.started && !this.modalStack.length && !this.game.s.gameOver) this.openMenu();
    });
    window.addEventListener('pagehide', () => this.save());
    this.renderer.resize();

    const saved = loadRun();
    this.startGame(saved ?? newGame((Math.random() * 2 ** 31) | 0, this.perks()), false);
    this.showTitle(!!saved);
    this.store.init().then(() => this.refreshShop()).catch((e) => console.warn('Store unavailable', e));
    requestAnimationFrame((t) => this.frame(t));
  }

  // ================================================================== run lifecycle
  perks(): Perks {
    const starter = this.profile.owned.includes('lasthaven.starter');
    return {
      extraWorkers: starter ? 2 : 0,
      extraGuards: starter ? 1 : 0,
      doubleLoot: this.profile.owned.includes('lasthaven.doubleloot'),
      goldHq: starter,
    };
  }

  startGame(state: ReturnType<typeof newGame>, announce = true) {
    this.game = new Game(state, this.perks());
    this.selected = null;
    this.setMode('none');
    this.cam.zoom = Math.min(1.4, Math.max(0.8, Math.min(window.innerWidth, window.innerHeight) / 480));
    this.centerOn(HQ_CX, HQ_CY);
    if (announce) this.game.toast('☀️ Day 1. Gather supplies and fortify before nightfall.', 'info');
    this.renderHud(true);
  }

  newRun() {
    saveRun(null);
    this.startGame(newGame((Math.random() * 2 ** 31) | 0, this.perks()));
    this.closeModals();
    this.paused = false;
    this.started = true;
  }

  save() {
    if (this.started) saveRun(this.game?.s ?? null);
    saveProfile(this.profile);
  }

  // ================================================================== caps & purchases
  addCaps(n: number, reason: string) {
    if (n <= 0) return;
    this.profile.caps += n;
    saveProfile(this.profile);
    this.toast(`${CAP} +${n} Caps — ${esc(reason)}`, 'good', true);
    this.bump('#caps');
  }

  spendCaps(n: number): boolean {
    if (this.profile.caps < n) {
      this.sfx.play('error');
      this.toast(`You need ${n} Caps`, 'warn');
      this.openShop();
      return false;
    }
    this.profile.caps -= n;
    saveProfile(this.profile);
    this.sfx.play('coin');
    this.haptic('success');
    return true;
  }

  grant(productId: string, txId: string) {
    const key = `${productId}:${txId}`;
    if (this.profile.processedTx.includes(key)) return;
    const p = PRODUCTS.find((x) => x.id === productId);
    if (!p) return;
    this.profile.processedTx.push(key);
    if (p.kind === 'nonconsumable') {
      if (this.profile.owned.includes(p.id)) { saveProfile(this.profile); return; } // restore of something we already have
      this.profile.owned.push(p.id);
      if (this.game) this.game.perks = this.perks();
    }
    if (p.caps) this.profile.caps += p.caps;
    saveProfile(this.profile);
    this.sfx.play('coin');
    this.haptic('success');
    this.toast(`✅ ${esc(p.title)} unlocked${p.caps ? ` — +${p.caps} Caps` : ''}`, 'good', true);
    this.refreshShop();
    this.renderHud(true);
  }

  // ================================================================== main loop
  private frame(t: number) {
    const raw = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (!this.paused) {
      // fixed 50 ms max sub-steps so slow frames catch up instead of running in slow motion
      let remaining = raw * this.speed;
      while (remaining > 1e-4) {
        const step = Math.min(remaining, 0.05);
        this.game.update(step);
        remaining -= step;
      }
    }
    this.handleEvents();
    this.shake = Math.max(0, this.shake - raw * 40);
    this.renderer.draw(this.game, this.cam, this.overlay(), t / 1000, this.shake);
    this.hudTimer -= raw;
    if (this.hudTimer <= 0) { this.hudTimer = 0.12; this.renderHud(); }
    this.saveTimer += raw;
    if (this.saveTimer > 30) { this.saveTimer = 0; this.save(); }
    requestAnimationFrame((n) => this.frame(n));
  }

  private overlay(): Overlay {
    let patrolFrom: Overlay['patrolFrom'] = null;
    if (this.mode === 'patrol' && this.selected?.type === 'unit') {
      const u = this.selectedUnit();
      if (u) patrolFrom = { x: u.x, y: u.y };
    }
    return {
      selected: this.selected,
      ghost: this.mode === 'build' ? this.ghost : null,
      patrolFrom,
      pointer: this.pointer,
      airstrike: this.mode === 'airstrike',
      goldHq: this.game.perks.goldHq,
    };
  }

  private handleEvents(): void {
    const evs: GameEvent[] = this.game.events.splice(0);
    for (const e of evs) {
      switch (e.type) {
        case 'toast': this.toast(esc(e.text), e.tone); break;
        case 'sound': this.sfx.play(e.name); break;
        case 'caps': this.addCaps(e.amount, e.reason); this.save(); break;
        case 'quest':
          if (!this.profile.claimedQuests.includes(e.index)) {
            this.profile.claimedQuests.push(e.index);
            this.addCaps(e.reward, `Goal complete: ${e.title}`);
          } else {
            this.toast(`🎯 Goal complete: ${esc(e.title)}`, 'good');
          }
          this.save();
          break;
        case 'victory': this.profile.wins++; saveProfile(this.profile); this.showVictory(); break;
        case 'shake': this.shake = Math.max(this.shake, e.amount); if (e.amount > 10) this.haptic('heavy'); break;
        case 'dusk': this.haptic('warning'); break;
        case 'dawn': this.recordBest(); break;
        case 'save': this.save(); break;
        case 'gameover': this.recordBest(); saveRun(null); this.showGameOver(); break;
      }
    }
  }

  private recordBest() {
    const b = this.profile.best;
    b.days = Math.max(b.days, this.game.s.day);
    b.kills = Math.max(b.kills, this.game.s.kills);
    saveProfile(this.profile);
  }

  private haptic(kind: 'light' | 'heavy' | 'success' | 'warning') {
    if (!this.profile.haptics) return;
    try {
      if (kind === 'light') void Haptics.impact({ style: ImpactStyle.Light });
      else if (kind === 'heavy') void Haptics.impact({ style: ImpactStyle.Heavy });
      else void Haptics.notification({ type: kind === 'success' ? NotificationType.Success : NotificationType.Warning });
    } catch { /* not supported on this device */ }
  }

  // ================================================================== camera & input
  centerOn(tx: number, ty: number) {
    this.cam.x = tx * T - this.renderer.w / this.cam.zoom / 2;
    this.cam.y = ty * T - this.renderer.h / this.cam.zoom / 2;
    this.clampCam();
  }

  clampCam() {
    const vw = this.renderer.w / this.cam.zoom, vh = this.renderer.h / this.cam.zoom;
    const pad = 160;
    this.cam.x = Math.max(-pad, Math.min(MAP_W * T - vw + pad, this.cam.x));
    this.cam.y = Math.max(-pad - 60, Math.min(MAP_H * T - vh + pad + 120, this.cam.y));
  }

  private toWorld(sx: number, sy: number) {
    return { x: (this.cam.x + sx / this.cam.zoom) / T, y: (this.cam.y + sy / this.cam.zoom) / T };
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = Math.max(0.45, Math.min(2.4, this.cam.zoom * factor));
    this.cam.x = before.x * T - sx / this.cam.zoom;
    this.cam.y = before.y * T - sy / this.cam.zoom;
    this.clampCam();
  }

  private paints(): boolean {
    return this.mode === 'build' && (this.buildKind === 'wall' || this.buildKind === 'steelwall' || this.buildKind === 'trap');
  }

  private bindInput() {
    const c = this.canvas;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let moved = false;
    let painting = false;
    let pinch: { d: number; mx: number; my: number } | null = null;

    c.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        moved = false;
        this.pointer = this.toWorld(e.clientX, e.clientY);
        this.updateGhost();
        if (this.paints() && !this.paused) {
          painting = true;
          this.lastPaint = null;
          this.paintFailed = false;
          this.paintAt(this.pointer.x, this.pointer.y);
        }
      } else if (pts.size === 2) {
        if (painting) { painting = false; this.lastPaint = null; }
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        moved = true;
      }
    });

    c.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse') { this.pointer = this.toWorld(e.clientX, e.clientY); this.updateGhost(); }
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.cam.x -= (mx - pinch.mx) / this.cam.zoom;
        this.cam.y -= (my - pinch.my) / this.cam.zoom;
        if (pinch.d > 0) this.zoomAt(mx, my, d / pinch.d);
        pinch = { d, mx, my };
        this.clampCam();
        return;
      }
      this.pointer = this.toWorld(e.clientX, e.clientY);
      this.updateGhost();
      if (painting) { this.paintAt(this.pointer.x, this.pointer.y); return; }
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) moved = true;
      if (moved) {
        this.cam.x -= dx / this.cam.zoom;
        this.cam.y -= dy / this.cam.zoom;
        this.clampCam();
      }
    });

    const end = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size > 0) return;
      if (painting) { painting = false; this.lastPaint = null; return; }
      if (!moved && e.type === 'pointerup') {
        const w = this.toWorld(e.clientX, e.clientY);
        this.tap(w.x, w.y);
      }
      if (e.pointerType !== 'mouse' && this.mode !== 'build') this.pointer = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (this.modalStack.length) this.closeModal(); else this.setMode('none'); }
      if (e.key === ' ' && !this.modalStack.length) { this.speed = this.speed === 1 ? 2 : 1; this.renderHud(true); }
    });
  }

  private updateGhost() {
    if (this.mode !== 'build' || !this.pointer) return;
    const size = BUILDINGS[this.buildKind].size;
    this.ghost = {
      kind: this.buildKind,
      tx: Math.floor(this.pointer.x - (size - 1) / 2),
      ty: Math.floor(this.pointer.y - (size - 1) / 2),
    };
  }

  private paintAt(wx: number, wy: number) {
    const tx = Math.floor(wx), ty = Math.floor(wy);
    const from = this.lastPaint ?? { tx, ty };
    // walk the line between samples so fast swipes leave no gaps
    let x = from.tx, y = from.ty;
    const dx = Math.abs(tx - x), dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx + dy;
    let placed = 0;
    let failure: string | null = null;
    for (let guard = 0; guard < 200; guard++) {
      if (this.game.canPlace(this.buildKind, x, y)) {
        const r = this.game.place(this.buildKind, x, y, true);
        if (r) failure = r; else placed++;
      }
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    this.lastPaint = { tx, ty };
    if (placed) { this.sfx.play('place'); this.haptic('light'); }
    if (failure && !placed && !this.paintFailed) {
      this.paintFailed = true; // one warning per drag, not one per finger movement
      this.toast(esc(failure), 'bad');
      this.sfx.play('error');
    }
  }

  private tap(wx: number, wy: number) {
    if (this.paused) return;
    const g = this.game;
    switch (this.mode) {
      case 'build': {
        if (this.paints()) return;
        this.pointer = { x: wx, y: wy };
        this.updateGhost();
        const gh = this.ghost!;
        const err = g.place(gh.kind, gh.tx, gh.ty);
        if (err) { this.toast(esc(err), 'bad'); this.sfx.play('error'); return; }
        this.haptic('light');
        this.setMode('none');
        return;
      }
      case 'post': {
        const u = this.selectedUnit();
        if (u) { g.orderPost(u, wx, wy); this.toast('Guard posted', 'info'); }
        this.setMode('none');
        return;
      }
      case 'patrol': {
        const u = this.selectedUnit();
        if (u) { g.orderPatrol(u, u.x, u.y, wx, wy); this.toast('🔁 Patrol route set', 'info'); }
        this.setMode('none');
        return;
      }
      case 'airstrike': {
        if (this.spendCaps(CAPS.airstrike)) g.airstrike(wx, wy);
        this.setMode('none');
        return;
      }
    }
    // selection
    const tx = Math.floor(wx), ty = Math.floor(wy);
    let best: Unit | null = null;
    let bd = 0.75;
    for (const u of g.s.units) {
      if (u.state === 'sheltered') continue;
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d < bd) { bd = d; best = u; }
    }
    if (best) this.select({ type: 'unit', id: best.id });
    else {
      const b = g.buildingAt(tx, ty);
      if (b) this.select({ type: 'building', id: b.id });
      else {
        const n = g.isExplored(tx, ty) ? g.nodeAt(tx, ty) : undefined;
        if (n) this.select({ type: 'node', id: n.id });
        else this.select(null);
      }
    }
  }

  select(sel: Sel) {
    this.selected = sel;
    if (sel) { this.sfx.play('click'); this.haptic('light'); }
    this.renderHud(true);
  }

  setMode(m: Mode, kind?: BuildingKind) {
    this.mode = m;
    if (kind) this.buildKind = kind;
    if (m === 'build') {
      this.selected = null;
      if (!this.pointer) this.pointer = this.toWorld(this.renderer.w / 2, this.renderer.h / 2);
      this.updateGhost();
    } else {
      this.ghost = null;
    }
    this.renderHud(true);
  }

  selectedUnit(): Unit | undefined {
    return this.selected?.type === 'unit' ? this.game.s.units.find((u) => u.id === this.selected!.id) : undefined;
  }
  selectedBuilding(): Building | undefined {
    return this.selected?.type === 'building' ? this.game.byId.get(this.selected.id) : undefined;
  }
  selectedNode(): ResNode | undefined {
    return this.selected?.type === 'node' ? this.game.nodeById.get(this.selected.id) : undefined;
  }

  // ================================================================== DOM / HUD
  private buildDom() {
    this.ui.innerHTML = `
      <div class="top">
        <div class="daypill" id="daypill"><span id="dayicon"></span><b id="daylabel">Day 1</b><div class="phase"><i id="phasebar"></i></div></div>
        <div class="res">
          <span class="chip" title="Wood">${ico('wood')}<b id="r-wood">0</b></span>
          <span class="chip" title="Scrap">${ico('scrap')}<b id="r-scrap">0</b></span>
          <span class="chip" title="Food">${ico('food')}<b id="r-food">0</b></span>
          <span class="chip" title="Population">${ico('pop')}<b id="r-pop">0</b></span>
        </div>
        <div class="topright">
          <button class="chip caps" id="caps" data-a="shop" aria-label="Shop">${CAP}<b id="r-caps">0</b><span class="plus">+</span></button>
          <button class="iconbtn" id="speed" data-a="speed" aria-label="Game speed"></button>
          <button class="iconbtn" data-a="menu" aria-label="Menu">${ico('menu')}</button>
        </div>
      </div>
      <div class="boss hidden" id="boss"></div>
      <div class="quest" id="quest" data-a="quest"></div>
      <div class="toasts" id="toasts"></div>
      <div class="bottom">
        <div class="event" id="event"></div>
        <div class="panel" id="panel"></div>
        <div class="tray" id="tray"></div>
        <div class="tabs" id="tabs">
          <button data-a="tab" data-v="build">${ico('hammer')}<span>Build</span></button>
          <button data-a="tab" data-v="jobs">${ico('worker')}<span>Jobs</span></button>
          <button data-a="tab" data-v="powers">${ico('bolt')}<span>Powers</span></button>
          <button data-a="home">${ico('home')}<span>Base</span></button>
        </div>
      </div>
      <div class="modal-root" id="modals"></div>
    `;
    this.ui.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || el.hasAttribute('disabled')) return;
      this.sfx.unlock();
      this.action(el.dataset.a!, el.dataset.v ?? '');
    });
  }

  private set(id: string, html: string) {
    if (this.html.get(id) === html) return;
    this.html.set(id, html);
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  private bump(sel: string) {
    const el = this.ui.querySelector(sel);
    if (!el) return;
    el.classList.remove('bump');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('bump');
  }

  renderHud(force = false) {
    if (force) this.html.clear();
    const g = this.game;
    const s = g.s;
    const txt = (id: string, v: string) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
    txt('r-wood', String(Math.floor(s.res.wood)));
    txt('r-scrap', String(Math.floor(s.res.scrap)));
    txt('r-food', String(Math.floor(s.res.food)));
    txt('r-pop', `${g.pop}/${g.popCap}`);
    txt('r-caps', String(this.profile.caps));
    txt('daylabel', s.isNight ? `Night ${s.day}` : `Day ${s.day}`);
    this.set('dayicon', ico(s.isNight ? 'moon' : s.warned ? 'dusk' : 'sun'));
    this.set('speed', ico(this.paused ? 'pause' : this.speed === 1 ? 'play' : 'fast'));
    this.music.setMood(s.isNight ? 'night' : 'day', s.zombies.length);
    const frac = s.isNight ? s.phaseTime / NIGHT_LEN : s.phaseTime / DAY_LEN;
    const bar = document.getElementById('phasebar');
    if (bar) { bar.style.width = `${Math.min(100, frac * 100)}%`; bar.className = s.isNight ? 'night' : s.warned ? 'dusk' : ''; }
    document.getElementById('daypill')?.classList.toggle('night', s.isNight);

    const q = QUESTS[s.questIndex];
    const claimed = q ? this.profile.claimedQuests.includes(s.questIndex) : false;
    this.set('quest', q ? `<b>${ico('target')} ${esc(q.title)}</b><span>${esc(q.hint)}</span><em>${claimed ? '✓' : `${CAP}${q.reward}`}</em>` : '');
    document.getElementById('quest')?.classList.toggle('hidden', !q || s.zombies.some((z) => z.kind === 'abomination'));

    // boss health bar
    const boss = s.zombies.find((z) => z.kind === 'abomination' && z.hp > 0);
    const bossEl = document.getElementById('boss');
    if (bossEl) {
      bossEl.classList.toggle('hidden', !boss);
      if (boss) this.set('boss', `<b>${ico('skull')} ABOMINATION</b><div class="bar"><i style="width:${(boss.hp / boss.maxHp) * 100}%"></i></div>`);
    }
    this.set('event', s.event && this.mode === 'none' ? this.eventHtml() : '');

    for (const b of this.ui.querySelectorAll<HTMLElement>('#tabs [data-a=tab]')) {
      b.classList.toggle('on', this.trayOpen && b.dataset.v === this.tab);
    }
    this.set('tray', this.trayOpen && this.mode === 'none' && !this.selected ? this.trayHtml() : '');
    this.set('panel', this.panelHtml());

    // guide new players: pulse the control the current goal needs
    for (const el of this.ui.querySelectorAll('.pulse')) el.classList.remove('pulse');
    const focus = q?.focus?.(s);
    if (focus && this.mode === 'none' && !this.selected && s.questIndex < 6) {
      const target = this.trayOpen && this.tab === focus.tab
        ? this.ui.querySelector(`#tray ${focus.sel}`)
        : this.ui.querySelector(`#tabs [data-v=${focus.tab}]`);
      target?.classList.add('pulse');
    }
  }

  private eventHtml(): string {
    const ev = this.game.s.event!;
    if (ev.kind === 'trader') {
      const ok = canAfford(this.game.s.res, ev.give);
      return `<div class="evcard"><div class="info"><b>${ico('crate')} Wandering trader</b><p>Offers <span class="cost">${costHtml(ev.get)}</span> for your <span class="cost">${costHtml(ev.give)}</span></p></div>
        <div class="acts"><button class="btn ghost" data-a="event-no">Pass</button><button class="btn gold" data-a="event-yes" ${ok ? '' : 'disabled'}>Trade</button></div></div>`;
    }
    const room = this.game.popCap - this.game.pop;
    return `<div class="evcard"><div class="info"><b>${ico('pop')} Refugees at the gate</b><p>${ev.count} survivors ask to join.${room <= 0 ? ' You have no room. Build or upgrade houses.' : ''}</p></div>
      <div class="acts"><button class="btn ghost" data-a="event-no">Turn away</button><button class="btn gold" data-a="event-yes" ${room > 0 ? '' : 'disabled'}>Let them in</button></div></div>`;
  }

  private trayHtml(): string {
    const g = this.game;
    const s = g.s;
    if (this.tab === 'build') {
      return `<div class="scroller">${BUILD_MENU.map((k) => {
        const d = BUILDINGS[k];
        const locked = s.day < d.unlockDay;
        const afford = canAfford(s.res, d.cost);
        return `<button class="card ${afford && !locked ? '' : 'dim'}" data-a="build" data-v="${k}">
          <span class="ic">${ico(BUILDING_ICO[k])}</span><span class="nm">${d.name}</span>
          <span class="cost">${locked ? `${ico('lock')} Day ${d.unlockDay}` : costHtml(d.cost)}</span></button>`;
      }).join('')}</div>`;
    }
    if (this.tab === 'jobs') {
      const idle = g.workers.length - (s.jobs.wood + s.jobs.scrap + s.jobs.food);
      const row = (j: WorkJob, icon: string, name: string, note: string) => `
        <div class="job"><span class="ic">${ico(icon)}</span><span class="nm">${name}<small>${note}</small></span>
          <button class="step" data-a="job" data-v="${j}:-1" ${s.jobs[j] ? '' : 'disabled'}>−</button>
          <b>${s.jobs[j]}</b>
          <button class="step" data-a="job" data-v="${j}:1" ${idle > 0 ? '' : 'disabled'}>+</button></div>`;
      const slots = s.buildings.filter((b) => b.kind === 'farm' && b.built >= 1).reduce((n, b) => n + g.farmSlots(b), 0);
      return `<div class="jobs">
        ${row('wood', 'axe', 'Lumberjacks', 'Chop trees')}
        ${row('scrap', 'wrench', 'Salvagers', 'Strip wrecks')}
        ${row('food', 'farm', 'Farmers', `${slots} farm slot${slots === 1 ? '' : 's'}`)}
        <div class="jobnote">${ico('idle')} ${idle} idle · ${ico('gun')} ${s.units.filter((u) => u.kind !== 'worker').length} armed · Everyone eats ${ico('food')}3 at dawn</div>
      </div>`;
    }
    const repair = g.repairAllCost();
    const hasRepair = Object.keys(repair).length > 0;
    const power = (a: string, icon: string, name: string, desc: string, cost: string, dis = false) =>
      `<button class="card power" data-a="${a}" ${dis ? 'disabled' : ''}><span class="ic">${ico(icon)}</span><span class="nm">${name}</span><span class="desc">${desc}</span><span class="cost">${cost}</span></button>`;
    return `<div class="scroller">
      ${power('drop', 'crate', 'Supply Drop', 'Wood, scrap & food', `${CAP}${CAPS.supplyDrop}`)}
      ${power('strike', 'blast', 'Airstrike', 'Wipe out a horde', `${CAP}${CAPS.airstrike}`)}
      ${power('merc', 'medal', 'Mercenary', 'Elite gunner joins', `${CAP}${CAPS.mercenary}`)}
      ${power('repairall', 'repair', 'Repair All', 'Fix every structure', hasRepair ? costHtml(repair) : 'All good', !hasRepair)}
    </div>`;
  }

  private panelHtml(): string {
    const g = this.game;
    const s = g.s;
    if (this.mode !== 'none') {
      const msg: Record<Exclude<Mode, 'none'>, string> = {
        build: `${ico(BUILDING_ICO[this.buildKind])} <b>${BUILDINGS[this.buildKind].name}</b> <span class="cost">${costHtml(BUILDINGS[this.buildKind].cost)}</span><br><small>${this.paints() ? 'Drag to paint · two fingers to move the map' : 'Tap the map to place'}</small>`,
        post: '📍 Tap where this guard should stand',
        patrol: '🔁 Tap the far end of the patrol route',
        airstrike: `💥 Tap the target · ${CAP}${CAPS.airstrike}`,
      };
      return `<div class="sel mode"><div class="info">${msg[this.mode]}</div><div class="acts"><button class="btn" data-a="cancel">${this.mode === 'build' && this.paints() ? 'Done' : 'Cancel'}</button></div></div>`;
    }
    const sel = this.selected;
    if (!sel) return '';
    const hp = (cur: number, max: number) => `<div class="hp"><i style="width:${Math.max(0, (cur / max) * 100)}%"></i></div><small>${Math.ceil(cur)} / ${max}</small>`;
    if (sel.type === 'building') {
      const b = g.byId.get(sel.id);
      if (!b) { this.selected = null; return ''; }
      const d = BUILDINGS[b.kind];
      const acts: string[] = [];
      const lvlName = b.level > 1 ? UPGRADES[b.kind]?.[b.level - 2]?.name : undefined;
      const title = `${ico(BUILDING_ICO[b.kind])} ${lvlName ?? d.name}${UPGRADES[b.kind] && b.kind !== 'wall' ? ` <small class="lvl">Lv ${b.level}</small>` : ''}`;
      let info = `<b>${title}</b>${hp(b.hp, b.maxHp)}<p class="desc">${d.desc}</p>`;
      if (b.built < 1) {
        info = `<b>${title}</b><p>Under construction… ${Math.floor(b.built * 100)}%</p>`;
        acts.push(`<button class="btn gold" data-a="finish">Finish now ${CAP}${g.finishCost(b)}</button>`);
      } else {
        if (b.kind === 'barracks') {
          info += b.trainQueue ? `<p>Training ${b.trainQueue} guard(s)…</p>` : '';
          acts.push(`<button class="btn" data-a="train">Train Guard <span class="cost">${costHtml(GUARD_TRAIN.cost)}</span></button>`);
        }
        if (b.kind === 'hq') info += `<p>${g.workers.filter((u) => u.state === 'sheltered').length} sheltering inside · ${s.kills} zombies killed</p>`;
        const up = g.nextUpgrade(b);
        if (up) {
          const locked = s.day < up.unlockDay;
          info += `<p class="upnote">${ico('upgrade')} <b>${up.name}</b>: ${up.desc}</p>`;
          acts.push(`<button class="btn gold" data-a="upgrade" ${locked || !canAfford(s.res, up.cost) ? 'disabled' : ''}>${locked ? `${ico('lock')} Day ${up.unlockDay}` : `Upgrade <span class="cost">${costHtml(up.cost)}</span>`}</button>`);
        }
        const rc = g.repairCost(b);
        if (Object.keys(rc).length) acts.push(`<button class="btn" data-a="repair">Repair <span class="cost">${costHtml(rc)}</span></button>`);
      }
      if (b.kind !== 'hq') acts.push(`<button class="btn ghost" data-a="demolish">Demolish</button>`);
      return `<div class="sel"><div class="info">${info}</div><div class="acts">${acts.join('')}<button class="x" data-a="deselect">✕</button></div></div>`;
    }
    if (sel.type === 'unit') {
      const u = g.s.units.find((x) => x.id === sel.id);
      if (!u || u.state === 'sheltered') { this.selected = null; return ''; }
      if (u.kind === 'worker') {
        const doing: Record<string, string> = {
          idle: 'Idle', toNode: 'Heading out', gather: u.job === 'wood' ? 'Chopping wood' : 'Salvaging scrap', return: 'Hauling back',
          toFarm: 'Walking to the farm', farming: 'Farming', shelter: 'Running for shelter', expedition: 'On a scavenging run',
          searching: 'Searching the ruins', home: 'Returning with loot',
        };
        return `<div class="sel"><div class="info"><b>${ico('pop')} Survivor</b>${hp(u.hp, u.maxHp)}<p>${doing[u.state] ?? ''}</p></div><div class="acts"><button class="btn" data-a="tab" data-v="jobs">Jobs</button><button class="x" data-a="deselect">✕</button></div></div>`;
      }
      const name = u.kind === 'merc' ? `${ico('medal')} Mercenary` : `${ico('gun')} Guard`;
      const status = u.patrol ? 'Patrolling' : 'Holding position';
      return `<div class="sel"><div class="info"><b>${name}</b>${hp(u.hp, u.maxHp)}<p>${status}</p></div><div class="acts">
        <button class="btn" data-a="post">Move</button><button class="btn" data-a="patrol">Patrol</button><button class="x" data-a="deselect">✕</button></div></div>`;
    }
    const n = g.nodeById.get(sel.id);
    if (!n) { this.selected = null; return ''; }
    if (n.kind === 'ruin') {
      const busy = g.s.units.some((u) => (u.state === 'expedition' || u.state === 'searching') && u.targetId === n.id);
      const far = Math.round(Math.hypot(n.tx - HQ_CX, n.ty - HQ_CY));
      return `<div class="sel"><div class="info"><b>${ico('ruin')} ${n.max === 1 ? 'Supply cache' : 'Ruins'}</b><p>${n.amount ? `${n.amount} search${n.amount > 1 ? 'es' : ''} left · ${far} tiles from home. Farther ruins hide better loot — and more danger.` : 'Picked clean.'}</p></div>
        <div class="acts">${n.amount ? `<button class="btn gold" data-a="scavenge" ${busy || s.isNight ? 'disabled' : ''}>${busy ? 'Scavenger en route' : s.isNight ? 'Wait for daylight' : 'Send scavenger'}</button>` : ''}<button class="x" data-a="deselect">✕</button></div></div>`;
    }
    const label = n.kind === 'tree' ? `${ico('wood')} Tree · ${n.amount} wood` : `${ico('scrap')} Wreck · ${n.amount} scrap`;
    return `<div class="sel"><div class="info"><b>${label}</b><p>Assign ${n.kind === 'tree' ? 'Lumberjacks' : 'Salvagers'} in Jobs to harvest.</p></div><div class="acts"><button class="btn" data-a="tab" data-v="jobs">Jobs</button><button class="x" data-a="deselect">✕</button></div></div>`;
  }

  private action(a: string, v: string) {
    const g = this.game;
    switch (a) {
      case 'tab':
        if (this.tab === v && this.trayOpen && this.selected === null) this.trayOpen = false;
        else { this.tab = v as Tab; this.trayOpen = true; }
        if (this.mode !== 'none') this.setMode('none');
        this.selected = null;
        this.sfx.play('click');
        break;
      case 'home': this.centerOn(HQ_CX, HQ_CY); this.sfx.play('click'); break;
      case 'build': {
        const k = v as BuildingKind;
        const d = BUILDINGS[k];
        if (g.s.day < d.unlockDay) { this.toast(`${d.name} unlocks on Day ${d.unlockDay}`, 'warn'); this.sfx.play('error'); return; }
        if (!canAfford(g.s.res, d.cost)) { this.toast(`Need ${costLabel(d.cost)} for a ${d.name}`, 'bad'); this.sfx.play('error'); return; }
        this.setMode('build', k);
        this.sfx.play('click');
        break;
      }
      case 'cancel': this.setMode('none'); break;
      case 'deselect': this.select(null); break;
      case 'job': {
        const [j, d] = v.split(':');
        g.setJobs(j as WorkJob, Number(d));
        break;
      }
      case 'finish': {
        const b = this.selectedBuilding();
        if (b && this.spendCaps(g.finishCost(b))) g.finishNow(b);
        break;
      }
      case 'train': {
        const b = this.selectedBuilding();
        if (b) { const err = g.trainGuard(b); if (err) { this.toast(esc(err), 'bad'); this.sfx.play('error'); } }
        break;
      }
      case 'repair': { const b = this.selectedBuilding(); if (b) g.repair(b); break; }
      case 'upgrade': {
        const b = this.selectedBuilding();
        if (!b) break;
        const err = g.upgrade(b);
        if (err) { this.toast(esc(err), 'bad'); this.sfx.play('error'); } else { this.haptic('success'); this.toast(`${ico('upgrade')} Upgraded to ${esc(UPGRADES[b.kind === 'steelwall' ? 'wall' : b.kind]![Math.max(0, b.level - 2)]?.name ?? 'Steel Wall')}`, 'good'); }
        break;
      }
      case 'event-yes': { const err = g.acceptEvent(); if (err) { this.toast(esc(err), 'bad'); this.sfx.play('error'); } break; }
      case 'event-no': g.declineEvent(); break;
      case 'music':
        this.profile.music = !this.profile.music;
        this.music.enabled = this.profile.music;
        saveProfile(this.profile);
        this.openMenu(true);
        break;
      case 'endless': this.closeModals(); this.paused = false; break;
      case 'demolish': {
        const b = this.selectedBuilding();
        if (!b) break;
        void this.confirm('Demolish?', `Tear down this ${BUILDINGS[b.kind].name}? You get half the materials back.`, 'Demolish').then((ok) => {
          if (ok) { g.demolish(b); this.select(null); }
        });
        break;
      }
      case 'post': this.setMode('post'); break;
      case 'patrol': this.setMode('patrol'); break;
      case 'scavenge': {
        const n = this.selectedNode();
        if (n) {
          const err = g.sendScavenger(n);
          if (err) { this.toast(esc(err), 'bad'); this.sfx.play('error'); } else this.toast('🎒 A scavenger heads out. Keep them safe!', 'info');
        }
        break;
      }
      case 'drop': if (this.spendCaps(CAPS.supplyDrop)) g.supplyDrop(); break;
      case 'strike': if (this.profile.caps < CAPS.airstrike) this.spendCaps(CAPS.airstrike); else this.setMode('airstrike'); break;
      case 'merc': if (this.spendCaps(CAPS.mercenary)) g.hireMercenary(); break;
      case 'repairall': g.repairAll(); break;
      case 'speed':
        this.speed = this.speed === 1 ? 2 : 1;
        this.sfx.play('click');
        break;
      case 'shop': this.openShop(); break;
      case 'menu': this.openMenu(); break;
      case 'quest': break;
      // modal actions
      case 'close': this.closeModal(); break;
      case 'buy': void this.buy(v); break;
      case 'restore': void this.restore(); break;
      case 'continue': this.closeModals(); this.paused = false; this.started = true; this.profile.seenIntro = true; saveProfile(this.profile); break;
      case 'newgame':
        if (v === 'confirm') {
          void this.confirm('Start over?', 'Your current settlement will be abandoned. Caps and purchases are kept.', 'New game').then((ok) => ok && this.newRun());
        } else this.newRun();
        break;
      case 'howto': this.showHowTo(); break;
      case 'sound':
        this.profile.sound = !this.profile.sound;
        this.sfx.enabled = this.profile.sound;
        saveProfile(this.profile);
        this.openMenu(true);
        break;
      case 'haptics':
        this.profile.haptics = !this.profile.haptics;
        saveProfile(this.profile);
        this.openMenu(true);
        break;
      case 'revive':
        if (this.spendCaps(CAPS.revive)) { g.revive(); this.closeModals(); this.paused = false; }
        break;
      case 'confirm-yes': case 'confirm-no': break; // handled by confirm()
    }
    this.renderHud(true);
  }

  // ================================================================== toasts & modals
  toast(html: string, tone: 'info' | 'good' | 'bad' | 'warn' = 'info', _raw = false) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.innerHTML = html;
    box.prepend(el);
    while (box.children.length > 4) box.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), tone === 'warn' ? 5200 : 3200);
    setTimeout(() => el.remove(), tone === 'warn' ? 5800 : 3800);
  }

  private modal(id: string, html: string, cls = '') {
    const root = document.getElementById('modals')!;
    root.querySelector(`[data-id="${id}"]`)?.remove();
    const el = document.createElement('div');
    el.className = `modal ${cls}`;
    el.dataset.id = id;
    el.innerHTML = `<div class="sheet">${html}</div>`;
    root.appendChild(el);
    if (!this.modalStack.includes(id)) this.modalStack.push(id);
    this.paused = true;
  }

  closeModal() {
    const id = this.modalStack.pop();
    if (!id) return;
    document.querySelector(`#modals [data-id="${id}"]`)?.remove();
    if (!this.modalStack.length && !this.game.s.gameOver) this.paused = false;
  }

  closeModals() {
    document.getElementById('modals')!.innerHTML = '';
    this.modalStack = [];
  }

  confirm(title: string, bodyHtml: string, yes: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.modal('confirm', `<h2>${esc(title)}</h2><p>${bodyHtml}</p><div class="row"><button class="btn ghost" data-r="0">Cancel</button><button class="btn gold" data-r="1">${esc(yes)}</button></div>`, 'small');
      const el = document.querySelector<HTMLElement>('#modals [data-id="confirm"]')!;
      el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
        if (!b) return;
        e.stopPropagation();
        this.closeModal();
        resolve(b.dataset.r === '1');
      });
    });
  }

  showTitle(hasSave: boolean) {
    const best = this.profile.best;
    this.modal('title', `
      <div class="title">
        <div class="logo">LAST<span>HAVEN</span></div>
        <p class="tag">The world ended. Your story doesn't have to.</p>
        <div class="col">
          ${hasSave ? `<button class="btn gold big" data-a="continue">▶ Continue · Day ${this.game.s.day}</button>` : `<button class="btn gold big" data-a="${this.profile.seenIntro ? 'continue' : 'howto'}">▶ Play</button>`}
          ${hasSave ? '<button class="btn big" data-a="newgame" data-v="confirm">New Game</button>' : ''}
          <button class="btn big" data-a="shop">${CAP} Shop</button>
          <button class="btn ghost" data-a="howto">How to play</button>
        </div>
        ${best.days ? `<p class="best">Best: Day ${best.days} · ${best.kills} kills</p>` : ''}
      </div>`, 'title-modal');
  }

  showHowTo() {
    this.modal('howto', `
      <h2>How to survive</h2>
      <ul class="howto">
        <li><b>☀️ Day:</b> Put survivors to work in <b>👷 Jobs</b> — chop wood, strip wrecks for scrap, farm food.</li>
        <li><b>🏚 Scavenge:</b> Tap ruins (gold markers) and send a scavenger for big loot, new survivors and Caps.</li>
        <li><b>🧱 Fortify:</b> Drag to paint walls around your Haven. Zombies chew through the weakest spot.</li>
        <li><b>🗼 Defend:</b> Watchtowers shoot automatically. Train guards at the Barracks and set them to post or patrol.</li>
        <li><b>🌙 Night:</b> Survivors hide in the HQ. The horde comes from the direction shown by red arrows.</li>
        <li><b>🥫 Dawn:</b> Everyone eats. Keep food up and new survivors will find you.</li>
        <li><b>🏚 HQ:</b> If your HQ falls, the run is over.</li>
      </ul>
      <p class="muted">Pinch or scroll to zoom · drag to look around · tap to select.</p>
      <div class="row"><button class="btn gold big" data-a="continue">Let's go</button></div>`);
  }

  openMenu(refresh = false) {
    if (refresh) document.querySelector('#modals [data-id="menu"]')?.remove();
    const p = this.profile;
    this.modal('menu', `
      <h2>Paused</h2>
      <div class="col">
        <button class="btn gold big" data-a="close">Resume</button>
        <button class="btn" data-a="howto">How to play</button>
        <button class="btn" data-a="music">Music: ${p.music ? 'On' : 'Off'}</button>
        <button class="btn" data-a="sound">Sound effects: ${p.sound ? 'On' : 'Off'}</button>
        <button class="btn" data-a="haptics">Haptics: ${p.haptics ? 'On' : 'Off'}</button>
        <button class="btn" data-a="restore">Restore Purchases</button>
        <button class="btn ghost" data-a="newgame" data-v="confirm">New Game</button>
      </div>
      <p class="muted">Best: Day ${p.best.days} · ${p.best.kills} kills</p>`, 'small');
  }

  openShop() {
    this.modal('shop', this.shopHtml(), 'shop');
  }

  private refreshShop() {
    const el = document.querySelector('#modals [data-id="shop"] .sheet');
    if (el) el.innerHTML = this.shopHtml();
  }

  private shopHtml(): string {
    const owned = (id: string) => this.profile.owned.includes(id);
    return `
      <div class="shophead"><h2>Trading Post</h2><button class="x" data-a="close">✕</button></div>
      <p class="balance">${CAP} <b>${this.profile.caps}</b> Caps</p>
      ${this.store.native ? '' : '<p class="testbadge">TEST STORE — browser preview, no real charges</p>'}
      <div class="products">
        ${PRODUCTS.map((p) => `
          <div class="product ${owned(p.id) ? 'owned' : ''}">
            ${p.badge ? `<span class="badge">${p.badge}</span>` : ''}
            <span class="pic">${productArt(p.id)}</span>
            <div class="pinfo"><b>${esc(p.title)}</b><small>${esc(p.desc)}</small></div>
            ${owned(p.id) ? '<span class="ownedtag">Owned ✓</span>' : `<button class="btn gold" data-a="buy" data-v="${p.id}">${esc(this.store.price(p.id))}</button>`}
          </div>`).join('')}
      </div>
      <div class="spend">
        <h3>Spend Caps</h3>
        <p>📦 Supply Drop ${CAP}${CAPS.supplyDrop} · 💥 Airstrike ${CAP}${CAPS.airstrike} · 🎖️ Mercenary ${CAP}${CAPS.mercenary} · ⏩ Finish builds · ❤️ Revive ${CAP}${CAPS.revive}</p>
        <p>You also earn Caps by surviving nights, completing goals and scavenging ruins.</p>
      </div>
      <button class="link" data-a="restore">Restore Purchases</button>
      <p class="legal">Payment is charged to your Apple ID account at confirmation of purchase. Caps are a virtual item with no cash value.</p>`;
  }

  private async buy(id: string) {
    const btn = document.querySelector<HTMLButtonElement>(`#modals [data-a="buy"][data-v="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
      await this.store.buy(id);
    } catch (e) {
      this.toast(`⚠️ ${esc((e as Error).message)}`, 'bad');
    } finally {
      this.refreshShop();
    }
  }

  private async restore() {
    try {
      await this.store.restore();
      this.toast(this.store.native ? 'Purchases restored' : 'Test store: purchases are kept on this device', 'info');
    } catch (e) {
      this.toast(`⚠️ ${esc((e as Error).message)}`, 'bad');
    }
    this.refreshShop();
  }

  showVictory() {
    const s = this.game.s;
    this.sfx.play('dawn');
    this.modal('victory', `
      <div class="over win">
        <div class="convoy">${ico('shield', 'big')}</div>
        <h1>Rescue has arrived</h1>
        <p>Headlights on the horizon. After <b>${s.nightsSurvived}</b> nights and <b>${s.kills}</b> zombies, a military convoy reaches the Haven. Your people are going to make it.</p>
        <p class="best">+100 Caps reward</p>
        <div class="col">
          <button class="btn gold big" data-a="endless">Keep defending (endless mode)</button>
          <button class="btn big" data-a="newgame" data-v="confirm">Start a new settlement</button>
        </div>
      </div>`, 'small');
  }

  showGameOver() {
    const s = this.game.s;
    this.modal('gameover', `
      <div class="over">
        <h1>The Haven has fallen</h1>
        <p>You survived <b>${s.nightsSurvived}</b> night${s.nightsSurvived === 1 ? '' : 's'} and put down <b>${s.kills}</b> zombies.</p>
        <p class="muted">Best: Day ${this.profile.best.days} · ${this.profile.best.kills} kills</p>
        <div class="col">
          <button class="btn gold big" data-a="revive">❤️ Rebuild the Haven ${CAP}${CAPS.revive}</button>
          <button class="btn big" data-a="newgame">Start a new settlement</button>
        </div>
      </div>`, 'small');
  }
}

