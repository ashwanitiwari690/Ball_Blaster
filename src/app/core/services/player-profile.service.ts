import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const STORAGE_KEY = 'bb.profile.v1';

export interface PlayerProfile {
  name: string;
  gamesPlayed: number;
  highScore: number;
}

const DEFAULT_PROFILE: PlayerProfile = { name: 'Player123', gamesPlayed: 0, highScore: 0 };

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

  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.profile$.next(load());
  }
}
