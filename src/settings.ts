import { COLORS } from './colors';
import { AVATAR_COUNT } from './avatar';
import { DIFFICULTIES } from './questions';
import type { PlayerId } from './board';

export interface PlayerSetup {
  color: number;
  avatar: number;
  difficulty: number;
}

export interface Settings {
  players: Record<PlayerId, PlayerSetup>;
  /** Round length in seconds, 0 = until someone conquers the whole board. */
  duration: number;
  sound: boolean;
}

export const DURATIONS = [60, 120, 180, 0];

const KEY = 'mathclash.settings.v1';

export const defaultSettings = (): Settings => ({
  players: {
    1: { color: 0, avatar: 0, difficulty: 2 },
    2: { color: 1, avatar: 3, difficulty: 2 },
  },
  duration: 120,
  sound: true,
});

const inRange = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max;

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return s;
    for (const p of [1, 2] as PlayerId[]) {
      const rp = raw.players?.[p];
      if (!rp) continue;
      if (inRange(rp.color, COLORS.length)) s.players[p].color = rp.color;
      if (inRange(rp.avatar, AVATAR_COUNT)) s.players[p].avatar = rp.avatar;
      if (inRange(rp.difficulty, DIFFICULTIES.length)) s.players[p].difficulty = rp.difficulty;
    }
    if (s.players[1].color === s.players[2].color) s.players[2].color = (s.players[1].color + 1) % COLORS.length;
    if (DURATIONS.includes(raw.duration)) s.duration = raw.duration;
    if (typeof raw.sound === 'boolean') s.sound = raw.sound;
  } catch {
    /* storage unavailable or corrupted: use defaults */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. */
  }
}
