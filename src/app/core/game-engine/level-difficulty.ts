import { BALL_TIERS, BallTier } from '../config/economy.config';

export interface LevelDifficulty {
  readonly spawnIntervalMs: number;
  readonly speedMultiplier: number;
  readonly healthMultiplier: number;
  readonly tierWeights: Readonly<Record<BallTier, number>>;
}

/** Each level increases pressure, approaching limits instead of stopping at a fixed level. */
export function difficultyForLevel(level: number): LevelDifficulty {
  const steps = Math.max(0, (Number.isFinite(level) ? Math.floor(level) : 1) - 1);
  const progress = steps / (steps + 12);
  return {
    spawnIntervalMs: 1150 - 450 * progress,
    speedMultiplier: 1 + 0.75 * progress,
    healthMultiplier: 1 + 0.4 * progress,
    tierWeights: {
      normal: BALL_TIERS.normal.weight - 20 * progress,
      fast: BALL_TIERS.fast.weight,
      heavy: steps >= 1 ? BALL_TIERS.heavy.weight + 10 * progress : 0,
      gold: BALL_TIERS.gold.weight + 4 * progress,
      boss: steps >= 2 ? BALL_TIERS.boss.weight + 6 * progress : 0,
    },
  };
}
