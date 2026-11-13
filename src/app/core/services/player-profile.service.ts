import { Injectable } from '@angular/core';
import { BehaviorSubject, map, shareReplay } from 'rxjs';

const STORAGE_KEY = 'bb.profile.v1';

export interface PlayerProfile {
  name: string;
  gamesPlayed: number;
  highScore: number;
  /** Highest in-game level ever reached across all runs. */
  highestLevel: number;
}

const DEFAULT_PROFILE: PlayerProfile = { name: 'Player123', gamesPlayed: 0, highScore: 0, highestLevel: 1 };

function load(): PlayerProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as PlayerProfile) } : { ...DEFAULT_PROFILE };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

@Injectable({ providedIn: 'root' })
export class PlayerProfileService {
  private readonly profile$ = new BehaviorSubject<PlayerProfile>(load());

  readonly view$ = this.profile$.pipe(
    map((profile) => ({ ...profile, level: 1 + Math.floor(profile.gamesPlayed / 5) })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private persist(next: PlayerProfile): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.profile$.next(next);
  }

  recordGameFinished(score: number, levelReached = 1): void {
    const current = this.profile$.value;
    this.persist({
      ...current,
      gamesPlayed: current.gamesPlayed + 1,
      highScore: Math.max(current.highScore, score),
      highestLevel: Math.max(current.highestLevel, Math.floor(levelReached) || 1),
    });
  }

  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.profile$.next(load());
  }
}
