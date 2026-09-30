import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { titles } from './data.js';
import { getEpisodeChapters, getProviderAvailability, getProviderHome, getProviderServers, getProviderStatus, getProviderTitle, getProviderTop, getSchedule, resolveProviderPlayback, resolveProviderServer, searchProvider } from './provider.js';
import { getAccount, saveAccountProgress, signIn, signOut, signUp } from './account.js';

const Icon = ({ name, size = 19, stroke = 1.8 }) => {
  const paths = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    bookmark: <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    play: <path d="m9 7 8 5-8 5V7Z"/>, plus: <path d="M12 5v14M5 12h14"/>,
    check: <path d="m5 12 4 4L19 6"/>, info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>, chevron: <path d="m9 18 6-6-6-6"/>,
    spark: <path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/>,
    skip: <><path d="m5 5 9 7-9 7V5Z"/><path d="M19 5v14"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

const navItems = [['Home', 'home'], ['Latest', 'spark'], ['Top Airing', 'compass'], ['Schedule', 'calendar'], ['My List', 'bookmark']];
const discoverItems = ['Search', 'Browse', 'Random'];
const mergeChapterData = (preferred, fallback) => ({
  intro: preferred?.intro || fallback?.intro || null,
  outro: preferred?.outro || fallback?.outro || null,
  duration: preferred?.duration || fallback?.duration || null,
});
const inspectRedirectUrl = 'https://www.youtube.com/';

function useInspectRedirect() {
  useEffect(() => {
    let redirected = false;
    const redirect = () => {
      if (redirected) return;
      redirected = true;
      window.location.replace(inspectRedirectUrl);
    };
    const onKeyDown = (event) => {
      const key = event.key.toLowerCase();
      const windowsDevtools = event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key);
      const macDevtools = event.metaKey && event.altKey && ['i', 'j', 'c'].includes(key);
      const viewSource = (event.ctrlKey || event.metaKey) && key === 'u';
      if (event.key === 'F12' || windowsDevtools || macDevtools || viewSource) {
        event.preventDefault();
        event.stopImmediatePropagation();
        redirect();
      }
    };
    const detectDockedDevtools = () => {
      if (window.innerWidth < 768) return;
      const widthGap = Math.max(0, window.outerWidth - window.innerWidth);
      const heightGap = Math.max(0, window.outerHeight - window.innerHeight);
      if (widthGap > 220 || heightGap > 220) redirect();
    };
    const detectDebugger = () => {
      const startedAt = performance.now();
      // This pauses only when a desktop debugger is actively attached.
      debugger; // eslint-disable-line no-debugger
      if (performance.now() - startedAt > 160) redirect();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', detectDockedDevtools);
    const detector = window.setInterval(() => {
      detectDockedDevtools();
      detectDebugger();
    }, 1200);
    const initialCheck = window.setTimeout(detectDockedDevtools, 400);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', detectDockedDevtools);
      window.clearInterval(detector);
      window.clearTimeout(initialCheck);
    };
  }, []);
}

export default function App() {
  useInspectRedirect();
  const [page, setPage] = useState('Home');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [genre, setGenre] = useState('All');
  const [notice, setNotice] = useState('');
  const [catalog, setCatalog] = useState(titles);
  const [rails, setRails] = useState({ latest: [], trending: [], popular: [], movies: [], upcoming: [] });
  const [catalogSource, setCatalogSource] = useState(() => localStorage.getItem('kairo-catalog-source') || 'auto');
  const [providerStatus, setProviderStatus] = useState({ configured: false, providerConfigured: false, playbackEnabled: false, mode: 'demo' });
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [continueWatching, setContinueWatching] = useState([]);
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kairo-list')) || ['lanterns-of-aokigawa']; }
    catch { return ['lanterns-of-aokigawa']; }
  });

  useEffect(() => localStorage.setItem('kairo-list', JSON.stringify(watchlist)), [watchlist]);
  useEffect(() => {
    let active = true;
    getAccount().then((payload) => {
      if (!active) return;
      setUser(payload.user);
      setContinueWatching(payload.progress || []);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!/^\/watch\/?$/.test(window.location.pathname)) return undefined;
    const params = new URLSearchParams(window.location.search);
    const catalogId = params.get('aid') || params.get('slug');
    if (!catalogId) return undefined;
    let active = true;
    getProviderTitle({ slug: catalogId, anilistId: params.get('aid') || null, source: params.get('source') || 'anilist', providerItem: true })
      .then((result) => {
        if (!active) return;
        const requestedEpisode = Math.max(1, Number(params.get('ep')) || 1);
        setPlaying({ ...result, playbackEpisode: requestedEpisode, episodeTitle: `Episode ${requestedEpisode}` });
      })
      .catch((reason) => active && setNotice(reason.message || 'That watch link could not be opened'));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    getProviderStatus().then(async (status) => {
      if (!active) return;
      setProviderStatus(status);
      const remote = await getProviderHome(20, catalogSource);
      if (!active) return;
      setRails(remote);
      const merged = [...remote.trending, ...remote.latest, ...remote.popular]
        .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index);
      if (merged.length) setCatalog(merged);
    }).catch((reason) => setNotice(reason.message || 'The selected catalog is temporarily unavailable'));
    return () => { active = false; };
  }, [catalogSource]);
  useEffect(() => localStorage.setItem('kairo-catalog-source', catalogSource), [catalogSource]);
  useEffect(() => {
    const openSearch = (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if ((event.key === '/' && !isTyping) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 2200);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleList = (item) => {
    const exists = watchlist.includes(item.id);
    setWatchlist((current) => exists ? current.filter((id) => id !== item.id) : [...current, item.id]);
    setNotice(exists ? 'Removed from My List' : 'Saved to My List');
  };
  const go = (next) => {
    if (next === 'Random') {
      const pool = catalog.length ? catalog : titles;
      setSelected(pool[Math.floor(Math.random() * pool.length)]);
      return;
    }
    setPage(next); setSelected(null); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const acceptAccount = (payload) => {
    setUser(payload.user);
    setContinueWatching(payload.progress || []);
    setAuthOpen(false);
    setNotice(`Welcome${payload.user?.name ? `, ${payload.user.name}` : ''}`);
  };
  const logout = async () => {
    await signOut();
    setUser(null);
    setContinueWatching([]);
    setAuthOpen(false);
    setNotice('Signed out');
  };
  const recordProgress = useCallback(async (progress) => {
    if (!user) return;
    const key = String(progress.id || progress.slug);
    setContinueWatching((current) => [progress, ...current.filter((entry) => String(entry.id || entry.slug) !== key)].slice(0, 50));
    try {
      const payload = await saveAccountProgress(key, progress);
      setContinueWatching((current) => [payload.progress, ...current.filter((entry) => String(entry.id || entry.slug) !== key)].slice(0, 50));
    } catch { /* a later playback update can retry */ }
  }, [user]);

  return <div className="app-shell">
    <Sidebar page={page} go={go} onSearch={() => setSearchOpen(true)} user={user} onAccount={() => setAuthOpen(true)} />
    <main className="main-content">
      <Topbar page={page} status={providerStatus} catalogSource={catalogSource} setCatalogSource={setCatalogSource} onSearch={() => setSearchOpen(true)} user={user} onAccount={() => setAuthOpen(true)} />
      {page === 'Home' && <Home items={catalog} rails={rails} onSelect={setSelected} onPlay={setPlaying} toggleList={toggleList} watchlist={watchlist} go={go} user={user} continueWatching={continueWatching} />}
      {page === 'Latest' && <CatalogPage eyebrow="JUST RELEASED" title="Latest episodes." text="The newest releases, updated from the live catalog." items={rails.latest.length ? rails.latest : [...catalog].reverse()} onSelect={setSelected} onPlay={setPlaying} />}
      {page === 'Top Airing' && <CatalogPage eyebrow="AIRING NOW" title="Top airing anime." text="The series viewers are following right now." items={rails.trending.length ? rails.trending : catalog} onSelect={setSelected} onPlay={setPlaying} />}
      {page === 'Browse' && <Browse items={catalog} genre={genre} setGenre={setGenre} catalogSource={catalogSource} onSelect={setSelected} onPlay={setPlaying} />}
      {page === 'Random' && <RandomPage items={catalog} onSelect={setSelected} onPlay={setPlaying} />}
      {page === 'Schedule' && <Schedule catalogSource={catalogSource} onSelect={setSelected} />}
      {page === 'My List' && <MyList items={catalog.filter((t) => watchlist.includes(t.id))} onSelect={setSelected} onPlay={setPlaying} go={go} />}
      <Footer />
    </main>
    <MobileNav page={page} go={go} onSearch={() => setSearchOpen(true)} />
    {searchOpen && <SearchOverlay items={catalog} providerStatus={providerStatus} catalogSource={catalogSource} query={query} setQuery={setQuery} close={() => { setSearchOpen(false); setQuery(''); }} onSelect={(item) => { setSelected(item); setSearchOpen(false); setQuery(''); }} />}
    {selected && <Details item={selected} close={() => setSelected(null)} onPlay={(item) => { setPlaying(item); setSelected(null); }} onSelect={setSelected} inList={watchlist.includes(selected.id)} toggleList={() => toggleList(selected)} />}
    {playing && <WatchPlayer item={playing} onProgress={user ? recordProgress : null} close={() => { setPlaying(null); if (/^\/watch\/?$/.test(window.location.pathname)) window.history.replaceState(null, '', '/'); }} />}
    {authOpen && <AuthModal user={user} close={() => setAuthOpen(false)} onAuthenticated={acceptAccount} onLogout={logout} />}
    {notice && <div className="toast"><Icon name="check" size={17}/>{notice}</div>}
  </div>;
}

function Sidebar({ page, go, onSearch, user, onAccount }) {
  return <aside className="sidebar">
    <button className="brand" onClick={() => go('Home')} aria-label="Kairo home"><span className="brand-mark">K</span><span>KAIRO</span></button>
    <nav><p className="nav-label">MENU</p>{navItems.map(([label, icon]) => <button key={label} className={page === label ? 'nav-item active' : 'nav-item'} onClick={() => go(label)}><Icon name={icon}/><span>{label}</span></button>)}
      <p className="nav-label second">DISCOVER</p><button className="nav-item" onClick={onSearch}><Icon name="search"/><span>Search</span><kbd>/</kbd></button><button className={page === 'Browse' ? 'nav-item active' : 'nav-item'} onClick={() => go('Browse')}><Icon name="spark"/><span>Browse genres</span></button><button className="nav-item" onClick={() => go('Random')}><Icon name="play"/><span>Random anime</span></button>
    </nav>
    <button className="profile-button" onClick={onAccount}><span className="avatar">{user?.name?.[0]?.toUpperCase() || '?'}</span><span><strong>{user?.name || 'Guest viewer'}</strong><small>{user ? 'Account & sign out' : 'Sign in to save progress'}</small></span><Icon name="chevron" size={15}/></button>
  </aside>;
}

function Topbar({ page, status, catalogSource, setCatalogSource, onSearch, user, onAccount }) {
  return <header className="topbar"><div className="mobile-brand"><span className="brand-mark">K</span><span>KAIRO</span></div><p><span>Library</span><Icon name="chevron" size={13}/><strong>{page}</strong></p><div className="top-actions"><label className="catalog-source"><span>Catalog</span><select value={catalogSource} onChange={(event) => setCatalogSource(event.target.value)} aria-label="Metadata catalog"><option value="auto">Auto</option><option value="anilist">AniList</option><option value="jikan">MyAnimeList</option><option value="kitsu">Kitsu</option></select></label><span className={status.providerConfigured ? 'provider-state live' : 'provider-state'}><i/>{status.providerConfigured ? 'Provider connected' : 'Catalog only'}</span><button className="search-pill" onClick={onSearch}><Icon name="search" size={17}/><span>Search anything</span><kbd>/</kbd></button><button className="avatar top-avatar" aria-label={user ? 'Open account' : 'Sign in'} onClick={onAccount}>{user?.name?.[0]?.toUpperCase() || '?'}</button></div></header>;
}

function AuthModal({ user, close, onAuthenticated, onLogout }) {
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const handler = (event) => event.key === 'Escape' && close(); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [close]);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { onAuthenticated(mode === 'signup' ? await signUp(name, email, password) : await signIn(email, password)); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const logout = async () => { setBusy(true); setError(''); try { await onLogout(); } catch (reason) { setError(reason.message); setBusy(false); } };
  return <div className="overlay auth-overlay" role="dialog" aria-modal="true" aria-labelledby="account-title"><button className="overlay-close" onClick={close} aria-label="Close account"><Icon name="close"/></button><section className="auth-card">
    <span className="brand-mark">K</span>
    {user ? <><small>YOUR ACCOUNT</small><h1 id="account-title">Hi, {user.name}.</h1><p>Your Continue Watching history is securely tied to <strong>{user.email}</strong>.</p>{error && <div className="auth-error">{error}</div>}<button className="primary auth-submit" disabled={busy} onClick={logout}>{busy ? 'Signing out…' : 'Sign out'}</button></> : <>
      <small>KAIRO ACCOUNT</small><h1 id="account-title">{mode === 'signup' ? 'Create your account.' : 'Welcome back.'}</h1><p>{mode === 'signup' ? 'Save your place and continue on your next visit.' : 'Sign in to restore your Continue Watching history.'}</p>
      <div className="auth-tabs"><button className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); }}>Sign in</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>Create account</button></div>
      <form onSubmit={submit}>{mode === 'signup' && <label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength="2" maxLength="40" required/></label>}<label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength="120" required/></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength="8" maxLength="128" required/></label>{error && <div className="auth-error">{error}</div>}<button className="primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button></form>
    </>}
  </section></div>;
}

