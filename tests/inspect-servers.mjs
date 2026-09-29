const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
  Referer: 'https://reanime.to/',
  Accept: 'application/json',
};
const search = await (await fetch('https://reanime.to/api/v1/search?limit=5&q=attack', { headers })).json();
const list = search.results || search.data || search;
console.log('SEARCH KEYS:', Object.keys(search));
console.log('SEARCH SAMPLE:', JSON.stringify(list.slice ? list.slice(0, 3) : list).slice(0, 1500));
const first = (Array.isArray(list) ? list[0] : null);
const id = first?.anilist_id;
console.log('USING ANILIST ID:', id);
const res = await fetch(`https://reanime.to/api/flix/${id}/1`, { headers });
console.log('FLIX STATUS:', res.status);
const d = await res.json();
console.log('FLIX RAW:', JSON.stringify(d).slice(0, 2500));
