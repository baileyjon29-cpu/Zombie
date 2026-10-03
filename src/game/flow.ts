import { BUILDINGS, MAP_H, MAP_W } from './config';
import type { Building } from './state';

/**
 * Zombie navigation: a Dijkstra "flow field" seeded from every building
 * zombies want to eat (HQ, houses, towers...). Walls are passable at a cost
 * proportional to their HP, so the horde naturally funnels toward gaps and
 * weak points, and bashes through when that is the cheapest route.
 */

export const DIRS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];
  get size() { return this.idx.length; }
  push(i: number, p: number) {
    const a = this.idx, b = this.pri;
    a.push(i); b.push(p);
    let c = a.length - 1;
    while (c > 0) {
      const par = (c - 1) >> 1;
      if (b[par] <= b[c]) break;
      let t = a[par]; a[par] = a[c]; a[c] = t;
      t = b[par]; b[par] = b[c]; b[c] = t;
      c = par;
    }
  }
  /** priority of the most recently popped entry */
  lastPri = 0;
  pop(): number {
    const a = this.idx, b = this.pri;
    const top = a[0];
    this.lastPri = b[0];
    const li = a.pop()!, lp = b.pop()!;
    if (a.length) {
      a[0] = li; b[0] = lp;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === c) break;
        let t = a[m]; a[m] = a[c]; a[c] = t;
        t = b[m]; b[m] = b[c]; b[c] = t;
        c = m;
      }
    }
    return top;
  }
}

/** Tile -> building id (0 = empty). */
export function buildOccupancy(buildings: Building[]): Int32Array {
  const occ = new Int32Array(MAP_W * MAP_H);
  for (const b of buildings) {
    for (let y = b.ty; y < b.ty + b.size; y++) {
      for (let x = b.tx; x < b.tx + b.size; x++) occ[y * MAP_W + x] = b.id;
    }
  }
  return occ;
}

export function isSolid(b: Building | undefined): boolean {
  return !!b && BUILDINGS[b.kind].solid && b.hp > 0;
}

/** Cost of stepping onto tile i: walls cost more the tougher they are. */
export function enterCost(occ: Int32Array, byId: Map<number, Building>, i: number): number {
  const b = byId.get(occ[i]);
  if (!b || !isSolid(b) || BUILDINGS[b.kind].target) return 1;
  return 1 + b.hp / 8;
}

export function computeFlow(buildings: Building[], occ: Int32Array, byId: Map<number, Building>, reuse?: Float32Array): Float32Array {
  const dist = (reuse ?? new Float32Array(MAP_W * MAP_H)).fill(Infinity);
  const heap = new MinHeap();
  for (const b of buildings) {
    if (!BUILDINGS[b.kind].target || b.hp <= 0) continue;
    for (let y = b.ty; y < b.ty + b.size; y++) {
      for (let x = b.tx; x < b.tx + b.size; x++) {
        dist[y * MAP_W + x] = 0;
        heap.push(y * MAP_W + x, 0);
      }
    }
  }
  const solidAt = (x: number, y: number) => isSolid(byId.get(occ[y * MAP_W + x]));

  while (heap.size) {
    const cur = heap.pop();
    const d = heap.lastPri;
    if (d > dist[cur]) continue;
    const cx = cur % MAP_W;
    const cy = (cur / MAP_W) | 0;
    const cost = enterCost(occ, byId, cur);
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (dx !== 0 && dy !== 0 && (solidAt(cx + dx, cy) || solidAt(cx, cy + dy))) continue;
      const ni = ny * MAP_W + nx;
      const nd = d + step * cost;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push(ni, dist[ni]); // push the float32-rounded value so the stale-entry check stays exact
      }
    }
  }
  return dist;
}

/** Best next tile from (tx,ty) following the flow field, or -1 if none. */
export function nextStep(dist: Float32Array, occ: Int32Array, byId: Map<number, Building>, tx: number, ty: number): number {
  let best = -1;
  let bestD = Infinity;
  const solidAt = (x: number, y: number) => isSolid(byId.get(occ[y * MAP_W + x]));
  for (const [dx, dy, step] of DIRS) {
    const nx = tx + dx, ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
    if (dx !== 0 && dy !== 0 && (solidAt(tx + dx, ty) || solidAt(tx, ty + dy))) continue;
    const ni = ny * MAP_W + nx;
    const via = dist[ni] + step * enterCost(occ, byId, ni);
    if (via < bestD) {
      bestD = via;
      best = ni;
    }
  }
  return best;
}
