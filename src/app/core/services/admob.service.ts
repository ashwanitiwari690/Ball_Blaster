import { Injectable, signal } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  AdmobConsentStatus,
  AdMobError,
  AdMobRewardItem,
  BannerAdOptions,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import {
  AD_UNIT_IDS,
  IS_TESTING_ADS,
  INTERSTITIAL_EVERY_N_ROUNDS,
  INTERSTITIAL_MIN_INTERVAL_MS,
  INTERSTITIAL_TIMEOUT_MS,
} from '../config/admob.config';

export type RewardFailureReason = 'not_ready' | 'dismissed_early' | 'failed_to_show' | 'busy' | 'unsupported';

/**
 * Production-grade AdMob service following the architectural pattern from Escape the Monster:
 * 1. Google UMP Consent Management Platform (GDPR / UK / CPRA) integration.
 * 2. Banner lifecycle with singleton listener deduplication, resume/hide, and bounded backoff retry.
 * 3. Policy-safe Interstitial pacing (every N rounds + cooldown interval) with dismissal tracking.
 * 4. Decoupled Rewarded ad lifecycle: reward verification is separated from dismissal callbacks,
 *    ensuring rewards are strictly earned and never denied or granted prematurely.
 * 5. Automatic test inventory fallback: during testing/review, if new production ad units return
 *    ERROR_CODE_NO_FILL before AdMob approval, seamlessly falls back to test inventory so ads always
 *    display and game reward actions always execute.
 * 6. Concurrency locks preventing double-tap triggers and overlapping ad displays.
 * 7. Dynamic CSS safe-area spacing (--ad-banner-space) to avoid overlapping gameplay controls or navigation.
 */
@Injectable({ providedIn: 'root' })
export class AdmobService {
  readonly isSupported = Capacitor.isNativePlatform();

  /** True while a rewarded ad is loading or being presented across the app. */
  readonly rewardedBusy = signal(false);

  /** True while ANY full-screen ad (interstitial or rewarded) is covering the screen. */
  readonly fullScreenAdActive = signal(false);

  /** True when the bottom banner has successfully loaded and rendered. */
  readonly bannerLoaded = signal(false);

  /** Diagnostic failure reason for the most recent rewarded ad request. */
  lastRewardFailureReason?: RewardFailureReason;

  private initPromise?: Promise<void>;

  // Banner state
  private bannerCreated = false;
  private bannerVisible = false;
  private bannerDesired = false;
  private bannerListenersRegistered = false;
  private bannerRetryTimer?: ReturnType<typeof setTimeout>;
  private bannerRetryAttempts = 0;
  private readonly MAX_BANNER_RETRIES = 3;
  private lastKnownBannerHeight = 50;

  // Interstitial state
  private interstitialReady = false;
  private interstitialLoading = false;
  private interstitialBusy = false;
  private interstitialLoadPromise?: Promise<boolean>;
  private interstitialRetryTimer?: ReturnType<typeof setTimeout>;
  private interstitialRetryAttempts = 0;
  private readonly MAX_INTERSTITIAL_RETRIES = 3;
  private roundsSinceInterstitial = 0;
  private lastFullScreenAdTime = 0;

  // Rewarded state
  private rewardedReady = false;
  private rewardedLoading = false;
  private rewardedLoadPromise?: Promise<boolean>;
  private rewardedRetryTimer?: ReturnType<typeof setTimeout>;
  private rewardedRetryAttempts = 0;
  private readonly MAX_REWARDED_RETRIES = 3;

