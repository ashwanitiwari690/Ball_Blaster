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

// Pre-computed palette values to avoid runtime string operations and Hex calculations inside the 60fps render loop
const LIGHTENED_COLORS: Record<string, string> = {
  normal: '#93c5fd',
  fast: '#86efac',
  heavy: '#d8b4fe',
  gold: '#fde68a',
  boss: '#fca5a5',
  multiplier: '#fef08a',
};

const GLOW_COLORS: Record<string, string> = {
  normal: 'rgba(59, 130, 246, 0.35)',
  fast: 'rgba(34, 197, 94, 0.35)',
  heavy: 'rgba(168, 85, 247, 0.35)',
  gold: 'rgba(245, 158, 11, 0.35)',
  boss: 'rgba(239, 68, 68, 0.35)',
  multiplier: 'rgba(253, 224, 71, 0.45)',
};

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
 * Optimized Canvas/TypeScript game engine.
 * Employs zero-garbage-collection in-place object management, batch rendering,
 * GPU-friendly vector paths without expensive shadowBlur filters, and cached transforms.
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
  private canvasLeft = 0;

  private cannonX = 0;
  private cannonTargetX = 0;
  private cannonPlaced = false;
  private userHasAimed = false;
  private readonly cannonY: () => number;
  private cannonAccent = '#60a5fa';

  private fireTimer = 0;
  private fireIntervalMs = 120; // Rapid throw rate for responsive arcade blasting

  private spawnTimer = 0;
  private spawnIntervalMs = 1150;
  private multiplierSpawnTimer = 6000;

  private balls: Ball[] = [];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private floatingTexts: FloatingText[] = [];
  private stars: { x: number; y: number; r: number; twinkle: number }[] = [];

  private bgGradient: CanvasGradient | null = null;

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

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
  }

  setCannonAccent(color: string): void {
    this.cannonAccent = color;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.canvasLeft = rect.left;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);

    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.height > 0) {
        this.bgGradient = ctx.createLinearGradient(0, 0, 0, this.height);
        this.bgGradient.addColorStop(0, '#0b0f2b');
        this.bgGradient.addColorStop(1, '#141a3d');
      }
    }

    if (this.width > 0 && (!this.cannonPlaced || !this.userHasAimed)) {
      this.cannonX = this.width / 2;
      this.cannonTargetX = this.width / 2;
      this.cannonPlaced = true;
    }
  }

  private seedStars(): void {
    this.stars = Array.from({ length: 48 }, () => ({
      x: Math.random() * (this.width || 400),
      y: Math.random() * (this.height || 800),
      r: Math.random() * 1.3 + 0.4,
      twinkle: Math.random() * Math.PI * 2,
    }));
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.canvasLeft = this.canvas.getBoundingClientRect().left;
    this.cannonTargetX = e.clientX - this.canvasLeft;
    this.userHasAimed = true;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.buttons > 0 || e.pointerType === 'touch') {
      this.cannonTargetX = e.clientX - this.canvasLeft;
      this.userHasAimed = true;
    }
  };

  private bindPointerEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
  }

  start(): void {
    this.running = true;
    this.paused = false;
    this.lastTs = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTs = 0;
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
  }

  quit(): void {
    this.endGame();
  }

  private readonly loop = (ts: number): void => {
    if (!this.running) return;

    if (!this.lastTs) {
      this.lastTs = ts;
    }
    const elapsed = ts - this.lastTs;
    this.lastTs = ts;

    // Standard 60fps frame is 16.6ms. Clamping elapsed between 10ms and 32ms guarantees
    // consistent gameplay speed without slow-motion lag or physics skipping.
    const dt = Math.min(32, Math.max(10, elapsed));

    if (!this.paused) {
      this.update(dt);
      this.render();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.elapsedMs += dt;

    // Smooth glide toward target
    this.cannonX += (this.cannonTargetX - this.cannonX) * Math.min(1, dt / 75);
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
      this.fireTimer -= this.fireIntervalMs;
      if (this.fireTimer > this.fireIntervalMs) {
        this.fireTimer = 0;
      }
      this.spawnBullet();
    }
  }

  private updateSpawning(dt: number): void {
    this.spawnTimer += dt;
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
    // Increased velocity: -1.35 px/ms (over 2x faster flight speed) to rapidly reach and damage incoming balls
    const bulletSpeed = -1.35;
    if (this.multiplierActive) {
      this.bullets.push(
        {
          x: this.cannonX - 8,
          y: this.cannonY() - 34,
          vy: bulletSpeed,
          radius: 6,
          active: true,
        },
        {
          x: this.cannonX + 8,
          y: this.cannonY() - 34,
          vy: bulletSpeed,
          radius: 6,
          active: true,
        }
      );
    } else {
      this.bullets.push({
        x: this.cannonX,
        y: this.cannonY() - 34,
        vy: bulletSpeed,
        radius: 6,
        active: true,
      });
    }
    this.callbacks.onShoot?.();
  }

  private spawnBall(): void {
    const cfg = pickWeightedTier(this.level);
    const hp = Math.round(randRange(cfg.minHp, cfg.maxHp));
    const radius = cfg.radius * (0.85 + hp / (cfg.maxHp * 2.4));
    this.balls.push({
      x: randRange(radius + 10, Math.max(radius + 20, this.width - radius - 10)),
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
      x: randRange(radius + 10, Math.max(radius + 20, this.width - radius - 10)),
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

  /** In-place compaction to eliminate garbage collection pauses */
  private updateBullets(dt: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (!b.active) continue;
      b.y += b.vy * dt;
      if (b.y < -20) {
        b.active = false;
        continue;
      }
      this.bullets[writeIdx++] = b;
    }
    this.bullets.length = writeIdx;
  }

  /** In-place compaction for balls */
  private updateBalls(dt: number): void {
    const floor = Math.max(120, this.cannonY() - 30);
    let writeIdx = 0;
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
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
          this.spawnParticles(ball.x, floor, '#ef4444', 8);
          if (this.lives <= 0) this.handlePotentialGameOver();
        }
        continue;
      }
      this.balls[writeIdx++] = ball;
    }
    this.balls.length = writeIdx;
  }

  /** In-place compaction for particles */
  private updateParticles(dt: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.0012 * dt;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      this.particles[writeIdx++] = p;
    }
    this.particles.length = writeIdx;
  }

  /** In-place compaction for floating text */
  private updateFloatingTexts(dt: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.floatingTexts.length; i++) {
      const t = this.floatingTexts[i];
      if (!t.active) continue;
      t.y += t.vy * dt;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        continue;
      }
      this.floatingTexts[writeIdx++] = t;
    }
    this.floatingTexts.length = writeIdx;
  }

  private handleCollisions(): void {
    for (let i = 0; i < this.bullets.length; i++) {
      const bullet = this.bullets[i];
      if (!bullet.active) continue;

      for (let j = 0; j < this.balls.length; j++) {
        const ball = this.balls[j];
        if (!ball.active) continue;

        const dx = bullet.x - ball.x;
        const dy = bullet.y - ball.y;
        const hitDist = bullet.radius + ball.radius;
        if (dx * dx + dy * dy <= hitDist * hitDist) {
          bullet.active = false;
          this.onBallHit(ball);
          break;
        }
      }
    }
  }

  private onBallHit(ball: Ball): void {
    ball.hp -= 1;
    ball.hitFlash = 80;
    this.spawnParticles(ball.x, ball.y, this.colorForBall(ball), 2);
    this.callbacks.onBulletImpact?.();

    if (ball.hp > 0) return;

    ball.active = false;

    if (ball.tier === 'multiplier') {
      this.multiplierActive = true;
      this.multiplierRemainingMs = ECONOMY_CONFIG.multiplierDurationMs;
      this.multiplierHits += 1;
      this.callbacks.onMultiplierChange(true, this.multiplierRemainingMs);
      this.callbacks.onMultiplierActivated?.();
      this.spawnParticles(ball.x, ball.y, '#fde047', 16);
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

    this.spawnParticles(ball.x, ball.y, tierCfg.color, 12);
    this.spawnFloatingText(ball.x, ball.y, `+${coinGain}`, '#fbbf24');

    // Split heavy / boss balls
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
    this.spawnParticles(this.width / 2, this.height * 0.32, '#38bdf8', 20);
  }

  private colorForBall(ball: Ball): string {
    return ball.tier === 'multiplier' ? '#fde047' : BALL_TIERS[ball.tier].color;
  }

  /** Capped particle emission to ensure stable 60+ FPS on mobile devices */
  private spawnParticles(x: number, y: number, color: string, count: number): void {
    const maxParticles = 40;
    const allowed = Math.min(count, maxParticles - this.particles.length);
    if (allowed <= 0) return;

    for (let i = 0; i < allowed; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randRange(0.06, 0.22);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed * 10,
        vy: Math.sin(angle) * speed * 10,
        life: randRange(220, 420),
        maxLife: 420,
        color,
        radius: randRange(1.5, 3),
        active: true,
      });
    }
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    if (this.floatingTexts.length >= 6) {
      this.floatingTexts.shift();
    }
    this.floatingTexts.push({ x, y, vy: -0.045, text, color, life: 600, maxLife: 600, active: true });
  }

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

  grantContinue(): void {
    if (!this.continueOffered) return;
    this.continueOffered = false;
    this.continueUsed = true;
    this.lives = 1;
    this.callbacks.onLivesChange(this.lives);
    this.resume();
  }

  declineContinue(): void {
    if (!this.continueOffered) return;
    this.continueOffered = false;
    this.paused = false;
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
  // High-Performance Rendering (Zero shadowBlur, Batch paths)
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
    ctx.fillStyle = this.bgGradient || '#0b0f2b';
    ctx.fillRect(0, 0, this.width, this.height);

    // Batch all stars into a single path for 1 draw call
    ctx.beginPath();
    ctx.fillStyle = 'rgba(147, 197, 253, 0.6)';
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      ctx.moveTo(star.x + star.r, star.y);
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  private renderBalls(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      const isMultiplier = ball.tier === 'multiplier';
      const color = this.colorForBall(ball);
      const tierKey = ball.tier;
      const glowColor = GLOW_COLORS[tierKey] || 'rgba(59, 130, 246, 0.35)';
      const lightColor = ball.hitFlash > 0 ? '#ffffff' : (LIGHTENED_COLORS[tierKey] || '#ffffff');

      // Fast vector glow ring (hardware-accelerated, zero raster filter delay)
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius + (ball.hitFlash > 0 ? 5 : 3), 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.fill();

      // Ball body with 3D radial gradient
      const grad = ctx.createRadialGradient(
        ball.x - ball.radius * 0.3,
        ball.y - ball.radius * 0.3,
        ball.radius * 0.1,
        ball.x,
        ball.y,
        ball.radius
      );
      grad.addColorStop(0, lightColor);
      grad.addColorStop(1, color);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Ball number
      ctx.fillStyle = '#0b0f2b';
      ctx.font = `800 ${Math.max(12, ball.radius * 0.62)}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isMultiplier ? 'x2' : String(ball.hp), ball.x, ball.y + 1);
    }
  }

  /** All bullets drawn in just two batch draw calls */
  private renderBullets(ctx: CanvasRenderingContext2D): void {
    if (this.bullets.length === 0) return;

    // Batch outer bullet aura
    ctx.beginPath();
    ctx.fillStyle = 'rgba(125, 211, 252, 0.4)';
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      ctx.moveTo(b.x + b.radius + 2, b.y);
      ctx.arc(b.x, b.y, b.radius + 2, 0, Math.PI * 2);
    }
    ctx.fill();

    // Batch bright core
    ctx.beginPath();
    ctx.fillStyle = '#e0f2fe';
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      ctx.moveTo(b.x + b.radius, b.y);
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /** Render particles without per-particle context save/restore */
  private renderParticles(ctx: CanvasRenderingContext2D): void {
    if (this.particles.length === 0) return;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
    if (this.floatingTexts.length === 0) return;

    ctx.font = '700 16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < this.floatingTexts.length; i++) {
      const t = this.floatingTexts[i];
      ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  private renderCannon(ctx: CanvasRenderingContext2D): void {
    const y = this.cannonY();

    // Base
    ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
    ctx.beginPath();
    ctx.roundRect(this.cannonX - 34, y + 10, 68, 20, 8);
    ctx.fill();

    // Turret outer glow ring
    ctx.beginPath();
    ctx.arc(this.cannonX, y, 25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(96, 165, 250, 0.25)';
    ctx.fill();

    // Turret core
    ctx.beginPath();
    ctx.arc(this.cannonX, y, 22, 0, Math.PI * 2);
    ctx.fillStyle = this.cannonAccent;
    ctx.fill();

    // Barrel
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(this.cannonX - 7, y - 46, 14, 40, 5);
    ctx.fill();
  }
}
