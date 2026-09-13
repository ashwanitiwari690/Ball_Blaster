export type TransactionType =
  | 'GAME_REWARD'
  | 'DAILY_REWARD'
  | 'AD_REWARD'
  | 'BONUS'
  | 'SHOP_PURCHASE'
  | 'REDEMPTION'
  | 'REVERSAL'
  | 'ADMIN_ADJUSTMENT';

export type TransactionStatus = 'COMPLETED' | 'PENDING' | 'REVERSED';

export interface CoinTransaction {
  id: string;
  type: TransactionType;
  amount: number; // positive = credit, negative = debit
  balanceBefore: number;
  balanceAfter: number;
  source: string;
  referenceId?: string;
  status: TransactionStatus;
  createdAt: string; // ISO timestamp
}

export interface WalletSnapshot {
  /** The coins the player currently owns — the one number this whole app exists to track accurately. */
  availableCoins: number;
  lifetimeEarned: number;
  todayEarned: number;
  todayGameplayCoins: number; // counted against the daily gameplay cap
  todayAdRewards: number; // counted against maxAdRewardsPerDay
}
