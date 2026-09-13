import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { AdvertisingId } from '@capacitor-community/advertising-id';
import { firstValueFrom } from 'rxjs';
import { APP_VERIFICATION_CONFIG } from '../config/app-verification.config';

interface AppVerificationConfirmData {
  status: string;
  rewardAmount: string;
}

interface ApiSuccessEnvelope {
  success: true;
  data: AppVerificationConfirmData;
}

/**
 * Confirms this device's Advertising ID to Earnivo so the App Promotion
 * reward for whichever Earnivo user started this campaign on this device
 * gets credited. See APP_PROMOTION_VERIFICATION_INTEGRATION.md for the full
 * flow. Meant to be called once on every app launch — it is a harmless no-op
 * whenever there is nothing pending to verify. Mirrors the integration
 * already shipped in this project's sibling Ionic games (Brain Rush, ...),
 * which share the same Earnivo backend.
 */
@Injectable({ providedIn: 'root' })
export class AppVerificationService {
  constructor(private http: HttpClient) {}

  async confirmAppPromotion(): Promise<void> {
    // Advertising IDs only exist on real devices, and there's nothing to
    // verify until a campaign key has been configured for this build.
    if (!Capacitor.isNativePlatform() || !APP_VERIFICATION_CONFIG.apiKey) return;

    try {
      if (Capacitor.getPlatform() === 'ios') {
        // Shows Apple's tracking-permission prompt; required before iOS will
        // report a non-zero IDFA.
        await AdvertisingId.requestTracking();
      }
      const { id } = await AdvertisingId.getAdvertisingId();
      if (!id) return;

      const result = await firstValueFrom(
        this.http.post<ApiSuccessEnvelope>(`${APP_VERIFICATION_CONFIG.apiBaseUrl}/confirm`, {
          apiKey: APP_VERIFICATION_CONFIG.apiKey,
          advertisingId: id,
        })
      );
      console.log('[app-verification] App Promotion reward credited.', result.data);
    } catch (error) {
      this.logOutcome(error);
    }
  }

  private logOutcome(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 422) {
        // Normal outcome whenever there's nothing pending to verify yet
        // (see the three scenarios in the integration doc) — not an error.
        console.debug('[app-verification] No pending verification for this device yet.');
        return;
      }
      if (error.status === 403) {
        console.error('[app-verification] Rejected by Earnivo — check APP_VERIFICATION_CONFIG.apiKey.');
        return;
      }
    }
    console.debug('[app-verification] Skipped:', error);
  }
}
