/**
 * ADMOB AD UNIT CONFIGURATION — CENTRALIZED, TEST IDS FOR NOW
 * ---------------------------------------------------------------------
 * These are Google's official public sample ad unit IDs. They always serve
 * a clearly labeled "Test Ad" and are safe to ship during development —
 * using real ad unit IDs before the app is approved / on non-test devices
 * risks invalid-traffic flags on the whole AdMob account.
 * See https://developers.google.com/admob/android/test-ads
 *
 * IMPORTANT — how coin rewards stay separate from this file:
 * This file (and AdmobService) only ever answers "was the ad watched to
 * completion: true/false." It never decides how many coins that's worth —
 * that lives solely in `economy.config.ts` (`ECONOMY_CONFIG.rewardedAdCoins`),
 * which is the one place the spec's "server" configuration is meant to
 * control. What a coin is worth in INR is not configured on the client at
 * all — that's computed server-side by the real redemption API. Nothing in
 * the AdMob layer should ever hardcode a coin amount.
 *
 * GOING TO PRODUCTION: create real ad units in the AdMob console for this
 * app's real App ID, and replace every value below with them. Nothing else
 * in the app needs to change — every call site reads from here.
 */
export const AD_UNIT_IDS = {
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
} as const;

/** Show an interstitial at a breakpoint at most once every N completed game rounds (policy-safe pacing). */
export const INTERSTITIAL_EVERY_N_ROUNDS = 2;

/** How long to wait for an ad to finish loading before giving up (ms). */
export const AD_LOAD_TIMEOUT_MS = 4000;
