import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { DailyRewardsService } from '../../core/services/daily-rewards.service';
import { AudioService } from '../../core/services/audio.service';
import { AdmobService } from '../../core/services/admob.service';

@Component({
  selector: 'app-daily-rewards',
  templateUrl: './daily-rewards.page.html',
  styleUrls: ['./daily-rewards.page.scss'],
  standalone: false,
})
export class DailyRewardsPage {
  readonly view$ = this.dailyRewards.view$;
  // Signals — see GamePage's doc comment on this app's zoneless change detection.
  readonly claiming = signal(false);
  readonly doubling = signal(false);

  constructor(
    private readonly router: Router,
    private readonly dailyRewards: DailyRewardsService,
    private readonly audioService: AudioService,
    private readonly admobService: AdmobService,
    private readonly toastCtrl: ToastController
  ) {}

  goBack(): void {
    this.router.navigateByUrl('/home');
  }

  claim(): void {
    if (this.claiming()) return;
    this.claiming.set(true);
    this.dailyRewards.claim().subscribe({
      next: ({ day, coins }) => {
        this.claiming.set(false);
        this.audioService.claimReward();
        this.toast(`Day ${day} reward claimed: +${coins} coins!`, 'success');
      },
      error: () => {
        this.claiming.set(false);
      },
    });
  }

  /** Watches a rewarded ad to grant a second copy of today's already-claimed reward. */
  async doubleToday(): Promise<void> {
    if (this.doubling()) return;
    this.doubling.set(true);
    try {
      const watched = await this.admobService.showRewarded();
      if (!watched) {
        this.toast('Ad not completed — reward not doubled.', 'warning');
        return;
      }
      this.dailyRewards.doubleToday().subscribe({
        next: ({ coins }) => {
          this.audioService.claimReward();
          this.toast(`Doubled! +${coins} bonus coins.`, 'success');
        },
        error: () => this.toast('Could not double the reward.', 'warning'),
      });
    } finally {
      this.doubling.set(false);
    }
  }

  private async toast(message: string, color: 'success' | 'warning'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 1800, color, position: 'bottom' });
    await toast.present();
  }
}
