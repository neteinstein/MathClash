/**
 * Math question generator with 10 difficulty levels and plausible wrong answers.
 */

export type Rng = () => number;

export interface Question {
  /** Text shown on the card, e.g. "7 × 8" or "? + 5 = 12". */
  text: string;
  answer: number;
  /** Exactly 4 distinct options, one of them is `answer`. */
  options: number[];
  level: number;
  /** Golden questions are worth double territory. */
  golden: boolean;
}

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;

/** Starting level for each difficulty the players can pick in the menu. */
export const DIFFICULTIES = [
  { label: 'Pequeno', emoji: '🐣', level: 1 },
  { label: 'Fácil', emoji: '🙂', level: 2 },
  { label: 'Médio', emoji: '😎', level: 4 },
  { label: 'Difícil', emoji: '🔥', level: 6 },
  { label: 'Génio', emoji: '🧠', level: 8 },
] as const;

interface Raw {
  text: string;
  answer: number;
  /** Typical mistakes — used first as wrong options. */
  traps: number[];
  negatives?: boolean;
}

type Gen = (rng: Rng) => Raw;

const MINUS = '−';
const TIMES = '×';
const DIVIDE = '÷';

export const ri = (rng: Rng, min: number, max: number): number => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const fmt = (n: number): string => (n < 0 ? `${MINUS}${Math.abs(n)}` : String(n));
const paren = (n: number): string => (n < 0 ? `(${fmt(n)})` : fmt(n));
const reverseDigits = (n: number): number => {
  const r = Number(String(Math.abs(n)).split('').reverse().join(''));
  return n < 0 ? -r : r;
};
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number): string => String(n).split('').map((d) => SUPERSCRIPT[Number(d)]).join('');

// ---------------------------------------------------------------- generators

const add = (aMin: number, aMax: number, bMin = aMin, bMax = aMax): Gen => (rng) => {
  const a = ri(rng, aMin, aMax);
  const b = ri(rng, bMin, bMax);
  const s = a + b;
  return { text: `${a} + ${b}`, answer: s, traps: [s + 1, s - 1, s + 10, s - 10, Math.abs(a - b), s + 2] };
};

const sub = (aMin: number, aMax: number, negatives = false): Gen => (rng) => {
  let a = ri(rng, aMin, aMax);
  let b = ri(rng, aMin, aMax);
  if (!negatives && b > a) [a, b] = [b, a];
  if (a === b) a += ri(rng, 1, 5);
  const d = a - b;
  return { text: `${a} ${MINUS} ${b}`, answer: d, traps: [d + 1, d - 1, d + 10, d - 10, a + b, -d], negatives };
};

const mul = (aMin: number, aMax: number, bMin = aMin, bMax = aMax): Gen => (rng) => {
  let a = ri(rng, aMin, aMax);
  let b = ri(rng, bMin, bMax);
  if (rng() < 0.5) [a, b] = [b, a];
  const p = a * b;
  return {
    text: `${a} ${TIMES} ${b}`,
    answer: p,
    traps: [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b, a + b, p + 10, p - 10, reverseDigits(p)],
  };
};

const div = (qMin: number, qMax: number, dMin: number, dMax: number): Gen => (rng) => {
  const d = ri(rng, dMin, dMax);
  const q = ri(rng, qMin, qMax);
  const n = d * q;
  return { text: `${n} ${DIVIDE} ${d}`, answer: q, traps: [q + 1, q - 1, q + 2, q - 2, d, q + 10] };
};

const missingAdd = (min: number, max: number): Gen => (rng) => {
  const a = ri(rng, min, max);
  const b = ri(rng, min, max);
  const c = a + b;
  return { text: `? + ${b} = ${c}`, answer: a, traps: [c + b, a + 1, a - 1, a + 10, a - 10] };
};

const missingMul = (min: number, max: number): Gen => (rng) => {
  const a = ri(rng, min, max);
  const b = ri(rng, min, max);
  const c = a * b;
  return { text: `? ${TIMES} ${b} = ${c}`, answer: a, traps: [a + 1, a - 1, c - b, a + 2, b] };
};

