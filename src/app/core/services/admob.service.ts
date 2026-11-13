import { Inject, Injectable, InjectionToken, OnDestroy, signal } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  AdMob, AdMobPlugin, AdmobConsentInfo, AdmobConsentStatus, BannerAdPluginEvents,
  BannerAdPosition, BannerAdSize, InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import {
  ADS_ENABLED, AD_UNIT_IDS, IS_TESTING_ADS, TEST_DEVICE_IDS, AD_REQUEST_INTERVAL_MS,
  AD_FAILURE_BACKOFF_MS, AD_CACHE_LIFETIME_MS, BANNER_HEIGHT_PX, BANNER_CONTROL_GAP_PX,
  INTERSTITIAL_EVERY_N_ROUNDS, INTERSTITIAL_MIN_INTERVAL_MS, FULLSCREEN_SESSION_LIMIT,
  REWARDED_MIN_INTERVAL_MS, REWARDED_LOAD_TIMEOUT_MS,
} from '../config/admob.config';

// Keep the Capacitor proxy inside a plain handle so Angular doesn't probe it for ngOnDestroy.
export const ADMOB_SDK = new InjectionToken<{ plugin: AdMobPlugin }>('AdMob SDK', {
  providedIn: 'root', factory: () => ({ plugin: AdMob }),
});
export type RewardFailureReason = 'not_ready' | 'dismissed_early' | 'failed_to_show' | 'busy'
  | 'unsupported' | 'consent' | 'cooldown' | 'session_limit' | 'unsupported_reward';

/** One request per format at a time. No automatic retries, refreshes, or production test fallback. */
@Injectable({ providedIn: 'root' })
export class AdmobService implements OnDestroy {
  readonly isSupported = Capacitor.isNativePlatform();
  readonly rewardedBusy = signal(false);
  readonly fullScreenAdActive = signal(false);
  readonly bannerLoaded = signal(false);
  readonly privacyOptionsRequired = signal(false);
  lastRewardFailureReason?: RewardFailureReason;

  private disposed = false;
  private sdkInitialized = false;
  private consentAllowsAds = false;
  private initPromise?: Promise<void>;
  private initRetryAt = 0;
  private bannerDesired = false;
  private bannerCreated = false;
  private bannerVisible = false;
  private bannerTask: Promise<void> = Promise.resolve();
  private bannerNextRequestAt = 0;
  private bannerListenersRegistered = false;
  private readonly bannerHandles: PluginListenerHandle[] = [];
  private interstitialLoadedAt: number | null = null;
  private rewardedLoadedAt: number | null = null;
  private interstitialNextRequestAt = 0;
  private rewardedNextRequestAt = 0;
  private interstitialLoad?: Promise<boolean>;
  private rewardedLoad?: Promise<boolean>;
  private completedRounds = 0;
  private readonly recordedRounds = new Set<string>();
  private readonly startedAt = Date.now();
  private lastFullScreenAt: number | null = null;
  private fullScreenCount = 0;
  private cancelFullScreen?: () => void;

  private readonly sdk: AdMobPlugin;
  constructor(@Inject(ADMOB_SDK) handle: { plugin: AdMobPlugin }) { this.sdk = handle.plugin; }

  private foreground(): boolean {
    return !this.disposed && ADS_ENABLED && this.isSupported && !document.hidden && navigator.onLine;
  }

