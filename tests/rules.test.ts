import { describe, expect, it } from 'vitest';
import { comboTier, levelFor, penalty, reward } from '../src/rules';
import { MAX_LEVEL } from '../src/questions';

describe('rules', () => {
  it('levels go up with correct answers and cap at the max', () => {
    expect(levelFor(1, 0)).toBe(1);
    expect(levelFor(1, 4)).toBe(2);
    expect(levelFor(8, 100)).toBe(MAX_LEVEL);
  });

  it('rewards scale with board size, streak, speed and golden questions', () => {
    const base = { boardSize: 100, elapsedMs: 0, streak: 1, answerMs: 5000, golden: false };
    const r0 = reward(base).cells;
    expect(r0).toBeGreaterThanOrEqual(3);
    expect(reward({ ...base, boardSize: 200 }).cells).toBeGreaterThan(r0);
    expect(reward({ ...base, streak: 5 }).cells).toBeGreaterThan(r0);
    expect(reward({ ...base, answerMs: 1000 }).fast).toBe(true);
    expect(reward({ ...base, golden: true }).cells).toBeGreaterThanOrEqual(r0 * 2 - 1);
    expect(reward({ ...base, elapsedMs: 60000 }).cells).toBeGreaterThan(r0);
  });

  it('combo tiers', () => {
    expect([1, 2, 3, 4, 5, 7, 8, 20].map(comboTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('penalty is small but never zero', () => {
    expect(penalty(20, 0)).toBe(1);
    expect(penalty(100, 0)).toBe(2);
    expect(penalty(100, 0)).toBeLessThan(reward({ boardSize: 100, elapsedMs: 0, streak: 1, answerMs: 9999, golden: false }).cells);
  });
});
