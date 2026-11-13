import { Component, HostListener, OnInit, effect, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AudioService } from './core/services/audio.service';
import { AdmobService } from './core/services/admob.service';
import { AppVerificationService } from './core/services/app-verification.service';
import { ConnectivityService } from './core/services/connectivity.service';
import { BANNER_ROUTES } from './core/config/admob.config';

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

  private readonly visible = signal(!document.hidden);
  private readonly routePath = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0])
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] }
  );

  constructor(
    private readonly router: Router,
    private readonly audio: AudioService,
    private readonly admob: AdmobService,
    private readonly appVerification: AppVerificationService,
    readonly connectivity: ConnectivityService
  ) {
    // Banners are limited to the hub/profile; only visible ads reserve navigation space.
    effect(() => {
      if (!this.connectivity.online() || !this.visible() || this.admob.fullScreenAdActive()
        || !BANNER_ROUTES.includes(this.routePath())) {
        void this.admob.hideBanner();
        return;
      }
      void this.admob.showBanner();
    });
  }

  ngOnInit(): void {
    void this.admob.initialize();

    // Fire-and-forget: confirms this device's App Promotion install to
    // Earnivo so a pending reward (if any) gets credited. Harmless no-op
    // otherwise — see APP_PROMOTION_VERIFICATION_INTEGRATION.md.
    void this.appVerification.confirmAppPromotion();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    this.visible.set(!document.hidden);
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
