/**
 * Territory board. Logical coordinates: `x` goes across (0..w-1) and `y` goes
 * along the axis between the players. Player 2 lives at y = 0, player 1 at
 * y = h - 1. The renderer decides how this maps to the screen.
 */

import type { Rng } from './questions';

export type Owner = 0 | 1 | 2;
export type PlayerId = 1 | 2;

export interface CellChange {
  idx: number;
  from: Owner;
  to: Owner;
  /** Neighbour the colour came from (for the paint animation), or -1. */
  src: number;
  /** Position in the sequence, used to stagger animations. */
  order: number;
}

export const other = (p: PlayerId): PlayerId => (p === 1 ? 2 : 1);

export class Board {
  readonly w: number;
  readonly h: number;
  readonly cells: Uint8Array;
  /** Home cell (where the avatar sits) for each player, index 1 and 2. */
  readonly home: [number, number, number];
  private readonly nbrs: number[][];

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cells = new Uint8Array(w * h);
    const mid = Math.floor(w / 2);
    this.home = [-1, this.idx(mid, h - 1), this.idx(mid, 0)];
    this.nbrs = [];
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      const n: number[] = [];
      if (y > 0) n.push(i - w);
      if (y < h - 1) n.push(i + w);
      if (x > 0) n.push(i - 1);
      if (x < w - 1) n.push(i + 1);
      this.nbrs.push(n);
    }
    // Each player starts with a small blob around their avatar.
    for (const p of [1, 2] as PlayerId[]) {
      const hx = mid;
      const hy = p === 1 ? h - 1 : 0;
      const fy = p === 1 ? h - 2 : 1;
      for (const [x, y] of [[hx, hy], [hx - 1, hy], [hx + 1, hy], [hx, fy]]) {
        if (x >= 0 && x < w) this.cells[this.idx(x, y)] = p;
      }
    }
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  xy(i: number): [number, number] {
    return [i % this.w, Math.floor(i / this.w)];
  }

  neighbors(i: number): readonly number[] {
    return this.nbrs[i];
  }

  get size(): number {
    return this.cells.length;
  }

  count(p: Owner): number {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === p) n++;
    return n;
  }

  /** How far "forward" a cell is for a player, 0 at their home row, 1 at the enemy's. */
  private forward(p: PlayerId, i: number): number {
    const y = Math.floor(i / this.w);
    return p === 1 ? (this.h - 1 - y) / (this.h - 1) : y / (this.h - 1);
  }

  /**
   * Player `p` paints up to `n` cells adjacent to their territory. Neutral
   * cells are preferred, but enemy cells can be stolen too. The enemy's home
   * cell is only taken when it is their very last cell (the knockout blow).
   */
  expand(p: PlayerId, n: number, rng: Rng = Math.random): CellChange[] {
    const changes: CellChange[] = [];
    const enemy = other(p);
    let enemyCount = this.count(enemy);
    for (let k = 0; k < n; k++) {
      let best = -1;
      let bestScore = -Infinity;
      let bestSrc = -1;
      for (let i = 0; i < this.cells.length; i++) {
        const c = this.cells[i];
        if (c === p) continue;
        if (c === enemy && i === this.home[enemy] && enemyCount > 1) continue;
        let own = 0;
        let src = -1;
        for (const j of this.nbrs[i]) {
          if (this.cells[j] === p) {
            own++;
            src = j;
          }
        }
        if (own === 0) continue;
        const score = (c === 0 ? 2.5 : 0) + own * 1.1 + this.forward(p, i) * 1.4 + rng() * 2.2;
        if (score > bestScore) {
          bestScore = score;
          best = i;
          bestSrc = src;
        }
      }
      if (best < 0) break;
      const from = this.cells[best] as Owner;
      if (from === enemy) enemyCount--;
      this.cells[best] = p;
      changes.push({ idx: best, from, to: p, src: bestSrc, order: k });
      if (enemyCount === 0) break;
    }
    return changes;
  }

  /**
   * Player `p` loses up to `n` of their most exposed cells (they become
   * neutral). The home cell is never lost this way.
   */
  shrink(p: PlayerId, n: number, rng: Rng = Math.random): CellChange[] {
    const changes: CellChange[] = [];
    for (let k = 0; k < n; k++) {
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < this.cells.length; i++) {
        if (this.cells[i] !== p || i === this.home[p]) continue;
        let exposed = 0;
        for (const j of this.nbrs[i]) if (this.cells[j] !== p) exposed++;
        if (exposed === 0) continue;
        const score = exposed * 1.2 + this.forward(p, i) * 1.5 + rng() * 1.5;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) break;
      this.cells[best] = 0;
      changes.push({ idx: best, from: p, to: 0, src: -1, order: k });
    }
    return changes;
  }

  /** Winner's colour floods the whole board (end-of-game finale), wave by wave. */
  flood(p: PlayerId): CellChange[] {
    const changes: CellChange[] = [];
    const dist = new Int32Array(this.cells.length).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] === p) {
        dist[i] = 0;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      for (const j of this.nbrs[i]) {
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        queue.push(j);
        changes.push({ idx: j, from: this.cells[j] as Owner, to: p, src: i, order: dist[j] });
        this.cells[j] = p;
      }
    }
    return changes;
  }
}
