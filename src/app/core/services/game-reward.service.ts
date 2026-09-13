import { Injectable } from '@angular/core';
import { Observable, of, switchMap, take } from 'rxjs';
import { WalletRepositoryPort } from '../ports/wallet-repository.port';
import { BALL_TIERS, BallTier, ECONOMY_CONFIG, minBallsToCompleteLevels } from '../config/economy.config';
import { GameSessionResult, RewardOutcome } from '../models/game.models';

function newId(): string {
  return (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * GameRewardService is the local stand-in for what would be, in the target
 * architecture, a Node.js endpoint pair: POST /game/session/start and
 * POST /game/session/complete (spec sections 3-5). The important property
 * this class preserves even without a server: it NEVER trusts a coin total
 * reported by the game engine. It recomputes the reward itself from the
 * count of balls destroyed per tier, exactly as a backend reward engine
 * would, and enforces the daily gameplay cap before crediting anything.
 */
@Injectable({ providedIn: 'root' })
export class GameRewardService {
  constructor(private readonly wallet: WalletRepositoryPort) {}

  /** Mirrors POST /game/session/start — mints a session id the completion call must reference. */
  startSession(): { sessionId: string; startedAt: string } {
    return { sessionId: newId(), startedAt: new Date().toISOString() };
  }

  /** Mirrors POST /game/session/complete. Recalculates the reward server-side style. */
  completeSession(result: GameSessionResult): Observable<RewardOutcome> {
    const plausible = this.isPlausible(result);
    const rawCoins = plausible ? this.calculateReward(result) : 0;

    return this.wallet.getWallet().pipe(
      take(1),
      switchMap((snapshot) => {
        const remainingToday = Math.max(0, ECONOMY_CONFIG.dailyGameplayCoinCap - snapshot.todayGameplayCoins);
        const award = Math.min(rawCoins, remainingToday);
        const cappedByDailyLimit = award < rawCoins;

        if (award <= 0) {
          return of<RewardOutcome>({ coinsEarned: 0, cappedByDailyLimit, wallet: snapshot });
        }

        return this.wallet
          .credit({ amount: award, type: 'GAME_REWARD', source: 'gameplay', referenceId: result.sessionId })
          .pipe(switchMap((w) => of<RewardOutcome>({ coinsEarned: award, cappedByDailyLimit, wallet: w })));
      })
    );
  }

  /** Recomputes coins strictly from verified tier counts and level count — never from a client-supplied total. */
  private calculateReward(result: GameSessionResult): number {
    const ballCoins = (Object.keys(BALL_TIERS) as BallTier[]).reduce((sum, tier) => {
      const count = result.destroyedByTier[tier] ?? 0;
      return sum + count * BALL_TIERS[tier].coinValue;
    }, 0);
    const levelsCompleted = Math.max(0, result.levelReached - 1);
    const levelBonus = levelsCompleted * ECONOMY_CONFIG.levelCompleteCoins;
    return ballCoins + levelBonus;
  }

  /**
   * A lightweight anti-cheat sanity pass (spec section 23/24). A real backend
   * would apply far more signals; this only rejects gameplay that is
   * physically implausible given the run's own reported duration, or a
   * level count that couldn't have been reached with the balls destroyed.
   */
  private isPlausible(result: GameSessionResult): boolean {
    if (result.duration <= 0) return false;
    const totalDestroyed = (Object.values(result.destroyedByTier) as number[]).reduce((a, b) => a + b, 0);
    if (totalDestroyed !== result.ballsDestroyed) return false;
    const MAX_DESTROYS_PER_SECOND = 8;
    if (totalDestroyed / result.duration > MAX_DESTROYS_PER_SECOND) return false;
    const levelsCompleted = Math.max(0, result.levelReached - 1);
    if (result.ballsDestroyed < minBallsToCompleteLevels(levelsCompleted)) return false;
    return true;
  }
}
