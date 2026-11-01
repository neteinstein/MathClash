/**
 * Layout for 3-4 players around a tablet lying on the table: one player on
 * each side of the screen, everything they use rotated to face them.
 *
 * A "seat" is an element laid out in the player's own frame (its width runs
 * along their edge of the screen, its height goes from their edge towards
 * the middle) and then rotated into place with the CSS `rotate` property,
 * which leaves `transform` free for the usual animations.
 */

import type { PlayerId } from '../board';

export type Side = 'bottom' | 'top' | 'left' | 'right';

/** Where each player sits. */
export const SIDE: Record<PlayerId, Side> = { 1: 'bottom', 2: 'top', 3: 'left', 4: 'right' };

/** Clockwise rotation (degrees) that turns content to face a player sitting on that side. */
export const ANGLE: Record<Side, number> = { bottom: 0, top: 180, left: 90, right: 270 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Unit vector pointing from a side of the screen towards its middle. */
export function inward(side: Side): [number, number] {
  switch (side) {
    case 'bottom':
      return [0, -1];
    case 'top':
      return [0, 1];
    case 'left':
      return [1, 0];
    case 'right':
      return [-1, 0];
  }
}

/** The content area of a screen element (inside its safe-area padding), in the element's own coordinates. */
export function contentBox(el: HTMLElement): Rect {
  const cs = getComputedStyle(el);
  const l = parseFloat(cs.paddingLeft) || 0;
  const r = parseFloat(cs.paddingRight) || 0;
  const t = parseFloat(cs.paddingTop) || 0;
  const b = parseFloat(cs.paddingBottom) || 0;
  return { x: l, y: t, w: Math.max(0, el.clientWidth - l - r), h: Math.max(0, el.clientHeight - t - b) };
}

/**
 * Splits an area into a strip along each side plus what is left in the
 * middle. The strips on the two short edges run the whole length, the ones on
 * the long edges fit in between (that keeps every strip as long as possible).
 * `depth(side, length, full)` says how deep a strip must be (0 = no strip).
 */
export function frame(
  box: Rect,
  depth: (side: Side, length: number, full: boolean) => number,
): { strips: Record<Side, Rect>; middle: Rect } {
  const portrait = box.w <= box.h;
  const d: Record<Side, number> = { bottom: 0, top: 0, left: 0, right: 0 };
  const full: Side[] = portrait ? ['bottom', 'top'] : ['left', 'right'];
  const between: Side[] = portrait ? ['left', 'right'] : ['bottom', 'top'];
  for (const s of full) d[s] = Math.max(0, depth(s, portrait ? box.w : box.h, true));
  const len = Math.max(0, portrait ? box.h - d.top - d.bottom : box.w - d.left - d.right);
  for (const s of between) d[s] = Math.max(0, depth(s, len, false));
  const { x, y, w, h } = box;
  const strips: Record<Side, Rect> = portrait
    ? {
        bottom: { x, y: y + h - d.bottom, w, h: d.bottom },
        top: { x, y, w, h: d.top },
        left: { x, y: y + d.top, w: d.left, h: len },
        right: { x: x + w - d.right, y: y + d.top, w: d.right, h: len },
      }
    : {
        bottom: { x: x + d.left, y: y + h - d.bottom, w: len, h: d.bottom },
        top: { x: x + d.left, y, w: len, h: d.top },
        left: { x, y, w: d.left, h },
        right: { x: x + w - d.right, y, w: d.right, h },
      };
  const middle = { x: x + d.left, y: y + d.top, w: Math.max(0, w - d.left - d.right), h: Math.max(0, h - d.top - d.bottom) };
  return { strips, middle };
}

/**
 * Room for each player's pop-up card (pause, results): the short edges get a
 * deep strip, the long edges share what is left, so four cards never overlap.
 */
export function overlayFrame(box: Rect): Record<Side, Rect> {
  const short = Math.min(box.w, box.h);
  const long = Math.max(box.w, box.h);
  const a = Math.max(short / 4, long / 2 - short / 4);
  return frame(box, (_s, _len, full) => (full ? a : short / 2)).strips;
}

/** Natural depth of a seat element for a given length (the element must be in the page). */
export function measureDepth(el: HTMLElement, length: number): number {
  el.style.width = `${length}px`;
  el.style.height = '';
  return Math.ceil(el.offsetHeight);
}

/** Puts a seat element over a strip of the screen, rotated to face whoever sits on that side. */
export function placeSeat(el: HTMLElement, side: Side, r: Rect): void {
  const vertical = side === 'left' || side === 'right';
  const length = vertical ? r.h : r.w;
  const depth = vertical ? r.w : r.h;
  const s = el.style;
  s.width = `${length}px`;
  s.height = `${depth}px`;
  s.left = `${r.x + (r.w - length) / 2}px`;
  s.top = `${r.y + (r.h - depth) / 2}px`;
  s.setProperty('rotate', `${ANGLE[side]}deg`);
}

/** Undoes `placeSeat` (back to the normal two-player layout). */
export function clearSeat(el: HTMLElement): void {
  for (const p of ['width', 'height', 'left', 'top', 'rotate']) el.style.removeProperty(p);
}
