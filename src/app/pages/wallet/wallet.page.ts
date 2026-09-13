import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { WalletService } from '../../core/services/wallet.service';
import { AdsService } from '../../core/services/ads.service';
import { AudioService } from '../../core/services/audio.service';

@Component({
  selector: 'app-wallet',
  templateUrl: './wallet.page.html',
  styleUrls: ['./wallet.page.scss'],
  standalone: false,
})
export class WalletPage {
  readonly wallet$ = this.walletService.wallet$;
  readonly adsRemaining$ = this.adsService.remainingToday$;
  readonly minRedemptionCoins = this.walletService.minRedemptionCoins;
  // A signal, not a plain field: this app runs zoneless, and the flip back
  // to false happens inside an async RxJS callback (AdsService simulates
  // ad-view latency), which zoneless change detection cannot see otherwise.
  readonly watchingAd = signal(false);

  constructor(
    private readonly router: Router,
    private readonly walletService: WalletService,
    private readonly adsService: AdsService,
    private readonly audioService: AudioService,
    private readonly toastCtrl: ToastController
  ) {}

  watchAd(): void {
    if (this.watchingAd()) return;
    this.watchingAd.set(true);
    this.adsService.watchAd().subscribe(async (result) => {
      this.watchingAd.set(false);
      if (result.granted) this.audioService.claimReward();
      const message = result.granted ? `+${result.coins} coins credited!` : result.reason ?? 'Ad reward unavailable.';
      const toast = await this.toastCtrl.create({
        message,
        duration: 1800,
        color: result.granted ? 'success' : 'warning',
        position: 'bottom',
      });
      await toast.present();
    });
  }

  goRedeem(): void {
    this.router.navigateByUrl('/redeem');
  }

  goBack(): void {
    this.router.navigateByUrl('/home');
  }
}
