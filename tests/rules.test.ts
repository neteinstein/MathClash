import { describe, expect, it } from 'vitest';
import { DEVIL_STREAK, comboTier, devilStage, isDevilStreak, penalty, reward, stageFor } from '../src/rules';
import { stageCount } from '../src/questions';

describe('rules', () => {
  it('stages go up every 4 correct answers and stop at the last one', () => {
    expect(stageFor(0, 0)).toBe(1);
    expect(stageFor(0, 3)).toBe(1);
    expect(stageFor(0, 4)).toBe(2);
    expect(stageFor(0, 1000)).toBe(stageCount(0));
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

  it('a devil is sent every 10 correct answers in a row', () => {
    expect(DEVIL_STREAK).toBe(10);
    expect([0, 1, 9, 10, 11, 19, 20, 30].map(isDevilStreak)).toEqual([false, false, false, true, false, false, true, true]);
  });

  it("the devil's question is harder but never past the victim's last stage", () => {
    expect(devilStage(0, 1)).toBeGreaterThan(1);
    expect(devilStage(0, stageCount(0))).toBe(stageCount(0));
    for (let d = 0; d < 5; d++) expect(devilStage(d, 1)).toBeLessThanOrEqual(stageCount(d));
  });

  it('beating the devil is worth double', () => {
    const base = { boardSize: 100, elapsedMs: 0, streak: 1, answerMs: 5000, golden: false };
    expect(reward({ ...base, devil: true }).cells).toBeGreaterThanOrEqual(reward(base).cells * 2 - 1);
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
