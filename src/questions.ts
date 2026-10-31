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
  /** Difficulty chosen in the menu (index into DIFFICULTIES). */
  difficulty: number;
  /** Stage inside that difficulty: numbers get bigger as it goes up. */
  stage: number;
  /** Golden questions are worth double territory. */
  golden: boolean;
}

/**
 * Difficulties the players pick in the menu. Each one fixes WHICH operations
 * can show up; playing well only makes the numbers bigger, it never brings
 * in an operation the player did not sign up for.
 */
export const DIFFICULTIES = [
  { label: 'Pequeno', emoji: '🐣', ops: '+ −' },
  { label: 'Fácil', emoji: '🙂', ops: '+ − ×' },
  { label: 'Médio', emoji: '😎', ops: '+ − × ÷' },
  { label: 'Difícil', emoji: '🔥', ops: 'tudo' },
  { label: 'Génio', emoji: '🧠', ops: 'tudo' },
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

// ------------------------------------------------------------------- stages

type Weighted = [Gen, number];
type Stage = Weighted[];

/** "Everything" ladder: mixed operations, order of operations, powers, percentages, negatives… */
const ALL: Stage[] = [
  [[mul(3, 12), 3], [div(2, 12, 2, 12), 2], [missingAdd(5, 30), 2], [missingMul(2, 10), 2], [threeTerms(5, 30), 2], [addThenMul, 2], [add(20, 99), 1], [sub(20, 99), 1]],
  [[mul(11, 19, 2, 9), 2], [square(2, 12), 2], [addThenMul, 2], [mulThenSub, 2], [missingMul(3, 12), 2], [sub(50, 300), 1]],
  [[percent([10, 20, 25, 50]), 2], [sub(10, 60, true), 2], [negAdd, 2], [parenMul, 2], [div(3, 15, 3, 12), 2], [square(5, 15), 1]],
  [[twoByTwo, 2], [sqrt(3, 20), 2], [parenMul, 2], [div(6, 25, 3, 9), 2], [negMul, 2], [percent([10, 15, 25, 75]), 1]],
  [[mulDiff, 2], [power, 2], [twoByTwo, 2], [negMul, 2], [percent([5, 15, 30, 75]), 2], [sqrt(10, 25), 1]],
];

/** One ladder per difficulty; a player climbs one stage every few correct answers. */
const LADDERS: Stage[][] = [
  // 🐣 Pequeno: only + and −
  [
    [[add(1, 5), 1], [sub(1, 9), 1]],
    [[add(2, 10), 1], [sub(2, 15), 1]],
    [[add(5, 20), 1], [sub(5, 20), 1]],
    [[add(10, 40), 1], [sub(10, 50), 1]],
    [[add(20, 99), 1], [sub(20, 99), 1]],
    [[add(50, 250), 1], [sub(50, 300), 1]],
  ],
  // 🙂 Fácil: + − ×
  [
    [[add(2, 10), 2], [sub(2, 12), 2], [mul(2, 2, 1, 10), 1], [mul(10, 10, 1, 10), 1]],
    [[add(5, 20), 2], [sub(5, 20), 2], [mul(2, 5, 1, 10), 2]],
    [[add(10, 50), 2], [sub(10, 50), 2], [mul(2, 10), 3]],
    [[add(20, 99), 2], [sub(20, 99), 2], [mul(2, 10), 3]],
    [[add(50, 200), 1], [sub(50, 200), 1], [mul(3, 12), 3]],
    [[add(100, 500), 1], [sub(100, 500), 1], [mul(3, 12), 2], [mul(11, 19, 2, 9), 2]],
  ],
  // 😎 Médio: + − × ÷
  [
    [[add(5, 30), 1], [sub(5, 30), 1], [mul(2, 10), 2], [div(2, 10, 2, 5), 2]],
    [[add(10, 60), 1], [sub(10, 60), 1], [mul(2, 10), 2], [div(2, 10, 2, 10), 2]],
    [[add(20, 99), 1], [sub(20, 99), 1], [mul(3, 12), 2], [div(2, 12, 2, 12), 2]],
    [[add(50, 200), 1], [sub(50, 300), 1], [mul(11, 19, 2, 9), 2], [div(3, 15, 3, 12), 2]],
    [[add(100, 500), 1], [sub(100, 500), 1], [twoByTwo, 2], [div(6, 25, 3, 9), 2]],
  ],
  // 🔥 Difícil: everything
  ALL,
  // 🧠 Génio: everything, starting further up
  ALL.slice(2),
];

const clampDifficulty = (d: number) => Math.min(LADDERS.length - 1, Math.max(0, Math.round(d)));

/** Number of stages a difficulty has (the last one repeats forever). */
export function stageCount(difficulty: number): number {
  return LADDERS[clampDifficulty(difficulty)].length;
}

function pickGen(rng: Rng, difficulty: number, stage: number): Gen {
  const pool = LADDERS[difficulty][stage - 1];
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

export function generateQuestion(difficulty: number, stage: number, opts: GenerateOpts = {}): Question {
  const rng = opts.rng ?? Math.random;
  const d = clampDifficulty(difficulty);
  const st = Math.min(stageCount(d), Math.max(1, Math.round(stage)));
  let raw = pickGen(rng, d, st)(rng);
  for (let tries = 0; tries < 12 && opts.avoid?.includes(raw.text); tries++) {
    raw = pickGen(rng, d, st)(rng);
  }
  return {
    text: raw.text,
    answer: raw.answer,
    options: makeOptions(rng, raw.answer, raw.traps, raw.negatives),
    difficulty: d,
    stage: st,
    golden: rng() < (opts.goldenChance ?? 0.1),
  };
}

/** Formats a number for an answer button (uses the proper minus sign). */
export const formatNumber = fmt;
