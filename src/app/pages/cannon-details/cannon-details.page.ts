import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { combineLatest, map } from 'rxjs';
import { ShopService } from '../../core/services/shop.service';
import { ShopItem } from '../../core/models/shop.models';
import { AudioService } from '../../core/services/audio.service';
import { AdsService } from '../../core/services/ads.service';

@Component({
  selector: 'app-cannon-details',
  templateUrl: './cannon-details.page.html',
  styleUrls: ['./cannon-details.page.scss'],
  standalone: false,
})
export class CannonDetailsPage implements OnInit {
  item?: ShopItem;
  readonly state$ = combineLatest([this.shopService.ownedIds$, this.shopService.equippedCannonId$]).pipe(
    map(([owned, equipped]) => ({
      owned: this.item ? owned.has(this.item.id) : false,
      equipped: this.item ? equipped === this.item.id : false,
    }))
  );

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly shopService: ShopService,
    private readonly audioService: AudioService,
    private readonly adsService: AdsService,
    private readonly toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.item = this.shopService.getItem(id);
    if (!this.item) {
      this.router.navigateByUrl('/shop', { replaceUrl: true });
    }
  }

  goBack(): void {
    this.router.navigateByUrl('/shop');
  }

  async buyNow(): Promise<void> {
    if (!this.item) return;
    try {
      await new Promise<void>((resolve, reject) => {
        this.shopService.purchase(this.item!.id).subscribe({ next: () => resolve(), error: reject });
      });
      this.audioService.purchaseSuccess();
      this.toast('Item purchased!', 'success');
    } catch {
      this.audioService.purchaseFailed();
      this.offerAdForCoins();
    }
  }

  equip(): void {
    if (!this.item) return;
    this.shopService.equipCannon(this.item.id);
    this.audioService.buttonTap();
    this.toast('Cannon equipped!', 'success');
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
