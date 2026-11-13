import { Capacitor } from '@capacitor/core';
import { AdMobPlugin, AdmobConsentStatus, BannerAdPluginEvents, InterstitialAdPluginEvents, RewardAdPluginEvents } from '@capacitor-community/admob';
import { AdmobService } from './admob.service';
import {
  AD_FAILURE_BACKOFF_MS, BANNER_HEIGHT_PX, BANNER_CONTROL_GAP_PX, INTERSTITIAL_MIN_INTERVAL_MS,
  REWARDED_MIN_INTERVAL_MS, FULLSCREEN_SESSION_LIMIT, TEST_AD_UNIT_IDS,
} from '../config/admob.config';

describe('AdMob request and reward safeguards', () => {
  let service: AdmobService;
  let listeners: Map<string, Set<(value?: unknown) => void>>;
  let sdk: ReturnType<typeof createSdk>;
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const emit = (event: string, value?: unknown) => listeners.get(event)?.forEach((listener) => listener(value));
  const consent = { status: AdmobConsentStatus.OBTAINED, canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED' };

  function createSdk() {
    return {
      initialize: vi.fn(async () => undefined), requestConsentInfo: vi.fn(async () => ({ ...consent })),
      showConsentForm: vi.fn(async () => ({ ...consent })), showPrivacyOptionsForm: vi.fn(async () => undefined),
      showBanner: vi.fn(async (_options?: unknown): Promise<void> => undefined), hideBanner: vi.fn(async () => undefined),
      resumeBanner: vi.fn(async () => undefined), removeBanner: vi.fn(async () => undefined),
      prepareInterstitial: vi.fn(async () => ({})), showInterstitial: vi.fn(async () => undefined),
      prepareRewardVideoAd: vi.fn(async () => ({})), showRewardVideoAd: vi.fn(() => new Promise<unknown>(() => undefined)),
      addListener: vi.fn(async (event: string, listener: (value?: unknown) => void) => {
        const callbacks = listeners.get(event) ?? new Set();
        callbacks.add(listener); listeners.set(event, callbacks);
        return { remove: vi.fn(async () => { callbacks.delete(listener); }) };
      }),
    };
  }

  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    listeners = new Map(); sdk = createSdk();
    service = new AdmobService({ plugin: sdk as unknown as AdMobPlugin });
  });

  afterEach(() => {
    service.ngOnDestroy();
    vi.restoreAllMocks(); vi.useRealTimers();
  });

  it('requests no ads when consent does not permit them', async () => {
    sdk.requestConsentInfo.mockResolvedValue({ ...consent, canRequestAds: false });
    await service.showBanner();
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    expect(sdk.initialize).not.toHaveBeenCalled();
    expect(sdk.showBanner).not.toHaveBeenCalled();
    expect(sdk.prepareRewardVideoAd).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
  });

  it('does not bypass a consent error', async () => {
    sdk.requestConsentInfo.mockRejectedValue(new Error('UMP unavailable'));
    await service.initialize();
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    expect(sdk.requestConsentInfo).toHaveBeenCalledTimes(1);
    expect(sdk.initialize).not.toHaveBeenCalled();
  });

  it('does not request or simulate ads on the web, in the background, or offline', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    await service.showBanner();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    expect(sdk.requestConsentInfo).not.toHaveBeenCalled();
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const web = new AdmobService({ plugin: sdk as unknown as AdMobPlugin });
    expect(await web.showRewarded('cosmetic-unlock')).toBe(false);
    web.ngOnDestroy();
  });

  it('keeps the menu at the bottom while loading and adds space only for a loaded banner', async () => {
    const first = service.showBanner();
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
    await Promise.all([first, service.showBanner(), service.showBanner()]);
    expect(sdk.showBanner).toHaveBeenCalledTimes(1);
    expect(sdk.showBanner.mock.calls[0][0]).toMatchObject({ adId: TEST_AD_UNIT_IDS.banner, isTesting: true });
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
    emit(BannerAdPluginEvents.Loaded);
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe(`${BANNER_HEIGHT_PX + BANNER_CONTROL_GAP_PX}px`);
    await service.hideBanner();
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
    await service.showBanner();
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe(`${BANNER_HEIGHT_PX + BANNER_CONTROL_GAP_PX}px`);
    expect(sdk.showBanner).toHaveBeenCalledTimes(1);
    expect(sdk.resumeBanner).toHaveBeenCalledTimes(1);
  });

  it('hides a banner that finished loading after the player left its screen', async () => {
    let finishLoad!: () => void;
    sdk.showBanner.mockReturnValue(new Promise<void>((resolve) => { finishLoad = resolve; }));
    const show = service.showBanner();
    await flush();
    const hide = service.hideBanner();
    finishLoad();
    await Promise.all([show, hide]);
    expect(sdk.hideBanner).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
  });

  it('backs off a failed banner without retries or fallback inventory', async () => {
    sdk.showBanner.mockRejectedValue(new Error('No fill'));
    await service.showBanner();
    await service.showBanner();
    await vi.advanceTimersByTimeAsync(AD_FAILURE_BACKOFF_MS);
    expect(sdk.showBanner).toHaveBeenCalledTimes(1);
    await service.showBanner();
    expect(sdk.showBanner).toHaveBeenCalledTimes(2);
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
  });

  it('only grants a cosmetic reward after both earning it and closing the ad', async () => {
    const reward = service.showRewarded('cosmetic-unlock');
    await flush();
    expect(sdk.showRewardVideoAd).toHaveBeenCalledTimes(1);
    emit(RewardAdPluginEvents.Rewarded, { amount: 1, type: 'cosmetic' });
    await flush();
    expect(service.rewardedBusy()).toBe(true);
    emit(RewardAdPluginEvents.Dismissed);
    expect(await reward).toBe(true);
    expect(service.fullScreenAdActive()).toBe(false);
    expect([...listeners.values()].every((callbacks) => callbacks.size === 0)).toBe(true);
  });

  it('does not grant rewards on early dismissal and blocks a second overlapping ad', async () => {
    const first = service.showRewarded('cosmetic-unlock');
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    expect(service.lastRewardFailureReason).toBe('busy');
    await flush();
    emit(RewardAdPluginEvents.Dismissed);
    expect(await first).toBe(false);
    expect(service.lastRewardFailureReason).toBe('dismissed_early');
    expect(sdk.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
  });

  it('does not fake a reward when an ad cannot be loaded', async () => {
    sdk.prepareRewardVideoAd.mockRejectedValue(new Error('No fill / serving limit'));
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    for (let i = 0; i < 5; i++) expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    await vi.advanceTimersByTimeAsync(AD_FAILURE_BACKOFF_MS);
    expect(sdk.prepareRewardVideoAd).toHaveBeenCalledTimes(1);
    expect(sdk.showRewardVideoAd).not.toHaveBeenCalled();
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    expect(sdk.prepareRewardVideoAd).toHaveBeenCalledTimes(2);
  });

  it('blocks repeated completed-ad farming with cooldown and a session cap', async () => {
    for (let i = 0; i < FULLSCREEN_SESSION_LIMIT; i++) {
      const reward = service.showRewarded('cosmetic-unlock');
      await flush();
      emit(RewardAdPluginEvents.Rewarded);
      emit(RewardAdPluginEvents.Dismissed);
      expect(await reward).toBe(true);
      if (i === 0) {
        expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
        expect(service.lastRewardFailureReason).toBe('cooldown');
      }
      await vi.advanceTimersByTimeAsync(REWARDED_MIN_INTERVAL_MS);
    }
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    expect(service.lastRewardFailureReason).toBe('session_limit');
    expect(sdk.showRewardVideoAd).toHaveBeenCalledTimes(FULLSCREEN_SESSION_LIMIT);
  });

  it('counts unique completed games, not repeated navigation taps', async () => {
    service.recordCompletedRound('one'); service.recordCompletedRound('one'); service.recordCompletedRound('two');
    await vi.advanceTimersByTimeAsync(INTERSTITIAL_MIN_INTERVAL_MS);
    await service.maybeShowInterstitialAtBreakpoint();
    expect(sdk.showInterstitial).not.toHaveBeenCalled();
    service.recordCompletedRound('three');
    await flush();
    const transition = service.maybeShowInterstitialAtBreakpoint();
    await flush();
    expect(sdk.showInterstitial).toHaveBeenCalledTimes(1);
    emit(InterstitialAdPluginEvents.Dismissed);
    await transition;
    await service.maybeShowInterstitialAtBreakpoint();
    expect(sdk.showInterstitial).toHaveBeenCalledTimes(1);
  });

  it('never waits for an interstitial to load or opens a late ad on the next page', async () => {
    let loaded!: () => void;
    sdk.prepareInterstitial.mockReturnValue(new Promise((resolve) => { loaded = () => resolve({}); }));
    ['one', 'two', 'three'].forEach((id) => service.recordCompletedRound(id));
    await flush();
    await vi.advanceTimersByTimeAsync(INTERSTITIAL_MIN_INTERVAL_MS);
    await service.maybeShowInterstitialAtBreakpoint();
    loaded(); await flush();
    expect(sdk.showInterstitial).not.toHaveBeenCalled();
  });

  it('updates privacy availability and discards previously prepared ads after a change', async () => {
    sdk.requestConsentInfo.mockResolvedValue({ ...consent, privacyOptionsRequirementStatus: 'REQUIRED' });
    await service.initialize();
    expect(service.privacyOptionsRequired()).toBe(true);
    sdk.requestConsentInfo.mockResolvedValue({ ...consent, canRequestAds: false });
    await service.showPrivacyOptions();
    expect(sdk.showPrivacyOptionsForm).toHaveBeenCalledTimes(1);
    expect(await service.showRewarded('cosmetic-unlock')).toBe(false);
    expect(sdk.prepareRewardVideoAd).not.toHaveBeenCalled();
  });

  it('backs off asynchronous banner failure events without refreshing the unit', async () => {
    await service.showBanner();
    emit(BannerAdPluginEvents.Loaded);
    emit(BannerAdPluginEvents.FailedToLoad);
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
    await service.showBanner();
    expect(sdk.showBanner).toHaveBeenCalledTimes(1);
    expect(service.bannerLoaded()).toBe(false);
  });

  it('removes the menu offset when the SDK reports that the banner has disappeared', async () => {
    await service.showBanner();
    emit(BannerAdPluginEvents.Loaded);
    emit(BannerAdPluginEvents.SizeChanged, { width: 0, height: 0 });
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
  });

  it('ignores a late loaded event after the banner screen was left', async () => {
    await service.showBanner();
    await service.hideBanner();
    emit(BannerAdPluginEvents.Loaded);
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
  });

  it('removes a banner if the native hide operation fails', async () => {
    await service.showBanner();
    sdk.hideBanner.mockRejectedValueOnce(new Error('Native view unavailable'));
    await service.hideBanner();
    expect(sdk.removeBanner).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue('--ad-banner-space')).toBe('0px');
  });
});
