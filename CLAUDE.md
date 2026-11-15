# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **Trakt**: a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. Everything comes from the official
[Trakt API](https://developer.trakt.tv) (version 2), with the user's own free
API app (Client ID only) and the account of the household. Transport: cloud
only.

A **calendar integration** (`type: "calendar"`, Gladys 5.3.0+): one "Shows and
movies" calendar for every user who enabled it in "My calendars", three
dashboard widgets, seven scene triggers, three scene actions, a Connect button
(`account_link`) and two configuration buttons. No devices: Gladys does not let
one manifest be both.

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/app.test.js              # one file
DEBUG=gladys-integration-sdk npm test     # with the SDK debug logs
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only (new GladysIntegration + createApp + shutdown)
src/app.js              every handler, registered before connect(); sign-in, the one-minute tick
src/auth.js             device code flow (Client ID only), single-flight refresh of single-use tokens
src/trakt.js            HTTP client: required headers, spacing, 401 -> refresh + retry, 429 pause
src/scan.js             the reading: calendars by 33-day chunks, shows in progress, account; what changed
src/items.js            calendar answers -> items (episodes grouped per show and instant, movies)
src/watching.js         what the account watches, turned into started / stopped transitions
src/calendar.js         one calendar per user: timed episodes, all-day releases
src/events.js           scene trigger payloads, due "release day" and "airs now", action outputs
src/widgets.js          `upcoming`, `up_next`, `now_watching` (pure, reused by docs/illustrations/gen.mjs)
src/images.js           posters cached in /data/posters (no hotlinking), keys tk-<hash>
src/store.js            /data/state.json: items, seen, kinds read, shows in progress, watching, events sent
src/config.js           configuration and internal keys (tokens, last language)
src/i18n.js             runtime texts, en / fr / de / es
src/time.js             days and times in the timezone of the instance (TZ)
gladys-assistant-integration.json   manifest (generated texts kept under 100 KB)
docs/{en,fr,de,es}.md   user documentation, re-hosted by the store
docs/illustrations/     generated widget images (render.sh, gen.mjs, render.js)
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Trakt facts (developer.trakt.tv, checked 2026-11-14)

- Every installation creates its own API app (trakt.tv → Settings → My Apps,
  a verified GitHub account required). New apps get **no Client Secret**:
  the integration only uses the Client ID. A Development app accepts its
  owner and up to 16 invited people. Trakt **deletes an app unused for 30
  days**.
- Headers on every call: `Content-Type: application/json`, `User-Agent`,
  `trakt-api-key: <Client ID>`, `trakt-api-version: 2`, and
  `Authorization: Bearer <access token>`.
- Device flow: `POST /oauth/device/code {client_id}` → `user_code`,
  `verification_url` (trakt.tv/activate); `POST /oauth/device/token {code,
client_id}` answers **HTTP statuses**: 400 pending, 404 unknown, 409 used,
  410 expired, 418 denied, 429 slow down.
- Access tokens live **7 days**; **refresh tokens are single-use** (the one
  sent dies at once): one refresh at a time, the new pair stored before use.
  A dead one is 400 `invalid_grant` "session not found".
- Limits of a user: 500 GET per 5 minutes, 1 POST/PUT/DELETE per second.
  429 comes with `Retry-After` (sometimes without, from Cloudflare).
- Calendars `/calendars/my/{shows|movies|streaming}/{start}/{days}`: UTC
  days, **33 days at most** per request. `my` = shows watched or watchlisted
  plus the watchlisted movies.
- `/users/me/watching`: 200 with the item, or **204** when nothing plays
  (a paused player stops the scrobble).
- Images: `extended=full` gives addresses without scheme
  (`walter-r2.trakt.tv/…webp`); **hotlinking is forbidden**: every image is
  cached by the application.
- Other statuses: 403 bad Client ID or unapproved app, 420 account limit
  (watchlist full), 423 locked account, 426 VIP only, 5xx/52x overloaded.
- Branding: "<App> uses Trakt but is not endorsed or certified by Trakt" in
  the About (README, NOTICE).

## Rules

- **Keys are forever**: the kinds (`episode`, `movie`, `streaming`), the item
  ids (`ep-<show>-<season>-<number>`, `mv-<id>`, `st-<id>`), the calendar id
  `ext:<selector>:<user>:watch`, the event ids `ext:<selector>:<user>:<item
id>`, the keys of `config_schema`, of the buttons, of the widgets and their
  settings, of the scene triggers (fields, options, variables, the `lead`
  values) and of the scene actions (fields, outputs), the widget image keys
  `tk-<16 hex>` and the internal config keys (`access_token`,
  `refresh_token`, `token_expires_at`, `last_language`).
  `test/manifest.test.js` and `test/app.test.js` tie the manifest to the code.
- **Be gentle with Trakt**: one request at a time (250 ms between GETs,
  1.1 s between writes), a reading every 1 to 12 hours, one request a minute
  for "Now watching" only when enabled; a 429 pauses every call until
  `Retry-After`. Never one request per item.
- **Tokens are configuration**: stored with `setConfig` (they follow the
  Gladys backups), read back with `getConfig()` (the config pushed by the
  core may not carry internal keys). Never logged, never in /data, never in
  an error message. A token refused for good fires `account_disconnected`
  once and waits for a new Connect.
- **Complete readings replace, failed ones only add.** A kind whose every
  request succeeded is replaced; a failed kind keeps what it had.
- **Events once, on transitions.** `item_announced` only for an item never
  seen, of a kind already read once, inside the days the previous reading
  covered (not when the window slides), never after a write of a scene
  action, 10 at most per reading; `release_day` and `episode_airing` once
  per item, day and lead (`fired` in /data survives restarts); "watching"
  events only between two answers of the same run (the first is a baseline).
  A widget or a button never fires an event.
- **Writes** (watchlist, history) only from a scene action; the same title is
  never marked watched twice within an hour (Trakt does not check).
- **Posters.** Only https addresses of `trakt.tv` are fetched, 300 KB at most,
  checked by magic number, kept in /data/posters; a widget only shows a
  poster already cached; unused for 30 days, it is deleted. The repository
  ships no real poster: the illustrations draw their own.
- **Calendar.** Pushed after a reading and at midnight (the window slides: 7
  days back, `days_ahead` days ahead), with a day of margin on each side (an
  instant may fall on the next UTC day); at most 30 writes a minute; a
  calendar the user stopped synchronizing is skipped. It starts private: the
  user shares it in "My calendars". One Trakt account for every user (no
  `account_schema`: the core refuses `account_link` there).
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, runtime messages in
  `src/i18n.js`, `docs/*.md`, README) exists in English, French, German and
  Spanish. `test/i18n.test.js` checks it. Titles stay as Trakt writes them;
  scene variables carry keys, plus `kind_name`, `date_text` and `text` in the
  language of the configuration. Use the words of the Gladys UI (My calendars
  / Mes calendriers / Meine Kalender / Mis calendarios…).
- **Widget images.** After any change to the content of a widget, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  The version stays below 1.0.0 until the maintainer runs the Release workflow
  with `release-as: 1.0.0`.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing.
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language; the file must stay
  **under 100 KB** (`MANIFEST_MAX_BYTES` of the store: a bigger one is
  rejected silently). The item variables are repeated in four triggers and an
  action: keep their descriptions short. `type: "calendar"` needs
  `gladys_version >=5.2.0`, `keywords` 5.3.0. Transport: `["cloud"]`. No
  permission.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (`test/helpers.js` fakes Trakt
  behind `fetch`).

## Pitfalls

- The fake Gladys of the SDK does not store `full_day: false`: compare with
  `=== true`.
- The timers of the integration are `unref`ed: a script that drives the app
  without the SDK websocket must keep the process alive itself, and the tests
  inject `sleep` everywhere (poster downloads included), or `node --test`
  cancels them ("Promise resolution is still pending").
- Inside a card-list, the list display shows the date OR the subtitle: the
  day goes in the subtitle, never in `date`.
- A scene filter compares by equality with the event data: the `finished`
  variable of `watching_stopped` is the string `"true"` / `"false"`, like the
  options of its filter.
