# Ball Blaster — Frontend Prototype

An Angular + Ionic arcade game where destroying balls earns coins that can be
redeemed for INR. **Gameplay, wallet, shop, and daily rewards are still
frontend-only** — coins live in `localStorage`, not a database. **Redemption
is the one exception**: it calls a real backend, the shared Earnivo Central
Game Reward API, the same one used by this game's sibling Ionic titles (see
"Redemption — real API integration" below). No real money moves through any
other part of the app.

## Running it

```bash
npm install
ionic serve        # or: ng serve
```

To run on Android (ads only ever render natively — see the AdMob section below):

```bash
ng build
npx cap sync android
npx cap open android   # opens Android Studio; needs Android SDK/Gradle installed
```

## AdMob ads + offline gate

Implemented per `ADMOB_AND_OFFLINE_GATE_GUIDE.md`, adapted to this app's
actual installed plugin version (`@capacitor-community/admob@8.1.0` — its
API differs slightly from the guide's, e.g. `showRewardVideoAd()` resolves
with the earned reward item directly) and to running zoneless (see the
section below — every new bit of ad-driven UI state uses a `signal()`).

**Where ads were added, and what format:**

| Location | Format | Why |
|---|---|---|
| Wallet → "Watch Ad for +5 Coins" | Rewarded | Direct coin-earning placement, capped `maxAdRewardsPerDay`/day |
| Game Over → "Watch Ad to 2x Coins Earned" | Rewarded | Doubles *this run's* coins, once per session |
| Daily Rewards → "Watch Ad to Double" (after claiming) | Rewarded | Doubles today's already-claimed login reward, once per day |
| Game → "OUT OF LIVES — Watch Ad to Continue" | Rewarded | One extra life per run, offered exactly once when lives hit 0 |
| Shop / Cannon Details → tapping an item you can't afford | Rewarded | "Watch Ad for Coins" button inside the insufficient-funds toast — reuses the same capped Wallet ad, not a new uncapped channel |
| Game Over → tapping Play Again / Home | Interstitial | Frequency-capped (`INTERSTITIAL_EVERY_N_ROUNDS`, currently every 2 runs) so it doesn't fire after every single game |
| Home → "PLAY NOW" | Interstitial | Shown at the Home→Game breakpoint, every tap (not frequency-capped — this transition doesn't repeat rapidly the way the Game Over replay loop does, since "Play Again" from Game Over skips Home entirely) |
| Every screen except live gameplay | Banner | Persistent, bottom-anchored (`AdmobService.showBanner()`/`hideBanner()`, toggled by `AppComponent` on route change); hidden on the Game page so it never overlaps the cannon's drag area, and hidden outright while offline |

Deliberately **not** added: an ad gate on daily login claim, shop browsing, or
between every navigation — the goal was real, opt-in engagement points, not
an ad on every tap.

**Banner ad, and how content avoids it.** `AppComponent`'s constructor runs an
`effect()` that calls `admob.showBanner()`/`hideBanner()` whenever the current
route or `ConnectivityService.online()` changes — shown everywhere except the
Game page, hidden while offline (the banner is a native overlay, so the
offline gate's router-outlet swap can't hide it on its own). The banner's
*actual* rendered height comes back live via the plugin's `SizeChanged` event
and is written to a `--ad-banner-space` CSS custom property
(`AdmobService.setBannerSpace()`), which `.bb-bottom-nav`'s `bottom` offset
and `.bb-bottom-nav-spacer`'s height both read — so the bottom nav and the
scrollable content beneath it shift up to make room instead of getting
covered, without either hardcoding a fixed banner height.

**How rewarded coins/rewards are handled:**

`AdmobService.showRewarded()` (`core/services/admob.service.ts`) is the only
method in the app allowed to resolve a rewarded ad as watched. It resolves
`true` **only** when the ad SDK actually reports the reward was earned —
never on the button tap, the ad merely starting, or a dismiss before
completion — and it serializes itself (a `rewardedShowing` guard), so no two
rewarded placements anywhere in the app can show or resolve at once, and a
double-tap can't double-trigger anything. Every caller (`AdsService` for
Wallet/Shop coins, `GameOverPage` for double-coins, `DailyRewardsService`/
`DailyRewardsPage` for the daily double, `GamePage` for the continue) then
does its **own** idempotent credit through `WalletRepositoryPort`, each with
a unique, event-scoped `referenceId` (e.g. `ad-double-${sessionId}`,
`daily-double-${today}`) — so even if a credit call somehow ran twice, the
ledger's own duplicate-reference guard (spec section 11) stops it being
granted twice. Coin *amounts* always come from `ECONOMY_CONFIG`
(`rewardedAdCoins`, or the run's/day's own already-computed coin total for
the "double" placements) — the AdMob layer never hardcodes a coin value or
an INR conversion, per the brief.

