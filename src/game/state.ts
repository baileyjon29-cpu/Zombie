import type { BuildingKind, ResKey, Resources, UnitKind, ZombieKind } from './config';

export type Job = 'idle' | 'wood' | 'scrap' | 'food';
export type WorkJob = Exclude<Job, 'idle'>;

export type UnitState =
  | 'idle'
  | 'toNode'
  | 'gather'
  | 'return'
  | 'toFarm'
  | 'farming'
  | 'shelter'
  | 'sheltered'
  | 'expedition'
  | 'searching'
  | 'home';

export interface Building {
  id: number;
  kind: BuildingKind;
  tx: number;
  ty: number;
  size: number;
  hp: number;
  maxHp: number;
  /** construction progress 0..1 */
  built: number;
  cd: number;
  aim: number;
  trainQueue: number;
  trainTimer: number;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  x: number; // tile units (float)
  y: number;
  hp: number;
  maxHp: number;
  job: Job;
  state: UnitState;
  targetId: number;
  carryRes: ResKey | null;
  carry: number;
  timer: number;
  cd: number;
  aim: number;
  post: { x: number; y: number } | null;
  patrol: { ax: number; ay: number; bx: number; by: number; toB: boolean } | null;
  loot: (Resources & { survivor: boolean; caps: number }) | null;
  hurt: number;
}

export interface Zombie {
  id: number;
  kind: ZombieKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cd: number;
  flash: number;
  wobble: number;
  chaseId: number;
  think: number;
  dir: number;
}

export type NodeKind = 'tree' | 'wreck' | 'ruin';

export interface ResNode {
  id: number;
  kind: NodeKind;
  tx: number;
  ty: number;
  amount: number;
  max: number;
  variant: number;
}

export interface Fx {
  kind: 'tracer' | 'blood' | 'text' | 'boom' | 'dust' | 'drop';
  x: number;
  y: number;
  x2: number;
  y2: number;
  t: number;
  life: number;
  text?: string;
  color?: string;
}

export interface SpawnOrder {
  kind: ZombieKind;
  at: number; // seconds into the night
  edge: number; // 0=N 1=E 2=S 3=W
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  time: number;
  day: number;
  phaseTime: number;
  isNight: boolean;
  warned: boolean;
  res: Resources;
  jobs: Record<WorkJob, number>;
  buildings: Building[];
  units: Unit[];
  zombies: Zombie[];
  nodes: ResNode[];
  fx: Fx[];
  nextId: number;
  kills: number;
  nightsSurvived: number;
  edges: number[];
  spawns: SpawnOrder[];
  wanderTimer: number;
  arrivalTimer: number;
  terrain: number[];
  explored: number[];
  gameOver: boolean;
  questIndex: number;
  stats: { wallsBuilt: number; expeditions: number; patrols: number; guardsTrained: number };
}

export const EDGE_NAMES = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
