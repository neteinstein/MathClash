import { COLORS } from './colors';
import { AVATAR_COUNT } from './avatar';
import { DIFFICULTIES } from './questions';
import { ALL_PLAYERS, playerIds, type PlayerId } from './board';
import { isLargeScreen } from './ui/dom';

export interface PlayerSetup {
  color: number;
  avatar: number;
  difficulty: number;
}

export interface Settings {
  /** Setup of every seat, even the ones not playing right now. */
  players: Record<PlayerId, PlayerSetup>;
  /** How many play on big screens (2-4). Phones always play with 2. */
  playerCount: number;
  /** Round length in seconds, 0 = until someone conquers the whole board. */
  duration: number;
  sound: boolean;
}

export const DURATIONS = [60, 120, 180, 0];
export const PLAYER_COUNTS = [2, 3, 4];

const KEY = 'mathclash.settings.v1';

export const defaultSettings = (): Settings => ({
  players: {
    1: { color: 0, avatar: 0, difficulty: 2 },
    2: { color: 1, avatar: 3, difficulty: 2 },
    3: { color: 2, avatar: 4, difficulty: 2 },
    4: { color: 3, avatar: 1, difficulty: 2 },
  },
  playerCount: 2,
  duration: 120,
  sound: true,
});

/** How many play right now: the chosen number on a tablet, always 2 on a phone. */
export const activePlayerCount = (s: Settings): number => (isLargeScreen() ? s.playerCount : 2);

const inRange = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max;

/**
 * Makes sure the players taking part all have different colours: anyone
 * clashing with an earlier player gets the first free colour.
 */
export function fixColors(s: Settings, count: number): void {
  const used = new Set<number>();
  for (const p of playerIds(count)) {
    const setup = s.players[p];
    if (used.has(setup.color)) setup.color = COLORS.findIndex((_, i) => !used.has(i));
    used.add(setup.color);
  }
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return s;
    for (const p of ALL_PLAYERS) {
      const rp = raw.players?.[p];
      if (!rp) continue;
      if (inRange(rp.color, COLORS.length)) s.players[p].color = rp.color;
      if (inRange(rp.avatar, AVATAR_COUNT)) s.players[p].avatar = rp.avatar;
      if (inRange(rp.difficulty, DIFFICULTIES.length)) s.players[p].difficulty = rp.difficulty;
    }
    if (PLAYER_COUNTS.includes(raw.playerCount)) s.playerCount = raw.playerCount;
    if (DURATIONS.includes(raw.duration)) s.duration = raw.duration;
    if (typeof raw.sound === 'boolean') s.sound = raw.sound;
  } catch {
    /* storage unavailable or corrupted: use defaults */
  }
  fixColors(s, s.playerCount);
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. */
  }
}
