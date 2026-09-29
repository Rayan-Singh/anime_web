import express from 'express';
import { getStore } from '@netlify/blobs';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as catalog from './catalog.mjs';
import { fetchJson, httpError } from './http.mjs';

const root = process.cwd();
const env = { ...process.env };
const netlifyRuntime = Boolean(process.env.SITE_ID)
  || String(process.env.NETLIFY || process.env.NETLIFY_DEV).toLowerCase() === 'true';
const app = express();
const scrypt = promisify(scryptCallback);

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/* ---------------------------------------------------------------- accounts */

const accountFile = path.resolve(env.AUTH_DATA_FILE || path.join(root, '.data', 'accounts.json'));
const localSessionSecret = () => {
  const secretFile = path.join(path.dirname(accountFile), 'session-secret');
  try { return readFileSync(secretFile, 'utf8').trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const generated = randomBytes(32).toString('hex');
    mkdirSync(path.dirname(secretFile), { recursive: true });
    writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
    return generated;
  }
};
const sessionSecret = env.AUTH_SESSION_SECRET || (netlifyRuntime ? '' : localSessionSecret());
if (!sessionSecret) throw new Error('AUTH_SESSION_SECRET must be configured in Netlify environment variables');
const sessionCookie = 'kairo_session';
const sessionMaxAge = 60 * 60 * 24 * 30;
let accountWrite = Promise.resolve();
const blobAccounts = netlifyRuntime ? getStore({ name: 'kairo-accounts', consistency: 'strong' }) : null;
const userBlobKey = (id) => `users/${id}`;
const emailBlobKey = (email) => `emails/${createHash('sha256').update(email).digest('hex')}`;

const readAccounts = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(accountFile, 'utf8'));
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { users: [] };
    throw error;
  }
};
const writeAccounts = (store) => {
  accountWrite = accountWrite.then(async () => {
    await fs.mkdir(path.dirname(accountFile), { recursive: true });
    await fs.writeFile(accountFile, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  });
  return accountWrite;
};
const findUserById = async (id) => {
  if (blobAccounts) return blobAccounts.get(userBlobKey(id), { type: 'json', consistency: 'strong' });
  const store = await readAccounts();
  return store.users.find((entry) => entry.id === id) || null;
};
const findUserByEmail = async (email) => {
  if (blobAccounts) {
    const id = await blobAccounts.get(emailBlobKey(email), { consistency: 'strong' });
    return id ? findUserById(id) : null;
  }
  const store = await readAccounts();
  return store.users.find((entry) => entry.email === email) || null;
};
const createUser = async (user) => {
  if (blobAccounts) {
    await blobAccounts.setJSON(userBlobKey(user.id), user);
    const { modified } = await blobAccounts.set(emailBlobKey(user.email), user.id, { onlyIfNew: true });
    if (!modified) {
      await blobAccounts.delete(userBlobKey(user.id));
      return false;
    }
    return true;
  }
  const store = await readAccounts();
  if (store.users.some((entry) => entry.email === user.email)) return false;
  store.users.push(user);
  await writeAccounts(store);
  return true;
};
const saveUser = async (user) => {
  if (blobAccounts) return blobAccounts.setJSON(userBlobKey(user.id), user);
  const store = await readAccounts();
  const index = store.users.findIndex((entry) => entry.id === user.id);
  if (index < 0) throw httpError(401, 'Session is no longer valid');
  store.users[index] = user;
  return writeAccounts(store);
};
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const passwordHash = async (password, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: Buffer.from(await scrypt(password, salt, 64)).toString('hex'),
});
const verifyPassword = async (password, user) => {
  const candidate = Buffer.from(await scrypt(password, user.passwordSalt, 64));
  const expected = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};
