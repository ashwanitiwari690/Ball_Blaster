import { environment } from '../../../environments/environment';

/**
 * Single source of truth for this game's Earnivo App Promotion verification
 * campaign. Do not hardcode the API key or host anywhere else — import them
 * from here. See APP_PROMOTION_VERIFICATION_INTEGRATION.md for the full flow.
 */
export const APP_VERIFICATION_CONFIG = {
  /**
   * Base URL of Earnivo's app-verification router, mounted at
   * /api/app-verification on the same Central Game Reward API backend this
   * game's reward.config.ts already points at. Sourced from the environment
   * file so `ng build --configuration production` swaps in the deployed
   * Earnivo URL via Angular's fileReplacements.
   */
  apiBaseUrl: environment.appVerificationApiUrl,
  // Shown on this campaign in the Earnivo agent panel. Left blank until set,
  // which makes confirmAppPromotion() a no-op — see app-verification.service.ts.
  apiKey: environment.appVerificationApiKey,
} as const;
