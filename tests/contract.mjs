/**
 * End-to-end check of the provider contract: starts the mock provider and a
 * production-mode server, then asserts the merge/rank, chapter, and catalog paths.
 * Run with: npm test
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 5199;
const base = `http://127.0.0.1:${PORT}`;
const children = [];
let failures = 0;

function start(script, env = {}) {
  const child = spawn(process.execPath, [script, ...(env.ARGS ? [env.ARGS] : [])], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[${path.basename(script)}] ${chunk}`));
  children.push(child);
  return child;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(target = base, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`${target}/api/provider/status`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await wait(500);
  }
  throw new Error(`Server at ${target} did not become ready`);
}

function check(label, condition, detail = '') {
  if (condition) return console.log(`  PASS  ${label}`);
  failures++;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

const getJson = async (routePath) => {
  const response = await fetch(`${base}${routePath}`);
  return { status: response.status, body: await response.json() };
};

try {
  start(path.join(root, 'tests', 'mock-provider.mjs'));
  await wait(800);
  start(path.join(root, 'server.mjs'), {
    ARGS: '--production',
    PORT: String(PORT),
    // The challenged mirror is listed first, so every provider check below only
    // passes if failover reaches the healthy mirror.
    PROVIDER_BASE_URL: 'http://127.0.0.1:9394,http://127.0.0.1:9393',
    PROVIDER_API_KEY: 'test-key',
    PROVIDER_SEARCH_PATH: '/search',
    PROVIDER_SERVERS_PATH: '/servers/{slug}/{episode}',
    PROVIDER_RESOLVE_BY_ANILIST_ID: 'false',
    PROVIDER_EMBED_LINKS: 'true',
    PROVIDER_EMBED_AUDIO_PARAM: 'a',
    PROVIDER_EMBED_SUB_VALUE: '0',
    PROVIDER_EMBED_DUB_VALUE: '1',
    PROVIDER_PLAYBACK_PATH: '/stream/{id}',
    PROVIDER_THUMBNAILS_PATH: '/thumbnails/{id}',
  });
  await waitForServer();

  console.log('\nstatus');
  const status = await getJson('/api/provider/status');
  check('reports anilist catalog', status.body.catalogSource === 'anilist');
  check('reports provider configured', status.body.providerConfigured === true);
  check('reports both provider mirrors', status.body.providerMirrors === 2, String(status.body.providerMirrors));
  check('reports playback enabled', status.body.playbackEnabled === true);

  console.log('\nresolve (AniList title -> provider slug)');
  const resolved = await getJson('/api/provider/resolve?title=Licensed%20Test%20Title');
  check('finds provider slug', resolved.body.providerSlug === 'licensed-test-title', JSON.stringify(resolved.body));
  const availability = await getJson('/api/provider/availability?title=Licensed%20Test%20Title');
  check('returns provider episode availability', availability.body.totalEpisodes === 2 && availability.body.dubEpisodes === 1, JSON.stringify(availability.body));

  console.log('\nservers (merge + dedupe + rank + chapters)');
  const servers = await getJson('/api/provider/servers/licensed-test-title/1');
  check('fails over past a challenged mirror', servers.status === 200, String(servers.status));
  const ids = servers.body.servers.map((s) => s.accessId);
  check('de-duplicates across buckets', new Set(ids).size === ids.length, ids.join(','));
  check('merges episode_links entries', ids.includes('licensed-episode-1-alt'), ids.join(','));
  check('ranks HD-2 first', servers.body.servers[0].serverName === 'HD-2', ids.join(','));
  check('ranks SD last', servers.body.servers.at(-1).serverName === 'SD', ids.join(','));
  check('groups sub servers', servers.body.sub.length === 3, String(servers.body.sub.length));
  check('groups dub servers', servers.body.dub.length === 1, String(servers.body.dub.length));
  check('reports both languages', servers.body.availableLanguages.join(',') === 'sub,dub');
  check('selects sub audio in embed URL', new URL(servers.body.sub[0].dataLink).searchParams.get('a') === '0');
  check('selects dub audio in embed URL', new URL(servers.body.dub[0].dataLink).searchParams.get('a') === '1');
  check('extracts intro chapter', servers.body.chapters.intro?.start === 12 && servers.body.chapters.intro?.end === 102);
  check('extracts outro chapter', servers.body.chapters.outro?.start === 1350);

  const blockedServers = await getJson('/api/provider/servers/licensed-test-title/99');
  check('maps provider challenges to a gateway error', blockedServers.status === 502, String(blockedServers.status));
  check('reports provider browser challenges clearly', blockedServers.body.message?.includes('browser verification challenge'), blockedServers.body.message);
  check('does not expose provider HTML', !/[<>]/.test(blockedServers.body.message || ''), blockedServers.body.message);

  console.log('\nplayback');
  const playback = await getJson('/api/provider/playback/licensed-episode-1');
  check('returns https url', /^https:\/\//.test(playback.body.url), playback.body.url);

  console.log('\nthumbnails');
  const thumbs = await getJson('/api/provider/thumbnails/1');
  check('proxies thumbnail track', thumbs.status === 200, String(thumbs.status));

  console.log('\ncatalog (live AniList)');
  const home = await getJson('/api/provider/home?limit=5');
  check('home returns three rails', ['latest_aired', 'trending', 'top_weekly'].every((key) => home.body[key]?.length === 5));
  const top = await getJson('/api/provider/top?period=month&limit=3');
  check('top maps month to SCORE_DESC', top.body.sort === 'SCORE_DESC', top.body.sort);
  const schedule = await getJson('/api/provider/schedule?days=2');
  check('schedule groups by day', Array.isArray(schedule.body.days) && schedule.body.days.length > 0);
  check('schedule entries carry episode + time', Boolean(schedule.body.days[0]?.items[0]?.episode && schedule.body.days[0]?.items[0]?.airing_at));
  const search = await getJson('/api/provider/search?q=cowboy%20bebop&limit=3');
  const anilistId = search.body.results[0]?.anilistId;
  check('search returns results', search.body.results.length > 0);
  const info = await getJson(`/api/provider/info/${anilistId}?providerSlug=licensed-test-title`);
  check('info prefers provider episodes', info.body.playableEpisodes === true && info.body.episodes.length === 2, String(info.body.episodes?.length));
  const infoNoProvider = await getJson(`/api/provider/info/${anilistId}`);
  check('info falls back to AniList episodes', infoNoProvider.body.playableEpisodes === false && infoNoProvider.body.episodes.length > 0);
  const recs = await getJson(`/api/provider/recommendations/${anilistId}`);
  check('recommendations return titles', recs.body.results.length > 0);

  console.log('\nclient-direct configuration');
  check('withholds client-direct config while an API key is set', status.body.clientDirect === null, JSON.stringify(status.body.clientDirect));

  const directBase = `http://127.0.0.1:${PORT + 1}`;
  start(path.join(root, 'server.mjs'), {
    ARGS: '--production',
    PORT: String(PORT + 1),
    PROVIDER_BASE_URL: 'http://127.0.0.1:9394,http://127.0.0.1:9393',
    PROVIDER_CLIENT_DIRECT: 'true',
    PROVIDER_SERVERS_PATH: '/servers/{slug}/{episode}',
    PROVIDER_SEARCH_PATH: '/search',
    PROVIDER_PLAYBACK_PATH: '/stream/{id}',
    PROVIDER_EMBED_LINKS: 'true',
    PROVIDER_EMBED_AUDIO_PARAM: 'a',
  });
  await waitForServer(directBase);
  const direct = await (await fetch(`${directBase}/api/provider/status`)).json();
  check('publishes client-direct config when no key is needed', Boolean(direct.clientDirect), JSON.stringify(direct.clientDirect));
  check('publishes every mirror to the browser', direct.clientDirect?.baseUrls?.length === 2, JSON.stringify(direct.clientDirect?.baseUrls));
  check('publishes the servers path template', direct.clientDirect?.serversPath === '/servers/{slug}/{episode}', direct.clientDirect?.serversPath);
  check('publishes the episodes path template', direct.clientDirect?.episodesPath === '/episodes/{slug}', direct.clientDirect?.episodesPath);
  check('publishes the playback path template', direct.clientDirect?.playbackPath === '/stream/{id}', String(direct.clientDirect?.playbackPath));
  check('publishes embed audio shaping', direct.clientDirect?.embedLinks === true && direct.clientDirect?.embedAudioParam === 'a', JSON.stringify(direct.clientDirect));
  check('never publishes a credential', !JSON.stringify(direct).toLowerCase().includes('test-key'), JSON.stringify(direct.clientDirect));

  console.log('\nerror handling');
  const badSearch = await getJson('/api/provider/search?q=');
  check('empty query rejected', badSearch.status === 400);
  const badInfo = await getJson('/api/provider/info/999999999');
  check('unknown title returns 404', badInfo.status === 404, String(badInfo.status));

  console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
} catch (error) {
  failures++;
  console.error('\nHarness error:', error.message);
} finally {
  children.forEach((child) => child.kill());
  process.exit(failures ? 1 : 0);
}