const signSession = (userId) => {
  const expires = Math.floor(Date.now() / 1000) + sessionMaxAge;
  const payload = `${userId}.${expires}`;
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};
const parseCookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
}).filter(([key]) => key));
const sessionUserId = (req) => {
  const token = parseCookies(req)[sessionCookie];
  if (!token) return null;
  const [userId, expiresText, signature] = token.split('.');
  const expires = Number(expiresText);
  if (!userId || !signature || !Number.isFinite(expires) || expires < Date.now() / 1000) return null;
  const expected = createHmac('sha256', sessionSecret).update(`${userId}.${expiresText}`).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer) ? userId : null;
};
const setSession = (res, userId) => res.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(signSession(userId))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAge}${netlifyRuntime || String(env.AUTH_COOKIE_SECURE).toLowerCase() === 'true' ? '; Secure' : ''}`);
const clearSession = (res) => res.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
const requireAccount = async (req, res, next) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ message: 'Sign in required' });
  const user = await findUserById(userId);
  if (!user) return res.status(401).json({ message: 'Session is no longer valid' });
  req.accountUser = user;
  next();
};

app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 40) return res.status(400).json({ message: 'Name must be between 2 and 40 characters' });
  if (!emailPattern.test(email) || email.length > 120) return res.status(400).json({ message: 'Enter a valid email address' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ message: 'Password must be between 8 and 128 characters' });
  if (await findUserByEmail(email)) return res.status(409).json({ message: 'An account already exists for this email' });
  const secured = await passwordHash(password);
  const user = { id: randomBytes(16).toString('hex'), name, email, passwordSalt: secured.salt, passwordHash: secured.hash, createdAt: Date.now(), progress: {} };
  if (!(await createUser(user))) return res.status(409).json({ message: 'An account already exists for this email' });
  setSession(res, user.id);
  res.status(201).json({ user: publicUser(user), progress: [] });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user))) return res.status(401).json({ message: 'Email or password is incorrect' });
  setSession(res, user.id);
  res.json({ user: publicUser(user), progress: Object.values(user.progress || {}).sort((a, b) => b.updatedAt - a.updatedAt) });
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const userId = sessionUserId(req);
  if (!userId) return res.json({ user: null, progress: [] });
  const user = await findUserById(userId);
  if (!user) { clearSession(res); return res.json({ user: null, progress: [] }); }
  res.json({ user: publicUser(user), progress: Object.values(user.progress || {}).sort((a, b) => b.updatedAt - a.updatedAt) });
}));

app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.status(204).end(); });

app.put('/api/account/progress/:key', requireAccount, asyncRoute(async (req, res) => {
  const key = String(req.params.key || '').slice(0, 180);
  const episode = Math.max(1, Number(req.body?.episode) || 1);
  const entry = {
    id: String(req.body?.id || key).slice(0, 180),
    slug: String(req.body?.slug || '').slice(0, 180),
    anilistId: req.body?.anilistId ? String(req.body.anilistId).slice(0, 40) : null,
    malId: req.body?.malId ? String(req.body.malId).slice(0, 40) : null,
    source: String(req.body?.source || 'anilist').slice(0, 30),
    title: String(req.body?.title || 'Untitled').slice(0, 180),
    japanese: String(req.body?.japanese || '').slice(0, 180),
    image: String(req.body?.image || '').slice(0, 1000),
    banner: String(req.body?.banner || '').slice(0, 1000),
    score: String(req.body?.score || '').slice(0, 12),
    year: String(req.body?.year || '').slice(0, 12),
    type: String(req.body?.type || '').slice(0, 40),
    status: String(req.body?.status || '').slice(0, 40),
    genres: Array.isArray(req.body?.genres) ? req.body.genres.slice(0, 10).map((value) => String(value).slice(0, 40)) : [],
    blurb: String(req.body?.blurb || '').slice(0, 2000),
    episodes: Math.max(episode, Number(req.body?.episodes) || 0),
    episode,
    episodeTitle: String(req.body?.episodeTitle || `Episode ${episode}`).slice(0, 180),
    language: ['sub', 'dub'].includes(req.body?.language) ? req.body.language : 'sub',
    position: Math.max(0, Number(req.body?.position) || 0),
    duration: Math.max(0, Number(req.body?.duration) || 0),
    providerItem: req.body?.providerItem !== false,
    updatedAt: Date.now(),
  };
  req.accountUser.progress ||= {};
  req.accountUser.progress[key] = entry;
  const ordered = Object.entries(req.accountUser.progress).sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, 50);
  req.accountUser.progress = Object.fromEntries(ordered);
  await saveUser(req.accountUser);
  res.json({ progress: entry });
}));

const baseUrl = env.PROVIDER_BASE_URL?.replace(/\/$/, '');
export const providerConfigured = Boolean(baseUrl);
const endpoint = (key, fallback) => env[key] || fallback;
const embedLinksEnabled = String(env.PROVIDER_EMBED_LINKS || '').toLowerCase() === 'true';
const resolveByAnilistId = String(env.PROVIDER_RESOLVE_BY_ANILIST_ID || '').toLowerCase() === 'true';
const embedAudioParam = String(env.PROVIDER_EMBED_AUDIO_PARAM || '').trim();
const embedSubValue = String(env.PROVIDER_EMBED_SUB_VALUE ?? '0');
const embedDubValue = String(env.PROVIDER_EMBED_DUB_VALUE ?? '1');
const defaultCatalogSource = catalog.normalizeSource(env.CATALOG_SOURCE, 'auto');
const catalogSource = (req) => catalog.normalizeSource(req.query.source, defaultCatalogSource);

function authHeaders() {
  const headers = { accept: 'application/json' };
  if (env.PROVIDER_REFERER) headers.referer = env.PROVIDER_REFERER;
  if (env.PROVIDER_ORIGIN) headers.origin = env.PROVIDER_ORIGIN;
  if (env.PROVIDER_USER_AGENT) headers['user-agent'] = env.PROVIDER_USER_AGENT;
  if (env.PROVIDER_API_KEY) {
    const name = env.PROVIDER_AUTH_HEADER || 'Authorization';
    const scheme = env.PROVIDER_AUTH_SCHEME ?? 'Bearer';
    headers[name] = scheme ? `${scheme} ${env.PROVIDER_API_KEY}` : env.PROVIDER_API_KEY;
  }
  return headers;
}

async function providerRequest(providerPath, query = {}) {
  if (!baseUrl) throw httpError(503, 'Provider is not configured');
  const url = new URL(`${baseUrl}${providerPath.startsWith('/') ? providerPath : `/${providerPath}`}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  });
  return fetchJson(url, { headers: authHeaders(), timeoutMs: Number(env.PROVIDER_TIMEOUT_MS || 12_000) });
}

