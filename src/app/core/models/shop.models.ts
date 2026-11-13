export type ShopCategory = 'cannon' | 'ball' | 'shot' | 'effect' | 'theme';

export type EquippedItems = Record<ShopCategory, string>;

/** Cosmetic choices consumed by the canvas engine; damage and rewards stay unchanged. */
export interface GameAppearance {
  cannonColor: string;
  shotColor: string;
  ballSkin: 'classic' | 'neon' | 'galaxy';
  effect: 'standard' | 'explosion' | 'trail';
  theme: 'arcade' | 'crimson';
}

export interface ShopItemState extends ShopItem {
  owned: boolean;
  equipped: boolean;
  affordable: boolean;
}

export interface ShopItem {
  id: string;
  category: ShopCategory;
  name: string;
  description: string;
  price: number; // spent in reward coins — a one-way sink, never redeemable back to cash
  icon: string; // ionicon name or emoji used as a placeholder for real art
  accent: string; // hex color for the item's glow/theme
  previewDescription: string;
}
