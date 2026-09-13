import { Observable } from 'rxjs';
import { CoinTransaction, TransactionType, WalletSnapshot } from '../models/wallet.models';

/**
 * WALLET REPOSITORY — THE ONLY DOOR INTO THE COIN LEDGER
 * ---------------------------------------------------------------------
 * Every screen in this app reads/writes coins exclusively through this
 * interface. Nothing else in the UI layer is allowed to touch storage
 * directly. That is deliberate: it means the entire authoritative-balance
 * story can be swapped later by writing one new class (an
 * `ApiWalletRepository` that calls the Node.js backend from the spec)
 * and changing a single provider registration — no page or component
 * needs to change.
 *
 * `LocalWalletRepository` (the only implementation in this prototype)
 * is NOT secure: it stores the ledger in the browser's storage, which a
 * user fully controls. It still enforces the same rules a server would
 * (idempotency, daily caps, transaction history) so the app *behaves*
 * correctly for an honest player, but it must never be trusted with
 * real money. See the README security notes before shipping.
 */
export abstract class WalletRepositoryPort {
  abstract getWallet(): Observable<WalletSnapshot>;
  abstract getTransactions(limit?: number): Observable<CoinTransaction[]>;

  /**
   * Credits the wallet if, and only if, `referenceId` has never been
   * credited before (idempotency — spec section 11). Returns the
   * resulting wallet snapshot either way.
   */
  abstract credit(params: {
    amount: number;
    type: TransactionType;
    source: string;
    referenceId: string;
  }): Observable<WalletSnapshot>;

  /** Debits available coins (e.g. shop purchase). Throws if insufficient balance. */
  abstract debit(params: {
    amount: number;
    type: TransactionType;
    source: string;
    referenceId: string;
  }): Observable<WalletSnapshot>;

  abstract hasReference(referenceId: string): Observable<boolean>;

  /** How many monetary coins have already been earned today from gameplay. */
  abstract getTodayGameplayCoins(): Observable<number>;

  abstract getTodayAdRewardCount(): Observable<number>;

  /** Danger: wipes local wallet state. Used only from Settings for QA/demo purposes. */
  abstract resetAll(): Observable<void>;
}
