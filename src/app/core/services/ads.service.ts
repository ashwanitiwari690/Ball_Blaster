import { Injectable } from '@angular/core';
import { Observable, defer, firstValueFrom, from, map, of } from 'rxjs';
import { WalletRepositoryPort } from '../ports/wallet-repository.port';
import { ECONOMY_CONFIG } from '../config/economy.config';
import { AdmobService } from './admob.service';

export interface AdRewardResult {
  granted: boolean;
  coins: number;
  reason?: string;
}

function newId(): string {
  return (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The only place in the app allowed to credit AD_REWARD coins. The UI never
 * calls `addCoins()` directly (spec section 32) — it calls `watchAd()`,
 * which shows a real rewarded ad via `AdmobService` and only credits the
 * wallet if the ad actually completed and the daily cap hasn't been hit.
 * Coin amounts come from `ECONOMY_CONFIG`, never from the ad layer itself.
 */
@Injectable({ providedIn: 'root' })
export class AdsService {
  // Guards against overlapping calls at the service level, not just whatever
  // loading flag an individual button uses — two taps, or two different ad
  // buttons across the app, can never both be "in flight" at once.
  private watching = false;

  constructor(
    private readonly wallet: WalletRepositoryPort,
    private readonly admob: AdmobService
  ) {}

  get remainingToday$(): Observable<number> {
    return this.wallet.getTodayAdRewardCount().pipe(
      map((count) => Math.max(0, ECONOMY_CONFIG.maxAdRewardsPerDay - count))
    );
  }

  watchAd(): Observable<AdRewardResult> {
    if (this.watching) {
      return of<AdRewardResult>({ granted: false, coins: 0, reason: 'An ad is already playing.' });
    }
    return defer(() => from(this.watchAdAsync()));
  }

  private async watchAdAsync(): Promise<AdRewardResult> {
    this.watching = true;
    try {
      const countToday = await firstValueFrom(this.wallet.getTodayAdRewardCount());
      if (countToday >= ECONOMY_CONFIG.maxAdRewardsPerDay) {
        return { granted: false, coins: 0, reason: 'Daily ad-reward limit reached.' };
      }

      const watched = await this.admob.showRewarded();
      if (!watched) {
        return { granted: false, coins: 0, reason: 'Ad was not completed.' };
      }

      await firstValueFrom(
        this.wallet.credit({
          amount: ECONOMY_CONFIG.rewardedAdCoins,
          type: 'AD_REWARD',
          source: 'rewarded-ad',
          referenceId: `ad-${newId()}`,
        })
      );
      return { granted: true, coins: ECONOMY_CONFIG.rewardedAdCoins };
    } finally {
      this.watching = false;
    }
  }
}
