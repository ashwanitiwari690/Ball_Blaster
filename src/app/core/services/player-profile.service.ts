import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const STORAGE_KEY = 'bb.profile.v1';

export interface PlayerProfile {
  name: string;
  gamesPlayed: number;
  highScore: number;
  /** Highest in-game level ever reached across all runs — new games start here instead of always at level 1. */
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

  get view$(): Observable<PlayerProfile & { level: number }> {
    return new Observable((subscriber) => {
      const sub = this.profile$.subscribe((p) => subscriber.next({ ...p, level: 1 + Math.floor(p.gamesPlayed / 5) }));
      return () => sub.unsubscribe();
    });
  }

  get current(): PlayerProfile {
    return this.profile$.value;
  }

  private persist(next: PlayerProfile): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.profile$.next(next);
  }

  recordGameFinished(score: number): void {
    const current = this.profile$.value;
    this.persist({
      ...current,
      gamesPlayed: current.gamesPlayed + 1,
      highScore: Math.max(current.highScore, score),
    });
  }

  /** Raises the saved starting level for future runs if this run reached further than any before it. Never lowers it. */
  recordLevelReached(level: number): void {
    const current = this.profile$.value;
    const highestLevel = Math.max(current.highestLevel, Math.floor(level) || 1);
    if (highestLevel === current.highestLevel) return;
    this.persist({ ...current, highestLevel });
  }

  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.profile$.next(load());
  }
}
