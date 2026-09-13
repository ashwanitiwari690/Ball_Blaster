import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { WalletService } from '../../core/services/wallet.service';
import { PlayerProfileService } from '../../core/services/player-profile.service';
import { DailyRewardsService } from '../../core/services/daily-rewards.service';
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

  constructor(
    private readonly router: Router,
    private readonly walletService: WalletService,
    private readonly profileService: PlayerProfileService,
    private readonly dailyRewardsService: DailyRewardsService
  ) {}

  playNow(): void {
    this.router.navigateByUrl('/game');
  }

  open(path: string): void {
    this.router.navigateByUrl(path);
  }
}
