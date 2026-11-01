/**
 * Draws the board on a canvas: territories are rendered as merged blobs and
 * every change of owner plays a "paint spreading" animation.
 */

import type { Board, CellChange, Owner, PlayerId } from './board';
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

  updatePageOffset(): void {
    const r = this.canvas.getBoundingClientRect();
    this.pageX = r.left;
    this.pageY = r.top;
  }

  /** Centre of a cell in canvas CSS px. */
  cellCenter(i: number): [number, number] {
    return [this.ox + (this.pos[i * 2] + 0.5) * this.cell, this.oy + (this.pos[i * 2 + 1] + 0.5) * this.cell];
  }

  cellCenterPage(i: number): [number, number] {
    const [x, y] = this.cellCenter(i);
    return [x + this.pageX, y + this.pageY];
  }

  /** Where the avatar of a player sits (canvas CSS px): on the outer edge of their home cell. */
  avatarAnchor(p: PlayerId): [number, number] {
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
    const pad = Math.max(3, s * 0.12);
    ctx.fillStyle = PLATE;
    roundRectPath(ctx, this.ox - pad, this.oy - pad, this.cols * s + pad * 2, this.rows * s + pad * 2, [s * 0.4, s * 0.4, s * 0.4, s * 0.4]);
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
      const o = this.disp[i] as Owner;
      const [x, y] = this.tileOrigin(i);
      this.drawTile(x, y, o, o === 0 ? NO_EXT : this.extFor(i, o), 1, i);
    }
    for (let i = 0; i < n; i++) {
      const t = this.animT[i];
      if (t < 0) continue;
      const [x, y] = this.tileOrigin(i);
      const from = this.aFrom[i] as Owner;
      const to = this.aTo[i] as Owner;
      if (to === 0) {
        // Shrinking back to neutral: the colour drains away.
        this.drawTile(x, y, 0, NO_EXT, 1, i);
        ctx.globalAlpha = 1 - t;
        this.drawTile(x, y, from, NO_EXT, 1 - easeOutCubic(t) * 0.6, i);
        ctx.globalAlpha = 1;
        continue;
      }
      this.drawTile(x, y, from, NO_EXT, 1, i);
      // New colour spreads like paint from the neighbour it came from.
      let cx = x + s / 2;
      let cy = y + s / 2;
      const src = this.aSrc[i];
      if (src >= 0) {
        const [sx, sy] = this.cellCenter(src);
        cx = (cx + sx) / 2;
        cy = (cy + sy) / 2;
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 1.5 * easeOutCubic(clamp01(t * 1.25)), 0, Math.PI * 2);
      ctx.clip();
      this.drawTile(x, y, to, NO_EXT, 1 + 0.22 * Math.sin(Math.PI * t), i);
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
