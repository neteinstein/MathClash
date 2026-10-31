import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, generateQuestion, makeOptions, stageCount } from '../src/questions';

/** Small deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Evaluates the text shown to the player, to check the answer is really right. */
function evaluate(text: string): number {
  const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  let expr = text
    .replace(/−/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d+)% de (\d+)/, '($1*$2/100)')
    .replace(/√(\d+)/, 'Math.sqrt($1)')
    .replace(/(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/, (_m, b: string, e: string) => `(${b}**${[...e].map((c) => SUP[c]).join('')})`);
  if (expr.includes('?')) {
    // "? op b = c": try candidates for the missing number.
    const [lhs, rhs] = expr.split('=');
    for (let x = -1000; x <= 1000; x++) {
      if (Function(`return ${lhs.replace('?', `(${x})`)}`)() === Number(rhs)) return x;
    }
    throw new Error(`no solution for ${text}`);
  }
  return Function(`return ${expr}`)();
}

/** Operators each difficulty may use (anything else in the text is a failure). */
const ALLOWED: Record<number, RegExp | null> = {
  0: /^\d+ [+−] \d+$/, // 🐣 only + and −
  1: /^\d+ [+−×] \d+$/, // 🙂 + − ×
  2: /^\d+ [+−×÷] \d+$/, // 😎 + − × ÷
  3: null, // 🔥 everything
  4: null, // 🧠 everything
};

describe('generateQuestion', () => {
  DIFFICULTIES.forEach((d, difficulty) => {
    for (let stage = 1; stage <= stageCount(difficulty); stage++) {
      it(`${d.label} stage ${stage}: right answers, valid options, allowed operations only`, () => {
        const rng = mulberry32(difficulty * 1000 + stage * 37);
        for (let k = 0; k < 300; k++) {
          const q = generateQuestion(difficulty, stage, { rng });
          expect(q.difficulty).toBe(difficulty);
          expect(q.stage).toBe(stage);
          expect(Number.isInteger(q.answer)).toBe(true);
          expect(evaluate(q.text)).toBe(q.answer);
          expect(q.options).toHaveLength(4);
          expect(new Set(q.options).size).toBe(4);
          expect(q.options).toContain(q.answer);
          for (const o of q.options) expect(Number.isInteger(o)).toBe(true);
          const allowed = ALLOWED[difficulty];
          if (allowed) {
            expect(q.text).toMatch(allowed);
            // No negative numbers for the basic levels.
            for (const o of q.options) expect(o).toBeGreaterThanOrEqual(0);
          }
        }
      });
    }
  });

  it('each basic level really uses every operation it promises', () => {
    const rng = mulberry32(5);
    const seen = (difficulty: number) => {
      const ops = new Set<string>();
      for (let stage = 1; stage <= stageCount(difficulty); stage++) {
        for (let k = 0; k < 200; k++) ops.add(generateQuestion(difficulty, stage, { rng }).text.split(' ')[1]);
      }
      return [...ops].sort().join('');
    };
    expect(seen(0)).toBe(['+', '−'].sort().join(''));
    expect(seen(1)).toBe(['+', '−', '×'].sort().join(''));
    expect(seen(2)).toBe(['+', '−', '×', '÷'].sort().join(''));
  });

  it('the very first stage stays small for young players', () => {
    const rng = mulberry32(42);
    for (let k = 0; k < 300; k++) {
      const q = generateQuestion(0, 1, { rng });
      expect(q.answer).toBeLessThanOrEqual(10);
      expect(q.text).toMatch(/^\d{1,2} [+−] \d$/);
    }
  });

  it('numbers grow from one stage to the next', () => {
    const rng = mulberry32(11);
    const avg = (stage: number) => {
      let sum = 0;
      for (let k = 0; k < 300; k++) sum += Math.abs(generateQuestion(0, stage, { rng }).answer);
      return sum / 300;
    };
    expect(avg(stageCount(0))).toBeGreaterThan(avg(1) * 5);
  });

  it('avoids recently asked questions when possible', () => {
    const rng = mulberry32(3);
    const recent: string[] = [];
    let repeats = 0;
    for (let k = 0; k < 200; k++) {
      const q = generateQuestion(1, 3, { rng, avoid: recent });
      if (recent.includes(q.text)) repeats++;
      recent.push(q.text);
      if (recent.length > 5) recent.shift();
    }
    expect(repeats).toBe(0);
  });

  it('golden questions appear sometimes', () => {
    const rng = mulberry32(9);
    const golden = Array.from({ length: 1000 }, () => generateQuestion(2, 2, { rng }).golden).filter(Boolean).length;
    expect(golden).toBeGreaterThan(50);
    expect(golden).toBeLessThan(160);
  });

  it('clamps out-of-range difficulty and stage', () => {
    const q = generateQuestion(-3, 0);
    expect([q.difficulty, q.stage]).toEqual([0, 1]);
    const top = generateQuestion(99, 99);
    expect(top.difficulty).toBe(DIFFICULTIES.length - 1);
    expect(top.stage).toBe(stageCount(DIFFICULTIES.length - 1));
  });
});

describe('makeOptions', () => {
  it('fills with nearby numbers when traps are useless', () => {
    const rng = mulberry32(1);
    const opts = makeOptions(rng, 0, [0, -1, -2, 0.5]);
    expect(opts).toHaveLength(4);
    expect(new Set(opts).size).toBe(4);
    expect(opts).toContain(0);
    for (const o of opts) expect(o).toBeGreaterThanOrEqual(0);
  });

  it('allows negatives when asked', () => {
    const rng = mulberry32(2);
    const opts = makeOptions(rng, -5, [5, -6, -4], true);
    expect(opts).toContain(-5);
    expect(new Set(opts).size).toBe(4);
  });
});
