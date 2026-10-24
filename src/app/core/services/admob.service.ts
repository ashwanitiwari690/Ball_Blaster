import { Injectable, signal } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  BannerAdOptions,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import {
  AD_UNIT_IDS,
  INTERSTITIAL_EVERY_N_ROUNDS,
  INTERSTITIAL_MIN_INTERVAL_MS,
  INTERSTITIAL_TIMEOUT_MS,
} from '../config/admob.config';

/**
 * Thin wrapper around @capacitor-community/admob — the ONLY file in the app
 * that talks to the plugin directly. Follows the robust ad-serving architecture
 * from Escape the Monster.
 */
@Injectable({ providedIn: 'root' })
export class AdmobService {
  readonly isSupported = Capacitor.isNativePlatform();

  /** True while a rewarded ad is loading or being shown — prevents double triggers. */
  readonly rewardedBusy = signal(false);

  private initPromise?: Promise<void>;
  private bannerVisible = false;
  private lastKnownBannerHeight = 50;

  private interstitialReady = false;
  private interstitialLoading = false;
  private interstitialBusy = false;
  private roundsSinceInterstitial = 0;
  private lastFullScreenAdTime = 0;

  private rewardedReady = false;
  private rewardedLoading = false;

  initialize(): Promise<void> {
    if (!this.isSupported) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = AdMob.initialize({})
        .then(() => {
          void this.preloadInterstitial();
          void this.preloadRewarded();
        })
        .catch((err) => {
          console.warn('[AdMob] initialize failed:', err);
        });
    }
    return this.initPromise;
  }

  // ---------------------------------------------------------------------
  // Banner
  // ---------------------------------------------------------------------

  /** Shows the persistent bottom banner. Safe to call repeatedly. */
  async showBanner(): Promise<void> {
    if (!this.isSupported) return;
    await this.initialize();

    if (this.bannerVisible) {
      try {
        await AdMob.resumeBanner();
        this.setBannerSpace(this.lastKnownBannerHeight || 50);
      } catch (err) {
        console.warn('[AdMob] resumeBanner failed:', err);
      }
      return;
    }

    const options: BannerAdOptions = {
      adId: AD_UNIT_IDS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
    };

    try {
      this.bannerVisible = true;
      await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (info) => {
        this.setBannerSpace(info.height);
      });
      await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (err) => {
        console.warn('[AdMob Banner] FailedToLoad:', err);
        this.setBannerSpace(0);
      });
      await AdMob.showBanner(options);
    } catch (err) {
      console.warn('[AdMob Banner] showBanner error:', err);
      this.bannerVisible = false;
      this.setBannerSpace(0);
    }
  }

  /** Hides the banner (e.g. during active gameplay). Cheap to call every screen change. */
  async hideBanner(): Promise<void> {
    if (!this.isSupported || !this.bannerVisible) return;
    try {
      await AdMob.hideBanner();
    } catch (err) {
      console.warn('[AdMob] hideBanner error:', err);
    }
    this.setBannerSpace(0);
  }

  /** Exposes the banner's live height as CSS vars so bottom-nav and page spacers adjust seamlessly. */
  private setBannerSpace(heightPx: number): void {
    const raw = Math.max(0, heightPx);
    const dpr = window.devicePixelRatio || 1;
    const space = raw > 90 ? Math.round(raw / dpr) : raw;

    if (space > 0) {
      this.lastKnownBannerHeight = space;
      document.documentElement.style.setProperty('--ad-banner-space', `${space}px`);
      document.documentElement.style.setProperty('--ad-banner-active', '1');
      document.documentElement.style.setProperty('--bb-nav-bottom-padding', '6px');
      document.documentElement.style.setProperty('--bb-nav-bottom-gap', '5px');
      document.body.classList.add('has-ad-banner');
    } else {
      document.documentElement.style.setProperty('--ad-banner-space', '0px');
      document.documentElement.style.setProperty('--ad-banner-active', '0');
      document.documentElement.style.setProperty('--bb-nav-bottom-padding', '8px');
      document.documentElement.style.setProperty('--bb-nav-bottom-gap', '0px');
      document.body.classList.remove('has-ad-banner');
    }
  }

  // ---------------------------------------------------------------------
  // Interstitial
  // ---------------------------------------------------------------------

  /** Preloads (or reloads) the interstitial in the background. */
  async preloadInterstitial(): Promise<void> {
    if (!this.isSupported || this.interstitialReady || this.interstitialLoading) return;
    this.interstitialLoading = true;
    try {
      await AdMob.prepareInterstitial({ adId: AD_UNIT_IDS.interstitial });
      this.interstitialReady = true;
      console.log('[AdMob Interstitial] Ready');
    } catch (err) {
      console.warn('[AdMob Interstitial] Failed to load:', err);
      this.interstitialReady = false;
    } finally {
      this.interstitialLoading = false;
    }
  }

  /**
   * Call at a natural breakpoint (e.g. leaving a finished game round). Shows
   * an interstitial only every INTERSTITIAL_EVERY_N_ROUNDS calls and after cooldown.
   */
  async maybeShowInterstitialAtBreakpoint(): Promise<void> {
    if (!this.isSupported) return;
    this.roundsSinceInterstitial++;
    const timeSinceLastAd = Date.now() - this.lastFullScreenAdTime;
    if (this.roundsSinceInterstitial < INTERSTITIAL_EVERY_N_ROUNDS || timeSinceLastAd < INTERSTITIAL_MIN_INTERVAL_MS) {
      return;
    }
    this.roundsSinceInterstitial = 0;
    await this.showInterstitial();
  }

  /**
   * Shows the interstitial if one is ready (or can be loaded within a short
   * timeout) and resolves once it's dismissed. Gives up after INTERSTITIAL_TIMEOUT_MS
   * so an ad never blocks navigation. Returns true only if an ad was actually shown.
   */
  async showInterstitial(): Promise<boolean> {
    if (!this.isSupported || this.interstitialBusy) return false;
    this.interstitialBusy = true;
    try {
      await this.initialize();
      if (!this.interstitialReady) {
        await Promise.race([
          this.preloadInterstitial(),
          new Promise<void>((resolve) => setTimeout(resolve, INTERSTITIAL_TIMEOUT_MS)),
        ]);
      }
      if (!this.interstitialReady) return false;
      this.interstitialReady = false;
      try {
        await AdMob.showInterstitial();
        this.lastFullScreenAdTime = Date.now();
        void this.preloadInterstitial();
        return true;
      } catch (err) {
        console.warn('[AdMob Interstitial] show error:', err);
        void this.preloadInterstitial();
        return false;
      }
    } finally {
      this.interstitialBusy = false;
    }
  }

  // ---------------------------------------------------------------------
  // Rewarded video
  // ---------------------------------------------------------------------

  /** Preloads (or reloads) the rewarded video in the background. */
  async preloadRewarded(): Promise<void> {
    if (!this.isSupported || this.rewardedReady || this.rewardedLoading) return;
    this.rewardedLoading = true;
    try {
      await AdMob.prepareRewardVideoAd({ adId: AD_UNIT_IDS.rewarded });
      this.rewardedReady = true;
      console.log('[AdMob Rewarded] Ready');
    } catch (err) {
      console.warn('[AdMob Rewarded] Failed to load:', err);
      this.rewardedReady = false;
    } finally {
      this.rewardedLoading = false;
    }
  }

  /**
   * Shows the rewarded video and resolves true ONLY when AdMob's own
   * reward callback fires. Never resolves true optimistically.
   * At most one rewarded ad can be in flight at a time (see `rewardedBusy`).
   */
  async showRewarded(): Promise<boolean> {
    if (!this.isSupported) return this.simulateWebRewardedAd();
    if (this.rewardedBusy()) return false;
    this.rewardedBusy.set(true);

    try {
      await this.initialize();
      if (!this.rewardedReady) await this.preloadRewarded();
      if (!this.rewardedReady) return false;
      this.rewardedReady = false;

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const handles: Promise<PluginListenerHandle>[] = [];
        const cleanup = () => handles.forEach((h) => h.then((handle) => handle.remove()).catch(() => {}));
        const finish = (granted: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();
          this.lastFullScreenAdTime = Date.now();
          this.roundsSinceInterstitial = 0;
          void this.preloadRewarded();
          resolve(granted);
        };

        handles.push(AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(false)));
        handles.push(
          AdMob.addListener(RewardAdPluginEvents.FailedToShow, (err) => {
            console.warn('[AdMob Rewarded] FailedToShow:', err);
            finish(false);
          })
        );

        AdMob.showRewardVideoAd()
          .then(() => finish(true))
          .catch((err) => {
            console.warn('[AdMob Rewarded] show error:', err);
            finish(false);
          });
      });
    } finally {
      this.rewardedBusy.set(false);
    }
  }

  /** Dev/browser-only stand-in for desktop testing. */
  private simulateWebRewardedAd(): Promise<boolean> {
    this.rewardedBusy.set(true);
    return new Promise((resolve) =>
      setTimeout(() => {
        this.rewardedBusy.set(false);
        this.lastFullScreenAdTime = Date.now();
        this.roundsSinceInterstitial = 0;
        resolve(true);
      }, 1500)
    );
  }
}
