export type ShopCategory = 'cannon' | 'ball' | 'effect' | 'theme';

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
