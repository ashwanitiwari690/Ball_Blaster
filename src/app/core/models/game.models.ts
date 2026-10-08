import { BallTier } from '../config/economy.config';

export interface GameSessionResult {
  sessionId: string;
  score: number;
  duration: number; // seconds
  ballsDestroyed: number;
  destroyedByTier: Record<BallTier, number>;
  multiplierHits: number;
  /** Coins accumulated during this run by the engine (includes multipliers and level bonuses). */
  coinsEarnedLocal?: number;
  /** The level the player was on when the run ended (1 = never completed a level). */
  levelReached: number;
}

export interface RewardOutcome {
  coinsEarned: number;
  cappedByDailyLimit: boolean;
  wallet: import('./wallet.models').WalletSnapshot;
}