  initialize(): Promise<void> {
    if (!this.foreground() || Date.now() < this.initRetryAt) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        let info = await this.sdk.requestConsentInfo();
        if (!this.foreground()) return;
        if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) {
          info = await this.sdk.showConsentForm();
        }
        this.applyConsent(info);
        if (!this.consentAllowsAds || !this.foreground()) return;
        if (!this.sdkInitialized) {
          await this.sdk.initialize({ initializeForTesting: IS_TESTING_ADS, testingDevices: TEST_DEVICE_IDS });
          this.sdkInitialized = true;
        }
      } catch {
        this.consentAllowsAds = false;
        this.initRetryAt = Date.now() + AD_FAILURE_BACKOFF_MS;
      }
    })().finally(() => {
      if (!this.consentAllowsAds || !this.sdkInitialized) this.initPromise = undefined;
    });
    return this.initPromise;
  }

  private applyConsent(info: AdmobConsentInfo): void {
    this.consentAllowsAds = info.canRequestAds === true;
    this.privacyOptionsRequired.set(info.privacyOptionsRequirementStatus === 'REQUIRED');
    this.initRetryAt = this.consentAllowsAds ? 0 : Date.now() + AD_FAILURE_BACKOFF_MS;
  }

  private async ready(): Promise<boolean> {
    if (!this.foreground()) return false;
    await this.initialize();
    return this.foreground() && this.sdkInitialized && this.consentAllowsAds;
  }

  async showPrivacyOptions(): Promise<void> {
    if (!this.foreground() || this.fullScreenAdActive()) return;
    this.fullScreenAdActive.set(true);
    try {
      await this.hideBanner();
      await this.sdk.showPrivacyOptionsForm();
      this.applyConsent(await this.sdk.requestConsentInfo());
      this.interstitialLoadedAt = this.rewardedLoadedAt = null;
      if (this.bannerCreated) await this.sdk.removeBanner();
      this.bannerCreated = this.bannerVisible = false;
      this.bannerLoaded.set(false);
      this.initPromise = undefined;
    } finally {
      this.fullScreenAdActive.set(false);
    }
  }

  showBanner(): Promise<void> {
    this.bannerDesired = this.foreground();
    this.updateBannerSpace();
    return this.queueBanner();
  }

  async hideBanner(): Promise<void> {
    this.bannerDesired = false;
    await this.queueBanner();
    if (!this.bannerDesired) this.setBannerSpace(false);
  }

  private queueBanner(): Promise<void> {
    this.bannerTask = this.bannerTask.then(() => this.syncBanner()).catch(() => {
      this.bannerNextRequestAt = Date.now() + AD_FAILURE_BACKOFF_MS;
    }).finally(() => {
      this.updateBannerSpace();
    });
    return this.bannerTask;
  }

  private async syncBanner(): Promise<void> {
    if (!this.bannerDesired || !this.foreground() || this.fullScreenAdActive()) {
      if (this.bannerVisible) {
        await this.hideNativeBanner();
      }
      return;
    }
    if (this.bannerVisible || !await this.ready() || !this.bannerDesired) return;
    if (this.bannerCreated) {
      await this.sdk.resumeBanner();
      this.bannerVisible = true;
    } else {
      if (Date.now() < this.bannerNextRequestAt) return;
      await this.registerBannerListeners();
      if (!this.bannerDesired || !this.foreground() || this.fullScreenAdActive()) return;
      this.bannerNextRequestAt = Date.now() + AD_REQUEST_INTERVAL_MS;
      try {
        await this.sdk.showBanner({ adId: AD_UNIT_IDS.banner, adSize: BannerAdSize.BANNER,
          position: BannerAdPosition.BOTTOM_CENTER, margin: 0, isTesting: IS_TESTING_ADS });
        this.bannerCreated = this.bannerVisible = true;
      } catch {
        this.bannerNextRequestAt = Date.now() + AD_FAILURE_BACKOFF_MS;
        this.bannerLoaded.set(false);
        return;
      }
    }
    // A route/background change while the native request was pending must still hide the result.
    if (!this.bannerDesired || !this.foreground() || this.fullScreenAdActive()) {
      await this.hideNativeBanner();
    }
  }

  private async hideNativeBanner(): Promise<void> {
    try { await this.sdk.hideBanner(); }
    catch {
      await this.sdk.removeBanner();
      this.bannerCreated = false;
      this.bannerLoaded.set(false);
    } finally { this.bannerVisible = false; }
  }

  private async registerBannerListeners(): Promise<void> {
    if (this.bannerListenersRegistered) return;
    const handles = await Promise.all([
      this.sdk.addListener(BannerAdPluginEvents.Loaded, () => {
        this.bannerLoaded.set(true);
        this.updateBannerSpace();
      }),
      this.sdk.addListener(BannerAdPluginEvents.FailedToLoad, () => {
        this.bannerLoaded.set(false);
        this.bannerCreated = this.bannerVisible = false;
        this.bannerNextRequestAt = Date.now() + AD_FAILURE_BACKOFF_MS;
        this.updateBannerSpace();
      }),
      this.sdk.addListener(BannerAdPluginEvents.SizeChanged, ({ height }) => {
        if (height <= 0) {
          this.bannerVisible = false;
          this.updateBannerSpace();
        }
      }),
    ]);
    if (this.disposed) { await Promise.all(handles.map((handle) => handle.remove())); return; }
    this.bannerHandles.push(...handles);
    this.bannerListenersRegistered = true;
  }

  private setBannerSpace(reserved: boolean): void {
    // Keep a gap above a visible 320x50 banner; no ad means no empty menu offset.
    const space = reserved ? BANNER_HEIGHT_PX + BANNER_CONTROL_GAP_PX : 0;
    document.documentElement.style.setProperty('--ad-banner-space', `${space}px`);
  }

  private updateBannerSpace(): void {
    this.setBannerSpace(this.bannerDesired && this.bannerVisible && this.bannerLoaded()
      && this.foreground() && !this.fullScreenAdActive());
  }

  recordCompletedRound(sessionId: string): void {
    if (!sessionId || this.recordedRounds.has(sessionId)) return;
    this.recordedRounds.add(sessionId);
    this.completedRounds++;
    if (this.completedRounds >= INTERSTITIAL_EVERY_N_ROUNDS) void this.preloadInterstitial();
  }

  private fresh(loadedAt: number | null): boolean {
    return loadedAt !== null && Date.now() - loadedAt < AD_CACHE_LIFETIME_MS;
  }

  private async preloadInterstitial(): Promise<boolean> {
    if (!this.foreground() || this.fullScreenAdActive()) return false;
    if (this.fresh(this.interstitialLoadedAt)) return true;
    if (this.interstitialLoad) return this.interstitialLoad;
    if (Date.now() < this.interstitialNextRequestAt) return false;
    this.interstitialNextRequestAt = Date.now() + AD_REQUEST_INTERVAL_MS;
    this.interstitialLoad = (async () => {
      try {
        if (!await this.ready()) return false;
        await this.sdk.prepareInterstitial({ adId: AD_UNIT_IDS.interstitial, isTesting: IS_TESTING_ADS });
        this.interstitialLoadedAt = Date.now();
        return true;
      } catch {
        this.interstitialNextRequestAt = Date.now() + AD_FAILURE_BACKOFF_MS;
        return false;
      } finally { this.interstitialLoad = undefined; }
    })();
    return this.interstitialLoad;
  }

  async maybeShowInterstitialAtBreakpoint(): Promise<void> {
    if (!this.foreground() || this.fullScreenAdActive() || this.rewardedBusy()
      || this.completedRounds < INTERSTITIAL_EVERY_N_ROUNDS || this.fullScreenCount >= FULLSCREEN_SESSION_LIMIT
      || Date.now() - (this.lastFullScreenAt ?? this.startedAt) < INTERSTITIAL_MIN_INTERVAL_MS) return;
    // Never wait for an ad at navigation time or display a late load on the next screen.
    if (!this.fresh(this.interstitialLoadedAt)) { void this.preloadInterstitial(); return; }
    this.interstitialLoadedAt = null;
    this.fullScreenAdActive.set(true);
    try {
      await this.hideBanner();
      if (!this.foreground()) return;
      const shown = await this.presentInterstitial();
      if (shown) this.completedRounds = 0;
    } finally { this.fullScreenAdActive.set(false); }
  }

  private async presentInterstitial(): Promise<boolean> {
    return new Promise((resolve) => {
      const handles: PluginListenerHandle[] = [];
      let settled = false;
      const timer = setTimeout(() => finish(false), 180_000);
      const finish = (shown: boolean) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.cancelFullScreen = undefined;
        handles.forEach((handle) => void handle.remove().catch(() => undefined));
        this.noteFullScreen(); resolve(shown);
      };
      this.cancelFullScreen = () => finish(false);
      const track = async (registration: Promise<PluginListenerHandle>) => {
        const handle = await registration;
        if (settled) await handle.remove();
        else handles.push(handle);
      };
      void (async () => {
        try {
          await track(this.sdk.addListener(InterstitialAdPluginEvents.Dismissed, () => finish(true)));
          await track(this.sdk.addListener(InterstitialAdPluginEvents.FailedToShow, () => finish(false)));
          if (settled || !this.foreground()) { finish(false); return; }
          await this.sdk.showInterstitial();
        } catch { finish(false); }
      })();
    });
  }

  async showRewarded(placement: 'cosmetic-unlock'): Promise<boolean> {
    this.lastRewardFailureReason = undefined;
    if (placement !== 'cosmetic-unlock') { this.lastRewardFailureReason = 'unsupported_reward'; return false; }
    if (!this.foreground()) { this.lastRewardFailureReason = 'unsupported'; return false; }
    if (this.rewardedBusy() || this.fullScreenAdActive()) { this.lastRewardFailureReason = 'busy'; return false; }
    if (this.fullScreenCount >= FULLSCREEN_SESSION_LIMIT) { this.lastRewardFailureReason = 'session_limit'; return false; }
    if (this.lastFullScreenAt !== null && Date.now() - this.lastFullScreenAt < REWARDED_MIN_INTERVAL_MS) {
      this.lastRewardFailureReason = 'cooldown'; return false;
    }
    this.rewardedBusy.set(true);
    this.fullScreenAdActive.set(true);
    try {
      await this.hideBanner();
      if (!await this.ready()) { this.lastRewardFailureReason = 'consent'; return false; }
      const loaded = await this.withLoadTimeout(this.loadRewarded());
      if (!loaded || !this.foreground()) { this.lastRewardFailureReason = 'not_ready'; return false; }
      this.rewardedLoadedAt = null;
      return await this.presentRewarded();
    } catch { this.lastRewardFailureReason = 'failed_to_show'; return false; }
    finally { this.fullScreenAdActive.set(false); this.rewardedBusy.set(false); }
  }

  private loadRewarded(): Promise<boolean> {
    if (this.fresh(this.rewardedLoadedAt)) return Promise.resolve(true);
    if (this.rewardedLoad) return this.rewardedLoad;
    if (Date.now() < this.rewardedNextRequestAt) return Promise.resolve(false);
    this.rewardedNextRequestAt = Date.now() + AD_REQUEST_INTERVAL_MS;
    this.rewardedLoad = (async () => {
      try {
        await this.sdk.prepareRewardVideoAd({ adId: AD_UNIT_IDS.rewarded, isTesting: IS_TESTING_ADS });
        this.rewardedLoadedAt = Date.now(); return true;
      } catch { this.rewardedNextRequestAt = Date.now() + AD_FAILURE_BACKOFF_MS; return false; }
      finally { this.rewardedLoad = undefined; }
    })();
    return this.rewardedLoad;
  }

  private async withLoadTimeout(load: Promise<boolean>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([load, new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), REWARDED_LOAD_TIMEOUT_MS);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private presentRewarded(): Promise<boolean> {
    return new Promise((resolve) => {
      const handles: PluginListenerHandle[] = [];
      let earned = false; let settled = false;
      const timer = setTimeout(() => finish(false, 'failed_to_show'), 300_000);
      const finish = (granted: boolean, reason?: RewardFailureReason) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.cancelFullScreen = undefined;
        handles.forEach((handle) => void handle.remove().catch(() => undefined));
        this.noteFullScreen(); this.lastRewardFailureReason = reason; resolve(granted);
      };
      this.cancelFullScreen = () => finish(false, 'failed_to_show');
      const track = async (registration: Promise<PluginListenerHandle>) => {
        const handle = await registration;
        if (settled) await handle.remove();
        else handles.push(handle);
      };
      void (async () => {
        try {
          await track(this.sdk.addListener(RewardAdPluginEvents.Rewarded, () => { earned = true; }));
          await track(this.sdk.addListener(RewardAdPluginEvents.Dismissed, () => {
            // Flush the SDK promise's earned-reward callback before interpreting dismissal.
            queueMicrotask(() => finish(earned, earned ? undefined : 'dismissed_early'));
          }));
          await track(this.sdk.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false, 'failed_to_show')));
          if (settled || !this.foreground()) { finish(false, 'failed_to_show'); return; }
          // The native plugin resolves this promise on OnUserEarnedReward, not on presentation.
          const reward = await this.sdk.showRewardVideoAd();
          if (reward) earned = true;
        } catch { finish(false, 'failed_to_show'); }
      })();
    });
  }

  private noteFullScreen(): void {
    this.lastFullScreenAt = Date.now(); this.fullScreenCount++;
  }

  ngOnDestroy(): void {
    this.disposed = true; this.bannerDesired = false;
    this.cancelFullScreen?.();
    this.bannerHandles.forEach((handle) => void handle.remove().catch(() => undefined));
    if (this.bannerCreated) void this.sdk.removeBanner().catch(() => undefined);
    this.setBannerSpace(false);
  }
}
