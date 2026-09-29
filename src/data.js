const demoVideo = import.meta.env.VITE_DEMO_VIDEO_URL ||
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

export const titles = [
  {
    id: 'city-after-rain', title: 'City After Rain', japanese: '雨上がりの街',
    image: '/assets/poster-neon-runner.png', accent: '#ff6f61', score: 9.1,
    year: 2026, type: 'Series', status: 'New', episodes: 12, progress: 63,
    genres: ['Sci-Fi', 'Drama', 'Adventure'],
    blurb: 'A courier who can hear memories hidden in rainfall races across a divided city to deliver one final message.',
    episodeTitle: 'The city remembers', video: demoVideo,
  },
  {
    id: 'orbit-of-us', title: 'The Orbit of Us', japanese: '星を待つ丘',
    image: '/assets/poster-starbound.png', accent: '#8d7dff', score: 8.8,
    year: 2026, type: 'Series', status: 'Trending', episodes: 10, progress: 28,
    genres: ['Fantasy', 'Slice of Life', 'Mystery'],
    blurb: 'A quiet stargazer finds a celestial companion and a map to the sky that should not exist.',
    episodeTitle: 'A visitor made of light', video: demoVideo,
  },
  {
    id: 'lanterns-of-aokigawa', title: 'Lanterns of Aokigawa', japanese: '青木川の灯',
    image: '/assets/poster-silent-bamboo.png', accent: '#52b6c7', score: 9.3,
    year: 2025, type: 'Series', status: 'Top rated', episodes: 24, progress: 0,
    genres: ['Adventure', 'Mystery', 'Historical'],
    blurb: 'A wandering cartographer follows a river of lanterns toward a mountain that vanishes at sunrise.',
    episodeTitle: 'Where the river turns', video: demoVideo,
  },
  {
    id: 'static-heart', title: 'Static Heart', japanese: '静電の心',
    image: '/assets/poster-neon-runner.png', accent: '#ff9b72', score: 8.5,
    year: 2025, type: 'Movie', status: 'Movie', episodes: 1, progress: 0,
    genres: ['Romance', 'Sci-Fi'],
    blurb: 'Two radio operators separated by time find each other on a frequency that only appears during storms.',
    episodeTitle: 'Feature presentation', video: demoVideo,
  },
  {
    id: 'small-gods-club', title: 'Small Gods Club', japanese: '小さな神様部',
    image: '/assets/poster-starbound.png', accent: '#f2c66d', score: 8.7,
    year: 2026, type: 'Series', status: 'Weekly', episodes: 8, progress: 0,
    genres: ['Comedy', 'Fantasy', 'School'],
    blurb: 'Four students accidentally adopt a forgotten constellation and must help it earn a place in the night sky.',
    episodeTitle: 'Club rules for deities', video: demoVideo,
  },
  {
    id: 'blue-sword-morning', title: 'Blue Sword Morning', japanese: '蒼剣の朝',
    image: '/assets/poster-silent-bamboo.png', accent: '#6d8dff', score: 8.9,
    year: 2024, type: 'Series', status: 'Complete', episodes: 13, progress: 0,
    genres: ['Drama', 'Adventure'],
    blurb: 'At the end of an age, a reluctant guardian crosses the valley to return a sword that was never drawn.',
    episodeTitle: 'The unopened letter', video: demoVideo,
  },
];

export const schedule = [
  { day: 'MON', items: ['City After Rain', 'Small Gods Club'] },
  { day: 'TUE', items: ['The Orbit of Us'] },
  { day: 'WED', items: ['Lanterns of Aokigawa', 'Blue Sword Morning'] },
  { day: 'THU', items: ['Static Heart'] },
  { day: 'FRI', items: ['City After Rain', 'The Orbit of Us'] },
];
