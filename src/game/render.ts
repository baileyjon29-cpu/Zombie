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
/** terrain base colours (RGB) by terrain code: grass ×3, dirt, road, rubble */
const BASE_RGB: number[][] = [[58, 74, 40], [66, 84, 44], [76, 92, 50], [96, 78, 52], [52, 54, 58], [82, 76, 66]];
const FLOWERS = ['#e9d36b', '#e8e2d0', '#c97ab0', '#e08a4a'];
const SHIRTS = ['#4f5f70', '#74463a', '#676047', '#4b5a3c', '#5e4d63'];
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
  private fog: HTMLCanvasElement;
  private fogCount = -1;
  private vignette: HTMLCanvasElement;
  w = 0;
  h = 0;
  /** screen px covered by the HUD at the top and bottom; warnings stay inside this band */
  safe = { top: 60, bottom: 120 };
  /** off-screen horde markers drawn this frame (screen px → world tile target) */
  indicators: { x: number; y: number; wx: number; wy: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ground = document.createElement('canvas');
    this.dark = document.createElement('canvas');
    this.dctx = this.dark.getContext('2d')!;
    this.fog = document.createElement('canvas');
    this.fog.width = MAP_W;
    this.fog.height = MAP_H;
    this.vignette = document.createElement('canvas');
  }

  /** The off-screen horde marker under a screen point, if any. */
  hitIndicator(sx: number, sy: number): { x: number; y: number } | null {
    for (const m of this.indicators) if (Math.hypot(m.x - sx, m.y - sy) < 28) return { x: m.wx, y: m.wy };
    return null;
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
    // soft vignette, cached because it only changes with the screen size
    const v = this.vignette;
    v.width = Math.ceil(this.w / 4);
    v.height = Math.ceil(this.h / 4);
    const vc = v.getContext('2d')!;
    const r = Math.hypot(v.width, v.height) / 2;
    const g = vc.createRadialGradient(v.width / 2, v.height / 2, r * 0.45, v.width / 2, v.height / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    vc.fillStyle = g;
    vc.fillRect(0, 0, v.width, v.height);
  }

  private buildGround(game: Game) {
    const g = this.ground;
    g.width = MAP_W * T;
    g.height = MAP_H * T;
    const c = g.getContext('2d')!;
    let seed = game.s.seed;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) | 0) >>> 0) / 4294967296;
    const ter = (x: number, y: number) => game.s.terrain[Math.max(0, Math.min(MAP_H - 1, y)) * MAP_W + Math.max(0, Math.min(MAP_W - 1, x))];

    // 1. one pixel per tile, upscaled with smoothing so grass, dirt and rubble blend into each other instead of forming squares
    const base = document.createElement('canvas');
    base.width = MAP_W;
    base.height = MAP_H;
    const bc = base.getContext('2d')!;
    const img = bc.createImageData(MAP_W, MAP_H);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        let t = ter(x, y);
        if (t === 4) t = 1; // roads are painted crisply on top; blend the verge as grass
        const col = BASE_RGB[t] ?? BASE_RGB[1];
        const j = (rnd() - 0.5) * 10;
        const i = (y * MAP_W + x) * 4;
        img.data[i] = col[0] + j; img.data[i + 1] = col[1] + j; img.data[i + 2] = col[2] + j * 0.6; img.data[i + 3] = 255;
      }
    }
    bc.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(base, 0, 0, MAP_W * T, MAP_H * T);

    // 2. mottling so large areas never look flat
    for (let i = 0; i < MAP_W * MAP_H * 2; i++) {
      const dark = rnd() < 0.55;
      c.fillStyle = dark ? `rgba(20,26,10,${0.05 + rnd() * 0.06})` : `rgba(200,210,150,${0.025 + rnd() * 0.03})`;
      c.beginPath();
      c.arc(rnd() * MAP_W * T, rnd() * MAP_H * T, 3 + rnd() * 9, 0, Math.PI * 2);
      c.fill();
    }

    // 3. per-tile detail: grass blades, wildflowers, pebbles and rubble
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = ter(x, y);
        const px = x * T, py = y * T;
        if (t <= 2) {
          const blades = Math.floor(rnd() * 3);
          for (let k = 0; k < blades; k++) {
            const gx = px + rnd() * T, gy = py + rnd() * T, h = 3 + rnd() * 3;
            c.strokeStyle = rnd() < 0.5 ? 'rgba(150,175,90,0.22)' : 'rgba(30,45,18,0.25)';
            c.lineWidth = 1;
            c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx - 1 - rnd(), gy - h); c.stroke();
          }
          if (rnd() < 0.025) {
            const fx = px + rnd() * T, fy = py + rnd() * T;
            c.fillStyle = FLOWERS[Math.floor(rnd() * FLOWERS.length)];
            for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(fx + (rnd() - 0.5) * 9, fy + (rnd() - 0.5) * 9, 1.6, 0, Math.PI * 2); c.fill(); }
          }
        } else if (t === 3) {
          for (let k = 0; k < 3; k++) {
            const sx = px + rnd() * T, sy = py + rnd() * T, r = 1 + rnd() * 2;
            c.fillStyle = 'rgba(30,22,14,0.35)';
            c.beginPath(); c.arc(sx + 0.8, sy + 0.8, r, 0, Math.PI * 2); c.fill();
            c.fillStyle = 'rgba(150,130,100,0.6)';
            c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill();
          }
        } else if (t === 5) {
          for (let k = 0; k < 3; k++) {
            if (rnd() > 0.7) continue;
            const sx = px + rnd() * T, sy = py + rnd() * T, w = 3 + rnd() * 6, h = 3 + rnd() * 4;
            c.fillStyle = 'rgba(20,18,16,0.4)';
            c.fillRect(sx + 1.5, sy + 1.5, w, h);
            c.fillStyle = rnd() < 0.5 ? '#7a756b' : '#8a5a44';
            c.fillRect(sx, sy, w, h);
            c.fillStyle = 'rgba(255,255,255,0.12)';
            c.fillRect(sx, sy, w, 1);
          }
        }
      }
    }

    // 4. roads: crisp asphalt with cracked, gravelly shoulders
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (ter(x, y) !== 4) continue;
        const px = x * T, py = y * T;
        c.fillStyle = '#33353a';
        c.fillRect(px, py, T, T);
        for (let k = 0; k < 7; k++) {
          c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.12)';
          c.fillRect(px + rnd() * T, py + rnd() * T, 2 + rnd() * 3, 2 + rnd() * 3);
        }
        if (rnd() < 0.12) {
          c.strokeStyle = 'rgba(10,10,12,0.55)'; c.lineWidth = 1;
          let cx = px + rnd() * T, cy = py + rnd() * T;
          c.beginPath(); c.moveTo(cx, cy);
          for (let k = 0; k < 3; k++) { cx += (rnd() - 0.5) * 14; cy += (rnd() - 0.5) * 14; c.lineTo(cx, cy); }
          c.stroke();
        }
        if (rnd() < 0.04) {
          c.fillStyle = 'rgba(15,15,18,0.7)';
          c.beginPath(); c.ellipse(px + T / 2, py + T / 2, 5 + rnd() * 4, 3 + rnd() * 3, rnd() * 3, 0, Math.PI * 2); c.fill();
        }
        const edge = (nx: number, ny: number, ex: number, ey: number, ew: number, eh: number) => {
          if (ter(nx, ny) === 4) return;
          c.fillStyle = 'rgba(15,15,15,0.45)';
          c.fillRect(ex, ey, ew, eh);
          c.fillStyle = 'rgba(140,130,110,0.35)';
          for (let k = 0; k < 4; k++) c.fillRect(ex + rnd() * Math.max(ew, 1) - 1, ey + rnd() * Math.max(eh, 1) - 1, 2, 2);
        };
        edge(x, y - 1, px, py, T, 2);
        edge(x, y + 1, px, py + T - 2, T, 2);
        edge(x - 1, y, px, py, 2, T);
        edge(x + 1, y, px + T - 2, py, 2, T);
      }
    }
    // faded centre lines
    c.strokeStyle = 'rgba(220,200,120,0.32)';
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

    // 5. darken the map border so the world fades out instead of ending at a hard edge
    const band = 4 * T, W = MAP_W * T, H = MAP_H * T;
    const fade = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
      const lg = c.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, 'rgba(8,10,8,0.6)');
      lg.addColorStop(1, 'rgba(8,10,8,0)');
      c.fillStyle = lg;
      c.fillRect(rx, ry, rw, rh);
    };
    fade(0, 0, 0, band, 0, 0, W, band);
    fade(0, H, 0, H - band, 0, H - band, W, band);
    fade(0, 0, band, 0, 0, 0, band, H);
    fade(W, 0, W - band, 0, W - band, 0, band, H);
    this.groundSeed = game.s.seed;
  }

  /** Fog of war as one pixel per tile, drawn with smoothing for soft edges. Rebuilt only when exploration changes. */
  private updateFog(game: Game) {
    const ex = game.s.explored;
    let n = 0;
    for (let i = 0; i < ex.length; i++) n += ex[i];
    if (n === this.fogCount) return;
    this.fogCount = n;
    const fc = this.fog.getContext('2d')!;
    const img = fc.createImageData(MAP_W, MAP_H);
    for (let i = 0; i < ex.length; i++) {
      img.data[i * 4] = 8; img.data[i * 4 + 1] = 10; img.data[i * 4 + 2] = 8;
      img.data[i * 4 + 3] = ex[i] ? 0 : 255;
    }
    fc.putImageData(img, 0, 0);
  }

  /** Slow-moving cloud shadows during the day. */
  private drawClouds(game: Game, now: number, alpha: number) {
    if (alpha < 0.03) return;
    const ctx = this.ctx;
    const W = MAP_W * T, H = MAP_H * T;
    for (let i = 0; i < 7; i++) {
      const r = (7 + ((game.s.seed >>> (i * 3)) & 7)) * T;
      const span = W + r * 4;
      const cx = (((i * 977 + now * (9 + i)) % span) + span) % span - r * 2;
      const cy = ((i * 613 + (game.s.seed & 1023)) % H) + Math.sin(now * 0.05 + i) * T;
      for (const [ox, oy, k] of [[0, 0, 1], [r * 0.7, r * 0.15, 0.75], [-r * 0.6, r * 0.2, 0.65]]) {
        const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r * k);
        g.addColorStop(0, `rgba(10,16,24,${0.13 * alpha})`);
        g.addColorStop(1, 'rgba(10,16,24,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx + ox - r * k, cy + oy - r * k, r * k * 2, r * k * 2);
      }
    }
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
        this.drawZombieBody(f.x, f.y, f.text as ZombieKind, f.x2, 0, p < 0.08, Math.max(0, 1 - p) * 0.999, Math.floor(f.x * 7 + f.y * 3));
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

    // smoke from the HQ campfire by day
    const dk = darkness(game);
    if (dk < 0.3) this.drawSmoke(now, 1 - dk / 0.3);
    this.drawClouds(game, now, 1 - Math.min(1, dk * 2.5));

    // fog of war: soft-edged instead of tile squares
    this.updateFog(game);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog, 0, 0, MAP_W * T, MAP_H * T);
    ctx.drawImage(this.fog, 0, 0, MAP_W * T, MAP_H * T); // twice: a darker, tighter frontier

    // sunset tint while the horde gathers
    if (!game.s.isNight && dk > 0.01) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255,110,40,${dk * 0.22})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    // night lighting
    if (dk > 0.01) this.drawDarkness(game, cam, dk, now);

    // overlays that should stay readable at night
    ctx.setTransform(z, 0, 0, z, (-cam.x + sx) * z, (-cam.y + sy) * z);
    if (dk > 0.05) this.drawEmissive(game, dk, now, inView);
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

    // screen-space: vignette, horde direction warnings and off-screen markers
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.vignette, 0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (game.s.edges.length && !game.s.isNight) this.drawEdgeWarnings(game.s.edges, now);
    this.drawThreats(game, cam, now);
  }

  private drawSmoke(now: number, alpha: number) {
    const ctx = this.ctx;
    const x = HQ_CX * T, y = HQ_CY * T;
    for (let i = 0; i < 6; i++) {
      const p = (now * 0.18 + i / 6) % 1;
      const r = 4 + p * 14;
      ctx.fillStyle = `rgba(190,190,180,${0.28 * (1 - p) * alpha})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(now * 0.7 + i * 2) * 6 + p * 22, y - 6 - p * 70, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Things that glow at night: lit windows, tower lamps, campfire embers, gunfire. */
  private drawEmissive(game: Game, dk: number, now: number, inView: (x: number, y: number, pad?: number) => boolean) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const k = Math.min(1, dk * 1.5);
    for (const b of game.s.buildings) {
      if (b.built < 1 || !inView(b.tx, b.ty, 3)) continue;
      const x = b.tx * T, y = b.ty * T, S = b.size * T;
      if (b.kind === 'house') {
        const fl = 0.85 + Math.sin(now * 3 + b.id) * 0.15;
        for (const [wx, wy] of b.level >= 2 ? [[x + 11, y + 12], [x + S - 15, y + 12]] : [[x + S - 15, y + 12]]) {
          const g = ctx.createRadialGradient(wx + 2, wy + 3, 0, wx + 2, wy + 3, 18);
          g.addColorStop(0, `rgba(255,170,70,${0.35 * k * fl})`);
          g.addColorStop(1, 'rgba(255,170,70,0)');
          ctx.fillStyle = g;
          ctx.fillRect(wx - 16, wy - 15, 36, 36);
          ctx.fillStyle = `rgba(255,200,110,${0.9 * k})`;
          ctx.fillRect(wx, wy, 5, 6);
        }
      } else if (b.kind === 'tower') {
        const g = ctx.createRadialGradient(x + T / 2, y + T / 2 - 9, 0, x + T / 2, y + T / 2 - 9, 26);
        g.addColorStop(0, `rgba(255,220,140,${0.45 * k})`);
        g.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + T / 2 - 26, y + T / 2 - 35, 52, 52);
      } else if (b.kind === 'hq') {
        const fl = 1 + Math.sin(now * 11) * 0.08 + Math.sin(now * 27) * 0.05;
        const cx = x + S / 2, cy = y + S / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 46 * fl);
        g.addColorStop(0, `rgba(255,150,60,${0.55 * k})`);
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - 50, cy - 50, 100, 100);
        // embers drifting up from the fire
        for (let i = 0; i < 12; i++) {
          const p = (now * 0.45 + i / 12) % 1;
          const ex = cx + Math.sin(i * 12.9 + now * 1.7) * (4 + p * 14);
          const ey = cy - p * 52;
          ctx.fillStyle = `rgba(255,${170 - p * 90},60,${(1 - p) * k})`;
          ctx.fillRect(ex - 1, ey - 1, 2.2, 2.2);
        }
      }
    }
    for (const f of game.s.fx) {
      const p = f.t / f.life;
      if (f.kind === 'tracer') {
        ctx.strokeStyle = `rgba(255,210,120,${(1 - p) * 0.8 * k})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(f.x * T, f.y * T); ctx.lineTo(f.x2 * T, f.y2 * T); ctx.stroke();
      } else if (f.kind === 'boom' && f.t >= 0) {
        const r = (1 + p * 2.5) * T;
        const g = ctx.createRadialGradient(f.x * T, f.y * T, 0, f.x * T, f.y * T, r);
        g.addColorStop(0, `rgba(255,170,60,${(1 - p) * 0.7 * k})`);
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(f.x * T - r, f.y * T - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  /** At night, red markers on the screen border point at zombies you cannot see. Tap one to jump there. */
  private drawThreats(game: Game, cam: Camera, now: number) {
    this.indicators = [];
    if (!game.s.isNight || !game.s.zombies.length) return;
    const ctx = this.ctx;
    const top = this.safe.top + 26, bot = this.h - this.safe.bottom - 26, left = 26, right = this.w - 26;
    if (bot - top < 80) return;
    const cx = this.w / 2, cy = (top + bot) / 2;
    const bins = new Map<number, { n: number; d: number; z: Zombie; a: number }>();
    for (const zb of game.s.zombies) {
      const sx = (zb.x * T - cam.x) * cam.zoom, sy = (zb.y * T - cam.y) * cam.zoom;
      if (sx >= 0 && sx <= this.w && sy >= this.safe.top && sy <= this.h - this.safe.bottom) continue;
      const a = Math.atan2(sy - cy, sx - cx);
      const key = ((Math.round(a / (Math.PI / 6)) % 12) + 12) % 12;
      const d = Math.hypot(zb.x - HQ_CX, zb.y - HQ_CY);
      const bin = bins.get(key);
      if (!bin) bins.set(key, { n: 1, d, z: zb, a });
      else { bin.n++; if (d < bin.d) { bin.d = d; bin.z = zb; bin.a = a; } }
    }
    const pulse = 0.75 + Math.sin(now * 6) * 0.25;
    const marks: { px: number; py: number; n: number; zb: Zombie; a: number; d: number }[] = [];
    for (const { n, z: zb, a, d } of bins.values()) {
      const dx = Math.cos(a), dy = Math.sin(a);
      const tx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
      const ty = dy > 0 ? (bot - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
      const t = Math.min(tx, ty);
      const px = cx + dx * t, py = cy + dy * t;
      // markers that would overlap become one marker with the combined count
      const near = marks.find((m) => Math.hypot(m.px - px, m.py - py) < 40);
      if (near) { near.n += n; if (d < near.d) { near.d = d; near.zb = zb; } continue; }
      marks.push({ px, py, n, zb, a, d });
    }
    for (const { px, py, n, zb, a } of marks) {
      this.indicators.push({ x: px, y: py, wx: zb.x, wy: zb.y });
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.arc(1, 2, 17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(200,36,28,${0.85 * pulse + 0.1})`;
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,180,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.rotate(a);
      ctx.fillStyle = '#ffd9cf';
      ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(17, -6); ctx.lineTo(17, 6); ctx.closePath(); ctx.fill();
      ctx.rotate(-a);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), 0, 0.5);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    }
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

  /** Pulsing chevrons + label on the side the horde will come from, kept clear of the HUD. */
  private drawEdgeWarnings(edges: number[], now: number) {
    const ctx = this.ctx;
    const a = 0.55 + Math.sin(now * 5) * 0.35;
    const top = this.safe.top + 56, bot = Math.max(top, this.h - this.safe.bottom - 56);
    const midY = (top + bot) / 2;
    for (const e of edges) {
      // anchor point and the angle that points at the threatened edge
      const [px, py, ang] = e === 0 ? [this.w / 2, top, -Math.PI / 2] : e === 2 ? [this.w / 2, bot, Math.PI / 2]
        : e === 1 ? [this.w - 58, midY, 0] : [58, midY, Math.PI];
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = `rgba(235,50,36,${a})`;
      for (let i = 0; i < 3; i++) {
        const off = 10 + i * 10 + ((now * 18) % 10);
        ctx.globalAlpha = 1 - i * 0.28;
        ctx.beginPath();
        ctx.moveTo(off + 10, 0); ctx.lineTo(off - 2, -14); ctx.lineTo(off - 2, -8); ctx.lineTo(off + 4, 0); ctx.lineTo(off - 2, 8); ctx.lineTo(off - 2, 14);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // label pill, always upright, just inside the chevrons
      const inset = e === 1 || e === 3 ? 38 : 6;
      const lx = px - Math.cos(ang) * inset, ly = py - Math.sin(ang) * inset;
      ctx.fillStyle = 'rgba(40,6,6,0.85)';
      ctx.strokeStyle = `rgba(255,90,70,${a})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(lx - 34, ly - 10, 68, 20, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd2c8';
      ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('HORDE', lx, ly + 0.5);
      ctx.textBaseline = 'alphabetic';
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
      const sc = 0.75 + 0.25 * (n.amount / n.max);
      const sway = Math.sin(now * 1.3 + n.tx) * 1;
      const cx = x + T * 0.5, cy = y + T * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(x + T * 0.62, y + T * 0.86, T * 0.48 * sc, T * 0.18 * sc, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3420';
      ctx.fillRect(x + T * 0.45, y + T * 0.5, T * 0.1, T * 0.34);
      const g = greens[n.variant];
      if (n.variant === 3) {
        // pine: stacked star layers
        for (let l = 0; l < 3; l++) {
          const r = T * (0.46 - l * 0.12) * sc;
          const ly = cy - l * 4;
          ctx.fillStyle = l === 0 ? shade(g, -22) : shade(g, l * 10);
          ctx.beginPath();
          for (let i = 0; i < 14; i++) {
            const aa = (i / 14) * Math.PI * 2;
            const rr = i % 2 ? r * 0.62 : r;
            ctx.lineTo(cx + sway + Math.cos(aa) * rr, ly + Math.sin(aa) * rr);
          }
          ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // broadleaf: dark rim, three overlapping blobs, sunlit top-left
        const r = T * 0.42 * sc;
        ctx.fillStyle = shade(g, -26);
        ctx.beginPath(); ctx.arc(cx + sway, cy + 1, r * 1.04, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade(g, -6);
        ctx.beginPath(); ctx.arc(cx + sway + r * 0.28, cy + r * 0.12, r * 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + sway - r * 0.3, cy + r * 0.2, r * 0.66, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx + sway - r * 0.12, cy - r * 0.22, r * 0.68, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade(g, 20);
        ctx.beginPath(); ctx.arc(cx + sway - r * 0.3, cy - r * 0.4, r * 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade(g, 34);
        ctx.beginPath(); ctx.arc(cx + sway - r * 0.38, cy - r * 0.5, r * 0.12, 0, Math.PI * 2); ctx.fill();
      }
    } else if (n.kind === 'wreck') {
      const cols = ['#7a3b24', '#5c5f63', '#6b5530', '#3e4f5c'];
      const col = cols[n.variant];
      ctx.save();
      ctx.translate(x + T / 2, y + T / 2);
      ctx.rotate((n.variant - 1.5) * 0.35);
      const L = T * 0.92, W = T * 0.5;
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(-L / 2 + 3, -W / 2 + 4, L, W);
      // tyres
      ctx.fillStyle = '#151515';
      for (const [wx, wy] of [[-L * 0.32, -W / 2 - 1.5], [L * 0.22, -W / 2 - 1.5], [-L * 0.32, W / 2 - 2.5], [L * 0.22, W / 2 - 2.5]]) ctx.fillRect(wx, wy, 7, 4);
      // body with rounded corners and an outline
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(-L / 2, -W / 2, L, W, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
      // roof and glass
      ctx.fillStyle = shade(col, -18);
      ctx.fillRect(-L * 0.18, -W * 0.36, L * 0.4, W * 0.72);
      ctx.fillStyle = 'rgba(140,170,185,0.55)';
      ctx.fillRect(L * 0.22, -W * 0.34, L * 0.07, W * 0.68);
      ctx.fillStyle = 'rgba(20,25,30,0.85)';
      ctx.fillRect(-L * 0.27, -W * 0.34, L * 0.07, W * 0.68);
      // sunlit edge and rust
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(-L / 2 + 3, -W / 2 + 1, L - 6, 2);
      ctx.fillStyle = 'rgba(150,72,28,0.7)';
      ctx.beginPath(); ctx.arc(-L * 0.38, -W * 0.18, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(L * 0.36, W * 0.16, 2.6, 0, Math.PI * 2); ctx.fill();
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
      // scattered rubble
      ctx.fillStyle = '#6b665d';
      for (let i = 0; i < 5; i++) ctx.fillRect(x + 6 + ((i * 23 + n.tx * 7) % (T * 2 - 14)), y + 8 + ((i * 17 + n.ty * 5) % (T * 2 - 16)), 4, 3);
      if (!looted) {
        const bob = Math.sin(now * 3 + n.tx) * 3;
        const ring = (now * 0.8 + n.tx * 0.1) % 1;
        ctx.strokeStyle = `rgba(242,201,76,${0.6 * (1 - ring)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x + T, y - 6 + bob, 9 + ring * 10, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(242,201,76,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x + T, y + 3 + bob); ctx.lineTo(x + T, y + T * 0.5); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.arc(x + T + 1, y - 4 + bob, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f2c94c';
        ctx.beginPath();
        ctx.arc(x + T, y - 6 + bob, 9.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8a6a14'; ctx.lineWidth = 1.5; ctx.stroke();
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
        // tarp and supply crates on the roof
        ctx.fillStyle = goldHq ? '#9a7a36' : '#3f5a3a';
        ctx.fillRect(x + 14, y + 14, S * 0.42, S * 0.3);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + 14, y + 14 + S * 0.15, S * 0.42, 2);
        for (const [cx2, cy2] of [[x + S - 30, y + S - 30], [x + S - 22, y + S - 38]]) {
          ctx.fillStyle = '#7a5a32'; ctx.fillRect(cx2, cy2, 12, 12);
          ctx.strokeStyle = '#4a3418'; ctx.lineWidth = 1.5; ctx.strokeRect(cx2, cy2, 12, 12);
          ctx.beginPath(); ctx.moveTo(cx2, cy2); ctx.lineTo(cx2 + 12, cy2 + 12); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(40,30,15,0.55)'; ctx.lineWidth = 1;
        for (let i = 0; i < 8; i++) {
          const t = (i + 0.5) / 8;
          for (const [bx, by] of [[x + 4 + t * (S - 8), y + 4], [x + 4 + t * (S - 8), y + S - 4], [x + 4, y + 4 + t * (S - 8)], [x + S - 4, y + 4 + t * (S - 8)]]) {
            ctx.fillStyle = '#9c8a62';
            ctx.beginPath(); ctx.ellipse(bx, by, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath(); ctx.ellipse(bx - 1, by - 1.5, 3.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();
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
        // roof tiles, ridges and outline
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 3 + i * 6, y + 3 + i * 6); ctx.lineTo(x + S - 3 - i * 6, y + 3 + i * 6); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(255,220,200,0.25)';
        ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + S - 3, y + S - 3); ctx.moveTo(x + S - 3, y + 3); ctx.lineTo(x + 3, y + S - 3); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
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
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + m + 0.5, y + m + 0.5, T - 2 * m - 1, T - 2 * m - 1);
        ctx.fillStyle = steel ? 'rgba(255,255,255,0.22)' : 'rgba(255,220,170,0.16)';
        ctx.fillRect(x + m + 1, y + m + 1, T - 2 * m - 2, 2);
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
        // canvas seams, guy lines and outline
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 3, y + 3 + i * (S - 6) / 4); ctx.lineTo(x + S - 3, y + 3 + i * (S - 6) / 4); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(220,210,170,0.45)';
        ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x - 3, y - 3); ctx.moveTo(x + S - 3, y + 3); ctx.lineTo(x + S + 3, y - 3);
        ctx.moveTo(x + 3, y + S - 3); ctx.lineTo(x - 3, y + S + 3); ctx.moveTo(x + S - 3, y + S - 3); ctx.lineTo(x + S + 3, y + S + 3); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
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
    const cy = y - bob;
    // weapon under the body so the shoulders overlap it
    if (u.kind !== 'worker') {
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x + Math.cos(u.aim) * 3, cy + Math.sin(u.aim) * 3); ctx.lineTo(x + Math.cos(u.aim) * 16, cy + Math.sin(u.aim) * 16); ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.fillStyle = u.hurt > 0 ? '#ff6b5a' : body;
    ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    // light from the top-left
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath(); ctx.arc(x - r * 0.3, cy - r * 0.35, r * 0.5, 0, Math.PI * 2); ctx.fill();
    // backpack for workers, vest strap for fighters
    if (u.kind === 'worker') {
      ctx.fillStyle = shade(body, -35);
      ctx.fillRect(x - 4, cy + 1, 8, 5);
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - r * 0.7, cy - r * 0.5); ctx.lineTo(x + r * 0.6, cy + r * 0.6); ctx.stroke();
    }
    // head
    ctx.fillStyle = '#e0b48a';
    ctx.beginPath(); ctx.arc(x, cy - 3, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,10,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    if (u.kind === 'guard') { ctx.fillStyle = '#3a5229'; ctx.beginPath(); ctx.arc(x, cy - 4.5, 5, Math.PI, 0); ctx.fill(); }
    if (u.kind === 'merc') { ctx.fillStyle = '#b02a2a'; ctx.beginPath(); ctx.ellipse(x - 1, cy - 6, 5.5, 3, -0.3, 0, Math.PI * 2); ctx.fill(); }
    if (u.kind === 'worker' && u.job !== 'idle') {
      ctx.fillStyle = u.job === 'wood' ? '#c98b4a' : u.job === 'scrap' ? '#9aa4ad' : '#8fc35a';
      ctx.beginPath(); ctx.arc(x, cy - 5.5, 3.2, Math.PI, 0); ctx.fill();
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
    this.drawZombieBody(z.x, z.y, z.kind, z.dir, z.wobble, z.flash > 0, 1, z.id);
    const r = ZOMBIES[z.kind].radius * T * 0.85;
    if (z.hp < z.maxHp) this.hpBar(z.x * T - r, z.y * T - r - 9, r * 2, z.hp / z.maxHp);
  }

  /** Shared by live zombies and dying corpses. `fall` goes 1 → 0 as a corpse collapses. */
  private drawZombieBody(zx: number, zy: number, kind: ZombieKind, ad: number, wobble: number, flash: boolean, fall: number, variant = 0) {
    const ctx = this.ctx;
    const def = ZOMBIES[kind];
    const x = zx * T, y = zy * T;
    const r = def.radius * T * 0.85;
    const col = ZCOL[kind];
    // walkers and runners still wear torn clothes; the mutated ones are all skin
    const shirt = kind === 'walker' || kind === 'runner' ? SHIRTS[Math.abs(variant) % SHIRTS.length] : col;
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
      ctx.fillStyle = shade(shirt, -20);
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
    ctx.fillStyle = flash ? '#ffffff' : shirt;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (!flash && shirt !== col) {
      // rips in the shirt show grey-green skin
      ctx.fillStyle = shade(col, -10);
      ctx.beginPath(); ctx.arc(x - fx * r * 0.35 + sx * r * 0.4, y - fy * r * 0.35 + sy * r * 0.4, r * 0.26, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.45, 0, Math.PI * 2); ctx.fill();
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
    ctx.fillStyle = flash ? '#fff' : shade(col, -12);
    ctx.beginPath(); ctx.arc(x + fx * r * 0.25, y + fy * r * 0.25 - 2, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = kind === 'abomination' ? '#ff5a3a' : '#ffdf5a';
    const ex = x + fx * r * 0.5, ey = y + fy * r * 0.5 - 2;
    const e = kind === 'abomination' ? 4 : 2.2;
    ctx.fillRect(ex + sx * e - 1, ey + sy * e - 1, 2.4, 2.4);
    ctx.fillRect(ex - sx * e - 1, ey - sy * e - 1, 2.4, 2.4);
  }

}
