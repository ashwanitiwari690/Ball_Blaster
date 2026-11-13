import { configurePageTestBed } from '../../../testing/page-test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameOverPage } from './game-over.page';
import { LastGameResultService } from '../../core/services/last-game-result.service';
import { AudioService } from '../../core/services/audio.service';
import { AdmobService } from '../../core/services/admob.service';
import { ToastController } from '@ionic/angular';

describe('GameOverPage', () => {
  let component: GameOverPage;
  let fixture: ComponentFixture<GameOverPage>;

  beforeEach(() => {
    configurePageTestBed();
    TestBed.configureTestingModule({ providers: [
      { provide: ToastController, useValue: { create: vi.fn(async () => ({ present: vi.fn(async () => undefined) })) } },
    ] });
    fixture = TestBed.createComponent(GameOverPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  function enterRun(sessionId: string): void {
    vi.spyOn(TestBed.inject(AudioService), 'coinEarned').mockImplementation(() => undefined);
    TestBed.inject(LastGameResultService).set({ sessionId, score: 100, ballsDestroyed: 3, levelReached: 1,
      outcome: { coinsEarned: 4, cappedByDailyLimit: false, wallet: {
        availableCoins: 4, lifetimeEarned: 4, todayEarned: 4, todayGameplayCoins: 4, todayAdRewards: 0,
      } },
    });
    component.ionViewWillEnter();
  }

  it('shows a completed reward immediately and refreshes the result on cached page entry', () => {
    enterRun('first');
    expect(component.summary()?.sessionId).toBe('first');
    enterRun('second');
    expect(component.summary()?.sessionId).toBe('second');
  });

  it('records a completed session and never offers cash-convertible ad bonuses', () => {
    const record = vi.spyOn(TestBed.inject(AdmobService), 'recordCompletedRound');
    enterRun('completed-session');
    fixture.detectChanges();
    expect(record).toHaveBeenCalledWith('completed-session');
    expect(fixture.nativeElement.textContent).not.toContain('Watch Ad');
  });
});
