import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { DailyRewardsService } from '../../core/services/daily-rewards.service';
import { AudioService } from '../../core/services/audio.service';

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

  constructor(
    private readonly router: Router,
    private readonly dailyRewards: DailyRewardsService,
    private readonly audioService: AudioService,
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

  private async toast(message: string, color: 'success' | 'warning'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 1800, color, position: 'bottom' });
    await toast.present();
  }
}
