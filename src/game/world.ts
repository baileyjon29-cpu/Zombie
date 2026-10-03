import { BUILDINGS, MAP_H, MAP_W, RUIN, GATHER, START, UNITS, type UnitKind } from './config';
import type { GameState, NodeKind, ResNode, Unit } from './state';

/** Deterministic PRNG (mulberry32). State lives in GameState so saves replay identically. */
export function nextRand(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

export function rand(s: GameState): number {
  const [v, next] = nextRand(s.rng);
  s.rng = next;
  return v;
}

export interface Perks {
  extraWorkers: number;
  extraGuards: number;
  doubleLoot: boolean;
  goldHq: boolean;
}

export const NO_PERKS: Perks = { extraWorkers: 0, extraGuards: 0, doubleLoot: false, goldHq: false };

export const HQ_TX = Math.floor(MAP_W / 2) - 2;
export const HQ_TY = Math.floor(MAP_H / 2) - 2;
export const HQ_CX = HQ_TX + 1.5;
export const HQ_CY = HQ_TY + 1.5;

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sx = fx - x0;
  const sy = fy - y0;
  const u = sx * sx * (3 - 2 * sx);
  const v = sy * sy * (3 - 2 * sy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function makeUnit(s: GameState, kind: UnitKind, x: number, y: number): Unit {
  const def = UNITS[kind];
  return {
    id: s.nextId++, kind, x, y, hp: def.hp, maxHp: def.hp,
    job: 'idle', state: 'idle', targetId: 0, carryRes: null, carry: 0, timer: 0, cd: 0, aim: 0,
    post: null, patrol: null, loot: null, hurt: 0,
  };
}

/** Terrain codes: 0-2 grass shades, 3 dirt, 4 road, 5 rubble */
export function newGame(seed: number, perks: Perks = NO_PERKS): GameState {
  const s: GameState = {
    version: 1, seed, rng: seed, time: 0, day: 1, phaseTime: 0, isNight: false, warned: false,
    res: { ...START.res }, jobs: { ...START.jobs },
    buildings: [], units: [], zombies: [], nodes: [], fx: [],
    nextId: 1, kills: 0, nightsSurvived: 0, edges: [], spawns: [],
    wanderTimer: 0, arrivalTimer: 0,
    terrain: new Array(MAP_W * MAP_H).fill(0),
    explored: new Array(MAP_W * MAP_H).fill(0),
    gameOver: false, questIndex: 0,
    stats: { wallsBuilt: 0, expeditions: 0, patrols: 0, guardsTrained: 0, upgrades: 0 },
    event: null, eventDay: 0, victory: false,
  };

  // --- terrain ---
  const roadY = HQ_TY + 9 + Math.floor(rand(s) * 4);
  const roadX = HQ_TX - 9 - Math.floor(rand(s) * 4);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const n = valueNoise(x, y, 7, seed);
      let t = n < 0.35 ? 0 : n < 0.65 ? 1 : 2;
      if (valueNoise(x, y, 4, seed + 7) > 0.78) t = 3;
      if (y === roadY || y === roadY + 1 || x === roadX || x === roadX + 1) t = 4;
      s.terrain[y * MAP_W + x] = t;
    }
  }

  // --- HQ ---
  const hqDef = BUILDINGS.hq;
  s.buildings.push({
    id: s.nextId++, kind: 'hq', tx: HQ_TX, ty: HQ_TY, size: hqDef.size, hp: hqDef.hp, maxHp: hqDef.hp,
    built: 1, cd: 0, aim: 0, trainQueue: 0, trainTimer: 0, level: 1,
  });

  const taken = new Set<number>();
  const mark = (tx: number, ty: number, size: number) => {
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) taken.add(y * MAP_W + x);
  };
  const free = (tx: number, ty: number, size: number) => {
    if (tx < 1 || ty < 1 || tx + size > MAP_W - 1 || ty + size > MAP_H - 1) return false;
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) if (taken.has(y * MAP_W + x)) return false;
    return true;
  };
  // keep a clear yard around HQ
  for (let y = HQ_TY - 4; y < HQ_TY + 7; y++) for (let x = HQ_TX - 4; x < HQ_TX + 7; x++) taken.add(y * MAP_W + x);

  const addNode = (kind: NodeKind, tx: number, ty: number) => {
    const size = kind === 'ruin' ? 2 : 1;
    if (!free(tx, ty, size)) return false;
    mark(tx, ty, size);
    const amount = kind === 'tree' ? GATHER.wood.nodeAmount : kind === 'wreck' ? GATHER.scrap.nodeAmount : RUIN.searches;
    const node: ResNode = { id: s.nextId++, kind, tx, ty, amount, max: amount, variant: Math.floor(rand(s) * 4) };
    s.nodes.push(node);
    return true;
  };

  // --- ruins: scavenging sites spread around the map ---
  const ruinCount = 8;
  const a0 = rand(s) * Math.PI * 2;
  for (let i = 0; i < ruinCount; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const ang = a0 + (i / ruinCount) * Math.PI * 2 + (rand(s) - 0.5) * 0.5;
      const d = 12 + rand(s) * 16;
      const tx = Math.round(HQ_CX + Math.cos(ang) * d) - 1;
      const ty = Math.round(HQ_CY + Math.sin(ang) * d) - 1;
      if (addNode('ruin', tx, ty)) {
        for (let y = ty - 1; y < ty + 3; y++) for (let x = tx - 1; x < tx + 3; x++) {
          if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && s.terrain[y * MAP_W + x] !== 4) s.terrain[y * MAP_W + x] = 5;
        }
        break;
      }
    }
  }

  // --- guaranteed starter resources close to home ---
  const ring = (kind: NodeKind, count: number, rMin: number, rMax: number) => {
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < count; tries++) {
      const ang = rand(s) * Math.PI * 2;
      const d = rMin + rand(s) * (rMax - rMin);
      if (addNode(kind, Math.round(HQ_CX + Math.cos(ang) * d), Math.round(HQ_CY + Math.sin(ang) * d))) placed++;
    }
  };
  ring('tree', 8, 6, 9);
  ring('wreck', 4, 6, 9.5);

  // --- forests ---
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const d = Math.hypot(x - HQ_CX, y - HQ_CY);
      if (d < 7) continue;
      const f = valueNoise(x, y, 6, seed + 31);
      if (f > 0.58 && rand(s) < 0.55) addNode('tree', x, y);
    }
  }
  // --- wrecks along the roads and scattered ---
  for (let i = 1; i < MAP_W - 1; i++) {
    if (rand(s) < 0.12) addNode('wreck', i, roadY + (rand(s) < 0.5 ? 0 : 1));
    if (rand(s) < 0.12) addNode('wreck', roadX + (rand(s) < 0.5 ? 0 : 1), i);
  }
  for (let i = 0; i < 30; i++) {
    addNode('wreck', 1 + Math.floor(rand(s) * (MAP_W - 2)), 1 + Math.floor(rand(s) * (MAP_H - 2)));
  }

  // --- survivors ---
  const workers = START.workers + perks.extraWorkers;
  for (let i = 0; i < workers; i++) {
    const ang = (i / workers) * Math.PI * 2;
    s.units.push(makeUnit(s, 'worker', HQ_CX + Math.cos(ang) * 2.4, HQ_CY + Math.sin(ang) * 2.4));
  }
  for (let i = 0; i < perks.extraGuards; i++) {
    const g = makeUnit(s, 'guard', HQ_CX + 3 + i, HQ_CY + 2.5);
    g.post = { x: g.x, y: g.y };
    s.units.push(g);
  }

  // starting vision
  reveal(s, HQ_CX, HQ_CY, 11);
  return s;
}

export function reveal(s: GameState, cx: number, cy: number, r: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(MAP_W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(MAP_H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) s.explored[y * MAP_W + x] = 1;
    }
  }
}
