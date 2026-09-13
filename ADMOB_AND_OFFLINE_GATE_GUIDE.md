# AdMob Ads + Offline Gate — Implementation Guide

How this project wires up real Google AdMob ads (banner, interstitial, rewarded
video) with Google's official **test** ad unit IDs, plus a full-app "no
internet connection" gate. Written so it can be copied into a different
Ionic + Angular + Capacitor (Android) app. Adjust service/page names to match
the target project's structure — the patterns are what matter.

> ⚠️ **App ID is per-app, not reusable.** The AdMob **App ID** is tied to
> its exact listing in one AdMob account. When setting this up in a
> **different** app, go to the AdMob console → Apps → Add app, get a **new**
> App ID for that app, and use that instead. Reusing one app's App ID inside
> a different app is against AdMob policy and will misattribute revenue.
> The **ad unit IDs** in this guide are Google's shared public test IDs —
> those you copy verbatim, they're not account-specific.
>
> **Ball Blaster-specific note:** this project doesn't have a real AdMob
> account/App ID yet, so `strings.xml` uses Google's public **test** App ID
> (`ca-app-pub-3940256099942544~3347511713`) rather than a real one. See
> the README's "AdMob ads + offline gate" section for exactly what to swap
> in before a production release.

---

## 1. Install the plugin

```bash
npm install @capacitor-community/admob
npx cap sync android
```

`cap sync` registers the plugin natively (adds it to
`android/capacitor.settings.gradle` / `capacitor.build.gradle` /
`capacitor.plugins.json` and `MainActivity`). You don't hand-edit those files.

## 2. Android native setup

**`android/app/src/main/res/values/strings.xml`** — add the app's real AdMob
App ID (from AdMob console → Apps → your app → App settings):

```xml
<resources>
    ...
    <!-- Real AdMob App ID for this app (from the AdMob console). -->
    <string name="admob_app_id">ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX</string>
</resources>
```

**`android/app/src/main/AndroidManifest.xml`** — reference it inside
`<application>`, and make sure `INTERNET` is requested:

```xml
<application ...>
    ...
    <!-- AdMob App ID, read from strings.xml (admob_app_id). Required — the Google
         Mobile Ads SDK crashes the app on startup if this meta-data is missing. -->
    <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="@string/admob_app_id" />
</application>

<uses-permission android:name="android.permission.INTERNET" />
```

The App ID is safe to leave as the **real** one even while every ad unit ID
in the app is still a test ID — Google's guidance is to develop against test
ad units regardless of whether the App ID itself is already live.

## 3. Ad unit config (test IDs)

`src/app/config/admob.config.ts`:

```ts
/**
 * AdMob ad unit configuration.
 *
 * These are Google's official sample ad unit IDs — they always serve a clearly
 * labeled "Test Ad" and are safe to ship during development (real ad unit IDs
 * used with unapproved apps/test devices can get an AdMob account flagged for
 * invalid traffic). See https://developers.google.com/admob/android/test-ads
 *
 * Before releasing to production, replace every value below with the real ad
 * unit IDs created in the AdMob console for this app (the app's AdMob App ID
 * itself is already live — see android/app/src/main/res/values/strings.xml).
 */
export const AD_UNIT_IDS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917'
} as const;

/** Show interstitials at most once every N completed game rounds (policy-safe pacing). */
export const INTERSTITIAL_EVERY_N_ROUNDS = 2;
```

Going live later is a one-line-per-format swap in this file — create real ad
units in the AdMob console for the app's real App ID and paste their IDs in.

## 4. `AdmobService` — the core wrapper

`src/app/services/admob.service.ts`. This is the only file that talks to the
plugin directly; every page goes through it.

