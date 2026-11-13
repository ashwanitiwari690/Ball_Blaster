import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ViewDidEnter, ViewWillLeave } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { BallBlasterEngine } from '../../core/game-engine/ball-blaster-engine';
import { GameRewardService } from '../../core/services/game-reward.service';
import { ShopService } from '../../core/services/shop.service';
import { PlayerProfileService } from '../../core/services/player-profile.service';
import { LastGameResultService } from '../../core/services/last-game-result.service';
import { AudioService } from '../../core/services/audio.service';
import { ECONOMY_CONFIG } from '../../core/config/economy.config';
import { EngineResult } from '../../core/game-engine/engine.types';

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
  standalone: false,
})
export class GamePage implements AfterViewInit, ViewDidEnter, ViewWillLeave, OnDestroy {
  @ViewChild('gameCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private engine?: BallBlasterEngine;
  private sessionId = '';
  private levelUpTimer?: ReturnType<typeof setTimeout>;
  private viewInitialized = false;
  private shopSub?: Subscription;
  private viewActive = false;

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
  readonly level = signal(1);
  readonly multiplierActive = signal(false);
  readonly multiplierSeconds = signal(0);
  readonly levelBonus = ECONOMY_CONFIG.levelCompleteCoins;
  readonly showControlsHint = signal(true);
  readonly showLevelUp = signal(false);
  readonly paused = signal(false);


  finishing = false;

  constructor(
    private readonly router: Router,
    private readonly gameRewardService: GameRewardService,
    private readonly shopService: ShopService,
    private readonly profileService: PlayerProfileService,
    private readonly lastGameResultService: LastGameResultService,
    private readonly audioService: AudioService
  ) {}

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.shopSub = this.shopService.appearance$.subscribe((appearance) => {
      this.engine?.setAppearance(appearance);
    });
  }

  /**
   * In Ionic, page components are cached by ion-router-outlet. When a player
   * finishes a game and taps "Play Again" on /game-over, ngAfterViewInit does
   * NOT run again. ionViewDidEnter is called every time this page becomes active,
   * guaranteeing the game loop restarts fresh with no stuck state.
   */
  ionViewDidEnter(): void {
    if (this.viewInitialized) {
      this.startNewGame();
    }
  }

  ionViewWillLeave(): void {
    this.cleanupGame();
  }

  private startNewGame(): void {
    this.cleanupGame();
    this.viewActive = true;

    this.finishing = false;
    this.score.set(0);
    this.coinsThisRun.set(0);
    this.lives.set(ECONOMY_CONFIG.startingLives);
    this.multiplierActive.set(false);
    this.multiplierSeconds.set(0);
    this.showControlsHint.set(true);
    this.showLevelUp.set(false);
    this.paused.set(false);

    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    // Every fresh run starts at Level 1 with fast, responsive action!
    const startLevel = 1;
    this.level.set(startLevel);

    this.engine = new BallBlasterEngine(
      canvas,
      {
        onScoreChange: (score) => this.score.set(score),
        onCoinsChange: (coins) => this.coinsThisRun.set(coins),
        onLivesChange: (lives) => this.lives.set(lives),
        onMultiplierChange: (active, remaining) => {
          this.multiplierActive.set(active);
          this.multiplierSeconds.set(Math.ceil(remaining / 1000));
        },
        onGameOver: (result) => this.handleGameOver(result),
        onLevelChange: (level) => this.handleLevelUp(level),
        onShoot: () => this.audioService.shoot(),
        onBulletImpact: () => this.audioService.ballHit(),
        onBallDestroyed: (tier) => this.audioService.ballDestroyed(tier),
        onMultiplierActivated: () => this.audioService.multiplierActivated(),
        onLifeLost: () => this.audioService.lifeLost(),
      },
      startLevel
    );

    this.engine.setAppearance(this.shopService.appearance);

    const session = this.gameRewardService.startSession();
    this.sessionId = session.sessionId;
    this.audioService.startMusic();
    this.audioService.resumeMusic();
    this.engine.start();
  }

  private cleanupGame(): void {
    this.viewActive = false;
    this.audioService.pauseMusic();
    if (this.engine) {
      this.engine.destroy();
      this.engine = undefined;
    }
    if (this.levelUpTimer) {
      clearTimeout(this.levelUpTimer);
      this.levelUpTimer = undefined;
    }
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) this.pauseForBackground();
  }

  @HostListener('window:blur')
  pauseForBackground(): void {
    if (!this.viewActive || this.finishing) return;
    this.engine?.pause();
    this.audioService.pauseMusic();
    this.paused.set(true);
  }

  dismissControlsHint(): void {
    this.showControlsHint.set(false);
  }

  togglePause(): void {
    if (!this.viewActive || this.finishing) return;
    const next = !this.paused();
    this.paused.set(next);
    if (this.engine) {
      if (next) {
        this.engine.pause();
        this.audioService.pauseMusic();
      } else {
        this.engine.resume();
        this.audioService.resumeMusic();
      }
    }
  }

  quitGame(): void {
    this.paused.set(false);
    if (this.engine) {
      this.engine.quit();
    } else {
      this.router.navigateByUrl('/home', { replaceUrl: true });
    }
  }

  private handleLevelUp(level: number): void {
    this.level.set(level);
    this.audioService.levelComplete();
    this.showLevelUp.set(true);
    if (this.levelUpTimer) clearTimeout(this.levelUpTimer);
    this.levelUpTimer = setTimeout(() => this.showLevelUp.set(false), 1400);
  }

  private handleGameOver(result: EngineResult): void {
    if (this.finishing) return;
    this.finishing = true;
    this.audioService.gameOver();

    this.profileService.recordGameFinished(result.score, result.levelReached);

    this.gameRewardService
      .completeSession({
        sessionId: this.sessionId,
        score: result.score,
        duration: result.duration,
        ballsDestroyed: result.ballsDestroyed,
        destroyedByTier: result.destroyedByTier,
        multiplierHits: result.multiplierHits,
        coinsEarnedLocal: result.coinsEarnedLocal,
        levelReached: result.levelReached,
      })
      .subscribe({
        next: (outcome) => {
          this.lastGameResultService.set({
            sessionId: this.sessionId,
            score: result.score,
            ballsDestroyed: result.ballsDestroyed,
            levelReached: result.levelReached,
            outcome,
          });
          this.router.navigateByUrl('/game-over', { replaceUrl: true });
        },
        error: (err) => {
          console.error('Error completing session', err);
          this.router.navigateByUrl('/game-over', { replaceUrl: true });
        },
      });
  }

  ngOnDestroy(): void {
    this.cleanupGame();
    this.shopSub?.unsubscribe();
  }
}
