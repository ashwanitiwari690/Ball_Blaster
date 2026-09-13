import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const STORAGE_KEY = 'bb.settings.v1';

export interface AppSettings {
  soundEnabled: boolean;
  musicEnabled: boolean;
  hapticsEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = { soundEnabled: true, musicEnabled: true, hapticsEnabled: true };

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as AppSettings) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly settings$ = new BehaviorSubject<AppSettings>(load());

  get view$(): Observable<AppSettings> {
    return this.settings$.asObservable();
  }

  get current(): AppSettings {
    return this.settings$.value;
  }

  update(partial: Partial<AppSettings>): void {
    const next = { ...this.settings$.value, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.settings$.next(next);
  }
}
