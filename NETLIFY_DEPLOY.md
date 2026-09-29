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
