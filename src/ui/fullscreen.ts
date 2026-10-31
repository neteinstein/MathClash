import { Capacitor } from '@capacitor/core';

type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** Already running full screen: native app, home-screen web app, or fullscreen API active. */
export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return (
    Capacitor.isNativePlatform() ||
    !!(d.fullscreenElement || d.webkitFullscreenElement) ||
    window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** The browser can put the page in full screen itself (Android Chrome, desktop, iPad). */
export function canRequestFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Tries to enter full screen; resolves false if the browser refused. */
export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    try {
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('portrait');
    } catch {
      /* orientation lock is optional */
    }
    return true;
  } catch {
    return false;
  }
}
