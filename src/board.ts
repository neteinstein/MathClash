/**
 * Territory board.
 *
 * Grid boards (2 and 4 players): square cells. Logical coordinates: `x` goes
 * across (0..w-1) and `y` goes along the main axis between players 1 and 2.
 * Player 2 lives at y = 0, player 1 at y = h - 1. With 4 players, player 3
 * lives at x = 0 and player 4 at x = w - 1.
 *
 * Triangle boards (3 players): a big triangle cut into n² small ones, each
 * player in the middle of one side (see `triCell`).
 *
 * The renderer decides how this maps to the screen.
 */

import type { Rng } from './questions';

export type PlayerId = 1 | 2 | 3 | 4;
export type Owner = 0 | PlayerId;

export const ALL_PLAYERS: readonly PlayerId[] = [1, 2, 3, 4];

/** The first `n` players (2 to 4). */
export const playerIds = (n: number): PlayerId[] => ALL_PLAYERS.slice(0, Math.max(2, Math.min(4, n)));

export type BoardShape = 'grid' | 'triangle';

/** Height of an equilateral triangle of side 1. */
export const H3 = Math.sqrt(3) / 2;

type Pt = [number, number];

/**
 * Small triangle `i` of a triangle board of side `n`, in canonical
 * coordinates: the big triangle points up (apex at (n/2, 0), y grows
 * downwards) and every small triangle has side 1. Row r (from the apex)
 * holds 2r + 1 triangles, alternately pointing up and down; cell (r, k) is
 * index r² + k.
 */
export function triCell(n: number, i: number): { pts: [Pt, Pt, Pt]; c: Pt; up: boolean } {
  const r = Math.floor(Math.sqrt(i + 0.5));
  const k = i - r * r;
  const left = n / 2 - (r + 1) / 2; // left end of the row, at its bottom
  const top = r * H3;
  const bottom = (r + 1) * H3;
  const j = k >> 1;
  if (k % 2 === 0) {
    return { pts: [[left + j, bottom], [left + j + 0.5, top], [left + j + 1, bottom]], c: [left + j + 0.5, bottom - H3 / 3], up: true };
  }
  return { pts: [[left + j + 0.5, top], [left + j + 1.5, top], [left + j + 1, bottom]], c: [left + j + 1, top + H3 / 3], up: false };
}

/**
 * The side of the big triangle each player faces (canonical coordinates).
 * The game draws it pointing right ▶, so the base ends up on the left
 * (player 3), the left side at the top (player 2) and the right side at the
 * bottom (player 1): each side faces the player sitting there.
 */
export function triEdge(n: number, p: PlayerId): { mid: Pt; inward: Pt } {
  switch (p) {
    case 3:
      return { mid: [n / 2, n * H3], inward: [0, -1] };
    case 2:
      return { mid: [n / 4, (n * H3) / 2], inward: [H3, 0.5] };
    default:
      return { mid: [(3 * n) / 4, (n * H3) / 2], inward: [-H3, 0.5] };
  }
}

interface Topology {
  nbrs: number[][];
  home: Partial<Record<PlayerId, number>>;
  start: Partial<Record<PlayerId, number[]>>;
  /** How far "forward" a cell is for a player, 0 at their home edge, 1 at the far end. */
  forward(p: PlayerId, i: number): number;
}