```ts
import { Injectable } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  BannerAdOptions,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  RewardAdPluginEvents
} from '@capacitor-community/admob';
import { AD_UNIT_IDS, INTERSTITIAL_EVERY_N_ROUNDS } from '../config/admob.config';

/**
 * Thin wrapper around @capacitor-community/admob. Ads only run on native
 * platforms — the plugin's web implementation is a stub that resolves reward
 * calls instantly with a zero-value reward, so callers must never grant coins
 * based on it. A separate web/dev fallback (see §6) handles browser testing.
 */
@Injectable({ providedIn: 'root' })
export class AdmobService {
  readonly isSupported = Capacitor.isNativePlatform();

  private initPromise?: Promise<void>;
  private bannerVisible = false;

  private interstitialReady = false;
  private interstitialLoading = false;
  private roundsSinceInterstitial = 0;

  private rewardedReady = false;
  private rewardedLoading = false;

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

  /** Shows the persistent bottom banner. Safe to call repeatedly. */
  async showBanner(): Promise<void> {
    if (!this.isSupported) return;
    await this.initialize();
    if (this.bannerVisible) return;
    const options: BannerAdOptions = {
      adId: AD_UNIT_IDS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0
    };
    try {
      this.bannerVisible = true;
      await AdMob.addListener(BannerAdPluginEvents.SizeChanged, info => this.setBannerSpace(info.height));
      await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => this.setBannerSpace(0));
      await AdMob.showBanner(options);
    } catch {
      this.bannerVisible = false;
      this.setBannerSpace(0);
    }
  }

  /** Exposes the banner's live height as a CSS var so page content can pad around it. */
  private setBannerSpace(heightPx: number): void {
    document.documentElement.style.setProperty('--ad-banner-space', `${Math.max(0, heightPx)}px`);
  }

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
   * frequent without breaching AdMob's full-screen-ad frequency policies.
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
   * timeout) and resolves once it's dismissed. Gives up after ~4s so a slow
   * or unavailable ad never blocks whatever navigation it's gating. Returns
   * true only if an ad was actually shown.
   */
  async showInterstitial(): Promise<boolean> {
    if (!this.isSupported) return false;
    await this.initialize();
    if (!this.interstitialReady) {
      await Promise.race([
        this.preloadInterstitial(),
        new Promise<void>(resolve => setTimeout(resolve, 4000))
      ]);
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
  }

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
   * Shows the rewarded video and resolves true ONLY when AdMob's own
   * OnUserEarnedReward callback fires. Never resolves true optimistically —
   * closing the ad early (Dismissed) or a show failure both resolve false.
   * This is the one method every coin/unlock grant must gate on.
   */
  async showRewarded(): Promise<boolean> {
    if (!this.isSupported) return false;
    await this.initialize();
    if (!this.rewardedReady) await this.preloadRewarded();
    if (!this.rewardedReady) return false;
    this.rewardedReady = false;

    return new Promise<boolean>(resolve => {
      let settled = false;
      const handles: Promise<PluginListenerHandle>[] = [];
      const cleanup = () => handles.forEach(h => h.then(handle => handle.remove()).catch(() => {}));
      const finish = (granted: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        void this.preloadRewarded();
        resolve(granted);
      };

      // showRewardVideoAd()'s promise only resolves via AdMob's own reward
      // callback — if the user closes the ad early, it never resolves on its
      // own, so we race it against the Dismissed/FailedToShow events too.
      handles.push(AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(false)));
      handles.push(AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)));

      AdMob.showRewardVideoAd()
        .then(() => finish(true))
        .catch(() => finish(false));
    });
  }
}
```

**Why the reward logic is shaped this way:** `showRewardVideoAd()`'s
underlying native call only resolves the JS promise from inside Android's
`OnUserEarnedRewardListener` — i.e. AdMob's own confirmation that the video
was actually watched to completion. If the user backs out early, that
listener never fires and the promise would otherwise hang forever, so the
`Dismissed`/`FailedToShow` events are raced against it as the "give up, no
reward" paths. **Never grant a reward from anywhere except `showRewarded()`
resolving `true`** — that's the only point guaranteed to reflect a real,
AdMob-confirmed ad view.

> **Ball Blaster note:** the installed plugin version (8.1.0) actually
> resolves `showRewardVideoAd()` with the earned `AdMobRewardItem` directly
> and has a separate `Rewarded` event too — but `AdmobService.showRewarded()`
> still races `Dismissed`/`FailedToShow` against it defensively, same as
> above, rather than trusting the promise alone.

## 5. Initialize + persistent banner at the app root