On the web (during this dev session — AdMob never runs outside a native
build), `showRewarded()` resolves via a 1.5s simulated delay instead of
failing outright, purely so every placement above stayed testable from a
browser. That path is unreachable in a real native build
(`Capacitor.isNativePlatform()` gates it).

**Where the test IDs are configured:** `src/app/core/config/admob.config.ts`
(`AD_UNIT_IDS.banner` / `.interstitial` / `.rewarded`) — all three are
Google's official public test ad unit IDs. The native AdMob **App ID** is
separate and lives in `android/app/src/main/res/values/strings.xml`
(`admob_app_id`), currently set to Google's public **test** App ID
(`ca-app-pub-3940256099942544~3347511713`), referenced from
`AndroidManifest.xml`.

**`android/` isn't committed to git** (see `.gitignore`), so `cap add android`
regenerates it from a blank template — wiping the hand-edited `admob_app_id`
string and manifest meta-data above. `npm run android:add` (`cap add android
&& node scripts/setup-admob-android.js`) re-applies both automatically after
a fresh add; running `scripts/setup-admob-android.js` again on an
already-configured `android/` is a safe no-op (it checks before writing).

**Switching to production IDs:**
1. In the AdMob console, add this app and create real ad units for banner,
   interstitial, and rewarded.
2. Replace the three values in `admob.config.ts` with those ad unit IDs.
3. Replace `admob_app_id` in `strings.xml` with the app's real App ID from
   the same console listing, and update `AndroidManifest.xml`'s reference
   only if you rename the string.
4. Remove `initializeForTesting: true` from the `AdMob.initialize(...)` call
   in `AdmobService.initialize()`.
5. Add a GDPR/UMP consent flow before requesting ads if the app will have
   EU/UK users — not implemented here, required before a public launch there.
6. `npx cap sync android` and rebuild.

Nothing else needs to change — every page reads ad unit IDs through
`admob.config.ts` and shows/credits ads only through `AdmobService`/
`AdsService`, never by calling the plugin directly.

**What I could verify vs. couldn't, in this environment:** this sandbox has
no Java/Gradle/Android SDK and no device or emulator, so I could not build
or run an actual APK to visually confirm a test ad renders on-device. What
*is* done and verified: the native Android platform is scaffolded
(`npx cap add android`), the plugin is registered and synced
(`npx cap sync android` succeeds and lists `@capacitor-community/admob`),
the manifest/strings changes are in place, the plugin's real installed API
surface was read directly from its `.d.ts` files (not assumed from the
guide) to make sure every call matches, and every ad-gated flow's
*application logic* (idempotent crediting, re-entrancy guards, UI state
transitions, the offline gate) was verified end-to-end in a real browser
with Playwright. **Before shipping, actually build and run this on a device
or emulator** to confirm the native ad views themselves render — that step
needs a real Android toolchain this session didn't have access to.

### Offline gate

`ConnectivityService` (`core/services/connectivity.service.ts`) tracks
`navigator.onLine` plus the `online`/`offline` window events, exposed as a
signal. `AppComponent` swaps the entire `<ion-router-outlet>` for a
full-screen "NO INTERNET CONNECTION" card whenever it's false — gameplay
(and everything else) is blocked outright rather than letting anything run
that was never going to be backed by an actual ad request. Reconnecting
restores the same route automatically; "TRY AGAIN" is a manual fallback for
the rare case a resume-from-background doesn't fire a fresh browser event.
The offline card's icon is a hand-drawn inline SVG rather than `ion-icon` —
`ion-icon` fetches its glyph over the network, which doesn't work on the one
screen whose entire point is that there isn't any.

