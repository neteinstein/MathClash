/**
 * Draws the board on a canvas: territories are rendered as merged blobs and
 * every change of owner plays a "paint spreading" animation.
 */

import { H3, triCell, triEdge, type Board, type CellChange, type Owner, type PlayerId } from './board';
import type { PlayerColor } from './colors';

export type Orientation = 'portrait' | 'landscape';

export interface PaintEvent {
  idx: number;
  from: Owner;
  to: Owner;
  /** Centre of the cell in page (CSS px) coordinates. */
  x: number;
  y: number;
}

/** Space reserved at each end of the board (every side with 3-4 players) for the avatars, in cells. */
export const AVATAR_MARGIN = 0.95;

/**
 * Triangle boards: the "cell" size (used for avatars, messages…) as a share of
 * a small triangle's side, so things look about as big as on a square board.
 */
const TRI_CELL = 0.75;

/** Room around a triangle board for the avatars, in small-triangle sides. */
const TRI_MARGIN = AVATAR_MARGIN * TRI_CELL;

type Vec = [number, number];

/**
 * Turn (clockwise) from the canonical triangle (pointing up, see triCell) to
 * the screen: pointing right ▶ on an upright tablet (player 3's side on the
 * left), pointing up ▲ on one lying sideways (player 1's side at the bottom).
 */
const triTurn = (o: Orientation): number => ((o === 'landscape' ? 120 : 90) * Math.PI) / 180;

/** Turns a vector clockwise on screen (y grows downwards). */
const turn = ([x, y]: Vec, a: number): Vec => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/** Triangle board turned for the screen, in small-triangle sides, centred on its incentre. */
function triPlace(n: number, o: Orientation): { at: (p: Vec) => Vec; min: Vec; max: Vec } {
  const a = triTurn(o);
  const g: Vec = [n / 2, (2 * n * H3) / 3];
  const at = (p: Vec) => turn([p[0] - g[0], p[1] - g[1]], a);
  // Bounding box of the corners (plus the plate) and of each avatar sitting mid-side.
  const min: Vec = [Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity];
  const grow = ([x, y]: Vec, r: number) => {
    min[0] = Math.min(min[0], x - r);
    min[1] = Math.min(min[1], y - r);
    max[0] = Math.max(max[0], x + r);
    max[1] = Math.max(max[1], y + r);
  };
  for (const c of [[n / 2, 0], [n, n * H3], [0, n * H3]] as Vec[]) grow(at(c), 0.25);
  for (const p of [1, 2, 3] as PlayerId[]) grow(at(triEdge(n, p).mid), TRI_MARGIN);
  return { at, min, max };
}

/** Pixels per small-triangle side for a triangle board of side `n` in a `w`×`h` area. */
function triScale(n: number, w: number, h: number, o: Orientation): number {
  const { min, max } = triPlace(n, o);
  return Math.min(w / (max[0] - min[0]), h / (max[1] - min[1]));
}

const NEUTRAL = 'rgba(255,255,255,0.075)';
const NEUTRAL_EDGE = 'rgba(255,255,255,0.05)';
const PLATE = '#1b1450';

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

