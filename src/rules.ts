/**
 * Game balance in one place. Rewards are expressed as a percentage of the
 * board so the game feels the same on a small phone and a big tablet.
 */

import { stageCount } from './questions';

/** Correct answers needed to go up one stage (bigger numbers, same operations). */
export const CORRECT_PER_STAGE = 4;
/** Answering faster than this (ms) gives a speed bonus. */
export const FAST_MS = 2500;
/** Input lock after a wrong answer (ms), so mashing buttons does not pay off. */
export const WRONG_LOCK_MS = 1100;

export function stageFor(difficulty: number, correct: number): number {
  return Math.min(stageCount(difficulty), 1 + Math.floor(correct / CORRECT_PER_STAGE));
}

/** Every this many correct answers in a row sends a 😈 to the opponent. */
export const DEVIL_STREAK = 10;
/** How many stages above the victim's current one the devil's question is. */
export const DEVIL_STAGE_JUMP = 3;

export const isDevilStreak = (streak: number): boolean => streak > 0 && streak % DEVIL_STREAK === 0;

/** The devil's question: same operations as the victim's level, much bigger numbers. */
export function devilStage(difficulty: number, stage: number): number {
  return Math.min(stageCount(difficulty), stage + DEVIL_STAGE_JUMP);
}

export interface RewardInput {
  boardSize: number;
  elapsedMs: number;
  /** Streak including this answer. */
  streak: number;
  answerMs: number;
  golden: boolean;
  /** Beating the devil's question is worth double too. */
  devil?: boolean;
}

export interface Reward {
  cells: number;
  fast: boolean;
  combo: number;
}

export function comboTier(streak: number): number {
  if (streak >= 8) return 3;
  if (streak >= 5) return 2;
  if (streak >= 3) return 1;
  return 0;
}

export function reward({ boardSize, elapsedMs, streak, answerMs, golden, devil = false }: RewardInput): Reward {
  const pct = boardSize / 100;
  const ramp = Math.min(5, Math.floor(elapsedMs / 20000)); // game speeds up over time
  const combo = comboTier(streak);
  const fast = answerMs < FAST_MS;
  let percent = 3.5 + ramp + combo * 1.5 + (fast ? 1 : 0);
  if (golden || devil) percent *= 2;
  return { cells: Math.max(1, Math.round(percent * pct)), fast, combo };
}

export function penalty(boardSize: number, elapsedMs: number): number {
  const pct = boardSize / 100;
  return Math.max(1, Math.round((2 + Math.min(2, Math.floor(elapsedMs / 60000))) * pct));
}

export const COMBO_LABELS = ['', 'COMBO!', 'IMPARÁVEL!', 'LENDÁRIO!'];
