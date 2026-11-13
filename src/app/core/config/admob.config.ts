import { environment } from '../../../environments/environment';

export const PRODUCTION_AD_UNIT_IDS = {
  banner: 'ca-app-pub-2030586584805301/1405931990',
  interstitial: 'ca-app-pub-2030586584805301/5068265823',
  rewarded: 'ca-app-pub-2030586584805301/7646663441',
} as const;

/** Development builds use Google's demo units, never the publisher's live units. */
export const IS_TESTING_ADS = !environment.production;
export const TEST_AD_UNIT_IDS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
} as const;
export const AD_UNIT_IDS = IS_TESTING_ADS ? TEST_AD_UNIT_IDS : PRODUCTION_AD_UNIT_IDS;

/** Local kill switch; Google alone controls the account's serving limit. */
export const ADS_ENABLED = true;
/** Register release QA devices in AdMob's test-device settings before testing live builds. */
export const TEST_DEVICE_IDS: string[] = [];

export const BANNER_ROUTES: readonly string[] = ['/home', '/profile'];
export const BANNER_HEIGHT_PX = 50;
export const BANNER_CONTROL_GAP_PX = 32;
export const AD_REQUEST_INTERVAL_MS = 60_000;
export const AD_FAILURE_BACKOFF_MS = 5 * 60_000;
export const AD_CACHE_LIFETIME_MS = 55 * 60_000;
export const FULLSCREEN_SESSION_LIMIT = 10;
export const REWARDED_MIN_INTERVAL_MS = 60_000;

/** Show interstitials at most once every N completed rounds (application pacing). */
export const INTERSTITIAL_EVERY_N_ROUNDS = 3;

/**
 * Minimum cooldown time (in milliseconds) between any full-screen ads (interstitial or rewarded).
 * These app limits reduce stacking; Google evaluates overall implementation and traffic.
 */
export const INTERSTITIAL_MIN_INTERVAL_MS = 120_000;

/** A failed rewarded load returns control to the player without granting an unlock. */
export const REWARDED_LOAD_TIMEOUT_MS = 8000;
