import { Component, Input } from '@angular/core';

let nextCoinIconId = 0;

/**
 * A game-coin glyph. Ionicons has no generic "coin" icon (only
 * `logo-bitcoin`, which reads as literal cryptocurrency and is wrong for an
 * in-game reward currency), so this renders a small inline SVG coin instead.
 */
@Component({
  selector: 'app-coin-icon',
  standalone: false,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <radialGradient [attr.id]="gradId" cx="34%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#fef9c3" />
          <stop offset="55%" stop-color="#fbbf24" />
          <stop offset="100%" stop-color="#b45309" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10.25" [attr.fill]="'url(#' + gradId + ')'" stroke="#78350f" stroke-width="1" />
      <circle cx="12" cy="12" r="7.4" fill="none" stroke="#fef3c7" stroke-width="1" opacity="0.55" />
      <ellipse cx="8.6" cy="8.2" rx="2.6" ry="1.4" fill="#fffbeb" opacity="0.5" transform="rotate(-35 8.6 8.2)" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        line-height: 0;
        flex-shrink: 0;
      }
    `,
  ],
})
export class CoinIconComponent {
  @Input() size = 18;
  readonly gradId = `coin-grad-${nextCoinIconId++}`;
}
