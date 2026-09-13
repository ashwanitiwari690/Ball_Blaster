import { Component, HostListener, OnInit } from '@angular/core';
import { AudioService } from './core/services/audio.service';
import { AdmobService } from './core/services/admob.service';
import { ConnectivityService } from './core/services/connectivity.service';

const TAPPABLE_SELECTOR =
  'ion-button, button, ion-tab-button, ion-fab-button, .bb-bottom-nav-item, a[role="button"]';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  private audioUnlocked = false;

  constructor(
    private readonly audio: AudioService,
    private readonly admob: AdmobService,
    readonly connectivity: ConnectivityService
  ) {}

  ngOnInit(): void {
    // No persistent banner (see AdmobService's doc comment) — just
    // initialize AdMob at boot so the interstitial/rewarded ads are
    // preloaded and ready by the time the player reaches a breakpoint or a
    // reward flow.
    void this.admob.initialize();
  }

  /**
   * Browsers refuse to play audio until a real user gesture. This single
   * app-wide listener both unlocks the AudioContext + starts the
   * background music on the very first tap, and plays a tap sound for
   * every button in the app from then on — so individual pages don't each
   * need to wire up button click sounds by hand.
   */
  @HostListener('document:pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (!this.audioUnlocked) {
      this.audioUnlocked = true;
      this.audio.unlock();
      this.audio.startMusic();
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest(TAPPABLE_SELECTOR)) {
      this.audio.buttonTap();
    }
  }
}
