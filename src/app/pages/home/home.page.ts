import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { WalletService } from '../../core/services/wallet.service';
import { PlayerProfileService } from '../../core/services/player-profile.service';
import { DailyRewardsService } from '../../core/services/daily-rewards.service';
import { AdmobService } from '../../core/services/admob.service';
import { WalletSnapshot } from '../../core/models/wallet.models';

interface QuickAccessItem {
  label: string;
  icon: string;
  path: string;
  color: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false,
})
export class HomePage {
  readonly wallet$: Observable<WalletSnapshot> = this.walletService.wallet$;
  readonly profile$ = this.profileService.view$;
  readonly dailyReward$ = this.dailyRewardsService.view$;

  readonly quickAccess: QuickAccessItem[] = [
    { label: 'Wallet', icon: 'wallet', path: '/wallet', color: '#38bdf8' },
    { label: 'Cannon', icon: 'radio-button-on', path: '/shop', color: '#f97316' },
    { label: 'Shop', icon: 'storefront', path: '/shop', color: '#a855f7' },
    { label: 'Leaderboard', icon: 'trophy', path: '/leaderboard', color: '#fbbf24' },
    { label: 'Daily Rewards', icon: 'gift', path: '/daily-rewards', color: '#ef4444' },
    { label: 'Settings', icon: 'settings', path: '/settings', color: '#94a3b8' },
  ];

  // A signal, not a plain field: this app runs zoneless, and it flips back
  // to false inside an async AdmobService continuation, which zoneless
  // change detection cannot see on its own (see README's zoneless note).
  readonly launchingGame = signal(false);

  constructor(
    private readonly router: Router,
    private readonly walletService: WalletService,
    private readonly profileService: PlayerProfileService,
    private readonly dailyRewardsService: DailyRewardsService,
    private readonly admobService: AdmobService
  ) {}

  /**
   * Navigates directly to the game (no unexpected interstitials).



   */
  playNow(): void {
    if (this.launchingGame()) return;
    this.launchingGame.set(true);

    this.launchingGame.set(false);
    this.router.navigateByUrl('/game');
  }

  open(path: string): void {
    this.router.navigateByUrl(path);
  }
}