const safePart = (value) => encodeURIComponent(String(value).replace(/[\r\n]/g, ''));
const fillPath = (template, values) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, safePart(value)), template);
const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, Number(value) || fallback));

app.get('/api/provider/status', (_req, res) => {
  res.json({
    configured: true,
    catalogSource: defaultCatalogSource === 'auto' ? 'anilist' : defaultCatalogSource,
    catalogMode: defaultCatalogSource,
    catalogSources: catalog.sources,
    providerConfigured: Boolean(baseUrl),
    playbackEnabled: Boolean(baseUrl && (env.PROVIDER_PLAYBACK_PATH || embedLinksEnabled)),
    thumbnailsEnabled: Boolean(baseUrl && env.PROVIDER_THUMBNAILS_PATH),
    mode: baseUrl ? 'authorized-provider' : 'catalog-only',
  });
});

/* ---------------------------------------------------------------- discovery */

app.get('/api/provider/home', asyncRoute(async (req, res) => {
  res.json(await catalog.call('home', catalogSource(req), clamp(req.query.limit, 1, 50, 20)));
}));

app.get('/api/provider/search', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ message: 'q is required' });
  res.json(await catalog.call('search', catalogSource(req), q, clamp(req.query.limit, 1, 50, 20), clamp(req.query.page, 1, 20, 1)));
}));

app.get('/api/provider/top', asyncRoute(async (req, res) => {
  const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
  res.json(await catalog.call('top', catalogSource(req), period, clamp(req.query.limit, 1, 50, 20)));
}));

app.get('/api/provider/schedule', asyncRoute(async (req, res) => {
  res.json(await catalog.call('schedule', catalogSource(req), clamp(req.query.days, 1, 14, 7)));
}));

app.get('/api/provider/recommendations/:catalogId', asyncRoute(async (req, res) => {
  res.json(await catalog.call('recommendations', catalogSource(req), req.params.catalogId));
}));

