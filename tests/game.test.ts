import { describe, expect, it } from 'vitest';
import { DAY_LEN, MAP_W, NIGHT_LEN, hordeSize } from '../src/game/config';
import { buildOccupancy, computeFlow, nextStep } from '../src/game/flow';
import { Game } from '../src/game/game';
import { HQ_CX, HQ_CY, HQ_TX, HQ_TY, NO_PERKS, newGame } from '../src/game/world';

function run(game: Game, seconds: number, dt = 0.05) {
  for (let t = 0; t < seconds; t += dt) game.update(dt);
}

describe('world generation', () => {
  it('is deterministic for a seed', () => {
    const a = newGame(1234);
    const b = newGame(1234);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('starts with an HQ, survivors, nearby resources and ruins', () => {
    const s = newGame(42);
    expect(s.buildings.filter((b) => b.kind === 'hq')).toHaveLength(1);
    expect(s.units).toHaveLength(4);
    const near = (k: string) => s.nodes.filter((n) => n.kind === k && Math.hypot(n.tx - HQ_CX, n.ty - HQ_CY) < 10).length;
    expect(near('tree')).toBeGreaterThanOrEqual(4);
    expect(near('wreck')).toBeGreaterThanOrEqual(2);
    expect(s.nodes.filter((n) => n.kind === 'ruin').length).toBeGreaterThanOrEqual(6);
  });

  it('applies starter-pack perks', () => {
    const s = newGame(7, { ...NO_PERKS, extraWorkers: 2, extraGuards: 1 });
    expect(s.units.filter((u) => u.kind === 'worker')).toHaveLength(6);
    expect(s.units.filter((u) => u.kind === 'guard')).toHaveLength(1);
  });
});

describe('zombie flow field', () => {
  it('leads toward the HQ and prefers gaps over walls', () => {
    const s = newGame(99);
    const g = new Game(s, NO_PERKS);
    // build a wall ring around the HQ with one gap on the east side
    const r = 3;
    for (let x = HQ_TX - r; x <= HQ_TX + 2 + r; x++) {
      for (const y of [HQ_TY - r, HQ_TY + 2 + r]) { s.explored[y * MAP_W + x] = 1; s.res.wood = 999; g.place('wall', x, y, true); }
    }
    for (let y = HQ_TY - r + 1; y < HQ_TY + 2 + r; y++) {
      for (const x of [HQ_TX - r, HQ_TX + 2 + r]) {
        if (x === HQ_TX + 2 + r && y === HQ_TY + 1) continue; // the gap
        s.explored[y * MAP_W + x] = 1; s.res.wood = 999; g.place('wall', x, y, true);
      }
    }
    for (const b of s.buildings) { b.built = 1; b.hp = b.maxHp; }
    const occ = buildOccupancy(s.buildings);
    const flow = computeFlow(s.buildings, occ, g.byId);
    // walk from the far west edge and make sure we enter through the gap, not a wall
    let tx = 1, ty = HQ_TY + 1;
    let hitWall = false;
    for (let i = 0; i < 400; i++) {
      const n = nextStep(flow, occ, g.byId, tx, ty);
      if (n < 0) break;
      const b = g.byId.get(occ[n]);
      if (b?.kind === 'wall') { hitWall = true; break; }
      if (b?.kind === 'hq') break;
      tx = n % MAP_W; ty = Math.floor(n / MAP_W);
    }
    expect(hitWall).toBe(false);
    expect(Math.hypot(tx - HQ_CX, ty - HQ_CY)).toBeLessThan(4);
  });
});

describe('economy & day cycle', () => {
  it('gathers resources during the day', () => {
    const g = new Game(newGame(5), NO_PERKS);
    const wood0 = g.s.res.wood;
    run(g, 40);
    expect(g.s.res.wood).toBeGreaterThan(wood0);
  });

  it('shelters workers at night and spawns the horde', () => {
    const g = new Game(newGame(5), NO_PERKS);
    run(g, DAY_LEN + 40);
    expect(g.s.isNight).toBe(true);
    expect(g.workers.every((u) => u.state === 'sheltered' || u.state === 'shelter')).toBe(true);
    expect(g.s.zombies.length + g.s.kills).toBeGreaterThan(0);
  });

  it('reaches dawn, pays the night reward and survives night 1 with towers', () => {
    const g = new Game(newGame(11), NO_PERKS);
    const s = g.s;
    s.res = { wood: 500, scrap: 500, food: 200 };
    const spots: Array<[number, number]> = [[HQ_TX - 2, HQ_TY - 2], [HQ_TX + 4, HQ_TY - 2], [HQ_TX - 2, HQ_TY + 4], [HQ_TX + 4, HQ_TY + 4]];
    for (const [x, y] of spots) expect(g.place('tower', x, y, true)).toBeNull();
    run(g, DAY_LEN + NIGHT_LEN + 1);
    expect(s.day).toBe(2);
    expect(s.gameOver).toBe(false);
    const caps = g.events.filter((e) => e.type === 'caps');
    expect(caps.some((e) => e.type === 'caps' && e.reason.startsWith('Survived night'))).toBe(true);
  });

  it('scales the horde with days', () => {
    expect(hordeSize(5)).toBeGreaterThan(hordeSize(4));
    expect(hordeSize(10)).toBeGreaterThan(hordeSize(1) * 4);
  });

  it('sends a scavenger who returns with loot', () => {
    const g = new Game(newGame(21), NO_PERKS);
    const ruin = g.s.nodes.filter((n) => n.kind === 'ruin').sort((a, b) => Math.hypot(a.tx - HQ_CX, a.ty - HQ_CY) - Math.hypot(b.tx - HQ_CX, b.ty - HQ_CY))[0];
    const scrap0 = g.s.res.scrap;
    expect(g.sendScavenger(ruin)).toBeNull();
    run(g, 45);
    expect(ruin.amount).toBe(2);
    expect(g.s.res.scrap).toBeGreaterThan(scrap0 + 15);
  });

  it('trains a guard at a finished barracks', () => {
    const g = new Game(newGame(3), NO_PERKS);
    g.s.res = { wood: 500, scrap: 500, food: 500 };
    expect(g.place('barracks', HQ_TX + 5, HQ_TY, true)).toBeNull();
    const b = g.s.buildings.find((x) => x.kind === 'barracks')!;
    g.finishNow(b);
    expect(g.trainGuard(b)).toBeNull();
    run(g, 9);
    expect(g.s.units.some((u) => u.kind === 'guard')).toBe(true);
    expect(g.workers).toHaveLength(3);
  });

  it('rejects placement on resources or unexplored land', () => {
    const g = new Game(newGame(8), NO_PERKS);
    const tree = g.s.nodes.find((n) => n.kind === 'tree' && g.isExplored(n.tx, n.ty))!;
    expect(g.canPlace('wall', tree.tx, tree.ty)).toBe(false);
    expect(g.canPlace('wall', 2, 2)).toBe(false);
  });
});