  /**
   * Initializes Google Mobile Ads SDK and requests UMP consent if applicable.
   * Safe to call repeatedly; returns the memoized init promise.
   */
  initialize(): Promise<void> {
    if (!this.isSupported) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = (async () => {
        // Step 1: User Messaging Platform (UMP) Consent
        try {
          console.log('[AdMob] Checking UMP consent info...');
          const consentInfo = await AdMob.requestConsentInfo();
          if (
            consentInfo?.status === AdmobConsentStatus.REQUIRED &&
            consentInfo?.isConsentFormAvailable
          ) {
            console.log('[AdMob] Presenting UMP consent form...');
            await AdMob.showConsentForm();
          }
        } catch (consentErr) {
          console.warn('[AdMob] UMP consent bypassed or unavailable:', consentErr);
        }

        // Step 2: Initialize Mobile Ads SDK
        try {
          console.log('[AdMob] Initializing Google Mobile Ads SDK...');
          await AdMob.initialize({});
          console.log('[AdMob] Mobile Ads SDK initialized successfully.');
        } catch (initErr) {
          console.error('[AdMob] Mobile Ads SDK initialization error:', initErr);
        }

        // Step 3: Register singleton banner listeners
        await this.registerBannerListeners();

        // Step 4: Preload initial full-screen ad units in background
        void this.preloadInterstitial();
        void this.preloadRewarded();
      })();
    }
    return this.initPromise;
  }

  // ---------------------------------------------------------------------
  // Banner
  // ---------------------------------------------------------------------

  /**
   * Registers global listeners for banner events once.
   * Prevents duplicate listener registration across navigations.
   */
  private async registerBannerListeners(): Promise<void> {
    if (this.bannerListenersRegistered || !this.isSupported) return;
    this.bannerListenersRegistered = true;

    try {
      await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
        console.log('[AdMob Banner] Banner loaded successfully.');
        this.bannerLoaded.set(true);
        this.bannerRetryAttempts = 0;
        if (this.bannerRetryTimer) {
          clearTimeout(this.bannerRetryTimer);
          this.bannerRetryTimer = undefined;
        }
      });

      await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (err: AdMobError) => {
        console.warn('[AdMob Banner] FailedToLoad:', err);
        this.bannerLoaded.set(false);
        this.setBannerSpace(0);
        this.scheduleBannerRetry();
      });

      await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (info) => {
        console.log('[AdMob Banner] Size changed height:', info.height);
        if (this.bannerDesired) {
          this.setBannerSpace(info.height);
        }
      });
    } catch (err) {
      console.warn('[AdMob Banner] Failed to attach listeners:', err);
    }
  }

  /**
   * Shows the bottom adaptive banner. Safe to call repeatedly across screen changes.
   */
  async showBanner(): Promise<void> {
    if (!this.isSupported) return;
    this.bannerDesired = true;
    if (this.bannerVisible) return;

    await this.initialize();
    if (!this.bannerDesired) return;

    if (this.bannerCreated) {
      try {
        await AdMob.resumeBanner();
        this.bannerVisible = true;
        this.setBannerSpace(this.lastKnownBannerHeight || 50);
        console.log('[AdMob Banner] Resumed.');
        return;
      } catch (err) {
        console.warn('[AdMob Banner] resumeBanner failed, recreating fresh:', err);
        this.bannerCreated = false;
      }
    }

    const options: BannerAdOptions = {
      adId: AD_UNIT_IDS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: IS_TESTING_ADS,
    };

    try {
      console.log('[AdMob Banner] Requesting banner ad unit:', AD_UNIT_IDS.banner);
      await AdMob.showBanner(options);
      this.bannerCreated = true;
      this.bannerVisible = true;
      console.log('[AdMob Banner] Displayed.');
    } catch (err) {
      console.warn('[AdMob Banner] showBanner error:', err);
      // Fallback: if production ad unit failed (e.g. no fill), try test inventory
      if (!IS_TESTING_ADS) {
        try {
          console.log('[AdMob Banner] Retrying with test inventory fallback...');
          await AdMob.showBanner({ ...options, isTesting: true });
          this.bannerCreated = true;
          this.bannerVisible = true;
          console.log('[AdMob Banner] Fallback test banner displayed.');
          return;
        } catch (fallbackErr) {
          console.warn('[AdMob Banner] Fallback banner failed:', fallbackErr);
        }
      }
      this.bannerVisible = false;
      this.setBannerSpace(0);
      this.scheduleBannerRetry();
    }
  }

  /**
   * Hides the banner (e.g. during active gameplay so it never obstructs cannon controls).
   * Resets the safe-area CSS spacer variable immediately.
   */
  async hideBanner(): Promise<void> {
    this.bannerDesired = false;
    if (this.bannerRetryTimer) {
      clearTimeout(this.bannerRetryTimer);
      this.bannerRetryTimer = undefined;
    }
    if (!this.isSupported || !this.bannerVisible) {
      this.setBannerSpace(0);
      return;
    }
    try {
      console.log('[AdMob Banner] Hiding banner.');
      await AdMob.hideBanner();
    } catch (err) {
      console.warn('[AdMob Banner] hideBanner error:', err);
    } finally {
      this.bannerVisible = false;
      this.setBannerSpace(0);
    }
  }

  private scheduleBannerRetry(): void {
    if (!this.bannerDesired || this.bannerRetryAttempts >= this.MAX_BANNER_RETRIES) return;
    this.bannerRetryAttempts++;
    const delay = Math.min(45000, 10000 * Math.pow(2, this.bannerRetryAttempts - 1));
    console.log(`[AdMob Banner] Scheduling retry #${this.bannerRetryAttempts} in ${delay}ms`);
    if (this.bannerRetryTimer) clearTimeout(this.bannerRetryTimer);
    this.bannerRetryTimer = setTimeout(() => {
      if (this.bannerDesired && !this.bannerVisible) {
        void this.showBanner();
      }
    }, delay);
  }

  /**
   * Exposes the banner's live height as CSS vars so bottom-nav and page spacers adjust seamlessly.
   */
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

  /**
   * Preloads an interstitial in the background with bounded retry and test fallback.
   * Returns a shared promise if a request is already in-flight.
   */
  async preloadInterstitial(): Promise<boolean> {
    if (!this.isSupported) return false;
    if (this.interstitialReady) return true;
    if (this.interstitialLoadPromise) return this.interstitialLoadPromise;
    if (this.fullScreenAdActive()) return false;

    this.interstitialLoading = true;
    this.interstitialLoadPromise = (async () => {
      try {
        console.log('[AdMob Interstitial] Preparing ad unit:', AD_UNIT_IDS.interstitial);
        await AdMob.prepareInterstitial({
          adId: AD_UNIT_IDS.interstitial,
          isTesting: IS_TESTING_ADS,
        });
        this.interstitialReady = true;
        this.interstitialRetryAttempts = 0;
        console.log('[AdMob Interstitial] Ready');
        return true;
      } catch (err) {
        console.warn('[AdMob Interstitial] Primary load failed:', err);
        // Fallback: if production ad unit failed (e.g. no fill on unapproved unit), try test inventory
        if (!IS_TESTING_ADS) {
          try {
            console.log('[AdMob Interstitial] Attempting fallback to test inventory...');
            await AdMob.prepareInterstitial({
              adId: AD_UNIT_IDS.interstitial,
              isTesting: true,
            });
            this.interstitialReady = true;
            this.interstitialRetryAttempts = 0;
            console.log('[AdMob Interstitial] Fallback test interstitial ready');
            return true;
          } catch (fallbackErr) {
            console.warn('[AdMob Interstitial] Fallback also failed:', fallbackErr);
          }
        }
        this.interstitialReady = false;
        this.scheduleInterstitialRetry();
        return false;
      } finally {
        this.interstitialLoading = false;
        this.interstitialLoadPromise = undefined;
      }
    })();

    return this.interstitialLoadPromise;
  }

  private scheduleInterstitialRetry(): void {
    if (this.interstitialReady || this.interstitialRetryAttempts >= this.MAX_INTERSTITIAL_RETRIES) return;
    this.interstitialRetryAttempts++;
    const delay = Math.min(30000, 5000 * Math.pow(2, this.interstitialRetryAttempts - 1));
    console.log(`[AdMob Interstitial] Scheduling retry #${this.interstitialRetryAttempts} in ${delay}ms`);
    if (this.interstitialRetryTimer) clearTimeout(this.interstitialRetryTimer);
    this.interstitialRetryTimer = setTimeout(() => {
      void this.preloadInterstitial();
    }, delay);
  }

  /**
   * Paced display of interstitial ads at natural transition points (e.g. game over navigation).
   * Complies with Google frequency capping: min rounds and cooldown time.
   */
  async maybeShowInterstitialAtBreakpoint(): Promise<void> {
    if (!this.isSupported) return;
    this.roundsSinceInterstitial++;
    const timeSinceLastAd = Date.now() - this.lastFullScreenAdTime;
    if (
      this.roundsSinceInterstitial < INTERSTITIAL_EVERY_N_ROUNDS ||
      timeSinceLastAd < INTERSTITIAL_MIN_INTERVAL_MS
    ) {
      console.log(
        `[AdMob Interstitial] Breakpoint skipped: rounds=${this.roundsSinceInterstitial}/${INTERSTITIAL_EVERY_N_ROUNDS}, time=${Math.round(timeSinceLastAd / 1000)}s`
      );
      return;
    }
    this.roundsSinceInterstitial = 0;
    await this.showInterstitial();
  }

  /**
   * Shows the interstitial ad if ready or quickly available within INTERSTITIAL_TIMEOUT_MS.
   * Awaits user dismissal before resolving to guarantee smooth navigation.
   */
  async showInterstitial(): Promise<boolean> {
    if (!this.isSupported || this.interstitialBusy || this.fullScreenAdActive()) return false;
    this.interstitialBusy = true;

    try {
      await this.initialize();
      if (!this.interstitialReady) {
        console.log('[AdMob Interstitial] Awaiting load within timeout...');
        await Promise.race([
          this.preloadInterstitial(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), INTERSTITIAL_TIMEOUT_MS)),
        ]);
      }
      if (!this.interstitialReady) {
        console.warn('[AdMob Interstitial] Not ready; continuing without delay.');
        return false;
      }

      this.interstitialReady = false;
      this.fullScreenAdActive.set(true);

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const handles: Promise<PluginListenerHandle>[] = [];
        let safetyTimer: ReturnType<typeof setTimeout>;

        const cleanup = () => {
          if (safetyTimer) clearTimeout(safetyTimer);
          handles.forEach((h) => h.then((handle) => handle.remove()).catch(() => {}));
        };

        const finish = (shown: boolean) => {
          if (settled) return;
          settled = true;
          cleanup();
          this.lastFullScreenAdTime = Date.now();
          console.log(`[AdMob Interstitial] Finished (shown=${shown})`);
          resolve(shown);
        };

        handles.push(AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => finish(true)));
        handles.push(
          AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, (err: AdMobError) => {
            console.warn('[AdMob Interstitial] FailedToShow:', err);
            finish(false);
          })
        );

        safetyTimer = setTimeout(() => {
          console.warn('[AdMob Interstitial] Safety timeout reached.');
          finish(false);
        }, 180000);

        // Call without arguments so plugin resolves to lastPreparedAdId
        AdMob.showInterstitial()
          .then(() => console.log('[AdMob Interstitial] Presented.'))
          .catch((err) => {
            console.warn('[AdMob Interstitial] showInterstitial error:', err);
            finish(false);
          });
      });
    } finally {
      this.fullScreenAdActive.set(false);
      this.interstitialBusy = false;
      setTimeout(() => void this.preloadInterstitial(), 800);
    }
  }

  // ---------------------------------------------------------------------
  // Rewarded Video
  // ---------------------------------------------------------------------

  /**
   * Preloads a rewarded video ad with bounded backoff retry.
   * If production ad unit returns no fill during testing/unapproved phase,
   * falls back to test inventory so that user ad buttons always display ads.
   */
  async preloadRewarded(): Promise<boolean> {
    if (!this.isSupported) return false;
    if (this.rewardedReady) return true;
    if (this.rewardedLoadPromise) return this.rewardedLoadPromise;
    if (this.fullScreenAdActive()) return false;

    this.rewardedLoading = true;
    this.rewardedLoadPromise = (async () => {
      try {
        console.log('[AdMob Rewarded] Preparing ad with ID:', AD_UNIT_IDS.rewarded);
        await AdMob.prepareRewardVideoAd({
          adId: AD_UNIT_IDS.rewarded,
          isTesting: IS_TESTING_ADS,
        });
        this.rewardedReady = true;
        this.rewardedRetryAttempts = 0;
        console.log('[AdMob Rewarded] Ready to show');
        return true;
      } catch (err) {
        console.warn('[AdMob Rewarded] Primary load failed:', err);
        // Fallback: if production ad unit failed (e.g. no fill on unapproved unit), try test inventory
        if (!IS_TESTING_ADS) {
          try {
            console.log('[AdMob Rewarded] Attempting fallback to test inventory...');
            await AdMob.prepareRewardVideoAd({
              adId: AD_UNIT_IDS.rewarded,
              isTesting: true,
            });
            this.rewardedReady = true;
            this.rewardedRetryAttempts = 0;
            console.log('[AdMob Rewarded] Fallback test ad ready to show');
            return true;
          } catch (fallbackErr) {
            console.warn('[AdMob Rewarded] Fallback also failed:', fallbackErr);
          }
        }
        this.rewardedReady = false;
        this.scheduleRewardedRetry();
        return false;
      } finally {
        this.rewardedLoading = false;
        this.rewardedLoadPromise = undefined;
      }
    })();

    return this.rewardedLoadPromise;
  }

  private scheduleRewardedRetry(): void {
    if (this.rewardedReady || this.rewardedRetryAttempts >= this.MAX_REWARDED_RETRIES) return;
    this.rewardedRetryAttempts++;
    const delay = Math.min(30000, 5000 * Math.pow(2, this.rewardedRetryAttempts - 1));
    console.log(`[AdMob Rewarded] Scheduling retry #${this.rewardedRetryAttempts} in ${delay}ms`);
    if (this.rewardedRetryTimer) clearTimeout(this.rewardedRetryTimer);
    this.rewardedRetryTimer = setTimeout(() => {
      void this.preloadRewarded();
    }, delay);
  }

  /**
   * Shows a rewarded video ad and resolves true ONLY when the reward callback fires.
   * Decouples Rewarded from Dismissed:
   * - Rewarded: marks rewardEarned = true.
   * - Dismissed: finishes and returns rewardEarned.
   * - FailedToShow / early close without reward: returns false.
   * Sets `lastRewardFailureReason` so callers display accurate user feedback.
   */
  async showRewarded(): Promise<boolean> {
    this.lastRewardFailureReason = undefined;

    if (!this.isSupported) {
      return this.simulateWebRewardedAd();
    }

    if (this.rewardedBusy() || this.fullScreenAdActive()) {
      this.lastRewardFailureReason = 'busy';
      return false;
    }

    this.rewardedBusy.set(true);
    this.fullScreenAdActive.set(true);

    try {
      await this.initialize();
      if (!this.rewardedReady) {
        console.log('[AdMob Rewarded] Ad not ready yet, awaiting load...');
        await Promise.race([
          this.preloadRewarded(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
      }

      if (!this.rewardedReady) {
        console.warn('[AdMob Rewarded] Ad was not ready to show.');
        this.lastRewardFailureReason = 'not_ready';
        return false;
      }

      this.rewardedReady = false;

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        let rewardEarned = false;
        const handles: Promise<PluginListenerHandle>[] = [];
        let safetyTimer: ReturnType<typeof setTimeout>;

        const cleanup = () => {
          if (safetyTimer) clearTimeout(safetyTimer);
          handles.forEach((h) => h.then((handle) => handle.remove()).catch(() => {}));
        };

        const finish = (granted: boolean, reason?: RewardFailureReason) => {
          if (settled) return;
          settled = true;
          cleanup();
          this.lastFullScreenAdTime = Date.now();
          this.roundsSinceInterstitial = 0;
          if (!granted) {
            this.lastRewardFailureReason = reason ?? (rewardEarned ? undefined : 'dismissed_early');
          }
          console.log(`[AdMob Rewarded] Session ended. Granted: ${granted}, reason: ${this.lastRewardFailureReason}`);
          resolve(granted);
        };

        // 1. Reward verified event
        handles.push(
          AdMob.addListener(RewardAdPluginEvents.Rewarded, (item: AdMobRewardItem) => {
            console.log('[AdMob Rewarded] RewardAdPluginEvents.Rewarded verified:', item);
            rewardEarned = true;
          })
        );

        // 2. Dismissed event
        handles.push(
          AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
            console.log(`[AdMob Rewarded] Dismissed. Earned: ${rewardEarned}`);
            finish(rewardEarned, rewardEarned ? undefined : 'dismissed_early');
          })
        );

        // 3. Failed to show event
        handles.push(
          AdMob.addListener(RewardAdPluginEvents.FailedToShow, (err: AdMobError) => {
            console.warn('[AdMob Rewarded] FailedToShow:', err);
            finish(false, 'failed_to_show');
          })
        );

        // 4. Safety fallback (5 minutes)
        safetyTimer = setTimeout(() => {
          console.warn('[AdMob Rewarded] Safety timeout reached.');
          finish(rewardEarned, rewardEarned ? undefined : 'not_ready');
        }, 300000);

        // 5. Present ad (no options passed so native plugin resolves to lastPreparedAdId)
        AdMob.showRewardVideoAd()
          .then((item: AdMobRewardItem) => {
            console.log('[AdMob Rewarded] showRewardVideoAd completed:', item);
            if (item) rewardEarned = true;
          })
          .catch((err) => {
            console.warn('[AdMob Rewarded] showRewardVideoAd error:', err);
            finish(false, 'failed_to_show');
          });
      });
    } finally {
      this.fullScreenAdActive.set(false);
      this.rewardedBusy.set(false);
      setTimeout(() => void this.preloadRewarded(), 800);
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
