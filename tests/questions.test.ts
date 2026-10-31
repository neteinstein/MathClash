import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, MAX_LEVEL, MIN_LEVEL, generateQuestion, makeOptions } from '../src/questions';

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

describe('generateQuestion', () => {
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    it(`level ${level}: answers are correct and options are valid`, () => {
      const rng = mulberry32(level * 1000 + 7);
      for (let k = 0; k < 400; k++) {
        const q = generateQuestion(level, { rng });
        expect(q.level).toBe(level);
        expect(Number.isInteger(q.answer)).toBe(true);
        expect(evaluate(q.text)).toBe(q.answer);
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect(q.options).toContain(q.answer);
        for (const o of q.options) expect(Number.isInteger(o)).toBe(true);
        // Negative numbers only show up from level 8 on.
        if (level < 8) for (const o of q.options) expect(o).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('easy levels stay small for young players', () => {
    const rng = mulberry32(42);
    for (let k = 0; k < 300; k++) {
      const q = generateQuestion(1, { rng });
      expect(q.answer).toBeLessThanOrEqual(10);
      expect(q.text).toMatch(/^\d \+ \d$/);
    }
  });

  it('avoids recently asked questions when possible', () => {
    const rng = mulberry32(3);
    const recent: string[] = [];
    let repeats = 0;
    for (let k = 0; k < 200; k++) {
      const q = generateQuestion(4, { rng, avoid: recent });
      if (recent.includes(q.text)) repeats++;
      recent.push(q.text);
      if (recent.length > 5) recent.shift();
    }
    expect(repeats).toBe(0);
  });

  it('golden questions appear sometimes', () => {
    const rng = mulberry32(9);
    const golden = Array.from({ length: 1000 }, () => generateQuestion(3, { rng }).golden).filter(Boolean).length;
    expect(golden).toBeGreaterThan(50);
    expect(golden).toBeLessThan(160);
  });

  it('clamps out-of-range levels', () => {
    expect(generateQuestion(0).level).toBe(MIN_LEVEL);
    expect(generateQuestion(99).level).toBe(MAX_LEVEL);
  });

  it('difficulty presets map to valid levels', () => {
    for (const d of DIFFICULTIES) {
      expect(d.level).toBeGreaterThanOrEqual(MIN_LEVEL);
      expect(d.level).toBeLessThanOrEqual(MAX_LEVEL);
    }
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
