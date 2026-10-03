import { describe, expect, it } from 'vitest';
import { BUILDINGS, DAY_LEN, EVENT_AT, MAP_W, NIGHT_LEN, RESCUE_NIGHT } from '../src/game/config';
import { Game } from '../src/game/game';
import { HQ_TX, HQ_TY, NO_PERKS, newGame } from '../src/game/world';

const rich = (g: Game) => { g.s.res = { wood: 5000, scrap: 5000, food: 5000 }; };
function run(g: Game, seconds: number, dt = 0.05) { for (let t = 0; t < seconds; t += dt) g.update(dt); }

describe('upgrades', () => {
  it('levels a watchtower up to 3 and respects unlock days', () => {
    const g = new Game(newGame(1), NO_PERKS);
    rich(g);
    expect(g.place('tower', HQ_TX + 5, HQ_TY, true)).toBeNull();
    const t = g.s.buildings.find((b) => b.kind === 'tower')!;
    g.finishNow(t);
    expect(g.upgrade(t)).toMatch(/Day 2/);
    g.s.day = 5;
    expect(g.upgrade(t)).toBeNull();
    expect(g.upgrade(t)).toBeNull();
    expect(t.level).toBe(3);
    expect(t.maxHp).toBe(BUILDINGS.tower.hp * 2);
    expect(g.upgrade(t)).toMatch(/fully upgraded/);
  });

  it('reinforces a wood wall into steel and raises population with HQ levels', () => {
    const g = new Game(newGame(2), NO_PERKS);
    rich(g);
    g.s.day = 7;
    g.place('wall', HQ_TX + 5, HQ_TY, true);
    const w = g.s.buildings.find((b) => b.kind === 'wall')!;
    g.finishNow(w);
    expect(g.upgrade(w)).toBeNull();
    expect(w.kind).toBe('steelwall');
    const cap0 = g.popCap;
    g.upgrade(g.hq);
    g.upgrade(g.hq);
    expect(g.popCap).toBe(cap0 + 8);
    expect(g.hq.maxHp).toBe(4000);
  });

  it('migrates v1.0 saves without levels', () => {
    const s = newGame(3);
    for (const b of s.buildings) delete (b as any).level;
    delete (s as any).event;
    const g = new Game(s, NO_PERKS);
    expect(g.hq.level).toBe(1);
    expect(g.popCap).toBeGreaterThan(0);
  });
});

describe('enemies', () => {
  it('spitters damage walls from range without touching them', () => {
    const g = new Game(newGame(4), NO_PERKS);
    rich(g);
    const wx = HQ_TX + 6, wy = HQ_TY + 1;
    for (let y = wy - 3; y <= wy + 3; y++) { g.s.explored[y * MAP_W + wx] = 1; g.s.day = 6; g.place('steelwall', wx, y, true); }
    g.s.day = 6;
    for (const b of g.s.buildings) g.finishNow(b);
    const wall = g.s.buildings.find((b) => b.kind === 'steelwall')!;
    g.s.zombies.push({ id: 9999, kind: 'spitter', x: wall.tx + 3.2, y: wall.ty + 0.5, hp: 34, maxHp: 34, cd: 0, flash: 0, wobble: 0, chaseId: 0, think: 0, dir: 0 });
    for (const u of g.s.units) u.state = 'sheltered';
    run(g, 3);
    expect(wall.hp).toBeLessThan(wall.maxHp);
    const z = g.s.zombies.find((x) => x.id === 9999)!;
    expect(z.x).toBeGreaterThan(wall.tx + 2);
  });

  it('a Blood Moon brings an Abomination', () => {
    const g = new Game(newGame(5), NO_PERKS);
    g.s.day = 5;
    run(g, DAY_LEN - 10);
    expect(g.s.spawns.some((o) => o.kind === 'abomination')).toBe(true);
  });

  it('counts airstrike kills and pays bounties', () => {
    const g = new Game(newGame(6), NO_PERKS);
    g.s.zombies.push({ id: 777, kind: 'brute', x: 5, y: 5, hp: 100, maxHp: 240, cd: 0, flash: 0, wobble: 0, chaseId: 0, think: 0, dir: 0 });
    g.airstrike(5, 5);
    expect(g.s.kills).toBe(1);
    expect(g.events.some((e) => e.type === 'caps' && e.reason.includes('Brute'))).toBe(true);
  });
});

