import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import { LastGameResultService, LastGameSummary } from '../../core/services/last-game-result.service';
import { AudioService } from '../../core/services/audio.service';
import { AdmobService } from '../../core/services/admob.service';

@Component({
  selector: 'app-game-over',
  templateUrl: './game-over.page.html',
  styleUrls: ['./game-over.page.scss'],
  standalone: false,
})
export class GameOverPage implements ViewWillEnter {
  // Signals throughout — see GamePage's doc comment on this app's zoneless
  // change detection; every one of these changes from an async ad/wallet
  // callback, never from a template-bound event.
  readonly summary = signal<LastGameSummary | null>(null);
  readonly navigating = signal(false);

  constructor(
    private readonly router: Router,
    private readonly lastGameResultService: LastGameResultService,
    private readonly audioService: AudioService,
    private readonly admobService: AdmobService
  ) {}

  ionViewWillEnter(): void {
    this.navigating.set(false);
    this.summary.set(null);

    const summary = this.lastGameResultService.consume();
    if (!summary) {
      this.router.navigateByUrl('/home', { replaceUrl: true });
      return;
    }
    this.summary.set(summary);
    this.admobService.recordCompletedRound(summary.sessionId);
    if (summary.outcome.coinsEarned > 0) this.audioService.coinEarned();
  }

  async playAgain(): Promise<void> {
    if (this.navigating()) return;
    this.navigating.set(true);
    try {
      await this.admobService.maybeShowInterstitialAtBreakpoint();
    } catch {
      // Ad errors should never block the user from playing again
    }
    this.router.navigateByUrl('/game', { replaceUrl: true });
  }

  async goHome(): Promise<void> {
    if (this.navigating()) return;
    this.navigating.set(true);
    try {
      await this.admobService.maybeShowInterstitialAtBreakpoint();
    } catch {
      // Ad errors should never block navigation
    }
    this.router.navigateByUrl('/home', { replaceUrl: true });
  }
}
