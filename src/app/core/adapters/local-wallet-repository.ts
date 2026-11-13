import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged, map, of, take } from 'rxjs';
import { WalletRepositoryPort } from '../ports/wallet-repository.port';
import { CoinTransaction, TransactionType, WalletSnapshot } from '../models/wallet.models';

const STORAGE_KEY = 'bb.wallet.v1';

interface WalletState {
  balance: number;
  lifetimeEarned: number;
  transactions: CoinTransaction[];
}

function emptyState(): WalletState {
  return { balance: 0, lifetimeEarned: 0, transactions: [] };
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function newId(): string {
  return (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * NOT SECURE — SEE wallet-repository.port.ts
 * This is the prototype's only ledger implementation: a browser-storage-backed
 * copy of the same ledger discipline the Node.js backend in the spec would
 * enforce (an idempotent transaction log behind every balance change). A
 * user with devtools access can edit this data; do not connect this class
 * to any real payout mechanism. The transaction log itself is never shown
 * in the UI (by design — see the README) but is kept internally because
 * idempotency and the daily gameplay coin cap both depend on it.
 */
@Injectable({ providedIn: 'root' })
export class LocalWalletRepository extends WalletRepositoryPort {
  private readonly state$ = new BehaviorSubject<WalletState>(this.load());
  private readonly references = new Set(this.state$.value.transactions.map((tx) => tx.referenceId).filter(Boolean));
  private snapshotState?: WalletState;
  private snapshotDay = '';
  private cachedSnapshot?: WalletSnapshot;

  private load(): WalletState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      return { ...emptyState(), ...(JSON.parse(raw) as WalletState) };
    } catch {
      return emptyState();
    }
  }

  private persist(next: WalletState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (next.transactions.length === 0) this.references.clear();
    for (let i = this.state$.value.transactions.length; i < next.transactions.length; i++) {
      const reference = next.transactions[i].referenceId;
      if (reference) this.references.add(reference);
    }
    this.state$.next(next);
  }

  private snapshot(state: WalletState): WalletSnapshot {
    const now = new Date();
    const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (this.snapshotState === state && this.snapshotDay === day && this.cachedSnapshot) return this.cachedSnapshot;
    let todayEarned = 0;
    let todayGameplayCoins = 0;
    let todayAdRewards = 0;
    for (const transaction of state.transactions) {
      if (transaction.amount <= 0 || !isSameDay(new Date(transaction.createdAt), now)) continue;
      todayEarned += transaction.amount;
      if (transaction.type === 'GAME_REWARD') todayGameplayCoins += transaction.amount;
      if (transaction.type === 'AD_REWARD') todayAdRewards++;
    }
    this.snapshotState = state;
    this.snapshotDay = day;
    this.cachedSnapshot = {
      availableCoins: state.balance,
      lifetimeEarned: state.lifetimeEarned,
      todayEarned,
      todayGameplayCoins,
      todayAdRewards,
    };
    return this.cachedSnapshot;
  }

  private current(): WalletState {
    return this.state$.value;
  }

  getWallet(): Observable<WalletSnapshot> {
    return this.state$.pipe(map((s) => this.snapshot(s)), distinctUntilChanged());
  }

  getTransactions(limit = 100): Observable<CoinTransaction[]> {
    return this.state$.pipe(
      map((s) => [...s.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit))
    );
  }

  hasReference(referenceId: string): Observable<boolean> {
    return this.state$.pipe(map(() => this.references.has(referenceId)), distinctUntilChanged());
  }

  getTodayGameplayCoins(): Observable<number> {
    return this.getWallet().pipe(map((w) => w.todayGameplayCoins));
  }

  getTodayAdRewardCount(): Observable<number> {
    return this.getWallet().pipe(map((w) => w.todayAdRewards));
  }

  credit(params: { amount: number; type: TransactionType; source: string; referenceId: string }): Observable<WalletSnapshot> {
    const state = this.current();

    // Idempotency guard (spec section 11): the same reference can never be credited twice.
    if (this.references.has(params.referenceId)) {
      return this.getWallet().pipe(take(1));
    }
    if (params.amount <= 0) {
      throw new Error('Credit amount must be positive');
    }

    const balanceBefore = state.balance;
    const balanceAfter = balanceBefore + params.amount;
    const tx: CoinTransaction = {
      id: newId(),
      type: params.type,
      amount: params.amount,
      balanceBefore,
      balanceAfter,
      source: params.source,
      referenceId: params.referenceId,
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
    };
    this.persist({
      ...state,
      balance: balanceAfter,
      lifetimeEarned: state.lifetimeEarned + params.amount,
      transactions: [...state.transactions, tx],
    });
    return this.getWallet().pipe(take(1));
  }

  debit(params: { amount: number; type: TransactionType; source: string; referenceId: string }): Observable<WalletSnapshot> {
    const state = this.current();
    if (this.references.has(params.referenceId)) {
      return this.getWallet().pipe(take(1));
    }
    if (params.amount <= 0) {
      throw new Error('Debit amount must be positive');
    }
    if (state.balance < params.amount) {
      throw new Error('Insufficient coin balance');
    }
    const balanceBefore = state.balance;
    const balanceAfter = balanceBefore - params.amount;
    const tx: CoinTransaction = {
      id: newId(),
      type: params.type,
      amount: -params.amount,
      balanceBefore,
      balanceAfter,
      source: params.source,
      referenceId: params.referenceId,
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
    };
    this.persist({ ...state, balance: balanceAfter, transactions: [...state.transactions, tx] });
    return this.getWallet().pipe(take(1));
  }

  resetAll(): Observable<void> {
    this.persist(emptyState());
    return of(undefined);
  }
}