`src/main.ts` needs no special provider — `AdmobService` is a plain
`providedIn: 'root'` injectable. Wire it up in the root component:

```ts
// app.component.ts
export class AppComponent implements OnInit {
  constructor(private admob: AdmobService, /* ...other services */) {}

  ngOnInit(): void {
    void this.admob.initialize().then(() => this.admob.showBanner());
  }
}
```

Reserve space for the banner instead of letting it overlap content. In the
global stylesheet:

```css
:root { --ad-banner-space: 0px; }

.page {
  padding-bottom: calc(28px + var(--ad-banner-space)); /* 28px = your normal bottom padding */
}
```

`AdmobService.showBanner()` updates `--ad-banner-space` live once the banner
reports its real height, so this works across every device/screen size
without hardcoding a banner height.

## 6. Web / browser dev fallback for rewarded ads

AdMob doesn't run in a desktop browser, and the plugin's web implementation
is a stub that resolves `showRewardVideoAd()` **instantly** with a
zero-value reward — so never trust it for granting anything. Gate every
native call behind `AdmobService.isSupported`, and give web a harmless local
fallback (e.g. a simulated countdown/video overlay) purely so the UI is
testable without a device:

```ts
// reward-ad.service.ts (excerpt)
async startWatch(options: { allowSimulatedFallback?: boolean } = {}): Promise<boolean> {
  if (!this.canWatch) return false;

  if (this.admob.isSupported) {
    this.isWatching = true;
    const granted = await this.admob.showRewarded();
    this.isWatching = false;
    if (granted) this.completeWatch(); // only ever called on a confirmed reward
    return granted;
  }

  if (options.allowSimulatedFallback === false) return false; // this placement is native-ads-only

  this.isWatching = true; // opens a local simulated overlay for dev/testing
  return true;
}
```

`RewardAdService.usesNativeAds` (= `admob.isSupported`) lets a template hide
the simulated overlay entirely on native, and show a friendly message like
*"Rewarded ads run on the Android app — open it on your device to earn
coins"* on web instead of silently doing nothing.

> **Ball Blaster note:** rather than a separate simulated overlay, the web
> fallback lives directly inside `AdmobService.showRewarded()` itself (a
> 1.5s simulated delay resolving `true`), so every rewarded placement in the
> app gets consistent native/web behavior automatically without each caller
> needing to branch on `isSupported`.

## 7. Where to put each ad format

- **Persistent banner** — shown once at app boot (§5), stays up across every
  screen.
- **Rewarded video** — behind an explicit "Watch ad" button tied to a
  specific reward (coins, an unlock). Always gate the reward on
  `showRewarded()` resolving `true`; never on the button being tapped or the
  ad merely starting.
  ```ts
  async watchRewardedAd(): Promise<void> {
    const started = await this.rewardAd.startWatch({ allowSimulatedFallback: false });
    if (!started) return;
    this.finishRewardedAd(); // credits the reward only if a completed watch is pending
  }
  ```
- **Interstitial at a natural breakpoint** — e.g. leaving a finished game
  round, or right before entering a new screen the player chose to open.
  Two patterns used here:
  - Frequency-capped, for a spot the player revisits constantly (end of every
    round): `void this.admob.maybeShowInterstitialAtBreakpoint();`
  - Shown every time, for a deliberate one-off navigation (tapping "Play"):
    ```ts
    async openSelectMode() {
      this.navigating = true;
      try {
        await this.admob.showInterstitial(); // shows before navigating, or times out after ~4s
        await this.router.navigateByUrl('/select-mode');
      } finally {
        this.navigating = false;
      }
    }
    ```
    Disable the triggering button while `navigating` is true so a slow ad
    load can't be double-tapped.

## 8. Going to production

