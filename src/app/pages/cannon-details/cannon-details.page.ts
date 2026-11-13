import { Component, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { combineLatest, firstValueFrom, map } from 'rxjs';
import { ShopService } from '../../core/services/shop.service';
import { AudioService } from '../../core/services/audio.service';

@Component({
  selector: 'app-cannon-details',
  templateUrl: './cannon-details.page.html',
  styleUrls: ['./cannon-details.page.scss'],
  standalone: false,
})
export class CannonDetailsPage {
  readonly pending = signal<'coins' | 'ad' | null>(null);
  readonly busy$ = this.shopService.busy$;
  readonly state$ = combineLatest([this.route.paramMap, this.shopService.ownedIds$, this.shopService.equippedItems$]).pipe(
    map(([params, owned, equipped]) => {
      const item = this.shopService.getItem(params.get('id') ?? '');
      if (!item) void this.router.navigateByUrl('/shop', { replaceUrl: true });
      return { item, owned: !!item && owned.has(item.id), equipped: !!item && equipped[item.category] === item.id };
    })
  );

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly shopService: ShopService,
    private readonly audioService: AudioService,
    private readonly toastCtrl: ToastController
  ) {}

  goBack(): void {
    this.router.navigateByUrl('/shop');
  }

  async buyNow(itemId: string): Promise<void> {
    if (this.pending()) return;
    this.pending.set('coins');
    try {
      await firstValueFrom(this.shopService.purchase(itemId));
      this.audioService.purchaseSuccess();
      await this.toast('Purchased and equipped!', 'success');
    } catch (error) {
      this.audioService.purchaseFailed();
      await this.toast(error instanceof Error ? error.message : 'Purchase unavailable. Please try again.', 'warning');
    } finally {
      this.pending.set(null);
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

  async watchAd(itemId: string): Promise<void> {
    if (this.pending()) return;
    this.pending.set('ad');
    try {
      if (await this.shopService.unlockWithAd(itemId)) {
        this.audioService.claimReward();
        await this.toast('Unlocked and equipped!', 'success');
      } else {
        await this.toast(this.shopService.adUnavailableMessage, 'warning');
      }
    } catch (error) {
      await this.toast(error instanceof Error ? error.message : 'Ad unavailable. Please try again.', 'warning');
    } finally {
      this.pending.set(null);
    }
  }

  private async toast(message: string, color: 'success' | 'warning'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 1600, color, position: 'bottom' });
    await toast.present();
  }
}
