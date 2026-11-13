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

## Application performance and cleanup

The application review covers all 12 routed pages and the shared services.

- Routes load on demand instead of preloading every page at startup. The
  browser check confirms that opening Welcome does not download the game engine.
- The AOT build uses `platformBrowser`; the unused
  `@angular/platform-browser-dynamic` dependency was removed.
- Only the 41 icons used by the pages and shop catalog are registered in
  `shared/app-icons.ts`. The 1,357 copied SVG files (748,088 bytes) are no
  longer included, and glyphs do not trigger individual network requests.
- Unused Ionic utility styles were removed: the production global stylesheet
  decreased from 46,488 to 23,870 bytes, about 49%. Bundled icons increase
  initial JavaScript from about 612 to 645 kB; that is a deliberate tradeoff
  for fewer asset files and requests, rather than an overall initial-bundle
  size reduction.
- Wallet snapshots are cached per state and local day, daily totals use a
  single ledger pass, and duplicate references use a set. Profile updates
  persist once per completed run.
- Background music stops scheduling when disabled, paused, or hidden. Audio
  contexts and connectivity listeners are released on service destruction.
- Game Over displays already-completed rewards immediately and reloads the
  result on every Ionic page entry. Rewarded cosmetics use one acquisition lock.
- Removed unused module imports, game HUD callbacks, shop compatibility
  helpers, an unused starter SVG, and obsolete CSS. TypeScript now rejects
  unused local declarations and parameters.

Run the full suite and production build with:

```bash
npm test -- --watch=false
npm run build
npx cap copy android
```

The browser checks cover every page, visible icons, shop purchases and saved
equipment, and repeated game-over/replay transitions. Device frame rates,
native ad playback, and real redemption responses still require device/backend
verification; the browser checks do not submit real redemption requests.

## AdMob ads and serving-limit remediation

See [ADMOB_REMEDIATION.md](ADMOB_REMEDIATION.md) for the deployment and account
steps. Google controls the serving limit; changing code does not remove it.

| Placement | Format | Current behavior |
|---|---|---|
| Home and Profile | Banner | Fixed 320x50 banner; 82px spacing (including a 32px navigation gap) only while the banner is loaded and visible |
| Game Over navigation | Interstitial | Ready ads only, after three unique completed rounds and a 120-second cooldown; never waits for an ad load |
| Shop and Item Details | Rewarded | Explicit opt-in for a permanent cosmetic unlock only |

Wallet coin ads, run-coin doubling, daily-coin doubling, and ad continuation
in redeemable runs have been removed. Existing balances and purchases are
preserved. Cosmetic rewards cannot be redeemed, transferred, or exchanged
back into coins. Gameplay and the normal daily claim do not require an ad.

The service gates requests on UMP's `canRequestAds`, foreground state and
connectivity, serializes ad operations, and does not request any format more
often than once per minute. A failed request backs off for five minutes;
there are no automatic retry loops, automatic full-screen preloads at app
launch, or production-to-test-ad fallback. A ready interstitial can only be
shown at Game Over; late loads cannot open on the next screen. Full-screen
ads have an application session limit and rewarded ads have a cooldown.
These are application safeguards, not a guarantee of Google approval.

Development builds use Google's demo unit IDs. Production uses the configured
publisher units. Web builds do not simulate successful ads or award fake
rewards. Native rewards require the SDK's earned-reward callback and ad
dismissal. Only `ShopService` consumes rewarded ads, and it never credits the
wallet. Settings exposes Ad privacy choices when UMP requires that entry.

`src/app/core/config/admob.config.ts` contains IDs, pacing, banner routes,
and a local `ADS_ENABLED` kill switch. `scripts/setup-admob-android.js` sets
up the native App ID when Android is regenerated. Register QA devices as
test devices before testing production-looking builds; never click live ads
on your own devices.

The native request/lifecycle tests use an injected mock SDK and create no
live ad traffic. Real-device validation must use test inventory. Consent,
no-fill responses, and a serving limit must not block ordinary app use.
The existing offline screen still blocks play when the device is offline.

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
`minRedemptionCoins`, ...) should come from a
`GET /config/economy` call instead, exactly as the spec's "admin config"
requirements describe. Note there is deliberately no coin-to-INR conversion
rate configured anywhere on the client — that number is computed
server-side by the real redemption API, never locally.

## Gameplay

`BallBlasterEngine` (`core/game-engine/ball-blaster-engine.ts`) is a
Canvas 2D loop that runs independently of Angular:

- The cannon auto-fires every 120 ms. Drag to aim, or use the arrow / A D keys.
- Each run starts at level 1. The profile keeps the highest level reached.
- Normal, fast and gold balls appear from level 1; heavy balls unlock at
  level 2 and bosses at level 3. Each tier has its own HP, speed and coin
  value in `economy.config.ts`.
