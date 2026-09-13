import { environment } from '../../../environments/environment';
import { ECONOMY_CONFIG } from './economy.config';

/**
 * Single source of truth for this game's identity and redemption rules on
 * the Central Game Reward API (the same shared Earnivo backend this
 * project's sibling Ionic games integrate with). Do not hardcode the game
 * code anywhere else — import it from here.
 */
export const REWARD_CONFIG = {
  /** Registered with the Earnivo backend as this game's identity — must match a Game.code row there before /redeem will accept requests for it. */
  gameCode: 'BALL_BLASTER',
  /**
   * Base URL of the Central Game Reward API's game-rewards router, sourced
   * from the environment file so `ng build --configuration production`
   * swaps in the deployed backend URL via Angular's fileReplacements.
   */
  apiBaseUrl: environment.apiBaseUrl,
  // The backend is authoritative and re-validates this on every request; it
  // is only mirrored here (from the same constant the rest of the app's UI
  // gating uses) so the client can decide when to even show the Redeem
  // button without a round trip.
  minRedeemCoins: ECONOMY_CONFIG.minRedemptionCoins,
} as const;