function gridTopology(w: number, h: number, players: readonly PlayerId[]): Topology {
  const idx = (x: number, y: number) => y * w + x;
  const mx = Math.floor(w / 2);
  const my = Math.floor(h / 2);
  // Home cell and the cell just in front of it, for each side.
  const spots: Record<PlayerId, { home: Pt; front: Pt; along: Pt }> = {
    1: { home: [mx, h - 1], front: [mx, h - 2], along: [1, 0] },
    2: { home: [mx, 0], front: [mx, 1], along: [1, 0] },
    3: { home: [0, my], front: [1, my], along: [0, 1] },
    4: { home: [w - 1, my], front: [w - 2, my], along: [0, 1] },
  };
  const nbrs: number[][] = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const n: number[] = [];
    if (y > 0) n.push(i - w);
    if (y < h - 1) n.push(i + w);
    if (x > 0) n.push(i - 1);
    if (x < w - 1) n.push(i + 1);
    nbrs.push(n);
  }
  const home: Topology['home'] = {};
  const start: Topology['start'] = {};
  for (const p of players) {
    // Each player starts with a small blob around their avatar.
    const { home: [hx, hy], front, along: [ax, ay] } = spots[p];
    home[p] = idx(hx, hy);
    start[p] = [[hx, hy], [hx - ax, hy - ay], [hx + ax, hy + ay], front]
      .filter(([x, y]) => x >= 0 && x < w && y >= 0 && y < h)
      .map(([x, y]) => idx(x, y));
  }
  const forward = (p: PlayerId, i: number): number => {
    const x = i % w;
    const y = Math.floor(i / w);
    switch (p) {
      case 1:
        return (h - 1 - y) / (h - 1);
      case 2:
        return y / (h - 1);
      case 3:
        return x / (w - 1);
      case 4:
        return (w - 1 - x) / (w - 1);
    }
  };
  return { nbrs, home, start, forward };
}

function triangleTopology(n: number, players: readonly PlayerId[]): Topology {
  const size = n * n;
  const nbrs: number[][] = [];
  for (let r = 0; r < n; r++) {
    for (let k = 0; k <= 2 * r; k++) {
      const i = r * r + k;
      const nb: number[] = [];
      if (k % 2 === 0) {
        // Pointing up: neighbours left and right in the row, and the one below.
        if (k > 0) nb.push(i - 1);
        if (k < 2 * r) nb.push(i + 1);
        if (r < n - 1) nb.push((r + 1) * (r + 1) + k + 1);
      } else {
        // Pointing down: left, right and the one above.
        nb.push(i - 1, i + 1, (r - 1) * (r - 1) + k - 1);
      }
      nbrs.push(nb);
    }
  }
  const centres = Array.from({ length: size }, (_, i) => triCell(n, i).c);
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const home: Topology['home'] = {};
  const start: Topology['start'] = {};
  const fwd: Partial<Record<PlayerId, Float64Array>> = {};
  for (const p of players) {
    const { mid, inward } = triEdge(n, p);
    let best = 0;
    for (let i = 1; i < size; i++) if (dist(centres[i], mid) < dist(centres[best], mid)) best = i;
    home[p] = best;
    // A short strip of 5 triangles along their side, centred on the avatar.
    start[p] = centres.flatMap((c, i) => (dist(c, mid) < 1.1 ? [i] : []));
    const f = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const c = centres[i];
      f[i] = ((c[0] - mid[0]) * inward[0] + (c[1] - mid[1]) * inward[1]) / (n * H3);
    }
    fwd[p] = f;
  }
  return { nbrs, home, start, forward: (p, i) => fwd[p]![i] };
}

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
  readonly shape: BoardShape;
  /** Grid: columns and rows. Triangle: both are the side n (in small triangles). */
  readonly w: number;
  readonly h: number;
  readonly cells: Uint8Array;
  /** Players taking part, in order. */
  readonly players: readonly PlayerId[];
  /** Home cell (where the avatar sits) for each player, indexed by id (-1 when not playing). */
  readonly home: [number, number, number, number, number];
  private readonly nbrs: number[][];
  private readonly forward: (p: PlayerId, i: number) => number;

  constructor(w: number, h: number, players: readonly PlayerId[] = [1, 2], shape: BoardShape = 'grid') {
    this.shape = shape;
    this.w = w;
    this.h = h;
    this.players = players;
    this.cells = new Uint8Array(w * h);
    const t = shape === 'triangle' ? triangleTopology(w, players) : gridTopology(w, h, players);
    this.nbrs = t.nbrs;
    this.forward = t.forward;
    this.home = [-1, -1, -1, -1, -1];
    for (const p of players) {
      this.home[p] = t.home[p]!;
      for (const i of t.start[p]!) this.cells[i] = p;
    }
  }

  /** Three players around a triangle of side `n` (odd, so every avatar sits mid-side). */
  static triangle(n: number, players: readonly PlayerId[] = [1, 2, 3]): Board {
    if (players.some((p) => p > 3)) throw new Error('A triangle board has room for 3 players');
    return new Board(n, n, players, 'triangle');
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
