import { BUILDINGS, DAY_LEN, DUSK_WARNING, MAP_H, MAP_W, NIGHT_LEN, TILE, TOWER_LEVELS, ZOMBIES, type BuildingKind, type ZombieKind } from './config';
import type { Game } from './game';
import type { Building, ResNode, Unit, Zombie } from './state';
import { HQ_CX, HQ_CY } from './world';

export interface Camera { x: number; y: number; zoom: number }

export interface Overlay {
  selected: { type: 'building' | 'unit' | 'node'; id: number } | null;
  ghost: { kind: BuildingKind; tx: number; ty: number } | null;
  patrolFrom: { x: number; y: number } | null;
  pointer: { x: number; y: number } | null; // world tiles
  airstrike: boolean;
  goldHq: boolean;
}

const T = TILE;
const GRASS = ['#3d4a2c', '#43512f', '#4a5734'];
const ZCOL: Record<ZombieKind, string> = {
  walker: '#6b8f4e', runner: '#93a85c', brute: '#5e4f6e', spitter: '#8aa33a', abomination: '#7a4a5e',
};

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function darkness(game: Game): number {
  const s = game.s.phaseTime;
  if (game.s.isNight) {
    const ramp = Math.min(1, s / 6, (NIGHT_LEN - s) / 8);
    return 0.45 + 0.3 * Math.max(0, ramp);
  }
  const toDusk = DAY_LEN - s;
  if (toDusk < DUSK_WARNING) return 0.45 * (1 - toDusk / DUSK_WARNING);
  return 0;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private ground: HTMLCanvasElement;
  private dark: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private dpr = 1;
  private groundSeed = -1;
  w = 0;
  h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ground = document.createElement('canvas');
    this.dark = document.createElement('canvas');
    this.dctx = this.dark.getContext('2d')!;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    // darkness layer at half resolution — it is soft anyway
    this.dark.width = Math.ceil(this.w / 2);
    this.dark.height = Math.ceil(this.h / 2);
  }

  private buildGround(game: Game) {
    const g = this.ground;
    g.width = MAP_W * T;
    g.height = MAP_H * T;
    const c = g.getContext('2d')!;
    let seed = game.s.seed;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) | 0) >>> 0) / 4294967296;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = game.s.terrain[y * MAP_W + x];
        const px = x * T, py = y * T;
        if (t <= 2) c.fillStyle = GRASS[t];
        else if (t === 3) c.fillStyle = '#5a4a35';
        else if (t === 4) c.fillStyle = '#34363a';
        else c.fillStyle = '#4b4741';
        c.fillRect(px, py, T, T);
        // speckle texture
        for (let i = 0; i < 6; i++) {
          c.fillStyle = t === 4 ? 'rgba(255,255,255,0.04)' : rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
          c.fillRect(px + rnd() * T, py + rnd() * T, 2 + rnd() * 3, 2 + rnd() * 3);
        }
        if (t <= 2 && rnd() < 0.18) {
          c.strokeStyle = 'rgba(140,160,90,0.35)';
          c.lineWidth = 1;
          const gx = px + rnd() * T, gy = py + rnd() * T;
          c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx - 2, gy - 5); c.moveTo(gx, gy); c.lineTo(gx + 2, gy - 5); c.stroke();
        }
        if (t === 5 && rnd() < 0.6) {
          c.fillStyle = 'rgba(120,115,105,0.8)';
          c.fillRect(px + rnd() * T, py + rnd() * T, 3 + rnd() * 5, 3 + rnd() * 4);
        }
      }
    }
    // road markings
    c.strokeStyle = 'rgba(220,200,120,0.35)';
    c.lineWidth = 2;
    c.setLineDash([10, 12]);
    const isRoad = (x: number, y: number) => game.s.terrain[y * MAP_W + x] === 4;
    for (let y = 0; y < MAP_H - 1; y++) {
      let n = 0;
      for (let x = 0; x < MAP_W; x++) if (isRoad(x, y) && isRoad(x, y + 1)) n++;
      if (n > MAP_W * 0.6) { c.beginPath(); c.moveTo(0, (y + 1) * T); c.lineTo(MAP_W * T, (y + 1) * T); c.stroke(); y++; }
    }
    for (let x = 0; x < MAP_W - 1; x++) {
      let n = 0;
      for (let y = 0; y < MAP_H; y++) if (isRoad(x, y) && isRoad(x + 1, y)) n++;
      if (n > MAP_H * 0.6) { c.beginPath(); c.moveTo((x + 1) * T, 0); c.lineTo((x + 1) * T, MAP_H * T); c.stroke(); x++; }
    }
    c.setLineDash([]);
    this.groundSeed = game.s.seed;
  }

  draw(game: Game, cam: Camera, ov: Overlay, now: number, shake: number) {
    if (this.groundSeed !== game.s.seed) this.buildGround(game);
    const ctx = this.ctx;
    const z = cam.zoom * this.dpr;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d0a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(z, 0, 0, z, (-cam.x + sx) * z, (-cam.y + sy) * z);

    const x0 = Math.max(0, Math.floor(cam.x / T) - 1);
    const y0 = Math.max(0, Math.floor(cam.y / T) - 1);
    const x1 = Math.min(MAP_W, Math.ceil((cam.x + this.w / cam.zoom) / T) + 1);
    const y1 = Math.min(MAP_H, Math.ceil((cam.y + this.h / cam.zoom) / T) + 1);
    const inView = (tx: number, ty: number, pad = 2) => tx >= x0 - pad && tx <= x1 + pad && ty >= y0 - pad && ty <= y1 + pad;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.ground, x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T, x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T);
    ctx.imageSmoothingEnabled = true;

    // blood stains under everything
    for (const f of game.s.fx) {
      if (f.kind !== 'blood' || !inView(f.x, f.y)) continue;
      const a = Math.min(1, (f.life - f.t) / 4) * 0.7;
      ctx.fillStyle = `rgba(90,10,12,${a})`;
      const r = f.y2 * T;
      ctx.beginPath();
      ctx.ellipse(f.x * T, f.y * T, r * 1.2, r * 0.8, f.x2 * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(f.x * T + r, f.y * T - r * 0.4, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // build ghost under objects so it reads as a footprint
    if (ov.ghost) this.drawGhost(game, ov.ghost);

    // y-sorted world objects
    type Drawable = { y: number; fn: () => void };
    const list: Drawable[] = [];
    for (const n of game.s.nodes) {
      if (!inView(n.tx, n.ty) || !game.isExplored(n.tx, n.ty)) continue;
      list.push({ y: n.ty + (n.kind === 'ruin' ? 2 : 1), fn: () => this.drawNode(n, now) });
    }
    for (const b of game.s.buildings) {
      if (!inView(b.tx, b.ty, 4)) continue;
      const flat = b.kind === 'farm' || b.kind === 'trap';
      list.push({ y: flat ? b.ty : b.ty + b.size, fn: () => this.drawBuilding(game, b, now, ov.goldHq) });
    }
    for (const u of game.s.units) {
      if (u.state === 'sheltered' || !inView(u.x, u.y)) continue;
      list.push({ y: u.y + 0.3, fn: () => this.drawUnit(u, now) });
    }
    for (const zb of game.s.zombies) {
      if (!inView(zb.x, zb.y) || !game.isExplored(Math.floor(zb.x), Math.floor(zb.y))) continue;
      list.push({ y: zb.y + 0.3, fn: () => this.drawZombie(zb) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.fn();

    // effects
    for (const f of game.s.fx) {
      const p = f.t / f.life;
      if (f.kind === 'tracer') {
        ctx.strokeStyle = `rgba(255,230,140,${1 - p})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(f.x * T, f.y * T); ctx.lineTo(f.x2 * T, f.y2 * T); ctx.stroke();
        ctx.fillStyle = `rgba(255,240,180,${1 - p})`;
        ctx.beginPath(); ctx.arc(f.x * T, f.y * T, 4, 0, Math.PI * 2); ctx.fill();
      } else if (f.kind === 'text') {
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(f.text!, f.x * T + 1, (f.y - p * 0.8) * T + 1);
        ctx.fillStyle = f.color ?? '#fff';
        ctx.globalAlpha = 1 - p;
        ctx.fillText(f.text!, f.x * T, (f.y - p * 0.8) * T);
        ctx.globalAlpha = 1;
      } else if (f.kind === 'boom' && f.t >= 0) {
        const r = (0.6 + p * 1.6) * T;
        const g = ctx.createRadialGradient(f.x * T, f.y * T, 0, f.x * T, f.y * T, r);
        g.addColorStop(0, `rgba(255,240,180,${1 - p})`);
        g.addColorStop(0.4, `rgba(255,140,40,${(1 - p) * 0.9})`);
        g.addColorStop(1, 'rgba(80,30,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(f.x * T, f.y * T, r, 0, Math.PI * 2); ctx.fill();
      } else if (f.kind === 'dust') {
        ctx.fillStyle = `rgba(160,150,130,${0.6 * (1 - p)})`;
        for (let i = 0; i < 5; i++) {
          const a = i * 1.3;
          ctx.beginPath();
          ctx.arc((f.x + Math.cos(a) * p * 0.8) * T, (f.y + Math.sin(a) * p * 0.8) * T, (0.2 + p * 0.3) * T, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (f.kind === 'corpse') {
        this.drawZombieBody(f.x, f.y, f.text as ZombieKind, f.x2, 0, p < 0.08, Math.max(0, 1 - p) * 0.999);
      } else if (f.kind === 'spark') {
        ctx.fillStyle = `rgba(255,${200 - p * 150},80,${1 - p})`;
        for (let i = 0; i < 4; i++) {
          const a = f.x2 + Math.PI + (i - 1.5) * 0.5;
          const d = (4 + p * 14) * (0.7 + (i % 2) * 0.5);
          ctx.fillRect(f.x * T + Math.cos(a) * d - 1, f.y * T + Math.sin(a) * d - 1, 2.5, 2.5);
        }
        ctx.fillStyle = `rgba(110,10,14,${0.8 * (1 - p)})`;
        for (let i = 0; i < 3; i++) {
          const a = f.x2 + (i - 1) * 0.6;
          ctx.beginPath(); ctx.arc(f.x * T + Math.cos(a) * p * 16, f.y * T + Math.sin(a) * p * 16, 2.2, 0, Math.PI * 2); ctx.fill();
        }
      } else if (f.kind === 'acid') {
        const px = (f.x + (f.x2 - f.x) * p) * T, py = (f.y + (f.y2 - f.y) * p) * T - Math.sin(p * Math.PI) * 18;
        ctx.fillStyle = '#c8e04a';
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(200,224,74,0.35)';
        ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
        if (p > 0.85) {
          ctx.fillStyle = `rgba(170,210,40,${(1 - p) * 4})`;
          ctx.beginPath(); ctx.arc(f.x2 * T, f.y2 * T, 10, 0, Math.PI * 2); ctx.fill();
        }
      } else if (f.kind === 'pop') {
        ctx.strokeStyle = `rgba(242,201,76,${1 - p})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.x * T, f.y * T, (f.x2 * 0.6 + p * 1.2) * T, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(255,240,180,${1 - p})`;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const d = (f.x2 * 0.5 + p * 1.4) * T;
          ctx.fillRect(f.x * T + Math.cos(a) * d - 2, f.y * T + Math.sin(a) * d - 2 - p * 10, 4, 4);
        }
      } else if (f.kind === 'drop') {
        const fall = Math.max(0, 1 - p * 2);
        const x = f.x * T, y = (f.y - fall * 6) * T;
        if (fall > 0) {
          ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x - 8, y - 6); ctx.lineTo(x - 14, y - 26); ctx.moveTo(x + 8, y - 6); ctx.lineTo(x + 14, y - 26); ctx.stroke();
          ctx.fillStyle = '#e8e2d0';
          ctx.beginPath(); ctx.ellipse(x, y - 28, 18, 8, 0, Math.PI, 0); ctx.fill();
        }
        ctx.fillStyle = '#8a6a3a'; ctx.fillRect(x - 9, y - 8, 18, 16);
        ctx.strokeStyle = '#5a4020'; ctx.lineWidth = 2; ctx.strokeRect(x - 9, y - 8, 18, 16);
      }
    }

    // fog of war
    ctx.fillStyle = '#080a08';
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!game.s.explored[y * MAP_W + x]) ctx.fillRect(x * T - 0.5, y * T - 0.5, T + 1, T + 1);
      }
    }
    // soften fog edge
    ctx.fillStyle = 'rgba(8,10,8,0.45)';
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!game.s.explored[y * MAP_W + x]) continue;
        const e = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < MAP_W && yy < MAP_H && !game.s.explored[yy * MAP_W + xx];
        if (e(x - 1, y) || e(x + 1, y) || e(x, y - 1) || e(x, y + 1)) ctx.fillRect(x * T, y * T, T, T);
      }
    }

    // night lighting
    const dk = darkness(game);
    if (dk > 0.01) this.drawDarkness(game, cam, dk, now);

    // overlays that should stay readable at night
    ctx.setTransform(z, 0, 0, z, (-cam.x + sx) * z, (-cam.y + sy) * z);
    if (dk > 0.15) this.drawEyes(game, dk, inView);
    this.drawSelection(game, ov, now);
    if (ov.patrolFrom && ov.pointer) {
      ctx.strokeStyle = 'rgba(120,220,255,0.9)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ov.patrolFrom.x * T, ov.patrolFrom.y * T); ctx.lineTo(ov.pointer.x * T, ov.pointer.y * T); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (ov.airstrike && ov.pointer) {
      ctx.strokeStyle = 'rgba(255,80,60,0.95)';
      ctx.lineWidth = 3;
      const r = 3.2 * T;
      ctx.beginPath(); ctx.arc(ov.pointer.x * T, ov.pointer.y * T, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ov.pointer.x * T - r - 8, ov.pointer.y * T); ctx.lineTo(ov.pointer.x * T + r + 8, ov.pointer.y * T);
      ctx.moveTo(ov.pointer.x * T, ov.pointer.y * T - r - 8); ctx.lineTo(ov.pointer.x * T, ov.pointer.y * T + r + 8);
      ctx.stroke();
    }

    // screen-space: horde direction warnings
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (game.s.edges.length) this.drawEdgeWarnings(game.s.edges, now);
  }

  private drawDarkness(game: Game, cam: Camera, dk: number, now: number) {
    const d = this.dctx;
    const W = this.dark.width, H = this.dark.height;
    const k = (cam.zoom * T) / 2; // tile -> half-res screen px
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    d.fillStyle = `rgba(6,10,26,${dk})`;
    d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = 'destination-out';
    const light = (x: number, y: number, r: number, strength = 1) => {
      const px = ((x * T - cam.x) * cam.zoom) / 2;
      const py = ((y * T - cam.y) * cam.zoom) / 2;
      const rr = r * k;
      if (px < -rr || py < -rr || px > W + rr || py > H + rr) return;
      const g = d.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.6})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.beginPath(); d.arc(px, py, rr, 0, Math.PI * 2); d.fill();
    };
    const flicker = 1 + Math.sin(now * 9) * 0.03 + Math.sin(now * 23) * 0.02;
    for (const b of game.s.buildings) {
      const l = BUILDINGS[b.kind].light;
      if (l > 0 && b.built >= 1) light(b.tx + b.size / 2, b.ty + b.size / 2, l * flicker);
    }
    for (const u of game.s.units) {
      if (u.state === 'sheltered') continue;
      light(u.x, u.y, u.kind === 'worker' ? 1.6 : 2.6, 0.9);
    }
    for (const f of game.s.fx) {
      if (f.kind === 'tracer') light(f.x, f.y, 1.4, 0.7 * (1 - f.t / f.life));
      if (f.kind === 'boom' && f.t >= 0) light(f.x, f.y, 5, 1 - f.t / f.life);
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.dark, 0, 0, this.canvas.width, this.canvas.height);
    // warm glow around the HQ fire
    const hx = (HQ_CX * T - cam.x) * cam.zoom * this.dpr;
    const hy = (HQ_CY * T - cam.y) * cam.zoom * this.dpr;
    const gr = 5 * T * cam.zoom * this.dpr;
    const g = this.ctx.createRadialGradient(hx, hy, 0, hx, hy, gr);
    g.addColorStop(0, `rgba(255,150,60,${0.14 * dk})`);
    g.addColorStop(1, 'rgba(255,150,60,0)');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(hx - gr, hy - gr, gr * 2, gr * 2);
  }

  /** Glowing eyes stay visible through the darkness so the horde is readable at night. */
  private drawEyes(game: Game, dk: number, inView: (x: number, y: number) => boolean) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = `rgba(255,225,90,${Math.min(1, dk * 1.4)})`;
    ctx.shadowColor = 'rgba(255,200,60,0.9)';
    ctx.shadowBlur = 6;
    for (const zb of game.s.zombies) {
      if (!inView(zb.x, zb.y) || !game.isExplored(Math.floor(zb.x), Math.floor(zb.y))) continue;
      const r = ZOMBIES[zb.kind].radius * T * 0.85;
      const ex = zb.x * T + Math.cos(zb.dir) * r * 0.5, ey = zb.y * T + Math.sin(zb.dir) * r * 0.5 - 2;
      const px = -Math.sin(zb.dir) * 2.6, py = Math.cos(zb.dir) * 2.6;
      const sz = zb.kind === 'abomination' ? 4 : zb.kind === 'brute' ? 3 : 2.2;
      ctx.beginPath(); ctx.arc(ex + px, ey + py, sz, 0, Math.PI * 2); ctx.arc(ex - px, ey - py, sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  private drawEdgeWarnings(edges: number[], now: number) {
    const ctx = this.ctx;
    const a = 0.5 + Math.sin(now * 5) * 0.35;
    ctx.fillStyle = `rgba(230,40,30,${a})`;
    const w = this.w, h = this.h;
    for (const e of edges) {
      for (let i = -1; i <= 1; i++) {
        ctx.save();
        if (e === 0) { ctx.translate(w / 2 + i * 26, 64); }
        else if (e === 2) { ctx.translate(w / 2 + i * 26, h - 96); ctx.rotate(Math.PI); }
        else if (e === 1) { ctx.translate(w - 22, h / 2 + i * 26); ctx.rotate(Math.PI / 2); }
        else { ctx.translate(22, h / 2 + i * 26); ctx.rotate(-Math.PI / 2); }
        ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(10, 6); ctx.lineTo(-10, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  private drawGhost(game: Game, g: { kind: BuildingKind; tx: number; ty: number }) {
    const ctx = this.ctx;
    const size = BUILDINGS[g.kind].size;
    const ok = game.canPlace(g.kind, g.tx, g.ty);
    ctx.fillStyle = ok ? 'rgba(120,255,140,0.35)' : 'rgba(255,80,80,0.35)';
    ctx.strokeStyle = ok ? 'rgba(160,255,170,0.9)' : 'rgba(255,120,120,0.9)';
    ctx.lineWidth = 2;
    ctx.fillRect(g.tx * T, g.ty * T, size * T, size * T);
    ctx.strokeRect(g.tx * T + 1, g.ty * T + 1, size * T - 2, size * T - 2);
    if (g.kind === 'tower') {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc((g.tx + 0.5) * T, (g.ty + 0.5) * T, 6.5 * T, 0, Math.PI * 2); ctx.stroke();
    }
  }

  private drawSelection(game: Game, ov: Overlay, now: number) {
    if (!ov.selected) return;
    const ctx = this.ctx;
    const pulse = 0.7 + Math.sin(now * 6) * 0.3;
    ctx.strokeStyle = `rgba(255,220,90,${pulse})`;
    ctx.lineWidth = 2.5;
    const sel = ov.selected;
    if (sel.type === 'building') {
      const b = game.byId.get(sel.id);
      if (!b) return;
      ctx.strokeRect(b.tx * T - 2, b.ty * T - 2, b.size * T + 4, b.size * T + 4);
      if (b.kind === 'tower') {
        ctx.strokeStyle = 'rgba(255,220,90,0.25)';
        ctx.beginPath(); ctx.arc((b.tx + 0.5) * T, (b.ty + 0.5) * T, 6.5 * T, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (sel.type === 'unit') {
      const u = game.s.units.find((x) => x.id === sel.id);
      if (!u) return;
      ctx.beginPath(); ctx.ellipse(u.x * T, (u.y + 0.2) * T, 0.5 * T, 0.28 * T, 0, 0, Math.PI * 2); ctx.stroke();
      if (u.kind !== 'worker') {
        ctx.strokeStyle = 'rgba(255,220,90,0.22)';
        ctx.beginPath(); ctx.arc(u.x * T, u.y * T, (u.kind === 'merc' ? 6 : 5) * T, 0, Math.PI * 2); ctx.stroke();
        if (u.patrol) {
          ctx.strokeStyle = 'rgba(120,220,255,0.7)';
          ctx.setLineDash([6, 6]);
          ctx.beginPath(); ctx.moveTo(u.patrol.ax * T, u.patrol.ay * T); ctx.lineTo(u.patrol.bx * T, u.patrol.by * T); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    } else {
      const n = game.nodeById.get(sel.id);
      if (!n) return;
      const size = n.kind === 'ruin' ? 2 : 1;
      ctx.strokeRect(n.tx * T - 2, n.ty * T - 2, size * T + 4, size * T + 4);
    }
  }

  private levelPips(cx: number, y: number, level: number) {
    if (level < 2) return;
    const ctx = this.ctx;
    for (let i = 0; i < level; i++) {
      const x = cx + (i - (level - 1) / 2) * 7;
      ctx.fillStyle = '#141510';
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 3.5, y + 1); ctx.lineTo(x - 3.5, y + 1); ctx.fill();
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath(); ctx.moveTo(x, y - 2.5); ctx.lineTo(x + 2.2, y + 0.5); ctx.lineTo(x - 2.2, y + 0.5); ctx.fill();
    }
  }

  private hpBar(x: number, y: number, w: number, frac: number) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = frac > 0.5 ? '#6fd36b' : frac > 0.25 ? '#e8c140' : '#e5483a';
    ctx.fillRect(x, y, w * Math.max(0, frac), 4);
  }

  private drawNode(n: ResNode, now: number) {
    const ctx = this.ctx;
    const x = n.tx * T, y = n.ty * T;
    if (n.kind === 'tree') {
      const greens = ['#2d4a24', '#325227', '#284020', '#37572a'];
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(x + T * 0.55, y + T * 0.85, T * 0.42, T * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3420';
      ctx.fillRect(x + T * 0.44, y + T * 0.5, T * 0.12, T * 0.35);
      const sway = Math.sin(now * 1.3 + n.tx) * 1;
      const g = greens[n.variant];
      const sc = 0.75 + 0.25 * (n.amount / n.max);
      ctx.fillStyle = shade(g, -8);
      ctx.beginPath(); ctx.arc(x + T * 0.5 + sway, y + T * 0.42, T * 0.4 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + T * 0.42 + sway, y + T * 0.34, T * 0.28 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(g, 18);
      ctx.beginPath(); ctx.arc(x + T * 0.36 + sway, y + T * 0.28, T * 0.12 * sc, 0, Math.PI * 2); ctx.fill();
    } else if (n.kind === 'wreck') {
      const cols = ['#7a3b24', '#5c5f63', '#6b5530', '#3e4f5c'];
      ctx.save();
      ctx.translate(x + T / 2, y + T / 2);
      ctx.rotate((n.variant - 1.5) * 0.35);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-T * 0.42, -T * 0.2, T * 0.9, T * 0.5);
      ctx.fillStyle = cols[n.variant];
      ctx.fillRect(-T * 0.45, -T * 0.25, T * 0.9, T * 0.48);
      ctx.fillStyle = 'rgba(20,25,30,0.85)';
      ctx.fillRect(-T * 0.18, -T * 0.2, T * 0.38, T * 0.38);
      ctx.fillStyle = 'rgba(160,80,30,0.6)';
      ctx.fillRect(-T * 0.42, -T * 0.22, T * 0.12, T * 0.1);
      ctx.fillRect(T * 0.2, T * 0.06, T * 0.16, T * 0.12);
      ctx.restore();
    } else {
      const looted = n.amount <= 0;
      ctx.fillStyle = looted ? '#3a3835' : '#57534c';
      ctx.fillRect(x + 2, y + 2, T * 2 - 4, T * 2 - 4);
      ctx.strokeStyle = looted ? '#2a2826' : '#7a756b';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + T * 1.3); ctx.lineTo(x + 4, y + 4); ctx.lineTo(x + T * 1.2, y + 4);
      ctx.moveTo(x + T * 1.6, y + 4); ctx.lineTo(x + T * 2 - 4, y + 4); ctx.lineTo(x + T * 2 - 4, y + T * 0.9);
      ctx.moveTo(x + T * 2 - 4, y + T * 1.5); ctx.lineTo(x + T * 2 - 4, y + T * 2 - 4); ctx.lineTo(x + T * 0.8, y + T * 2 - 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(30,28,26,0.7)';
      ctx.fillRect(x + T * 0.5, y + T * 0.6, T * 0.5, T * 0.4);
      ctx.fillRect(x + T * 1.1, y + T * 1.1, T * 0.4, T * 0.5);
      if (!looted) {
        const bob = Math.sin(now * 3 + n.tx) * 3;
        ctx.fillStyle = '#f2c94c';
        ctx.beginPath();
        ctx.arc(x + T, y - 6 + bob, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2b2312';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n.amount), x + T, y - 5 + bob);
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  private drawBuilding(game: Game, b: Building, now: number, goldHq: boolean) {
    const ctx = this.ctx;
    const x = b.tx * T, y = b.ty * T, S = b.size * T;
    const building = b.built < 1;
    if (building) ctx.globalAlpha = 0.55;

    switch (b.kind) {
      case 'hq': {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x + 6, y + 8, S, S);
        ctx.fillStyle = goldHq ? '#8a7032' : '#4e5246';
        ctx.fillRect(x + 4, y + 4, S - 8, S - 8);
        ctx.fillStyle = goldHq ? '#b8943e' : '#62675a';
        ctx.fillRect(x + 12, y + 12, S - 24, S - 24);
        // sandbags
        ctx.fillStyle = '#9c8a62';
        for (let i = 0; i < 8; i++) {
          const t = (i + 0.5) / 8;
          for (const [bx, by] of [[x + 4 + t * (S - 8), y + 4], [x + 4 + t * (S - 8), y + S - 4], [x + 4, y + 4 + t * (S - 8)], [x + S - 4, y + 4 + t * (S - 8)]]) {
            ctx.beginPath(); ctx.ellipse(bx, by, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
        // hatch + campfire
        ctx.fillStyle = '#2a2c27';
        ctx.fillRect(x + S / 2 - 10, y + S / 2 - 10, 20, 20);
        const fl = Math.sin(now * 12) * 2;
        ctx.fillStyle = '#ff9a3a';
        ctx.beginPath(); ctx.arc(x + S / 2, y + S / 2, 6 + fl * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath(); ctx.arc(x + S / 2, y + S / 2 - 1, 3, 0, Math.PI * 2); ctx.fill();
        // flag
        ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + S - 16, y + 16); ctx.lineTo(x + S - 16, y - 18); ctx.stroke();
        ctx.fillStyle = goldHq ? '#f2c94c' : '#c0392b';
        const wv = Math.sin(now * 4) * 3;
        ctx.beginPath(); ctx.moveTo(x + S - 16, y - 18); ctx.lineTo(x + S + 6, y - 13 + wv); ctx.lineTo(x + S - 16, y - 6); ctx.fill();
        if (b.level >= 2) {
          // corner sniper posts
          for (const [px2, py2] of b.level >= 3 ? [[x + 10, y + 10], [x + S - 10, y + S - 10], [x + 10, y + S - 10]] : [[x + 10, y + 10]]) {
            ctx.fillStyle = '#5a4630';
            ctx.fillRect(px2 - 8, py2 - 8, 16, 16);
            ctx.strokeStyle = '#2a1d12'; ctx.lineWidth = 2; ctx.strokeRect(px2 - 8, py2 - 8, 16, 16);
          }
          ctx.strokeStyle = '#222'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + 10 + Math.cos(b.aim) * 16, y + 10 + Math.sin(b.aim) * 16); ctx.stroke();
          ctx.fillStyle = '#4b6b3a';
          ctx.beginPath(); ctx.arc(x + 10, y + 10, 4.5, 0, Math.PI * 2); ctx.fill();
        }
        if (b.level >= 3) {
          ctx.strokeStyle = '#7d848a'; ctx.lineWidth = 4;
          ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
        }
        this.levelPips(x + S / 2, y + S + 3, b.level);
        break;
      }
      case 'house': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + 6, y + 8, S - 6, S - 6);
        ctx.fillStyle = '#7a5a3a';
        ctx.fillRect(x + 3, y + 3, S - 6, S - 6);
        ctx.fillStyle = '#8f3f2e';
        ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + S - 3, y + 3); ctx.lineTo(x + S / 2, y + S / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7a3526';
        ctx.beginPath(); ctx.moveTo(x + 3, y + S - 3); ctx.lineTo(x + S - 3, y + S - 3); ctx.lineTo(x + S / 2, y + S / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#a24a36';
        ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + S / 2, y + S / 2); ctx.lineTo(x + 3, y + S - 3); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + S - 3, y + 3); ctx.lineTo(x + S / 2, y + S / 2); ctx.lineTo(x + S - 3, y + S - 3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#555';
        ctx.fillRect(x + S - 18, y + 8, 7, 9);
        // boarded planks
        ctx.strokeStyle = '#5a4128'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + 10, y + S - 14); ctx.lineTo(x + 26, y + S - 8); ctx.stroke();
        if (b.level >= 2) { ctx.fillStyle = '#555'; ctx.fillRect(x + 10, y + 8, 7, 9); }
        this.levelPips(x + S / 2, y + S + 2, b.level);
        break;
      }
      case 'farm': {
        ctx.fillStyle = '#5a4128';
        ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
        for (let i = 0; i < 5; i++) {
          const ry = y + 7 + i * ((S - 12) / 5);
          ctx.fillStyle = '#3f2e1c';
          ctx.fillRect(x + 5, ry, S - 10, 3);
          ctx.fillStyle = '#7fb24a';
          for (let j = 0; j < 7; j++) {
            const h = 3 + Math.sin(now * 2 + j + i) * 0.6;
            ctx.beginPath(); ctx.arc(x + 9 + j * ((S - 18) / 6), ry + 1, h, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, S - 4, S - 4);
        if (b.level >= 2) {
          ctx.strokeStyle = '#4aa3d8'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(x + 4, y + S - 5); ctx.lineTo(x + S - 4, y + S - 5); ctx.stroke();
        }
        this.levelPips(x + S / 2, y + S + 2, b.level);
        break;
      }
      case 'wall':
      case 'steelwall': {
        const steel = b.kind === 'steelwall';
        const conn = (dx: number, dy: number) => {
          const o = game.buildingAt(b.tx + dx, b.ty + dy);
          return !!o && (o.kind === 'wall' || o.kind === 'steelwall');
        };
        const m = 7;
        const main = steel ? '#7d848a' : '#7a5530';
        const dark = steel ? '#555b60' : '#553a20';
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + m + 3, y + m + 5, T - 2 * m, T - 2 * m);
        ctx.fillStyle = main;
        ctx.fillRect(x + m, y + m, T - 2 * m, T - 2 * m);
        if (conn(-1, 0)) ctx.fillRect(x, y + m, m, T - 2 * m);
        if (conn(1, 0)) ctx.fillRect(x + T - m, y + m, m, T - 2 * m);
        if (conn(0, -1)) ctx.fillRect(x + m, y, T - 2 * m, m);
        if (conn(0, 1)) ctx.fillRect(x + m, y + T - m, T - 2 * m, m);
        ctx.fillStyle = dark;
        if (steel) {
          ctx.fillRect(x + m + 2, y + m + 2, 3, 3);
          ctx.fillRect(x + T - m - 5, y + T - m - 5, 3, 3);
          ctx.fillRect(x + T - m - 5, y + m + 2, 3, 3);
          ctx.fillRect(x + m + 2, y + T - m - 5, 3, 3);
        } else {
          for (let i = 0; i < 3; i++) ctx.fillRect(x + m + 2 + i * 6, y + m, 2, T - 2 * m);
          ctx.fillStyle = '#9a7040';
          ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, 3, 0, Math.PI * 2); ctx.fill();
        }
        if (b.built >= 1 && b.hp < b.maxHp * 0.6) {
          // visible damage so players can spot weak points
          ctx.strokeStyle = 'rgba(20,12,6,0.85)'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x + m + 2, y + m + 3); ctx.lineTo(x + T / 2, y + T / 2); ctx.lineTo(x + T / 2 - 2, y + T - m - 2);
          if (b.hp < b.maxHp * 0.3) { ctx.moveTo(x + T / 2, y + T / 2); ctx.lineTo(x + T - m - 2, y + m + 4); }
          ctx.stroke();
        }
        break;
      }
      case 'tower': {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(x + T * 0.65, y + T * 0.85, T * 0.5, T * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#4a3420'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + T - 2); ctx.lineTo(x + T * 0.35, y + T * 0.4);
        ctx.moveTo(x + T - 4, y + T - 2); ctx.lineTo(x + T * 0.65, y + T * 0.4);
        ctx.stroke();
        ctx.fillStyle = b.level >= 3 ? '#4f5458' : '#6b4a2a';
        ctx.fillRect(x + 2, y - 6, T - 4, T - 6);
        ctx.fillStyle = b.level >= 3 ? '#6c7277' : '#86603a';
        ctx.fillRect(x + 5, y - 3, T - 10, T - 12);
        if (b.level >= 2) {
          // sandbag rim
          ctx.fillStyle = '#9c8a62';
          for (const [sx2, sy2] of [[x + 4, y - 5], [x + T - 4, y - 5], [x + 4, y + T - 14], [x + T - 4, y + T - 14], [x + T / 2, y - 6]]) {
            ctx.beginPath(); ctx.ellipse(sx2, sy2, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
        const cx = x + T / 2, cy = y + T / 2 - 9;
        ctx.strokeStyle = '#222'; ctx.lineWidth = b.level >= 3 ? 2.5 : 3;
        const len = 16 + b.level * 2;
        ctx.beginPath();
        if (b.level >= 3) {
          const ox = -Math.sin(b.aim) * 2.2, oy = Math.cos(b.aim) * 2.2;
          ctx.moveTo(cx + ox, cy + oy); ctx.lineTo(cx + ox + Math.cos(b.aim) * len, cy + oy + Math.sin(b.aim) * len);
          ctx.moveTo(cx - ox, cy - oy); ctx.lineTo(cx - ox + Math.cos(b.aim) * len, cy - oy + Math.sin(b.aim) * len);
        } else {
          ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(b.aim) * len, cy + Math.sin(b.aim) * len);
        }
        ctx.stroke();
        if (b.cd > TOWER_LEVELS[b.level - 1].cooldown - 0.06) {
          // muzzle flash
          ctx.fillStyle = 'rgba(255,220,120,0.95)';
          ctx.beginPath(); ctx.arc(cx + Math.cos(b.aim) * (len + 3), cy + Math.sin(b.aim) * (len + 3), 4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = b.level >= 3 ? '#8a2a22' : '#3c5a35';
        ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
        this.levelPips(x + T / 2, y + T + 2, b.level);
        break;
      }
      case 'barracks': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + 6, y + 8, S - 6, S - 6);
        ctx.fillStyle = '#4f5a34';
        ctx.fillRect(x + 3, y + 3, S - 6, S - 6);
        ctx.fillStyle = '#5f6b3e';
        ctx.fillRect(x + 3, y + 3, (S - 6) / 2, S - 6);
        ctx.strokeStyle = '#3a4226'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + S / 2, y + 3); ctx.lineTo(x + S / 2, y + S - 3); ctx.stroke();
        ctx.fillStyle = '#e8d36b';
        const cx = x + S / 2, cy = y + S / 2;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 4 : 9;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.fill();
        if (b.trainQueue > 0 && b.built >= 1) {
          ctx.globalAlpha = 1;
          this.hpBar(x + 4, y + S - 10, S - 8, 1 - b.trainTimer / 8);
        }
        break;
      }
      case 'trap': {
        ctx.fillStyle = 'rgba(40,36,30,0.6)';
        ctx.fillRect(x + 3, y + 3, T - 6, T - 6);
        ctx.fillStyle = '#b0b4b8';
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
          const px = x + 7 + i * 9, py = y + 9 + j * 8;
          ctx.beginPath(); ctx.moveTo(px - 3, py + 3); ctx.lineTo(px, py - 4); ctx.lineTo(px + 3, py + 3); ctx.fill();
        }
        break;
      }
    }
    ctx.globalAlpha = 1;
    if (building) {
      ctx.strokeStyle = 'rgba(240,200,90,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x + 2, y + 2, S - 4, S - 4);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 3, y + S / 2 - 3, S - 6, 6);
      ctx.fillStyle = '#f0c85a';
      ctx.fillRect(x + 4, y + S / 2 - 2, (S - 8) * b.built, 4);
    } else if (b.hp < b.maxHp) {
      this.hpBar(x + 3, y - 8, S - 6, b.hp / b.maxHp);
    }
  }

  private drawUnit(u: Unit, now: number) {
    const ctx = this.ctx;
    const x = u.x * T, y = u.y * T;
    const moving = u.state === 'toNode' || u.state === 'return' || u.state === 'shelter' || u.state === 'expedition' || u.state === 'home' || u.state === 'toFarm';
    const bob = moving ? Math.abs(Math.sin(now * 12 + u.id)) * 2 : u.state === 'gather' || u.state === 'farming' || u.state === 'searching' ? Math.abs(Math.sin(now * 6 + u.id)) * 2 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + 7, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    const body = u.kind === 'worker' ? '#3f6ea8' : u.kind === 'guard' ? '#4b6b3a' : '#2a2a2a';
    const r = u.kind === 'merc' ? 9 : 8;
    ctx.fillStyle = u.hurt > 0 ? '#ff6b5a' : body;
    ctx.beginPath(); ctx.arc(x, y - bob, r, 0, Math.PI * 2); ctx.fill();
    // weapon
    if (u.kind !== 'worker') {
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y - bob); ctx.lineTo(x + Math.cos(u.aim) * 15, y - bob + Math.sin(u.aim) * 15); ctx.stroke();
    }
    // head
    ctx.fillStyle = '#e0b48a';
    ctx.beginPath(); ctx.arc(x, y - bob - 3, 4.5, 0, Math.PI * 2); ctx.fill();
    if (u.kind === 'guard') { ctx.fillStyle = '#3a5229'; ctx.beginPath(); ctx.arc(x, y - bob - 4.5, 5, Math.PI, 0); ctx.fill(); }
    if (u.kind === 'merc') { ctx.fillStyle = '#b02a2a'; ctx.beginPath(); ctx.ellipse(x - 1, y - bob - 6, 5.5, 3, -0.3, 0, Math.PI * 2); ctx.fill(); }
    if (u.kind === 'worker' && u.job !== 'idle') {
      ctx.fillStyle = u.job === 'wood' ? '#c98b4a' : u.job === 'scrap' ? '#9aa4ad' : '#8fc35a';
      ctx.beginPath(); ctx.arc(x, y - bob - 5.5, 3.2, Math.PI, 0); ctx.fill();
    }
    // carried goods
    if (u.carry > 0 || u.loot) {
      ctx.fillStyle = u.loot ? '#c9a54a' : u.carryRes === 'wood' ? '#8a5a2a' : '#8d959c';
      ctx.fillRect(x + 4, y - bob - 2, 8, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 4, y - bob - 2, 8, 6);
    }
    if (u.state === 'searching') {
      ctx.fillStyle = '#f2c94c';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('🔍', x, y - 16 - bob);
    }
    if (u.hp < u.maxHp) this.hpBar(x - 10, y - 20 - bob, 20, u.hp / u.maxHp);
  }

  private drawZombie(z: Zombie) {
    this.drawZombieBody(z.x, z.y, z.kind, z.dir, z.wobble, z.flash > 0, 1);
    const r = ZOMBIES[z.kind].radius * T * 0.85;
    if (z.hp < z.maxHp) this.hpBar(z.x * T - r, z.y * T - r - 9, r * 2, z.hp / z.maxHp);
  }

  /** Shared by live zombies and dying corpses. `fall` goes 1 → 0 as a corpse collapses. */
  private drawZombieBody(zx: number, zy: number, kind: ZombieKind, ad: number, wobble: number, flash: boolean, fall: number) {
    const ctx = this.ctx;
    const def = ZOMBIES[kind];
    const x = zx * T, y = zy * T;
    const r = def.radius * T * 0.85;
    const col = ZCOL[kind];
    const sway = Math.sin(wobble) * 0.25;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.8, r * 1.05, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    if (fall < 1) {
      // collapsing corpse: squash flat and sink into the ground
      ctx.save();
      ctx.globalAlpha = Math.min(1, fall * 1.6);
      ctx.translate(x, y + (1 - fall) * r * 0.5);
      ctx.rotate(ad + Math.PI / 2 * (1 - fall));
      ctx.scale(1, 0.35 + 0.65 * fall);
      ctx.fillStyle = shade(col, -20);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(col, -45);
      ctx.beginPath(); ctx.arc(r * 0.4, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    // shuffling legs
    const step = Math.sin(wobble * 1.6) * r * 0.45;
    const fx = Math.cos(ad), fy = Math.sin(ad), sx = -fy, sy = fx;
    ctx.fillStyle = shade(col, -50);
    for (const side of [-1, 1]) {
      const o = step * side;
      ctx.beginPath();
      ctx.ellipse(x + sx * side * r * 0.45 + fx * o, y + sy * side * r * 0.45 + fy * o + r * 0.35, r * 0.3, r * 0.22, ad, 0, Math.PI * 2);
      ctx.fill();
    }
    // arms reaching forward
    ctx.strokeStyle = shade(col, -25);
    ctx.lineCap = 'round';
    ctx.lineWidth = kind === 'abomination' ? 8 : kind === 'brute' ? 5 : 3;
    const arms = kind === 'abomination' ? [-1, -0.45, 0.45, 1] : [-1, 1];
    for (const side of arms) {
      const bx = x + Math.cos(ad + side * 1.2) * r * 0.8;
      const by = y + Math.sin(ad + side * 1.2) * r * 0.8;
      const reach = r * (kind === 'spitter' ? 0.8 : 1.25);
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(ad + side * sway) * reach, by + Math.sin(ad + side * sway) * reach);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = flash ? '#ffffff' : col;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (kind === 'spitter' && !flash) {
      // bloated acid sacs
      ctx.fillStyle = '#c8e04a';
      ctx.beginPath(); ctx.arc(x - fx * r * 0.45 + sx * r * 0.3, y - fy * r * 0.45 + sy * r * 0.3, r * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x - fx * r * 0.35 - sx * r * 0.4, y - fy * r * 0.35 - sy * r * 0.4, r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    if (kind === 'abomination' && !flash) {
      // bone spikes along the back
      ctx.fillStyle = '#d8ccb4';
      for (let i = -2; i <= 2; i++) {
        const a = ad + Math.PI + i * 0.45;
        const bx = x + Math.cos(a) * r * 0.85, by = y + Math.sin(a) * r * 0.85;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a + 1.6) * 4, by + Math.sin(a + 1.6) * 4);
        ctx.lineTo(bx + Math.cos(a) * 11, by + Math.sin(a) * 11);
        ctx.lineTo(bx + Math.cos(a - 1.6) * 4, by + Math.sin(a - 1.6) * 4);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(120,20,30,0.7)';
      ctx.beginPath(); ctx.arc(x - fx * r * 0.2 + sx * r * 0.35, y - fy * r * 0.2 + sy * r * 0.35, r * 0.25, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = flash ? '#fff' : shade(col, -30);
    ctx.beginPath(); ctx.arc(x + fx * r * 0.25, y + fy * r * 0.25 - 2, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = kind === 'abomination' ? '#ff5a3a' : '#ffdf5a';
    const ex = x + fx * r * 0.5, ey = y + fy * r * 0.5 - 2;
    const e = kind === 'abomination' ? 4 : 2.2;
    ctx.fillRect(ex + sx * e - 1, ey + sy * e - 1, 2.4, 2.4);
    ctx.fillRect(ex - sx * e - 1, ey - sy * e - 1, 2.4, 2.4);
  }

}
