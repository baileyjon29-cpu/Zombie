import type { GameState } from '../game/state';

/**
 * Player profile persists across runs: premium currency, purchases, records.
 * The run itself (GameState) is saved separately so starting a new game never
 * touches what the player paid for.
 */
export interface Profile {
  caps: number;
  owned: string[];
  processedTx: string[];
  best: { days: number; kills: number };
  sound: boolean;
  haptics: boolean;
  seenIntro: boolean;
}

const PROFILE_KEY = 'lasthaven.profile.v1';
const SAVE_KEY = 'lasthaven.save.v1';

const DEFAULT_PROFILE: Profile = {
  caps: 50, // a welcome gift so new players can try the powers
  owned: [],
  processedTx: [],
  best: { days: 0, kills: 0 },
  sound: true,
  haptics: true,
  seenIntro: false,
};

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage full or unavailable: the game keeps running */ }
}

export function loadProfile(): Profile {
  const raw = read(PROFILE_KEY);
  if (!raw) return structuredClone(DEFAULT_PROFILE);
  try {
    return { ...structuredClone(DEFAULT_PROFILE), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
}

export function saveProfile(p: Profile) {
  // keep the processed-transaction ledger bounded
  if (p.processedTx.length > 500) p.processedTx = p.processedTx.slice(-500);
  write(PROFILE_KEY, JSON.stringify(p));
}

export function loadRun(): GameState | null {
  const raw = read(SAVE_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as GameState;
    return s.version === 1 && !s.gameOver ? s : null;
  } catch {
    return null;
  }
}

export function saveRun(s: GameState | null) {
  if (!s || s.gameOver) { write(SAVE_KEY, null); return; }
  write(SAVE_KEY, JSON.stringify({ ...s, fx: s.fx.filter((f) => f.kind === 'blood') }));
}
