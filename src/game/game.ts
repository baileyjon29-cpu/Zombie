import {
  AIRSTRIKE, BUILDINGS, CAPS, DAY_LEN, DUSK_WARNING, FARM_SLOTS, FOOD_PER_PERSON_DAWN, GATHER, GUARD_TRAIN,
  MAP_H, MAP_W, NIGHT_LEN, POP_HOUSE, POP_HQ, RUIN, SUPPLY_DROP, TOWER, TRAP, UNITS, ZOMBIE_AGGRO, ZOMBIES,
  canAfford, hordeMix, hordeSize, pay, type BuildingKind, type Cost, type ResKey, type ZombieKind,
} from './config';
import { buildOccupancy, computeFlow, isSolid, nextStep } from './flow';
import { QUESTS } from './quests';
import { EDGE_NAMES, type Building, type GameState, type ResNode, type Unit, type WorkJob, type Zombie } from './state';
import { HQ_CX, HQ_CY, makeUnit, rand, reveal, type Perks } from './world';

export type SoundName = 'shot' | 'rifle' | 'build' | 'place' | 'hit' | 'die' | 'horn' | 'dawn' | 'coin' | 'boom' | 'error' | 'groan' | 'click';

export type GameEvent =
  | { type: 'toast'; text: string; tone: 'info' | 'good' | 'bad' | 'warn' }
  | { type: 'sound'; name: SoundName }
  | { type: 'caps'; amount: number; reason: string }
  | { type: 'shake'; amount: number }
  | { type: 'gameover' }
  | { type: 'dawn' }
  | { type: 'dusk' }
  | { type: 'save' };

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export class Game {
  s: GameState;
  perks: Perks;
  events: GameEvent[] = [];
  occ!: Int32Array;
  nodeGrid!: Int32Array;
  byId = new Map<number, Building>();
  nodeById = new Map<number, ResNode>();
  flow!: Float32Array;
  private flowDirty = true;
  private flowSoft = false;
  private flowAge = 0;
  private revealTimer = 0;
  private jobTimer = 0;
  private questTimer = 0;
  private warnedFarm = false;

  constructor(state: GameState, perks: Perks) {
    this.s = state;
    this.perks = perks;
    this.rebuildCaches();
  }

  // ---------------------------------------------------------------- caches
  rebuildCaches() {
    this.byId.clear();
    for (const b of this.s.buildings) this.byId.set(b.id, b);
    this.occ = buildOccupancy(this.s.buildings);
    this.nodeById.clear();
    this.nodeGrid = new Int32Array(MAP_W * MAP_H);
    for (const n of this.s.nodes) {
      this.nodeById.set(n.id, n);
      const size = n.kind === 'ruin' ? 2 : 1;
      for (let y = n.ty; y < n.ty + size; y++) for (let x = n.tx; x < n.tx + size; x++) this.nodeGrid[y * MAP_W + x] = n.id;
    }
    this.flowDirty = true;
  }

  private ensureFlow(dt: number) {
    this.flowAge += dt;
    if (this.flowSoft && this.flowAge > 0.75) this.flowDirty = true;
    if (this.flowDirty) {
      this.flowAge = 0;
      this.flowSoft = false;
      this.flow = computeFlow(this.s.buildings, this.occ, this.byId);
      this.flowDirty = false;
    }
  }

  emit(e: GameEvent) { this.events.push(e); }
  toast(text: string, tone: 'info' | 'good' | 'bad' | 'warn' = 'info') { this.emit({ type: 'toast', text, tone }); }
  sound(name: SoundName) { this.emit({ type: 'sound', name }); }

  get hq(): Building { return this.s.buildings.find((b) => b.kind === 'hq')!; }
  get workers(): Unit[] { return this.s.units.filter((u) => u.kind === 'worker'); }
  get popCap(): number {
    return POP_HQ + this.s.buildings.filter((b) => b.kind === 'house' && b.built >= 1).length * POP_HOUSE;
  }
  get pop(): number { return this.s.units.length; }

  buildingAt(tx: number, ty: number): Building | undefined {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return undefined;
    return this.byId.get(this.occ[ty * MAP_W + tx]);
  }
  nodeAt(tx: number, ty: number): ResNode | undefined {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return undefined;
    return this.nodeById.get(this.nodeGrid[ty * MAP_W + tx]);
  }
  isExplored(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && this.s.explored[ty * MAP_W + tx] === 1;
  }

  // ---------------------------------------------------------------- player actions
  canPlace(kind: BuildingKind, tx: number, ty: number): boolean {
    const def = BUILDINGS[kind];
    if (tx < 1 || ty < 1 || tx + def.size > MAP_W - 1 || ty + def.size > MAP_H - 1) return false;
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        const i = y * MAP_W + x;
        if (this.occ[i] || this.nodeGrid[i] || !this.s.explored[i]) return false;
      }
    }
    return true;
  }

  /** Returns null on success or a reason string. */
  place(kind: BuildingKind, tx: number, ty: number, quiet = false): string | null {
    const def = BUILDINGS[kind];
    if (this.s.gameOver) return 'Game over';
    if (this.s.day < def.unlockDay) return `Unlocks on Day ${def.unlockDay}`;
    if (!this.canPlace(kind, tx, ty)) return 'Can’t build there';
    if (!canAfford(this.s.res, def.cost)) return 'Not enough resources';
    pay(this.s.res, def.cost);
    const b: Building = {
      id: this.s.nextId++, kind, tx, ty, size: def.size, hp: def.buildTime > 0 ? def.hp * 0.15 : def.hp, maxHp: def.hp,
      built: def.buildTime > 0 ? 0 : 1, cd: 0, aim: 0, trainQueue: 0, trainTimer: 0,
    };
    this.s.buildings.push(b);
    this.byId.set(b.id, b);
    for (let y = ty; y < ty + def.size; y++) for (let x = tx; x < tx + def.size; x++) this.occ[y * MAP_W + x] = b.id;
    this.flowDirty = true;
    if (kind === 'wall' || kind === 'steelwall') this.s.stats.wallsBuilt++;
    if (!quiet) this.sound('place');
    return null;
  }

  demolish(b: Building) {
    if (b.kind === 'hq') return;
    const cost = BUILDINGS[b.kind].cost;
    for (const k of Object.keys(cost) as ResKey[]) this.s.res[k] += Math.floor((cost[k] ?? 0) * 0.5 * b.built);
    this.removeBuilding(b);
    this.sound('click');
  }

  private removeBuilding(b: Building) {
    this.s.buildings = this.s.buildings.filter((x) => x !== b);
    this.byId.delete(b.id);
    for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) this.occ[y * MAP_W + x] = 0;
    for (const u of this.s.units) if (u.targetId === b.id && (u.state === 'toFarm' || u.state === 'farming')) u.state = 'idle';
    this.flowDirty = true;
  }

  repairCost(b: Building): Cost {
    const missing = 1 - b.hp / b.maxHp;
    if (missing <= 0 || b.built < 1) return {};
    const base: Cost = b.kind === 'hq' ? { wood: 120, scrap: 60 } : BUILDINGS[b.kind].cost;
    const out: Cost = {};
    for (const k of Object.keys(base) as ResKey[]) out[k] = Math.max(1, Math.ceil((base[k] ?? 0) * 0.5 * missing));
    return out;
  }

  repair(b: Building): boolean {
    const c = this.repairCost(b);
    if (!Object.keys(c).length) return false;
    if (!canAfford(this.s.res, c)) { this.toast('Not enough resources to repair', 'bad'); this.sound('error'); return false; }
    pay(this.s.res, c);
    b.hp = b.maxHp;
    this.flowDirty = true;
    this.sound('build');
    return true;
  }

  repairAllCost(): Cost {
    const total: Cost = {};
    for (const b of this.s.buildings) {
      const c = this.repairCost(b);
      for (const k of Object.keys(c) as ResKey[]) total[k] = (total[k] ?? 0) + (c[k] ?? 0);
    }
    return total;
  }

  repairAll(): boolean {
    const c = this.repairAllCost();
    if (!Object.keys(c).length) { this.toast('Everything is in good shape', 'info'); return false; }
    if (!canAfford(this.s.res, c)) { this.toast('Not enough resources to repair everything', 'bad'); this.sound('error'); return false; }
    pay(this.s.res, c);
    for (const b of this.s.buildings) if (b.built >= 1) b.hp = b.maxHp;
    this.flowDirty = true;
    this.sound('build');
    this.toast('All structures repaired', 'good');
    return true;
  }

  finishCost(b: Building): number {
    if (b.built >= 1) return 0;
    return Math.max(1, Math.ceil((1 - b.built) * BUILDINGS[b.kind].buildTime * CAPS.perBuildSecond));
  }

  finishNow(b: Building) {
    b.hp = b.maxHp;
    b.built = 1;
    this.flowDirty = true;
    this.onBuilt(b);
  }

  setJobs(job: WorkJob, delta: number) {
    const total = this.s.jobs.wood + this.s.jobs.scrap + this.s.jobs.food;
    const workers = this.workers.length;
    if (delta > 0 && total >= workers) return;
    this.s.jobs[job] = Math.max(0, this.s.jobs[job] + delta);
    this.assignJobs();
    this.sound('click');
  }

  private clampJobs() {
    const workers = this.workers.length;
    const order: WorkJob[] = ['food', 'scrap', 'wood'];
    let total = this.s.jobs.wood + this.s.jobs.scrap + this.s.jobs.food;
    for (const j of order) {
      while (total > workers && this.s.jobs[j] > 0) { this.s.jobs[j]--; total--; }
    }
  }

  assignJobs() {
    this.clampJobs();
    const want: WorkJob[] = [];
    for (const j of ['wood', 'scrap', 'food'] as WorkJob[]) for (let i = 0; i < this.s.jobs[j]; i++) want.push(j);
    const workers = this.workers.sort((a, b) => a.id - b.id);
    // keep workers on their current job where possible to avoid shuffling
    const remaining = [...want];
    const unassigned: Unit[] = [];
    for (const w of workers) {
      const i = w.job === 'idle' ? -1 : remaining.indexOf(w.job);
      if (i >= 0) remaining.splice(i, 1);
      else unassigned.push(w);
    }
    for (const w of unassigned) {
      const job = remaining.shift() ?? 'idle';
      if (w.job !== job) {
        w.job = job;
        if (w.state === 'toNode' || w.state === 'gather' || w.state === 'toFarm' || w.state === 'farming' || w.state === 'idle') {
          w.state = 'idle';
          w.targetId = 0;
        }
      }
    }
  }

  sendScavenger(ruin: ResNode): string | null {
    if (ruin.kind !== 'ruin' || ruin.amount <= 0) return 'Nothing left to scavenge';
    if (this.s.isNight) return 'Too dangerous at night';
    if (this.s.units.some((u) => (u.state === 'expedition' || u.state === 'searching') && u.targetId === ruin.id)) {
      return 'Someone is already on the way';
    }
    const pool = this.workers.filter((u) => u.state !== 'expedition' && u.state !== 'searching' && u.state !== 'home' && u.state !== 'sheltered');
    if (!pool.length) return 'No available survivors';
    const rank = (u: Unit) => (u.job === 'idle' ? 0 : u.job === 'wood' ? 1 : u.job === 'scrap' ? 2 : 3);
    pool.sort((a, b) => rank(a) - rank(b));
    const u = pool[0];
    if (u.carry > 0) { this.s.res[u.carryRes!] += u.carry; u.carry = 0; u.carryRes = null; }
    u.state = 'expedition';
    u.targetId = ruin.id;
    this.s.stats.expeditions++;
    this.sound('click');
    return null;
  }

  trainGuard(b: Building): string | null {
    if (b.kind !== 'barracks' || b.built < 1) return 'Barracks not ready';
    if (!canAfford(this.s.res, GUARD_TRAIN.cost)) return 'Not enough resources';
    const pool = this.workers.filter((u) => u.state !== 'expedition' && u.state !== 'searching' && u.state !== 'home');
    if (!pool.length) return 'No survivors available to train';
    pool.sort((a, b2) => (a.job === 'idle' ? 0 : 1) - (b2.job === 'idle' ? 0 : 1));
    const w = pool[0];
    if (w.carry > 0 && w.carryRes) this.s.res[w.carryRes] += w.carry;
    pay(this.s.res, GUARD_TRAIN.cost);
    this.s.units = this.s.units.filter((u) => u !== w);
    b.trainQueue++;
    if (b.trainQueue === 1) b.trainTimer = GUARD_TRAIN.time;
    this.assignJobs();
    this.sound('click');
    return null;
  }

  orderPost(u: Unit, x: number, y: number) {
    u.post = { x, y };
    u.patrol = null;
    this.sound('click');
  }

  orderPatrol(u: Unit, ax: number, ay: number, bx: number, by: number) {
    u.patrol = { ax, ay, bx, by, toB: true };
    u.post = null;
    this.s.stats.patrols++;
    this.sound('click');
  }

  supplyDrop() {
    for (const k of Object.keys(SUPPLY_DROP) as ResKey[]) this.s.res[k] += SUPPLY_DROP[k];
    this.s.fx.push({ kind: 'drop', x: HQ_CX + 2.5, y: HQ_CY + 2.5, x2: 0, y2: 0, t: 0, life: 1.6 });
    this.toast(`📦 Supply drop: +${SUPPLY_DROP.wood} wood, +${SUPPLY_DROP.scrap} scrap, +${SUPPLY_DROP.food} food`, 'good');
    this.sound('coin');
  }

  airstrike(x: number, y: number) {
    let killed = 0;
    for (const z of this.s.zombies) {
      if (dist(z.x, z.y, x, y) <= AIRSTRIKE.radius) { z.hp -= AIRSTRIKE.dmg; z.flash = 0.2; if (z.hp <= 0) killed++; }
    }
    for (let i = 0; i < 7; i++) {
      const a = rand(this.s) * Math.PI * 2, r = rand(this.s) * AIRSTRIKE.radius * 0.8;
      this.s.fx.push({ kind: 'boom', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, x2: 0, y2: 0, t: -i * 0.06, life: 0.7 });
    }
    reveal(this.s, x, y, AIRSTRIKE.radius + 2);
    this.emit({ type: 'shake', amount: 14 });
    this.sound('boom');
    if (killed) this.toast(`💥 Airstrike took out ${killed} zombies`, 'good');
  }

  hireMercenary() {
    const u = makeUnit(this.s, 'merc', HQ_CX + 2.6, HQ_CY);
    u.post = { x: u.x, y: u.y };
    this.s.units.push(u);
    this.toast('🎖️ A mercenary has joined your defense', 'good');
    this.sound('coin');
  }

  revive() {
    const hq = this.hq;
    hq.hp = hq.maxHp * 0.6;
    this.s.gameOver = false;
    for (const z of this.s.zombies) if (dist(z.x, z.y, HQ_CX, HQ_CY) < 12) z.hp = 0;
    this.s.zombies = this.s.zombies.filter((z) => z.hp > 0);
    this.s.fx.push({ kind: 'boom', x: HQ_CX, y: HQ_CY, x2: 0, y2: 0, t: 0, life: 1 });
    this.flowDirty = true;
    this.emit({ type: 'shake', amount: 18 });
    this.sound('boom');
    this.toast('The Haven stands again!', 'good');
  }

  // ---------------------------------------------------------------- simulation
  update(dt: number) {
    const s = this.s;
    this.updateFx(dt);
    if (s.gameOver) return;
    s.time += dt;
    this.ensureFlow(dt);
    this.updatePhase(dt);
    this.updateBuildings(dt);
    this.updateUnits(dt);
    this.updateZombies(dt);

    this.jobTimer -= dt;
    if (this.jobTimer <= 0) { this.jobTimer = 0.5; this.assignJobs(); }
    this.revealTimer -= dt;
    if (this.revealTimer <= 0) { this.revealTimer = 0.3; this.updateReveal(); }
    this.questTimer -= dt;
    if (this.questTimer <= 0) { this.questTimer = 1; this.checkQuests(); }

    if (this.hq.hp <= 0) {
      s.gameOver = true;
      this.emit({ type: 'shake', amount: 20 });
      this.sound('die');
      this.emit({ type: 'gameover' });
    }
  }

  private updatePhase(dt: number) {
    const s = this.s;
    s.phaseTime += dt;
    if (!s.isNight) {
      if (!s.warned && s.phaseTime >= DAY_LEN - DUSK_WARNING) this.planHorde();
      s.wanderTimer += dt;
      if (s.day >= 2 && s.wanderTimer > 26) {
        s.wanderTimer = 0;
        const dayZ = s.zombies.length;
        if (dayZ < 2 + Math.floor(s.day / 3)) this.spawnZombie('walker', Math.floor(rand(s) * 4));
      }
      s.arrivalTimer += dt;
      if (s.arrivalTimer > 40) {
        s.arrivalTimer = 0;
        if (this.pop < this.popCap && s.res.food > this.pop * 4 && rand(s) < 0.5) this.addSurvivor('A survivor followed your smoke signal');
      }
      if (s.phaseTime >= DAY_LEN) {
        s.isNight = true;
        s.phaseTime = 0;
        this.emit({ type: 'dusk' });
        for (const u of this.workers) this.sendHome(u);
      }
    } else {
      while (s.spawns.length && s.spawns[0].at <= s.phaseTime) {
        const o = s.spawns.shift()!;
        this.spawnZombie(o.kind, o.edge);
      }
      if (s.phaseTime >= NIGHT_LEN) this.dawn();
    }
  }

  private planHorde() {
    const s = this.s;
    s.warned = true;
    const edgeCount = s.day >= 8 ? 3 : s.day >= 4 ? 2 : 1;
    const edges: number[] = [];
    while (edges.length < edgeCount) {
      const e = Math.floor(rand(s) * 4);
      if (!edges.includes(e)) edges.push(e);
    }
    s.edges = edges;
    const n = hordeSize(s.day);
    s.spawns = [];
    for (let i = 0; i < n; i++) {
      s.spawns.push({ kind: hordeMix(s.day, rand(s)), at: 1 + (i / n) * 34 + rand(s) * 2, edge: edges[i % edges.length] });
    }
    if (s.day % 5 === 0) {
      for (let i = 0; i < Math.floor(s.day / 5); i++) s.spawns.push({ kind: 'brute', at: 20 + i * 3, edge: edges[0] });
    }
    s.spawns.sort((a, b) => a.at - b.at);
    const from = edges.map((e) => EDGE_NAMES[e]).join(' & ');
    const blood = s.day % 5 === 0 ? '🩸 BLOOD MOON! ' : '';
    this.toast(`${blood}🧟 Horde of ~${s.spawns.length} coming from the ${from} at nightfall!`, 'warn');
    this.sound('horn');
  }

  private dawn() {
    const s = this.s;
    s.isNight = false;
    s.phaseTime = 0;
    s.day++;
    s.warned = false;
    s.nightsSurvived++;
    s.spawns = [];
    s.edges = [];
    const reward = CAPS.nightReward(s.day - 1);
    this.emit({ type: 'caps', amount: reward, reason: `Survived night ${s.day - 1}` });
    // feed everyone
    const need = this.pop * FOOD_PER_PERSON_DAWN;
    if (s.res.food >= need) {
      s.res.food -= need;
    } else {
      s.res.food = 0;
      const w = this.workers.find((u) => u.state === 'sheltered' || u.state === 'idle');
      if (w) {
        s.units = s.units.filter((u) => u !== w);
        this.assignJobs();
        this.toast('🥫 Not enough food — a survivor left the Haven. Build farms!', 'bad');
      }
    }
    for (const u of this.workers) {
      if (u.state === 'sheltered') this.emerge(u);
    }
    if (this.pop < this.popCap && s.res.food >= 15) {
      const n = Math.min(this.popCap - this.pop, 1 + (rand(s) < 0.4 ? 1 : 0));
      for (let i = 0; i < n; i++) this.addSurvivor(null);
      this.toast(`☀️ Day ${s.day}. ${n} new survivor${n > 1 ? 's' : ''} arrived at dawn.`, 'good');
    } else {
      this.toast(`☀️ Day ${s.day}. You made it through the night.`, 'good');
    }
    this.emit({ type: 'dawn' });
    this.emit({ type: 'save' });
    this.sound('dawn');
  }

  private addSurvivor(msg: string | null) {
    const a = rand(this.s) * Math.PI * 2;
    const u = makeUnit(this.s, 'worker', HQ_CX + Math.cos(a) * 2.4, HQ_CY + Math.sin(a) * 2.4);
    this.s.units.push(u);
    if (msg) this.toast(`🧍 ${msg}`, 'good');
  }

  private spawnZombie(kind: ZombieKind, edge: number) {
    const s = this.s;
    const along = 1 + rand(s) * (MAP_W - 2);
    const x = edge === 1 ? MAP_W - 0.5 : edge === 3 ? 0.5 : along;
    const y = edge === 0 ? 0.5 : edge === 2 ? MAP_H - 0.5 : edge === 1 || edge === 3 ? 1 + rand(s) * (MAP_H - 2) : 0.5;
    const def = ZOMBIES[kind];
    const hpScale = 1 + Math.max(0, s.day - 3) * 0.06;
    const z: Zombie = {
      id: s.nextId++, kind, x, y, hp: def.hp * hpScale, maxHp: def.hp * hpScale, cd: 0, flash: 0,
      wobble: rand(s) * 10, chaseId: 0, think: rand(s) * 0.4, dir: 0,
    };
    s.zombies.push(z);
  }

  private onBuilt(b: Building) {
    if (b.kind !== 'wall' && b.kind !== 'steelwall' && b.kind !== 'trap') {
      this.toast(`${BUILDINGS[b.kind].icon} ${BUILDINGS[b.kind].name} complete`, 'good');
      this.sound('build');
    }
    reveal(this.s, b.tx + b.size / 2, b.ty + b.size / 2, BUILDINGS[b.kind].sight);
  }

  private updateBuildings(dt: number) {
    const s = this.s;
    for (const b of s.buildings) {
      const def = BUILDINGS[b.kind];
      if (b.built < 1) {
        b.built = Math.min(1, b.built + dt / def.buildTime);
        b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * 0.85 * dt) / def.buildTime);
        if (b.built >= 1) this.onBuilt(b);
        continue;
      }
      if (b.kind === 'tower') {
        b.cd -= dt;
        if (b.cd <= 0) {
          const cx = b.tx + 0.5, cy = b.ty + 0.5;
          const z = this.nearestZombie(cx, cy, TOWER.range);
          if (z) {
            b.cd = TOWER.cooldown;
            b.aim = Math.atan2(z.y - cy, z.x - cx);
            this.hitZombie(z, TOWER.dmg, cx, cy);
            this.sound('rifle');
          }
        }
      } else if (b.kind === 'barracks' && b.trainQueue > 0) {
        b.trainTimer -= dt;
        if (b.trainTimer <= 0) {
          b.trainQueue--;
          b.trainTimer = GUARD_TRAIN.time;
          const g = makeUnit(s, 'guard', b.tx + 1, b.ty + 2.4);
          g.post = { x: b.tx + 1 + (rand(s) - 0.5) * 2, y: b.ty + 2.8 + rand(s) };
          s.units.push(g);
          s.stats.guardsTrained++;
          this.toast('🔫 A new guard reports for duty. Tap to post or patrol.', 'good');
          this.sound('build');
        }
      }
    }
    // traps
    for (const z of s.zombies) {
      const b = this.buildingAt(Math.floor(z.x), Math.floor(z.y));
      if (b && b.kind === 'trap' && b.built >= 1) {
        z.hp -= TRAP.dps * dt;
        z.flash = 0.05;
        b.hp -= TRAP.wear * dt;
        if (z.hp <= 0) this.killZombie(z);
        if (b.hp <= 0) this.removeBuilding(b);
      }
    }
  }

  private nearestZombie(x: number, y: number, range: number): Zombie | null {
    let best: Zombie | null = null;
    let bd = range;
    for (const z of this.s.zombies) {
      if (z.hp <= 0) continue;
      const d = dist(x, y, z.x, z.y);
      if (d <= bd) { bd = d; best = z; }
    }
    return best;
  }

  private hitZombie(z: Zombie, dmg: number, fromX: number, fromY: number) {
    z.hp -= dmg;
    z.flash = 0.12;
    this.s.fx.push({ kind: 'tracer', x: fromX, y: fromY, x2: z.x, y2: z.y, t: 0, life: 0.09 });
    if (z.hp <= 0) this.killZombie(z);
  }

  private killZombie(z: Zombie) {
    if (z.hp > 0 || z.cd === -99) return;
    z.cd = -99; // mark as counted
    this.s.kills++;
    this.s.fx.push({ kind: 'blood', x: z.x, y: z.y, x2: rand(this.s), y2: ZOMBIES[z.kind].radius, t: 0, life: 18 });
    if (z.kind === 'brute') {
      this.emit({ type: 'caps', amount: ZOMBIES.brute.bounty, reason: 'Brute bounty' });
    }
  }

  // ------------------------------------------------------------------ units
  private moveTo(u: Unit, x: number, y: number, dt: number, speed: number): boolean {
    const d = dist(u.x, u.y, x, y);
    const step = speed * dt;
    if (d <= step || d < 0.05) { u.x = x; u.y = y; return true; }
    u.x += ((x - u.x) / d) * step;
    u.y += ((y - u.y) / d) * step;
    u.aim = Math.atan2(y - u.y, x - u.x);
    return false;
  }

  private sendHome(u: Unit) {
    if (u.state === 'sheltered') return;
    if (u.state === 'searching') return; // finishes the search first, then heads home
    if (u.state === 'expedition') { u.state = 'home'; return; }
    if (u.state === 'home') return;
    u.state = 'shelter';
  }

  private emerge(u: Unit) {
    const a = rand(this.s) * Math.PI * 2;
    u.x = HQ_CX + Math.cos(a) * 2.2;
    u.y = HQ_CY + Math.sin(a) * 2.2;
    u.state = 'idle';
    u.targetId = 0;
  }

  private deliver(u: Unit) {
    if (u.carry > 0 && u.carryRes) {
      this.s.res[u.carryRes] += u.carry;
      this.s.fx.push({ kind: 'text', x: u.x, y: u.y - 0.5, x2: 0, y2: 0, t: 0, life: 1, text: `+${u.carry}`, color: u.carryRes === 'wood' ? '#d9a066' : '#b8c4cc' });
    }
    u.carry = 0;
    u.carryRes = null;
    if (u.loot) {
      const l = u.loot;
      this.s.res.wood += l.wood;
      this.s.res.scrap += l.scrap;
      this.s.res.food += l.food;
      let msg = `🎒 Scavenger returned: +${l.wood} wood, +${l.scrap} scrap, +${l.food} food`;
      if (l.caps) { this.emit({ type: 'caps', amount: l.caps, reason: 'Found in the ruins' }); }
      if (l.survivor) {
        if (this.pop < this.popCap) { this.addSurvivor(null); msg += ' — and a new survivor!'; }
        else msg += ' — found a survivor, but no room (build houses)';
      }
      this.toast(msg, 'good');
      this.sound('coin');
      u.loot = null;
    }
  }

  private zombieNear(x: number, y: number, r: number): boolean {
    for (const z of this.s.zombies) if (dist(x, y, z.x, z.y) < r) return true;
    return false;
  }

  private updateUnits(dt: number) {
    const s = this.s;
    for (const u of s.units) {
      u.hurt = Math.max(0, u.hurt - dt);
      if (u.kind === 'worker') this.updateWorker(u, dt);
      else this.updateGuard(u, dt);
    }
    const dead = s.units.filter((u) => u.hp <= 0);
    if (dead.length) {
      for (const u of dead) {
        s.fx.push({ kind: 'blood', x: u.x, y: u.y, x2: 0.5, y2: 0.35, t: 0, life: 18 });
        this.toast(u.kind === 'worker' ? '💀 A survivor was killed' : u.kind === 'merc' ? '💀 Your mercenary fell' : '💀 A guard was killed', 'bad');
      }
      s.units = s.units.filter((u) => u.hp > 0);
      this.sound('die');
      this.assignJobs();
    }
  }

  private updateWorker(u: Unit, dt: number) {
    const s = this.s;
    const speed = UNITS.worker.speed;
    // daytime panic: run home if a zombie gets close
    if (!s.isNight && u.state !== 'sheltered' && u.state !== 'shelter' && u.state !== 'home' && u.state !== 'expedition' && u.state !== 'searching') {
      if (this.zombieNear(u.x, u.y, 3)) { u.state = 'shelter'; }
    }
    switch (u.state) {
      case 'sheltered': {
        u.timer -= dt;
        if (!s.isNight && u.timer <= 0) {
          u.timer = 1;
          if (!this.zombieNear(HQ_CX, HQ_CY, 9)) this.emerge(u);
        }
        return;
      }
      case 'shelter':
      case 'home': {
        if (dist(u.x, u.y, HQ_CX, HQ_CY) < 1.9 || this.moveTo(u, HQ_CX, HQ_CY, dt, speed * 1.15)) {
          this.deliver(u);
          u.state = 'sheltered';
          u.timer = 1;
          if (!s.isNight && u.job !== 'idle' && !this.zombieNear(HQ_CX, HQ_CY, 9)) this.emerge(u);
        }
        return;
      }
      case 'expedition': {
        const ruin = this.nodeById.get(u.targetId);
        if (!ruin || ruin.amount <= 0) { u.state = 'home'; return; }
        if (this.moveTo(u, ruin.tx + 1, ruin.ty + 1, dt, speed)) { u.state = 'searching'; u.timer = RUIN.searchTime; }
        return;
      }
      case 'searching': {
        u.timer -= dt;
        if (u.timer <= 0) {
          const ruin = this.nodeById.get(u.targetId);
          if (ruin && ruin.amount > 0) {
            ruin.amount--;
            const far = 1 + dist(ruin.tx, ruin.ty, HQ_CX, HQ_CY) / 30;
            const mult = far * (this.perks.doubleLoot ? 2 : 1);
            const r = () => rand(s);
            u.loot = {
              wood: Math.round((15 + r() * 20) * mult),
              scrap: Math.round((20 + r() * 25) * mult),
              food: Math.round((10 + r() * 20) * mult),
              survivor: r() < 0.3,
              caps: r() < 0.25 ? 3 + Math.floor(r() * 6) : 0,
            };
            reveal(s, ruin.tx + 1, ruin.ty + 1, 6);
          }
          u.state = 'home';
        }
        return;
      }
      default:
        break;
    }
    if (s.isNight) { u.state = 'shelter'; return; }

    if (u.job === 'idle') {
      u.timer -= dt;
      if (u.timer <= 0 || u.state !== 'idle') {
        u.state = 'idle';
        u.timer = 2 + rand(s) * 3;
        u.post = { x: HQ_CX + (rand(s) - 0.5) * 6, y: HQ_CY + (rand(s) - 0.5) * 6 };
      }
      if (u.post) this.moveTo(u, u.post.x, u.post.y, dt, speed * 0.4);
      return;
    }

    if (u.job === 'food') {
      if (u.state !== 'toFarm' && u.state !== 'farming') {
        const farm = this.findFarm(u);
        if (!farm) {
          if (!this.warnedFarm) { this.warnedFarm = true; this.toast('🌽 Farmers need a Farm to work', 'warn'); }
          u.state = 'idle';
          return;
        }
        u.targetId = farm.id;
        u.state = 'toFarm';
      }
      const farm = this.byId.get(u.targetId);
      if (!farm || farm.built < 1) { u.state = 'idle'; return; }
      if (u.state === 'toFarm') {
        const slot = s.units.filter((o) => o.targetId === farm.id && o.job === 'food' && o.id < u.id).length;
        if (this.moveTo(u, farm.tx + 0.5 + slot, farm.ty + 1, dt, speed)) { u.state = 'farming'; u.timer = GATHER.food.time; }
      } else {
        u.timer -= dt;
        if (u.timer <= 0) {
          u.timer = GATHER.food.time;
          s.res.food += GATHER.food.amount;
          s.fx.push({ kind: 'text', x: u.x, y: u.y - 0.5, x2: 0, y2: 0, t: 0, life: 0.9, text: '+1', color: '#9fd36b' });
        }
      }
      return;
    }

    // wood / scrap gathering loop
    const res: ResKey = u.job;
    const nodeKind = res === 'wood' ? 'tree' : 'wreck';
    if (u.state === 'return') {
      if (dist(u.x, u.y, HQ_CX, HQ_CY) < 2 || this.moveTo(u, HQ_CX, HQ_CY, dt, speed)) { this.deliver(u); u.state = 'idle'; }
      return;
    }
    if (u.state !== 'toNode' && u.state !== 'gather') {
      const node = this.findNode(u, nodeKind);
      if (!node) {
        u.state = 'idle';
        u.timer -= dt;
        if (u.timer <= 0) { u.timer = 8; this.toast(`No ${nodeKind === 'tree' ? 'trees' : 'wrecks'} found — explore with scavengers`, 'warn'); }
        return;
      }
      u.targetId = node.id;
      u.state = 'toNode';
    }
    const node = this.nodeById.get(u.targetId);
    if (!node || node.amount <= 0) { u.state = 'idle'; return; }
    if (u.state === 'toNode') {
      if (this.moveTo(u, node.tx + 0.5, node.ty + 0.5 + 0.55, dt, speed)) {
        u.state = 'gather';
        u.timer = GATHER[res].time;
      }
    } else {
      u.timer -= dt;
      if (u.timer <= 0) {
        const amt = Math.min(node.amount, GATHER[res].amount);
        node.amount -= amt;
        u.carry = amt;
        u.carryRes = res;
        if (node.amount <= 0) this.removeNode(node);
        u.state = 'return';
      }
    }
  }

  private removeNode(n: ResNode) {
    this.s.nodes = this.s.nodes.filter((x) => x !== n);
    this.nodeById.delete(n.id);
    this.nodeGrid[n.ty * MAP_W + n.tx] = 0;
    this.s.fx.push({ kind: 'dust', x: n.tx + 0.5, y: n.ty + 0.5, x2: 0, y2: 0, t: 0, life: 0.6 });
  }

  private findFarm(u: Unit): Building | null {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of this.s.buildings) {
      if (b.kind !== 'farm' || b.built < 1) continue;
      const used = this.s.units.filter((o) => o !== u && o.job === 'food' && o.targetId === b.id && (o.state === 'toFarm' || o.state === 'farming')).length;
      if (used >= FARM_SLOTS) continue;
      const d = dist(u.x, u.y, b.tx + 1, b.ty + 1);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private findNode(u: Unit, kind: 'tree' | 'wreck'): ResNode | null {
    let best: ResNode | null = null;
    let bd = Infinity;
    for (const n of this.s.nodes) {
      if (n.kind !== kind || n.amount <= 0 || !this.s.explored[n.ty * MAP_W + n.tx]) continue;
      const crowd = this.s.units.filter((o) => o !== u && o.targetId === n.id && (o.state === 'toNode' || o.state === 'gather')).length;
      const d = dist(HQ_CX, HQ_CY, n.tx, n.ty) + crowd * 4;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  private updateGuard(u: Unit, dt: number) {
    const def = UNITS[u.kind];
    u.cd -= dt;
    const z = this.nearestZombie(u.x, u.y, def.range);
    if (z) {
      u.aim = Math.atan2(z.y - u.y, z.x - u.x);
      if (u.cd <= 0) {
        u.cd = def.cooldown;
        this.hitZombie(z, def.dmg, u.x, u.y);
        this.sound(u.kind === 'merc' ? 'rifle' : 'shot');
      }
      return; // hold position while shooting
    }
    if (u.hp < u.maxHp && !this.zombieNear(u.x, u.y, 7)) u.hp = Math.min(u.maxHp, u.hp + 3 * dt);
    if (u.patrol) {
      const p = u.patrol;
      const [tx, ty] = p.toB ? [p.bx, p.by] : [p.ax, p.ay];
      if (this.moveTo(u, tx, ty, dt, def.speed * 0.7)) p.toB = !p.toB;
    } else if (u.post) {
      this.moveTo(u, u.post.x, u.post.y, dt, def.speed);
    }
  }

  // ------------------------------------------------------------------ zombies
  private updateZombies(dt: number) {
    const s = this.s;
    const zs = s.zombies;
    for (const z of zs) {
      if (z.hp <= 0) continue;
      const def = ZOMBIES[z.kind];
      z.flash = Math.max(0, z.flash - dt);
      z.cd -= dt;
      z.wobble += dt * (z.kind === 'runner' ? 9 : 4);
      let speed = def.speed;
      const under = this.buildingAt(Math.floor(z.x), Math.floor(z.y));
      if (under && under.kind === 'trap') speed *= TRAP.slow;

      // pick a human to chase
      z.think -= dt;
      if (z.think <= 0) {
        z.think = 0.4;
        z.chaseId = 0;
        let bd = ZOMBIE_AGGRO;
        for (const u of s.units) {
          if (u.state === 'sheltered') continue;
          const d = dist(z.x, z.y, u.x, u.y);
          if (d < bd) { bd = d; z.chaseId = u.id; }
        }
      }
      let tx: number, ty: number;
      const prey = z.chaseId ? s.units.find((u) => u.id === z.chaseId && u.state !== 'sheltered') : undefined;
      if (prey) {
        const d = dist(z.x, z.y, prey.x, prey.y);
        if (d < def.radius + 0.35) {
          if (z.cd <= 0) {
            z.cd = 1;
            prey.hp -= def.dmg;
            prey.hurt = 0.2;
            this.sound('hit');
          }
          continue;
        }
        tx = prey.x; ty = prey.y;
      } else {
        const cx = Math.floor(z.x), cy = Math.floor(z.y);
        const next = nextStep(this.flow, this.occ, this.byId, Math.max(0, Math.min(MAP_W - 1, cx)), Math.max(0, Math.min(MAP_H - 1, cy)));
        if (next < 0) continue;
        const nb = this.byId.get(this.occ[next]);
        if (isSolid(nb)) { this.attackBuilding(z, nb!); continue; }
        tx = (next % MAP_W) + 0.5;
        ty = ((next / MAP_W) | 0) + 0.5;
      }
      const d = dist(z.x, z.y, tx, ty);
      if (d < 0.001) continue;
      const nx = z.x + ((tx - z.x) / d) * speed * dt;
      const ny = z.y + ((ty - z.y) / d) * speed * dt;
      z.dir = Math.atan2(ty - z.y, tx - z.x);
      const blocker = this.buildingAt(Math.floor(nx), Math.floor(ny));
      const inside = this.buildingAt(Math.floor(z.x), Math.floor(z.y));
      if (isSolid(blocker) && blocker !== inside) { this.attackBuilding(z, blocker!); continue; }
      z.x = Math.max(0.2, Math.min(MAP_W - 0.2, nx));
      z.y = Math.max(0.2, Math.min(MAP_H - 0.2, ny));
    }
    // light separation so hordes spread out instead of stacking
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i];
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = ZOMBIES[a.kind].radius + ZOMBIES[b.kind].radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.25;
          const px = (dx / d) * push, py = (dy / d) * push;
          if (!isSolid(this.buildingAt(Math.floor(a.x - px), Math.floor(a.y - py)))) { a.x -= px; a.y -= py; }
          if (!isSolid(this.buildingAt(Math.floor(b.x + px), Math.floor(b.y + py)))) { b.x += px; b.y += py; }
        }
      }
    }
    s.zombies = zs.filter((z) => z.hp > 0);
  }

  private attackBuilding(z: Zombie, b: Building) {
    if (z.cd > 0) return;
    z.cd = 1;
    let dmg = ZOMBIES[z.kind].dmg;
    if (z.kind === 'brute' && (b.kind === 'wall' || b.kind === 'steelwall')) dmg *= 1.5;
    b.hp -= dmg;
    if (rand(this.s) < 0.15) this.sound('groan');
    if (b.hp <= 0 && b.kind !== 'hq') {
      this.s.fx.push({ kind: 'dust', x: b.tx + b.size / 2, y: b.ty + b.size / 2, x2: 0, y2: 0, t: 0, life: 0.8 });
      if (b.kind !== 'wall' && b.kind !== 'steelwall') this.toast(`🔥 ${BUILDINGS[b.kind].name} was destroyed`, 'bad');
      this.removeBuilding(b);
      this.emit({ type: 'shake', amount: 5 });
    } else if (b.hp <= 0) {
      b.hp = 0;
    } else if (b.kind === 'wall' || b.kind === 'steelwall') {
      this.flowSoft = true; // weakened walls become more attractive breach points
    }
  }

  // ------------------------------------------------------------------ misc
  private updateReveal() {
    for (const u of this.s.units) if (u.state !== 'sheltered') reveal(this.s, u.x, u.y, u.kind === 'worker' ? 3.5 : 5);
    for (const b of this.s.buildings) if (b.built >= 1 && b.kind !== 'wall') reveal(this.s, b.tx + b.size / 2, b.ty + b.size / 2, BUILDINGS[b.kind].sight);
  }

  private updateFx(dt: number) {
    for (const f of this.s.fx) f.t += dt;
    this.s.fx = this.s.fx.filter((f) => f.t < f.life);
  }

  private checkQuests() {
    const q = QUESTS[this.s.questIndex];
    if (q && q.done(this.s)) {
      this.s.questIndex++;
      this.emit({ type: 'caps', amount: q.reward, reason: `Goal complete: ${q.title}` });
      this.sound('coin');
    }
  }
}
