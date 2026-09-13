import { Injectable } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { AdMob, RewardAdPluginEvents } from '@capacitor-community/admob';
import { AD_LOAD_TIMEOUT_MS, AD_UNIT_IDS, INTERSTITIAL_EVERY_N_ROUNDS } from '../config/admob.config';

/**
 * Thin wrapper around @capacitor-community/admob — the ONLY file in the app
 * that talks to the plugin directly. Every page goes through this service,
 * never through `AdMob` itself, so ad-provider details never leak into page
 * components.
 *
 * Ads only run on native platforms (`Capacitor.isNativePlatform()`); on the
 * web the plugin isn't present at all, so every method here is a safe no-op
 * that resolves `false`/does nothing. Callers must treat `false` from
 * `showRewarded()` as "no reward" — never grant anything optimistically.
 *
 * No persistent banner: this app only shows interstitial/rewarded ads,
 * matching the rest of this project's sibling Ionic games — an always-on
 * banner risked covering the bottom nav. AdMob is still initialized at boot
 * so interstitial/rewarded ads are preloaded and ready by the time the
 * player reaches a breakpoint or a reward flow.
 */
@Injectable({ providedIn: 'root' })
export class AdmobService {
  readonly isSupported = Capacitor.isNativePlatform();

  private initPromise?: Promise<void>;

  private interstitialReady = false;
  private interstitialLoading = false;
  private interstitialShowing = false;
  private roundsSinceInterstitial = 0;

  private rewardedReady = false;
  private rewardedLoading = false;
  private rewardedShowing = false;

  initialize(): Promise<void> {
    if (!this.isSupported) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = AdMob.initialize({ initializeForTesting: true })
        .then(() => {
          void this.preloadInterstitial();
          void this.preloadRewarded();
        })
        .catch(() => {});
    }
    return this.initPromise;
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
    } catch {
      this.interstitialReady = false;
    } finally {
      this.interstitialLoading = false;
    }
  }

  /**
   * Call at a natural breakpoint (e.g. leaving a finished game round). Shows
   * an interstitial only every INTERSTITIAL_EVERY_N_ROUNDS calls, so ads stay
   * frequent without breaching AdMob's full-screen-ad frequency policies or
   * annoying a player who just finished a quick run.
   */
  async maybeShowInterstitialAtBreakpoint(): Promise<void> {
    if (!this.isSupported) return;
    this.roundsSinceInterstitial++;
    if (this.roundsSinceInterstitial < INTERSTITIAL_EVERY_N_ROUNDS) return;
    this.roundsSinceInterstitial = 0;
    await this.showInterstitial();
  }

  /**
   * Shows the interstitial if one is ready (or can be loaded within a short
   * timeout), and resolves once it's dismissed. Gives up after
   * AD_LOAD_TIMEOUT_MS so a slow/unavailable ad never blocks whatever
   * navigation it's gating. Resolves true only if an ad was actually shown.
   * Re-entrant calls while one is already showing resolve false immediately
   * instead of stacking requests.
   */
  async showInterstitial(): Promise<boolean> {
    if (!this.isSupported || this.interstitialShowing) return false;
    this.interstitialShowing = true;
    try {
      await this.initialize();
      if (!this.interstitialReady) {
        await Promise.race([this.preloadInterstitial(), new Promise<void>((resolve) => setTimeout(resolve, AD_LOAD_TIMEOUT_MS))]);
      }
      if (!this.interstitialReady) return false;
      this.interstitialReady = false;
      try {
        await AdMob.showInterstitial();
        void this.preloadInterstitial();
        return true;
      } catch {
        void this.preloadInterstitial();
        return false;
      }
    } finally {
      this.interstitialShowing = false;
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
    } catch {
      this.rewardedReady = false;
    } finally {
      this.rewardedLoading = false;
    }
  }

  /**
   * Shows the rewarded video and resolves `true` ONLY when the user actually
   * earns the reward. Never resolves `true` optimistically — a dismiss
   * before completion, a show failure, or an ad that never finished loading
   * all resolve `false`. This is the one method every coin/unlock/continue
   * grant in the app must gate on; nothing should credit a reward on the
   * button tap or on the ad merely starting.
   *
   * Also serializes itself: every rewarded-ad placement in the app (wallet
   * coins, double-coins, extra-life continue, ...) shares this one guard, so
   * a double tap — or two different ad buttons somehow triggered together —
   * can never show two rewarded ads, or resolve two rewards, at once.
   *
   * On the web (AdMob never runs outside a native build), this resolves via
   * a simulated delay instead of failing outright, purely so every rewarded
   * placement in the app stays testable from a desktop browser during
   * development. That path is never reachable in a real native build.
   */
  async showRewarded(): Promise<boolean> {
    if (this.rewardedShowing) return false;
    if (!this.isSupported) return this.simulateWebRewardedAd();
    await this.initialize();
    if (!this.rewardedReady) {
      await Promise.race([this.preloadRewarded(), new Promise<void>((resolve) => setTimeout(resolve, AD_LOAD_TIMEOUT_MS))]);
    }
    if (!this.rewardedReady) return false;
    this.rewardedReady = false;
    this.rewardedShowing = true;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const handles: Promise<PluginListenerHandle>[] = [];
      const cleanup = () => handles.forEach((h) => h.then((handle) => handle.remove()).catch(() => {}));
      const finish = (granted: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.rewardedShowing = false;
        void this.preloadRewarded();
        resolve(granted);
      };

      // showRewardVideoAd()'s promise resolves with the earned reward item in
      // this plugin version, but a dismiss-before-completion or a show
      // failure is raced in explicitly too, defensively, so a player backing
      // out early can never be misread as having earned the reward.
      handles.push(AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(false)));
      handles.push(AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)));

      AdMob.showRewardVideoAd()
        .then(() => finish(true))
        .catch(() => finish(false));
    });
  }

  /** Dev/browser-only stand-in — see the doc comment on `showRewarded()`. */
  private simulateWebRewardedAd(): Promise<boolean> {
    this.rewardedShowing = true;
    return new Promise((resolve) =>
      setTimeout(() => {
        this.rewardedShowing = false;
        resolve(true);
      }, 1500)
    );
  }
}
