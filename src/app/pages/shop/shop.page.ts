import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ShopService } from '../../core/services/shop.service';
import { ShopCategory } from '../../core/models/shop.models';
import { WalletService } from '../../core/services/wallet.service';
import { AudioService } from '../../core/services/audio.service';
import { AdsService } from '../../core/services/ads.service';

@Component({
  selector: 'app-shop',
  templateUrl: './shop.page.html',
  styleUrls: ['./shop.page.scss'],
  standalone: false,
})
export class ShopPage {
  readonly categories: { key: ShopCategory; label: string }[] = [
    { key: 'cannon', label: 'Cannons' },
    { key: 'ball', label: 'Balls' },
    { key: 'effect', label: 'Effects' },
    { key: 'theme', label: 'Themes' },
  ];

  category: ShopCategory = 'cannon';
  items$ = this.shopService.viewModel$(this.category);
  readonly wallet$ = this.walletService.wallet$;

  constructor(
    private readonly router: Router,
    private readonly shopService: ShopService,
    private readonly walletService: WalletService,
    private readonly audioService: AudioService,
    private readonly adsService: AdsService,
    private readonly toastCtrl: ToastController
  ) {}

  setCategory(cat: ShopCategory): void {
    this.category = cat;
    this.items$ = this.shopService.viewModel$(cat);
  }

  openItem(itemId: string, category: ShopCategory): void {
    if (category === 'cannon') {
      this.router.navigateByUrl(`/cannon-details/${itemId}`);
    }
  }

  async buy(itemId: string, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await new Promise<void>((resolve, reject) => {
        this.shopService.purchase(itemId).subscribe({ next: () => resolve(), error: reject });
      });
      this.audioService.purchaseSuccess();
      this.toast('Item purchased!', 'success');
    } catch {
      this.audioService.purchaseFailed();
      this.offerAdForCoins();
    }
  }

  /** Insufficient-funds path: offer the same capped rewarded ad Wallet uses, right when it's actually useful. */
  private async offerAdForCoins(): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: 'Not enough coins for this item.',
      duration: 3200,
      color: 'warning',
      position: 'bottom',
      buttons: [
        {
          text: 'Watch Ad for Coins',
          handler: () => {
            this.adsService.watchAd().subscribe((result) => {
              if (result.granted) {
                this.audioService.claimReward();
                this.toast(`+${result.coins} coins credited!`, 'success');
              } else {
                this.toast(result.reason ?? 'Ad reward unavailable.', 'warning');
              }
            });
          },
        },
      ],
    });
    await toast.present();
  }

  private async toast(message: string, color: 'success' | 'warning'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 1600, color, position: 'bottom' });
    await toast.present();
  }
}
