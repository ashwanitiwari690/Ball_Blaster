import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { PlayerProfileService } from '../../core/services/player-profile.service';
import { WalletService } from '../../core/services/wallet.service';

interface ProfileLink {
  label: string;
  icon: string;
  path: string;
}

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage {
  readonly profile$ = this.profileService.view$;
  readonly wallet$ = this.walletService.wallet$;

  readonly links: ProfileLink[] = [
    { label: 'Wallet', icon: 'wallet', path: '/wallet' },
    { label: 'Daily Rewards', icon: 'gift', path: '/daily-rewards' },
    { label: 'Leaderboard', icon: 'trophy', path: '/leaderboard' },
    { label: 'Settings', icon: 'settings', path: '/settings' },
  ];

  constructor(
    private readonly router: Router,
    private readonly profileService: PlayerProfileService,
    private readonly walletService: WalletService
  ) {}

  open(path: string): void {
    this.router.navigateByUrl(path);
  }
}