### A zoneless note specific to the ad work

Every new ad-driven loading/result state (`WalletPage.watchingAd`,
`GameOverPage.doublingCoins`/`doubledCoins`, `DailyRewardsPage.doubling`,
`GamePage.showContinuePrompt`/`continueAdLoading`/`continueSecondsLeft`,
`ConnectivityService.online`) is a `signal()`, not a plain field, for the
same reason described below: it changes from inside an `await
admobService.showRewarded()` continuation, which this app's zoneless change
detection cannot see on its own.

## What "frontend-only" means here

The full spec this app is built against (see project notes) is built around
one non-negotiable rule: **the server is the source of truth for coins, the
client is presentation + gameplay input only.** A pure frontend build cannot
honor that rule for real money — so this prototype deliberately keeps every
coin-related feature *visually and functionally complete*, while making it
structurally impossible to confuse with a production money system:

- The authoritative coin *balance* lives in `localStorage`, not a server
  database — coins are earned, spent, and tracked entirely on-device.
- Every wallet-facing screen shows a "prototype build" banner explaining this.
- **Redemption is the exception**: it calls the real Earnivo Central Game
  Reward API and only debits the local balance once that backend confirms
  the payout (see "Redemption — real API integration" below) — so the
  coins-to-INR step is genuinely backend-verified, even though coin-earning
  itself is not.
- Shop purchases spend already-earned reward coins (a one-way sink); no
  real-money purchase path exists, so there's nothing to launder into cash.

## Architecture: built to swap in a real backend later

Every coin-related read/write goes through a **port** (an abstract class
used as a DI token), never directly through storage. The one adapter that
exists today is local-storage-backed, but the UI layer never talks to it
directly — it talks to the port.

```
src/app/core/
  ports/
    wallet-repository.port.ts  <- WalletRepositoryPort (abstract)
  adapters/
    local-wallet-repository.ts <- LocalWalletRepository (NOT SECURE)
  services/
    wallet.service.ts          <- UI-facing facade; deliberately has NO addCoins()
    game-reward.service.ts     <- mirrors POST /game/session/start|complete
    redemption.service.ts      <- validates a mobile number + calls the real reward API
    reward-api.service.ts      <- HttpClient wrapper for the real Earnivo redeem endpoint
    ads.service.ts             <- mirrors a rewarded-ad reward endpoint
    daily-rewards.service.ts   <- 7-day login streak
    shop.service.ts            <- cosmetic purchases (spends reward coins)
    player-profile.service.ts
    settings.service.ts
  game-engine/
    ball-blaster-engine.ts     <- pure Canvas/TS game loop, zero Angular deps
  config/
    economy.config.ts          <- mirrors the backend's admin-configurable values
```

**To connect a real backend later:** write an `ApiWalletRepository` class
implementing `WalletRepositoryPort` (calling your Node.js endpoints instead
of `localStorage`), then change one line in `app.module.ts`'s `providers`
array. No page or component needs to change, because none of them depend on
the concrete adapter — only the port. Coins and gameplay still work this way
today; **redemption already went through this exact swap** — see
"Redemption — real API integration" below.

Same story for `economy.config.ts`: today it's a static object; in
production every value in it (`ballTiers`, `dailyGameplayCoinCap`,
`minRedemptionCoins`, `rewardedAdCoins`, ...) should come from a
`GET /config/economy` call instead, exactly as the spec's "admin config"
requirements describe. Note there is deliberately no coin-to-INR conversion
rate configured anywhere on the client — that number is computed
server-side by the real redemption API, never locally.

## Gameplay

`BallBlasterEngine` (`core/game-engine/ball-blaster-engine.ts`) is a
dependency-free Canvas 2D game loop:

- Cannon auto-fires upward continuously; drag/touch moves it horizontally.
- Balls fall from the top with a tier (`normal` / `fast` / `heavy` / `gold`
  / `boss`), each with its own color, speed, HP, and coin value, all defined
  in `economy.config.ts`.
