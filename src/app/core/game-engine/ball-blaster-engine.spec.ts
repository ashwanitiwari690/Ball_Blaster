import { BallBlasterEngine } from './ball-blaster-engine';
import { EngineCallbacks } from './engine.types';
import { BALL_TIERS, ECONOMY_CONFIG, levelTarget } from '../config/economy.config';

describe('BallBlasterEngine', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let canvas: HTMLCanvasElement;
  let callbacks: EngineCallbacks;
  let engines: BallBlasterEngine[];
  let ctx: CanvasRenderingContext2D;

  function createEngine(level = 1): BallBlasterEngine {
    const engine = new BallBlasterEngine(canvas, callbacks, level);
    engines.push(engine);
    return engine;
  }

  function frame(ts: number): void {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(ts));
  }

  function ball(overrides: Partial<BallBlasterEngine['balls'][number]> = {}): BallBlasterEngine['balls'][number] {
    return {
      x: 180, y: 200, previousX: 180, previousY: 200, vx: 0, vy: 0,
      radius: 26, hp: 1, maxHp: 3, tier: 'normal', active: true, hitFlash: 0,
      ...overrides,
    };
  }

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    engines = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
    const gradient = { addColorStop: vi.fn() };
    ctx = {
      setTransform: vi.fn(), createLinearGradient: vi.fn(() => gradient),
      createRadialGradient: vi.fn(() => gradient), fillRect: vi.fn(),
      beginPath: vi.fn(), arc: vi.fn(), moveTo: vi.fn(), fill: vi.fn(),
      drawImage: vi.fn(), fillText: vi.fn(), roundRect: vi.fn(),
      stroke: vi.fn(), ellipse: vi.fn(), lineTo: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 360, height: 800,
    } as DOMRect);
    callbacks = {
      onScoreChange: vi.fn(), onCoinsChange: vi.fn(), onLivesChange: vi.fn(),
      onMultiplierChange: vi.fn(), onGameOver: vi.fn(), onShoot: vi.fn(),
      onLevelChange: vi.fn(),
    };
  });

  afterEach(() => {
    engines.forEach((engine) => engine.destroy());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([30, 60, 90, 120, 144])('keeps real-time speed and firing cadence at %i Hz', (hz) => {
    const engine = createEngine();
    engine.start();
    frame(0);
    for (let i = 1; i <= hz * 2; i++) frame(i * 1000 / hz);
    expect(engine['elapsedMs']).toBeCloseTo(2000, 5);
    expect(callbacks.onShoot).toHaveBeenCalledTimes(16);
  });

  it('stops frames while paused and discards the pause gap on resume', () => {
    const engine = createEngine();
    engine.start();
    frame(0);
    frame(20);
    engine.pause();
    expect(frames.size).toBe(0);
    engine.resume();
    frame(60_000);
    expect(engine['elapsedMs']).toBe(20);
    frame(60_020);
    expect(engine['elapsedMs']).toBe(40);
    expect(frames.size).toBe(1);
  });

  it('bounds catch-up after a long stall', () => {
    const engine = createEngine();
    engine.start();
    frame(0);
    frame(10_000);
    expect(engine['elapsedMs']).toBeCloseTo(100, 6);
    expect(callbacks.onShoot).not.toHaveBeenCalled();
  });

  it('hits the nearest crossed ball even when the bullet ends past both balls', () => {
    const engine = createEngine();
    const far = ball({ y: 100, previousY: 100, radius: 10 });
    const near = ball({ radius: 10 });
    engine['balls'] = [far, near];
    engine['bullets'] = [{ x: 180, y: 50, previousY: 300, radius: 6, vy: -1.35, active: true }];
    engine['handleCollisions']();
    expect(near.active).toBe(false);
    expect(far.active).toBe(true);
    expect(engine['ballsDestroyed']).toBe(1);
  });

  it('lets a last-second hit save a ball before checking the loss boundary', () => {
    const engine = createEngine();
    engine['running'] = true;
    engine['balls'] = [ball({ y: 675, previousY: 675 })];
    engine['bullets'] = [{ x: 180, y: 690, previousY: 690, radius: 6, vy: -1.35, active: true }];
    engine['update'](16);
    expect(engine['ballsDestroyed']).toBe(1);
    expect(callbacks.onLivesChange).not.toHaveBeenCalled();
  });

  it('takes only one life for a cluster of misses, then allows damage after recovery', () => {
    const engine = createEngine();
    engine['balls'] = [ball({ y: 700 }), ball({ x: 280, y: 700 })];
    engine['handleMissedBalls']();
    expect(callbacks.onLivesChange).toHaveBeenCalledExactlyOnceWith(2);
    engine['recoveryRemainingMs'] = 0;
    engine['balls'] = [ball({ y: 700 })];
    engine['handleMissedBalls']();
    expect(callbacks.onLivesChange).toHaveBeenLastCalledWith(1);
  });

  it('offers one continue, protects the revive and ends exactly once after that', () => {
    callbacks.onContinueOffer = vi.fn();
    const engine = createEngine();
    engine.start();
    engine['lives'] = 1;
    engine['balls'] = [ball({ y: 700 })];
    engine['handleMissedBalls']();
    expect(callbacks.onContinueOffer).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    engine.resume();
    expect(frames.size).toBe(0);
    engine.grantContinue();
    expect(engine['lives']).toBe(1);
    expect(engine['recoveryRemainingMs']).toBe(2500);
    engine['recoveryRemainingMs'] = 0;
    engine['balls'] = [ball({ y: 700 })];
    engine['handleMissedBalls']();
    engine.quit();
    engine.resume();
    expect(callbacks.onContinueOffer).toHaveBeenCalledTimes(1);
    expect(callbacks.onGameOver).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('finalizes a declined continue without restarting frames', () => {
    callbacks.onContinueOffer = vi.fn();
    const engine = createEngine();
    engine.start();
    engine['lives'] = 1;
    engine['balls'] = [ball({ y: 700 })];
    engine['handleMissedBalls']();
    engine.declineContinue();
    expect(callbacks.onGameOver).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('increases streak score while preserving coin values, and resets after inactivity', () => {
    const engine = createEngine();
    for (let i = 0; i < 3; i++) engine['onBallHit'](ball());
    expect(engine['combo']).toBe(3);
    expect(engine['score']).toBe(BALL_TIERS.normal.maxHp * 8 * 4);
    expect(engine['coinsEarnedLocal']).toBe(3 * BALL_TIERS.normal.coinValue);
    engine['update'](3501);
    expect(engine['combo']).toBe(0);
  });

  it('awards each level bonus once and reports the next target', () => {
    const engine = createEngine();
    for (let i = 0; i < levelTarget(1); i++) engine['onBallHit'](ball());
    expect(engine['level']).toBe(2);
    expect(engine['coinsEarnedLocal']).toBe(levelTarget(1) + ECONOMY_CONFIG.levelCompleteCoins);
    expect(callbacks.onLevelChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(engine['ballsDestroyedInLevel']).toBe(0);
  });

  it('increases speed, health and spawn pressure as a run advances through twenty levels', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const engine = createEngine();
    const existing = ball({ hp: 4, vy: BALL_TIERS.normal.speed / 1000 });
    let previousSpeed = 0;
    let previousHealth = 0;
    let previousDelay = Infinity;
    let firstHealth = 0;
    engine['multiplierSpawnTimer'] = Infinity;

    for (let level = 1; level <= 20; level++) {
      expect(engine['level']).toBe(level);
      engine['balls'] = [existing];
      engine['spawnTimer'] = 0;
      let delay = 0;
      while (engine['balls'].length === 1 && delay < 2000) {
        engine['updateSpawning'](1);
        delay++;
      }
      const spawned = engine['balls'][1];
      expect(spawned.tier).toBe('normal');
      expect(spawned.vy).toBeGreaterThan(previousSpeed);
      expect(spawned.hp).toBeGreaterThanOrEqual(previousHealth);
      expect(delay).toBeLessThan(previousDelay);
      previousSpeed = spawned.vy;
      previousHealth = spawned.hp;
      previousDelay = delay;
      if (level === 1) firstHealth = spawned.hp;
      if (level < 20) {
        for (let clear = 0; clear < levelTarget(level); clear++) engine['onBallHit'](ball());
      }
    }

    expect(previousHealth).toBeGreaterThan(firstHealth);
    expect(callbacks.onLevelChange).toHaveBeenCalledTimes(19);
    expect(existing.hp).toBe(4);
    expect(existing.vy).toBe(BALL_TIERS.normal.speed / 1000);
  });

  it('introduces heavy balls at level two, bosses at three, and more tough balls later', () => {
    const random = vi.spyOn(Math, 'random');
    const mix = (level: number) => {
      const engine = createEngine(level);
      const counts = { normal: 0, fast: 0, heavy: 0, gold: 0, boss: 0, multiplier: 0 };
      // Sample the full random range reproducibly, including infrequent tiers.
      for (let sample = 0; sample < 200; sample++) {
        random.mockReturnValue((sample + 0.5) / 200);
        engine['balls'] = [];
        engine['spawnBall']();
        counts[engine['balls'][0].tier]++;
      }
      return counts;
    };
    const first = mix(1);
    const second = mix(2);
    const third = mix(3);
    const tenth = mix(10);
    const thirtieth = mix(30);
    expect(first.heavy + first.boss).toBe(0);
    expect(second.heavy).toBeGreaterThan(0);
    expect(second.boss).toBe(0);
    expect(third.boss).toBeGreaterThan(0);
    expect(tenth.heavy + tenth.boss).toBeGreaterThan(third.heavy + third.boss);
    expect(thirtieth.heavy + thirtieth.boss).toBeGreaterThan(tenth.heavy + tenth.boss);
  });

  it('keeps high-level speed and health bounded and split children easy to clear', () => {
    const random = vi.spyOn(Math, 'random');
    const engine = createEngine(1_000_000);
    for (let sample = 0; sample < 200; sample++) {
      random.mockReturnValue((sample + 0.5) / 200);
      engine['balls'] = [];
      engine['spawnBall']();
      const spawned = engine['balls'][0];
      if (spawned.tier === 'multiplier') throw new Error('Expected a regular ball');
      const tier = BALL_TIERS[spawned.tier];
      expect(spawned.hp).toBeLessThanOrEqual(Math.ceil(tier.maxHp * 1.4));
      expect(spawned.vy).toBeLessThanOrEqual(tier.speed * 1.75 / 1000);
    }
    engine['balls'] = [];
    engine['onBallHit'](ball({ tier: 'boss', maxHp: 26, y: 660 }));
    expect(engine['balls']).toHaveLength(2);
    expect(engine['balls'].every((child) => child.hp === 3
      && child.vy > BALL_TIERS.normal.speed / 1000 && child.y + child.radius < 700)).toBe(true);
  });

  it('throttles boost HUD updates to seconds and expires the boost', () => {
    const engine = createEngine();
    engine['onBallHit'](ball({ tier: 'multiplier' }));
    for (let i = 0; i < 600; i++) engine['updateMultiplier'](1000 / 60);
    engine['updateMultiplier'](1);
    expect(callbacks.onMultiplierChange).toHaveBeenCalledTimes(11);
    expect(callbacks.onMultiplierChange).toHaveBeenLastCalledWith(false, 0);
  });

  it('keeps split children above the danger line with manageable health', () => {
    const engine = createEngine();
    engine['onBallHit'](ball({ tier: 'boss', hp: 1, maxHp: 26, y: 660 }));
    expect(engine['balls']).toHaveLength(2);
    expect(engine['balls'].every((child) => child.y + child.radius < 700 && child.hp === 3)).toBe(true);
  });

  it('bounds spawned objects and reuses expired bullets and particles', () => {
    const engine = createEngine();
    for (let i = 0; i < 200; i++) {
      engine['spawnBall']();
      engine['spawnMultiplierOrb']();
      engine['spawnBullet']();
      engine['spawnParticles'](100, 100, '#fff', 12);
    }
    expect(engine['balls'].length).toBeLessThanOrEqual(28);
    expect(engine['bullets'].length).toBeLessThanOrEqual(80);
    expect(engine['particles'].length).toBeLessThanOrEqual(40);
    const bullets = new Set(engine['bullets']);
    const particles = new Set(engine['particles']);
    engine['updateBullets'](2000);
    engine['updateParticles'](1000);
    engine['spawnBullet']();
    engine['spawnParticles'](100, 100, '#fff', 12);
    expect(bullets.has(engine['bullets'][0])).toBe(true);
    expect(engine['particles'].every((particle) => particles.has(particle))).toBe(true);
  });

  it('caches ball gradients and skips canvas reallocation when dimensions are unchanged', () => {
    const engine = createEngine();
    engine['balls'] = [ball()];
    engine['render']();
    const radialCount = vi.mocked(ctx.createRadialGradient).mock.calls.length;
    const linearCount = vi.mocked(ctx.createLinearGradient).mock.calls.length;
    engine['render']();
    engine.resize();
    engine['render']();
    expect(ctx.createRadialGradient).toHaveBeenCalledTimes(radialCount);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(linearCount);
  });

  it('clamps dragging, ignores a second finger and stops input after destroy', () => {
    const engine = createEngine();
    engine.start();
    const pointer = (type: string, pointerId: number, clientX: number) => {
      canvas.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX }));
    };
    pointer('pointerdown', 1, 900);
    expect(engine['cannonTargetX']).toBe(324);
    pointer('pointerdown', 2, 10);
    pointer('pointermove', 2, 10);
    expect(engine['cannonTargetX']).toBe(324);
    pointer('pointercancel', 1, 900);
    pointer('pointerdown', 2, 10);
    expect(engine['cannonTargetX']).toBe(36);
    engine.destroy();
    pointer('pointermove', 2, 180);
    expect(engine['cannonTargetX']).toBe(36);
    expect(frames.size).toBe(0);
  });

  it('applies shot colors to bullets and impact sparks without changing damage', () => {
    const engine = createEngine();
    engine.setAppearance({ cannonColor: '#f97316', shotColor: '#fb7185', ballSkin: 'classic', effect: 'standard', theme: 'arcade' });
    engine['spawnBullet']();
    engine['renderBullets'](ctx);
    expect(ctx.fillStyle).toBe('#fb7185');
    const target = ball({ hp: 3 });
    engine['onBallHit'](target);
    expect(target.hp).toBe(2);
    expect(engine['particles'][0].color).toBe('#fb7185');
  });

  it('rebuilds skin artwork only when the selected skin changes', () => {
    const engine = createEngine();
    const target = ball();
    const original = engine['spriteForBall'](target);
    const appearance = { cannonColor: '#60a5fa', shotColor: '#e0f2fe', ballSkin: 'neon', effect: 'standard', theme: 'arcade' } as const;
    engine.setAppearance(appearance);
    const neon = engine['spriteForBall'](target);
    expect(neon).not.toBe(original);
    expect(ctx.stroke).toHaveBeenCalled();
    engine.setAppearance(appearance);
    expect(engine['spriteForBall'](target)).toBe(neon);
    engine.setAppearance({ ...appearance, ballSkin: 'galaxy' });
    engine['spriteForBall'](target);
    expect(ctx.ellipse).toHaveBeenCalled();
  });

  it('renders the trail effect in a batch and applies the crimson background', () => {
    const engine = createEngine();
    const background = engine['background'];
    engine.setAppearance({ cannonColor: '#60a5fa', shotColor: '#4ade80', ballSkin: 'classic', effect: 'trail', theme: 'crimson' });
    expect(engine['background']).not.toBe(background);
    engine['spawnBullet']();
    engine['renderBullets'](ctx);
    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
    expect(ctx.strokeStyle).toBe('#4ade8066');
  });

  it('increases destruction effects while keeping the existing particle cap', () => {
    const engine = createEngine();
    engine.setAppearance({ cannonColor: '#60a5fa', shotColor: '#e0f2fe', ballSkin: 'classic', effect: 'explosion', theme: 'arcade' });
    engine['onBallHit'](ball());
    expect(engine['particles']).toHaveLength(26);
    engine['onBallHit'](ball());
    expect(engine['particles']).toHaveLength(40);
  });

  it('keeps two minutes of simulated play bounded', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    const engine = createEngine(5);
    engine['lives'] = 1000;
    engine.start();
    frame(0);
    for (let i = 1; i <= 7200; i++) {
      engine['cannonTargetX'] = 36 + (i % 288);
      frame(i * 1000 / 60);
    }
    expect(engine['elapsedMs']).toBeCloseTo(120_000, 4);
    expect(engine['balls'].length).toBeLessThanOrEqual(28);
    expect(engine['bullets'].length).toBeLessThanOrEqual(80);
    expect(engine['particles'].length).toBeLessThanOrEqual(40);
    expect(engine['floatingTexts'].length).toBeLessThanOrEqual(6);
    expect(engine['ballSprites'].size).toBeLessThan(200);
    expect(frames.size).toBe(1);
  });
});
