import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { SettingsService } from './settings.service';
import { BallTier } from '../config/economy.config';

/**
 * All sound in Ball Blaster is synthesized with the Web Audio API rather
 * than loaded from audio files — this keeps the app self-contained (no
 * licensed/attributed assets to manage) and gives every effect an
 * arcade-appropriate retro-synth character.
 *
 * Uses a master DynamicsCompressorNode to boost perceived loudness, punch,
 * and clarity while preventing digital distortion or clipping.
 */
@Injectable({ providedIn: 'root' })
export class AudioService implements OnDestroy {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicStep = 0;
  private musicPlaying = false;
  private musicRequested = false;
  private musicPaused = false;
  private readonly settingsSub: Subscription;
  private activeVoices = 0;
  private readonly noiseBuffers = new Map<number, AudioBuffer>();

  private readonly normalMusicVolume = 0.62;
  constructor(private readonly settings: SettingsService) {
    this.settingsSub = settings.view$.subscribe(() => this.syncMusic());
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onVisibilityChange = (): void => {
    this.syncMusic();
    if (!this.ctx) return;
    if (document.hidden) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  };

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtor();

      // Master dynamics compressor to maximize loudness and punch cleanly
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-8, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(6, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(3.5, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.06, this.ctx.currentTime);
      this.compressor.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.sfxGain.connect(this.compressor);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.setValueAtTime(this.normalMusicVolume, this.ctx.currentTime);
      this.musicGain.connect(this.compressor);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /** Browsers block audio until a real user gesture — call this from the first tap anywhere. */
  unlock(): void {
    this.ensureContext();
  }

  // ---------------------------------------------------------------------
  // Low-level synth helpers
  // ---------------------------------------------------------------------
  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = 'square',
    gainValue = 0.6,
    delay = 0,
    sweepTo?: number
  ): void {
    if (document.hidden || !this.settings.current.soundEnabled || this.activeVoices >= 24) return;
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    const t0 = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainValue, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.sfxGain!);
    this.activeVoices++;
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      this.activeVoices--;
    };
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  private noiseBurst(duration: number, gainValue = 0.45, delay = 0): void {
    if (document.hidden || !this.settings.current.soundEnabled || this.activeVoices >= 24) return;
    const ctx = this.ensureContext();
    const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
    let buffer = this.noiseBuffers.get(size);
    if (!buffer) {
      buffer = ctx.createBuffer(1, size, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
      this.noiseBuffers.set(size, buffer);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    gain.gain.setValueAtTime(gainValue, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(gain).connect(this.sfxGain!);
    this.activeVoices++;
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      this.activeVoices--;
    };
    src.start(t0);
  }

  private arpeggio(freqs: number[], step: number, duration: number, type: OscillatorType, gainValue: number): void {
    freqs.forEach((f, i) => this.tone(f, duration, type, gainValue, i * step));
  }

  // ---------------------------------------------------------------------
  private lastShootTime = 0;
  shoot(): void {
    const now = performance.now();
    if (now - this.lastShootTime < 75) return;
    this.lastShootTime = now;
    this.tone(880, 0.035, 'square', 0.45, 0, 1500);
  }

  private lastHitTime = 0;
  ballHit(): void {
    const now = performance.now();
    if (now - this.lastHitTime < 40) return;
    this.lastHitTime = now;
    this.tone(250, 0.045, 'triangle', 0.42);
  }

  ballDestroyed(tier: BallTier): void {
    const base: Record<BallTier, number> = { normal: 440, fast: 520, heavy: 300, gold: 660, boss: 200 };
    this.tone(base[tier], 0.14, 'sawtooth', 0.7, 0, base[tier] * 2.2);
    this.noiseBurst(0.09, 0.38, 0.02);
  }

  coinEarned(): void {
    this.arpeggio([988, 1318], 0.065, 0.1, 'square', 0.6);
  }

  multiplierActivated(): void {
    this.arpeggio([660, 880, 1108, 1320], 0.075, 0.13, 'square', 0.65);
  }

  lifeLost(): void {
    this.tone(220, 0.32, 'sawtooth', 0.65, 0, 55);
  }

  gameOver(): void {
    this.arpeggio([392, 330, 262, 196], 0.18, 0.25, 'triangle', 0.65);
  }

  levelComplete(): void {
    this.arpeggio([523, 659, 784, 1047], 0.095, 0.17, 'square', 0.7);
  }

  // ---------------------------------------------------------------------
  // UI SFX
  // ---------------------------------------------------------------------
  buttonTap(): void {
    this.tone(700, 0.035, 'square', 0.35);
  }

  purchaseSuccess(): void {
    this.arpeggio([523, 659, 784], 0.08, 0.1, 'square', 0.55);
  }

  purchaseFailed(): void {
    this.tone(180, 0.18, 'sawtooth', 0.45, 0, 90);
  }

  claimReward(): void {
    this.arpeggio([659, 784, 988, 1318], 0.09, 0.14, 'square', 0.65);
  }

  redeemRequested(): void {
    this.tone(523, 0.16, 'sine', 0.55);
  }

  // ---------------------------------------------------------------------
  // Background music: rich generative arcade loop with boosted levels
  // ---------------------------------------------------------------------
  private readonly bassline = [110, 110, 146.83, 110, 130.81, 130.81, 164.81, 130.81];
  private readonly lead = [440, 554.37, 659.25, 554.37];

  startMusic(): void {
    this.musicRequested = true;
    this.musicPaused = false;
    this.syncMusic();
  }

  private syncMusic(): void {
    if (!this.musicRequested || this.musicPaused || !this.settings.current.musicEnabled || document.hidden) {
      this.stopMusicLoop();
      if (this.musicGain && this.ctx) this.musicGain.gain.setValueAtTime(0, this.ctx.currentTime);
      return;
    }
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.ensureContext();
    this.musicGain!.gain.setValueAtTime(this.normalMusicVolume, this.ctx!.currentTime);
    const stepDuration = 0.22;
    const scheduleStep = () => {
      if (!this.musicPlaying) return;
      if (this.settings.current.musicEnabled) {
        const bassFreq = this.bassline[this.musicStep % this.bassline.length];
        const leadFreq = this.lead[this.musicStep % this.lead.length];
        // Boosted punchy bass and bright melodic lead
        this.musicTone(bassFreq, stepDuration * 0.9, 'triangle', 0.75);
        this.musicTone(leadFreq, stepDuration * 0.45, 'square', 0.32, stepDuration * 0.05);
      }
      this.musicStep++;
      this.musicTimer = setTimeout(scheduleStep, stepDuration * 1000);
    };
    scheduleStep();
  }

  stopMusic(): void {
    this.musicRequested = false;
    this.stopMusicLoop();
  }

  private stopMusicLoop(): void {
    this.musicPlaying = false;
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }

  pauseMusic(): void {
    this.musicPaused = true;
    this.syncMusic();
  }

  resumeMusic(): void {
    this.musicRequested = true;
    this.musicPaused = false;
    this.syncMusic();
  }

  ngOnDestroy(): void {
    this.stopMusic();
    this.settingsSub.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private musicTone(freq: number, duration: number, type: OscillatorType, gainValue: number, delay = 0): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    const t0 = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainValue, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.musicGain!);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }
}
