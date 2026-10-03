import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from './app';
import { initStorage } from './platform/profile';

if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
}

// stop iOS rubber-banding / double-tap zoom from fighting the game camera
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if ((e.target as HTMLElement).closest('.scroller, .sheet')) return; e.preventDefault(); }, { passive: false });

void initStorage().then(() => {
  const app = new App(document.getElementById('game') as HTMLCanvasElement, document.getElementById('ui')!);
  (window as any).__app = app; // handy for debugging in Safari Web Inspector
});
