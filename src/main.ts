import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './styles.css';

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ALL_PLAYERS, playerIds, type PlayerId } from './board';
import { Fx } from './fx';
import { activePlayerCount, fixColors, loadSettings } from './settings';
import { setSoundEnabled, unlockAudio } from './audio';
import { GameScreen } from './ui/game';
import { MenuScreen } from './ui/menu';

interface Screen {
  el: HTMLElement;
  layout(): void;
  tick(now: number, dt: number): void;
  back(): boolean;
  destroy(): void;
}

const root = document.getElementById('app')!;
const fx = new Fx();
document.body.append(fx.canvas);

const settings = loadSettings();
setSoundEnabled(settings.sound);

// Hidden testing/demo switch: ?bots=1,2 lets the computer play (?bots=1,2,3,4: a 4-player match of bots).
const params = new URLSearchParams(location.search);
const bots = (params.get('bots') ?? '').split(',').map(Number).filter((n): n is PlayerId => ALL_PLAYERS.includes(n as PlayerId));
const allBots = bots.length >= 2 && playerIds(bots.length).every((id) => bots.includes(id));

let current: Screen | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

function show(next: Screen): void {
  current?.destroy();
  current = next;
  root.append(next.el);
  next.layout();
}

function showMenu(): void {
  void releaseWakeLock();
  const menu = new MenuScreen(settings, { onStart: startGame });
  show(menu);
}

function startGame(): void {
  const players = allBots ? bots.length : activePlayerCount(settings);
  fixColors(settings, players);
  const game = new GameScreen(settings, fx, { onMenu: showMenu, onRematch: startGame }, { bots, players });
  show(game);
  game.start();
  void requestWakeLock();
}

async function requestWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    /* already released */
  }
  wakeLock = null;
}

// One animation loop for everything.
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  current?.tick(now, dt);
  fx.update(dt);
  fx.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    fx.resize();
    current?.layout();
  });
});

window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
// iOS only lets audio start from touchend/click, and may pause it again later: retry on every tap.
window.addEventListener('touchend', unlockAudio, { passive: true });
window.addEventListener('click', unlockAudio);
// Avoid long-press menus and pinch zoom getting in the way of fast tapping.
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

if (Capacitor.isNativePlatform()) {
  void App.addListener('backButton', () => {
    if (current?.back()) return;
    if (current instanceof GameScreen) showMenu();
    else void App.exitApp();
  });
  // App sent to background (phone call, home button…): freeze the match.
  void App.addListener('pause', () => {
    if (current instanceof GameScreen) current.pause();
  });
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      // Sandboxed frames may refuse service workers (even reading the property throws).
      navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    } catch {
      /* offline support is optional */
    }
  });
}

if (allBots) startGame();
else showMenu();
