import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ShopService } from '../../core/services/shop.service';
import { ShopCategory } from '../../core/models/shop.models';
import { WalletService } from '../../core/services/wallet.service';
import { AudioService } from '../../core/services/audio.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-shop',
  templateUrl: './shop.page.html',
  styleUrls: ['./shop.page.scss'],
  standalone: false,
})
export class ShopPage {
  readonly categories: { key: ShopCategory; label: string }[] = [
    { key: 'cannon', label: 'Cannons' },
    { key: 'shot', label: 'Shot Colors' },
    { key: 'ball', label: 'Balls' },
    { key: 'effect', label: 'Effects' },
    { key: 'theme', label: 'Themes' },
  ];

  category: ShopCategory = 'cannon';
  items$ = this.shopService.viewModel$(this.category);
  readonly wallet$ = this.walletService.wallet$;
  readonly busy$ = this.shopService.busy$;
  readonly pendingItemId = signal<string | null>(null);
  readonly pendingMethod = signal<'coins' | 'ad' | null>(null);

  constructor(
    private readonly router: Router,
    private readonly shopService: ShopService,
    private readonly walletService: WalletService,
    private readonly audioService: AudioService,
    private readonly toastCtrl: ToastController
  ) {}

  setCategory(cat: ShopCategory): void {
    this.category = cat;
    this.items$ = this.shopService.viewModel$(cat);
  }

  openItem(itemId: string): void {
    this.router.navigateByUrl(`/cannon-details/${itemId}`);
  }

  async buy(itemId: string): Promise<void> {
    if (this.pendingItemId()) return;
    this.pendingItemId.set(itemId);
    this.pendingMethod.set('coins');
    try {
      await firstValueFrom(this.shopService.purchase(itemId));
      this.audioService.purchaseSuccess();
      await this.toast('Purchased and equipped!', 'success');
    } catch (error) {
      this.audioService.purchaseFailed();
      await this.toast(error instanceof Error ? error.message : 'Purchase unavailable. Please try again.', 'warning');
    } finally {
      this.pendingItemId.set(null);
      this.pendingMethod.set(null);
    }
  }

  async watchAd(itemId: string): Promise<void> {
    if (this.pendingItemId()) return;
    this.pendingItemId.set(itemId);
    this.pendingMethod.set('ad');
    try {
      const granted = await this.shopService.unlockWithAd(itemId);
      if (granted) {
        this.audioService.claimReward();
        await this.toast('Unlocked and equipped!', 'success');
      } else {
        await this.toast(this.shopService.adUnavailableMessage, 'warning');
      }
    } catch (error) {
      await this.toast(error instanceof Error ? error.message : 'Ad unavailable. Please try again.', 'warning');
    } finally {
      this.pendingItemId.set(null);
      this.pendingMethod.set(null);
    }
  }

  async equip(itemId: string): Promise<void> {
    try {
      this.shopService.equip(itemId);
      this.audioService.buttonTap();
      await this.toast('Item equipped!', 'success');
    } catch (error) {
      await this.toast(error instanceof Error ? error.message : 'Unable to equip this item.', 'warning');
    }
  }

  private async toast(message: string, color: 'success' | 'warning'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 1600, color, position: 'bottom' });
    await toast.present();
  }
}
