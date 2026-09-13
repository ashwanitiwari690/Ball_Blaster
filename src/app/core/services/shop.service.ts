import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map, take } from 'rxjs';
import { WalletRepositoryPort } from '../ports/wallet-repository.port';
import { ShopItem } from '../models/shop.models';

const OWNED_KEY = 'bb.shop.owned.v1';
const EQUIPPED_CANNON_KEY = 'bb.shop.equipped-cannon.v1';
export const DEFAULT_CANNON_ID = 'default-cannon';

export const SHOP_ITEMS: ShopItem[] = [
  { id: DEFAULT_CANNON_ID, category: 'cannon', name: 'Standard Cannon', description: 'Reliable starter cannon.', price: 0, icon: 'rocket', accent: '#60a5fa', previewDescription: 'Balanced fire rate and damage. Everyone starts here.' },
  { id: 'fire-cannon', category: 'cannon', name: 'Fire Cannon', description: 'Blazing shots with a fiery trail.', price: 500, icon: 'flame', accent: '#f97316', previewDescription: 'Scorching bullet trail with extra visual punch on impact.' },
  { id: 'lightning-cannon', category: 'cannon', name: 'Lightning Cannon', description: 'Powerful lightning shots with extra flair.', price: 800, icon: 'flash', accent: '#38bdf8', previewDescription: 'Electric bolts arc between nearby balls on every hit.' },
  { id: 'ice-cannon', category: 'cannon', name: 'Ice Cannon', description: 'Frosty shots that shimmer on impact.', price: 800, icon: 'snow', accent: '#67e8f9', previewDescription: 'Crystalline frost burst plays whenever a ball is destroyed.' },
  { id: 'crystal-cannon', category: 'cannon', name: 'Crystal Cannon', description: 'Prismatic shots with dazzling refractions.', price: 1000, icon: 'diamond', accent: '#c084fc', previewDescription: 'Rainbow refraction trail with a shimmering muzzle flash.' },
  { id: 'gold-cannon', category: 'cannon', name: 'Gold Cannon', description: 'A prestige cannon for top players.', price: 1500, icon: 'trophy', accent: '#fbbf24', previewDescription: 'Solid-gold finish with a glittering particle trail.' },

  { id: 'neon-balls', category: 'ball', name: 'Neon Balls', description: 'Bright neon ball skin pack.', price: 300, icon: 'color-palette', accent: '#22d3ee', previewDescription: 'Balls glow with a bright neon outline.' },
  { id: 'galaxy-balls', category: 'ball', name: 'Galaxy Balls', description: 'Deep-space swirl ball skin pack.', price: 450, icon: 'planet', accent: '#818cf8', previewDescription: 'Balls are textured with a swirling galaxy pattern.' },

  { id: 'explosion-pack', category: 'effect', name: 'Explosion Pack', description: 'Bigger, punchier explosions.', price: 400, icon: 'sparkles', accent: '#f87171', previewDescription: 'Upgraded particle burst when a ball is destroyed.' },
  { id: 'bullet-trail-pack', category: 'effect', name: 'Bullet Trail Pack', description: 'Glowing bullet trails.', price: 350, icon: 'trail-sign', accent: '#4ade80', previewDescription: 'Every bullet leaves a smooth glowing trail.' },

  { id: 'dark-arcade-theme', category: 'theme', name: 'Dark Arcade', description: 'The default deep-space arcade backdrop.', price: 0, icon: 'moon', accent: '#3b82f6', previewDescription: 'Deep navy backdrop with soft neon nebula glow.' },
  { id: 'crimson-theme', category: 'theme', name: 'Crimson Ruins', description: 'A moody red-toned battleground.', price: 600, icon: 'bonfire', accent: '#ef4444', previewDescription: 'Ash-red ruins backdrop with ember particles.' },
];

/**
 * All shop items are priced in the same reward-coin balance the player
 * earns from gameplay (spec sections 19-22 allow this: spending earned
 * coins on cosmetics is a one-way sink, it never manufactures new
 * redeemable value). If real-money purchases (IAP) are added later, they
 * must mint a SEPARATE non-redeemable balance — never let a real-money
 * purchase credit the same `availableCoins` ledger this file spends from.
 */
@Injectable({ providedIn: 'root' })
export class ShopService {
  private readonly owned$ = new BehaviorSubject<Set<string>>(this.loadOwned());
  private readonly equipped$ = new BehaviorSubject<string>(this.loadEquipped());

  constructor(private readonly wallet: WalletRepositoryPort) {}

  private loadOwned(): Set<string> {
    try {
      const raw = localStorage.getItem(OWNED_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      return new Set([DEFAULT_CANNON_ID, 'dark-arcade-theme', ...ids]);
    } catch {
      return new Set([DEFAULT_CANNON_ID, 'dark-arcade-theme']);
    }
  }

  private loadEquipped(): string {
    return localStorage.getItem(EQUIPPED_CANNON_KEY) || DEFAULT_CANNON_ID;
  }

  get items(): ShopItem[] {
    return SHOP_ITEMS;
  }

  itemsByCategory(category: ShopItem['category']): ShopItem[] {
    return SHOP_ITEMS.filter((i) => i.category === category);
  }

  getItem(id: string): ShopItem | undefined {
    return SHOP_ITEMS.find((i) => i.id === id);
  }

  isOwned$(id: string): Observable<boolean> {
    return this.owned$.pipe(map((set) => set.has(id)));
  }

  get ownedIds$(): Observable<Set<string>> {
    return this.owned$.asObservable();
  }

  get equippedCannonId$(): Observable<string> {
    return this.equipped$.asObservable();
  }

  equipCannon(id: string): void {
    if (!this.owned$.value.has(id)) return;
    localStorage.setItem(EQUIPPED_CANNON_KEY, id);
    this.equipped$.next(id);
  }

  purchase(itemId: string): Observable<void> {
    const item = this.getItem(itemId);
    if (!item) throw new Error('Unknown item');
    if (this.owned$.value.has(itemId)) throw new Error('Already owned');

    return this.wallet
      .debit({ amount: item.price, type: 'SHOP_PURCHASE', source: itemId, referenceId: `purchase-${itemId}-${Date.now()}` })
      .pipe(
        take(1),
        map(() => {
          const nextOwned = new Set(this.owned$.value);
          nextOwned.add(itemId);
          localStorage.setItem(OWNED_KEY, JSON.stringify([...nextOwned]));
          this.owned$.next(nextOwned);
        })
      );
  }

  /** Combines ownership + coin balance so the Shop page can render Buy/Owned/Locked in one pass. */
  viewModel$(category: ShopItem['category']): Observable<Array<ShopItem & { owned: boolean; affordable: boolean }>> {
    return combineLatest([this.owned$, this.wallet.getWallet()]).pipe(
      map(([owned, wallet]) =>
        this.itemsByCategory(category).map((item) => ({
          ...item,
          owned: owned.has(item.id),
          affordable: wallet.availableCoins >= item.price,
        }))
      )
    );
  }
}