describe('fixes from review', () => {
  it('pays quest rewards via a one-time quest event, not raw caps', () => {
    const g = new Game(newGame(7), NO_PERKS);
    run(g, 2);
    expect(g.events.some((e) => e.type === 'quest')).toBe(false); // starting jobs no longer auto-complete goal 1
    g.setJobs('wood', 1);
    run(g, 1.2);
    expect(g.events.filter((e) => e.type === 'quest')).toHaveLength(1);
    expect(g.events.some((e) => e.type === 'caps' && e.reason.startsWith('Goal'))).toBe(false);
  });

  it('keeps guard orders on the map', () => {
    const perks = { ...NO_PERKS, extraGuards: 1 };
    const g = new Game(newGame(8, perks), perks);
    const guard = g.s.units.find((u) => u.kind === 'guard')!;
    g.orderPost(guard, -5, -5);
    expect(guard.post!.x).toBeGreaterThan(0);
    expect(guard.post!.y).toBeGreaterThan(0);
  });

  it('returns recruits and supplies when a training barracks is demolished', () => {
    const g = new Game(newGame(9), NO_PERKS);
    rich(g);
    g.place('barracks', HQ_TX + 5, HQ_TY, true);
    const b = g.s.buildings.find((x) => x.kind === 'barracks')!;
    g.finishNow(b);
    const pop = g.pop;
    const food = g.s.res.food;
    g.trainGuard(b);
    g.trainGuard(b);
    g.demolish(b);
    expect(g.pop).toBe(pop);
    expect(g.s.res.food).toBe(food);
  });
});

describe('events and victory', () => {
  it('fires a day event from Day 2', () => {
    const g = new Game(newGame(10), NO_PERKS);
    g.s.day = 2;
    const nodes = g.s.nodes.length;
    run(g, EVENT_AT + 1);
    expect(g.s.eventDay).toBe(2);
    expect(!!g.s.event || g.s.nodes.length > nodes).toBe(true);
  });

  it('announces the rescue after the final night', () => {
    const g = new Game(newGame(11), NO_PERKS);
    g.s.nightsSurvived = RESCUE_NIGHT - 1;
    g.s.isNight = true;
    g.s.phaseTime = NIGHT_LEN - 0.1;
    run(g, 0.2);
    expect(g.s.victory).toBe(true);
    expect(g.events.some((e) => e.type === 'victory')).toBe(true);
  });
});

describe('difficulty curve (bot playthrough)', () => {
  it('a sensible defensive strategy survives at least 8 nights, while doing nothing loses early', () => {
    // bot: walls ring + towers, upgrades as days unlock, fair starting economy boosted modestly
    const bot = new Game(newGame(12), NO_PERKS);
    const s = bot.s;
    s.res = { wood: 600, scrap: 500, food: 200 };
    bot.setJobs('wood', 1);
    const r = 4;
    for (let x = HQ_TX - r; x <= HQ_TX + 2 + r; x++) for (const y of [HQ_TY - r, HQ_TY + 2 + r]) { s.explored[y * MAP_W + x] = 1; bot.place('wall', x, y, true); }
    for (let y = HQ_TY - r + 1; y < HQ_TY + 2 + r; y++) for (const x of [HQ_TX - r, HQ_TX + 2 + r]) { s.explored[y * MAP_W + x] = 1; bot.place('wall', x, y, true); }
    for (const [x, y] of [[HQ_TX - 2, HQ_TY - 2], [HQ_TX + 4, HQ_TY + 4], [HQ_TX + 4, HQ_TY - 2], [HQ_TX - 2, HQ_TY + 4]]) bot.place('tower', x, y, true);
    for (let day = 0; day < 9 && !s.gameOver; day++) {
      s.res.wood += 150; s.res.scrap += 150; s.res.food += 60; // stands in for a working economy
      for (const b of s.buildings) { if (b.kind !== 'wall' && b.kind !== 'steelwall') bot.upgrade(b); }
      for (const b of s.buildings) if (b.kind === 'wall') bot.upgrade(b);
      bot.repairAll();
      run(bot, DAY_LEN + NIGHT_LEN, 0.1);
    }
    expect(s.gameOver).toBe(false);
    expect(s.nightsSurvived).toBeGreaterThanOrEqual(8);

    const idle = new Game(newGame(12), NO_PERKS);
    for (let i = 0; i < 9 && !idle.s.gameOver; i++) run(idle, DAY_LEN + NIGHT_LEN, 0.1);
    expect(idle.s.gameOver).toBe(true);
  }, 60_000);
});