- Heavy/boss balls split into two smaller balls on destruction.
- A rare "x2" power orb grants a temporary score/coin multiplier.
- 3 lives; a ball reaching the bottom uncaught costs one life.
- **Levels**: a single run advances through levels rather than staying one
  flat difficulty. Level *N* completes once `10 + (N-1) * 5` balls have been
  destroyed in it (`levelTarget()` in `economy.config.ts`); each completed
  level pays a flat +10 coin bonus and nudges spawn rate/tier mix harder
  (`pickWeightedTier()` / the spawn-interval math in `updateSpawning()`).
  The current level and a "LEVEL N" banner are shown live during play.
- **Level progress persists across runs.** `PlayerProfileService` tracks
  `highestLevel` — the furthest level ever reached, across every run, on
  this device — in `bb.profile.v1`. A brand-new game always starts at that
  saved level (`GamePage.ngAfterViewInit()` reads it and passes it to the
  engine's `startLevel` constructor param) instead of always resetting to
  level 1, and it's raised (never lowered) via
  `PlayerProfileService.recordLevelReached()` whenever a run ends — whether
  by losing all lives or by Quit & Cash Out — at whatever level was reached,
  even if no *new* level completed that run. Settings → "Reset Level" (Danger
  Zone) is the only thing that puts it back to 1, and it does not touch the
  coin balance.
- The engine never touches the network or the wallet. It reports a plain
  result object (`EngineResult`) to `GamePage`, which hands it to
  `GameRewardService`.

**Anti-cheat pattern preserved even without a server:** `GameRewardService`
does *not* trust a `coinsEarned` total from the engine. It recomputes the
reward strictly from `destroyedByTier` counts × the configured coin value
per tier, runs a plausibility check (balls-destroyed-per-second vs. run
duration), and enforces the daily gameplay coin cap — the same shape of
validation a real `POST /game/session/complete` handler would perform
server-side.

## Coin economy (current defaults, see `economy.config.ts`)

| Tier    | Coin value | HP range |
|---------|-----------|----------|
| Normal  | 1         | 3–6      |
| Fast    | 2         | 4–7      |
| Heavy   | 3         | 9–14     |
| Gold    | 5         | 5–8      |
| Boss    | 10        | 22–30    |

- Daily gameplay coin cap: **150**
- Rewarded ad: **+5 coins**, max **5/day**
- Daily login streak (days 1–7): 2, 3, 5, 5, 10, 10, 20
- Level completion bonus: **+10 coins/level** (level 1 = 10 balls, +5 balls per level after)
- Minimum redemption: **1000 coins** (redeems the full balance — no coin-to-INR rate is configured client-side; the real redemption API owns that conversion)

## Ledger discipline (even locally)

`LocalWalletRepository` keeps a full transaction log (`CoinTransaction[]`),
not just a balance — every credit/debit carries `balanceBefore`/
`balanceAfter`, a `type`, a `source`, and a `referenceId`. Idempotency is
enforced by refusing to credit the same `referenceId` twice (so a duplicate
`game-session-complete` call, a duplicate ad-reward call, or a double-tapped
daily-reward claim cannot double-credit). The daily gameplay coin cap and
today's-earnings figure are both derived by filtering this log, not separate
counters that could drift out of sync.

## Wallet & redemption — kept intentionally minimal

The Wallet page shows exactly one thing prominently: **the coins the player
currently owns**. No transaction history list, no today/lifetime stat
breakdown, no coin-to-INR estimate — the "Wallet Transactions" and
"Redemption History" pages from an earlier pass were removed outright, not
just hidden, since the whole point of this pass was to stop displaying and
tracking data beyond the current balance.

**What's still kept internally, and why:** `LocalWalletRepository` still
keeps its transaction log — that's what makes idempotent crediting and the
daily gameplay coin cap possible at all (see "Ledger discipline" above), and
both of those are core to the anti-cheat design this whole app is built
around, not just UI polish. Removing the ledger would mean removing that
protection too. What changed is purely what's *rendered*: the log is never
shown to the player anywhere now, and `WalletSnapshot` itself dropped the
fields nothing displays any more (`pendingCoins`, `lockedCoins`,
`monthEarned`, `lifetimeRedeemed`) rather than just hiding them in a
template.

**Redemption, redesigned:** the old flow let the player pick a preset coin
amount and see a locally-computed INR estimate. Now: the Redeem button only
appears on the Wallet page once the balance reaches
`ECONOMY_CONFIG.minRedemptionCoins` (1,000 by default); tapping it opens a
single "payout mobile number" field (exactly 10 digits — anything typed is
filtered to digits-only and capped at 10 characters as you type, so an
invalid or negative-looking value can't be entered at all); submitting
always redeems the *entire* current balance to that number, since there's
no amount picker any more.

## Redemption — real API integration

Unlike the rest of the coin economy, redemption is **not** a local stub —
`RedemptionService.redeem(mobileNumber, coins)` calls a real backend, the
same shared "Central Game Reward API" used by this game's sibling Ionic
titles (referenced from `E:\Ionic Game\Brain-Rush-ionic-`, which already had
this wired up and working). The wallet balance is **only ever debited after
the backend confirms the redemption** — never optimistically, and never by
more than what the backend actually reports as `coinsRedeemed`.

- **Contract**: `POST {apiBaseUrl}/redeem` with
  `{ gameCode, mobileNumber, coins, idempotencyKey }`. Success returns
  `{ success: true, data: RedeemGameRewardData }` (includes `coinsRedeemed`,
  `amountCredited`, `transactionId`, `status`); failure returns
  `{ success: false, error: { code, message } }`. See
  `src/app/core/services/reward-api.service.ts` for the exact types.
- **`apiBaseUrl`** is environment-based
  (`src/environments/environment.ts` for dev, `environment.prod.ts` for
  prod) — currently `http://localhost:4227/api/game-rewards` in dev,
  matching the same local convention the sibling games use, and a
  placeholder production URL (`https://api.earnivo.app/api/game-rewards`)
  copied from the reference app that **you must confirm/replace** before a
  real prod build.
- **`gameCode: 'BALL_BLASTER'`** (`src/app/core/config/reward.config.ts`) is
  this game's identity on the shared backend. **This game must be registered
  under that code in the Earnivo backend before real redemption requests
  will succeed** — that registration step lives on the backend/admin side,
  outside this repo.
- **Idempotency**: a key is generated once per distinct `(coins,
  mobileNumber)` pair and persisted in `localStorage`
  (`bb.redeem-idempotency.v1`) so a retry after a dropped response, a page
  reload, or a double-tap reuses the same key rather than risking a double
  payout. The key is only cleared after a confirmed success. If the backend
  ever returns the same key it already processed, it responds with the
  `DUPLICATE_CONVERSION` error code, which the Redeem page shows as "This
  redemption was already processed for this number" and disables the submit
  button for — verified end-to-end against a mock server standing in for the
  real API.
- **Failure handling**: a network error, a non-`DUPLICATE_CONVERSION` error
  code, or the backend being unreachable all surface a generic "Something
  went wrong, please try again" message rather than crashing or silently
  losing the request — the coin balance is untouched in every failure case,
  by construction (nothing debits it before a confirmed success response).

Wiring a different backend later is the same one-method change described in
"Architecture" above — everything else (idempotency, UI state machine,
error handling) is backend-agnostic.

## App Promotion verification (Earnivo)

Ball Blaster can itself be the app an Earnivo user is paid to install and
open — the "App Promotion" reward flow described in
`APP_PROMOTION_VERIFICATION_INTEGRATION.md`. From this game's side, that flow
requires exactly one thing: on every app launch, read this device's
Advertising ID (GAID on Android) and hand it to Earnivo along with this
campaign's API key, so Earnivo can match it against whichever Earnivo user
started the task on this same phone and credit their reward. This mirrors
the integration already shipped in the sibling Ionic game
(`E:\Ionic Game\Brain-Rush-ionic-`), which uses the identical service.

- **`AppVerificationService.confirmAppPromotion()`**
  (`src/app/core/services/app-verification.service.ts`) is called once from
  `AppComponent.ngOnInit()`, fire-and-forget, alongside `admob.initialize()`.
  It reads the device's Advertising ID via
  `@capacitor-community/advertising-id` and calls
  `POST {apiVerificationBaseUrl}/confirm` with `{ apiKey, advertisingId }`.
- **No-op by design** whenever there's nothing to do: on the web
  (`Capacitor.isNativePlatform()` is false, since Advertising IDs only exist
  on real devices), or whenever `appVerificationApiKey` is blank in the
  environment file (see below) — so this is always safe to leave wired up
  even before a campaign exists.
- **`appVerificationApiKey`** (`src/environments/environment.ts` /
  `environment.prod.ts`) is currently **left blank** — it must be filled in
  with the API key Earnivo generates for this game's specific App Promotion
  campaign (shown on that campaign's detail page in the agent panel) before
  this feature does anything. Until then the call above never fires.
- **`appVerificationApiUrl`** points at the same Central Game Reward API host
  as `apiBaseUrl` above, just the `/api/app-verification` router instead of
  `/api/game-rewards` — `http://localhost:4227/api/app-verification` in dev,
  and the same placeholder production host that **you must confirm/replace**
  before a real prod build.
- **Response handling**: a `422` (nothing pending to verify for this device
  yet) is the expected, normal response and is logged at `debug` level, not
  treated as an error; a `403` (wrong/unknown API key) is logged as an error
  since it means `appVerificationApiKey` is misconfigured; any other failure
  is swallowed silently — this call must never surface an error to the
  player or block anything else in the app.
- **No UI for this at all.** Unlike redemption, there is nothing for the
  player to tap, watch, or see — Ball Blaster is the *promoted* app in this
  flow, not the app tracking a "waiting for verification" task. The whole
  feature is this one background call on launch.
- **iOS note**: not applicable yet — this project currently only ships an
  Android build (no `ios/` platform added). If iOS is added later,
  `AdvertisingId.requestTracking()` (already called for the iOS platform
  branch in the service) will trigger Apple's tracking-permission prompt
  before it can read a non-zero IDFA, same as the reference app.

## Important: this app runs zoneless — read before touching GamePage

`angular.json`'s `polyfills` array is empty and `zone.js` isn't a
dependency, so this app has **no zone.js**. In a normal (zone-based)
Angular app, patched async APIs (`setTimeout`, `requestAnimationFrame`,
DOM events, Promises) automatically trigger change detection no matter
where they're called from. Without zone.js, Angular only re-renders a
component when one of these actually happens:

1. A value bound through `AsyncPipe` (`observable$ | async`) emits —
   `AsyncPipe` calls `markForCheck()` itself, so this always works.
2. An event bound directly in an Angular template (`(click)="..."`,
   `(ionChange)="..."`) fires — Angular's own `Renderer2` event
   delegation always triggers a check afterward.
3. A `signal()` that a template reads is written to.

A plain class field (`score = 0`) mutated from inside a raw
`requestAnimationFrame` callback, a raw `setTimeout`, or an RxJS
`.subscribe()` callback satisfies **none** of the above — the field
changes, but the view never re-renders, and the bug is silent (no
console error, the component's own state is correct if you inspect it,
only the DOM is stale). This exact bug shipped once already: the
in-game score/coin HUD, the level-up banner, the Game Over "reward
processing → confirmed" transition, and the Wallet page's "Watch Ad"
button were all stuck because of it, and were only caught by comparing
the live DOM text against the engine/component's actual internal state
in a real browser — `ng build` and casual visual testing both missed it
completely, since the component logic itself was correct.

**The fix, and the rule for any new code here:** any state that a
template reads and that changes from outside an Angular-bound event —
game engine callbacks, `setTimeout`, or an RxJS `.subscribe()` callback
whose source might resolve asynchronously — must be a `signal()`, not a
plain field. See `GamePage`, `GameOverPage`, `WalletPage.watchingAd`,
`RedeemPage.submitting`, and `DailyRewardsPage.claiming` for the
pattern. Fields set synchronously inside a template event handler
(e.g. `filter = mode` inside `setFilter()`) are fine as plain fields.

## What's fully working today

- Full navigation: Welcome → Home → Game → Game Over → Wallet → Shop →
  Cannon Details → Daily Rewards → Redeem → Leaderboard → Settings → Profile.
- Playable Canvas game loop (drag-to-aim, auto-fire, splitting balls, x2
  power orb, particles, lives, pause/resume/quit-and-cash-out).
- Server-style reward recalculation, daily cap enforcement, and idempotent
  crediting via `GameRewardService`.
- A deliberately minimal Wallet page: just the coin balance the player owns,
  a Watch Ad card, and (once the balance reaches `minRedemptionCoins`) a
  Redeem button — no transaction history, no stat breakdown, no coin-to-INR
  estimate. See "Wallet & redemption — kept intentionally minimal" below for
  why, and what's still tracked internally vs. only ever shown.
- Daily login rewards with streak tracking and idempotent one-claim-per-day.
- Real AdMob integration (test ad unit IDs) — a persistent banner, interstitial,
  and 5 rewarded-ad placements. See "AdMob ads + offline gate" below for the
  full breakdown.
- An offline gate that blocks the whole app behind a "no internet
  connection" screen, since ad revenue funds the coin economy.
- Shop purchases (cannon skins, ball skins, effects, themes) that spend
  reward coins and persist ownership + equipped cannon.
- Redemption request flow: once the balance is ≥ `minRedemptionCoins`,
  validates a 10-digit payout mobile number and submits it to the real
  Earnivo Central Game Reward API — see "Redemption — real API integration"
  above for the contract, idempotency, and what still needs backend-side
  setup (registering `gameCode: 'BALL_BLASTER'`, confirming the prod
  `apiBaseUrl`).
- App Promotion verification: on every launch, silently confirms this
  device's Advertising ID to Earnivo so an App Promotion reward (if this game
  is the one being promoted in an Earnivo campaign) gets credited
  automatically — see "App Promotion verification (Earnivo)" above. Wired up
  and building today; only needs `appVerificationApiKey` filled in once a
  real campaign exists.
- Sound & music (`core/services/audio.service.ts`): every gameplay event
  (shoot, hit, destroy, level-up, life lost, game over) and every UI action
  (purchase, claim, redeem, button tap) has a synthesized Web Audio SFX —
  no external audio files, so nothing to license. A small generative
  background loop starts on first tap. Sound Effects and Music each have
  their own toggle in Settings; haptics has a toggle stored but not yet
  wired to a real haptics call.
- A custom app icon: `resources/icon.png` (1024×1024 master source) is
  generated into every native Android density/format via `@capacitor/assets`
  (`npx @capacitor/assets generate --android`) — adaptive icon, legacy
  `ic_launcher`, round icon, and splash screens all under
  `android/app/src/main/res/`. This is what shows on the home screen after
  installing the app; `src/assets/icon/favicon.png` is the separate browser
  tab favicon for the web build. Re-run the generate command after changing
  `resources/icon.png`, then `npx cap sync android`, to refresh the native
  icons.
- A "reset local demo data" utility in Settings for QA.

## What's intentionally NOT here (needs the real backend)

- Authentication / multi-user accounts.
- Any actual persistence beyond the current browser (`localStorage`) for
  coins, gameplay, shop, and daily rewards — redemption is the one flow
  already talking to a real backend (see above).
- Server-side reward verification for AdMob (the reward is only trusted once
  the AdMob SDK itself confirms it — there's no server double-check that a
  rewarded ad was actually watched, since there's no game server yet).
- Earnivo "App Promotion" / install-attribution (`AppVerificationService` in
  the reference app) — deliberately not carried over here, since it collects
  the device advertising ID and calls a separate third-party API with its
  own consent implications, and wasn't part of what was asked for.
- Server time as the source of truth for daily resets (uses device clock).
- Global leaderboard (Leaderboard page honestly shows only local stats).
- Admin dashboard / configuration UI.
- Rate limiting, request signing, and the other API-hardening measures that
  only make sense once there is an API.

## Known limitations to flag to the user

- Because everything lives in `localStorage`, clearing site data, using a
  different browser/device, or reinstalling the app resets all progress.
- A technically-inclined user can edit `localStorage` to change their local
  coin balance. This is expected and harmless *in this prototype* because
  no real payout can ever be triggered from it — but it is exactly the
  failure mode the full spec's backend exists to prevent, and must not be
  shipped as-is once real money is involved.
