import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-coin-pill',
  standalone: false,
  template: `
    <span class="bb-pill bb-coin-pill">
      <app-coin-icon [size]="16"></app-coin-icon>
      {{ coins | number }}
    </span>
  `,
  styles: [
    `
      .bb-coin-pill {
        color: #fbbf24;
      }
    `,
  ],
})
export class CoinPillComponent {
  @Input() coins = 0;
}
