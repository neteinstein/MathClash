import { describe, expect, it } from 'vitest';
import { Board } from '../src/board';

const seq = (vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe('Board', () => {
  it('starts with a small blob for each player at opposite ends', () => {
    const b = new Board(9, 12);
    expect(b.count(1)).toBe(4);
    expect(b.count(2)).toBe(4);
    expect(b.count(0)).toBe(9 * 12 - 8);
    expect(b.cells[b.home[1]]).toBe(1);
    expect(b.cells[b.home[2]]).toBe(2);
    expect(b.xy(b.home[1])).toEqual([4, 11]);
    expect(b.xy(b.home[2])).toEqual([4, 0]);
  });

  it('expand paints only cells adjacent to the territory', () => {
    const b = new Board(9, 12);
    const changes = b.expand(1, 6, seq([0.3, 0.7, 0.1]));
    expect(changes).toHaveLength(6);
    expect(b.count(1)).toBe(10);
    for (const c of changes) {
      expect(c.to).toBe(1);
      expect(c.from).toBe(0);
      expect(b.neighbors(c.idx)).toContain(c.src);
    }
  });

  it('can steal enemy cells but protects the enemy home until it is the last cell', () => {
    const b = new Board(5, 4);
    // Fill everything with player 1 except player 2's home and one neighbour.
    b.cells.fill(1);
    b.cells[b.home[2]] = 2;
    const extra = b.home[2] + 1;
    b.cells[extra] = 2;
    const first = b.expand(1, 1);
    expect(first[0].idx).toBe(extra);
    expect(b.count(2)).toBe(1);
    const ko = b.expand(1, 5);
    expect(ko).toHaveLength(1);
    expect(ko[0].idx).toBe(b.home[2]);
    expect(b.count(2)).toBe(0);
  });

  it('shrink turns exposed cells neutral and never removes the home', () => {
    const b = new Board(9, 12);
    const changes = b.shrink(1, 10);
    expect(changes).toHaveLength(3);
    expect(b.count(1)).toBe(1);
    expect(b.cells[b.home[1]]).toBe(1);
    for (const c of changes) expect(c.to).toBe(0);
  });

  it('flood paints the whole board in waves', () => {
    const b = new Board(7, 9);
    const changes = b.flood(2);
    expect(b.count(2)).toBe(7 * 9);
    const orders = changes.map((c) => c.order);
    expect(Math.min(...orders)).toBe(1);
    expect([...orders].sort((a, c) => a - c)).toEqual(orders);
  });
});
