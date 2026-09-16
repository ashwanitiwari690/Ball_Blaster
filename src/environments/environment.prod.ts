export const environment = {
  production: true,
  // TODO: set the real deployed Earnivo backend URL before shipping a
  // production build. This is a placeholder — the actual production domain
  // has not been decided yet (matches the sibling game projects' state).
  apiBaseUrl: 'https://api.admobility.in/api/game-rewards',
  appVerificationApiUrl: 'https://api.admobility.in/api/app-verification',
  // TODO: paste the API key shown for this game's App Promotion campaign in
  // the Earnivo agent panel. Leave blank to skip the install-verification
  // call entirely.
  appVerificationApiKey: 'ak_2a1a85007b775d98af6e4b4e5d72b0cb76aaac68f55cbfa7'
};
