import { BallTier } from '../config/economy.config';

export interface EngineCallbacks {
  onScoreChange: (score: number) => void;
  /** Session-local running total for in-game HUD feedback only — never authoritative. See spec section 30. */
  onCoinsChange: (coins: number) => void;
  onLivesChange: (lives: number) => void;
  onMultiplierChange: (active: boolean, remainingMs: number) => void;
  onGameOver: (result: EngineResult) => void;
  /** Fired the moment a level is completed, with the new (just-entered) level number. */
  onLevelChange?: (level: number) => void;
  /**
   * Fired once, the moment the player would otherwise be out of lives — only
   * if provided. The engine pauses itself and waits for the page to call
   * either `grantContinue()` (resume with 1 life) or `declineContinue()`
   * (finalize game over) rather than ending the run immediately. A run only
   * ever gets this offer once.
   */
  onContinueOffer?: () => void;

  /** Optional audio hooks. The engine stays Angular/audio-free (spec section 46); GamePage wires these to AudioService. */
  onShoot?: () => void;
  onBulletImpact?: () => void;
  onBallDestroyed?: (tier: BallTier) => void;
  onMultiplierActivated?: () => void;
  onLifeLost?: () => void;
}

export interface EngineResult {
  score: number;
  duration: number; // seconds
  ballsDestroyed: number;
  destroyedByTier: Record<BallTier, number>;
  multiplierHits: number;
  coinsEarnedLocal: number;
  /** The level the player was on when the run ended (1 = never completed a level). */
  levelReached: number;
}
