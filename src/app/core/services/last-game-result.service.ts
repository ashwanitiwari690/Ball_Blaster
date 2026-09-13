import { Injectable } from '@angular/core';
import { RewardOutcome } from '../models/game.models';

export interface LastGameSummary {
  sessionId: string;
  score: number;
  ballsDestroyed: number;
  levelReached: number;
  outcome: RewardOutcome;
}

/**
 * A tiny in-memory handoff between GamePage and GameOverPage. Kept out of
 * the URL/router-state to avoid serializing the full wallet snapshot, and
 * out of localStorage because it is not meaningful once the app restarts.
 */
@Injectable({ providedIn: 'root' })
export class LastGameResultService {
  private value: LastGameSummary | null = null;

  set(summary: LastGameSummary): void {
    this.value = summary;
  }

  consume(): LastGameSummary | null {
    const v = this.value;
    this.value = null;
    return v;
  }
}
