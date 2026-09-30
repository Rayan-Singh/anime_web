import { availableLanguages, extractChapters, fillPath, matchProviderSlug, mergeServers, shapePlayback, unwrapEpisodes } from '../provider-shape.mjs';

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['results', 'items', 'anime', 'data', 'episodes', 'latest', 'latestAired', 'latest_aired', 'top', 'top_weekly', 'trending']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

function normalizeGenres(genres) {
  if (!Array.isArray(genres)) return [];
  return genres.map((genre) => typeof genre === 'string' ? genre : genre?.name).filter(Boolean);
}

function coverImage(item) {
  const cover = item.cover_image || item.coverImage || {};
  return firstValue(item.poster, item.image, cover.extra_large, cover.large, cover.medium, item.cover, '/assets/poster-starbound.png');
}

const titleCase = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function normalizeTitle(item, index = 0) {
  if (!item) return null;
  const slug = firstValue(item.slug, item.$id, item.id, item.animeId);
  const title = firstValue(item.title?.english, item.title?.romaji, item.title, item.name, item.english_title);
  if (!slug || !title) return null;
  const score = Number(firstValue(item.score, item.rating, item.average_score, item.mean_score, 0));
  return {
    id: `${item.source || 'provider'}:${slug}`,
    source: item.source || 'provider',
    slug: String(slug),
    anilistId: firstValue(item.anilistId, item.anilist_id, item.anilist, null),
    malId: firstValue(item.malId, item.mal_id, null),
    title: String(title),
    japanese: firstValue(item.native, item.title?.native, item.japanese, item.native_title, item.romaji, ''),
    image: coverImage(item),
    banner: firstValue(item.banner, item.bannerImage, null),
    accent: firstValue(item.accent, '#8d7dff'),
    score: score > 10 ? (score / 10).toFixed(1) : score.toFixed(1),
    year: firstValue(item.year, item.releaseYear, item.start_date?.year, new Date().getFullYear()),
    type: titleCase(firstValue(item.type, item.format, 'Series')),
    status: titleCase(firstValue(item.status, item.airing_status, 'Catalog')),
    episodes: Number(firstValue(item.episodes, item.episodeCount, item.total_episodes, item.episode_count, 0)) || 0,
    duration: firstValue(item.duration, null),
    studio: firstValue(item.studio, null),
    progress: 0,
    genres: normalizeGenres(item.genres),
    blurb: firstValue(item.description, item.synopsis, item.overview, 'No synopsis available for this title yet.'),
    episodeTitle: 'Episode 1',
    nextEpisode: item.next_episode || null,
    providerItem: true,
    order: index,
  };
}

export function normalizeEpisode(episode, index = 0) {
  const number = Number(firstValue(episode.number, episode.episode, episode.episode_number, episode.episode_num, index + 1));
  return {
    id: String(firstValue(episode.$id, episode.id, `episode-${number}`)),
    number,
    title: String(firstValue(episode.title, episode.name, `Episode ${number}`)),
    duration: firstValue(episode.duration, episode.runtime, null),
    thumbnail: firstValue(episode.thumbnail, episode.image, null),
    playable: episode.playable !== false,
  };
}

async function api(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({ message: 'Invalid provider response' }));
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
  return payload;
}

const mapTitles = (list) => list.map(normalizeTitle).filter(Boolean);

/** Provider configuration is static, so one in-flight request serves every caller. */
let statusPromise = null;
function providerStatus() {
  statusPromise ||= api('/api/provider/status').catch((error) => { statusPromise = null; throw error; });
  return statusPromise;
}

export const getProviderStatus = () => providerStatus();

/**
 * A missing CORS header is a property of the provider, not of one request, so
 * the first blocked call turns direct mode off for the rest of the session
 * rather than making every later call pay a failed round trip.
 */
let directBlocked = false;

const clientDirect = async () => {
  if (directBlocked) return null;
  try { return (await providerStatus()).clientDirect || null; }
  catch { return null; }
};

/**
 * Calls the provider straight from this browser, trying each mirror in turn.
 * The visitor's own address and browser satisfy bot checks that reject a
 * serverless function. A provider without permissive CORS headers rejects the
 * read, so every caller falls back to the same-origin API route.
 */