const threeTerms = (min: number, max: number): Gen => (rng) => {
  const a = ri(rng, min, max);
  const b = ri(rng, min, max);
  const c = ri(rng, min, Math.min(max, a + b - 1));
  const r = a + b - c;
  return { text: `${a} + ${b} ${MINUS} ${c}`, answer: r, traps: [a + b + c, r + 1, r - 1, r + 10, a - b + c] };
};

const addThenMul: Gen = (rng) => {
  const a = ri(rng, 2, 20);
  const b = ri(rng, 2, 9);
  const c = ri(rng, 2, 9);
  const r = a + b * c;
  return { text: `${a} + ${b} ${TIMES} ${c}`, answer: r, traps: [(a + b) * c, r + 1, r - 1, r + 10, a * b + c] };
};

const mulThenSub: Gen = (rng) => {
  const a = ri(rng, 3, 9);
  const b = ri(rng, 3, 9);
  const c = ri(rng, 2, Math.min(9, b - 1));
  const r = a * b - c;
  return { text: `${a} ${TIMES} ${b} ${MINUS} ${c}`, answer: r, traps: [a * (b - c), r + 1, r - 1, r + 10, a * b + c] };
};

const parenMul: Gen = (rng) => {
  const a = ri(rng, 2, 12);
  const b = ri(rng, 2, 12);
  const c = ri(rng, 2, 9);
  const r = (a + b) * c;
  return { text: `(${a} + ${b}) ${TIMES} ${c}`, answer: r, traps: [a + b * c, r + c, r - c, r + 10, a * c + b] };
};

const square = (min: number, max: number): Gen => (rng) => {
  const a = ri(rng, min, max);
  const r = a * a;
  return { text: `${a}${sup(2)}`, answer: r, traps: [a * 2, (a + 1) * (a + 1), (a - 1) * (a - 1), r + 10, r - 10] };
};

const sqrt = (min: number, max: number): Gen => (rng) => {
  const a = ri(rng, min, max);
  return { text: `√${a * a}`, answer: a, traps: [a + 1, a - 1, a + 2, Math.round((a * a) / 2), a * 2] };
};

const percent = (pcts: number[]): Gen => (rng) => {
  const p = pick(rng, pcts);
  // Choose a base so that the result is a whole number.
  const step = 100 / gcd(p, 100);
  const n = step * ri(rng, 1, Math.max(1, Math.floor(400 / step)));
  const r = (p * n) / 100;
  return { text: `${p}% de ${n}`, answer: r, traps: [r * 2, Math.round(r / 2), r + 5, r - 5, r + 10, p] };
};

const power: Gen = (rng) => {
  const base = pick(rng, [2, 2, 3, 5, 10]);
  const maxExp = base === 2 ? 8 : base === 3 ? 4 : 3;
  const e = ri(rng, 2, maxExp);
  const r = base ** e;
  return { text: `${base}${sup(e)}`, answer: r, traps: [base * e, base ** (e + 1), base ** (e - 1), r + base, r - 1] };
};

const negMul: Gen = (rng) => {
  const a = -ri(rng, 2, 12);
  const b = rng() < 0.4 ? -ri(rng, 2, 9) : ri(rng, 2, 9);
  const p = a * b;
  return { text: `${fmt(a)} ${TIMES} ${paren(b)}`, answer: p, traps: [-p, p + a, p - a, a + b, -(p + 1)], negatives: true };
};

const negAdd: Gen = (rng) => {
  const a = -ri(rng, 2, 30);
  const b = ri(rng, 2, 30);
  const s = a + b;
  return { text: `${fmt(a)} + ${b}`, answer: s, traps: [-s, s + 1, s - 1, b - a, a - b], negatives: true };
};

const twoByTwo: Gen = (rng) => {
  const a = ri(rng, 11, 25);
  const b = ri(rng, 11, 19);
  const p = a * b;
  return { text: `${a} ${TIMES} ${b}`, answer: p, traps: [p + 10, p - 10, a * (b - 1), (a + 1) * b, p + 100, reverseDigits(p)] };
};

