import { Component } from '@angular/core';
import { Router } from '@angular/router';

interface QuickLink {
  label: string;
  icon: string;
  path: string;
  color: string;
}

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.page.html',
  styleUrls: ['./welcome.page.scss'],
  standalone: false,
})
export class WelcomePage {
  readonly quickLinks: QuickLink[] = [
    { label: 'Wallet', icon: 'wallet', path: '/wallet', color: '#38bdf8' },
    { label: 'Cannon', icon: 'radio-button-on', path: '/shop', color: '#f97316' },
    { label: 'Shop', icon: 'storefront', path: '/shop', color: '#a855f7' },
    { label: 'Leaderboard', icon: 'trophy', path: '/leaderboard', color: '#fbbf24' },
    { label: 'Daily Rewards', icon: 'gift', path: '/daily-rewards', color: '#ef4444' },
    { label: 'Settings', icon: 'settings', path: '/settings', color: '#94a3b8' },
  ];

  constructor(private readonly router: Router) {}

  playNow(): void {
    this.router.navigateByUrl('/home');
  }

  open(path: string): void {
    this.router.navigateByUrl(path);
  }
}
