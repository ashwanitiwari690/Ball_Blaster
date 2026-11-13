import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, defer, firstValueFrom, map } from 'rxjs';
import { WalletRepositoryPort } from '../ports/wallet-repository.port';
import { EquippedItems, GameAppearance, ShopItem, ShopItemState } from '../models/shop.models';
import { AdmobService } from './admob.service';

const OWNED_KEY = 'bb.shop.owned.v1';
const EQUIPPED_CANNON_KEY = 'bb.shop.equipped-cannon.v1';
const EQUIPPED_KEY = 'bb.shop.equipped.v2';
export const DEFAULT_CANNON_ID = 'default-cannon';
export const DEFAULT_EQUIPPED: EquippedItems = {
  cannon: DEFAULT_CANNON_ID, ball: 'classic-balls', shot: 'default-shot',
  effect: 'standard-effects', theme: 'dark-arcade-theme',
};

export const SHOP_ITEMS: ShopItem[] = [
  { id: DEFAULT_CANNON_ID, category: 'cannon', name: 'Standard Cannon', description: 'Reliable starter cannon.', price: 0, icon: 'rocket', accent: '#60a5fa', previewDescription: 'Balanced fire rate and damage. Everyone starts here.' },
  { id: 'fire-cannon', category: 'cannon', name: 'Fire Cannon', description: 'A fiery orange cannon and matching shots.', price: 500, icon: 'flame', accent: '#f97316', previewDescription: 'Orange cannon finish with fiery shots. Shot Colors can override the shot color.' },
  { id: 'lightning-cannon', category: 'cannon', name: 'Lightning Cannon', description: 'An electric blue cannon finish.', price: 800, icon: 'flash', accent: '#38bdf8', previewDescription: 'Electric blue cannon and matching shots. Cosmetic only; fire rate and damage stay balanced.' },
  { id: 'ice-cannon', category: 'cannon', name: 'Ice Cannon', description: 'A frosty cyan cannon and matching shots.', price: 800, icon: 'snow', accent: '#67e8f9', previewDescription: 'Ice-blue cannon finish and shots with matching impact sparks.' },
  { id: 'crystal-cannon', category: 'cannon', name: 'Crystal Cannon', description: 'A violet crystal cannon finish.', price: 1000, icon: 'diamond', accent: '#c084fc', previewDescription: 'Violet cannon finish and matching shots. Add a trail from Effects for more sparkle.' },
  { id: 'gold-cannon', category: 'cannon', name: 'Gold Cannon', description: 'A prestige cannon for top players.', price: 1500, icon: 'trophy', accent: '#fbbf24', previewDescription: 'Gold cannon finish and golden shots. Pair it with the Bullet Trail Pack for golden trails.' },

  { id: 'classic-balls', category: 'ball', name: 'Classic Balls', description: 'Original tier-colored targets.', price: 0, icon: 'ellipse', accent: '#60a5fa', previewDescription: 'The original ball artwork, with each tier keeping its own color.' },
  { id: 'neon-balls', category: 'ball', name: 'Neon Balls', description: 'Bright neon ball skin pack.', price: 300, icon: 'color-palette', accent: '#22d3ee', previewDescription: 'Balls glow with a bright neon outline.' },
  { id: 'galaxy-balls', category: 'ball', name: 'Galaxy Balls', description: 'Deep-space swirl ball skin pack.', price: 450, icon: 'planet', accent: '#818cf8', previewDescription: 'Balls are textured with a swirling galaxy pattern.' },

  { id: 'default-shot', category: 'shot', name: 'Cannon Match', description: 'Shots match your equipped cannon.', price: 0, icon: 'ellipse', accent: '#e0f2fe', previewDescription: 'Classic white shots for the starter cannon; matching color for other cannons.' },
  { id: 'ruby-shot', category: 'shot', name: 'Ruby Red', description: 'Fire bright red cannon balls.', price: 100, icon: 'ellipse', accent: '#fb7185', previewDescription: 'Red cannon shots and matching impact sparks.' },
  { id: 'emerald-shot', category: 'shot', name: 'Emerald Green', description: 'Fire vivid green cannon balls.', price: 100, icon: 'ellipse', accent: '#4ade80', previewDescription: 'Green cannon shots and matching impact sparks.' },
  { id: 'violet-shot', category: 'shot', name: 'Cosmic Violet', description: 'Fire glowing violet cannon balls.', price: 150, icon: 'ellipse', accent: '#c084fc', previewDescription: 'Violet cannon shots and matching impact sparks.' },
  { id: 'sunshine-shot', category: 'shot', name: 'Sunshine Gold', description: 'Fire golden cannon balls.', price: 150, icon: 'ellipse', accent: '#fbbf24', previewDescription: 'Golden cannon shots and matching impact sparks.' },

  { id: 'standard-effects', category: 'effect', name: 'Classic Effects', description: 'The original impact sparks.', price: 0, icon: 'sparkles', accent: '#e0f2fe', previewDescription: 'Standard bursts and clear, simple shots.' },
  { id: 'explosion-pack', category: 'effect', name: 'Explosion Pack', description: 'Bigger, punchier explosions.', price: 400, icon: 'sparkles', accent: '#f87171', previewDescription: 'Upgraded particle burst when a ball is destroyed.' },
  { id: 'bullet-trail-pack', category: 'effect', name: 'Bullet Trail Pack', description: 'Glowing bullet trails.', price: 350, icon: 'trail-sign', accent: '#4ade80', previewDescription: 'Every bullet leaves a smooth glowing trail.' },

  { id: 'dark-arcade-theme', category: 'theme', name: 'Dark Arcade', description: 'The default deep-space arcade backdrop.', price: 0, icon: 'moon', accent: '#3b82f6', previewDescription: 'Deep navy backdrop with soft neon nebula glow.' },
  { id: 'crimson-theme', category: 'theme', name: 'Crimson Ruins', description: 'A moody red-toned battleground.', price: 600, icon: 'bonfire', accent: '#ef4444', previewDescription: 'A deep crimson backdrop with warm ember-colored stars.' },
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
  private readonly equipped$ = new BehaviorSubject<EquippedItems>(this.loadEquipped());
  private readonly busyState = new BehaviorSubject(false);
  readonly busy$ = this.busyState.asObservable();

  constructor(private readonly wallet: WalletRepositoryPort, private readonly admob: AdmobService) {}

  private loadOwned(): Set<string> {
    try {
      const raw = localStorage.getItem(OWNED_KEY);
      const ids: unknown = raw ? JSON.parse(raw) : [];
      const saved = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && !!this.getItem(id)) : [];
      return new Set([...Object.values(DEFAULT_EQUIPPED), ...saved]);
    } catch {
      return new Set(Object.values(DEFAULT_EQUIPPED));
    }
  }

  private loadEquipped(): EquippedItems {
    const equipped = { ...DEFAULT_EQUIPPED };
    try {
      const saved = JSON.parse(localStorage.getItem(EQUIPPED_KEY) || '{}') as Partial<EquippedItems> | null;
      for (const category of Object.keys(equipped) as Array<keyof EquippedItems>) {
        const id = saved?.[category] ?? (category === 'cannon' ? localStorage.getItem(EQUIPPED_CANNON_KEY) : null);
        if (id && this.owned$.value.has(id) && this.getItem(id)?.category === category) equipped[category] = id;
      }
    } catch {
      // Invalid stored selections fall back to the included items.
    }
    return equipped;
  }

  itemsByCategory(category: ShopItem['category']): ShopItem[] {
    return SHOP_ITEMS.filter((i) => i.category === category);
  }

  getItem(id: string): ShopItem | undefined {
    return SHOP_ITEMS.find((i) => i.id === id);
  }

  get ownedIds$(): Observable<Set<string>> {
    return this.owned$.asObservable();
  }

  get equippedItems$(): Observable<EquippedItems> {
    return this.equipped$.asObservable();
  }

  get appearance$(): Observable<GameAppearance> {
    return this.equipped$.pipe(map((equipped) => this.appearanceFor(equipped)));
  }

  get appearance(): GameAppearance {
    return this.appearanceFor(this.equipped$.value);
  }

  private appearanceFor(equipped: EquippedItems): GameAppearance {
    const cannon = this.getItem(equipped.cannon)!;
    const shot = this.getItem(equipped.shot)!;
    return {
      cannonColor: cannon.accent,
      shotColor: shot.id === DEFAULT_EQUIPPED.shot
        ? (cannon.id === DEFAULT_CANNON_ID ? '#e0f2fe' : cannon.accent) : shot.accent,
      ballSkin: equipped.ball === 'neon-balls' ? 'neon' : equipped.ball === 'galaxy-balls' ? 'galaxy' : 'classic',
      effect: equipped.effect === 'explosion-pack' ? 'explosion' : equipped.effect === 'bullet-trail-pack' ? 'trail' : 'standard',
      theme: equipped.theme === 'crimson-theme' ? 'crimson' : 'arcade',
    };
  }

  equip(id: string): void {
    const item = this.getItem(id);
    if (!item || !this.owned$.value.has(id)) throw new Error('Unlock this item before equipping it.');
    const next = { ...this.equipped$.value, [item.category]: id };
    localStorage.setItem(EQUIPPED_KEY, JSON.stringify(next));
    localStorage.setItem(EQUIPPED_CANNON_KEY, next.cannon);
    this.equipped$.next(next);
  }

  purchase(itemId: string): Observable<void> {
    return defer(() => this.acquire(itemId, false)).pipe(map(() => undefined));
  }

  unlockWithAd(itemId: string): Promise<boolean> {
    return this.acquire(itemId, true);
  }

  get adUnavailableMessage(): string {
    switch (this.admob.lastRewardFailureReason) {
      case 'cooldown': return 'Please wait before watching another ad.';
      case 'busy': return 'Another ad is in progress. Please wait.';
      case 'unsupported': return 'Rewarded ads are unavailable on this device.';
      case 'dismissed_early': return 'Ad closed before the reward was earned. Item not unlocked.';
      default: return 'No ad is available right now. You can use coins or try again later.';
    }
  }

  private async acquire(itemId: string, useAd: boolean): Promise<boolean> {
    const item = this.getItem(itemId);
    if (!item) throw new Error('Unknown shop item.');
    if (this.owned$.value.has(itemId)) throw new Error('You already own this item. Tap Equip to use it.');
    if (this.busyState.value) throw new Error('Please wait for the current purchase to finish.');
    this.busyState.next(true);
    try {
      if (useAd) {
        if (!await this.admob.showRewarded('cosmetic-unlock')) return false;
      } else if (item.price > 0) {
        // A retry after a storage error must not charge for the same permanent unlock twice.
        await firstValueFrom(this.wallet.debit({
          amount: item.price, type: 'SHOP_PURCHASE', source: itemId, referenceId: `purchase-${itemId}`,
        }));
      }
      const nextOwned = new Set(this.owned$.value);
      nextOwned.add(itemId);
      localStorage.setItem(OWNED_KEY, JSON.stringify([...nextOwned]));
      this.owned$.next(nextOwned);
      this.equip(itemId);
      return true;
    } finally {
      this.busyState.next(false);
    }
  }

  /** Combines ownership + coin balance so the Shop page can render Buy/Owned/Locked in one pass. */
  viewModel$(category: ShopItem['category']): Observable<ShopItemState[]> {
    return combineLatest([this.owned$, this.equipped$, this.wallet.getWallet()]).pipe(
      map(([owned, equipped, wallet]) =>
        this.itemsByCategory(category).map((item) => ({
          ...item,
          owned: owned.has(item.id),
          equipped: equipped[category] === item.id,
          affordable: wallet.availableCoins >= item.price,
        }))
      )
    );
  }
}
