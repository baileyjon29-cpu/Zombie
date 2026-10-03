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

export interface GunStats { range: number; dmg: number; cooldown: number }
/** Watchtower stats per level (index 0 = level 1). */
export const TOWER_LEVELS: GunStats[] = [
  { range: 6.5, dmg: 14, cooldown: 0.9 },
  { range: 7.5, dmg: 22, cooldown: 0.8 },
  { range: 8.5, dmg: 20, cooldown: 0.4 },
];
export const TOWER = TOWER_LEVELS[0];
/** HQ per level: max HP, bonus population, rooftop sniper. */
export const HQ_LEVELS: { hp: number; pop: number; gun: GunStats | null }[] = [
  { hp: 1500, pop: 0, gun: null },
  { hp: 2500, pop: 4, gun: { range: 6, dmg: 14, cooldown: 1 } },
  { hp: 4000, pop: 8, gun: { range: 7.5, dmg: 24, cooldown: 0.75 } },
];
export const HOUSE_POP = [4, 7];

export interface UpgradeDef { cost: Cost; unlockDay: number; name: string; desc: string }
/** Upgrade path per building. Entry i upgrades from level i+1 to level i+2. */
export const UPGRADES: Partial<Record<BuildingKind, UpgradeDef[]>> = {
  tower: [
    { cost: { wood: 40, scrap: 60 }, unlockDay: 2, name: 'Rifle Nest', desc: 'Longer range, heavier rounds' },
    { cost: { wood: 60, scrap: 120 }, unlockDay: 5, name: 'Machine Gun Nest', desc: 'Rapid fire, longest range' },
  ],
  hq: [
    { cost: { wood: 150, scrap: 100 }, unlockDay: 3, name: 'Fortified HQ', desc: '+1000 HP, +4 population, rooftop sniper' },
    { cost: { wood: 250, scrap: 250 }, unlockDay: 7, name: 'Stronghold', desc: '+1500 HP, +4 population, deadlier sniper' },
  ],
  house: [{ cost: { wood: 50, scrap: 30 }, unlockDay: 2, name: 'Bunkhouse', desc: 'Room for 7 instead of 4' }],
  farm: [{ cost: { wood: 40, scrap: 20 }, unlockDay: 2, name: 'Irrigated Farm', desc: 'Room for a 3rd farmer' }],
  wall: [{ cost: { scrap: 10 }, unlockDay: 3, name: 'Steel Plating', desc: 'Reinforce into a Steel Wall' }],
};
export const TRAP = { dps: 18, slow: 0.5, wear: 5 };

export type UnitKind = 'worker' | 'guard' | 'merc';
export const UNITS: Record<UnitKind, { hp: number; speed: number; range: number; dmg: number; cooldown: number }> = {
  worker: { hp: 50, speed: 2.3, range: 0, dmg: 0, cooldown: 0 },
  guard: { hp: 110, speed: 2.0, range: 5, dmg: 11, cooldown: 0.8 },
  merc: { hp: 220, speed: 2.3, range: 6, dmg: 22, cooldown: 0.55 },
};

export const GUARD_TRAIN = { cost: { food: 20, scrap: 15 } as Cost, time: 8 };

export type ZombieKind = 'walker' | 'runner' | 'brute' | 'spitter' | 'abomination';
export const ZOMBIES: Record<ZombieKind, { name: string; hp: number; speed: number; dmg: number; radius: number; bounty: number; range: number; wallMult: number }> = {
  walker: { name: 'Walker', hp: 40, speed: 0.8, dmg: 9, radius: 0.32, bounty: 0, range: 0, wallMult: 1 },
  runner: { name: 'Runner', hp: 26, speed: 1.9, dmg: 6, radius: 0.27, bounty: 0, range: 0, wallMult: 1 },
  brute: { name: 'Brute', hp: 240, speed: 0.55, dmg: 30, radius: 0.48, bounty: 1, range: 0, wallMult: 1.5 },
  /** spits acid at walls and people from a distance */
  spitter: { name: 'Spitter', hp: 34, speed: 0.85, dmg: 13, radius: 0.3, bounty: 0, range: 3.2, wallMult: 1 },
  /** Blood Moon boss */
  abomination: { name: 'Abomination', hp: 1100, speed: 0.45, dmg: 70, radius: 0.8, bounty: 10, range: 0, wallMult: 2 },
};
export const ZOMBIE_AGGRO = 5; // tiles: chase humans within this range

export const GATHER = {
  wood: { time: 3, amount: 5, nodeAmount: 40 },
  scrap: { time: 4, amount: 4, nodeAmount: 32 },
  food: { time: 3, amount: 1 },
};

export const RUIN = { searches: 3, searchTime: 6 };

/** Survive this many nights and the rescue convoy arrives (the game continues in endless mode). */
export const RESCUE_NIGHT = 20;
/** Daytime event fires this many seconds after dawn, from Day 2 on. */
export const EVENT_AT = 28;

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
  const spitChance = day >= 6 ? Math.min(0.06 + (day - 6) * 0.01, 0.15) : 0;
  if (r > 1 - spitChance) return 'spitter';
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
