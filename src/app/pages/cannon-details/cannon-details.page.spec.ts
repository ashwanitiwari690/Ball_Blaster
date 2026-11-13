import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CannonDetailsPage } from './cannon-details.page';
import { CannonDetailsPageModule } from './cannon-details.module';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { BehaviorSubject } from 'rxjs';
import { WalletRepositoryPort } from '../../core/ports/wallet-repository.port';
import { LocalWalletRepository } from '../../core/adapters/local-wallet-repository';
import { AdmobService } from '../../core/services/admob.service';
import { AudioService } from '../../core/services/audio.service';
import { addIcons } from 'ionicons';
import { ellipse, planet, chevronBack, playCircle, checkmark } from 'ionicons/icons';

describe('CannonDetailsPage', () => {
  let component: CannonDetailsPage;
  let fixture: ComponentFixture<CannonDetailsPage>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeAll(() => addIcons({ ellipse, planet, chevronBack, playCircle, checkmark }));

  beforeEach(() => {
    localStorage.clear();
    params = new BehaviorSubject(convertToParamMap({ id: 'ruby-shot' }));
    TestBed.configureTestingModule({
      imports: [CannonDetailsPageModule],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        { provide: WalletRepositoryPort, useClass: LocalWalletRepository },
        { provide: AdmobService, useValue: { showRewarded: vi.fn(async () => true) } },
        { provide: AudioService, useValue: { purchaseSuccess: vi.fn(), purchaseFailed: vi.fn(), claimReward: vi.fn(), buttonTap: vi.fn() } },
        { provide: ToastController, useValue: { create: vi.fn(async () => ({ present: vi.fn(async () => undefined) })) } },
      ],
    });
    fixture = TestBed.createComponent(CannonDetailsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('renders details and both unlock options for a non-cannon item', () => {
    expect(fixture.nativeElement.querySelector('.cd-name').textContent).toBe('Ruby Red');
    expect(fixture.nativeElement.textContent).toContain('100 coins');
    expect(fixture.nativeElement.textContent).toContain('Watch Ad to Unlock');
  });

  it('updates the item when the cached details page receives another route id', () => {
    params.next(convertToParamMap({ id: 'galaxy-balls' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cd-name').textContent).toBe('Galaxy Balls');
  });

  it('shows Equipped after earning the item through its ad button', async () => {
    await component.watchAd('ruby-shot');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Equipped');
    expect(fixture.nativeElement.textContent).not.toContain('Watch Ad to Unlock');
  });

  it('returns an unknown item route to the shop', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    params.next(convertToParamMap({ id: 'missing' }));
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith('/shop', { replaceUrl: true });
  });
});
