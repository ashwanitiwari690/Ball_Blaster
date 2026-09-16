// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  /**
   * Base URL of the Central Game Reward API's game-rewards router, the same
   * shared Earnivo backend this project's sibling Ionic games (Brain Rush,
   * Tic Rush, ...) integrate with — see reward.config.ts. Assumes that
   * backend is running locally on its conventional port during development.
   */
  apiBaseUrl: 'https://api.admobility.in/api/game-rewards',
  // Same backend, its app-verification router — see app-verification.config.ts.
  appVerificationApiUrl: 'https://api.admobility.in/api/app-verification',
  // TODO: paste the API key shown for this game's App Promotion campaign in
  // the Earnivo agent panel. Leave blank to skip the install-verification
  // call entirely.
  appVerificationApiKey: 'ak_2a1a85007b775d98af6e4b4e5d72b0cb76aaac68f55cbfa7'
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
