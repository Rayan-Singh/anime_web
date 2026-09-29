import { createCache, fetchJson, httpError } from './http.mjs';

const ENDPOINT = 'https://kitsu.io/api/edge';
const cache = createCache({ ttlMs: 900_000, max: 300 });

function categoryNames(resource, included = []) {
  const ids = new Set((resource.relationships?.categories?.data || []).map((entry) => entry.id));
  return included.filter((entry) => entry.type === 'categories' && ids.has(entry.id)).map((entry) => entry.attributes?.title).filter(Boolean);
}

export function mapAnime(resource, included = []) {
  const anime = resource?.attributes;
  if (!resource?.id || !anime) return null;
  return {
    source: 'kitsu',
    slug: String(resource.id),
    anilistId: null,
    malId: null,
    title: anime.titles?.en || anime.canonicalTitle || anime.titles?.en_jp || anime.titles?.ja_jp || 'Untitled',
    romaji: anime.titles?.en_jp || anime.canonicalTitle || '',
    native: anime.titles?.ja_jp || '',
    cover_image: {
      extra_large: anime.posterImage?.original || anime.posterImage?.large || null,
      large: anime.posterImage?.large || anime.posterImage?.medium || null,
      medium: anime.posterImage?.small || anime.posterImage?.tiny || null,
    },
    banner: anime.coverImage?.original || anime.coverImage?.large || null,
    accent: null,
    description: anime.synopsis || anime.description || '',
    score: Number(anime.averageRating) || null,
    popularity: Number(anime.userCount) || 0,
    year: Number(String(anime.startDate || '').slice(0, 4)) || null,
    season: null,
    format: anime.subtype || 'TV',
    status: anime.status || null,
    episodes: anime.episodeCount ?? null,
    duration: anime.episodeLength ? `${anime.episodeLength} min` : null,
    genres: categoryNames(resource, included),
    studio: null,
    next_episode: null,
    externalUrl: `https://kitsu.app/anime/${resource.id}`,
  };
}

function request(pathname, query = {}) {
  const url = new URL(`${ENDPOINT}${pathname}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return fetchJson(url, { headers: { accept: 'application/vnd.api+json' }, timeoutMs: 15_000 });
}

const mapped = (payload) => (Array.isArray(payload?.data) ? payload.data : [payload?.data]).map((entry) => mapAnime(entry, payload?.included)).filter(Boolean);

export function search(q, limit = 20, page = 1) {
  return cache(`search:${q}:${limit}:${page}`, async () => ({
    source: 'kitsu',
    results: mapped(await request('/anime', { 'filter[text]': q, 'page[limit]': limit, 'page[offset]': (page - 1) * limit, include: 'categories' })),
  }), 300_000);
}

export function top(period = 'week', limit = 20) {
  const sort = period === 'day' ? '-startDate' : period === 'month' ? '-averageRating' : '-userCount';
  return cache(`top:${period}:${limit}`, async () => ({
    source: 'kitsu', period, sort,
    results: mapped(await request('/anime', { sort, 'page[limit]': limit, include: 'categories' })),
  }));
}

export function home(limit = 20) {
  return cache(`home:${limit}`, async () => {
    const load = (query) => request('/anime', { ...query, 'page[limit]': limit, include: 'categories' });
    const [recent, trending, popular, movies, upcoming] = await Promise.all([
      load({ 'filter[status]': 'current', sort: '-startDate' }),
      load({ sort: '-averageRating' }),
      load({ sort: '-userCount' }),
      load({ 'filter[subtype]': 'movie', sort: '-averageRating' }),
      load({ 'filter[status]': 'upcoming', sort: '-userCount' }),
    ]);
    return {
      source: 'kitsu', latest_aired: mapped(recent), trending: mapped(trending), top_weekly: mapped(popular),
      movies: mapped(movies), upcoming: mapped(upcoming),
    };
  });
}

export function info(id) {
  return cache(`info:${id}`, async () => {
    const payload = await request(`/anime/${encodeURIComponent(id)}`, { include: 'categories' });
    const anime = mapped(payload)[0];
    if (!anime) throw httpError(404, 'Title not found on Kitsu');
    const count = Math.max(0, Math.min(Number(anime.episodes) || 0, 500));
    return {
      ...anime,
      episodes_list: Array.from({ length: count }, (_, index) => ({
        id: `kitsu-${id}-${index + 1}`, number: index + 1, title: `Episode ${index + 1}`,
        thumbnail: null, duration: anime.duration, playable: false,
      })),
      recommendations: [],
    };
  });
}

function nextWeeklyDate(startDate) {
  const start = new Date(`${startDate || new Date().toISOString().slice(0, 10)}T12:00:00`);
  const result = new Date();
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() + (start.getDay() - result.getDay() + 7) % 7);
  if (result <= new Date()) result.setDate(result.getDate() + 7);
  return Math.floor(result.getTime() / 1000);
}

export function schedule(days = 7) {
  return cache(`schedule:${days}:${new Date().toISOString().slice(0, 10)}`, async () => {
    const payload = await request('/anime', { 'filter[status]': 'current', sort: '-userCount', 'page[limit]': 50, include: 'categories' });
    const included = payload.included || [];
    const byDay = new Map();
    for (const resource of payload.data || []) {
      const airingAt = nextWeeklyDate(resource.attributes?.startDate);
      if (airingAt > Date.now() / 1000 + days * 86_400) continue;
      const date = new Date(airingAt * 1000);
      const key = date.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, { date: key, day: date.toLocaleDateString('en-US', { weekday: 'long' }), items: [] });
      byDay.get(key).items.push({ episode: null, airing_at: airingAt, ...mapAnime(resource, included) });
    }
    return { source: 'kitsu', approximate: true, days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  });
}

export function recommendations() {
  return Promise.resolve({ source: 'kitsu', results: [] });
}