const mulDiff: Gen = (rng) => {
  const a = ri(rng, 4, 12);
  const b = ri(rng, 4, 12);
  const c = ri(rng, 2, 9);
  const d = ri(rng, 2, 9);
  const r = a * b - c * d;
  return {
    text: `${a} ${TIMES} ${b} ${MINUS} ${c} ${TIMES} ${d}`,
    answer: r,
    traps: [r + 1, r - 1, r + 10, a * b + c * d, (a * b - c) * d],
    negatives: true,
  };
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// ------------------------------------------------------------------- levels

type Weighted = [Gen, number];

const LEVELS: Record<number, Weighted[]> = {
  1: [[add(1, 5), 1]],
  2: [[add(2, 10), 3], [sub(1, 10), 2]],
  3: [[add(5, 30), 3], [sub(5, 20), 3], [mul(2, 2, 1, 10), 1], [mul(5, 5, 1, 10), 1], [mul(10, 10, 1, 10), 1]],
  4: [[add(10, 60), 2], [sub(10, 60), 2], [mul(2, 10), 4], [missingAdd(2, 15), 1]],
  5: [[mul(2, 10), 3], [div(2, 10, 2, 10), 3], [add(20, 99), 2], [sub(20, 99), 2], [missingAdd(5, 30), 1]],
  6: [[mul(3, 12), 3], [div(2, 12, 2, 12), 2], [missingMul(2, 10), 2], [threeTerms(5, 30), 2], [addThenMul, 2]],
  7: [[mul(11, 19, 2, 9), 2], [square(2, 12), 2], [addThenMul, 2], [mulThenSub, 2], [missingMul(3, 12), 2], [sub(50, 300), 1]],
  8: [[percent([10, 20, 25, 50]), 2], [sub(10, 60, true), 2], [negAdd, 2], [parenMul, 2], [div(3, 15, 3, 12), 2], [square(5, 15), 1]],
  9: [[twoByTwo, 2], [sqrt(3, 20), 2], [parenMul, 2], [div(6, 25, 3, 9), 2], [negMul, 2], [percent([10, 15, 25, 75]), 1]],
  10: [[mulDiff, 2], [power, 2], [twoByTwo, 2], [negMul, 2], [percent([5, 15, 30, 75]), 2], [sqrt(10, 25), 1]],
};

function pickGen(rng: Rng, level: number): Gen {
  const pool = LEVELS[Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level))];
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [gen, w] of pool) {
    r -= w;
    if (r < 0) return gen;
  }
  return pool[pool.length - 1][0];
}

/** Builds 4 distinct options containing the answer, preferring "typical mistake" distractors. */
export function makeOptions(rng: Rng, answer: number, traps: number[], negatives = false): number[] {
  const wrong = new Set<number>();
  const ok = (n: number) => Number.isInteger(n) && n !== answer && (negatives || n >= 0) && !wrong.has(n);

  // Up to 2 traps (the most "human" mistakes), then nearby numbers so it is not trivially guessable.
  for (const t of shuffle(rng, [...traps])) {
    if (wrong.size >= 2) break;
    if (ok(t) && Math.abs(t - answer) <= Math.max(20, Math.abs(answer))) wrong.add(t);
  }
  const mag = Math.max(1, Math.round(Math.abs(answer) * 0.1));
  const nearby = shuffle(rng, [1, -1, 2, -2, 3, -3, 10, -10, mag, -mag, mag * 2, -mag * 2]);
  for (const d of nearby) {
    if (wrong.size >= 3) break;
    if (ok(answer + d)) wrong.add(answer + d);
  }
  for (let k = 1; wrong.size < 3; k++) {
    if (ok(answer + k)) wrong.add(answer + k);
    else if (ok(answer - k)) wrong.add(answer - k);
  }
  return shuffle(rng, [answer, ...wrong]);
}

export interface GenerateOpts {
  rng?: Rng;
  /** Texts to avoid (recent questions), so the same sum does not repeat back-to-back. */
  avoid?: readonly string[];
  goldenChance?: number;
}

export function generateQuestion(level: number, opts: GenerateOpts = {}): Question {
  const rng = opts.rng ?? Math.random;
  const lvl = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
  let raw = pickGen(rng, lvl)(rng);
  for (let tries = 0; tries < 12 && opts.avoid?.includes(raw.text); tries++) {
    raw = pickGen(rng, lvl)(rng);
  }
  return {
    text: raw.text,
    answer: raw.answer,
    options: makeOptions(rng, raw.answer, raw.traps, raw.negatives),
    level: lvl,
    golden: rng() < (opts.goldenChance ?? 0.1),
  };
}

/** Formats a number for an answer button (uses the proper minus sign). */
export const formatNumber = fmt;