- Heavy and boss balls split into two smaller, 3-HP normal balls. Children
  appear far enough above the loss line to leave time to react, and their
  falling speed follows the current level.
- Shooting an x2 orb grants dual bullets and doubles score / ball coins
  for the configured 10 seconds. The HUD shows the remaining seconds.
- Clearing balls within 3.5 seconds of one another builds a streak. Every
  third clear increases the score factor, up to x5. Streaks reset on a miss
  or timeout; they do not increase coin rewards.
- A level requires `10 + (level - 1) * 5` clears and awards the configured
  10-coin completion bonus. The HUD shows the current level.
  Each level gradually increases falling/drifting speed, ball health, spawn
  frequency, and the chance of tougher tiers. The curve in
  `core/game-engine/level-difficulty.ts` approaches limits of 700 ms between
  spawns, 1.75x speed, and 1.4x health; it keeps increasing beyond level 10.
  New settings apply to newly spawned balls, leaving existing balls unchanged.
- A ball reaching the loss boundary above the cannon costs a life. A 1.8-second recovery
  window prevents a group of misses from taking all three lives at once.
- Redeemable gameplay runs end when lives run out; they have no rewarded-ad continuation.
- Pause stops animation frames. Switching apps / tabs pauses the game;
  returning requires Resume. Leaving the game destroys its loop and input
  listeners. Re-entering creates a new engine and session.

The engine reports an `EngineResult` to `GamePage`, which completes the
session through `GameRewardService`. The current reward service is a local
prototype that accepts the run coin total and applies the daily cap.

### Rendering and timing

Frame timing uses actual elapsed time, with physics steps at most 16.67 ms.
There is no minimum frame duration, so high-refresh displays do not speed
up the game. Catch-up after a stall is capped at 100 ms. Swept collisions
select the first ball along a bullet's path, and hits are resolved before
checking for missed balls.

Ball gradients and the star background are cached. Canvas density is
capped at 1.5 and 1.5 million pixels. Bullets, particles and floating labels
reuse objects; live work is bounded at 28 balls, 80 bullets, 40 particles
and six labels. The boost HUD updates once per second, and audio noise
buffers are cached with completed audio nodes disconnected.

Focused regression checks:

```bash
npm test -- --watch=false --include=src/app/core/game-engine/ball-blaster-engine.spec.ts --include=src/app/pages/game/game.page.spec.ts
npm run build
npx cap copy android
```

The focused checks cover 30/60/90/120/144-Hz timing, collisions,
recovery, continues, page lifecycle, object bounds and a two-minute
simulation. Chrome checks also cover touch input, pause/resume and viewport
rotation. Native device frame rates and production ad behavior still need
verification on an Android device.

## Shop and equipped items

Every paid item offers **Buy with coins** and **Watch Ad to Unlock** in the
shop and its details page. One earned rewarded ad grants that item permanently.
Coin purchases debit the listed price once. A successful unlock automatically
equips the item; owned items can be equipped again at no cost. Closing an ad
early or failing to load an ad never unlocks an item.

The categories apply independently during gameplay:

- Cannons change the cannon finish and matching shot color.
- Shot Colors override the shot color: Ruby Red / Emerald Green cost 100
  coins, Cosmic Violet / Sunshine Gold cost 150. Cannon Match restores the
  equipped cannon's shot color.
- Balls apply neon outlines or galaxy details to the falling targets.
- Effects enable longer bullet trails or larger, bounded explosion bursts.
- Themes change the cached background and star palette.

Each category includes a free default. Purchases and equipped choices persist
across app reloads, and previous cannon ownership and selection migrate
automatically. Equipment is cosmetic: damage, fire rate and coin rewards
keep their existing values. Native ads use the existing AdMob rewarded flow;
web builds do not simulate ad success.

Purchase and equipment regression checks:

```bash
npm test -- --watch=false --include=src/app/core/services/shop.service.spec.ts --include=src/app/core/game-engine/ball-blaster-engine.spec.ts --include=src/app/pages/game/game.page.spec.ts --include=src/app/pages/shop/shop.page.spec.ts --include=src/app/pages/cannon-details/cannon-details.page.spec.ts
```

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
  and (once the balance reaches `minRedemptionCoins`) a
  Redeem button — no transaction history, no stat breakdown, no coin-to-INR
  estimate. See "Wallet & redemption — kept intentionally minimal" below for
  why, and what's still tracked internally vs. only ever shown.
- Daily login rewards with streak tracking and idempotent one-claim-per-day.
- AdMob integration with limited banner placements, paced interstitials,
  and opt-in cosmetic rewards. See the AdMob section and remediation guide.
- An offline gate that blocks the whole app behind a "no internet
  connection" screen, since ad revenue funds the coin economy.
- Shop purchases (cannons, shot colors, ball skins, effects, themes) using
  reward coins or completed rewarded ads, with saved ownership and an
  independent equipped selection for every category.
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
