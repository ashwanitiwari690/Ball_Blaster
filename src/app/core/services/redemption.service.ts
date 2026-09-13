import { Injectable } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { WalletRepositoryPort } from '../ports/wallet-repository.port';
import { REWARD_CONFIG } from '../config/reward.config';
import { RewardApiService } from './reward-api.service';

const IDEMPOTENCY_STORAGE_KEY = 'bb.redeem-idempotency.v1';

interface RedeemKeySnapshot {
  key: string;
  coins: number;
  mobileNumber: string;
}

export interface RedeemSuccess {
  coinsRedeemed: number;
  /** Money string, e.g. "15.00" — backend is authoritative for this value. */
  amountCredited: string;
}

/** Indian mobile numbers: exactly 10 digits, no sign, no letters, no symbols. */
const MOBILE_NUMBER_PATTERN = /^[0-9]{10}$/;

export function isValidMobileNumber(value: string): boolean {
  return MOBILE_NUMBER_PATTERN.test(value.trim());
}

/**
 * Redeems the player's full coin balance for INR via the Central Game
 * Reward API (RewardApiService). Coins are only ever deducted locally
 * AFTER the backend confirms a redemption, and by exactly the amount the
 * backend reports (`coinsRedeemed`) — this service never assumes success or
 * decides the payout amount itself.
 *
 * Idempotency key handling mirrors the pattern already shipped in this
 * project's sibling Ionic games: a key is generated once per distinct
 * (coins, mobileNumber) attempt and persisted in localStorage so it survives
 * a reload/retry, and is only cleared once the backend confirms success —
 * so a network failure mid-request can be safely retried without risking a
 * double redemption on the backend.
 */
@Injectable({ providedIn: 'root' })
export class RedemptionService {
  constructor(
    private readonly wallet: WalletRepositoryPort,
    private readonly rewardApi: RewardApiService
  ) {}

  get minRedemptionCoins(): number {
    return REWARD_CONFIG.minRedeemCoins;
  }

  redeem(mobileNumber: string, coins: number): Observable<RedeemSuccess> {
    const idempotencyKey = this.getOrCreateIdempotencyKey(coins, mobileNumber);
    return this.rewardApi.redeemCoins(mobileNumber, coins, idempotencyKey).pipe(
      switchMap((response) => {
        const safeAmount = Math.max(0, Math.min(coins, Math.floor(response.coinsRedeemed) || 0));
        return this.wallet
          .debit({
            amount: safeAmount,
            type: 'REDEMPTION',
            source: 'reward-api',
            referenceId: `redeem-${response.transactionId}`,
          })
          .pipe(
            map(() => {
              this.clearIdempotencyKey();
              return { coinsRedeemed: response.coinsRedeemed, amountCredited: response.amountCredited };
            })
          );
      })
    );
  }

  private getOrCreateIdempotencyKey(coins: number, mobileNumber: string): string {
    try {
      const raw = localStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<RedeemKeySnapshot>;
        if (stored && stored.coins === coins && stored.mobileNumber === mobileNumber && typeof stored.key === 'string') {
          return stored.key;
        }
      }
    } catch {
      // Ignore malformed storage; a fresh key will be generated below.
    }
    const key = `ballblaster-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const snapshot: RedeemKeySnapshot = { key, coins, mobileNumber };
      localStorage.setItem(IDEMPOTENCY_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Local storage can fail in private/embedded contexts; redemption still
      // works, it just loses cross-reload retry dedupe.
    }
    return key;
  }

  private clearIdempotencyKey(): void {
    try {
      localStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
    } catch {
      /* no-op */
    }
  }
}