/**
 * Metadata and the episode list resolve concurrently, so a configured provider
 * never serialises behind the AniList round trip.
 */
app.get('/api/provider/info/:slug', asyncRoute(async (req, res) => {
  const { slug } = req.params;
  const [meta, providerEpisodes] = await Promise.all([
    catalog.call('info', catalogSource(req), slug),
    resolveProviderEpisodes(req.query.providerSlug).catch(() => null),
  ]);
  const episodes = providerEpisodes?.length ? providerEpisodes : meta.episodes_list;
  res.json({ ...meta, episodes, playableEpisodes: Boolean(providerEpisodes?.length) });
}));

app.get('/api/provider/episodes/:slug', asyncRoute(async (req, res) => {
  const fromProvider = await resolveProviderEpisodes(req.query.providerSlug).catch(() => null);
  if (fromProvider?.length) return res.json({ episodes: fromProvider, playable: true });
  const meta = await catalog.call('info', catalogSource(req), req.params.slug);
  res.json({ episodes: meta.episodes_list, playable: false });
}));

async function resolveProviderEpisodes(providerSlug) {
  if (!baseUrl || !providerSlug) return null;
  const route = fillPath(endpoint('PROVIDER_EPISODES_PATH', '/episodes/{slug}'), { slug: providerSlug });
  const payload = await providerRequest(route);
  const list = Array.isArray(payload) ? payload : payload.episodes || payload.data || [];
  return list.map((episode) => ({ ...episode, playable: true }));
}

/** Bridges an AniList title to the configured provider's own slug by title match. */
app.get('/api/provider/resolve', asyncRoute(async (req, res) => {
  if (!baseUrl) return res.status(503).json({ message: 'Provider is not configured' });
  const title = String(req.query.title || '').trim();
  if (!title) return res.status(400).json({ message: 'title is required' });
  const anilistId = Number(req.query.anilistId);
  if (resolveByAnilistId && Number.isInteger(anilistId) && anilistId > 0) {
    return res.json({ providerSlug: String(anilistId), matchedTitle: title });
  }
  const payload = await providerRequest(endpoint('PROVIDER_SEARCH_PATH', '/search'), { q: title, limit: 10 });
  const list = Array.isArray(payload) ? payload : payload.results || payload.data || payload.anime || [];
  const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wanted = normalise(title);
  const match = list.find((item) => normalise(item.title?.english || item.title?.romaji || item.title || item.name) === wanted) || list[0];
  const providerSlug = match?.slug || match?.id || match?.$id || match?.anilist_id || match?.anilistId || match?.anime_id || match?.animeId || null;
  if (!providerSlug) return res.status(404).json({ message: 'No matching title at the configured provider' });
  res.json({ providerSlug: String(providerSlug), matchedTitle: match.title?.english || match.title || match.name || title });
}));

/** Provider-side language counts are more current than catalog totals for long-running shows. */
app.get('/api/provider/availability', asyncRoute(async (req, res) => {
  if (!baseUrl) return res.status(503).json({ message: 'Provider is not configured' });
  const title = String(req.query.title || '').trim();
  if (!title) return res.status(400).json({ message: 'title is required' });
  const payload = await providerRequest(endpoint('PROVIDER_SEARCH_PATH', '/search'), { q: title, limit: 10 });
  const list = Array.isArray(payload) ? payload : payload.results || payload.data || payload.anime || [];
  const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wanted = normalise(title);
  const anilistId = Number(req.query.anilistId);
  const match = list.find((entry) => Number(entry.anilist_id || entry.anilistId) === anilistId && anilistId > 0)
    || list.find((entry) => normalise(entry.title?.english || entry.title?.romaji || entry.title || entry.name) === wanted)
    || list[0];
  if (!match) return res.status(404).json({ message: 'No provider availability was found for this title' });
  const subEpisodes = Number(match.subbed ?? match.sub_episodes ?? match.subEpisodes ?? 0) || 0;
  const dubEpisodes = Number(match.dubbed ?? match.dub_episodes ?? match.dubEpisodes ?? 0) || 0;
  const declaredEpisodes = Number(match.episodes ?? match.total_episodes ?? match.episode_count ?? 0) || 0;
  res.json({
    providerSlug: String(match.anime_id || match.slug || match.id || ''),
    subEpisodes,
    dubEpisodes,
    totalEpisodes: Math.max(declaredEpisodes, subEpisodes, dubEpisodes),
  });
}));