async function providerDirect(config, providerPath, query = {}) {
  let lastError;
  let blocked = false;
  for (const origin of config.baseUrls) {
    const url = new URL(`${origin}${providerPath.startsWith('/') ? providerPath : `/${providerPath}`}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    });
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error(`Provider responded ${response.status}`);
      return await response.json();
    } catch (error) {
      // fetch reports a CORS block or a dead host as TypeError; an HTTP status
      // came back over a working cross-origin channel and is worth retrying.
      if (error instanceof TypeError) blocked = true;
      console.warn(`[provider] direct call to ${url.host} failed: ${error.message}`);
      lastError = error;
    }
  }
  if (blocked) {
    directBlocked = true;
    console.warn('[provider] direct provider calls are unavailable from this browser; using the site API instead');
  }
  throw lastError || new Error('No provider mirror answered');
}

/** Provider episodes fetched by the browser, or null when that is not possible. */
async function directEpisodes(providerSlug) {
  const config = await clientDirect();
  if (!config || !providerSlug) return null;
  try {
    const episodes = unwrapEpisodes(await providerDirect(config, fillPath(config.episodesPath, { slug: providerSlug })));
    return episodes.length ? episodes : null;
  } catch { return null; }
}

export const getEpisodeChapters = (malId, episode, duration = 0) =>
  api(`/api/chapters/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}?duration=${Math.max(0, Number(duration) || 0)}`);

/** Returns every home rail in one request so the page renders from a single round trip. */
export async function getProviderHome(limit = 20, source = 'anilist') {
  const payload = await api(`/api/provider/home?limit=${limit}&source=${encodeURIComponent(source)}`);
  return {
    latest: mapTitles(unwrapList(payload.latest_aired)),
    trending: mapTitles(unwrapList(payload.trending)),
    popular: mapTitles(unwrapList(payload.top_weekly)),
    movies: mapTitles(unwrapList(payload.movies)),
    upcoming: mapTitles(unwrapList(payload.upcoming)),
  };
}

export const searchProvider = async (query, limit = 20, source = 'anilist') =>
  mapTitles(unwrapList(await api(`/api/provider/search?q=${encodeURIComponent(query)}&limit=${limit}&source=${encodeURIComponent(source)}`)));

export const getProviderTop = async (period = 'week', limit = 20, source = 'anilist') =>
  mapTitles(unwrapList(await api(`/api/provider/top?period=${encodeURIComponent(period)}&limit=${limit}&source=${encodeURIComponent(source)}`)));

export const getRecommendations = async (catalogId, source = 'anilist') =>
  mapTitles(unwrapList(await api(`/api/provider/recommendations/${encodeURIComponent(catalogId)}?source=${encodeURIComponent(source)}`)));

export async function getSchedule(days = 7, source = 'anilist') {
  const payload = await api(`/api/provider/schedule?days=${days}&source=${encodeURIComponent(source)}`);
  return (payload.days || []).map((slot) => ({
    date: slot.date,
    day: slot.day,
    items: slot.items.map((entry, index) => ({
      ...normalizeTitle(entry, index),
      airingEpisode: entry.episode,
      airingAt: entry.airing_at,
    })).filter((entry) => entry.id),
  }));
}

export async function getProviderTitle(item) {
  if (!item.slug) throw new Error('This title has no catalog identifier');
  const config = await clientDirect();
  const browserFetchesEpisodes = Boolean(config && item.providerSlug);
  const params = new URLSearchParams({ source: item.source || 'anilist' });
  // Only ask the server to reach the provider when the browser will not, so the
  // two never duplicate the same upstream call.
  if (item.providerSlug && !browserFetchesEpisodes) params.set('providerSlug', item.providerSlug);

  const [payload, direct] = await Promise.all([
    api(`/api/provider/info/${encodeURIComponent(item.slug)}?${params}`),
    browserFetchesEpisodes ? directEpisodes(item.providerSlug) : null,
  ]);

  // A blocked direct call leaves the catalog's non-playable episode list, so
  // recover the playable one through the server before giving up on it.
  const episodes = direct || (browserFetchesEpisodes ? await serverEpisodes(item) : null) || payload.episodes || [];
  const normalized = normalizeTitle({ ...payload, slug: item.slug }) || item;
  return {
    ...normalized,
    episodeList: episodes.map(normalizeEpisode).filter((episode) => Number.isFinite(episode.number)),
    playableEpisodes: Boolean(direct || payload.playableEpisodes || episodes.some((episode) => episode.playable)),
    recommendations: mapTitles(payload.recommendations || []),
  };
}

/** The same-origin episode route, returning null unless it reached the provider. */
async function serverEpisodes(item) {
  const params = new URLSearchParams({ source: item.source || 'anilist', providerSlug: item.providerSlug });
  const payload = await api(`/api/provider/episodes/${encodeURIComponent(item.slug)}?${params}`).catch(() => null);
  return payload?.playable ? payload.episodes : null;
}

export async function getProviderEpisodes(item) {
  if (!item.slug) return [];
  const direct = await directEpisodes(item.providerSlug);
  if (direct) return direct.map(normalizeEpisode).filter((episode) => Number.isFinite(episode.number));
  const params = new URLSearchParams({ source: item.source || 'anilist' });
  if (item.providerSlug) params.set('providerSlug', item.providerSlug);
  const payload = await api(`/api/provider/episodes/${encodeURIComponent(item.slug)}?${params}`);
  return unwrapList(payload).map(normalizeEpisode).filter((episode) => Number.isFinite(episode.number));
}

/** Maps an AniList title onto the configured provider's own slug. */
export async function resolveProviderSlug(item) {
  if (item.providerSlug) return item.providerSlug;
  const config = await clientDirect();
  if (config?.resolveByAnilistId && item.anilistId) return String(item.anilistId);
  if (config) {
    try {
      const payload = await providerDirect(config, config.searchPath, { q: item.title, limit: 10 });
      const matched = matchProviderSlug(payload, item.title);
      if (matched) return matched.providerSlug;
    } catch { /* CORS or provider refusal: the server route below tries next */ }
  }
  const params = new URLSearchParams({ title: item.title });
  if (item.anilistId) params.set('anilistId', item.anilistId);
  const payload = await api(`/api/provider/resolve?${params}`);
  return payload.providerSlug;
}

export async function getProviderAvailability(item) {
  const params = new URLSearchParams({ title: item.title });
  if (item.anilistId) params.set('anilistId', item.anilistId);
  return api(`/api/provider/availability?${params}`);
}

const playbackServerId = (server) => String(firstValue(server?.accessId, server?.streamId, server?.$id, server?.id, ''));

const normalizePlaybackServer = (server, language, index) => ({
  ...server,
  id: playbackServerId(server) || `${language}-${index}`,
  name: String(firstValue(server.serverName, server.name, `Server ${index + 1}`)),
  quality: String(firstValue(server.quality, server.resolution, server.label) || '').toUpperCase(),
  language,
});

/**
 * Prefers the browser's own call to the provider and falls back to the
 * same-origin route, so a provider without CORS keeps working as before.
 */
async function fetchServers(providerSlug, episode) {
  const config = await clientDirect();
  if (config) {
    try {
      const payload = await providerDirect(config, fillPath(config.serversPath, { slug: providerSlug, episode }));
      const { sub, dub } = mergeServers(payload, config);
      if (sub.length || dub.length) {
        return { sub, dub, chapters: extractChapters(payload), availableLanguages: availableLanguages({ sub, dub }) };
      }
    } catch { /* CORS or provider refusal: the server route below tries next */ }
  }
  return api(`/api/provider/servers/${encodeURIComponent(providerSlug)}/${episode}`);
}

/** Returns every provider-supplied server so the watch page can expose them. */
export async function getProviderServers(item, episode = 1) {
  const providerSlug = await resolveProviderSlug(item);
  if (!providerSlug) throw new Error('This title is not available from the configured provider');

  const servers = await fetchServers(providerSlug, episode);
  const groups = {
    sub: (Array.isArray(servers.sub) ? servers.sub : []).map((server, index) => normalizePlaybackServer(server, 'sub', index)),
    dub: (Array.isArray(servers.dub) ? servers.dub : []).map((server, index) => normalizePlaybackServer(server, 'dub', index)),
  };
  return {
    ...groups,
    providerSlug,
    chapters: servers.chapters || null,
    availableLanguages: servers.availableLanguages || ['sub', 'dub'].filter((key) => groups[key].length),
  };
}

/**
 * Resolves the media payload in the browser when the provider allows it. Only
 * the manifest call moves: the media itself is already fetched by the player
 * element, never by the site's API.
 */
async function fetchPlayback(accessId) {
  const config = await clientDirect();
  if (config?.playbackPath) {
    try {
      const playback = shapePlayback(await providerDirect(config, fillPath(config.playbackPath, { id: accessId })));
      if (playback) return playback;
    } catch { /* CORS or provider refusal: the server route below tries next */ }
  }
  return api(`/api/provider/playback/${encodeURIComponent(accessId)}`);
}

/** Exchanges one selected server for either an embed or direct media payload. */
export async function resolveProviderServer(server, serverChapters = null) {
  const accessId = playbackServerId(server);
  if (!accessId) throw new Error('Provider returned no licensed stream identifier');

  // Prefer direct authorized media so app-level playback controls work. An
  // embed-only provider falls back to its iframe when that endpoint is absent.
  try {
    const playback = await fetchPlayback(accessId);
    return {
      ...playback,
      chapters: mergeChapters(serverChapters, playback.chapters),
      language: server.language,
      serverId: server.id,
      serverName: server.name || 'Official',
    };
  } catch (error) {
    if (!server.dataLink) throw error;
  }

  if (server.dataLink) {
    let embedUrl;
    try {
      const parsed = new URL(server.dataLink);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error();
      embedUrl = parsed.href;
    } catch {
      throw new Error('Provider returned an invalid embed URL');
    }
    return {
      embedUrl,
      subtitles: [],
      chapters: serverChapters,
      language: server.language,
      serverId: server.id,
      serverName: server.name || 'Embed',
    };
  }

}

export async function resolveProviderPlayback(item, episode = 1, language = 'sub', requestedServerId = '') {
  const options = await getProviderServers(item, episode);
  const preferred = options[language]?.length ? options[language] : options[language === 'sub' ? 'dub' : 'sub'] || [];
  const selected = preferred.find((server) => server.id === requestedServerId) || preferred[0];
  if (!selected) throw new Error('Provider returned no licensed stream identifier');
  return {
    ...await resolveProviderServer(selected, options.chapters),
    providerSlug: options.providerSlug,
    availableLanguages: options.availableLanguages,
  };
}

/** Playback-level chapter marks win; the server list fills any gaps. */
function mergeChapters(fromServers = {}, fromPlayback = {}) {
  return {
    intro: fromPlayback?.intro || fromServers?.intro || null,
    outro: fromPlayback?.outro || fromServers?.outro || null,
    duration: fromPlayback?.duration ?? fromServers?.duration ?? null,
  };
}