function Home({ items, rails, onSelect, onPlay, toggleList, watchlist, go, user, continueWatching }) {
  const hero = rails.trending[0] || titles[0];
  const featured = rails.popular[0] || titles[2];
  const trending = rails.trending.length ? rails.trending.slice(0, 5) : items.slice(0, 5);
  const latest = rails.latest.length ? rails.latest.slice(0, 5) : [...items].reverse().slice(0, 5);
  const popular = rails.popular.length ? rails.popular.slice(1, 6) : items.slice(5, 10);
  const movies = rails.movies?.slice(0, 5) || [];
  const upcoming = rails.upcoming?.slice(0, 5) || [];
  return <><Hero item={hero} onSelect={onSelect} onPlay={onPlay} toggleList={toggleList} inList={watchlist.includes(hero.id)}/>
    <div className="content-wrap home-content">
      {user && continueWatching.length > 0 && <ContinueRow entries={continueWatching} onPlay={onPlay}/>} 
      <TitleRow title="Trending now" subtitle="What everyone is watching" items={trending} onSelect={onSelect} onPlay={onPlay} onViewAll={() => go('Top Airing')}/>
      <TitleRow title="Fresh episodes" subtitle="Currently airing this season" items={latest} onSelect={onSelect} onPlay={onPlay} onViewAll={() => go('Latest')}/>
      <Featured item={featured} onSelect={onSelect} onPlay={onPlay}/>
      <TitleRow title="All-time popular" subtitle="The titles everyone starts with" items={popular} onSelect={onSelect} onPlay={onPlay} onViewAll={() => go('Browse')}/>
      {movies.length > 0 && <TitleRow title="Anime movies" subtitle="Feature-length stories worth the big screen" items={movies} onSelect={onSelect} onPlay={onPlay}/>} 
      {upcoming.length > 0 && <TitleRow title="Coming soon" subtitle="The next premieres to put on your list" items={upcoming} onSelect={onSelect} onPlay={onPlay}/>} 
    </div>
  </>;
}

function Hero({ item, onSelect, onPlay, toggleList, inList }) {
  const [title, sub] = splitTitle(item.title);
  const background = item.banner || item.image;
  return <section className="hero">
    <div className="hero-bg" style={background ? { backgroundImage: `url(${background})` } : undefined}/><div className="hero-scrim"/>
    <div className="hero-copy">
      <div className="eyebrow"><span className="pulse"/> {item.nextEpisode ? `EPISODE ${item.nextEpisode.episode} INCOMING` : 'TRENDING NOW'}</div>
      <h1>{title}{sub && <><br/><em>{sub}</em></>}</h1>
      <p>{truncate(item.blurb, 190)}</p>
      <div className="meta"><span className="match">★ {item.score}</span><span>{item.year}</span><span className="age">13+</span>{item.episodes > 0 && <span>{item.episodes} episodes</span>}<span>{item.type}</span></div>
      <div className="hero-actions">
        <button className="primary" onClick={() => onPlay(item)}><Icon name="play" size={20}/>Watch episode 1</button>
        <button className="secondary" onClick={() => onSelect(item)}><Icon name="info" size={20}/>More info</button>
        <button className="round-action" onClick={() => toggleList(item)} aria-label="Toggle My List"><Icon name={inList ? 'check' : 'plus'}/></button>
      </div>
    </div>
  </section>;
}

