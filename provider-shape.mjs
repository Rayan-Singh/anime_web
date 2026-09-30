/**
 * Provider payload shaping, shared by the server routes and the browser's
 * client-direct mode so both produce identically grouped and ranked servers.
 * Keep this module free of Node built-ins: Vite bundles it into the client.
 */

/**
 * Quality preference for server names; anything unrecognised sorts last while
 * keeping its relative order.
 */
const SERVER_RANK = { 'HD-2': 0, 'HD-1': 1, 'HD': 2, 'SD': 4 };
const SUB_TYPES = new Set(['sub', 's-sub', 'subbed', 'softsub', 'soft-sub', 'hardsub', 'hard-sub', 'japanese', 'ja']);
const DUB_TYPES = new Set(['dub', 's-dub', 'dubbed', 'english', 'en']);
const DUAL_TYPES = new Set(['dual-audio', 'dual', 'both', 'multi-audio']);

const safePart = (value) => encodeURIComponent(String(value).replace(/[\r\n]/g, ''));

export const fillPath = (template, values) =>
  Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, safePart(value)), template);

export const serverType = (server) => String(server.dataType || server.type || server.language || '').toLowerCase();

const serverIdOf = (server, embedLinks) =>
  server.accessId || server.streamId || server.$id || server.id || (embedLinks ? server.dataLink : null) || null;

/**
 * Some dual-audio embed providers return the same URL for their SUB and DUB
 * server rows and select the actual audio track with a query parameter. Keep
 * that provider-specific detail on the server instead of leaking it into the UI.
 */
function withEmbedAudio(server, { embedLinks, embedAudioParam, embedSubValue, embedDubValue }) {
  if (!embedLinks || !embedAudioParam || !server.dataLink) return server;
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
export function mergeServers(payload, options = {}) {
  const shape = {
    embedLinks: Boolean(options.embedLinks),
    embedAudioParam: options.embedAudioParam || '',
    embedSubValue: String(options.embedSubValue ?? '0'),
    embedDubValue: String(options.embedDubValue ?? '1'),
  };
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
      const id = serverIdOf(server, shape.embedLinks);
      const dedupeKey = `${type || 'unknown'}:${id}`;
      if (!id || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const prepared = withEmbedAudio({ ...server, accessId: String(id) }, shape);
      if (!shape.embedLinks) delete prepared.dataLink;
      merged.push(prepared);
    }
  }
  const rank = (server) => SERVER_RANK[String(server.serverName || server.name || '').toUpperCase()] ?? 3;
  const sorted = merged
    .map((server, index) => ({ server, index }))
    .sort((a, b) => rank(a.server) - rank(b.server) || a.index - b.index)
    .map(({ server }) => server);

  const idsOf = (list) => new Set(list.map((entry) => serverIdOf(entry, shape.embedLinks)).map(String));
  const explicitSub = Array.isArray(root?.sub) ? idsOf(root.sub) : null;
  const explicitDub = Array.isArray(root?.dub) ? idsOf(root.dub) : null;
  const untyped = sorted.filter((server) => !serverType(server));
  return {
    sub: sorted.filter((s) => SUB_TYPES.has(serverType(s)) || DUAL_TYPES.has(serverType(s)) || explicitSub?.has(s.accessId) || untyped.includes(s)),
    dub: sorted.filter((s) => DUB_TYPES.has(serverType(s)) || DUAL_TYPES.has(serverType(s)) || explicitDub?.has(s.accessId)),
    all: sorted,
  };
}

const seconds = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

export function extractChapters(payload) {
  const chapterData = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
  const intro = { start: seconds(chapterData.intro_start ?? chapterData.introStart), end: seconds(chapterData.intro_end ?? chapterData.introEnd) };
  const outro = { start: seconds(chapterData.outro_start ?? chapterData.outroStart), end: seconds(chapterData.outro_end ?? chapterData.outroEnd) };
  return {
    intro: intro.start !== null && intro.end !== null && intro.end > intro.start ? intro : null,
    outro: outro.start !== null ? outro : null,
    duration: seconds(chapterData.duration),
  };
}

/** Every provider-supplied episode is playable by definition; catalog ones are not. */
export function unwrapEpisodes(payload) {
  const list = Array.isArray(payload) ? payload : payload?.episodes || payload?.data || [];
  return list.filter((episode) => episode && typeof episode === 'object').map((episode) => ({ ...episode, playable: true }));
}

/**
 * Normalises a playback payload. Returns null unless the provider supplied an
 * HTTPS media URL, so a mixed-content or malformed answer never reaches the
 * player.
 */
export function shapePlayback(payload) {
  const url = payload?.url || payload?.playbackUrl || payload?.stream?.url;
  if (!url || !/^https:\/\//i.test(url)) return null;
  return {
    url,
    subtitles: Array.isArray(payload.subtitles) ? payload.subtitles : [],
    chapters: extractChapters(payload),
    thumbnailsVtt: payload.thumbnails_vtt || payload.thumbnailsVtt || null,
  };
}

export const availableLanguages = ({ sub, dub }) =>
  [['sub', sub], ['dub', dub]].filter(([, list]) => list.length).map(([key]) => key);

/** Picks the provider entry matching an AniList title, preferring an exact name match. */
export function matchProviderSlug(payload, title) {
  const list = Array.isArray(payload) ? payload : payload?.results || payload?.data || payload?.anime || [];
  const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wanted = normalise(title);
  const match = list.find((item) => normalise(item.title?.english || item.title?.romaji || item.title || item.name) === wanted) || list[0];
  const slug = match && (match.slug || match.id || match.$id || match.anilist_id || match.anilistId || match.anime_id || match.animeId);
  if (!slug) return null;
  return { providerSlug: String(slug), matchedTitle: match.title?.english || match.title || match.name || title };
}
