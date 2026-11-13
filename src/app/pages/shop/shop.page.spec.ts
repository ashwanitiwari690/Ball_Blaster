import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShopPage } from './shop.page';
import { ShopPageModule } from './shop.module';
import { provideRouter } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { WalletRepositoryPort } from '../../core/ports/wallet-repository.port';
import { LocalWalletRepository } from '../../core/adapters/local-wallet-repository';
import { AdmobService } from '../../core/services/admob.service';
import { AudioService } from '../../core/services/audio.service';
import { addIcons } from 'ionicons';
import { rocket, flame, flash, snow, diamond, trophy, ellipse, playCircle, home, gameController, storefront, person } from 'ionicons/icons';

describe('ShopPage', () => {
  let component: ShopPage;
  let fixture: ComponentFixture<ShopPage>;

  beforeAll(() => addIcons({ rocket, flame, flash, snow, diamond, trophy, ellipse, playCircle, home, gameController, storefront, person }));

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [ShopPageModule],
      providers: [
        provideRouter([]),
        { provide: WalletRepositoryPort, useClass: LocalWalletRepository },
        { provide: AdmobService, useValue: { showRewarded: vi.fn(async () => true) } },
        { provide: AudioService, useValue: { purchaseSuccess: vi.fn(), purchaseFailed: vi.fn(), claimReward: vi.fn(), buttonTap: vi.fn() } },
        { provide: ToastController, useValue: { create: vi.fn(async () => ({ present: vi.fn(async () => undefined) })) } },
      ],
    });
    await firstValueFrom(TestBed.inject(WalletRepositoryPort).credit({ amount: 1000, type: 'BONUS', source: 'test', referenceId: 'shop-test' }));
    fixture = TestBed.createComponent(ShopPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('renders both purchase options for cannon ball colors', async () => {
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.shop-tab')) as HTMLButtonElement[];
    tabs.find((tab) => tab.textContent?.trim() === 'Shot Colors')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('[data-item-id="ruby-shot"]') as HTMLElement;
    expect(card.textContent).toContain('Ruby Red');
    expect(card.textContent).toContain('100 coins');
    expect(card.textContent).toContain('Watch Ad to Unlock');
  });

  it('updates a purchased color to Equipped and refreshes the displayed wallet', async () => {
    component.setCategory('shot');
    fixture.detectChanges();
    await component.buy('ruby-shot');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-item-id="ruby-shot"]').textContent).toContain('Equipped');
    expect(fixture.nativeElement.querySelector('.shop-coin-pill').textContent).toContain('900');
  });

  it('unlocks a color through the ad action without spending coins', async () => {
    component.setCategory('shot');
    await component.watchAd('emerald-shot');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-item-id="emerald-shot"]').textContent).toContain('Equipped');
    expect((await firstValueFrom(TestBed.inject(WalletRepositoryPort).getWallet())).availableCoins).toBe(1000);
  });
});