/** Splits a title so the hero can render its tail on a second, emphasised line. */
function splitTitle(value) {
  const words = String(value || '').split(' ');
  if (words.length < 3) return [value, ''];
  const cut = Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

const truncate = (value, max) => {
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, text.lastIndexOf(' ', max))}…`;
};

function ContinueRow({ entries, onPlay }) {
  return <section className="section-block"><SectionHeading title="Continue watching" subtitle="Synced to your account"/><div className="continue-grid">{entries.slice(0, 4).map((item) => { const percent = item.duration > 0 ? Math.min(100, Math.max(2, item.position / item.duration * 100)) : 4; return <button className="continue-card" key={item.id || item.slug} onClick={() => onPlay({ ...item, playbackEpisode: item.episode })}><img src={item.banner || item.image} alt=""/><div className="continue-shade"/><span className="play-float"><Icon name="play" size={21}/></span><div className="continue-copy"><small>EPISODE {item.episode} OF {item.episodes || '?'}</small><strong>{item.title}</strong><p>{item.episodeTitle || `Episode ${item.episode}`}</p></div><div className="progress"><i style={{width: `${percent}%`}}/></div></button>; })}</div></section>;
}
function SectionHeading({ title, subtitle, onViewAll }) { return <div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{onViewAll && <button onClick={onViewAll}>View all <Icon name="chevron" size={14}/></button>}</div>; }
function TitleRow({ title, subtitle, items, onSelect, onPlay, onViewAll }) { return <section className="section-block"><SectionHeading title={title} subtitle={subtitle} onViewAll={onViewAll}/><div className="poster-grid">{items.map((item, index) => <PosterCard key={`${title}-${item.id}`} item={item} rank={title === 'Trending now' ? index + 1 : null} onSelect={onSelect} onPlay={onPlay}/>)}</div></section>; }

function PosterCard({ item, rank, onSelect, onPlay }) {
  return <article className="poster-card" onClick={() => onSelect(item)} tabIndex="0" onKeyDown={(e) => e.key === 'Enter' && onSelect(item)}><div className="poster-image"><img src={item.image} alt={`${item.title} poster`}/><div className="poster-shade"/>{rank && <span className="rank">{String(rank).padStart(2, '0')}</span>}<span className="status">{item.status}</span><button className="poster-play" onClick={(e) => { e.stopPropagation(); onPlay(item); }} aria-label={`Play ${item.title}`}><Icon name="play"/></button></div><div className="poster-copy"><h3>{item.title}</h3><p><span>★ {item.score}</span> · {item.type} · {item.year}</p></div></article>;
}

function Featured({ item, onSelect, onPlay }) {
  return <section className="featured"><img src={item.banner || item.image} alt=""/><div className="featured-scrim"/><div className="featured-copy"><span className="eyebrow">{item.studio ? item.studio.toUpperCase() : "EDITOR'S CHOICE"}</span><h2>{item.title}</h2><p>{truncate(item.blurb, 240)}</p><div className="genre-list">{item.genres.slice(0, 4).map((g) => <span key={g}>{g}</span>)}</div><div className="hero-actions"><button className="primary" onClick={() => onPlay(item)}><Icon name="play"/>Start watching</button><button className="secondary" onClick={() => onSelect(item)}>View details</button></div></div><div className="featured-score"><strong>{item.score}</strong><span>COMMUNITY SCORE</span></div></section>;
}

const PERIOD_LABELS = { day: 'Trending today', week: 'Popular this week', month: 'Top rated' };

function Browse({ items, genre, setGenre, catalogSource, onSelect, onPlay }) {
  const [period, setPeriod] = useState('week');
  const [ranked, setRanked] = useState(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('All');
  const [status, setStatus] = useState('All');
  const [sortBy, setSortBy] = useState('score');
  useEffect(() => {
    let active = true;
    setRanked(null);
    getProviderTop(period, 30, catalogSource).then((result) => active && setRanked(result)).catch(() => active && setRanked([]));
    return () => { active = false; };
  }, [period, catalogSource]);
  const pool = ranked?.length ? ranked : items;
  const genres = useMemo(() => {
    const counts = new Map();
    pool.forEach((item) => item.genres.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1)));
    return ['All', ...[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name)];
  }, [pool]);
  const typeOptions = ['All', 'TV', 'Movie', 'OVA', 'ONA', 'Special'];
  const statusOptions = ['All', 'Ongoing', 'Finished', 'Complete', 'Upcoming', 'Movie'];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...pool].filter((item) => {
      const matchesGenre = genre === 'All' || item.genres.includes(genre);
      const matchesType = type === 'All' || item.type === type || (type === 'Movie' && item.type.toLowerCase().includes('movie')) || (type === 'TV' && item.type.toLowerCase().includes('tv'));
      const matchesStatus = status === 'All' || item.status === status || (status === 'Ongoing' && /ongoing|airing|releasing/i.test(item.status)) || (status === 'Finished' && /finished|complete|ended/i.test(item.status)) || (status === 'Upcoming' && /upcoming|not yet|announced/i.test(item.status));
      const matchesQuery = !query || `${item.title} ${item.japanese || ''} ${item.genres.join(' ')}`.toLowerCase().includes(query);
      return matchesGenre && matchesType && matchesStatus && matchesQuery;
    });
    return sorted.sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'score') return Number(b.score || 0) - Number(a.score || 0);
      if (sortBy === 'newest') return Number(b.year || 0) - Number(a.year || 0);
      if (sortBy === 'episodes') return Number(b.episodes || 0) - Number(a.episodes || 0);
      return Number(b.score || 0) - Number(a.score || 0);
    });
  }, [pool, genre, search, sortBy, status, type]);
  return <div className="content-wrap page-view">
    <PageIntro eyebrow="THE WHOLE LIBRARY" title="Find your next world." text="Hand-picked stories, cinematic adventures, and quiet favorites—all in one place."/>
    <div className="filter-row period-row">
      {Object.entries(PERIOD_LABELS).map(([key, label]) => <button key={key} className={period === key ? 'active' : ''} onClick={() => setPeriod(key)}>{label}</button>)}
      <button className={sortBy === 'score' ? 'active' : ''} onClick={() => setSortBy('score')}>Top scored</button>
      <button className={sortBy === 'newest' ? 'active' : ''} onClick={() => setSortBy('newest')}>Newest</button>
      <button className={sortBy === 'title' ? 'active' : ''} onClick={() => setSortBy('title')}>A–Z</button>
    </div>
    <div className="filter-row">
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search within catalog…" style={{ minWidth: 180, maxWidth: 260, flex: '1 1 220px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#fff', padding: '0.75rem 1rem' }} />
      <select value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter by format" style={{ minWidth: 110, borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#fff', padding: '0.75rem 0.85rem' }}>
        {typeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" style={{ minWidth: 120, borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#fff', padding: '0.75rem 0.85rem' }}>
        {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
    <div className="filter-row">{genres.map((g) => <button key={g} className={genre === g ? 'active' : ''} onClick={() => setGenre(g)}>{g}</button>)}</div>
    {ranked === null && <div className="empty"><span className="loader"/><h2>Loading titles…</h2></div>}
    {ranked !== null && <div className="browse-grid">{filtered.map((item) => <PosterCard key={item.id} item={item} onSelect={onSelect} onPlay={onPlay}/>)}</div>}
    {ranked !== null && !filtered.length && <Empty icon="compass" title="No titles here yet" text="Try a different genre, status, or search term."/>}
  </div>;
}

function Schedule({ catalogSource, onSelect }) {
  const [days, setDays] = useState([]);
  const [state, setState] = useState('loading');
  useEffect(() => {
    let active = true;
    getSchedule(7, catalogSource)
      .then((result) => { if (active) { setDays(result); setState(result.length ? 'ready' : 'empty'); } })
      .catch(() => active && setState('error'));
    return () => { active = false; };
  }, [catalogSource]);
  const today = new Date().toISOString().slice(0, 10);
  return <div className="content-wrap page-view">
    <PageIntro eyebrow="RELEASE CALENDAR" title="Your week, planned." text="Fresh episodes arrive throughout the week. Times are shown in your local timezone."/>
    {state === 'loading' && <div className="empty"><span className="loader"/><h2>Loading the airing calendar…</h2></div>}
    {state === 'error' && <Empty icon="calendar" title="Schedule unavailable" text="The airing calendar could not be loaded. Try again shortly."/>}
    {state === 'empty' && <Empty icon="calendar" title="Nothing scheduled" text="No episodes are airing in the next seven days."/>}
    {state === 'ready' && <div className="schedule-list">{days.map((slot) => <section key={slot.date} className={slot.date === today ? 'schedule-day today' : 'schedule-day'}>
      <div className="day-label"><small>{slot.date === today ? 'TODAY' : 'UPCOMING'}</small><strong>{slot.day}</strong><span>{formatDay(slot.date)}</span></div>
      <div className="day-shows">{slot.items.map((item) => <button key={`${item.id}-${item.airingEpisode}`} onClick={() => onSelect(item)}>
        <img src={item.image} alt=""/>
        <span><small>{formatTime(item.airingAt)}{item.airingEpisode ? ` · EP ${item.airingEpisode}` : ''}</small><strong>{item.title}</strong><em>{item.genres[0] || item.type} · {item.type}</em></span>
        <Icon name="chevron"/>
      </button>)}</div>
    </section>)}</div>}
  </div>;
}

const formatTime = (epoch) => new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDay = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toUpperCase();

function MyList({ items, onSelect, onPlay, go }) { return <div className="content-wrap page-view"><PageIntro eyebrow="YOUR COLLECTION" title="My List." text="Everything you saved, ready when you are."/>{items.length ? <div className="browse-grid">{items.map((item) => <PosterCard key={item.id} item={item} onSelect={onSelect} onPlay={onPlay}/>)}</div> : <Empty icon="bookmark" title="Your list is waiting" text="Save a title and it will appear here." action={() => go('Browse')}/>}</div>; }
function CatalogPage({ eyebrow, title, text, items, onSelect, onPlay }) { return <div className="content-wrap page-view"><PageIntro eyebrow={eyebrow} title={title} text={text}/><div className="browse-grid catalog-page-grid">{items.map((item) => <PosterCard key={item.id} item={item} onSelect={onSelect} onPlay={onPlay}/>)}</div>{!items.length && <Empty icon="compass" title="Nothing to show yet" text="The live catalog is temporarily unavailable."/>}</div>; }
function RandomPage({ items, onSelect, onPlay }) {
  const [seed, setSeed] = useState(0);
  const pool = items.length ? items : titles;
  const pick = useMemo(() => {
    const item = pool[Math.floor(Math.random() * pool.length)];
    return item || pool[0];
  }, [pool, seed]);
  return <div className="content-wrap page-view"><PageIntro eyebrow="SURPRISE ME" title="Pick your next obsession." text="A random recommendation from the current catalog gives you a fresh start whenever you need a new favorite."/><div className="featured" style={{ height: 420, marginTop: 38 }}><img src={pick.banner || pick.image} alt=""/><div className="featured-scrim"/><div className="featured-copy"><span className="eyebrow">RANDOM PICK</span><h2>{pick.title}</h2><p>{truncate(pick.blurb, 200)}</p><div className="genre-list">{pick.genres.slice(0, 4).map((g) => <span key={g}>{g}</span>)}</div><div className="hero-actions"><button className="primary" onClick={() => onPlay(pick)}><Icon name="play"/>Watch now</button><button className="secondary" onClick={() => onSelect(pick)}>View details</button><button className="secondary" onClick={() => setSeed((value) => value + 1)}>Another pick</button></div></div></div></div>;
}
function PageIntro({ eyebrow, title, text }) { return <div className="page-intro"><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>; }
function Empty({ icon, title, text, action }) { return <div className="empty"><span><Icon name={icon} size={28}/></span><h2>{title}</h2><p>{text}</p>{action && <button className="primary" onClick={action}>Browse titles</button>}</div>; }

function SearchOverlay({ items, providerStatus, catalogSource, query, setQuery, close, onSelect }) {
  const input = useRef(null);
  const [remoteResults, setRemoteResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { const handler = (e) => e.key === 'Escape' && close(); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [close]);
  useEffect(() => {
    if (!providerStatus.configured || query.trim().length < 2) { setRemoteResults([]); setLoading(false); return undefined; }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => searchProvider(query, 20, catalogSource).then((found) => active && setRemoteResults(found)).catch(() => active && setRemoteResults([])).finally(() => active && setLoading(false)), 300);
    return () => { active = false; clearTimeout(timer); };
  }, [providerStatus.configured, catalogSource, query]);
  const localResults = useMemo(() => query.trim() ? items.filter((t) => `${t.title} ${t.japanese} ${t.genres.join(' ')}`.toLowerCase().includes(query.toLowerCase())) : items.slice(0, 4), [items, query]);
  const results = query.trim() && providerStatus.configured ? remoteResults : localResults;
  return <div className="overlay search-overlay" role="dialog" aria-modal="true"><button className="overlay-close" onClick={close}><Icon name="close"/></button><div className="search-panel"><span className="search-icon"><Icon name="search" size={26}/></span><input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, genres, moods..." aria-label="Search"/><kbd>ESC</kbd></div><div className="search-results"><p>{loading ? 'SEARCHING PROVIDER…' : query ? `${results.length} RESULT${results.length === 1 ? '' : 'S'}` : 'POPULAR SEARCHES'}</p>{results.map((item) => <button key={item.id} onClick={() => onSelect(item)}><img src={item.image} alt=""/><span><strong>{item.title}</strong><small>{item.year} · {item.type} · {item.genres.slice(0, 2).join(', ')}</small></span><em>★ {item.score}</em><Icon name="chevron"/></button>)}{!loading && !results.length && <Empty icon="search" title="Nothing found" text="Try another title or genre."/>}</div></div>;
}

function Details({ item, close, onPlay, onSelect, inList, toggleList }) {
  const [detail, setDetail] = useState(item);
  const [episodes, setEpisodes] = useState([]);
  const [related, setRelated] = useState([]);
  const [availability, setAvailability] = useState({ subEpisodes: 0, dubEpisodes: 0, totalEpisodes: 0 });
  const [loadingEpisodes, setLoadingEpisodes] = useState(Boolean(item.providerItem));
  const [episodeError, setEpisodeError] = useState('');
  useEffect(() => { const handler = (e) => e.key === 'Escape' && close(); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [close]);
  useEffect(() => {
    if (!item.providerItem) return undefined;
    let active = true;
    setLoadingEpisodes(true);
    setRelated([]);
    getProviderTitle(item).then((result) => {
      if (!active) return;
      setDetail({ ...item, ...result });
      setEpisodes(result.episodeList || []);
      setRelated(result.recommendations || []);
      if (!result.episodeList?.length) setEpisodeError('No episode list is available for this title');
    }).catch((reason) => active && setEpisodeError(reason.message || 'Episodes are unavailable'))
      .finally(() => active && setLoadingEpisodes(false));
    getProviderAvailability(item).then((result) => active && setAvailability(result)).catch(() => {});
    return () => { active = false; };
  }, [item]);
  const playEpisode = (episode) => onPlay({ ...detail, episodeList: episodes, playbackEpisode: episode.number, episodeTitle: episode.title });
  const firstEpisode = episodes[0] || { number: 1, title: detail.episodeTitle || 'Episode 1', duration: null };
  return <div className="overlay details-overlay" role="dialog" aria-modal="true"><button className="overlay-close" onClick={close}><Icon name="close"/></button><div className="detail-panel"><div className="detail-art"><img src={detail.image} alt=""/><div/></div><div className="detail-copy"><div className="eyebrow">KAIRO SELECT · {String(detail.status).toUpperCase()}</div><h1>{detail.title}</h1><p className="japanese">{detail.japanese}</p><div className="meta"><span className="match">★ {detail.score}</span><span>{detail.year}</span><span>{detail.type}</span>{detail.episodes > 0 && <span>{detail.episodes} episodes</span>}<span className="age">13+</span></div>{availability.totalEpisodes > 0 && <div className="genre-list" style={{ marginTop: 12 }}><span>SUB: {availability.subEpisodes || detail.episodes || '—'}</span><span>DUB: {availability.dubEpisodes || '—'}</span></div>}<p className="synopsis">{detail.blurb}</p><div className="genre-list">{detail.genres.map((g) => <span key={g}>{g}</span>)}</div><div className="hero-actions"><button className="primary" onClick={() => playEpisode(firstEpisode)}><Icon name="play"/>Play episode {firstEpisode.number}</button><button className="secondary" onClick={toggleList}><Icon name={inList ? 'check' : 'plus'}/>{inList ? 'In My List' : 'My List'}</button></div>{item.providerItem ? <div className="episode-browser"><div className="episode-browser-heading"><strong>Episodes</strong>{loadingEpisodes && <span>Loading…</span>}{episodeError && <span>{episodeError}</span>}</div>{episodes.length > 0 && <div className="episode-list">{episodes.map((episode) => <button key={episode.id} onClick={() => playEpisode(episode)}><span>EP {String(episode.number).padStart(2, '0')}</span><strong>{episode.title}</strong>{episode.duration && <small>{episode.duration}</small>}<Icon name="play" size={15}/></button>)}</div>}</div> : <div className="episode-preview"><span>EP 01</span><div><strong>{detail.episodeTitle}</strong><p>Begin this story from the very first chapter.</p></div><small>24 min</small></div>}
    {related.length > 0 && <div className="related-block"><strong>More like this</strong><div className="related-row">{related.slice(0, 8).map((rec) => <button key={rec.id} onClick={() => onSelect(rec)} title={rec.title}><img src={rec.image} alt=""/><span>{rec.title}</span><em>★ {rec.score}</em></button>)}</div></div>}
  </div></div></div>;
}

function LegacyPlayer({ item, close }) {
  const video = useRef(null); const episode = item.playbackEpisode || 1; const [started, setStarted] = useState(false); const [source, setSource] = useState(item.video || ''); const [embedUrl, setEmbedUrl] = useState(''); const [subtitles, setSubtitles] = useState([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(Boolean(item.providerItem)); const [language, setLanguage] = useState(() => localStorage.getItem('kairo-audio') || 'sub'); const [availableLanguages, setAvailableLanguages] = useState([]); const [serverName, setServerName] = useState(''); const [chapters, setChapters] = useState(null); const [position, setPosition] = useState(0);
  useEffect(() => { const handler = (e) => e.key === 'Escape' && close(); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [close]);
  useEffect(() => localStorage.setItem('kairo-audio', language), [language]);
  useEffect(() => {
    if (!item.providerItem) { setSource(item.video || ''); return undefined; }
    let active = true;
    setLoading(true); setError(''); setSource(''); setEmbedUrl(''); setStarted(false); setChapters(null);
    resolveProviderPlayback(item, episode, language).then((payload) => { if (active) { setSource(payload.url || ''); setEmbedUrl(payload.embedUrl || ''); setSubtitles(payload.subtitles || []); setAvailableLanguages(payload.availableLanguages || []); setServerName(payload.serverName || ''); setChapters(payload.chapters || null); if (payload.language && payload.language !== language) setLanguage(payload.language); } }).catch((reason) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item, episode, language]);
  const activeChapter = useMemo(() => {
    if (!chapters) return null;
    const { intro, outro } = chapters;
    if (intro && position >= intro.start && position < intro.end) return { label: 'Skip intro', to: intro.end };
    if (outro && position >= outro.start) return { label: 'Skip outro', to: outro.end || null };
    return null;
  }, [chapters, position]);
  const skip = () => {
    const element = video.current;
    if (!element || !activeChapter) return;
    if (activeChapter.to === null) { close(); return; }
    element.currentTime = activeChapter.to;
  };
  useEffect(() => {
    const element = video.current;
    if (!element || !source) return undefined;
    const isHls = /\.m3u8(?:$|\?)/i.test(source);
    if (!isHls || element.canPlayType('application/vnd.apple.mpegurl')) { element.src = source; return () => { element.removeAttribute('src'); element.load(); }; }
    let cancelled = false;
    let hls;
    import('hls.js/dist/hls.light.min.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) { setError('HLS playback is not supported by this browser'); return; }
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(source);
      hls.attachMedia(element);
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setError(`HLS playback failed: ${data.details}`); });
    }).catch(() => setError('The HLS playback module could not be loaded'));
    return () => { cancelled = true; hls?.destroy(); };
  }, [source]);
  const start = () => { setStarted(true); setTimeout(() => video.current?.play().catch(() => {}), 0); };
  return <div className="player-overlay" role="dialog" aria-modal="true">
    <div className="player-top"><button onClick={close} aria-label="Close player"><Icon name="close"/></button><div><small>NOW PLAYING{serverName ? ` · ${serverName.toUpperCase()}` : ''} · {language.toUpperCase()}</small><strong>{item.title}</strong><span> · EP {String(episode).padStart(2, '0')} — {item.episodeTitle}</span></div>{item.providerItem && availableLanguages.length > 1 && <div className="language-switch" aria-label="Audio language">{availableLanguages.map((option) => <button key={option} className={language === option ? 'active' : ''} aria-pressed={language === option} onClick={() => setLanguage(option)}>{option}</button>)}</div>}<span className="legal-chip">{item.providerItem ? 'EXTERNAL PROVIDER' : 'DEMO MEDIA'}</span></div>
    {embedUrl && <iframe key={`${language}:${embedUrl}`} className="player-embed" src={embedUrl} title={`${item.title} episode ${episode} ${language}`} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="no-referrer-when-downgrade"/>}
    {source && <video ref={video} poster="/assets/hero-nightfall.png" controls={started} onPlay={() => setStarted(true)} onEnded={() => setStarted(false)} onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}>{subtitles.map((track, index) => <track key={`${track.url}-${index}`} src={track.url} label={track.language || track.label || `Subtitle ${index + 1}`} srcLang={track.code || track.lang || 'en'} default={Boolean(track.default)}/>)}</video>}
    {started && activeChapter && <button className="skip-chapter" onClick={skip}>{activeChapter.label}<Icon name="skip" size={16}/></button>}
    {!embedUrl && !started && source && <button className="big-play" onClick={start}><span><Icon name="play" size={34}/></span><strong>Start episode</strong><small>{item.providerItem ? 'Authorized provider stream' : 'Open-licensed demo video'}</small></button>}
    {loading && <div className="player-message"><span className="loader"/><strong>Resolving stream…</strong></div>}
    {error && <div className="player-message error"><strong>Playback unavailable</strong><p>{error}</p><button className="secondary" onClick={close}>Return to catalog</button></div>}
    <div className="player-note">Playback is supplied by the configured external provider.</div>
  </div>;
}

function WatchPlayer({ item, close, onProgress }) {
  const video = useRef(null);
  const embedFrame = useRef(null);
  const pendingServerSwitch = useRef(null);
  const pendingServerTimer = useRef(null);
  const serverFailures = useRef(new Set());
  const route = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialEpisode = Math.max(1, Number(route.get('ep')) || Number(item.playbackEpisode) || 1);
  const initialLanguage = ['sub', 'dub'].includes(route.get('lang')) ? route.get('lang') : (localStorage.getItem('kairo-audio') || 'sub');
  const [episode, setEpisode] = useState(initialEpisode);
  const [language, setLanguage] = useState(initialLanguage);
  const [serverGroups, setServerGroups] = useState({ sub: [], dub: [] });
  const [availableLanguages, setAvailableLanguages] = useState([]);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [source, setSource] = useState(item.video || '');
  const [embedUrl, setEmbedUrl] = useState('');
  const [subtitles, setSubtitles] = useState([]);
  const [serverName, setServerName] = useState('');
  const [serverChapters, setServerChapters] = useState(null);
  const [chapters, setChapters] = useState(null);
  const [started, setStarted] = useState(false);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const [loading, setLoading] = useState(Boolean(item.providerItem));
  const [error, setError] = useState('');
  const [range, setRange] = useState(Math.floor((initialEpisode - 1) / 100));
  const [episodeQuery, setEpisodeQuery] = useState('');
  const [theater, setTheater] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);
  const [providerAvailability, setProviderAvailability] = useState({ subEpisodes: 0, dubEpisodes: 0, totalEpisodes: 0 });
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem('kairo-autonext') !== 'false');
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem('kairo-autoplay') !== 'false');
  const [autoSkipIntro, setAutoSkipIntro] = useState(() => localStorage.getItem('kairo-auto-skip-intro') !== 'false');
  const [autoSkipOutro, setAutoSkipOutro] = useState(() => localStorage.getItem('kairo-auto-skip-outro') !== 'false');
  const embedPreferences = useRef(null);
  const [countdown, setCountdown] = useState(null);
  const historyInitialized = useRef(false);
  const skippedIntro = useRef('');
  const skippedOutro = useRef('');
  const watchedKey = `kairo-watched-${item.id || item.slug}`;
  const [watched, setWatched] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(watchedKey) || '[]')); } catch { return new Set(); }
  });
  const listedEpisodes = Array.isArray(item.episodeList) ? item.episodeList : [];
  const totalEpisodes = Math.max(1, Number(item.episodes) || 0, listedEpisodes.length, providerAvailability.totalEpisodes || 0, episode);
  const episodeByNumber = useMemo(() => new Map(listedEpisodes.map((entry) => [Number(entry.number), entry])), [listedEpisodes]);
  const ranges = useMemo(() => Array.from({ length: Math.ceil(totalEpisodes / 100) }, (_, index) => ({ index, start: index * 100 + 1, end: Math.min(totalEpisodes, (index + 1) * 100) })), [totalEpisodes]);
  const visibleEpisodes = useMemo(() => {
    const queryNumber = Number(episodeQuery);
    if (episodeQuery.trim() && Number.isInteger(queryNumber) && queryNumber >= 1 && queryNumber <= totalEpisodes) return [queryNumber];
    const start = range * 100 + 1;
    return Array.from({ length: Math.min(100, Math.max(0, totalEpisodes - start + 1)) }, (_, index) => start + index);
  }, [episodeQuery, range, totalEpisodes]);
  const currentEpisode = episodeByNumber.get(episode);
  const currentServers = serverGroups[language] || [];
  const activeServer = currentServers.find((server) => server.id === selectedServerId) || null;
  embedPreferences.current = { autoPlay, autoSkipIntro, autoSkipOutro };

  useEffect(() => localStorage.setItem('kairo-audio', language), [language]);
  useEffect(() => localStorage.setItem('kairo-autonext', String(autoNext)), [autoNext]);
  useEffect(() => localStorage.setItem('kairo-autoplay', String(autoPlay)), [autoPlay]);
  useEffect(() => localStorage.setItem('kairo-auto-skip-intro', String(autoSkipIntro)), [autoSkipIntro]);
  useEffect(() => localStorage.setItem('kairo-auto-skip-outro', String(autoSkipOutro)), [autoSkipOutro]);
  useEffect(() => {
    if (!item.providerItem) return undefined;
    let active = true;
    getProviderAvailability(item).then((result) => active && setProviderAvailability(result)).catch(() => {});
    return () => { active = false; };
  }, [item]);
  useEffect(() => {
    const params = new URLSearchParams({ slug: String(item.slug || item.id || ''), ep: String(episode), lang: language });
    if (item.anilistId) params.set('aid', String(item.anilistId));
    params.set('source', item.source || 'anilist');
    const watchUrl = `/watch?${params}`;
    if (!historyInitialized.current && !/^\/watch\/?$/.test(window.location.pathname)) window.history.pushState({ episode, language }, '', watchUrl);
    else window.history.replaceState({ episode, language }, '', watchUrl);
    historyInitialized.current = true;
    document.title = `${item.title} Episode ${episode} ${language.toUpperCase()} · Kairo`;
    setWatched((current) => {
      if (current.has(episode)) return current;
      const next = new Set(current); next.add(episode);
      localStorage.setItem(watchedKey, JSON.stringify([...next]));
      return next;
    });
  }, [episode, item, language]);

  useEffect(() => {
    if (!item.providerItem) { setSource(item.video || ''); setLoading(false); return undefined; }
    let active = true;
    setLoading(true); setError(''); setSource(''); setEmbedUrl(''); setStarted(false); setPosition(0); setMediaDuration(0); positionRef.current = 0; durationRef.current = 0; setCountdown(null); setSelectedServerId(''); serverFailures.current.clear();
    getProviderServers(item, episode).then((payload) => {
      if (!active) return;
      const groups = { sub: payload.sub || [], dub: payload.dub || [] };
      const languages = payload.availableLanguages || ['sub', 'dub'].filter((key) => groups[key].length);
      const effectiveLanguage = groups[language]?.length ? language : languages[0];
      if (!effectiveLanguage) throw new Error('No SUB or DUB servers are available for this episode');
      setServerGroups(groups); setAvailableLanguages(languages); setServerChapters(payload.chapters || null); setChapters((current) => mergeChapterData(payload.chapters, current));
      if (effectiveLanguage !== language) setLanguage(effectiveLanguage);
      const savedName = localStorage.getItem(`kairo-server-${effectiveLanguage}`);
      const chosen = groups[effectiveLanguage].find((server) => server.name === savedName) || groups[effectiveLanguage][0];
      setSelectedServerId(chosen?.id || '');
    }).catch((reason) => { if (active) { setError(reason.message); setLoading(false); } });
    return () => { active = false; };
  }, [episode, item, retry]);

  useEffect(() => {
    if (!currentServers.length || currentServers.some((server) => server.id === selectedServerId)) return;
    const savedName = localStorage.getItem(`kairo-server-${language}`);
    const selected = currentServers.find((server) => server.name === savedName) || currentServers[0];
    setSelectedServerId(selected.id);
  }, [currentServers, language, selectedServerId]);

  useEffect(() => {
    if (!activeServer) return undefined;
    let active = true;
    setLoading(true); setError(''); setSource(''); setEmbedUrl(''); setStarted(false);
    localStorage.setItem(`kairo-server-${language}`, activeServer.name);
    resolveProviderServer(activeServer, serverChapters).then((payload) => {
      if (!active) return;
      serverFailures.current.delete(activeServer.id);
      setSource(payload.url || ''); setEmbedUrl(payload.embedUrl || ''); setSubtitles(payload.subtitles || []);
      setServerName(`Main ${Math.max(0, currentServers.findIndex((server) => server.id === activeServer.id)) + 1}`); setChapters((current) => mergeChapterData(payload.chapters || serverChapters, current));
    }).catch((reason) => {
      if (!active) return;
      serverFailures.current.add(activeServer.id);
      const fallback = currentServers.find((server) => !serverFailures.current.has(server.id));
      if (fallback) {
        setServerName('Switching server');
        setSelectedServerId(fallback.id);
      } else setError(reason.message);
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [activeServer, currentServers, language, retry, serverChapters]);

  useEffect(() => {
    if (!item.malId || mediaDuration <= 0) return undefined;
    let active = true;
    getEpisodeChapters(item.malId, episode, mediaDuration).then((result) => {
      if (active) setChapters((current) => mergeChapterData(serverChapters, mergeChapterData(result, current)));
    }).catch(() => {});
    return () => { active = false; };
  }, [episode, item.malId, mediaDuration, serverChapters]);

  const changeEpisode = (next) => {
    const value = Math.min(totalEpisodes, Math.max(1, Number(next) || 1));
    if (value === episode) return;
    const params = new URLSearchParams({ slug: String(item.slug || item.id || ''), ep: String(value), lang: language });
    if (item.anilistId) params.set('aid', String(item.anilistId));
    params.set('source', item.source || 'anilist');
    window.history.pushState({ episode: value, language }, '', `/watch?${params}`);
    setEpisode(value); setRange(Math.floor((value - 1) / 100)); setEpisodeQuery(''); setCountdown(null);
  };
  const changeLanguage = (next) => {
    if (next === language) return;
    const params = new URLSearchParams({ slug: String(item.slug || item.id || ''), ep: String(episode), lang: next });
    if (item.anilistId) params.set('aid', String(item.anilistId));
    params.set('source', item.source || 'anilist');
    window.history.pushState({ episode, language: next }, '', `/watch?${params}`);
    setLanguage(next); setCountdown(null);
  };
  const queueNext = () => { if (autoNext && episode < totalEpisodes) setCountdown(3); };
  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown <= 0) { changeEpisode(episode + 1); return undefined; }
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, episode]);
  useEffect(() => {
    const ended = (event) => {
      if (embedFrame.current?.contentWindow && event.source !== embedFrame.current.contentWindow) return;
      let data = event.data;
      if (typeof data === 'string' && data.trim().startsWith('{')) { try { data = JSON.parse(data); } catch { /* keep the raw message */ } }
      if (typeof data === 'object' && Number.isFinite(Number(data?.currentTime))) {
        positionRef.current = Number(data.currentTime);
        durationRef.current = Math.max(0, Number(data.duration) || 0);
        if (durationRef.current > 0) setMediaDuration((current) => Math.abs(current - durationRef.current) < 0.5 ? current : durationRef.current);
        setPosition(positionRef.current);
        if (pendingServerSwitch.current) {
          const nextServerId = pendingServerSwitch.current;
          pendingServerSwitch.current = null;
          clearTimeout(pendingServerTimer.current);
          serverFailures.current.clear(); setSelectedServerId(nextServerId); setCountdown(null); setError('');
        }
      }
      const value = typeof data === 'string' ? data.trim().toLowerCase() : String(data?.playerStatus || data?.event || data?.type || data?.status || data?.action || data?.data || '').toLowerCase();
      if (value === 'playing') setStarted(true);
      if (value === 'paused') setStarted(false);
      if (value === 'ready' || value === 'playing') {
        [0, 400, 1200].forEach((delay) => setTimeout(syncEmbedPreferences, delay));
      }
      if (['ended', 'complete', 'completed', 'finished', 'finish', 'player:ended', 'player_ended', 'vjs-ended', 'video:ended', 'videoended', 'video-ended'].includes(value)) { setStarted(false); queueNext(); }
    };
    window.addEventListener('message', ended);
    return () => window.removeEventListener('message', ended);
  }, [autoNext, autoPlay, autoSkipIntro, autoSkipOutro, episode, totalEpisodes]);
  useEffect(() => {
    if (!embedUrl) return undefined;
    const requestTime = () => embedFrame.current?.contentWindow?.postMessage({ command: 'getTime' }, '*');
    requestTime();
    const timer = setInterval(requestTime, autoSkipIntro || autoSkipOutro ? 750 : 10_000);
    return () => clearInterval(timer);
  }, [autoSkipIntro, autoSkipOutro, embedUrl]);
  useEffect(() => {
    const keyboard = (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') return showKeys ? setShowKeys(false) : close();
      if (event.key.toLowerCase() === 'n') changeEpisode(episode + 1);
      if (event.key.toLowerCase() === 'p') changeEpisode(episode - 1);
      if (event.key.toLowerCase() === 't') setTheater((value) => !value);
      if (event.key === '?') setShowKeys((value) => !value);
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [close, episode, showKeys, totalEpisodes]);
  useEffect(() => {
    const restoreRoute = () => {
      if (!/^\/watch\/?$/.test(window.location.pathname)) return close();
      const params = new URLSearchParams(window.location.search);
      const nextEpisode = Number(params.get('ep'));
      const nextLanguage = params.get('lang');
      if (Number.isInteger(nextEpisode) && nextEpisode >= 1 && nextEpisode <= totalEpisodes) { setEpisode(nextEpisode); setRange(Math.floor((nextEpisode - 1) / 100)); }
      if (['sub', 'dub'].includes(nextLanguage)) setLanguage(nextLanguage);
    };
    window.addEventListener('popstate', restoreRoute);
    return () => window.removeEventListener('popstate', restoreRoute);
  }, [close, totalEpisodes]);

  const activeChapter = useMemo(() => {
    if (!chapters) return null;
    if (chapters.intro && position >= chapters.intro.start && position < chapters.intro.end) return { label: 'Skip intro', to: chapters.intro.end };
    if (chapters.outro && position >= chapters.outro.start) return { label: 'Skip outro', to: chapters.outro.end || null };
    return null;
  }, [chapters, position]);
  useEffect(() => {
    const intro = chapters?.intro;
    const element = video.current;
    if (!autoSkipIntro || !intro || position < intro.start || position >= intro.end) return;
    const introKey = `${episode}:${source || embedUrl}:${intro.start}:${intro.end}`;
    if (skippedIntro.current === introKey) return;
    skippedIntro.current = introKey;
    if (element && source) element.currentTime = intro.end;
    else embedFrame.current?.contentWindow?.postMessage({ command: 'seek', value: intro.end }, '*');
  }, [autoSkipIntro, chapters, embedUrl, episode, position, source]);
  useEffect(() => {
    const outro = chapters?.outro;
    const element = video.current;
    if (!autoSkipOutro || !outro || position < outro.start || (outro.end && position >= outro.end)) return;
    const outroKey = `${episode}:${source || embedUrl}:${outro.start}:${outro.end || 'end'}`;
    if (skippedOutro.current === outroKey) return;
    skippedOutro.current = outroKey;
    const end = outro.end || element?.duration || chapters?.duration || mediaDuration;
    if (Number.isFinite(end) && end > position && element && source) element.currentTime = Math.max(position, end - 0.25);
    else if (Number.isFinite(end) && end > position && embedUrl) embedFrame.current?.contentWindow?.postMessage({ command: 'seek', value: Math.max(position, end - 0.25) }, '*');
    else queueNext();
  }, [autoNext, autoSkipOutro, chapters, embedUrl, episode, mediaDuration, position, source]);
  useEffect(() => {
    const element = video.current;
    if (!element || !source) return undefined;
    const isHls = /\.m3u8(?:$|\?)/i.test(source);
    if (!isHls || element.canPlayType('application/vnd.apple.mpegurl')) { element.src = source; return () => { element.removeAttribute('src'); element.load(); }; }
    let cancelled = false; let hls;
    import('hls.js/dist/hls.light.min.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) return setError('HLS playback is not supported by this browser');
      hls = new Hls({ enableWorker: true, lowLatencyMode: true }); hls.loadSource(source); hls.attachMedia(element);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        serverFailures.current.add(activeServer?.id);
        const fallback = currentServers.find((server) => !serverFailures.current.has(server.id));
        if (fallback) setSelectedServerId(fallback.id);
        else setError(`HLS playback failed: ${data.details}`);
      });
    }).catch(() => setError('The HLS playback module could not be loaded'));
    return () => { cancelled = true; hls?.destroy(); };
  }, [activeServer, currentServers, source]);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  };
  const playerEmbedUrl = useMemo(() => {
    if (!embedUrl) return '';
    try {
      const url = new URL(embedUrl);
      url.searchParams.set('autoplay', String(autoPlay));
      url.searchParams.set('autoPlay', String(autoPlay));
      url.searchParams.set('ski', String(autoSkipIntro));
      url.searchParams.set('skI', String(autoSkipIntro));
      url.searchParams.set('skO', String(autoSkipOutro));
      return url.href;
    } catch { return embedUrl; }
    // Preference changes are sent to the live iframe below. Keeping them out
    // of this dependency list prevents a toggle from reloading the video.
  }, [embedUrl]);
  const syncEmbedPreferences = () => {
    const target = embedFrame.current?.contentWindow;
    const preferences = embedPreferences.current;
    if (!preferences) return;
    target?.postMessage({ command: 'updatePreferences', value: { skipIntro: preferences.autoSkipIntro, skipOutro: preferences.autoSkipOutro, autoPlay: preferences.autoPlay } }, '*');
  };
  useEffect(() => { syncEmbedPreferences(); }, [autoPlay, autoSkipIntro, autoSkipOutro, playerEmbedUrl]);
  const changeServer = (nextServerId) => {
    const commit = () => {
      pendingServerSwitch.current = null;
      serverFailures.current.clear(); setSelectedServerId(nextServerId); setCountdown(null); setError('');
    };
    if (!embedFrame.current?.contentWindow) return commit();
    pendingServerSwitch.current = nextServerId;
    embedFrame.current.contentWindow.postMessage({ command: 'getTime' }, '*');
    clearTimeout(pendingServerTimer.current);
    pendingServerTimer.current = setTimeout(commit, 300);
  };
  const retryPlayback = () => {
    serverFailures.current.clear();
    setError('');
    setRetry((value) => value + 1);
  };
  const start = () => { setStarted(true); setTimeout(() => video.current?.play().catch(() => {}), 0); };
  const skip = () => { if (!activeChapter) return; if (activeChapter.to === null) return queueNext(); if (video.current && source) video.current.currentTime = activeChapter.to; else embedFrame.current?.contentWindow?.postMessage({ command: 'seek', value: activeChapter.to }, '*'); };
  const togglePictureInPicture = async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.current?.requestPictureInPicture(); } catch { /* browser denied PiP */ }
  };
  useEffect(() => {
    if (!onProgress || !started) return undefined;
    const save = () => onProgress({
      id: item.id || item.slug, slug: item.slug, anilistId: item.anilistId, malId: item.malId, source: item.source,
      title: item.title, japanese: item.japanese, image: item.image, banner: item.banner,
      score: item.score, year: item.year, type: item.type, status: item.status, genres: item.genres, blurb: item.blurb, episodes: totalEpisodes,
      episode, episodeTitle: currentEpisode?.title || `Episode ${episode}`, language,
      position: positionRef.current, duration: durationRef.current, providerItem: item.providerItem !== false,
    });
    save();
    const timer = setInterval(save, 10_000);
    return () => { clearInterval(timer); save(); };
  }, [currentEpisode?.title, episode, item, language, onProgress, started, totalEpisodes]);

  return <div className={theater ? 'player-overlay watch-player-overlay theater' : 'player-overlay watch-player-overlay'} role="dialog" aria-modal="true">
    <header className="watch-header"><button onClick={close} aria-label="Close player"><Icon name="close"/></button><div><small>NOW WATCHING · {language.toUpperCase()}{serverName ? ` · ${serverName.toUpperCase()}` : ''}</small><strong>{item.title}</strong><span>Episode {episode}{currentEpisode?.title && currentEpisode.title !== `Episode ${episode}` ? ` — ${currentEpisode.title}` : ''}</span></div><span className="watch-provider-chip">EXTERNAL PROVIDER</span></header>
    <div className="watch-scroll"><div className="watch-layout">
      <main className="watch-main">
        <div className="watch-frame">
          {playerEmbedUrl && <iframe ref={embedFrame} key={`${episode}:${language}:${selectedServerId}:${playerEmbedUrl}`} className="player-embed" src={playerEmbedUrl} title={`${item.title} episode ${episode} ${language}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="no-referrer-when-downgrade" onLoad={() => { const resumeAt = positionRef.current || (episode === initialEpisode ? Number(item.position) || 0 : 0); [0, 500, 1400].forEach((delay) => setTimeout(() => { syncEmbedPreferences(); if (resumeAt > 0) embedFrame.current?.contentWindow?.postMessage({ command: 'seek', value: resumeAt }, '*'); }, delay)); }}/>} 
          {source && <video ref={video} autoPlay={autoPlay} poster={item.banner || item.image || '/assets/hero-nightfall.png'} controls={started} onLoadedMetadata={(event) => { durationRef.current = event.currentTarget.duration || 0; setMediaDuration(durationRef.current); const resumeAt = episode === initialEpisode ? Number(item.position) || 0 : 0; if (resumeAt > 0) event.currentTarget.currentTime = resumeAt; if (autoPlay) event.currentTarget.play().catch(() => {}); }} onPlay={() => setStarted(true)} onEnded={() => { setStarted(false); queueNext(); }} onTimeUpdate={(event) => { positionRef.current = event.currentTarget.currentTime; durationRef.current = event.currentTarget.duration || 0; setPosition(positionRef.current); }}>{subtitles.map((track, index) => <track key={`${track.url}-${index}`} src={track.url} label={track.language || track.label || `Subtitle ${index + 1}`} srcLang={track.code || track.lang || 'en'} default={Boolean(track.default)}/>)}</video>}
          {started && activeChapter && <button className="skip-chapter" onClick={skip}>{activeChapter.label}<Icon name="skip" size={16}/></button>}
          {!embedUrl && !started && source && <button className="big-play" onClick={start}><span><Icon name="play" size={34}/></span><strong>Start episode</strong><small>Authorized provider stream</small></button>}
          {loading && <div className="player-message"><span className="loader"/><strong>Loading {language.toUpperCase()} stream…</strong></div>}
          {error && <div className="player-message error"><strong>Playback unavailable</strong><p>{error}</p><button className="secondary" onClick={retryPlayback}>Retry</button></div>}
          {countdown !== null && <div className="autonext-overlay"><div><small>NEXT EPISODE PLAYING IN</small><strong>{countdown}s</strong><p>Episode {Math.min(totalEpisodes, episode + 1)}</p><button onClick={() => changeEpisode(episode + 1)}>Play now</button><button onClick={() => setCountdown(null)}>Cancel</button></div></div>}
        </div>
        <section className="watch-controls">
          <div className="watch-switch-row">
            <div className="watch-controls-left"><div className="watch-switch-group"><span>Audio:</span><div className="watch-pills">{availableLanguages.map((option) => <button key={option} className={language === option ? 'active' : ''} onClick={() => changeLanguage(option)} title={providerAvailability[`${option}Episodes`] ? `${providerAvailability[`${option}Episodes`]} ${option.toUpperCase()} episodes listed` : undefined}><i/>{option.toUpperCase()}</button>)}</div></div><label className="server-select-control"><span>Server</span><select value={selectedServerId} disabled={!currentServers.length} onChange={(event) => changeServer(event.target.value)}>{currentServers.map((server, index) => <option key={server.id} value={server.id}>Main {index + 1}</option>)}</select></label></div>
            <div className="watch-controls-right"><button className={autoPlay ? 'watch-tool active' : 'watch-tool'} onClick={() => setAutoPlay((value) => !value)}>Auto-play: {autoPlay ? 'ON' : 'OFF'}</button><button className={autoSkipIntro ? 'watch-tool active' : 'watch-tool'} onClick={() => setAutoSkipIntro((value) => !value)}>Auto-skip intro: {autoSkipIntro ? 'ON' : 'OFF'}</button><button className={autoSkipOutro ? 'watch-tool active' : 'watch-tool'} onClick={() => setAutoSkipOutro((value) => !value)}>Auto-skip outro: {autoSkipOutro ? 'ON' : 'OFF'}</button><button className={autoNext ? 'watch-tool active' : 'watch-tool'} onClick={() => setAutoNext((value) => !value)}>Auto-next: {autoNext ? 'ON' : 'OFF'}</button><button className={theater ? 'watch-tool active' : 'watch-tool'} onClick={() => setTheater((value) => !value)}>Theater</button>{source && <button className="watch-tool" onClick={togglePictureInPicture}>Picture in picture</button>}<button className="watch-tool" onClick={() => setShowKeys(true)}>Keys</button></div>
          </div>
          <div className="watch-nav-row"><button className="share-link" onClick={copyLink}>{copied ? 'Link copied!' : 'Copy episode link'}</button><div className="episode-nav"><button disabled={episode <= 1} onClick={() => changeEpisode(episode - 1)}><Icon name="chevron" size={15}/><span>Prev</span></button><strong>Episode {episode} <em>/ {totalEpisodes}</em></strong><button disabled={episode >= totalEpisodes} onClick={() => changeEpisode(episode + 1)}><span>Next</span><Icon name="chevron" size={15}/></button></div></div>
        </section>
        <article className="watch-info"><img src={item.image} alt=""/><div><h1>{item.title}</h1>{item.japanese && <p className="watch-native">{item.japanese}</p>}<div className="genre-list">{item.genres?.slice(0, 5).map((name) => <span key={name}>{name}</span>)}<span>★ {item.score}</span><span>{item.status}</span><span>{totalEpisodes} Episodes</span></div><p>{item.blurb}</p></div></article>
      </main>
      <aside className="watch-episodes"><div className="episode-sidebar-head"><div><strong>List of Episodes</strong><span>Total: {totalEpisodes}</span></div><input type="search" inputMode="numeric" value={episodeQuery} onChange={(event) => setEpisodeQuery(event.target.value.replace(/\D/g, ''))} placeholder="Jump to episode number…" aria-label="Jump to episode"/></div>{ranges.length > 1 && <div className="episode-ranges">{ranges.map((entry) => <button key={entry.index} className={range === entry.index && !episodeQuery ? 'active' : ''} onClick={() => { setRange(entry.index); setEpisodeQuery(''); }}>{entry.start}–{entry.end}</button>)}</div>}<div className="episode-number-grid">{visibleEpisodes.map((number) => <button key={number} className={`${number === episode ? 'active ' : ''}${watched.has(number) ? 'watched' : ''}`.trim()} onClick={() => changeEpisode(number)} title={`${episodeByNumber.get(number)?.title || `Episode ${number}`}${watched.has(number) ? ' (Watched)' : ''}`}>{number}</button>)}</div></aside>
    </div></div>
    {showKeys && <div className="keys-modal" onClick={() => setShowKeys(false)}><div onClick={(event) => event.stopPropagation()}><button onClick={() => setShowKeys(false)}><Icon name="close"/></button><h2>Player shortcuts</h2><p><kbd>N</kbd> Next episode</p><p><kbd>P</kbd> Previous episode</p><p><kbd>T</kbd> Theater mode</p><p><kbd>?</kbd> Show shortcuts</p><p><kbd>Esc</kbd> Close player</p></div></div>}
  </div>;
}

function MobileNav({ page, go, onSearch }) { const items = [['Home', 'home'], ['Schedule', 'calendar'], ['Top Airing', 'compass'], ['My List', 'bookmark']]; return <nav className="mobile-nav">{items.slice(0, 2).map(([label, icon]) => <button key={label} className={page === label ? 'active' : ''} onClick={() => go(label)}><Icon name={icon}/><span>{label}</span></button>)}<button onClick={onSearch}><Icon name="search"/><span>Search</span></button>{items.slice(2).map(([label, icon]) => <button key={label} className={page === label ? 'active' : ''} onClick={() => go(label)}><Icon name={icon}/><span>{label === 'Top Airing' ? 'Trending' : label}</span></button>)}</nav>; }
function Footer() { return <footer><div className="brand"><span className="brand-mark">K</span><span>KAIRO</span></div><p>Stories worth staying up for.</p><span>© 2026 Kairo · Demo catalog</span></footer>; }
