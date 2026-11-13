import { ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { GamePage } from './game.page';
import { BallBlasterEngine } from '../../core/game-engine/ball-blaster-engine';
import { EngineCallbacks } from '../../core/game-engine/engine.types';
import { GameRewardService } from '../../core/services/game-reward.service';
import { ShopService } from '../../core/services/shop.service';
import { PlayerProfileService } from '../../core/services/player-profile.service';
import { LastGameResultService } from '../../core/services/last-game-result.service';
import { AudioService } from '../../core/services/audio.service';
import { GameAppearance } from '../../core/models/shop.models';

describe('GamePage lifecycle', () => {
  let page: GamePage;
  let audio: { startMusic: ReturnType<typeof vi.fn>; pauseMusic: ReturnType<typeof vi.fn>; resumeMusic: ReturnType<typeof vi.fn> };

  const engine = () => page['engine'] as unknown as Pick<BallBlasterEngine, keyof BallBlasterEngine> & { callbacks: EngineCallbacks };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(BallBlasterEngine.prototype, 'start').mockImplementation(() => undefined);
    for (const method of ['pause', 'resume', 'destroy', 'grantContinue', 'declineContinue'] as const) {
      vi.spyOn(BallBlasterEngine.prototype, method);
    }
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    audio = { startMusic: vi.fn(), pauseMusic: vi.fn(), resumeMusic: vi.fn() };
    const appearance: GameAppearance = { cannonColor: '#60a5fa', shotColor: '#e0f2fe', ballSkin: 'classic', effect: 'standard', theme: 'arcade' };
    page = new GamePage(
      { navigateByUrl: vi.fn() } as unknown as Router,
      { startSession: vi.fn(() => ({ sessionId: 'run-1' })) } as unknown as GameRewardService,
      { appearance$: of(appearance), appearance } as unknown as ShopService,
      { recordGameFinished: vi.fn() } as unknown as PlayerProfileService,
      {} as LastGameResultService,
      audio as unknown as AudioService,

    );
    page.canvasRef = new ElementRef(document.createElement('canvas'));
    page.ngAfterViewInit();
    page.ionViewDidEnter();
  });

  afterEach(() => {
    page.ngOnDestroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('starts a fresh engine on every Ionic page entry and destroys the old one', () => {
    const oldEngine = engine();
    oldEngine.callbacks.onScoreChange(100);
    page.ionViewWillLeave();
    expect(oldEngine.destroy).toHaveBeenCalledTimes(1);
    page.ionViewDidEnter();
    expect(engine()).not.toBe(oldEngine);
    expect(engine().start).toHaveBeenCalledTimes(2);
    expect(page.score()).toBe(0);
    expect(audio.resumeMusic).toHaveBeenCalled();
  });

  it('pauses on app backgrounding and waits for explicit resume', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    page.onVisibilityChange();
    expect(page.paused()).toBe(true);
    expect(engine().pause).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    page.onVisibilityChange();
    expect(engine().resume).not.toHaveBeenCalled();
    page.togglePause();
    expect(engine().resume).toHaveBeenCalledTimes(1);
  });

  it('updates the boost countdown through its engine callback', () => {
    engine().callbacks.onMultiplierChange(true, 9200);
    expect(page.multiplierActive()).toBe(true);
    expect(page.multiplierSeconds()).toBe(10);
  });

  it('never registers an ad continuation for a redeemable coin run', () => {
    expect(engine().callbacks.onContinueOffer).toBeUndefined();
  });
});
