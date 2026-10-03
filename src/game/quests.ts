import type { GameState } from './state';

export interface Quest {
  title: string;
  hint: string;
  reward: number; // caps
  done: (s: GameState) => boolean;
}

const built = (s: GameState, kind: string, n = 1) =>
  s.buildings.filter((b) => b.kind === kind && b.built >= 1).length >= n;

export const QUESTS: Quest[] = [
  {
    title: 'Get to work',
    hint: 'Open 👷 Jobs and put 3 survivors on Wood or Scrap.',
    reward: 10,
    done: (s) => s.jobs.wood + s.jobs.scrap >= 3,
  },
  { title: 'A roof overhead', hint: 'Build a 🏠 House to grow your population.', reward: 10, done: (s) => built(s, 'house') },
  {
    title: 'Feed the camp',
    hint: 'Build a 🌽 Farm, then assign a Farmer in 👷 Jobs.',
    reward: 10,
    done: (s) => built(s, 'farm') && s.units.some((u) => u.state === 'farming'),
  },
  {
    title: 'Hold the line',
    hint: 'Build 12 wall segments. Drag your finger to paint walls.',
    reward: 15,
    done: (s) => s.stats.wallsBuilt >= 12,
  },
  { title: 'Eyes on the dark', hint: 'Build a 🗼 Watchtower.', reward: 15, done: (s) => built(s, 'tower') },
  { title: 'First night', hint: 'Survive until sunrise.', reward: 20, done: (s) => s.nightsSurvived >= 1 },
  {
    title: 'Scavenger run',
    hint: 'Tap a 🏚 Ruin and send a scavenger. Go in daylight!',
    reward: 15,
    done: (s) => s.stats.expeditions >= 1,
  },
  {
    title: 'Armed and ready',
    hint: 'Build ⛺ Barracks and train a Guard.',
    reward: 20,
    done: (s) => s.stats.guardsTrained >= 1,
  },
  {
    title: 'On patrol',
    hint: 'Tap a guard, choose Patrol, then tap two points.',
    reward: 15,
    done: (s) => s.stats.patrols >= 1,
  },
  { title: 'Five days strong', hint: 'Survive to Day 5. Night 5 is a Blood Moon.', reward: 30, done: (s) => s.day >= 5 },
  { title: 'A real settlement', hint: 'Reach 15 population.', reward: 30, done: (s) => s.units.length >= 15 },
  { title: 'Legend of the wastes', hint: 'Survive to Day 10.', reward: 50, done: (s) => s.day >= 10 },
];
