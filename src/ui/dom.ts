type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
}

/** Minimal element factory. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Restarts a one-shot CSS animation class on an element. */
export function pulse(el: Element, cls: string, ms = 600): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

/** Touch-friendly button handler: reacts on pointerdown (fast, multi-touch) and keyboard activation. */
export function onPress(el: HTMLElement, fn: (e: Event) => void): void {
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    fn(e);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn(e);
    }
  });
}

export const isLandscape = (): boolean => window.innerWidth > window.innerHeight * 1.05;

/** Smallest side (CSS px) a screen needs to fit 3-4 players, one on each side: tablets, not phones. */
export const MULTI_MIN_SIDE = 600;

export const isLargeScreen = (): boolean => Math.min(window.innerWidth, window.innerHeight) >= MULTI_MIN_SIDE;

export const hasKeyboard = (): boolean => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
