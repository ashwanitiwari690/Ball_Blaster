import { Component, HostListener, OnInit, effect } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AudioService } from './core/services/audio.service';
import { AdmobService } from './core/services/admob.service';
import { AppVerificationService } from './core/services/app-verification.service';
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

  private readonly isGameRoute = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/game'))
    ),
    { initialValue: this.router.url.startsWith('/game') }
  );

  constructor(
    private readonly router: Router,
    private readonly audio: AudioService,
    private readonly admob: AdmobService,
    private readonly appVerification: AppVerificationService,
    readonly connectivity: ConnectivityService
  ) {
    // Persistent banner on every screen except live gameplay, where it would
    // eat into the cannon's drag area — and hidden outright while offline,
    // since the banner is a native overlay the offline gate's router-outlet
    // swap can't hide on its own.
    effect(() => {
      if (!this.connectivity.online()) {
        void this.admob.hideBanner();
        return;
      }
      if (this.isGameRoute()) void this.admob.hideBanner();
      else void this.admob.showBanner();
    });
  }

  ngOnInit(): void {
    void this.admob.initialize();

    // Fire-and-forget: confirms this device's App Promotion install to
    // Earnivo so a pending reward (if any) gets credited. Harmless no-op
    // otherwise — see APP_PROMOTION_VERIFICATION_INTEGRATION.md.
    void this.appVerification.confirmAppPromotion();
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
