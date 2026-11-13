import { Injectable, OnDestroy, signal } from '@angular/core';

/**
 * Tracks whether the device currently has a network connection. Gameplay
 * (and everything else) is blocked while offline rather than letting the
 * player earn rewards with no ad ever having been requested or shown.
 *
 * A signal, not a plain field: the `online`/`offline` window events are raw
 * DOM listeners registered outside any Angular-bound template, and this app
 * runs zoneless (see GamePage's doc comment) — a plain field written from
 * there would update correctly in this service but never reach the DOM.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService implements OnDestroy {
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private readonly onOnline = () => this.online.set(true);
  private readonly onOffline = () => this.online.set(false);

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
  }

  /** Re-reads the browser's connectivity flag directly, for a manual "Try again" action. */
  recheck(): void {
    if (typeof navigator !== 'undefined') this.online.set(navigator.onLine);
  }

  ngOnDestroy(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }
}
