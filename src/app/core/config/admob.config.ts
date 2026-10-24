export const AD_UNIT_IDS = {
  banner: 'ca-app-pub-2030586584805301/1405931990',
  interstitial: 'ca-app-pub-2030586584805301/5068265823',
  rewarded: 'ca-app-pub-2030586584805301/7646663441',
} as const;

/** Show interstitials at most once every N completed rounds (policy-safe frequency capping). */
export const INTERSTITIAL_EVERY_N_ROUNDS = 3;

/**
 * Minimum cooldown time (in milliseconds) between any full-screen ads (interstitial or rewarded).
 * Enforces Google Play's Better Ads Standards and prevents ad fatigue/stacking.
 */
export const INTERSTITIAL_MIN_INTERVAL_MS = 60000; // 60 seconds

/** Give up waiting for an interstitial/rewarded ad to load/show after this long, so it never blocks navigation. */
export const INTERSTITIAL_TIMEOUT_MS = 4000;
