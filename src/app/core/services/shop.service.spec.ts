import { firstValueFrom } from 'rxjs';
import { LocalWalletRepository } from '../adapters/local-wallet-repository';
import { AdmobService } from './admob.service';
import { DEFAULT_EQUIPPED, SHOP_ITEMS, ShopService } from './shop.service';

describe('ShopService purchases and equipment', () => {
  let wallet: LocalWalletRepository;
  let ads: { showRewarded: ReturnType<typeof vi.fn> };
  let shop: ShopService;

  const snapshot = () => firstValueFrom(wallet.getWallet());
  const owned = () => firstValueFrom(shop.ownedIds$);

  beforeEach(() => {
    localStorage.clear();
    wallet = new LocalWalletRepository();
    ads = { showRewarded: vi.fn(async () => true) };
    shop = new ShopService(wallet, ads as unknown as AdmobService);
    wallet.credit({ amount: 10_000, type: 'BONUS', source: 'test', referenceId: 'test-balance' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('includes a selectable free default for every category', async () => {
    for (const id of Object.values(DEFAULT_EQUIPPED)) {
      expect((await owned()).has(id)).toBe(true);
      expect(shop.getItem(id)?.price).toBe(0);
      shop.equip(id);
    }
    expect(shop.appearance).toEqual({
      cannonColor: '#60a5fa', shotColor: '#e0f2fe', ballSkin: 'classic', effect: 'standard', theme: 'arcade',
    });
  });

  it('charges the listed coin price, persists ownership and equips the purchase', async () => {
    await firstValueFrom(shop.purchase('ruby-shot'));
    expect((await snapshot()).availableCoins).toBe(9900);
    expect((await owned()).has('ruby-shot')).toBe(true);
    expect(shop.appearance.shotColor).toBe('#fb7185');
    const reloaded = new ShopService(wallet, ads as unknown as AdmobService);
    expect(reloaded.appearance.shotColor).toBe('#fb7185');
    expect((await firstValueFrom(reloaded.ownedIds$)).has('ruby-shot')).toBe(true);
    const purchases = (await firstValueFrom(wallet.getTransactions())).filter((tx) => tx.type === 'SHOP_PURCHASE');
    expect(purchases).toHaveLength(1);
    expect(purchases[0].amount).toBe(-100);
  });

  it('does not charge until the purchase observable is subscribed', async () => {
    shop.purchase('ruby-shot');
    expect((await snapshot()).availableCoins).toBe(10_000);
    expect((await owned()).has('ruby-shot')).toBe(false);
  });

  it('prevents equipping a locked item or charging for an owned item', async () => {
    expect(() => shop.equip('ruby-shot')).toThrow('Unlock this item');
    await firstValueFrom(shop.purchase('ruby-shot'));
    await expect(firstValueFrom(shop.purchase('ruby-shot'))).rejects.toThrow('already own');
    expect((await snapshot()).availableCoins).toBe(9900);
  });

  it('does not unlock or equip when coins are insufficient', async () => {
    await firstValueFrom(wallet.resetAll());
    await expect(firstValueFrom(shop.purchase('ruby-shot'))).rejects.toThrow('Insufficient');
    expect((await owned()).has('ruby-shot')).toBe(false);
    expect(shop.appearance.shotColor).toBe('#e0f2fe');
    expect(await firstValueFrom(shop.busy$)).toBe(false);
  });

  it('accepts a single coin purchase when the buy action is triggered twice', async () => {
    const attempts = await Promise.allSettled([
      firstValueFrom(shop.purchase('ruby-shot')), firstValueFrom(shop.purchase('ruby-shot')),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect((await snapshot()).availableCoins).toBe(9900);
  });

  it('waits for the rewarded ad before unlocking and never changes the wallet', async () => {
    let finishAd!: (granted: boolean) => void;
    ads.showRewarded.mockReturnValue(new Promise<boolean>((resolve) => { finishAd = resolve; }));
    const pending = shop.unlockWithAd('emerald-shot');
    expect((await owned()).has('emerald-shot')).toBe(false);
    expect(await firstValueFrom(shop.busy$)).toBe(true);
    await expect(firstValueFrom(shop.purchase('emerald-shot'))).rejects.toThrow('Please wait');
    await expect(shop.unlockWithAd('ruby-shot')).rejects.toThrow('Please wait');
    finishAd(true);
    expect(await pending).toBe(true);
    expect((await owned()).has('emerald-shot')).toBe(true);
    expect(shop.appearance.shotColor).toBe('#4ade80');
    expect((await snapshot()).availableCoins).toBe(10_000);
    expect(ads.showRewarded).toHaveBeenCalledTimes(1);
  });

  it('does not unlock after an early close or failed ad and allows a retry', async () => {
    ads.showRewarded.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('No fill'));
    expect(await shop.unlockWithAd('violet-shot')).toBe(false);
    await expect(shop.unlockWithAd('violet-shot')).rejects.toThrow('No fill');
    expect((await owned()).has('violet-shot')).toBe(false);
    expect(shop.appearance.shotColor).toBe('#e0f2fe');
    expect(await firstValueFrom(shop.busy$)).toBe(false);
    expect(await shop.unlockWithAd('violet-shot')).toBe(true);
    expect(shop.appearance.shotColor).toBe('#c084fc');
  });

  it('applies all purchased categories and lets the player restore included items', async () => {
    for (const id of ['fire-cannon', 'neon-balls', 'bullet-trail-pack', 'crimson-theme', 'sunshine-shot']) {
      await firstValueFrom(shop.purchase(id));
    }
    expect(shop.appearance).toEqual({
      cannonColor: '#f97316', shotColor: '#fbbf24', ballSkin: 'neon', effect: 'trail', theme: 'crimson',
    });
    shop.equip('default-shot');
    expect(shop.appearance.shotColor).toBe('#f97316');
    for (const id of Object.values(DEFAULT_EQUIPPED)) shop.equip(id);
    expect(shop.appearance).toEqual({
      cannonColor: '#60a5fa', shotColor: '#e0f2fe', ballSkin: 'classic', effect: 'standard', theme: 'arcade',
    });
  });

  it('reports owned and equipped separately so already purchased items can be selected again', async () => {
    await firstValueFrom(shop.purchase('ruby-shot'));
    await firstValueFrom(shop.purchase('emerald-shot'));
    const view = await firstValueFrom(shop.viewModel$('shot'));
    expect(view.find((item) => item.id === 'ruby-shot')).toMatchObject({ owned: true, equipped: false });
    expect(view.find((item) => item.id === 'emerald-shot')).toMatchObject({ owned: true, equipped: true });
  });

  it('migrates existing cannon ownership and selection', () => {
    localStorage.setItem('bb.shop.owned.v1', JSON.stringify(['fire-cannon']));
    localStorage.setItem('bb.shop.equipped-cannon.v1', 'fire-cannon');
    const migrated = new ShopService(wallet, ads as unknown as AdmobService);
    expect(migrated.appearance.cannonColor).toBe('#f97316');
    expect(migrated.appearance.shotColor).toBe('#f97316');
  });

  it('falls back safely from malformed ownership or locked stored equipment', () => {
    localStorage.setItem('bb.shop.owned.v1', '{"unexpected":true}');
    localStorage.setItem('bb.shop.equipped.v2', JSON.stringify({ shot: 'ruby-shot', cannon: 'ruby-shot', ball: 'missing' }));
    const reloaded = new ShopService(wallet, ads as unknown as AdmobService);
    expect(reloaded.appearance.shotColor).toBe('#e0f2fe');
    expect(reloaded.appearance.ballSkin).toBe('classic');
    localStorage.setItem('bb.shop.equipped.v2', 'invalid JSON');
    expect(new ShopService(wallet, ads as unknown as AdmobService).appearance.cannonColor).toBe('#60a5fa');
  });

  it('keeps a storage-error retry idempotent after the wallet was already debited', async () => {
    const original = Storage.prototype.setItem;
    let failOnce = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'bb.shop.owned.v1' && failOnce) {
        failOnce = false;
        throw new Error('Storage unavailable');
      }
      original.call(this, key, value);
    });
    await expect(firstValueFrom(shop.purchase('ruby-shot'))).rejects.toThrow('Storage unavailable');
    await firstValueFrom(shop.purchase('ruby-shot'));
    expect((await snapshot()).availableCoins).toBe(9900);
    expect((await owned()).has('ruby-shot')).toBe(true);
  });

  it('rejects unknown item ids without showing ads or debiting coins', async () => {
    await expect(shop.unlockWithAd('missing')).rejects.toThrow('Unknown');
    await expect(firstValueFrom(shop.purchase('missing'))).rejects.toThrow('Unknown');
    expect(ads.showRewarded).not.toHaveBeenCalled();
    expect((await snapshot()).availableCoins).toBe(10_000);
    expect(new Set(SHOP_ITEMS.map((item) => item.id)).size).toBe(SHOP_ITEMS.length);
  });
});
