import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { WalletService } from '../../core/services/wallet.service';
import { RedemptionService, isValidMobileNumber } from '../../core/services/redemption.service';
import { RedeemApiError } from '../../core/services/reward-api.service';
import { AudioService } from '../../core/services/audio.service';

type RedeemState = 'idle' | 'loading' | 'success' | 'error';

@Component({
  selector: 'app-redeem',
  templateUrl: './redeem.page.html',
  styleUrls: ['./redeem.page.scss'],
  standalone: false,
})
export class RedeemPage {
  readonly wallet$ = this.walletService.wallet$;
  readonly minRedemption = this.redemptionService.minRedemptionCoins;

  mobileNumber = '';
  // Signals — see GamePage's doc comment on this app's zoneless change
  // detection: all of these flip inside an async HTTP response callback.
  readonly state = signal<RedeemState>('idle');
  readonly result = signal<{ coins: number; rupees: string } | null>(null);
  readonly errorCode = signal<string | null>(null);
  readonly errorMessage = signal('');

  /** Blocks resubmission of a redemption the backend already confirmed as processed. */
  private duplicateSnapshot: { coins: number; mobileNumber: string } | null = null;

  constructor(
    private readonly router: Router,
    private readonly walletService: WalletService,
    private readonly redemptionService: RedemptionService,
    private readonly audioService: AudioService
  ) {}

  get isLoading(): boolean {
    return this.state() === 'loading';
  }

  get mobileNumberValid(): boolean {
    return isValidMobileNumber(this.mobileNumber);
  }

  isBlockedByDuplicate(currentCoins: number): boolean {
    return (
      !!this.duplicateSnapshot &&
      this.duplicateSnapshot.coins === currentCoins &&
      this.duplicateSnapshot.mobileNumber === this.mobileNumber
    );
  }

  goBack(): void {
    this.router.navigateByUrl('/wallet');
  }

  /** Strips anything but digits as the user types, and caps at 10 — a phone number can never end up negative or non-numeric. */
  onMobileNumberInput(value: string): void {
    this.mobileNumber = value.replace(/[^0-9]/g, '').slice(0, 10);
    if (!this.isLoading) {
      this.state.set('idle');
      this.errorCode.set(null);
      this.errorMessage.set('');
    }
  }

  submit(currentCoins: number): void {
    if (this.isLoading || !this.mobileNumberValid || this.isBlockedByDuplicate(currentCoins)) return;

    this.state.set('loading');
    this.errorMessage.set('');
    this.result.set(null);

    this.redemptionService.redeem(this.mobileNumber, currentCoins).subscribe({
      next: (res) => {
        this.audioService.redeemRequested();
        this.result.set({ coins: res.coinsRedeemed, rupees: res.amountCredited });
        this.state.set('success');
      },
      error: (err: RedeemApiError) => {
        this.state.set('error');
        this.errorCode.set(err.errorCode ?? null);
        if (err.errorCode === 'DUPLICATE_CONVERSION') {
          this.duplicateSnapshot = { coins: currentCoins, mobileNumber: this.mobileNumber };
          this.errorMessage.set('');
        } else {
          this.errorMessage.set(err.message || '');
        }
      },
    });
  }

  dismiss(): void {
    this.router.navigateByUrl('/wallet', { replaceUrl: true });
  }
}
