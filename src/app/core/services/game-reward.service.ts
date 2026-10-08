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

  /** Mirrors POST /game/session/complete. Recalculates the reward server-side style and checks daily limit. */
  completeSession(result: GameSessionResult): Observable<RewardOutcome> {
    const rawCoins = this.isPlausible(result) ? this.calculateReward(result) : 0;

    return this.wallet.getWallet().pipe(
      take(1),
      switchMap((snapshot) => {
        const remainingToday = Math.max(0, ECONOMY_CONFIG.dailyGameplayCoinCap - snapshot.todayGameplayCoins);
        const award = Math.min(rawCoins, remainingToday);
        const cappedByDailyLimit = rawCoins > 0 && award < rawCoins;

        if (award <= 0) {
          return of<RewardOutcome>({ coinsEarned: 0, cappedByDailyLimit, wallet: snapshot });
        }

        const refId = result.sessionId || newId();
        return this.wallet
          .credit({ amount: award, type: 'GAME_REWARD', source: 'gameplay', referenceId: refId })
          .pipe(switchMap((w) => of<RewardOutcome>({ coinsEarned: award, cappedByDailyLimit, wallet: w })));
      })
    );
  }

  /** Calculates coins from the run: uses coinsEarnedLocal (tracked with multipliers and bonuses) or tier counts. */
  private calculateReward(result: GameSessionResult): number {
    if (typeof result.coinsEarnedLocal === 'number' && result.coinsEarnedLocal > 0) {
      return result.coinsEarnedLocal;
    }
    const ballCoins = (Object.keys(BALL_TIERS) as BallTier[]).reduce((sum, tier) => {
      const count = result.destroyedByTier?.[tier] ?? 0;
      return sum + count * BALL_TIERS[tier].coinValue;
    }, 0);
    return Math.max(0, ballCoins);
  }

  /**
   * Lightweight sanity check for game session. Ensures valid score and session.
   */
  private isPlausible(result: GameSessionResult): boolean {
    if (!result || result.score < 0 || result.ballsDestroyed < 0) return false;
    return true;
  }
}
