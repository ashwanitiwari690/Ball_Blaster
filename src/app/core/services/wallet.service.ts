import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { WalletRepositoryPort } from '../ports/wallet-repository.port';
import { WalletSnapshot } from '../models/wallet.models';
import { ECONOMY_CONFIG } from '../config/economy.config';

/**
 * WalletService is the only wallet-related surface the UI is allowed to
 * depend on (spec section 44). Note there is deliberately no `addCoins()`
 * method here — coins only ever enter the ledger through a reward-granting
 * service (GameRewardService, AdsService, DailyRewardsService) which each
 * apply their own validation before calling the repository.
 */
@Injectable({ providedIn: 'root' })
export class WalletService {
  constructor(private readonly repo: WalletRepositoryPort) {}

  get wallet$(): Observable<WalletSnapshot> {
    return this.repo.getWallet();
  }

  /** Kept for API parity with a future ApiWalletRepository that would re-fetch from the server. */
  refresh(): Observable<WalletSnapshot> {
    return this.repo.getWallet();
  }

  get minRedemptionCoins(): number {
    return ECONOMY_CONFIG.minRedemptionCoins;
  }
}