1. Create real ad units in the AdMob console (for the app's real App ID) and
   replace every value in `admob.config.ts`.
2. Remove `initializeForTesting: true` from `AdMob.initialize(...)` in
   `AdmobService.initialize()`.
3. Add a GDPR/UMP consent flow (`AdMob.requestConsentInfo` /
   `showConsentForm`) before requesting any ad if you'll have EU/UK users —
   **not** included in this guide, required before a public launch there.
4. Confirm the App ID in `strings.xml`/`AndroidManifest.xml` matches the
   AdMob console listing for this exact app.

## 9. Testing

- Ads only render on a real device or an emulator with Google Play Services
  — never in a desktop browser (`ng serve` / `ionic serve`), which is why
  every call is gated behind `Capacitor.isNativePlatform()`.
- With test ad unit IDs, every ad creative is watermarked "Test Ad" — if you
  ever see a real-looking ad while still on test IDs, something's
  misconfigured.
- Build + sync + open Android Studio to run on a device/emulator:
  ```bash
  ng build
  npx cap sync android
  npx cap open android
  ```

---

# Offline Gate — block the app without internet

Because ad revenue funds this app's economy, gameplay is blocked outright
when there's no network connection, with a full-screen message, rather than
letting anything happen (playing, earning coins) that was never going to be
backed by an actual ad request.

## 1. `ConnectivityService`

`src/app/services/connectivity.service.ts`:

```ts
import { Injectable } from '@angular/core';

/**
 * Tracks whether the device currently has a network connection. Gameplay is
 * blocked while offline rather than letting the player earn rewards with no
 * ad ever having been requested or shown.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  online = typeof navigator === 'undefined' ? true : navigator.onLine;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => { this.online = true; });
    window.addEventListener('offline', () => { this.online = false; });
  }

  /** Re-reads the browser's connectivity flag directly, for a manual "Try again" action. */
  recheck(): void {
    if (typeof navigator !== 'undefined') this.online = navigator.onLine;
  }
}
```

`navigator.onLine` reflects the Android WebView's actual OS-level
connectivity state reliably enough for this purpose — no extra native plugin
needed. It updates live via the standard `online`/`offline` window events,
which Angular's zone.js already patches, so no manual change-detection
trigger is required.

> **Ball Blaster note:** this app has no zone.js at all (see the README's
> zoneless section), so `online` is a `signal()` here instead of a plain
> field — otherwise the offline card would never actually appear/disappear,
> even though the service's own state would be correct.

## 2. Gate the whole app on it, at the root component

```ts
// app.component.ts
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `
    <router-outlet *ngIf="connectivity.online"></router-outlet>
    <main class="offline-screen" *ngIf="!connectivity.online">
      <div class="offline-card">
        <div class="offline-icon">📡</div>
        <h1>NO INTERNET CONNECTION</h1>
        <p>This app needs an internet connection to load ads and save your rewards. Please reconnect to keep playing.</p>
        <button (click)="connectivity.recheck()">TRY AGAIN</button>
      </div>
    </main>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .offline-screen {
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .offline-card { max-width: 360px; width: 100%; text-align: center; padding: 32px 24px; border-radius: 22px; }
    .offline-icon { font-size: 48px; margin-bottom: 14px; }
  `]
})
export class AppComponent {
  constructor(public connectivity: ConnectivityService) {}
}
```

(Trim the styles above to whatever matches your app's own theme — the
version in this project's `app.component.ts` uses the same gradient/card
look as every other screen.)

**Behavior:**
- Offline at launch or mid-session → the entire routed app (`router-outlet`)
  is removed from the DOM and replaced by the offline card. The router keeps
  its own state, so reconnecting re-mounts whatever route was active.
- Reconnects automatically the instant the OS reports connectivity again —
  no user action needed. The "TRY AGAIN" button is a manual fallback for the
  rare case a resume-from-background doesn't fire a fresh browser event.
- This is a full block, not a per-feature check — simplest to reason about,
  and matches "no internet → don't run" rather than trying to keep parts of
  the app usable offline.

> **Ball Blaster note:** uses `<ion-router-outlet>` (Ionic's own outlet, not
> the raw Angular one) since this is an Ionic app, and the offline icon is a
> hand-drawn inline SVG rather than `ion-icon` — `ion-icon` fetches its
> glyph over the network, which doesn't work on the one screen whose entire
> point is that there isn't any.

## 3. Cost

Both the AdMob wiring and the offline gate together add well under 3 KB raw
to the production bundle — this is state/event-listener plumbing, not new UI
framework weight.
