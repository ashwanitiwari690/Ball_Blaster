/**
 * ECONOMY CONFIGURATION — PROTOTYPE MIRROR OF SERVER-SIDE ADMIN CONFIG
 * ---------------------------------------------------------------------
 * In the target architecture (see README "Security & production checklist"),
 * every value in this file must live in the Node.js backend's configuration
 * store, NOT in the client bundle, because it directly determines how much
 * real money a player can earn. This file exists only so the frontend-only
 * prototype has somewhere to read the same numbers from.
 *
 * When the real backend is built, replace all reads of ECONOMY_CONFIG with
 * a `GET /config/economy` call and delete this file. Nothing else in the
 * app should need to change if the service boundary (EconomyConfigService)
 * below is kept intact.
 */

export type BallTier = 'normal' | 'fast' | 'heavy' | 'gold' | 'boss';

export interface BallTierConfig {
  tier: BallTier;
  label: string;
  color: string;
  glow: string;
  coinValue: number;
  minHp: number;
  maxHp: number;
  speed: number;
  radius: number;
  weight: number; // relative spawn probability
}

export const BALL_TIERS: Record<BallTier, BallTierConfig> = {
  normal: { tier: 'normal', label: 'Normal', color: '#3b82f6', glow: '#60a5fa', coinValue: 1, minHp: 3, maxHp: 6, speed: 64, radius: 26, weight: 46 },
  fast: { tier: 'fast', label: 'Fast', color: '#22c55e', glow: '#4ade80', coinValue: 2, minHp: 4, maxHp: 7, speed: 100, radius: 24, weight: 24 },
  heavy: { tier: 'heavy', label: 'Heavy', color: '#a855f7', glow: '#c084fc', coinValue: 3, minHp: 9, maxHp: 14, speed: 46, radius: 32, weight: 16 },
  gold: { tier: 'gold', label: 'Gold', color: '#f59e0b', glow: '#fbbf24', coinValue: 5, minHp: 5, maxHp: 8, speed: 74, radius: 27, weight: 10 },
  boss: { tier: 'boss', label: 'Boss', color: '#ef4444', glow: '#f87171', coinValue: 10, minHp: 22, maxHp: 30, speed: 30, radius: 42, weight: 4 },
};

export const ECONOMY_CONFIG = {
  /** Coins awarded per ball tier destroyed (mirrors spec section 5/6/52). */
  ballTiers: BALL_TIERS,

  /** Server-enforced ceiling on monetary coins earned from gameplay per day (section 7). */
  dailyGameplayCoinCap: 150,

  /** Coins awarded for a rewarded-ad view, and how many are allowed per day (section 32/33). */
  rewardedAdCoins: 5,
  maxAdRewardsPerDay: 5,

  /** 7-day login streak rewards, index 0 = Day 1 (section: Daily Rewards screen). */
  dailyLoginRewards: [2, 3, 5, 5, 10, 10, 20],

  /**
   * Minimum coins required before a redemption request can be submitted
   * (section 15). The coin -> INR conversion itself is deliberately NOT
   * configured here or anywhere else on the client — that stays entirely
   * server-side, computed by the real redemption API once it exists.
   */
  minRedemptionCoins: 1000,

  /** Max reward-crediting events accepted per minute, anti-farming (section 8). */
  maxRewardEventsPerMinute: 20,

  /** Score/coin multiplier granted by the in-game "x2" power orb, and its duration. */
  multiplierValue: 2,
  multiplierDurationMs: 10_000,

  /** Player lives per game run. */
  startingLives: 3,

  /**
   * Level progression (a single run advances through levels rather than
   * being one flat difficulty). A level is complete once the player has
   * destroyed `levelBallsBase + (level - 1) * levelBallsStep` balls in it;
   * each completed level pays a flat bonus on top of normal per-ball coins.
   */
  levelCompleteCoins: 10,
  levelBallsBase: 10,
  levelBallsStep: 5,
} as const;

/** Balls that must be destroyed to complete the given level. */
export function levelTarget(level: number): number {
  return ECONOMY_CONFIG.levelBallsBase + (level - 1) * ECONOMY_CONFIG.levelBallsStep;
}

/** Minimum total balls-destroyed needed to have plausibly completed this many levels — used to sanity-check a reported level count (spec section 23/24 pattern). */
export function minBallsToCompleteLevels(levelsCompleted: number): number {
  let total = 0;
  for (let i = 1; i <= levelsCompleted; i++) total += levelTarget(i);
  return total;
}