/* ---------------------------------------------------------------- playback */

/**
 * Quality preference for server names; anything unrecognised sorts last while
 * keeping its relative order.
 */
const SERVER_RANK = { 'HD-2': 0, 'HD-1': 1, 'HD': 2, 'SD': 4 };
const SUB_TYPES = new Set(['sub', 's-sub', 'subbed', 'softsub', 'soft-sub', 'hardsub', 'hard-sub', 'japanese', 'ja']);
const DUB_TYPES = new Set(['dub', 's-dub', 'dubbed', 'english', 'en']);
const DUAL_TYPES = new Set(['dual-audio', 'dual', 'both', 'multi-audio']);

const serverId = (server) => server.accessId || server.streamId || server.$id || server.id || (embedLinksEnabled ? server.dataLink : null) || null;
const serverType = (server) => String(server.dataType || server.type || server.language || '').toLowerCase();

/**
 * Some dual-audio embed providers return the same URL for their SUB and DUB
 * server rows and select the actual audio track with a query parameter. Keep
 * that provider-specific detail on the server instead of leaking it into the UI.
 */
function withEmbedAudio(server) {
  if (!embedLinksEnabled || !embedAudioParam || !server.dataLink) return server;
  const type = serverType(server);
  const value = DUB_TYPES.has(type) ? embedDubValue : SUB_TYPES.has(type) ? embedSubValue : null;
  if (value === null) return server;
  try {
    const url = new URL(server.dataLink);
    if (!['https:', 'http:'].includes(url.protocol)) return server;
    url.searchParams.set(embedAudioParam, value);
    return { ...server, dataLink: url.href };
  } catch {
    return server;
  }
}

