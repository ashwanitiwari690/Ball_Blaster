import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { REWARD_CONFIG } from '../config/reward.config';

/** Shape of the Central Game Reward API's /redeem success payload. */
export interface RedeemGameRewardData {
  gameCode: string;
  gameName: string;
  coinsSubmitted: number;
  coinsRedeemed: number;
  coinsPerConversion: number;
  rupeesPerConversion: number;
  /** Money string, e.g. "15.00" — backend is authoritative for this value. */
  amountCredited: string;
  transactionId: string;
  idempotencyKey: string;
  status: string;
  createdAt: string;
  newWalletBalance: string;
}

export interface RedeemApiError {
  errorCode: string;
  message: string;
}

interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
}
interface ApiErrorEnvelope {
  success: false;
  error: { code: string; message: string };
}

/**
 * Thin client for the Central Game Reward API
 * (nodejs/src/modules/games/game-rewards.routes.ts in the Earnivo Main
 * Platform backend, mounted at /api/game-rewards). This service does not
 * implement or own the API contract — it only calls it. Mirrors the
 * integration already shipped in this project's sibling Ionic games
 * (Brain Rush, Tic Rush, ...), which share the same backend.
 */
@Injectable({ providedIn: 'root' })
export class RewardApiService {
  constructor(private http: HttpClient) {}

  redeemCoins(mobileNumber: string, coins: number, idempotencyKey: string): Observable<RedeemGameRewardData> {
    const body = {
      gameCode: REWARD_CONFIG.gameCode,
      mobileNumber,
      coins,
      idempotencyKey,
    };
    return this.http.post<ApiSuccessEnvelope<RedeemGameRewardData>>(`${REWARD_CONFIG.apiBaseUrl}/redeem`, body).pipe(
      map((res) => res.data),
      catchError((error: HttpErrorResponse) => throwError(() => this.normalizeError(error)))
    );
  }

  private normalizeError(error: HttpErrorResponse): RedeemApiError {
    const body = error.error as Partial<ApiErrorEnvelope> | null;
    if (body?.error?.code) {
      return { errorCode: body.error.code, message: body.error.message || body.error.code };
    }
    if (error.status === 0) {
      return { errorCode: 'NETWORK_ERROR', message: 'Network error. Please check your connection and try again.' };
    }
    return { errorCode: 'UNKNOWN_ERROR', message: 'Something went wrong. Please try again.' };
  }
}
