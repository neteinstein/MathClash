/**
 * Full-screen particle layer: paint splats, rings and confetti.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 'dot' | 'ring' | 'confetti' | 'star';
  rot: number;
  vr: number;
  gravity: number;
}

export class Fx {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private dpr = 1;
  private confettiUntil = 0;
  private confettiColors: string[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-layer';
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  clear(): void {
    this.particles = [];
    this.confettiUntil = 0;
  }

  /** Paint splat: a few droplets flying out of a point. */
  splat(x: number, y: number, color: string, count = 6, power = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 160) * power;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0,
        max: 0.35 + Math.random() * 0.35,
        size: 2 + Math.random() * 4 * power,
        color,
        kind: 'dot',
        rot: 0, vr: 0,
        gravity: 420,
      });
    }
  }

  ring(x: number, y: number, color: string, size = 30): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.45, size, color, kind: 'ring', rot: 0, vr: 0, gravity: 0 });
  }

  stars(x: number, y: number, count = 8): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sp = 140 + Math.random() * 80;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.7,
        size: 7 + Math.random() * 4,
        color: i % 2 ? '#fde047' : '#fff7c2',
        kind: 'star',
        rot: Math.random() * 6, vr: 6,
        gravity: 120,
      });
    }
  }

  confetti(colors: string[], ms = 4000): void {
    this.confettiColors = colors;
    this.confettiUntil = performance.now() + ms;
  }

  private spawnConfetti(dt: number): void {
    const w = window.innerWidth;
    const n = Math.ceil(dt * 90);
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: Math.random() * w,
        y: -20,
        vx: (Math.random() - 0.5) * 120,
        vy: 120 + Math.random() * 160,
        life: 0,
        max: 5,
        size: 6 + Math.random() * 6,
        color: this.confettiColors[Math.floor(Math.random() * this.confettiColors.length)],
        kind: 'confetti',
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        gravity: 60,
      });
    }
  }

  get busy(): boolean {
    return this.particles.length > 0 || this.confettiUntil > performance.now();
  }

  update(dt: number): void {
    if (this.confettiUntil > performance.now()) this.spawnConfetti(dt);
    const h = window.innerHeight;
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'confetti') p.vx += Math.sin(p.life * 4 + p.rot) * 10 * dt;
      return p.life < p.max && p.y < h + 40;
    });
  }

  draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const p of this.particles) {
      const t = p.life / p.max;
      ctx.globalAlpha = p.kind === 'confetti' ? 1 : Math.max(0, 1 - t);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      switch (p.kind) {
        case 'dot':
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'ring':
          ctx.lineWidth = 4 * (1 - t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.3 + t), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'confetti':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.life * 6 + p.rot));
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        case 'star':
          drawStar(ctx, p.x, p.y, p.size * (1 - t * 0.4), p.rot);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = rot + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