/** Merges every server array the provider may return, de-duplicates, then ranks. */
function mergeServers(payload) {
  const root = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
  const bucket = (value, hint = '') => ({ value, hint });
  const buckets = [
    bucket(Array.isArray(root) ? root : null), bucket(root?.data),
    bucket(root?.sub, 'sub'), bucket(root?.dub, 'dub'), bucket(root?.raw, 'sub'),
    bucket(root?.servers), bucket(root?.episode_links), bucket(root?.links),
    bucket(root?.sources), bucket(root?.mirrors), bucket(root?.streamingLinks),
    bucket(payload?.sub, 'sub'), bucket(payload?.dub, 'dub'), bucket(payload?.servers),
  ];
  const seen = new Set();
  const merged = [];
  for (const entry of buckets) {
    if (!Array.isArray(entry.value)) continue;
    for (const candidate of entry.value) {
      if (!candidate || typeof candidate !== 'object') continue;
      const type = serverType(candidate) || entry.hint;
      const server = type ? { ...candidate, dataType: type } : candidate;
      const id = serverId(server);
      const dedupeKey = `${type || 'unknown'}:${id}`;
      if (!id || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const prepared = withEmbedAudio({ ...server, accessId: String(id) });
      if (!embedLinksEnabled) delete prepared.dataLink;
      merged.push(prepared);
    }
  }
  const rank = (server) => SERVER_RANK[String(server.serverName || server.name || '').toUpperCase()] ?? 3;
  const sorted = merged
    .map((server, index) => ({ server, index }))
    .sort((a, b) => rank(a.server) - rank(b.server) || a.index - b.index)
    .map(({ server }) => server);

  const explicitSub = Array.isArray(root?.sub) ? new Set(root.sub.map(serverId).map(String)) : null;
  const explicitDub = Array.isArray(root?.dub) ? new Set(root.dub.map(serverId).map(String)) : null;
  const untyped = sorted.filter((server) => !serverType(server));
  return {
    sub: sorted.filter((s) => SUB_TYPES.has(serverType(s)) || DUAL_TYPES.has(serverType(s)) || explicitSub?.has(s.accessId) || untyped.includes(s)),
    dub: sorted.filter((s) => DUB_TYPES.has(serverType(s)) || DUAL_TYPES.has(serverType(s)) || explicitDub?.has(s.accessId)),
    all: sorted,
  };
}

const seconds = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function extractChapters(payload) {
  const chapterData = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
  const intro = { start: seconds(chapterData.intro_start ?? chapterData.introStart), end: seconds(chapterData.intro_end ?? chapterData.introEnd) };
  const outro = { start: seconds(chapterData.outro_start ?? chapterData.outroStart), end: seconds(chapterData.outro_end ?? chapterData.outroEnd) };
  return {
    intro: intro.start !== null && intro.end !== null && intro.end > intro.start ? intro : null,
    outro: outro.start !== null ? outro : null,
    duration: seconds(chapterData.duration),
  };
}

app.get('/api/provider/servers/:slug/:episode', asyncRoute(async (req, res) => {
  if (!baseUrl) return res.status(503).json({ message: 'Playback requires an authorized provider' });
  const route = fillPath(endpoint('PROVIDER_SERVERS_PATH', '/servers/{slug}/{episode}'), req.params);
  const payload = await providerRequest(route);
  const { sub, dub, all } = mergeServers(payload);
  res.json({
    sub,
    dub,
    servers: all,
    chapters: extractChapters(payload),
    availableLanguages: [['sub', sub], ['dub', dub]].filter(([, list]) => list.length).map(([key]) => key),
  });
}));

app.get('/api/provider/playback/:accessId', asyncRoute(async (req, res) => {
  if (!env.PROVIDER_PLAYBACK_PATH) return res.status(503).json({ message: 'Licensed playback endpoint is not configured' });
  const route = fillPath(env.PROVIDER_PLAYBACK_PATH, { id: req.params.accessId });
  const payload = await providerRequest(route);
  const playbackUrl = payload?.url || payload?.playbackUrl || payload?.stream?.url;
  if (!playbackUrl || !/^https:\/\//i.test(playbackUrl)) {
    return res.status(502).json({ message: 'Provider did not return a valid HTTPS playback URL' });
  }
  res.json({
    url: playbackUrl,
    subtitles: payload.subtitles || [],
    chapters: extractChapters(payload),
    thumbnailsVtt: payload.thumbnails_vtt || payload.thumbnailsVtt || null,
  });
}));

/** Storyboard sprites for scrub previews; only an authorized provider can supply these. */
app.get('/api/provider/thumbnails/:id', asyncRoute(async (req, res) => {
  if (!baseUrl || !env.PROVIDER_THUMBNAILS_PATH) {
    return res.status(503).json({ message: 'Thumbnail track endpoint is not configured' });
  }
  const route = fillPath(env.PROVIDER_THUMBNAILS_PATH, { id: req.params.id });
  res.json(await providerRequest(route));
}));

/** Crowdsourced OP/ED marks used when an embed does not expose chapters. */
app.get('/api/chapters/:malId/:episode', asyncRoute(async (req, res) => {
  const malId = Number(req.params.malId);
  const episode = Number(req.params.episode);
  const duration = Math.max(0, Number(req.query.duration) || 0);
  if (!Number.isInteger(malId) || malId < 1 || !Number.isInteger(episode) || episode < 1) {
    return res.status(400).json({ message: 'A valid MAL title ID and episode are required' });
  }
  const url = new URL(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}`);
  ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'].forEach((type) => url.searchParams.append('types', type));
  url.searchParams.set('episodeLength', duration.toFixed(3));
  const payload = await fetchJson(url, { timeoutMs: 8_000 });
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const interval = (entry) => {
    const start = Number(entry?.interval?.startTime);
    const end = Number(entry?.interval?.endTime);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
  };
  const find = (types) => results.find((entry) => types.includes(entry.skipType) && interval(entry));
  res.json({
    intro: interval(find(['op', 'mixed-op', 'recap'])),
    outro: interval(find(['ed', 'mixed-ed'])),
    duration,
  });
}));

/* ---------------------------------------------------------------- plumbing */

app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 502;
  res.status(status).json({ message: error.message || 'Upstream request failed' });
});

export default app;
