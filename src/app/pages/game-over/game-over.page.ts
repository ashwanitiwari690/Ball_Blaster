import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LastGameResultService, LastGameSummary } from '../../core/services/last-game-result.service';
import { AudioService } from '../../core/services/audio.service';
import { AdmobService } from '../../core/services/admob.service';
import { WalletRepositoryPort } from '../../core/ports/wallet-repository.port';

@Component({
  selector: 'app-game-over',
  templateUrl: './game-over.page.html',
  styleUrls: ['./game-over.page.scss'],
  standalone: false,
})
export class GameOverPage implements OnInit {
  // Signals throughout — see GamePage's doc comment on this app's zoneless
  // change detection; every one of these changes from an async ad/wallet
  // callback, never from a template-bound event.
  readonly summary = signal<LastGameSummary | null>(null);
  readonly processing = signal(true);
  readonly doublingCoins = signal(false);
  readonly doubledCoins = signal(false);
  readonly navigating = signal(false);

  constructor(
    private readonly router: Router,
    private readonly lastGameResultService: LastGameResultService,
    private readonly audioService: AudioService,
    private readonly admobService: AdmobService,
    private readonly wallet: WalletRepositoryPort
  ) {}

  ngOnInit(): void {
    const summary = this.lastGameResultService.consume();
    if (!summary) {
      this.router.navigateByUrl('/home', { replaceUrl: true });
      return;
    }
    this.summary.set(summary);
    // A brief, honest "confirming with the server" beat — in production this
    // is the real latency of POST /game/session/complete (spec section 31).
    setTimeout(() => {
      this.processing.set(false);
      if (summary.outcome.coinsEarned > 0) this.audioService.coinEarned();
    }, 700);
  }

  private doubleReferenceId(sessionId: string): string {
    return `ad-double-${sessionId}`;
  }

  /**
   * Watches a rewarded ad to grant a second copy of this run's coins.
   * Idempotent per session via the ledger's referenceId guard (in addition
   * to the `doubledCoins`/`doublingCoins` UI guards), so this can never be
   * granted twice even if triggered again some other way.
   */
  async doubleCoins(): Promise<void> {
    const s = this.summary();
    if (!s || this.doublingCoins() || this.doubledCoins() || s.outcome.coinsEarned <= 0) return;
    this.doublingCoins.set(true);
    try {
      const watched = await this.admobService.showRewarded();
      if (!watched) return;
      this.wallet
        .credit({
          amount: s.outcome.coinsEarned,
          type: 'AD_REWARD',
          source: 'game-over-double',
          referenceId: this.doubleReferenceId(s.sessionId),
        })
        .subscribe((wallet) => {
          this.doubledCoins.set(true);
          this.audioService.coinEarned();
          this.summary.update((current) => (current ? { ...current, outcome: { ...current.outcome, wallet } } : current));
        });
    } finally {
      this.doublingCoins.set(false);
    }
  }

  async playAgain(): Promise<void> {
    if (this.navigating()) return;
    this.navigating.set(true);
    await this.admobService.maybeShowInterstitialAtBreakpoint();
    this.router.navigateByUrl('/game', { replaceUrl: true });
  }

  async goHome(): Promise<void> {
    if (this.navigating()) return;
    this.navigating.set(true);
    await this.admobService.maybeShowInterstitialAtBreakpoint();
    this.router.navigateByUrl('/home', { replaceUrl: true });
  }
}