interface Ext {
  l: boolean;
  r: boolean;
  t: boolean;
  b: boolean;
}
const NO_EXT: Ext = { l: false, r: false, t: false, b: false };

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private board!: Board;
  colors: Partial<Record<PlayerId, PlayerColor>>;
  orientation: Orientation = 'portrait';
  onPaint: ((e: PaintEvent) => void) | null = null;

  // layout
  cell = 10;
  private ox = 0;
  private oy = 0;
  private cols = 1;
  private rows = 1;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private pageX = 0;
  private pageY = 0;
  private pos = new Int32Array(0); // idx -> col,row
  private grid = new Int32Array(0); // col,row -> idx
  // triangle boards (drawn pointing right ▶)
  private side = 0; // small triangle side, px
  private tv = new Float32Array(0); // idx -> 3 corners (x, y)
  private tc = new Float32Array(0); // idx -> centre
  private tnb = new Int32Array(0); // idx -> neighbour across each of its 3 sides, or -1
  private outline: [number, number][] = [];
  private triMap: (p: [number, number]) => [number, number] = (p) => p;

  // animation state per cell
  private aFrom = new Uint8Array(0);
  private aTo = new Uint8Array(0);
  private aStart = new Float64Array(0);
  private aDur = new Float32Array(0);
  private aSrc = new Int32Array(0);
  private aOn = new Uint8Array(0);
  private aFired = new Uint8Array(0);
  private disp = new Uint8Array(0);
  private animT = new Float32Array(0);
  /** Little twinkles that make the territories feel alive. */
  private sparkles: { i: number; t0: number; dx: number; dy: number }[] = [];
  private nextSparkle = 0;

  constructor(board: Board, colors: Partial<Record<PlayerId, PlayerColor>>) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.colors = colors;
    this.setBoard(board);
  }

  setBoard(board: Board): void {
    this.board = board;
    const n = board.size;
    this.aFrom = new Uint8Array(n);
    this.aTo = new Uint8Array(n);
    this.aStart = new Float64Array(n);
    this.aDur = new Float32Array(n);
    this.aSrc = new Int32Array(n).fill(-1);
    this.aOn = new Uint8Array(n);
    this.aFired = new Uint8Array(n);
    this.disp = new Uint8Array(n);
    this.animT = new Float32Array(n);
  }

  get shape(): Board['shape'] {
    return this.board.shape;
  }

  /** Triangle boards: the biggest side n (odd) whose small triangles are still about `target` px wide. */
  static triangleSizeFor(w: number, h: number, o: Orientation, target = 44): number {
    for (let n = 17; n > 7; n -= 2) if (triScale(n, w, h, o) >= target) return n;
    return 7;
  }

  /**
   * Computes cell size for a given area; static so the game can pick a board size.
   * `allSides`: avatars sit on every side (3-4 players), so leave room all around.
   */
  static cellSizeFor(w: number, h: number, across: number, along: number, orientation: Orientation, allSides = false): number {
    const m = AVATAR_MARGIN * 2;
    const am = allSides ? m : 0;
    return orientation === 'portrait'
      ? Math.min(w / (across + am), h / (along + m))
      : Math.min(h / (across + am), w / (along + m));
  }

  layout(cssW: number, cssH: number, orientation: Orientation): void {
    this.orientation = orientation;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    if (this.board.shape === 'triangle') {
      this.layoutTriangle(cssW, cssH);
      this.updatePageOffset();
      return;
    }

    const { w, h } = this.board;
    const s = Math.floor(BoardView.cellSizeFor(cssW, cssH, w, h, orientation, this.board.players.length > 2));
    this.cell = Math.max(4, s);
    this.cols = orientation === 'portrait' ? w : h;
    this.rows = orientation === 'portrait' ? h : w;
    this.ox = Math.round((cssW - this.cols * this.cell) / 2);
    this.oy = Math.round((cssH - this.rows * this.cell) / 2);

    this.pos = new Int32Array(this.board.size * 2);
    this.grid = new Int32Array(this.cols * this.rows);
    for (let i = 0; i < this.board.size; i++) {
      const [x, y] = this.board.xy(i);
      const col = orientation === 'portrait' ? x : h - 1 - y;
      const row = orientation === 'portrait' ? y : x;
      this.pos[i * 2] = col;
      this.pos[i * 2 + 1] = row;
      this.grid[row * this.cols + col] = i;
    }
    this.updatePageOffset();
  }

  /** Triangle board, turned to face the players (see triTurn) and centred with its avatars. */
  private layoutTriangle(cssW: number, cssH: number): void {
    const n = this.board.w;
    const { at, min, max } = triPlace(n, this.orientation);
    const s = Math.max(4, Math.floor(triScale(n, cssW, cssH, this.orientation)));
    this.side = s;
    this.cell = s * TRI_CELL;
    const ox = cssW / 2 - ((min[0] + max[0]) / 2) * s;
    const oy = cssH / 2 - ((min[1] + max[1]) / 2) * s;
    const map = (p: Vec): Vec => {
      const [x, y] = at(p);
      return [ox + x * s, oy + y * s];
    };
    this.triMap = map;

    const size = this.board.size;
    const cells = Array.from({ length: size }, (_, i) => triCell(n, i));
    this.tv = new Float32Array(size * 6);
    this.tc = new Float32Array(size * 2);
    this.tnb = new Int32Array(size * 3).fill(-1);
    const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
    for (let i = 0; i < size; i++) {
      const { pts, c } = cells[i];
      pts.forEach((pt, k) => {
        const [x, y] = map(pt);
        this.tv[i * 6 + k * 2] = x;
        this.tv[i * 6 + k * 2 + 1] = y;
      });
      [this.tc[i * 2], this.tc[i * 2 + 1]] = map(c);
      // Which neighbour lies across each side (for merging same-colour triangles).
      for (const j of this.board.neighbors(i)) {
        const other = cells[j].pts;
        for (let k = 0; k < 3; k++) {
          const a = pts[k];
          const b = pts[(k + 1) % 3];
          if (other.some((q) => same(q, a)) && other.some((q) => same(q, b))) this.tnb[i * 3 + k] = j;
        }
      }
    }
    this.outline = ([[n / 2, 0], [n, n * H3], [0, n * H3]] as [number, number][]).map(map);
  }

  /** Rotation (degrees, clockwise) that makes a player's avatar face the middle of the board. */
  homeAngle(p: PlayerId): number {
    if (this.board.shape === 'triangle') {
      // "Up" for the avatar (sin θ, -cos θ) points into the board, across their side.
      const [x, y] = turn(triEdge(this.board.w, p).inward, triTurn(this.orientation));
      return (Math.atan2(x, -y) * 180) / Math.PI;
    }
    const i = this.board.home[p];
    const col = this.pos[i * 2];
    const row = this.pos[i * 2 + 1];
    if (row === this.rows - 1) return 0;
    if (row === 0) return 180;
    return col === 0 ? 90 : 270;
  }

  updatePageOffset(): void {
    const r = this.canvas.getBoundingClientRect();
    this.pageX = r.left;
    this.pageY = r.top;
  }

  /** Centre of a cell in canvas CSS px. */
  cellCenter(i: number): [number, number] {
    if (this.board.shape === 'triangle') return [this.tc[i * 2], this.tc[i * 2 + 1]];
    return [this.ox + (this.pos[i * 2] + 0.5) * this.cell, this.oy + (this.pos[i * 2 + 1] + 0.5) * this.cell];
  }

  cellCenterPage(i: number): [number, number] {
    const [x, y] = this.cellCenter(i);
    return [x + this.pageX, y + this.pageY];
  }

  /** Where the avatar of a player sits (canvas CSS px): on the outer edge of their home cell. */
  avatarAnchor(p: PlayerId): [number, number] {
    if (this.board.shape === 'triangle') return this.triMap(triEdge(this.board.w, p).mid);
    const i = this.board.home[p];
    const [cx, cy] = this.cellCenter(i);
    const half = this.cell / 2;
    const col = this.pos[i * 2];
    const row = this.pos[i * 2 + 1];
    if (row === this.rows - 1) return [cx, cy + half];
    if (row === 0) return [cx, cy - half];
    return [col === 0 ? cx - half : cx + half, cy];
  }

  /** Queues the paint animation for a list of changes. */
  queue(changes: CellChange[], now: number, stagger = 55, dur = 320): void {
    for (const c of changes) {
      const i = c.idx;
      const from = this.displayedAt(i, now);
      this.aFrom[i] = from;
      this.aTo[i] = c.to;
      this.aStart[i] = now + c.order * stagger;
      this.aDur[i] = dur;
      this.aSrc[i] = c.src;
      this.aOn[i] = 1;
      this.aFired[i] = 0;
    }
  }

  get animating(): boolean {
    for (let i = 0; i < this.aOn.length; i++) if (this.aOn[i]) return true;
    return false;
  }

  private displayedAt(i: number, now: number): Owner {
    if (!this.aOn[i]) return this.board.cells[i] as Owner;
    const t = (now - this.aStart[i]) / this.aDur[i];
    return (t < 0.5 ? this.aFrom[i] : this.aTo[i]) as Owner;
  }

  draw(now: number): void {
    const { ctx, cell: s, board } = this;
    const n = board.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // Plate behind the cells.
    const tri = board.shape === 'triangle';
    const pad = Math.max(3, s * 0.12);
    ctx.fillStyle = PLATE;
    if (tri) roundPolyPath(ctx, inflate(this.outline, pad), [this.side * 0.5, this.side * 0.5, this.side * 0.5]);
    else roundRectPath(ctx, this.ox - pad, this.oy - pad, this.cols * s + pad * 2, this.rows * s + pad * 2, [s * 0.4, s * 0.4, s * 0.4, s * 0.4]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Resolve what each cell shows right now.
    for (let i = 0; i < n; i++) {
      if (!this.aOn[i]) {
        this.disp[i] = board.cells[i];
        this.animT[i] = -1;
        continue;
      }
      const t = (now - this.aStart[i]) / this.aDur[i];
      if (t >= 1) {
        this.aOn[i] = 0;
        this.disp[i] = board.cells[i];
        this.animT[i] = -1;
        if (!this.aFired[i]) this.fire(i);
      } else if (t < 0) {
        this.disp[i] = this.aFrom[i];
        this.animT[i] = -1;
      } else {
        this.disp[i] = this.aFrom[i];
        this.animT[i] = t;
        if (!this.aFired[i]) this.fire(i);
      }
    }

    // Static tiles first (merged into blobs), animated ones on top.
    for (let i = 0; i < n; i++) {
      if (this.animT[i] >= 0) continue;
      this.paintCell(i, this.disp[i] as Owner, true, 1);
    }
    const reach = tri ? this.side : s;
    for (let i = 0; i < n; i++) {
      const t = this.animT[i];
      if (t < 0) continue;
      const from = this.aFrom[i] as Owner;
      const to = this.aTo[i] as Owner;
      if (to === 0) {
        // Shrinking back to neutral: the colour drains away.
        this.paintCell(i, 0, false, 1);
        ctx.globalAlpha = 1 - t;
        this.paintCell(i, from, false, 1 - easeOutCubic(t) * 0.6);
        ctx.globalAlpha = 1;
        continue;
      }
      this.paintCell(i, from, false, 1);
      // New colour spreads like paint from the neighbour it came from.
      let [cx, cy] = this.cellCenter(i);
      const src = this.aSrc[i];
      if (src >= 0) {
        const [sx, sy] = this.cellCenter(src);
        cx = (cx + sx) / 2;
        cy = (cy + sy) / 2;
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, reach * 1.5 * easeOutCubic(clamp01(t * 1.25)), 0, Math.PI * 2);
      ctx.clip();
      this.paintCell(i, to, false, 1 + 0.22 * Math.sin(Math.PI * t));
      ctx.restore();
    }
    this.drawSparkles(now);
  }

  private drawSparkles(now: number): void {
    const { ctx, cell: s, board } = this;
    if (now > this.nextSparkle) {
      this.nextSparkle = now + 90 + Math.random() * 160;
      const i = Math.floor(Math.random() * board.size);
      if (board.cells[i] !== 0 && this.animT[i] < 0) {
        this.sparkles.push({ i, t0: now, dx: (Math.random() - 0.5) * 0.5, dy: (Math.random() - 0.5) * 0.5 });
      }
    }
    const LIFE = 700;
    this.sparkles = this.sparkles.filter((sp) => now - sp.t0 < LIFE && board.cells[sp.i] !== 0);
    ctx.fillStyle = '#fff';
    for (const sp of this.sparkles) {
      const t = (now - sp.t0) / LIFE;
      const r = s * 0.16 * Math.sin(Math.PI * t);
      const [cx, cy] = this.cellCenter(sp.i);
      const x = cx + sp.dx * s;
      const y = cy + sp.dy * s;
      ctx.globalAlpha = 0.75 * Math.sin(Math.PI * t);
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.quadraticCurveTo(x, y, x, y + r);
      ctx.quadraticCurveTo(x, y, x - r, y);
      ctx.quadraticCurveTo(x, y, x, y - r);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private fire(i: number): void {
    this.aFired[i] = 1;
    if (!this.onPaint) return;
    const [x, y] = this.cellCenterPage(i);
    this.onPaint({ idx: i, from: this.aFrom[i] as Owner, to: this.aTo[i] as Owner, x, y });
  }

  /** Draws one cell; `merge`: join it with same-colour neighbours (static cells only). */
  private paintCell(i: number, o: Owner, merge: boolean, scale: number): void {
    if (this.board.shape === 'triangle') {
      this.drawTri(i, o, merge && o !== 0, scale);
      return;
    }
    const [x, y] = this.tileOrigin(i);
    this.drawTile(x, y, o, merge && o !== 0 ? this.extFor(i, o) : NO_EXT, scale, i);
  }

  /**
   * One small triangle. Sides shared with a same-colour (static) neighbour
   * reach right to the edge so the colour reads as one blob; the others are
   * pulled in to leave a gap, with rounded corners where two of them meet.
   */
  private drawTri(i: number, o: Owner, merge: boolean, scale: number): void {
    const { ctx, side: s } = this;
    const g = Math.max(1.5, s * 0.07);
    const cx = this.tc[i * 2];
    const cy = this.tc[i * 2 + 1];
    const P: [number, number][] = [0, 1, 2].map((k) => [this.tv[i * 6 + k * 2], this.tv[i * 6 + k * 2 + 1]]);
    const joined = [false, false, false];
    const lines: { ax: number; ay: number; ex: number; ey: number; nx: number; ny: number }[] = [];
    for (let k = 0; k < 3; k++) {
      const j = this.tnb[i * 3 + k];
      joined[k] = merge && j >= 0 && this.disp[j] === o && this.animT[j] < 0;
      const [ax, ay] = P[k];
      const [bx, by] = P[(k + 1) % 3];
      const len = Math.hypot(bx - ax, by - ay);
      const ex = (bx - ax) / len;
      const ey = (by - ay) / len;
      // Unit normal pointing into the triangle.
      let nx = -ey;
      let ny = ex;
      if ((cx - ax) * nx + (cy - ay) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      const d = joined[k] ? -0.6 : g / 2; // a hair of overlap hides seams between joined triangles
      lines.push({ ax: ax + nx * d, ay: ay + ny * d, ex, ey, nx, ny });
    }
    // Corner k sits between side k-1 and side k.
    const V: [number, number][] = [0, 1, 2].map((k) => {
      const l1 = lines[(k + 2) % 3];
      const l2 = lines[k];
      const den = l1.ex * l2.ey - l1.ey * l2.ex;
      const t = ((l2.ax - l1.ax) * l2.ey - (l2.ay - l1.ay) * l2.ex) / den;
      const x = l1.ax + l1.ex * t;
      const y = l1.ay + l1.ey * t;
      return [cx + (x - cx) * scale, cy + (y - cy) * scale];
    });
    const rad = s * 0.18 * scale;
    const radii = [0, 1, 2].map((k) => (!joined[(k + 2) % 3] && !joined[k] ? rad : 0));
    if (o === 0) {
      ctx.fillStyle = NEUTRAL;
      roundPolyPath(ctx, V, radii);
      ctx.fill();
      ctx.fillStyle = NEUTRAL_EDGE;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const c = this.colors[o as PlayerId]!;
    ctx.fillStyle = c.main;
    roundPolyPath(ctx, V, radii);
    ctx.fill();
    if (this.aOn[i] && this.animT[i] >= 0) {
      ctx.fillStyle = `rgba(255,255,255,${(0.35 * (1 - this.animT[i])).toFixed(3)})`;
      ctx.fill();
    }
    // Chunky "candy" depth along the free sides that face down.
    const shade = [0, 1, 2].filter((k) => !joined[k] && -lines[k].ny > 0.3);
    if (shade.length) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = c.dark;
      ctx.globalAlpha *= 0.55;
      ctx.lineWidth = Math.max(4, s * 0.24);
      ctx.beginPath();
      for (const k of shade) {
        ctx.moveTo(...V[k]);
        ctx.lineTo(...V[(k + 1) % 3]);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private tileOrigin(i: number): [number, number] {
    return [this.ox + this.pos[i * 2] * this.cell, this.oy + this.pos[i * 2 + 1] * this.cell];
  }

  /** Same-owner static neighbours on screen → tiles merge on that side. */
  private extFor(i: number, o: Owner): Ext {
    const col = this.pos[i * 2];
    const row = this.pos[i * 2 + 1];
    const same = (c: number, r: number) => {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
      const j = this.grid[r * this.cols + c];
      return this.disp[j] === o && this.animT[j] < 0;
    };
    return { l: same(col - 1, row), r: same(col + 1, row), t: same(col, row - 1), b: same(col, row + 1) };
  }

  private drawTile(x: number, y: number, o: Owner, ext: Ext, scale: number, i: number): void {
    const { ctx, cell: s } = this;
    const g = Math.max(1.5, s * 0.08);
    const rad = s * 0.24;
    let l = x + (ext.l ? 0 : g / 2);
    let r = x + s - (ext.r ? 0 : g / 2);
    let t = y + (ext.t ? 0 : g / 2);
    let b = y + s - (ext.b ? 0 : g / 2);
    if (scale !== 1) {
      const cx = x + s / 2;
      const cy = y + s / 2;
      l = cx + (l - cx) * scale;
      r = cx + (r - cx) * scale;
      t = cy + (t - cy) * scale;
      b = cy + (b - cy) * scale;
    }
    const radii: [number, number, number, number] = [
      !ext.t && !ext.l ? rad : 0,
      !ext.t && !ext.r ? rad : 0,
      !ext.b && !ext.r ? rad : 0,
      !ext.b && !ext.l ? rad : 0,
    ];
    if (o === 0) {
      ctx.fillStyle = NEUTRAL;
      roundRectPath(ctx, l, t, r - l, b - t, radii);
      ctx.fill();
      ctx.fillStyle = NEUTRAL_EDGE;
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const c = this.colors[o as PlayerId]!;
    ctx.fillStyle = c.main;
    roundRectPath(ctx, l, t, r - l, b - t, radii);
    ctx.fill();
    // Freshly painted cells glow for a moment.
    if (this.aOn[i] && this.animT[i] >= 0) {
      ctx.fillStyle = `rgba(255,255,255,${(0.35 * (1 - this.animT[i])).toFixed(3)})`;
      ctx.fill();
    }
    // Chunky "candy" depth on the bottom edge of the blob.
    if (!ext.b) {
      ctx.fillStyle = c.dark;
      ctx.globalAlpha *= 0.55;
      const d = Math.max(2, s * 0.12);
      roundRectPath(ctx, l, b - d, r - l, d, [0, 0, radii[2], radii[3]]);
      ctx.fill();
      ctx.globalAlpha /= 0.55;
    }
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: [number, number, number, number],
): void {
  const m = Math.min(w, h) / 2;
  tl = Math.min(tl, m);
  tr = Math.min(tr, m);
  br = Math.min(br, m);
  bl = Math.min(bl, m);
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl);
  else ctx.lineTo(x, y);
  ctx.closePath();
}

/** Closed polygon with a rounding radius per corner (0 = sharp). */
function roundPolyPath(ctx: CanvasRenderingContext2D, pts: [number, number][], radii: number[]): void {
  const n = pts.length;
  const [lx, ly] = pts[n - 1];
  const [fx, fy] = pts[0];
  ctx.beginPath();
  ctx.moveTo((lx + fx) / 2, (ly + fy) / 2);
  for (let k = 0; k < n; k++) {
    const [x1, y1] = pts[k];
    const [x2, y2] = pts[(k + 1) % n];
    ctx.arcTo(x1, y1, x2, y2, radii[k]);
  }
  ctx.closePath();
}

/** Pushes every side of a convex polygon outwards by `d`. */
function inflate(pts: [number, number][], d: number): [number, number][] {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  // For a regular polygon, each corner moves away from the centre by d / cos(π / n).
  const k = d / Math.cos(Math.PI / n);
  return pts.map(([x, y]) => {
    const len = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / len) * k, y + ((y - cy) / len) * k];
  });
}
