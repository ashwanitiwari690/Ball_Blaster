import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { WalletRepositoryPort } from '../ports/wallet-repository.port';
import { ECONOMY_CONFIG } from '../config/economy.config';

const STORAGE_KEY = 'bb.daily-rewards.v1';

interface DailyRewardsState {
  lastClaimedDate: string | null; // 'YYYY-MM-DD'
  streakDay: number; // 1..7
}

export interface DailyRewardsView {
  streakDay: number;
  claimedToday: boolean;
  rewards: readonly number[];
  claimedDays: boolean[]; // index 0 = Day 1
  /** Coins the current streak day is worth — what a "double" ad bonus would add again. */
  todayRewardCoins: number;
  /** Whether the ad-doubled bonus for today's claim has already been granted. */
  doubledToday: boolean;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function load(): DailyRewardsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DailyRewardsState) : { lastClaimedDate: null, streakDay: 0 };
  } catch {
    return { lastClaimedDate: null, streakDay: 0 };
  }
}

/**
 * NOTE: eligibility is keyed off the device's local date. Spec section 26/27
 * requires server time for anything that affects money — once the backend
 * exists, this entire service is replaced by a GET/POST against it and this
 * class is deleted.
 */
@Injectable({ providedIn: 'root' })
export class DailyRewardsService {
  private readonly state$ = new BehaviorSubject<DailyRewardsState>(load());

  constructor(private readonly wallet: WalletRepositoryPort) {}

  private persist(next: DailyRewardsState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.state$.next(next);
  }

  private doubleReferenceId(day: string): string {
    return `daily-double-${day}`;
  }

  get view$(): Observable<DailyRewardsView> {
    const today = todayKey();
    return combineLatest([this.state$, this.wallet.hasReference(this.doubleReferenceId(today))]).pipe(
      map(([s, doubledToday]) => {
        const claimedToday = s.lastClaimedDate === today;
        const currentDay = s.streakDay === 0 ? 1 : s.streakDay;
        // A day is "claimed" once it's before the current streak day, or it IS
        // the current streak day and today's claim has already happened.
        const claimedDays = Array.from({ length: 7 }, (_, i) => i + 1 < s.streakDay || (i + 1 === s.streakDay && claimedToday));
        return {
          streakDay: currentDay,
          claimedToday,
          rewards: ECONOMY_CONFIG.dailyLoginRewards,
          claimedDays,
          todayRewardCoins: ECONOMY_CONFIG.dailyLoginRewards[currentDay - 1],
          doubledToday,
        };
      })
    );
  }

  claim(): Observable<{ day: number; coins: number }> {
    const state = this.state$.value;
    const today = todayKey();
    if (state.lastClaimedDate === today) {
      throw new Error('Already claimed today.');
    }
    const continuingStreak = state.lastClaimedDate === yesterdayKey();
    const nextDay = continuingStreak ? (state.streakDay % 7) + 1 : 1;
    const coins = ECONOMY_CONFIG.dailyLoginRewards[nextDay - 1];

    this.persist({ lastClaimedDate: today, streakDay: nextDay });

    return this.wallet
      .credit({ amount: coins, type: 'DAILY_REWARD', source: 'daily-login', referenceId: `daily-${today}` })
      .pipe(map(() => ({ day: nextDay, coins })));
  }

  /**
   * Grants a second copy of today's already-claimed reward as an ad bonus.
   * Idempotent per day via the ledger's own referenceId guard, so calling
   * this twice (e.g. a re-tapped button) can never double-credit.
   */
  doubleToday(): Observable<{ coins: number }> {
    const state = this.state$.value;
    const today = todayKey();
    if (state.lastClaimedDate !== today) {
      throw new Error("Claim today's reward first.");
    }
    const coins = ECONOMY_CONFIG.dailyLoginRewards[(state.streakDay || 1) - 1];
    return this.wallet
      .credit({ amount: coins, type: 'DAILY_REWARD', source: 'daily-login-ad-double', referenceId: this.doubleReferenceId(today) })
      .pipe(map(() => ({ coins })));
  }
}
