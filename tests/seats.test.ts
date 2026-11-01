import { describe, expect, it } from 'vitest';
import { frame, overlayFrame, sideOf, type Rect, type Side } from '../src/ui/seats';

const SIDES: Side[] = ['bottom', 'top', 'left', 'right'];

const overlap = (a: Rect, b: Rect) =>
  a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 && a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

const area = (r: Rect) => r.w * r.h;

describe('seat layout (3-4 players around a tablet)', () => {
  it('upright: the top and bottom strips run the full width, the side ones fit in between', () => {
    const box = { x: 10, y: 20, w: 768, h: 1024 };
    const { strips, middle } = frame(box, () => 180);
    expect(strips.bottom).toEqual({ x: 10, y: 20 + 1024 - 180, w: 768, h: 180 });
    expect(strips.top).toEqual({ x: 10, y: 20, w: 768, h: 180 });
    expect(strips.left).toEqual({ x: 10, y: 200, w: 180, h: 1024 - 360 });
    expect(strips.right).toEqual({ x: 10 + 768 - 180, y: 200, w: 180, h: 1024 - 360 });
    expect(middle).toEqual({ x: 190, y: 200, w: 768 - 360, h: 1024 - 360 });
  });

  it('lying sideways: the left and right strips run the full height', () => {
    const { strips, middle } = frame({ x: 0, y: 0, w: 1024, h: 768 }, () => 180);
    expect(strips.left.h).toBe(768);
    expect(strips.right.h).toBe(768);
    expect(strips.top).toEqual({ x: 180, y: 0, w: 1024 - 360, h: 180 });
    expect(middle).toEqual({ x: 180, y: 180, w: 1024 - 360, h: 768 - 360 });
  });

  it('asks for each strip depth with its length, and a missing player leaves no strip', () => {
    const asked: [Side, number, boolean][] = [];
    const { strips, middle } = frame({ x: 0, y: 0, w: 768, h: 1024 }, (side, len, full) => {
      asked.push([side, len, full]);
      return side === 'right' ? 0 : side === 'left' ? 150 : 200;
    });
    expect(asked).toEqual([
      ['bottom', 768, true],
      ['top', 768, true],
      ['left', 624, false],
      ['right', 624, false],
    ]);
    expect(strips.right.w).toBe(0);
    expect(middle.w).toBe(768 - 150);
  });

  it('strips and middle tile the screen without overlapping', () => {
    for (const box of [{ x: 0, y: 0, w: 600, h: 960 }, { x: 0, y: 0, w: 1366, h: 1024 }]) {
      const { strips, middle } = frame(box, (s) => (s === 'left' ? 120 : 170));
      const rects = [...SIDES.map((s) => strips[s]), middle];
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
      expect(rects.reduce((s, r) => s + area(r), 0)).toBeCloseTo(box.w * box.h);
    }
  });

  it('pop-up cards get roomy, non-overlapping spots on every side', () => {
    for (const box of [{ x: 0, y: 0, w: 768, h: 1024 }, { x: 0, y: 0, w: 1024, h: 768 }, { x: 0, y: 0, w: 800, h: 1280 }]) {
      const strips = overlayFrame(box);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(overlap(strips[SIDES[i]], strips[SIDES[j]])).toBe(false);
      for (const s of SIDES) {
        const r = strips[s];
        const vertical = s === 'left' || s === 'right';
        expect(vertical ? r.h : r.w).toBeGreaterThanOrEqual(380); // length along the player's edge
        expect(vertical ? r.w : r.h).toBeGreaterThanOrEqual(300); // depth towards the middle
      }
    }
  });
});

describe('who sits where', () => {
  it('one player per side; with three on a tablet lying sideways, player 2 moves to the right', () => {
    expect([1, 2, 3, 4].map((id) => sideOf(id as 1, 4, false))).toEqual(['bottom', 'top', 'left', 'right']);
    expect([1, 2, 3, 4].map((id) => sideOf(id as 1, 4, true))).toEqual(['bottom', 'top', 'left', 'right']);
    expect([1, 2, 3].map((id) => sideOf(id as 1, 3, false))).toEqual(['bottom', 'top', 'left']);
    expect([1, 2, 3].map((id) => sideOf(id as 1, 3, true))).toEqual(['bottom', 'right', 'left']);
  });
});
