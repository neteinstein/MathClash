/**
 * Territory board. Logical coordinates: `x` goes across (0..w-1) and `y` goes
 * along the main axis between players 1 and 2. Player 2 lives at y = 0,
 * player 1 at y = h - 1. With 3-4 players, player 3 lives at x = 0 and
 * player 4 at x = w - 1. The renderer decides how this maps to the screen.
 */

import type { Rng } from './questions';

export type PlayerId = 1 | 2 | 3 | 4;
export type Owner = 0 | PlayerId;

export const ALL_PLAYERS: readonly PlayerId[] = [1, 2, 3, 4];

/** The first `n` players (2 to 4). */
export const playerIds = (n: number): PlayerId[] => ALL_PLAYERS.slice(0, Math.max(2, Math.min(4, n)));

export interface CellChange {
  idx: number;
  from: Owner;
  to: Owner;
  /** Neighbour the colour came from (for the paint animation), or -1. */
  src: number;
  /** Position in the sequence, used to stagger animations. */
  order: number;
}

export class Board {
  readonly w: number;
  readonly h: number;
  readonly cells: Uint8Array;
  /** Players taking part, in order. */
  readonly players: readonly PlayerId[];
  /** Home cell (where the avatar sits) for each player, indexed by id (-1 when not playing). */
  readonly home: [number, number, number, number, number];
  private readonly nbrs: number[][];

  constructor(w: number, h: number, players: readonly PlayerId[] = [1, 2]) {
    this.w = w;
    this.h = h;
    this.players = players;
    this.cells = new Uint8Array(w * h);
    const mx = Math.floor(w / 2);
    const my = Math.floor(h / 2);
    // Home cell and the cell just in front of it, for each side.
    const spots: Record<PlayerId, { home: [number, number]; front: [number, number]; along: [number, number] }> = {
      1: { home: [mx, h - 1], front: [mx, h - 2], along: [1, 0] },
      2: { home: [mx, 0], front: [mx, 1], along: [1, 0] },
      3: { home: [0, my], front: [1, my], along: [0, 1] },
      4: { home: [w - 1, my], front: [w - 2, my], along: [0, 1] },
    };
    this.home = [-1, -1, -1, -1, -1];
    for (const p of players) this.home[p] = this.idx(...spots[p].home);
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
    for (const p of players) {
      const { home: [hx, hy], front, along: [ax, ay] } = spots[p];
      for (const [x, y] of [[hx, hy], [hx - ax, hy - ay], [hx + ax, hy + ay], front]) {
        if (x >= 0 && x < w && y >= 0 && y < h) this.cells[this.idx(x, y)] = p;
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

  /** Players that still own at least one cell. */
  alive(): PlayerId[] {
    return this.players.filter((p) => this.count(p) > 0);
  }

  /** How far "forward" a cell is for a player, 0 at their home edge, 1 at the opposite edge. */
  private forward(p: PlayerId, i: number): number {
    const x = i % this.w;
    const y = Math.floor(i / this.w);
    switch (p) {
      case 1:
        return (this.h - 1 - y) / (this.h - 1);
      case 2:
        return y / (this.h - 1);
      case 3:
        return x / (this.w - 1);
      case 4:
        return (this.w - 1 - x) / (this.w - 1);
    }
  }

  /**
   * Player `p` paints up to `n` cells adjacent to their territory. Neutral
   * cells are preferred, but cells of any opponent can be stolen too. An
   * opponent's home cell is only taken when it is their very last cell (the
   * knockout blow). Stops early once no opponent is left.
   */
  expand(p: PlayerId, n: number, rng: Rng = Math.random): CellChange[] {
    const changes: CellChange[] = [];
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < this.cells.length; i++) counts[this.cells[i]]++;
    let opponentsLeft = this.players.filter((q) => q !== p && counts[q] > 0).length;
    for (let k = 0; k < n; k++) {
      let best = -1;
      let bestScore = -Infinity;
      let bestSrc = -1;
      for (let i = 0; i < this.cells.length; i++) {
        const c = this.cells[i];
        if (c === p) continue;
        if (c !== 0 && i === this.home[c] && counts[c] > 1) continue;
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
      this.cells[best] = p;
      changes.push({ idx: best, from, to: p, src: bestSrc, order: k });
      if (from !== 0 && --counts[from] === 0 && --opponentsLeft === 0) break;
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
