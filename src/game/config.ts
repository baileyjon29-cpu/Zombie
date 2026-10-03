// All gameplay tuning lives here so balance changes never touch logic.

export const TILE = 32; // world pixels per tile
export const MAP_W = 64;
export const MAP_H = 64;

export const DAY_LEN = 110; // seconds of daylight
export const NIGHT_LEN = 55; // seconds of night
export const DUSK_WARNING = 15; // seconds before nightfall the horde is announced

export type ResKey = 'wood' | 'scrap' | 'food';
export type Resources = Record<ResKey, number>;
export type Cost = Partial<Resources>;

export const RES_ICON: Record<ResKey, string> = { wood: '🪵', scrap: '⚙️', food: '🥫' };

export type BuildingKind =
  | 'hq'
  | 'house'
  | 'farm'
  | 'wall'
  | 'steelwall'
  | 'tower'
  | 'barracks'
  | 'trap';

export interface BuildingDef {
  name: string;
  icon: string;
  desc: string;
  size: number;
  hp: number;
  cost: Cost;
  buildTime: number;
  unlockDay: number;
  /** zombies cannot walk through it */
  solid: boolean;
  /** zombies actively hunt it (walls are obstacles, not targets) */
  target: boolean;
  light: number; // light radius in tiles at night
  sight: number; // fog-of-war reveal radius in tiles
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hq: {
    name: 'Haven HQ', icon: '🏚️', desc: 'Your shelter. Survivors hide here at night. If it falls, it is over.',
    size: 3, hp: 1500, cost: {}, buildTime: 0, unlockDay: 99, solid: true, target: true, light: 7, sight: 11,
  },
  house: {
    name: 'House', icon: '🏠', desc: '+4 population. More hands, more mouths.',
    size: 2, hp: 260, cost: { wood: 40, scrap: 10 }, buildTime: 12, unlockDay: 1, solid: true, target: true, light: 2.5, sight: 4,
  },
  farm: {
    name: 'Farm', icon: '🌽', desc: 'Two farmers grow food here during the day.',
    size: 2, hp: 160, cost: { wood: 30 }, buildTime: 10, unlockDay: 1, solid: true, target: true, light: 0, sight: 3,
  },
  wall: {
    name: 'Wood Wall', icon: '🪵', desc: 'Cheap barricade. Zombies must chew through. Drag to paint a line.',
    size: 1, hp: 260, cost: { wood: 6 }, buildTime: 1.5, unlockDay: 1, solid: true, target: false, light: 0, sight: 2,
  },
  steelwall: {
    name: 'Steel Wall', icon: '🧱', desc: 'Scrap-plated wall with 2.5× the toughness.',
    size: 1, hp: 650, cost: { wood: 4, scrap: 10 }, buildTime: 3, unlockDay: 3, solid: true, target: false, light: 0, sight: 2,
  },
  tower: {
    name: 'Watchtower', icon: '🗼', desc: 'Militia rifle nest. Shoots zombies in range and lights the night.',
    size: 1, hp: 380, cost: { wood: 30, scrap: 30 }, buildTime: 15, unlockDay: 1, solid: true, target: true, light: 4, sight: 7,
  },
  barracks: {
    name: 'Barracks', icon: '⛺', desc: 'Train survivors into armed guards.',
    size: 2, hp: 420, cost: { wood: 60, scrap: 40 }, buildTime: 20, unlockDay: 1, solid: true, target: true, light: 2, sight: 4,
  },
  trap: {
    name: 'Spike Trap', icon: '📍', desc: 'Zombies walking over it are shredded and slowed.',
    size: 1, hp: 140, cost: { scrap: 12 }, buildTime: 2, unlockDay: 2, solid: false, target: false, light: 0, sight: 1,
  },
};

export const BUILD_MENU: BuildingKind[] = ['wall', 'steelwall', 'tower', 'house', 'farm', 'barracks', 'trap'];

export const POP_HQ = 6;
export const POP_HOUSE = 4;
export const FARM_SLOTS = 2;
export const FOOD_PER_PERSON_DAWN = 3;

export const TOWER = { range: 6.5, dmg: 14, cooldown: 0.9 };
export const TRAP = { dps: 18, slow: 0.5, wear: 5 };

export type UnitKind = 'worker' | 'guard' | 'merc';
export const UNITS: Record<UnitKind, { hp: number; speed: number; range: number; dmg: number; cooldown: number }> = {
  worker: { hp: 50, speed: 2.3, range: 0, dmg: 0, cooldown: 0 },
  guard: { hp: 110, speed: 2.0, range: 5, dmg: 11, cooldown: 0.8 },
  merc: { hp: 220, speed: 2.3, range: 6, dmg: 22, cooldown: 0.55 },
};

export const GUARD_TRAIN = { cost: { food: 20, scrap: 15 } as Cost, time: 8 };

export type ZombieKind = 'walker' | 'runner' | 'brute';
export const ZOMBIES: Record<ZombieKind, { hp: number; speed: number; dmg: number; radius: number; bounty: number }> = {
  walker: { hp: 40, speed: 0.8, dmg: 9, radius: 0.32, bounty: 0 },
  runner: { hp: 26, speed: 1.9, dmg: 6, radius: 0.27, bounty: 0 },
  brute: { hp: 240, speed: 0.55, dmg: 30, radius: 0.48, bounty: 1 },
};
export const ZOMBIE_AGGRO = 5; // tiles: chase humans within this range

export const GATHER = {
  wood: { time: 3, amount: 5, nodeAmount: 40 },
  scrap: { time: 4, amount: 4, nodeAmount: 32 },
  food: { time: 3, amount: 1 },
};

export const RUIN = { searches: 3, searchTime: 6 };

/** Premium currency is "Caps" — bottle caps, the currency of the wasteland. */
export const CAPS = {
  supplyDrop: 30,
  airstrike: 40,
  mercenary: 35,
  revive: 60,
  perBuildSecond: 0.2, // finish-now cost: 1 cap per 5 seconds remaining (min 1)
  nightReward: (day: number) => 5 + Math.floor(day / 2),
};

export const SUPPLY_DROP: Resources = { wood: 120, scrap: 90, food: 60 };
export const AIRSTRIKE = { radius: 3.2, dmg: 400 };

export const START = {
  res: { wood: 70, scrap: 30, food: 45 } as Resources,
  workers: 4,
  jobs: { wood: 2, scrap: 1, food: 0 },
};

/** How many zombies the horde brings on a given night. */
export function hordeSize(day: number): number {
  const base = 5 + day * 3.5 + Math.pow(day, 1.45);
  return Math.floor(day % 5 === 0 ? base * 1.6 : base);
}

export function hordeMix(day: number, r: number): ZombieKind {
  const bruteChance = day >= 4 ? Math.min(0.06 + (day - 4) * 0.015, 0.2) : 0;
  const runnerChance = day >= 2 ? Math.min(0.15 + (day - 2) * 0.03, 0.4) : 0;
  if (r < bruteChance) return 'brute';
  if (r < bruteChance + runnerChance) return 'runner';
  return 'walker';
}

export function canAfford(res: Resources, cost: Cost, mult = 1): boolean {
  return (Object.keys(cost) as ResKey[]).every((k) => res[k] >= (cost[k] ?? 0) * mult);
}

export function pay(res: Resources, cost: Cost, mult = 1): void {
  for (const k of Object.keys(cost) as ResKey[]) res[k] -= (cost[k] ?? 0) * mult;
}

export function costLabel(cost: Cost): string {
  return (Object.keys(cost) as ResKey[]).map((k) => `${RES_ICON[k]}${cost[k]}`).join(' ');
}
