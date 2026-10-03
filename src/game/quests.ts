import type { GameState } from './state';

export interface Quest {
  title: string;
  hint: string;
  reward: number; // caps
  done: (s: GameState) => boolean;
  /** which HUD control to highlight: a tray tab plus a selector inside that tray */
  focus?: (s: GameState) => { tab: 'build' | 'jobs' | 'powers'; sel: string } | null;
}

const buildFocus = (kind: string) => () => ({ tab: 'build' as const, sel: `[data-a=build][data-v=${kind}]` });

const built = (s: GameState, kind: string, n = 1) =>
  s.buildings.filter((b) => b.kind === kind && b.built >= 1).length >= n;

export const QUESTS: Quest[] = [
  {
    title: 'Get to work',
    hint: 'Open Jobs and put 4 survivors on Wood or Scrap.',
    reward: 10,
    done: (s) => s.jobs.wood + s.jobs.scrap >= 4,
    focus: () => ({ tab: 'jobs', sel: '[data-a=job][data-v="wood:1"]' }),
  },
  { title: 'A roof overhead', hint: 'Build a 🏠 House to grow your population.', reward: 10, done: (s) => built(s, 'house'), focus: buildFocus('house') },
  {
    title: 'Feed the camp',
    hint: 'Build a 🌽 Farm, then assign a Farmer in 👷 Jobs.',
    reward: 10,
    done: (s) => built(s, 'farm') && s.units.some((u) => u.state === 'farming'),
    focus: (s) => (s.buildings.some((b) => b.kind === 'farm') ? { tab: 'jobs', sel: '[data-a=job][data-v="food:1"]' } : buildFocus('farm')()),
  },
  {
    title: 'Hold the line',
    hint: 'Build 12 wall segments. Drag your finger to paint walls.',
    reward: 15,
    done: (s) => s.stats.wallsBuilt >= 12,
    focus: buildFocus('wall'),
  },
  { title: 'Eyes on the dark', hint: 'Build a 🗼 Watchtower.', reward: 15, done: (s) => built(s, 'tower'), focus: buildFocus('tower') },
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
    focus: (s) => (s.buildings.some((b) => b.kind === 'barracks') ? null : buildFocus('barracks')()),
  },
  {
    title: 'On patrol',
    hint: 'Tap a guard, choose Patrol, then tap where the route should end.',
    reward: 15,
    done: (s) => s.stats.patrols >= 1,
  },
  {
    title: 'Bigger guns',
    hint: 'Tap a Watchtower and upgrade it to a Rifle Nest.',
    reward: 20,
    done: (s) => (s.stats.upgrades ?? 0) >= 1,
  },
  { title: 'Five days strong', hint: 'Survive to Day 5. Night 5 is a Blood Moon.', reward: 30, done: (s) => s.day >= 5 },
  { title: 'A real settlement', hint: 'Reach 15 population.', reward: 30, done: (s) => s.units.length >= 15 },
  { title: 'Legend of the wastes', hint: 'Survive to Day 10.', reward: 50, done: (s) => s.day >= 10 },
  { title: 'Fortress', hint: 'Upgrade your HQ to a Stronghold.', reward: 40, done: (s) => s.buildings.some((b) => b.kind === 'hq' && b.level >= 3) },
  { title: 'Hold out', hint: 'Survive to Day 15. The radio says a convoy is coming.', reward: 50, done: (s) => s.day >= 15 },
  { title: 'Rescue', hint: 'Survive 20 nights until the rescue convoy arrives.', reward: 60, done: (s) => !!s.victory },
];
