import http from 'node:http';

const title = {
  slug: 'licensed-test-title',
  title: 'Licensed Test Title',
  poster: '/assets/poster-starbound.png',
  score: 9.2,
  year: 2026,
  type: 'Series',
  status: 'Testing',
  episodes: 2,
  subbed: 2,
  dubbed: 1,
  genres: ['Adventure'],
  description: 'A local fixture used to verify the authorized provider contract.',
};

const episodes = [
  { id: 'licensed-ep-1', number: 1, title: 'The authorized beginning', duration: '24 min' },
  { id: 'licensed-ep-2', number: 2, title: 'The second chapter', duration: '24 min' },
];

/**
 * Deliberately messy: unsorted server names, a duplicate across buckets, and a
 * loose `episode_links` array, so the merge/dedupe/rank path is exercised.
 */
const servers = {
  sub: [
    { $id: 'licensed-episode-1-sd', serverName: 'SD', dataType: 'sub', dataLink: 'https://player.example/embed/episode-1?v=1' },
    { $id: 'licensed-episode-1', serverName: 'HD-2', dataType: 'sub', dataLink: 'https://player.example/embed/episode-1?v=2' },
  ],
  dub: [{ $id: 'licensed-episode-1-dub', serverName: 'HD-1', dataType: 'dub', dataLink: 'https://player.example/embed/episode-1?v=1' }],
  episode_links: [
    { $id: 'licensed-episode-1', serverName: 'HD-2', dataType: 'sub', dataLink: 'https://player.example/embed/episode-1?v=2' },
    { $id: 'licensed-episode-1-alt', serverName: 'HD-1', dataType: 's-sub', dataLink: 'https://player.example/embed/episode-1?v=1' },
  ],
  duration: 1440,
  intro_start: 12,
  intro_end: 102,
  outro_start: 1350,
  outro_end: 1420,
};

const stream = {
  url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  subtitles: [],
  thumbnails_vtt: null,
};

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer test-key') {
    res.statusCode = 401;
    return res.end(JSON.stringify({ message: 'Unauthorized' }));
  }
  const url = new URL(req.url, 'http://127.0.0.1:9393');
  const send = (payload) => res.end(JSON.stringify(payload));

  if (url.pathname === '/home' || url.pathname === '/search') return send({ results: [title] });
  if (url.pathname === '/info/licensed-test-title') return send(title);
  if (url.pathname === '/episodes/licensed-test-title') return send({ episodes });
  if (/^\/servers\/licensed-test-title\/\d+$/.test(url.pathname)) return send(servers);
  if (url.pathname.startsWith('/stream/')) return send(stream);
  if (url.pathname.startsWith('/thumbnails/')) return send({ vtt: null, sprites: [] });

  res.statusCode = 404;
  return send({ message: 'Not found' });
});

server.listen(9393, '127.0.0.1', () => console.log('Mock licensed provider running at http://127.0.0.1:9393'));
