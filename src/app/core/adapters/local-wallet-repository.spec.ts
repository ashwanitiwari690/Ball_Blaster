import { firstValueFrom } from 'rxjs';
import { LocalWalletRepository } from './local-wallet-repository';

describe('Wallet snapshot caching and references', () => {
  let wallet: LocalWalletRepository;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 12));
    wallet = new LocalWalletRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('reuses one snapshot across page subscribers without rescanning the ledger', async () => {
    wallet.credit({ amount: 10, type: 'GAME_REWARD', source: 'test', referenceId: 'game-1' });
    const transaction = wallet['state$'].value.transactions[0];
    const createdAt = transaction.createdAt;
    const readDate = vi.fn(() => createdAt);
    Object.defineProperty(transaction, 'createdAt', { get: readDate });
    const first = await firstValueFrom(wallet.getWallet());
    const reads = readDate.mock.calls.length;
    expect(await firstValueFrom(wallet.getWallet())).toBe(first);
    expect(await firstValueFrom(wallet.getWallet())).toBe(first);
    expect(readDate).toHaveBeenCalledTimes(reads);
  });

  it('refreshes balances and daily totals after credits and debits', async () => {
    wallet.credit({ amount: 20, type: 'GAME_REWARD', source: 'test', referenceId: 'game-1' });
    wallet.credit({ amount: 10, type: 'AD_REWARD', source: 'test', referenceId: 'ad-1' });
    wallet.debit({ amount: 5, type: 'SHOP_PURCHASE', source: 'test', referenceId: 'buy-1' });
    expect(await firstValueFrom(wallet.getWallet())).toEqual({
      availableCoins: 25, lifetimeEarned: 30, todayEarned: 30, todayGameplayCoins: 20, todayAdRewards: 1,
    });
  });

  it('invalidates daily totals when the local calendar day changes', async () => {
    wallet.credit({ amount: 20, type: 'GAME_REWARD', source: 'test', referenceId: 'game-1' });
    expect((await firstValueFrom(wallet.getWallet())).todayEarned).toBe(20);
    vi.setSystemTime(new Date(2026, 10, 14, 12));
    expect(await firstValueFrom(wallet.getWallet())).toMatchObject({ availableCoins: 20, todayEarned: 0, todayGameplayCoins: 0 });
  });

  it('preserves idempotency after reload and clears cached references on reset', async () => {
    wallet.credit({ amount: 20, type: 'GAME_REWARD', source: 'test', referenceId: 'game-1' });
    wallet = new LocalWalletRepository();
    wallet.credit({ amount: 20, type: 'GAME_REWARD', source: 'test', referenceId: 'game-1' });
    expect((await firstValueFrom(wallet.getWallet())).availableCoins).toBe(20);
    expect(await firstValueFrom(wallet.hasReference('game-1'))).toBe(true);
    await firstValueFrom(wallet.resetAll());
    expect(await firstValueFrom(wallet.hasReference('game-1'))).toBe(false);
    wallet.credit({ amount: 5, type: 'GAME_REWARD', source: 'test', referenceId: 'game-1' });
    expect((await firstValueFrom(wallet.getWallet())).availableCoins).toBe(5);
  });
});
