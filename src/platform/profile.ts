import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
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
  /** goal rewards already paid out (each goal pays once per player, not once per run) */
  claimedQuests: number[];
  music: boolean;
  wins: number;
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
  claimedQuests: [],
  music: true,
  wins: 0,
};

/*
 * Storage: on iOS the source of truth is native UserDefaults (via Capacitor
 * Preferences), which iOS never purges, unlike WebView localStorage. That
 * matters because the profile holds purchased Caps. localStorage is kept as a
 * synchronous mirror and is the only store in a web browser.
 */
const cache = new Map<string, string | null>();
const native = Capacitor.isNativePlatform();

function local(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Load persisted data before the game boots. Safe to call in any environment. */
export async function initStorage(): Promise<void> {
  for (const key of [PROFILE_KEY, SAVE_KEY]) {
    let value = local(key);
    if (native) {
      try {
        const { value: nv } = await Preferences.get({ key });
        if (nv !== null) value = nv;
        else if (value !== null) await Preferences.set({ key, value }); // migrate older installs
      } catch { /* fall back to localStorage */ }
    }
    cache.set(key, value);
  }
}

function read(key: string): string | null {
  return cache.has(key) ? cache.get(key)! : local(key);
}

function write(key: string, value: string | null) {
  cache.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage full or unavailable: native copy still persists */ }
  if (native) {
    (value === null ? Preferences.remove({ key }) : Preferences.set({ key, value })).catch(() => {});
  }
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
