import { BALL_TIERS, BallTier, BallTierConfig, ECONOMY_CONFIG, levelTarget } from '../config/economy.config';
import { EngineCallbacks, EngineResult } from './engine.types';
import { GameAppearance } from '../models/shop.models';
import { difficultyForLevel, LevelDifficulty } from './level-difficulty';

interface Ball {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
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
  previousY: number;
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
const MAX_BALLS = 28;
const MAX_BULLETS = 80;
const MAX_PARTICLES = 40;
const MAX_STEP_MS = 1000 / 60;
const COMBO_WINDOW_MS = 3500;

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
function pickWeightedTier(weights: LevelDifficulty['tierWeights']): BallTierConfig {
  const total = TIER_KEYS.reduce((s, k) => s + weights[k], 0);
  let roll = Math.random() * total;
  for (const key of TIER_KEYS) {
    roll -= weights[key];
    if (roll < 0) return BALL_TIERS[key];
  }
  return BALL_TIERS.normal;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Canvas engine with bounded physics steps, pooled transient objects and cached artwork.
 */
export class BallBlasterEngine {
  private raf = 0;
  private lastTs: number | null = null;
  private running = false;
  private paused = false;
  private elapsedMs = 0;
  private readonly resizeObserver: ResizeObserver;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private canvasLeft = 0;
  private readonly ctx: CanvasRenderingContext2D;
  private background: HTMLCanvasElement | null = null;
  private readonly ballSprites = new Map<string, HTMLCanvasElement>();
  private activePointer: number | null = null;
  private keyboardDirection = 0;
  private readonly heldKeys = new Set<string>();

  private cannonX = 0;
  private cannonTargetX = 0;
  private cannonPlaced = false;
  private userHasAimed = false;
  private readonly cannonY: () => number;
  private cannonAccent = '#60a5fa';
  private shotColor = '#e0f2fe';
  private shotGlow = '#e0f2fe66';
  private ballSkin: GameAppearance['ballSkin'] = 'classic';
  private effect: GameAppearance['effect'] = 'standard';
  private theme: GameAppearance['theme'] = 'arcade';

  private fireTimer = 0;
  private readonly fireIntervalMs = 120;

  private spawnTimer = 850;
  private multiplierSpawnTimer = 6000;

  private balls: Ball[] = [];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private floatingTexts: FloatingText[] = [];
  private readonly bulletPool: Bullet[] = [];
  private readonly particlePool: Particle[] = [];
  private readonly textPool: FloatingText[] = [];
  private stars: { x: number; y: number; r: number }[] = [];

  private bgGradient: CanvasGradient | null = null;

  private score = 0;
  private lives: number = ECONOMY_CONFIG.startingLives;
  private level: number;
  private difficulty: LevelDifficulty;
  private ballsDestroyedInLevel = 0;
  private ballsDestroyed = 0;
  private destroyedByTier: Record<BallTier, number> = { normal: 0, fast: 0, heavy: 0, gold: 0, boss: 0 };
  private multiplierHits = 0;
  private coinsEarnedLocal = 0;
  private multiplierActive = false;
  private multiplierRemainingMs = 0;
  private multiplierSeconds = 0;
  private recoveryRemainingMs = 0;
  private combo = 0;
  private comboRemainingMs = 0;

  private gameOverFired = false;
  private continueOffered = false;
  private continueUsed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: EngineCallbacks,
    startLevel = 1
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    this.level = Number.isFinite(startLevel) ? Math.max(1, Math.floor(startLevel)) : 1;
    this.difficulty = difficultyForLevel(this.level);
    this.cannonY = () => this.height - 70;
    this.resize();
    this.bindPointerEvents();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
  }

  setAppearance(appearance: GameAppearance): void {
    this.cannonAccent = appearance.cannonColor;
    this.shotColor = appearance.shotColor;
    this.shotGlow = `${appearance.shotColor}66`;
    this.effect = appearance.effect;
    if (this.ballSkin !== appearance.ballSkin) {
      this.ballSkin = appearance.ballSkin;
      this.ballSprites.clear();
    }
    if (this.theme !== appearance.theme) {
      this.theme = appearance.theme;
      this.cacheBackground();
    }
    if (this.paused) this.render();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.canvasLeft = rect.left;
    if (rect.width <= 0 || rect.height <= 0) return;
    // Bound the fill cost on high-density phones and large desktop displays.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1_500_000 / (rect.width * rect.height)));
    if (this.width === rect.width && this.height === rect.height && this.dpr === dpr) return;
    const oldWidth = this.width;
    const oldHeight = this.height;
    this.dpr = dpr;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);

    const ctx = this.ctx;
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
    } else if (oldWidth > 0) {
      this.cannonX = this.clampCannon(this.cannonX * this.width / oldWidth);
      this.cannonTargetX = this.clampCannon(this.cannonTargetX * this.width / oldWidth);
    }
    if (oldWidth > 0 && oldHeight > 0) {
      for (const ball of this.balls) {
        ball.x = Math.max(ball.radius, Math.min(this.width - ball.radius, ball.x * this.width / oldWidth));
        ball.y *= this.height / oldHeight;
        ball.previousX = ball.x;
        ball.previousY = ball.y;
      }
      for (const bullet of this.bullets) {
        bullet.x *= this.width / oldWidth;
        bullet.y *= this.height / oldHeight;
        bullet.previousY = bullet.y;
      }
    }
    this.seedStars();
    this.cacheBackground();
    this.ballSprites.clear();
    if (this.paused) this.render();
  }

  private clampCannon(x: number): number {
    const margin = Math.min(36, this.width / 2);
    return Math.max(margin, Math.min(this.width - margin, x));
  }

  private seedStars(): void {
    this.stars = Array.from({ length: 48 }, () => ({
      x: Math.random() * (this.width || 400),
      y: Math.random() * (this.height || 800),
      r: Math.random() * 1.3 + 0.4,
    }));
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.paused || !this.running || this.activePointer !== null) return;
    this.activePointer = e.pointerId;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.canvasLeft = this.canvas.getBoundingClientRect().left;
    this.cannonTargetX = this.clampCannon(e.clientX - this.canvasLeft);
    this.userHasAimed = true;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.paused && e.pointerId === this.activePointer) {
      this.cannonTargetX = this.clampCannon(e.clientX - this.canvasLeft);
      this.userHasAimed = true;
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.activePointer) this.activePointer = null;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.running || this.paused || !['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) return;
    e.preventDefault();
    this.heldKeys.add(e.key);
    this.updateKeyboardDirection();
    this.userHasAimed = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.key);
    this.updateKeyboardDirection();
  };

  private updateKeyboardDirection(): void {
    this.keyboardDirection = Number(this.heldKeys.has('ArrowRight') || this.heldKeys.has('d'))
      - Number(this.heldKeys.has('ArrowLeft') || this.heldKeys.has('a'));
  }

  private bindPointerEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  start(): void {
    if (this.gameOverFired) return;
    this.running = true;
    this.paused = false;
    this.lastTs = null;
    this.render();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  pause(): void {
    this.paused = true;
    this.activePointer = null;
    this.heldKeys.clear();
    this.keyboardDirection = 0;
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (!this.running || !this.paused || this.continueOffered) return;
    this.paused = false;
    this.lastTs = null;
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.ballSprites.clear();
    this.background = null;
  }

  quit(): void {
    this.endGame();
  }

  private readonly loop = (ts: number): void => {
    if (!this.running || this.paused) return;
    // Use real elapsed time at 30/60/90/120/144 Hz. Substeps keep physics stable;
    // discard time beyond 100 ms after a long stall rather than spiralling into catch-up.
    let remaining = this.lastTs === null ? 0 : Math.max(0, Math.min(100, ts - this.lastTs));
    this.lastTs = ts;
    while (remaining > 0 && this.running && !this.paused) {
      const dt = Math.min(MAX_STEP_MS, remaining);
      this.update(dt);
      remaining -= dt;
    }
    this.render();
    if (this.running && !this.paused) this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.elapsedMs += dt;

    this.recoveryRemainingMs = Math.max(0, this.recoveryRemainingMs - dt);
    if (this.combo > 0) {
      this.comboRemainingMs -= dt;
      if (this.comboRemainingMs <= 0) this.resetCombo();
    }
    this.cannonTargetX = this.clampCannon(this.cannonTargetX + this.keyboardDirection * 0.65 * dt);
    this.cannonX += (this.cannonTargetX - this.cannonX) * (1 - Math.exp(-dt / 40));
    this.cannonX = this.clampCannon(this.cannonX);

    this.updateMultiplier(dt);
    this.updateFiring(dt);
    this.updateSpawning(dt);
    this.updateBullets(dt);
    this.updateBalls(dt);
    this.handleCollisions();
    this.handleMissedBalls();
    if (!this.running || this.paused) return;
    this.updateParticles(dt);
    this.updateFloatingTexts(dt);
  }

  private updateMultiplier(dt: number): void {
    if (this.multiplierActive) {
      this.multiplierRemainingMs -= dt;
      if (this.multiplierRemainingMs <= 0) {
        this.multiplierActive = false;
        this.multiplierRemainingMs = 0;
        this.callbacks.onMultiplierChange(false, 0);
      } else if (Math.ceil(this.multiplierRemainingMs / 1000) !== this.multiplierSeconds) {
        this.multiplierSeconds = Math.ceil(this.multiplierRemainingMs / 1000);
        this.callbacks.onMultiplierChange(true, this.multiplierRemainingMs);
      }
    }
  }

  private updateFiring(dt: number): void {
    this.fireTimer += dt;
    while (this.fireTimer >= this.fireIntervalMs) {
      this.fireTimer -= this.fireIntervalMs;
      this.spawnBullet();
    }
  }

  private updateSpawning(dt: number): void {
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.difficulty.spawnIntervalMs) {
      this.spawnTimer -= this.difficulty.spawnIntervalMs;
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
      this.addBullet(this.cannonX - 8, bulletSpeed);
      this.addBullet(this.cannonX + 8, bulletSpeed);
    } else {
      this.addBullet(this.cannonX, bulletSpeed);
    }
    this.callbacks.onShoot?.();
  }

  private addBullet(x: number, vy: number): void {
    if (this.bullets.length >= MAX_BULLETS) return;
    const bullet = this.bulletPool.pop() ?? {} as Bullet;
    bullet.x = x;
    bullet.y = bullet.previousY = this.cannonY() - 34;
    bullet.vy = vy;
    bullet.radius = 6;
    bullet.active = true;
    this.bullets.push(bullet);
  }

  private spawnBall(): void {
    if (this.balls.length >= MAX_BALLS) return;
    const cfg = pickWeightedTier(this.difficulty.tierWeights);
    const baseHp = Math.round(randRange(cfg.minHp, cfg.maxHp));
    const hp = Math.round(baseHp * this.difficulty.healthMultiplier);
    // Keep artwork sizes stable as health increases at later levels.
    const radius = Math.round(cfg.radius * (0.85 + baseHp / (cfg.maxHp * 2.4)));
    const x = randRange(radius + 10, Math.max(radius + 20, this.width - radius - 10));
    this.balls.push({
      x,
      y: -radius,
      previousX: x,
      previousY: -radius,
      vx: randRange(-0.02, 0.02) * this.difficulty.speedMultiplier,
      vy: cfg.speed * this.difficulty.speedMultiplier / 1000,
      radius,
      hp,
      maxHp: hp,
      tier: cfg.tier,
      active: true,
      hitFlash: 0,
    });
  }

  private spawnMultiplierOrb(): void {
    if (this.balls.length >= MAX_BALLS) return;
    const radius = 22;
    const x = randRange(radius + 10, Math.max(radius + 20, this.width - radius - 10));
    this.balls.push({
      x,
      y: -radius,
      previousX: x,
      previousY: -radius,
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
      if (!b.active) {
        this.bulletPool.push(b);
        continue;
      }
      b.previousY = b.y;
      b.y += b.vy * dt;
      if (b.y < -20) {
        b.active = false;
        this.bulletPool.push(b);
        continue;
      }
      this.bullets[writeIdx++] = b;
    }
    this.bullets.length = writeIdx;
  }

  /** In-place compaction for balls */
  private updateBalls(dt: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      if (!ball.active) continue;
      ball.previousX = ball.x;
      ball.previousY = ball.y;
      ball.y += ball.vy * dt;
      ball.x += ball.vx * dt;
      if (ball.x < ball.radius) {
        ball.x = ball.radius;
        ball.vx = Math.abs(ball.vx);
      } else if (ball.x > this.width - ball.radius) {
        ball.x = this.width - ball.radius;
        ball.vx = -Math.abs(ball.vx);
      }
      if (ball.hitFlash > 0) ball.hitFlash -= dt;
      this.balls[writeIdx++] = ball;
    }
    this.balls.length = writeIdx;
  }

  private handleMissedBalls(): void {
    const floor = Math.max(120, this.cannonY() - 30);
    for (const ball of this.balls) {
      if (ball.active && ball.y + ball.radius >= floor) {
        ball.active = false;
        if (ball.tier !== 'multiplier' && this.recoveryRemainingMs <= 0) {
          this.recoveryRemainingMs = 1800;
          this.resetCombo();
          this.lives = Math.max(0, this.lives - 1);
          this.callbacks.onLivesChange(this.lives);
          this.callbacks.onLifeLost?.();
          this.spawnParticles(ball.x, floor, '#ef4444', 8);
          if (this.lives <= 0) {
            this.handlePotentialGameOver();
            return;
          }
        }
        continue;
      }
    }
  }

  /** In-place compaction for particles */
  private updateParticles(dt: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) {
        this.particlePool.push(p);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.0012 * dt;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.particlePool.push(p);
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
      if (!t.active) {
        this.textPool.push(t);
        continue;
      }
      t.y += t.vy * dt;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        this.textPool.push(t);
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
      let nearest: Ball | undefined;
      let nearestTime = Infinity;
      for (let j = 0; j < this.balls.length; j++) {
        const ball = this.balls[j];
        if (!ball.active) continue;

        // Sweep relative movement so fast bullets cannot tunnel through small balls.
        const dx = bullet.x - ball.previousX;
        const dy = bullet.previousY - ball.previousY;
        const vx = -(ball.x - ball.previousX);
        const vy = (bullet.y - bullet.previousY) - (ball.y - ball.previousY);
        const hitDist = bullet.radius + ball.radius;
        const c = dx * dx + dy * dy - hitDist * hitDist;
        const a = vx * vx + vy * vy;
        const b = 2 * (dx * vx + dy * vy);
        const discriminant = b * b - 4 * a * c;
        let time = Infinity;
        if (c <= 0) time = 0;
        else if (a > 0 && discriminant >= 0) time = (-b - Math.sqrt(discriminant)) / (2 * a);
        if (time >= 0 && time <= 1 && time < nearestTime) {
          nearest = ball;
          nearestTime = time;
        }
      }
      if (nearest) {
        bullet.active = false;
        this.onBallHit(nearest);
      }
    }
  }

  private onBallHit(ball: Ball): void {
    ball.hp -= 1;
    ball.hitFlash = 80;
    this.spawnParticles(ball.x, ball.y, this.shotColor, 2);
    this.callbacks.onBulletImpact?.();

    if (ball.hp > 0) return;

    ball.active = false;

    if (ball.tier === 'multiplier') {
      this.multiplierActive = true;
      this.multiplierRemainingMs = ECONOMY_CONFIG.multiplierDurationMs;
      this.multiplierSeconds = Math.ceil(this.multiplierRemainingMs / 1000);
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
    this.combo += 1;
    this.comboRemainingMs = COMBO_WINDOW_MS;
    const comboMultiplier = Math.min(5, 1 + Math.floor(this.combo / 3));
    const scoreGain = tierCfg.maxHp * 8 * multiplier * comboMultiplier;

    this.score += scoreGain;
    this.coinsEarnedLocal += coinGain;
    this.ballsDestroyed += 1;
    this.destroyedByTier[ball.tier] += 1;

    this.callbacks.onScoreChange(this.score);
    this.callbacks.onCoinsChange(this.coinsEarnedLocal);
    this.callbacks.onBallDestroyed?.(ball.tier);

    this.spawnParticles(ball.x, ball.y, tierCfg.color, this.effect === 'explosion' ? 24 : 12);
    this.spawnFloatingText(ball.x, ball.y, `+${coinGain}`, '#fbbf24');

    // Split heavy / boss balls
    if ((ball.tier === 'heavy' || ball.tier === 'boss') && ball.maxHp >= 8) {
      for (let dir = -1; dir <= 1; dir += 2) {
        if (this.balls.length >= MAX_BALLS) break;
        const childCfg = BALL_TIERS.normal;
        const hp = childCfg.minHp;
        const x = Math.max(childCfg.radius, Math.min(this.width - childCfg.radius, ball.x + dir * 24));
        const y = Math.min(ball.y, this.cannonY() - 190);
        this.balls.push({
          x,
          y,
          previousX: x,
          previousY: y,
          vx: dir * 0.05,
          vy: childCfg.speed * this.difficulty.speedMultiplier / 1000,
          radius: Math.round(childCfg.radius * 0.8),
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
    if (this.ballsDestroyedInLevel < levelTarget(this.level)) {
      return;
    }

    this.ballsDestroyedInLevel = 0;
    this.level += 1;
    // Cache the new profile once per level, outside the animation loop.
    this.difficulty = difficultyForLevel(this.level);
    this.coinsEarnedLocal += ECONOMY_CONFIG.levelCompleteCoins;

    this.callbacks.onCoinsChange(this.coinsEarnedLocal);
    this.callbacks.onLevelChange?.(this.level);
    this.spawnParticles(this.width / 2, this.height * 0.32, '#38bdf8', 20);
  }

  private resetCombo(): void {
    if (this.combo === 0) return;
    this.combo = 0;
    this.comboRemainingMs = 0;
  }

  private colorForBall(ball: Ball): string {
    return ball.tier === 'multiplier' ? '#fde047' : BALL_TIERS[ball.tier].color;
  }

  /** Capped particle emission to ensure stable 60+ FPS on mobile devices */
  private spawnParticles(x: number, y: number, color: string, count: number): void {
    const allowed = Math.min(count, MAX_PARTICLES - this.particles.length);
    if (allowed <= 0) return;

    for (let i = 0; i < allowed; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randRange(0.06, 0.22);
      const particle = this.particlePool.pop() ?? {} as Particle;
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.life = randRange(220, 420);
      particle.maxLife = 420;
      particle.color = color;
      particle.radius = randRange(1.5, 3);
      particle.active = true;
      this.particles.push(particle);
    }
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    if (this.floatingTexts.length >= 6) {
      this.textPool.push(this.floatingTexts.shift()!);
    }
    const floating = this.textPool.pop() ?? {} as FloatingText;
    Object.assign(floating, { x, y, vy: -0.045, text, color, life: 600, maxLife: 600, active: true });
    this.floatingTexts.push(floating);
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
    this.recoveryRemainingMs = 2500;
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
    const ctx = this.ctx;
    this.renderBackground(ctx);
    this.renderBalls(ctx);
    this.renderBullets(ctx);
    this.renderParticles(ctx);
    this.renderFloatingTexts(ctx);
    this.renderCannon(ctx);
  }

  private renderBackground(ctx: CanvasRenderingContext2D): void {
    if (this.background) {
      ctx.drawImage(this.background, 0, 0, this.width, this.height);
    }
  }

  private cacheBackground(): void {
    const background = document.createElement('canvas');
    background.width = this.canvas.width;
    background.height = this.canvas.height;
    const ctx = background.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.theme === 'crimson') {
      const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
      gradient.addColorStop(0, '#210b1c');
      gradient.addColorStop(1, '#421c2a');
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = this.bgGradient || '#0b0f2b';
    }
    ctx.fillRect(0, 0, this.width, this.height);

    // Batch all stars into a single path for 1 draw call
    ctx.beginPath();
    ctx.fillStyle = this.theme === 'crimson' ? 'rgba(253, 164, 120, 0.65)' : 'rgba(147, 197, 253, 0.6)';
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      ctx.moveTo(star.x + star.r, star.y);
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    }
    ctx.fill();
    this.background = background;
  }

  private spriteForBall(ball: Ball): HTMLCanvasElement {
    const flash = ball.hitFlash > 0;
    const key = `${ball.tier}:${ball.radius}:${Number(flash)}`;
    const cached = this.ballSprites.get(key);
    if (cached) return cached;
    const sprite = document.createElement('canvas');
    const radius = ball.radius;
    const center = radius + 6;
    sprite.width = sprite.height = Math.ceil(center * 2 * this.dpr);
    const ctx = sprite.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(center, center, radius + (flash ? 5 : 3), 0, Math.PI * 2);
    ctx.fillStyle = GLOW_COLORS[ball.tier];
    ctx.fill();
    const gradient = ctx.createRadialGradient(center - radius * 0.3, center - radius * 0.3,
      radius * 0.1, center, center, radius);
    gradient.addColorStop(0, flash ? '#ffffff' : LIGHTENED_COLORS[ball.tier]);
    gradient.addColorStop(1, this.colorForBall(ball));
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    // Skin details are painted once into the cached sprite; tier colors remain readable.
    if (ball.tier !== 'multiplier' && this.ballSkin === 'neon') {
      ctx.beginPath();
      ctx.arc(center, center, radius - 2, 0, Math.PI * 2);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (ball.tier !== 'multiplier' && this.ballSkin === 'galaxy') {
      ctx.beginPath();
      ctx.ellipse(center, center, radius * 0.9, radius * 0.3, -0.6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(224, 231, 255, 0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#e0e7ff';
      for (let i = 0; i < 5; i++) {
        const angle = i * 2.4;
        ctx.beginPath();
        ctx.arc(center + Math.cos(angle) * radius * 0.65, center + Math.sin(angle) * radius * 0.65, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.ballSprites.set(key, sprite);
    return sprite;
  }

  private renderBalls(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i];
      if (!ball.active) continue;
      const isMultiplier = ball.tier === 'multiplier';
      const size = (ball.radius + 6) * 2;
      ctx.drawImage(this.spriteForBall(ball), ball.x - size / 2, ball.y - size / 2, size, size);

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

    if (this.effect === 'trail') {
      ctx.beginPath();
      ctx.strokeStyle = this.shotGlow;
      ctx.lineWidth = 5;
      for (const bullet of this.bullets) {
        if (!bullet.active) continue;
        ctx.moveTo(bullet.x, bullet.y);
        ctx.lineTo(bullet.x, bullet.y + 30);
      }
      ctx.stroke();
    }

    // Batch outer bullet aura
    ctx.beginPath();
    ctx.fillStyle = this.shotGlow;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (!b.active) continue;
      ctx.moveTo(b.x + b.radius + 2, b.y);
      ctx.arc(b.x, b.y, b.radius + 2, 0, Math.PI * 2);
    }
    ctx.fill();

    // Batch bright core
    ctx.beginPath();
    ctx.fillStyle = this.shotColor;
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (!b.active) continue;
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
    ctx.fillStyle = `${this.cannonAccent}40`;
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
