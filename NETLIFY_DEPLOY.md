# Deploy Kairo on Netlify Free

This directory is the Netlify edition. The original `anime-streaming-platform`
directory is unchanged.

## 1. Push this directory to a new Git repository

```powershell
cd D:\my_work\anime-streaming-platform-netlify
git init
git add .
git commit -m "Prepare Kairo for Netlify"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

The local `.env`, account data, build output, and dependencies are excluded by
`.gitignore` and must not be committed.

## 2. Import the repository into Netlify

1. Open **Netlify → Add new project → Import an existing project**.
2. Select the Git repository.
3. Netlify reads `netlify.toml` automatically. Confirm:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. Do not deploy until the environment variables below are configured.

## 3. Add environment variables

Open **Project configuration → Environment variables** and add the values from
your local `.env`. At minimum, configure:

```text
AUTH_SESSION_SECRET=<a-long-random-value>
AUTH_COOKIE_SECURE=true
CATALOG_SOURCE=auto
PROVIDER_BASE_URL=<your-provider-base-url>
PROVIDER_SERVERS_PATH=<your-server-route>
PROVIDER_RESOLVE_BY_ANILIST_ID=true
PROVIDER_EMBED_LINKS=true
PROVIDER_EMBED_AUDIO_PARAM=<your-provider-audio-parameter>
PROVIDER_EMBED_SUB_VALUE=0
PROVIDER_EMBED_DUB_VALUE=1
```

Also add `PROVIDER_API_KEY`, `PROVIDER_REFERER`, `PROVIDER_ORIGIN`, or other
provider variables if your provider requires them. Never prefix server secrets
with `VITE_`, because Vite-prefixed values are exposed to browsers.

`PROVIDER_BASE_URL` accepts a comma-separated list. The first entry is the
primary and the rest are mirrors, tried in order whenever one is unreachable,
rate-limited, or answers with a bot-challenge page instead of JSON:

```text
PROVIDER_BASE_URL=https://primary.example/api,https://mirror.example/api
```

## Client-direct provider calls

```text
PROVIDER_CLIENT_DIRECT=true
```

With this set, the browser fetches the title match, the episode list, the server
list, and the playback manifest from the provider itself instead of routing them
through the Netlify Function. The visitor's own address and browser satisfy bot
checks that reject a serverless function, which is the usual cure for the
challenge described below. Catalog metadata still comes from the function, since
AniList does not challenge server requests.

Two conditions decide whether it helps:

1. **The provider must send permissive CORS headers.** Check with:

   ```powershell
   curl.exe -I -H "Origin: https://YOUR-SITE.netlify.app" "https://YOUR-PROVIDER/servers/some-slug/1"
   ```

   An `access-control-allow-origin` header in the response means it will work.
   Without one the browser blocks the read, and every call silently falls back
   to the same-origin route, leaving behaviour exactly as it was.
2. **The provider must not need a credential.** `PROVIDER_CLIENT_DIRECT` is
   ignored whenever `PROVIDER_API_KEY` is set, because a browser-side call would
   hand that key to every visitor. The function log says so on boot, and
   `/api/provider/status` reports `clientDirect: null`.

The first call blocked by a missing CORS header switches the tab back to the
same-origin routes for the rest of the session, so a provider that does not
allow this costs one failed request rather than one per page.

## "Playback unavailable — browser verification challenge"

This means the provider answered the Netlify Function with a Cloudflare-style
challenge page rather than JSON. Netlify Functions call out from shared AWS
datacenter addresses, which those protections challenge by default, so it
usually appears on the deployed site while local development works. The fix is
on the provider side, not in this code:

1. Ask the provider administrator to allow server-to-server access for your
   site — an API key, an allowlisted address, or a documented server endpoint.
2. Set the credentials the provider expects: `PROVIDER_API_KEY`,
   `PROVIDER_REFERER`, `PROVIDER_ORIGIN`, `PROVIDER_USER_AGENT`.
3. Add a mirror to `PROVIDER_BASE_URL` that does permit server requests.

The function log names the mirror that was blocked (`[provider] host/path
unavailable …`), so check **Netlify → Logs → Functions** to see which entry
failed. Working around the challenge itself is not supported.

Generate a session secret locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 4. Deploy

Select **Deploy project**. After the build finishes, verify these URLs:

```text
https://YOUR-SITE.netlify.app/
https://YOUR-SITE.netlify.app/api/provider/status
```

The second URL should return JSON. If `providerConfigured` or
`playbackEnabled` is `false`, check the environment-variable values and trigger
a new deploy.

## Storage and Free-plan behavior

The React/Vite frontend is served from Netlify's CDN. The Express routes run as
one Netlify Function. Accounts and Continue Watching use the site-wide
`kairo-accounts` Netlify Blobs store, so they persist across function restarts
and deployments. Netlify Free has a hard monthly usage allowance; when it is
exhausted, dynamic API requests can stop until the allowance resets.

For local development, copy `.env.example` to `.env` and use `npm run dev`.
Local accounts continue to use `.data/accounts.json`; only Netlify uses Blobs.
