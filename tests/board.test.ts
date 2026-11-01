import { describe, expect, it } from 'vitest';
import { Board, playerIds, triCell, triEdge } from '../src/board';

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

describe('Board with 3-4 players', () => {
  it('puts one player on each side, each with a small blob around their avatar', () => {
    const b = new Board(9, 13, [1, 2, 3, 4]);
    expect(b.xy(b.home[1])).toEqual([4, 12]);
    expect(b.xy(b.home[2])).toEqual([4, 0]);
    expect(b.xy(b.home[3])).toEqual([0, 6]);
    expect(b.xy(b.home[4])).toEqual([8, 6]);
    for (const p of [1, 2, 3, 4] as const) {
      expect(b.count(p)).toBe(4);
      expect(b.cells[b.home[p]]).toBe(p);
    }
    expect(b.count(0)).toBe(9 * 13 - 16);
  });

  it('a three-player board has no player 4', () => {
    const b = new Board(9, 13, [1, 2, 3]);
    expect(b.home[4]).toBe(-1);
    expect(b.count(4)).toBe(0);
    expect(b.alive()).toEqual([1, 2, 3]);
  });

  it('side players grow towards the middle', () => {
    const b = new Board(9, 13, [1, 2, 3, 4]);
    const left = b.expand(3, 8, () => 0.5);
    const right = b.expand(4, 8, () => 0.5);
    const avgX = (cs: { idx: number }[]) => cs.reduce((s, c) => s + b.xy(c.idx)[0], 0) / cs.length;
    expect(avgX(left)).toBeGreaterThan(1);
    expect(avgX(right)).toBeLessThan(7);
  });

  it('can steal from any opponent, protecting each home until it is their last cell', () => {
    const b = new Board(9, 9, [1, 2, 3, 4]);
    b.cells.fill(1);
    for (const p of [2, 3, 4] as const) b.cells[b.home[p]] = p;
    const extra = b.home[3] + b.w; // a second cell for player 3, below its home
    b.cells[extra] = 3;
    // 2 and 4 are down to their home: those can be taken; 3's home is protected while it has two cells.
    const changes = b.expand(1, 2, () => 0.5);
    expect(changes.map((c) => c.from).sort()).toEqual([2, 4]);
    expect(b.cells[b.home[3]]).toBe(3);
    expect(b.alive()).toEqual([1, 3]);
    // Knocking out one opponent does not stop the move while others are left.
    const last = b.expand(1, 5, () => 0.5);
    expect(last.map((c) => c.idx)).toEqual([extra, b.home[3]]);
    expect(b.alive()).toEqual([1]);
  });

  it('flood paints everything from the winner outwards', () => {
    const b = new Board(9, 11, [1, 2, 3, 4]);
    b.flood(3);
    expect(b.count(3)).toBe(9 * 11);
  });

  it('playerIds picks the first players, between 2 and 4', () => {
    expect(playerIds(2)).toEqual([1, 2]);
    expect(playerIds(3)).toEqual([1, 2, 3]);
    expect(playerIds(4)).toEqual([1, 2, 3, 4]);
    expect(playerIds(9)).toEqual([1, 2, 3, 4]);
    expect(playerIds(0)).toEqual([1, 2]);
  });
});

describe('triangle board (3 players)', () => {
  const N = 13;
  const shared = (a: number[][], b: number[][]) =>
    a.filter((p) => b.some((q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9)).length;

  it('is cut into n² small triangles, each touching its neighbours along a whole side', () => {
    const b = Board.triangle(N);
    expect(b.size).toBe(N * N);
    const degrees = [0, 0, 0, 0];
    for (let i = 0; i < b.size; i++) {
      degrees[b.neighbors(i).length]++;
      for (const j of b.neighbors(i)) {
        expect(b.neighbors(j)).toContain(i);
        expect(shared(triCell(N, i).pts, triCell(N, j).pts)).toBe(2);
      }
    }
    // 3 corners, the rest of the outline, and everything inside.
    expect(degrees).toEqual([0, 3, 3 * N - 6, N * N - 3 * N + 3]);
  });

  it('puts each player in the middle of their own side, with the same small strip', () => {
    const b = Board.triangle(N);
    const dist = (a: number[], c: number[]) => Math.hypot(a[0] - c[0], a[1] - c[1]);
    for (const p of [1, 2, 3] as const) {
      const { mid } = triEdge(N, p);
      expect(dist(triCell(N, b.home[p]).c, mid)).toBeCloseTo(Math.sqrt(3) / 6); // the triangle sitting on the side
      expect(b.count(p)).toBe(5);
      expect(b.cells[b.home[p]]).toBe(p);
    }
    expect(b.home[4]).toBe(-1);
    expect(() => Board.triangle(N, [1, 2, 3, 4])).toThrow();
  });

  it('players grow away from their side, towards the middle', () => {
    for (const p of [1, 2, 3] as const) {
      const b = Board.triangle(N);
      const { mid, inward } = triEdge(N, p);
      const depth = (i: number) => {
        const [x, y] = triCell(N, i).c;
        return (x - mid[0]) * inward[0] + (y - mid[1]) * inward[1];
      };
      const before = Math.max(...[...b.cells.keys()].filter((i) => b.cells[i] === p).map(depth));
      const grown = b.expand(p, 12, () => 0.5);
      expect(grown).toHaveLength(12);
      expect(Math.max(...grown.map((c) => depth(c.idx)))).toBeGreaterThan(before + 1);
    }
  });

  it('knock-outs work like on the square board', () => {
    const b = Board.triangle(9);
    b.cells.fill(1);
    b.cells[b.home[2]] = 2;
    b.cells[b.home[3]] = 3;
    const ko = b.expand(1, 10);
    expect(ko.map((c) => c.from).sort()).toEqual([2, 3]);
    expect(b.alive()).toEqual([1]);
    b.flood(1);
    expect(b.count(1)).toBe(81);
  });
});
