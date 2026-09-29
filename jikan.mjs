import { createCache, fetchJson, httpError } from './http.mjs';

const ENDPOINT = 'https://api.jikan.moe/v4';
const cache = createCache({ ttlMs: 900_000, max: 300 });

const text = (value) => String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

export function mapAnime(anime) {
  if (!anime?.mal_id) return null;
  const genres = [...(anime.genres || []), ...(anime.themes || []), ...(anime.demographics || [])]
    .map((entry) => entry?.name)
    .filter(Boolean);
  return {
    source: 'jikan',
    slug: String(anime.mal_id),
    anilistId: null,
    malId: anime.mal_id,
    title: anime.title_english || anime.title || anime.title_japanese || 'Untitled',
    romaji: anime.title || '',
    native: anime.title_japanese || '',
    cover_image: {
      extra_large: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url || null,
      large: anime.images?.webp?.image_url || anime.images?.jpg?.image_url || null,
      medium: anime.images?.webp?.small_image_url || anime.images?.jpg?.small_image_url || null,
    },
    banner: anime.trailer?.images?.maximum_image_url || anime.trailer?.images?.large_image_url || null,
    accent: null,
    description: text(anime.synopsis || anime.background),
    score: anime.score ?? null,
    popularity: anime.members || anime.popularity || 0,
    year: anime.year || anime.aired?.prop?.from?.year || null,
    season: anime.season?.toUpperCase?.() || null,
    format: anime.type || 'TV',
    status: anime.status || null,
    episodes: anime.episodes ?? null,
    duration: anime.duration || null,
    genres: [...new Set(genres)],
    studio: anime.studios?.[0]?.name || anime.producers?.[0]?.name || null,
    next_episode: null,
    externalUrl: anime.url || null,
  };
}

let requestQueue = Promise.resolve();

const request = (pathname, query = {}) => {
  const url = new URL(`${ENDPOINT}${pathname}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const queued = requestQueue.then(async () => {
    try {
      return await fetchJson(url, { timeoutMs: 15_000 });
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  });
  requestQueue = queued.catch(() => {});
  return queued;
};

const mapped = (payload) => (payload?.data || []).map(mapAnime).filter(Boolean);

export function search(q, limit = 20, page = 1) {
  return cache(`search:${q}:${limit}:${page}`, async () => ({
    source: 'jikan',
    results: mapped(await request('/anime', { q, limit, page, sfw: true, order_by: 'popularity', sort: 'asc' })),
  }), 300_000);
}

export function top(period = 'week', limit = 20) {
  const filter = period === 'day' ? 'airing' : period === 'week' ? 'bypopularity' : '';
  return cache(`top:${period}:${limit}`, async () => ({
    source: 'jikan', period, sort: filter || 'score',
    results: mapped(await request('/top/anime', { filter, limit, sfw: true })),
  }));
}

export function home(limit = 20) {
  return cache(`home:${limit}`, async () => {
    const [season, popular, topRated, movies, upcoming] = await Promise.all([
      request('/seasons/now', { limit, sfw: true }),
      request('/top/anime', { filter: 'bypopularity', limit, sfw: true }),
      request('/top/anime', { limit, sfw: true }),
      request('/top/anime', { type: 'movie', limit, sfw: true }),
      request('/seasons/upcoming', { limit, sfw: true }),
    ]);
    return {
      source: 'jikan',
      latest_aired: mapped(season),
      trending: mapped(topRated),
      top_weekly: mapped(popular),
      movies: mapped(movies),
      upcoming: mapped(upcoming),
    };
  });
}

export function info(malId) {
  return cache(`info:${malId}`, async () => {
    const [detail, recommended] = await Promise.all([
      request(`/anime/${encodeURIComponent(malId)}/full`),
      request(`/anime/${encodeURIComponent(malId)}/recommendations`).catch(() => ({ data: [] })),
    ]);
    if (!detail?.data) throw httpError(404, 'Title not found on MyAnimeList');
    const anime = detail.data;
    const count = Math.max(0, Math.min(Number(anime.episodes) || 0, 500));
    return {
      ...mapAnime(anime),
      episodes_list: Array.from({ length: count }, (_, index) => ({
        id: `jikan-${anime.mal_id}-${index + 1}`,
        number: index + 1,
        title: `Episode ${index + 1}`,
        thumbnail: null,
        duration: anime.duration || null,
        playable: false,
      })),
      recommendations: (recommended.data || []).map((entry) => mapAnime(entry.entry)).filter(Boolean),
    };
  });
}

function nextBroadcast(anime) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const wanted = days.indexOf(String(anime.broadcast?.day || '').replace(/s$/, ''));
  const now = new Date();
  const result = new Date(now);
  const delta = wanted < 0 ? 0 : (wanted - now.getDay() + 7) % 7;
  result.setDate(result.getDate() + delta);
  const [hour, minute] = String(anime.broadcast?.time || '00:00').split(':').map(Number);
  result.setHours(hour || 0, minute || 0, 0, 0);
  if (result <= now) result.setDate(result.getDate() + 7);
  return Math.floor(result.getTime() / 1000);
}

export function schedule(days = 7) {
  return cache(`schedule:${days}:${new Date().toISOString().slice(0, 10)}`, async () => {
    const payload = await request('/schedules', { limit: 50, sfw: true });
    const byDay = new Map();
    for (const anime of payload.data || []) {
      const airingAt = nextBroadcast(anime);
      if (airingAt > Date.now() / 1000 + days * 86_400) continue;
      const date = new Date(airingAt * 1000);
      const key = date.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, { date: key, day: date.toLocaleDateString('en-US', { weekday: 'long' }), items: [] });
      byDay.get(key).items.push({ episode: null, airing_at: airingAt, ...mapAnime(anime) });
    }
    return { source: 'jikan', days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  });
}

export function recommendations(malId) {
  return cache(`recs:${malId}`, async () => {
    const payload = await request(`/anime/${encodeURIComponent(malId)}/recommendations`);
    return { source: 'jikan', results: (payload.data || []).map((entry) => mapAnime(entry.entry)).filter(Boolean) };
  });
}
