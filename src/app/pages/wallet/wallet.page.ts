import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { WalletService } from '../../core/services/wallet.service';

@Component({
  selector: 'app-wallet',
  templateUrl: './wallet.page.html',
  styleUrls: ['./wallet.page.scss'],
  standalone: false,
})
export class WalletPage {
  readonly wallet$ = this.walletService.wallet$;
  readonly minRedemptionCoins = this.walletService.minRedemptionCoins;

  constructor(
    private readonly router: Router,
    private readonly walletService: WalletService
  ) {}

  goRedeem(): void {
    this.router.navigateByUrl('/redeem');
  }

  goBack(): void {
    this.router.navigateByUrl('/home');
  }
}
