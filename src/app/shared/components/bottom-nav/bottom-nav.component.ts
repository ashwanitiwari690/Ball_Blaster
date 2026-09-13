import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';

interface NavItem {
  label: string;
  icon: string;
  path: string;
}

@Component({
  selector: 'app-bottom-nav',
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.scss'],
  standalone: false,
})
export class BottomNavComponent {
  @Input() active: 'home' | 'game' | 'shop' | 'profile' | '' = '';

  readonly items: NavItem[] = [
    { label: 'Home', icon: 'home', path: '/home' },
    { label: 'Game', icon: 'game-controller', path: '/game' },
    { label: 'Shop', icon: 'storefront', path: '/shop' },
    { label: 'Profile', icon: 'person', path: '/profile' },
  ];

  constructor(private readonly router: Router) {}

  go(path: string): void {
    this.router.navigateByUrl(path);
  }

  isActive(item: NavItem): boolean {
    return item.path === `/${this.active}`;
  }
}
