# Kairo

A polished, responsive anime discovery and streaming interface. It includes a cinematic home page, browse filters with ranking periods, live search, an airing calendar, persistent watchlist, detail views with recommendations, continue-watching cards, and an HTML5 player with chapter skipping, mirror failover, fullscreen, and picture-in-picture.

## Run locally

```powershell
npm install
npm run dev
```

Build for production with `npm run build`, then `npm start`. Run the contract test suite with `npm test`.

The development command starts both the server-side adapter and Vite on `http://127.0.0.1:5173`.

## Architecture

Two independent layers, deliberately kept apart:

| Layer | Source | Needs config |
|---|---|---|
| Catalog, search, rankings, schedule, recommendations, artwork | AniList, MyAnimeList via Jikan, or Kitsu | No |
| Episode playback, sub/dub servers, chapter marks, storyboard thumbnails | Your licensed provider | Yes |

The catalog works out of the box. Playback stays dark until you point the app at a provider you are licensed to use.

### Catalog sources

The catalog selector supports AniList, MyAnimeList metadata through Jikan, and Kitsu. `CATALOG_SOURCE=auto` tries those adapters in that order when an upstream service is unavailable. Every adapter sits behind a TTL cache with in-flight de-duplication, and the Jikan adapter serializes requests to respect its public-service rate limits.

`anilist.mjs` uses the public AniList GraphQL API and fetches the home rails in a single round trip. `jikan.mjs` supplies MyAnimeList metadata without requiring browser credentials. `kitsu.mjs` provides an independent fallback and native Kitsu search. Metadata sources do not provide media streams; playback remains isolated behind the licensed-provider adapter.

AniList has no day/week/month leaderboard, so the `period` parameter maps to the closest available sort: `day` → `TRENDING_DESC`, `week` → `POPULARITY_DESC`, `month` → `SCORE_DESC`.

AniList episode entries are metadata only (title and thumbnail). They render in the detail view but are marked unplayable; a configured provider supplies the playable list.

### Playback (your provider)

Set `PROVIDER_BASE_URL` plus the `PROVIDER_*` path variables. API keys stay on the Node server and are never exposed to browser code.

`/api/provider/resolve` bridges an AniList title to your provider's own slug by title match, so the two layers line up without storing a mapping table.

The server-list endpoint merges every array a provider may return (`sub`, `dub`, `raw`, `servers`, `sources`, `mirrors`, `streamingLinks`, `episode_links`, `links`), including nested `data` payloads. It de-duplicates within each language, recognizes dual-audio rows, and ranks by server name — `HD-2`, `HD-1`, `HD`, then anything unrecognised, with `SD` last. Unrecognised names keep their relative order. If one mirror fails, the watch page can automatically advance to the next one.

Chapter marks (`intro_start`/`intro_end`/`outro_start`/`outro_end`) flow from the server list and playback payloads into a skip button that appears only while the playhead sits inside a chapter.

The playback endpoint must exchange a server identifier for an authorized HTTPS media URL. It rejects anything that is not plain HTTPS, rejects embed links, and does not implement third-party stream decryption. That constraint is intentional — see below.

### Compatibility

The adapter accepts common provider field names: `slug`/`id`/`$id`, `coverImage`/`cover_image`, `episodes`/`total_episodes`, and `accessId`/`streamId`/`id`/`$id` for servers. MP4, native HLS, and HLS.js fallback are all supported.

Providers that identify titles by AniList ID and return an embeddable
`dataLink` can be enabled with `PROVIDER_RESOLVE_BY_ANILIST_ID=true` and
`PROVIDER_EMBED_LINKS=true`. In that mode the separate playback route is not
required. Only enable embedded sources that you are authorized to publish.

An embed controls its own media element. Auto-play, intro/outro preferences,
and end-of-playback work when the provider exposes the matching `postMessage`
bridge. Playback speed remains in the embedded provider's own settings menu.

### Accounts and Continue Watching

Accounts use salted `scrypt` password hashes and signed, HTTP-only,
same-site session cookies. Per-user Continue Watching data is stored in
`.data/accounts.json`; guests do not record or see playback history. Set
`AUTH_SESSION_SECRET` in production. If it is omitted locally, Kairo creates a
persistent random secret in `.data/session-secret`.

### Connection handling

Outbound requests share a pooled undici agent (50 connections, keep-alive, redirect interceptor) with separate header and body timeouts, tunable via `HTTP_POOL_CONNECTIONS`, `HTTP_HEADERS_TIMEOUT_MS`, and `HTTP_BODY_TIMEOUT_MS`.

## Environment

Copy `.env.example` to `.env`. Beyond the existing `PROVIDER_*` variables, this version reads:

- `CATALOG_SOURCE` — `auto` (recommended), `anilist`, `jikan`, or `kitsu`
- `PROVIDER_THUMBNAILS_PATH` — storyboard sprite/VTT route, e.g. `/thumbnails/{id}`
- `AUTH_SESSION_SECRET` — long random secret used to sign account sessions
- `AUTH_COOKIE_SECURE` — set to `true` when production is served over HTTPS
- `HTTP_POOL_CONNECTIONS`, `HTTP_HEADERS_TIMEOUT_MS`, `HTTP_BODY_TIMEOUT_MS` — outbound pool tuning

## Scope

This project connects to AniList for metadata and to a provider you are licensed to use for playback. It does not scrape streaming sites and does not circumvent stream encryption or obfuscation. The playback path only accepts a normal HTTPS media URL returned by a configured, authorized endpoint.

## Testing

`npm test` starts a mock provider and a production-mode server, then asserts the full contract: server merge/dedupe/ranking, sub/dub grouping, chapter extraction, HTTPS-only playback, thumbnail proxying, and the live AniList catalog paths.

## Artwork

The placeholder hero and poster artwork in `public/assets` was generated specifically for this project and does not depict existing anime characters or franchises. Once the catalog loads, cover art and banners come from AniList.
