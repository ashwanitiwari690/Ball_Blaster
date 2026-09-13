import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BallBlasterEngine } from '../../core/game-engine/ball-blaster-engine';
import { GameRewardService } from '../../core/services/game-reward.service';
import { ShopService } from '../../core/services/shop.service';
import { PlayerProfileService } from '../../core/services/player-profile.service';
import { LastGameResultService } from '../../core/services/last-game-result.service';
import { AudioService } from '../../core/services/audio.service';
import { AdmobService } from '../../core/services/admob.service';
import { ECONOMY_CONFIG } from '../../core/config/economy.config';
import { EngineResult } from '../../core/game-engine/engine.types';

const CONTINUE_COUNTDOWN_SECONDS = 6;

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
  standalone: false,
})
export class GamePage implements AfterViewInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private engine?: BallBlasterEngine;
  private sessionId = '';
  private levelUpTimer?: ReturnType<typeof setTimeout>;
  private continueCountdownTimer?: ReturnType<typeof setTimeout>;

  /**
   * This app runs zoneless (no zone.js — see angular.json's empty
   * `polyfills`), so change detection only runs automatically for
   * Angular-bound events and Observables/AsyncPipe. The game engine drives
   * these values from its own requestAnimationFrame loop, which Angular
   * has no visibility into at all, so plain class fields here silently
   * never reach the DOM. Signals fix that: writing to a signal schedules
   * a render regardless of where the write came from.
   */
  readonly score = signal(0);
  readonly coinsThisRun = signal(0);
  readonly lives = signal<number>(ECONOMY_CONFIG.startingLives);
  readonly level = signal(this.profileService.current.highestLevel);
  readonly multiplierActive = signal(false);
  readonly showLevelUp = signal(false);
  readonly paused = signal(false);

  readonly showContinuePrompt = signal(false);
  readonly continueAdLoading = signal(false);
  readonly continueSecondsLeft = signal(CONTINUE_COUNTDOWN_SECONDS);

  finishing = false;

  constructor(
    private readonly router: Router,
    private readonly gameRewardService: GameRewardService,
    private readonly shopService: ShopService,
    private readonly profileService: PlayerProfileService,
    private readonly lastGameResultService: LastGameResultService,
    private readonly audioService: AudioService,
    private readonly admobService: AdmobService
  ) {}

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    // Resume at the highest level ever reached (persisted in PlayerProfileService),
    // not always level 1 — see "Reset Level" in Settings to start over from scratch.
    const startLevel = this.profileService.current.highestLevel;
    this.level.set(startLevel);
    this.engine = new BallBlasterEngine(
      canvas,
      {
        onScoreChange: (score) => this.score.set(score),
        onCoinsChange: (coins) => this.coinsThisRun.set(coins),
        onLivesChange: (lives) => this.lives.set(lives),
        onMultiplierChange: (active) => this.multiplierActive.set(active),
        onGameOver: (result) => this.handleGameOver(result),
        onLevelChange: (level) => this.handleLevelUp(level),
        onContinueOffer: () => this.handleContinueOffer(),
        onShoot: () => this.audioService.shoot(),
        onBulletImpact: () => this.audioService.ballHit(),
        onBallDestroyed: (tier) => this.audioService.ballDestroyed(tier),
        onMultiplierActivated: () => this.audioService.multiplierActivated(),
        onLifeLost: () => this.audioService.lifeLost(),
      },
      startLevel
    );

    this.shopService.equippedCannonId$.subscribe((id) => {
      const item = this.shopService.getItem(id);
      if (item) this.engine?.setCannonAccent(item.accent);
    });

    const session = this.gameRewardService.startSession();
    this.sessionId = session.sessionId;
    this.engine.start();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.engine?.resize();
  }

  togglePause(): void {
    if (!this.engine) return;
    const next = !this.paused();
    this.paused.set(next);
    if (next) this.engine.pause();
    else this.engine.resume();
  }

  quitGame(): void {
    this.engine?.quit();
  }

  private handleLevelUp(level: number): void {
    this.level.set(level);
    this.audioService.levelComplete();
    this.showLevelUp.set(true);
    if (this.levelUpTimer) clearTimeout(this.levelUpTimer);
    this.levelUpTimer = setTimeout(() => this.showLevelUp.set(false), 1400);
  }

  // ---------------------------------------------------------------------
  // "Watch ad to continue" — offered once, the moment lives would hit 0.
  // ---------------------------------------------------------------------

  private handleContinueOffer(): void {
    this.showContinuePrompt.set(true);
    this.continueSecondsLeft.set(CONTINUE_COUNTDOWN_SECONDS);
    this.tickContinueCountdown();
  }

  private tickContinueCountdown(): void {
    if (this.continueCountdownTimer) clearTimeout(this.continueCountdownTimer);
    this.continueCountdownTimer = setTimeout(() => {
      const remaining = this.continueSecondsLeft() - 1;
      this.continueSecondsLeft.set(remaining);
      if (remaining <= 0) this.declineContinue();
      else this.tickContinueCountdown();
    }, 1000);
  }

  /** Never credits or resumes anything until AdmobService confirms the ad was actually watched. */
  async watchAdToContinue(): Promise<void> {
    if (this.continueAdLoading()) return;
    this.continueAdLoading.set(true);
    if (this.continueCountdownTimer) clearTimeout(this.continueCountdownTimer);

    const granted = await this.admobService.showRewarded();
    this.continueAdLoading.set(false);

    if (granted) {
      this.showContinuePrompt.set(false);
      this.audioService.claimReward();
      this.engine?.grantContinue();
    } else {
      // Ad unavailable/closed early — let the player retry or bail out, not
      // silently fail them out of the run.
      this.tickContinueCountdown();
    }
  }

  declineContinue(): void {
    if (this.continueCountdownTimer) clearTimeout(this.continueCountdownTimer);
    this.showContinuePrompt.set(false);
    this.engine?.declineContinue();
  }

  private handleGameOver(result: EngineResult): void {
    if (this.finishing) return;
    this.finishing = true;
    this.audioService.gameOver();

    this.profileService.recordGameFinished(result.score);
    this.profileService.recordLevelReached(result.levelReached);

    this.gameRewardService
      .completeSession({
        sessionId: this.sessionId,
        score: result.score,
        duration: result.duration,
        ballsDestroyed: result.ballsDestroyed,
        destroyedByTier: result.destroyedByTier,
        multiplierHits: result.multiplierHits,
        levelReached: result.levelReached,
      })
      .subscribe((outcome) => {
        this.lastGameResultService.set({
          sessionId: this.sessionId,
          score: result.score,
          ballsDestroyed: result.ballsDestroyed,
          levelReached: result.levelReached,
          outcome,
        });
        this.router.navigateByUrl('/game-over');
      });
  }

  ngOnDestroy(): void {
    this.engine?.destroy();
    if (this.levelUpTimer) clearTimeout(this.levelUpTimer);
    if (this.continueCountdownTimer) clearTimeout(this.continueCountdownTimer);
  }
}
