import { BALL_TIERS, BallTier, BallTierConfig, ECONOMY_CONFIG, levelTarget } from '../config/economy.config';
import { EngineCallbacks, EngineResult } from './engine.types';

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  tier: BallTier | 'multiplier';
  active: boolean;
  hitFlash: number;
}

interface Bullet {
  x: number;
  y: number;
  vy: number;
  radius: number;
  active: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  radius: number;
  active: boolean;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  active: boolean;
}

const TIER_KEYS = Object.keys(BALL_TIERS) as BallTier[];

/** Higher levels skew the spawn mix toward tougher tiers, bounded so it never gets unfair. */
function pickWeightedTier(level: number): BallTierConfig {
  const bonus = Math.min(20, (level - 1) * 1.5);
  const weights: Record<BallTier, number> = {
    normal: Math.max(10, BALL_TIERS.normal.weight - bonus),
    fast: BALL_TIERS.fast.weight,
    heavy: BALL_TIERS.heavy.weight + bonus * 0.5,
    gold: BALL_TIERS.gold.weight + bonus * 0.2,
    boss: BALL_TIERS.boss.weight + bonus * 0.3,
  };
  const total = TIER_KEYS.reduce((s, k) => s + weights[k], 0);
  let roll = Math.random() * total;
  for (const key of TIER_KEYS) {
    roll -= weights[key];
    if (roll <= 0) return BALL_TIERS[key];
  }
  return BALL_TIERS.normal;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Pure Canvas/TypeScript game engine — deliberately has zero Angular
 * dependencies (spec section 46). It runs its own requestAnimationFrame
 * loop and never calls the network; it only reports a final EngineResult
 * through onGameOver, which the GamePage hands to GameRewardService for
 * server-style validation and reward crediting.
 */
export class BallBlasterEngine {
  private raf = 0;
  private lastTs = 0;
  private running = false;
  private paused = false;
  private elapsedMs = 0;
  private readonly resizeObserver: ResizeObserver;

  private width = 0;
  private height = 0;
  private dpr = 1;

  private cannonX = 0;
  private cannonTargetX = 0;
  private cannonPlaced = false;
  private userHasAimed = false;
  private readonly cannonY: () => number;
  private cannonAccent = '#60a5fa';

  private fireTimer = 0;
  private fireIntervalMs = 220;

  private spawnTimer = 0;
  private spawnIntervalMs = 1150;
  private multiplierSpawnTimer = 6000;

  private balls: Ball[] = [];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private floatingTexts: FloatingText[] = [];
  private stars: { x: number; y: number; r: number; twinkle: number }[] = [];

  private score = 0;
  private lives: number = ECONOMY_CONFIG.startingLives;
  private level: number;
  private ballsDestroyedInLevel = 0;
  private ballsDestroyed = 0;
  private destroyedByTier: Record<BallTier, number> = { normal: 0, fast: 0, heavy: 0, gold: 0, boss: 0 };
  private multiplierHits = 0;
  private coinsEarnedLocal = 0;
  private multiplierActive = false;
  private multiplierRemainingMs = 0;

  private gameOverFired = false;
  private continueOffered = false;
  private continueUsed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: EngineCallbacks,
    startLevel = 1
  ) {
    this.level = Math.max(1, Math.floor(startLevel) || 1);
    this.cannonY = () => this.height - 70;
    this.resize();
    this.seedStars();
    this.bindPointerEvents();

    // The canvas can report a stale/zero size at construction time if the
    // Ionic page hasn't finished its own layout pass yet (this previously
    // caused balls to be judged "past the floor" on the very first frame,
    // ending the run instantly). Re-measure whenever the element's actual
    // size changes, not just on window resize.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
  }

  setCannonAccent(color: string): void {
    this.cannonAccent = color;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    const ctx = this.canvas.getContext('2d');
    ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // The canvas can report a zero/stale size at construction time, before
    // the Ionic page has finished its own layout pass. Wait for a real,
    // positive measurement before placing the cannon — otherwise it (and
    // every bullet it fires) gets stuck at x=0 while balls correctly spawn
    // across the later-corrected full width, so nothing ever collides.
    // Once the player has aimed manually, stop auto-centering so a later
    // resize (e.g. orientation change) doesn't yank the cannon away.
    if (this.width > 0 && (!this.cannonPlaced || !this.userHasAimed)) {
      this.cannonX = this.width / 2;
      this.cannonTargetX = this.width / 2;
      this.cannonPlaced = true;
    }
  }

  private seedStars(): void {
    this.stars = Array.from({ length: 60 }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      r: Math.random() * 1.4 + 0.3,
      twinkle: Math.random() * Math.PI * 2,
    }));
  }

  private bindPointerEvents(): void {
    const setFromEvent = (clientX: number) => {
      const rect = this.canvas.getBoundingClientRect();
      this.cannonTargetX = clientX - rect.left;
      this.userHasAimed = true;
    };
    this.canvas.addEventListener('pointerdown', (e) => setFromEvent(e.clientX));
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons > 0 || e.pointerType === 'touch') setFromEvent(e.clientX);
    });
  }

  start(): void {
    this.running = true;
    this.paused = false;
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTs = performance.now();
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
  }

  /** Ends the run early (player backed out via Pause > Quit) while still reporting whatever was earned so far. */
  quit(): void {
    this.endGame();
  }

  private readonly loop = (ts: number): void => {
    if (!this.running) return;
    const dt = Math.min(48, ts - this.lastTs);
    this.lastTs = ts;

    if (!this.paused) {
      this.update(dt);
      this.render();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.elapsedMs += dt;

    // Cannon glides toward pointer target.
    this.cannonX += (this.cannonTargetX - this.cannonX) * Math.min(1, dt / 90);
    const margin = 36;
    this.cannonX = Math.max(margin, Math.min(this.width - margin, this.cannonX));

    this.updateMultiplier(dt);
    this.updateFiring(dt);
    this.updateSpawning(dt);
    this.updateBullets(dt);
    this.updateBalls(dt);
    this.updateParticles(dt);
    this.updateFloatingTexts(dt);
    this.handleCollisions();
  }

  private updateMultiplier(dt: number): void {
    if (this.multiplierActive) {
      this.multiplierRemainingMs -= dt;
      if (this.multiplierRemainingMs <= 0) {
        this.multiplierActive = false;
        this.multiplierRemainingMs = 0;
        this.callbacks.onMultiplierChange(false, 0);
      } else {
        this.callbacks.onMultiplierChange(true, this.multiplierRemainingMs);
      }
    }
  }

  private updateFiring(dt: number): void {
    this.fireTimer += dt;
    if (this.fireTimer >= this.fireIntervalMs) {
      this.fireTimer = 0;
      this.spawnBullet();
    }
  }

  private updateSpawning(dt: number): void {
    this.spawnTimer += dt;
    // Difficulty ramps with both elapsed time and the level reached — higher
    // levels spawn balls faster, down to an absolute floor that stays fair.
    const timeRamped = this.spawnIntervalMs - this.elapsedMs / 90;
    const levelAdjusted = timeRamped - (this.level - 1) * 15;
    const rampedInterval = Math.max(260, levelAdjusted);
    if (this.spawnTimer >= rampedInterval) {
      this.spawnTimer = 0;
      this.spawnBall();
    }

    this.multiplierSpawnTimer -= dt;
    if (this.multiplierSpawnTimer <= 0) {
      this.multiplierSpawnTimer = randRange(14000, 22000);
      this.spawnMultiplierOrb();
    }
  }

  private spawnBullet(): void {
    this.bullets.push({
      x: this.cannonX,
      y: this.cannonY() - 34,
      vy: -0.62,
      radius: 5,
      active: true,
    });
    this.callbacks.onShoot?.();
  }

  private spawnBall(): void {
    const cfg = pickWeightedTier(this.level);
    const hp = Math.round(randRange(cfg.minHp, cfg.maxHp));
    const radius = cfg.radius * (0.85 + hp / (cfg.maxHp * 2.4));
    this.balls.push({
      x: randRange(radius + 10, this.width - radius - 10),
      y: -radius,
      vx: randRange(-0.02, 0.02),
      vy: cfg.speed / 1000,
      radius,
      hp,
      maxHp: hp,
      tier: cfg.tier,
      active: true,
      hitFlash: 0,
    });
  }

  private spawnMultiplierOrb(): void {
    const radius = 22;
    this.balls.push({
      x: randRange(radius + 10, this.width - radius - 10),
      y: -radius,
      vx: 0,
      vy: 0.05,
      radius,
      hp: 1,
      maxHp: 1,
      tier: 'multiplier',
      active: true,
      hitFlash: 0,
    });
  }

  private updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.y += b.vy * dt;
      if (b.y < -20) b.active = false;
    }
    this.bullets = this.bullets.filter((b) => b.active);
  }

  private updateBalls(dt: number): void {
    // Defensive floor against a transient zero/undersized canvas measurement.
    const floor = Math.max(120, this.cannonY() - 30);
    for (const ball of this.balls) {
      if (!ball.active) continue;
      ball.y += ball.vy * dt;
      ball.x += ball.vx * dt;
      if (ball.x < ball.radius || ball.x > this.width - ball.radius) ball.vx *= -1;
      if (ball.hitFlash > 0) ball.hitFlash -= dt;

      if (ball.y + ball.radius >= floor) {
        ball.active = false;
        if (ball.tier !== 'multiplier') {
          this.lives = Math.max(0, this.lives - 1);
          this.callbacks.onLivesChange(this.lives);
          this.callbacks.onLifeLost?.();
          this.spawnParticles(ball.x, floor, '#ef4444', 10);
          if (this.lives <= 0) this.handlePotentialGameOver();
        }
      }
    }
    this.balls = this.balls.filter((b) => b.active);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.0012 * dt;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
    this.particles = this.particles.filter((p) => p.active);
  }

  private updateFloatingTexts(dt: number): void {
    for (const t of this.floatingTexts) {
      if (!t.active) continue;
      t.y += t.vy * dt;
      t.life -= dt;
      if (t.life <= 0) t.active = false;
    }
    this.floatingTexts = this.floatingTexts.filter((t) => t.active);
  }

  private handleCollisions(): void {
    for (const bullet of this.bullets) {
      if (!bullet.active) continue;
      for (const ball of this.balls) {
        if (!ball.active) continue;
        const dx = bullet.x - ball.x;
        const dy = bullet.y - ball.y;
        const distSq = dx * dx + dy * dy;
        const hitDist = bullet.radius + ball.radius;
        if (distSq <= hitDist * hitDist) {
          bullet.active = false;
          this.onBallHit(ball);
          break;
        }
      }
    }
  }

  private onBallHit(ball: Ball): void {
    ball.hp -= 1;
    ball.hitFlash = 90;
    this.spawnParticles(ball.x, ball.y, this.colorForBall(ball), 3);
    this.callbacks.onBulletImpact?.();

    if (ball.hp > 0) return;

    ball.active = false;

    if (ball.tier === 'multiplier') {
      this.multiplierActive = true;
      this.multiplierRemainingMs = ECONOMY_CONFIG.multiplierDurationMs;
      this.multiplierHits += 1;
      this.callbacks.onMultiplierChange(true, this.multiplierRemainingMs);
      this.callbacks.onMultiplierActivated?.();
      this.spawnParticles(ball.x, ball.y, '#fde047', 22);
      this.spawnFloatingText(ball.x, ball.y, 'x2 BOOST!', '#fde047');
      return;
    }

    const tierCfg = BALL_TIERS[ball.tier];
    const multiplier = this.multiplierActive ? ECONOMY_CONFIG.multiplierValue : 1;
    const coinGain = tierCfg.coinValue * multiplier;
    const scoreGain = tierCfg.maxHp * 8 * multiplier;

    this.score += scoreGain;
    this.coinsEarnedLocal += coinGain;
    this.ballsDestroyed += 1;
    this.destroyedByTier[ball.tier] += 1;

    this.callbacks.onScoreChange(this.score);
    this.callbacks.onCoinsChange(this.coinsEarnedLocal);
    this.callbacks.onBallDestroyed?.(ball.tier);

    this.spawnParticles(ball.x, ball.y, tierCfg.color, 16);
    this.spawnFloatingText(ball.x, ball.y, `+${coinGain}`, '#fbbf24');

    // Heavy/boss balls split into two smaller "normal" balls on destruction.
    if ((ball.tier === 'heavy' || ball.tier === 'boss') && ball.maxHp >= 8) {
      for (const dir of [-1, 1]) {
        const childCfg = BALL_TIERS.normal;
        const hp = Math.round(randRange(childCfg.minHp, childCfg.maxHp));
        this.balls.push({
          x: Math.max(childCfg.radius, Math.min(this.width - childCfg.radius, ball.x + dir * 24)),
          y: ball.y,
          vx: dir * 0.05,
          vy: childCfg.speed / 1000,
          radius: childCfg.radius * 0.8,
          hp,
          maxHp: hp,
          tier: 'normal',
          active: true,
          hitFlash: 0,
        });
      }
    }

    this.advanceLevelProgress();
  }

  private advanceLevelProgress(): void {
    this.ballsDestroyedInLevel += 1;
    if (this.ballsDestroyedInLevel < levelTarget(this.level)) return;

    this.ballsDestroyedInLevel = 0;
    this.level += 1;
    this.coinsEarnedLocal += ECONOMY_CONFIG.levelCompleteCoins;

    this.callbacks.onCoinsChange(this.coinsEarnedLocal);
    this.callbacks.onLevelChange?.(this.level);

    // The DOM-rendered level-up banner (GamePage) carries the "LEVEL N"
    // messaging clearly — a particle burst is enough of a canvas accent
    // here so the two don't visually stack on top of each other.
    this.spawnParticles(this.width / 2, this.height * 0.32, '#38bdf8', 30);
  }

  private colorForBall(ball: Ball): string {
    return ball.tier === 'multiplier' ? '#fde047' : BALL_TIERS[ball.tier].color;
  }

  private spawnParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randRange(0.05, 0.22);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed * 10,
        vy: Math.sin(angle) * speed * 10,
        life: randRange(300, 600),
        maxLife: 600,
        color,
        radius: randRange(1.5, 3.5),
        active: true,
      });
    }
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    this.floatingTexts.push({ x, y, vy: -0.045, text, color, life: 700, maxLife: 700, active: true });
  }

  /**
   * Reaching 0 lives doesn't necessarily end the run — if the page wired up
   * `onContinueOffer` and this run hasn't used its one continue yet, the
   * engine pauses and waits for `grantContinue()`/`declineContinue()`
   * instead of ending immediately.
   */
  private handlePotentialGameOver(): void {
    if (this.gameOverFired || this.continueOffered) return;
    if (!this.continueUsed && this.callbacks.onContinueOffer) {
      this.continueOffered = true;
      this.pause();
      this.callbacks.onContinueOffer();
      return;
    }
    this.endGame();
  }

  /** Resumes the run with 1 life after a successful "watch ad to continue". Can only happen once per run. */
  grantContinue(): void {
    if (!this.continueOffered) return;
    this.continueOffered = false;
    this.continueUsed = true;
    this.lives = 1;
    this.callbacks.onLivesChange(this.lives);
    this.resume();
  }

  /** Finalizes the game over after the player declines (or fails) the continue offer. */
  declineContinue(): void {
    if (!this.continueOffered) return;
    this.continueOffered = false;
    this.paused = false; // endGame() stops the loop outright; no need to stay "paused" first
    this.endGame();
  }

  private endGame(): void {
    if (this.gameOverFired) return;
    this.gameOverFired = true;
    this.running = false;
    cancelAnimationFrame(this.raf);

    const result: EngineResult = {
      score: this.score,
      duration: Math.max(1, Math.round(this.elapsedMs / 1000)),
      ballsDestroyed: this.ballsDestroyed,
      destroyedByTier: this.destroyedByTier,
      multiplierHits: this.multiplierHits,
      coinsEarnedLocal: this.coinsEarnedLocal,
      levelReached: this.level,
    };
    this.callbacks.onGameOver(result);
  }

  // ---------------------------------------------------------------------
  // Rendering — canvas only draws the game world; all HUD chrome (score,
  // coins, lives, pause, multiplier badge) is real DOM/Ionic markup drawn
  // on top by GamePage, per the separation described in spec section 34/46.
  // ---------------------------------------------------------------------
  private render(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, this.width, this.height);
    this.renderBackground(ctx);
    this.renderBalls(ctx);
    this.renderBullets(ctx);
    this.renderParticles(ctx);
    this.renderFloatingTexts(ctx);
    this.renderCannon(ctx);
  }

  private renderBackground(ctx: CanvasRenderingContext2D): void {
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, '#0b0f2b');
    grad.addColorStop(1, '#141a3d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    for (const star of this.stars) {
      star.twinkle += 0.02;
      ctx.globalAlpha = 0.4 + Math.sin(star.twinkle) * 0.3;
      ctx.fillStyle = '#93c5fd';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderBalls(ctx: CanvasRenderingContext2D): void {
    for (const ball of this.balls) {
      const isMultiplier = ball.tier === 'multiplier';
      const color = this.colorForBall(ball);

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = ball.hitFlash > 0 ? 26 : 14;
      const grad = ctx.createRadialGradient(
        ball.x - ball.radius * 0.35,
        ball.y - ball.radius * 0.35,
        ball.radius * 0.1,
        ball.x,
        ball.y,
        ball.radius
      );
      grad.addColorStop(0, ball.hitFlash > 0 ? '#ffffff' : this.lighten(color));
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#0b0f2b';
      ctx.font = `700 ${Math.max(12, ball.radius * 0.62)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isMultiplier ? 'x2' : String(ball.hp), ball.x, ball.y + 1);
    }
  }

  private renderBullets(ctx: CanvasRenderingContext2D): void {
    for (const b of this.bullets) {
      ctx.save();
      ctx.shadowColor = '#7dd3fc';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
    for (const t of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
      ctx.fillStyle = t.color;
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }

  private renderCannon(ctx: CanvasRenderingContext2D): void {
    const y = this.cannonY();
    ctx.save();
    ctx.shadowColor = this.cannonAccent;
    ctx.shadowBlur = 18;

    // Base
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(this.cannonX - 34, y + 10, 68, 20, 8);
    ctx.fill();

    // Turret
    const turretGrad = ctx.createLinearGradient(this.cannonX, y - 20, this.cannonX, y + 14);
    turretGrad.addColorStop(0, this.lighten(this.cannonAccent));
    turretGrad.addColorStop(1, this.cannonAccent);
    ctx.fillStyle = turretGrad;
    ctx.beginPath();
    ctx.arc(this.cannonX, y, 22, 0, Math.PI * 2);
    ctx.fill();

    // Barrel
    ctx.fillStyle = this.cannonAccent;
    ctx.beginPath();
    ctx.roundRect(this.cannonX - 7, y - 46, 14, 40, 5);
    ctx.fill();

    ctx.restore();
  }

  private lighten(hex: string): string {
    const c = hex.replace('#', '');
    const r = Math.min(255, parseInt(c.substring(0, 2), 16) + 70);
    const g = Math.min(255, parseInt(c.substring(2, 4), 16) + 70);
    const b = Math.min(255, parseInt(c.substring(4, 6), 16) + 70);
    return `rgb(${r},${g},${b})`;
  }
}
