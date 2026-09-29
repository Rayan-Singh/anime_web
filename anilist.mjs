import { createCache, fetchJson, httpError } from './http.mjs';

const ENDPOINT = 'https://graphql.anilist.co';
const cache = createCache({ ttlMs: 600_000, max: 400 });

const MEDIA_CORE = `
  id idMal
  title { romaji english native }
  coverImage { extraLarge large medium color }
  bannerImage
  description(asHtml: false)
  averageScore meanScore popularity
  season seasonYear format status episodes duration
  genres isAdult
  startDate { year }
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt timeUntilAiring }
`;

/**
 * AniList has no day/week/month leaderboard, so each period maps to the closest
 * available sort: recent momentum, sustained popularity, then all-time rating.
 */
const PERIOD_SORT = { day: 'TRENDING_DESC', week: 'POPULARITY_DESC', month: 'SCORE_DESC' };

async function graphql(query, variables) {
  const payload = await fetchJson(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    timeoutMs: 12_000,
  });
  if (payload.errors?.length) throw httpError(502, payload.errors[0].message || 'AniList query failed');
  if (!payload.data) throw httpError(502, 'AniList returned no data');
  return payload.data;
}

const stripHtml = (value) => String(value || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export function mapMedia(media) {
  if (!media) return null;
  return {
    source: 'anilist',
    slug: String(media.id),
    anilistId: media.id,
    malId: media.idMal ?? null,
    title: media.title?.english || media.title?.romaji || media.title?.native || 'Untitled',
    romaji: media.title?.romaji || '',
    native: media.title?.native || '',
    cover_image: {
      extra_large: media.coverImage?.extraLarge || null,
      large: media.coverImage?.large || null,
      medium: media.coverImage?.medium || null,
    },
    banner: media.bannerImage || null,
    accent: media.coverImage?.color || null,
    description: stripHtml(media.description),
    score: media.averageScore ?? media.meanScore ?? null,
    popularity: media.popularity ?? 0,
    year: media.seasonYear || media.startDate?.year || null,
    season: media.season || null,
    format: media.format || 'TV',
    status: media.status || null,
    episodes: media.episodes ?? null,
    duration: media.duration ?? null,
    genres: media.genres || [],
    studio: media.studios?.nodes?.[0]?.name || null,
    next_episode: media.nextAiringEpisode
      ? { episode: media.nextAiringEpisode.episode, airing_at: media.nextAiringEpisode.airingAt }
      : null,
  };
}

export function search(q, limit = 20, page = 1) {
  return cache(`search:${q}:${limit}:${page}`, async () => {
    const data = await graphql(
      `query ($q: String, $limit: Int, $page: Int) {
        Page(page: $page, perPage: $limit) { media(search: $q, type: ANIME, sort: SEARCH_MATCH, isAdult: false) { ${MEDIA_CORE} } }
      }`,
      { q, limit, page },
    );
    return { results: data.Page.media.map(mapMedia).filter(Boolean) };
  }, 300_000);
}

export function top(period = 'week', limit = 20) {
  const sort = PERIOD_SORT[period] || PERIOD_SORT.week;
  return cache(`top:${sort}:${limit}`, async () => {
    const data = await graphql(
      `query ($sort: [MediaSort], $limit: Int) {
        Page(page: 1, perPage: $limit) { media(sort: $sort, type: ANIME, isAdult: false) { ${MEDIA_CORE} } }
      }`,
      { sort: [sort], limit },
    );
    return { period, sort, results: data.Page.media.map(mapMedia).filter(Boolean) };
  });
}

/** One round trip for both home rails, mirroring the reference's gather-based home route. */
export function home(limit = 20) {
  return cache(`home:${limit}`, async () => {
    const data = await graphql(
      `query ($limit: Int) {
        trending: Page(page: 1, perPage: $limit) { media(sort: TRENDING_DESC, type: ANIME, isAdult: false) { ${MEDIA_CORE} } }
        popular: Page(page: 1, perPage: $limit) { media(sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ${MEDIA_CORE} } }
        recent: Page(page: 1, perPage: $limit) { media(sort: START_DATE_DESC, type: ANIME, status: RELEASING, isAdult: false) { ${MEDIA_CORE} } }
        movies: Page(page: 1, perPage: $limit) { media(sort: SCORE_DESC, type: ANIME, format: MOVIE, isAdult: false) { ${MEDIA_CORE} } }
        upcoming: Page(page: 1, perPage: $limit) { media(sort: POPULARITY_DESC, type: ANIME, status: NOT_YET_RELEASED, isAdult: false) { ${MEDIA_CORE} } }
      }`,
      { limit },
    );
    return {
      latest_aired: data.recent.media.map(mapMedia).filter(Boolean),
      trending: data.trending.media.map(mapMedia).filter(Boolean),
      top_weekly: data.popular.media.map(mapMedia).filter(Boolean),
      movies: data.movies.media.map(mapMedia).filter(Boolean),
      upcoming: data.upcoming.media.map(mapMedia).filter(Boolean),
    };
  }, 600_000);
}

export function info(anilistId) {
  return cache(`info:${anilistId}`, async () => {
    const data = await graphql(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_CORE}
          streamingEpisodes { title thumbnail site }
          recommendations(sort: RATING_DESC, perPage: 12) {
            nodes { mediaRecommendation { ${MEDIA_CORE} } }
          }
        }
      }`,
      { id: Number(anilistId) },
    );
    const media = data.Media;
    if (!media) throw httpError(404, 'Title not found on AniList');
    return {
      ...mapMedia(media),
      episodes_list: mapStreamingEpisodes(media),
      recommendations: (media.recommendations?.nodes || [])
        .map((node) => mapMedia(node.mediaRecommendation))
        .filter(Boolean),
    };
  });
}

/**
 * AniList episode entries are metadata only (title + thumbnail), so they are marked
 * unplayable; a configured provider supplies the playable list.
 */
function mapStreamingEpisodes(media) {
  const listed = media.streamingEpisodes || [];
  if (listed.length) {
    return listed.map((episode, index) => ({
      id: `anilist-${media.id}-${index + 1}`,
      number: episodeNumber(episode.title, index),
      title: cleanEpisodeTitle(episode.title, index),
      thumbnail: episode.thumbnail || null,
      duration: media.duration ? `${media.duration} min` : null,
      playable: false,
    }));
  }
  const aired = media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : media.episodes;
  return Array.from({ length: Math.max(0, Math.min(aired || 0, 500)) }, (_, index) => ({
    id: `anilist-${media.id}-${index + 1}`,
    number: index + 1,
    title: `Episode ${index + 1}`,
    thumbnail: null,
    duration: media.duration ? `${media.duration} min` : null,
    playable: false,
  }));
}

const episodeNumber = (title, index) => Number(/episode\s+(\d+)/i.exec(title || '')?.[1]) || index + 1;
const cleanEpisodeTitle = (title, index) => {
  const trimmed = String(title || '').replace(/^episode\s+\d+\s*[-–—:]\s*/i, '').trim();
  return trimmed || `Episode ${index + 1}`;
};

export function schedule(days = 7) {
  const start = Math.floor(Date.now() / 1000);
  const end = start + days * 86_400;
  return cache(`schedule:${Math.floor(start / 3600)}:${days}`, async () => {
    const data = await graphql(
      `query ($start: Int, $end: Int) {
        Page(page: 1, perPage: 50) {
          airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
            episode airingAt
            media { ${MEDIA_CORE} }
          }
        }
      }`,
      { start, end },
    );
    const byDay = new Map();
    for (const slot of data.Page.airingSchedules) {
      if (!slot.media || slot.media.isAdult) continue;
      const date = new Date(slot.airingAt * 1000);
      const key = date.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, { date: key, day: date.toLocaleDateString('en-US', { weekday: 'long' }), items: [] });
      byDay.get(key).items.push({ episode: slot.episode, airing_at: slot.airingAt, ...mapMedia(slot.media) });
    }
    return { days: [...byDay.values()] };
  }, 900_000);
}

export function recommendations(anilistId) {
  return cache(`recs:${anilistId}`, async () => {
    const data = await graphql(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          recommendations(sort: RATING_DESC, perPage: 12) { nodes { mediaRecommendation { ${MEDIA_CORE} } } }
        }
      }`,
      { id: Number(anilistId) },
    );
    return {
      results: (data.Media?.recommendations?.nodes || [])
        .map((node) => mapMedia(node.mediaRecommendation))
        .filter(Boolean),
    };
  });
}
