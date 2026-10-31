/**
 * Tiny synthesised sound effects (no audio files needed).
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let unlocked = false;
let lastPop = 0;

function ac(): AudioContext | null {
  // Browsers only allow audio after a user gesture: never create it earlier.
  if (!enabled || !unlocked) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  // iOS can leave the context "suspended" or "interrupted" (after a call, the lock screen…).
  const state = ctx.state as string;
  if (state === 'suspended' || state === 'interrupted') ctx.resume().catch(() => undefined);
  return ctx;
}

/** Call from a user gesture so mobile browsers allow audio. */
export function unlockAudio(): void {
  unlocked = true;
  ac();
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on && ctx) void ctx.suspend();
  if (on) ac();
}

export const isSoundEnabled = (): boolean => enabled;

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  vol?: number;
  delay?: number;
  attack?: number;
}

function tone({ type = 'triangle', freq, to, dur, vol = 0.3, delay = 0, attack = 0.005 }: ToneOpts): void {
  const a = ac();
  if (!a || !master) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const NOTE = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12);

export const sfx = {
  tap() {
    tone({ type: 'sine', freq: 700, to: 500, dur: 0.06, vol: 0.15 });
  },
  correct(streak: number) {
    const base = 3 + Math.min(streak, 10); // climbs with the streak
    tone({ freq: NOTE(base), dur: 0.12, vol: 0.28 });
    tone({ freq: NOTE(base + 7), dur: 0.18, vol: 0.28, delay: 0.07 });
    if (streak >= 3) tone({ type: 'sine', freq: NOTE(base + 12), dur: 0.22, vol: 0.18, delay: 0.14 });
  },
  wrong() {
    tone({ type: 'sawtooth', freq: 220, to: 110, dur: 0.28, vol: 0.18 });
    tone({ type: 'square', freq: 160, to: 90, dur: 0.24, vol: 0.08, delay: 0.04 });
  },
  pop(stolen: boolean) {
    const now = performance.now();
    if (now - lastPop < 35) return; // avoid a wall of noise on big claims
    lastPop = now;
    const f = stolen ? 260 + Math.random() * 80 : 520 + Math.random() * 300;
    tone({ type: 'sine', freq: f, to: f * 1.6, dur: 0.07, vol: stolen ? 0.22 : 0.14 });
  },
  shrink() {
    tone({ type: 'sine', freq: 400, to: 200, dur: 0.12, vol: 0.12 });
  },
  golden() {
    [0, 4, 7, 12, 16].forEach((s, i) => tone({ type: 'sine', freq: NOTE(15 + s), dur: 0.15, vol: 0.14, delay: i * 0.045 }));
  },
  count() {
    tone({ type: 'square', freq: NOTE(3), dur: 0.12, vol: 0.12 });
  },
  go() {
    tone({ type: 'square', freq: NOTE(15), dur: 0.35, vol: 0.14 });
    tone({ type: 'triangle', freq: NOTE(22), dur: 0.35, vol: 0.2 });
  },
  tick() {
    tone({ type: 'square', freq: 1200, dur: 0.03, vol: 0.06 });
  },
  win() {
    const seq = [0, 4, 7, 12, 7, 12, 16];
    seq.forEach((s, i) => tone({ type: 'triangle', freq: NOTE(3 + s), dur: i === seq.length - 1 ? 0.6 : 0.16, vol: 0.25, delay: i * 0.12 }));
  },
  /** Little devil cackle: "mwa-ha-ha". */
  devil() {
    [0, 0.14, 0.28].forEach((d, i) => {
      tone({ type: 'sawtooth', freq: 340 - i * 45, to: 250 - i * 40, dur: 0.12, vol: 0.13, delay: d });
      tone({ type: 'square', freq: 170 - i * 22, dur: 0.1, vol: 0.05, delay: d });
    });
  },
  devilDefeated() {
    tone({ type: 'sine', freq: 300, to: 1300, dur: 0.25, vol: 0.16 });
    [0, 4, 7, 12].forEach((s, i) => tone({ type: 'triangle', freq: NOTE(10 + s), dur: 0.12, vol: 0.16, delay: 0.12 + i * 0.06 }));
  },
  draw() {
    [0, 3, 0].forEach((s, i) => tone({ type: 'triangle', freq: NOTE(3 + s), dur: 0.25, vol: 0.2, delay: i * 0.2 }));
  },
};

export function vibrate(pattern: number | number[]): void {
  if (!unlocked) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
