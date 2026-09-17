'use strict';
/* 叶语のBlog · SPA 前端（history 路由 + 滑动过渡） */

/* ============ 小工具 ============ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function installAssetFallbacks() {
  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.fallbackTried) return;
    const source = image.currentSrc || image.src || '';
    if (!/^https:\/\//i.test(source)) return;
    image.dataset.fallbackTried = '1';
    if (image.dataset.fallback) image.src = image.dataset.fallback;
    else { image.removeAttribute('src'); image.alt = '外部资源暂时不可用'; image.classList.add('resource-error'); }
  }, true);
}

let csrfToken = '';
async function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.code = data.code;
    error.retryAfter = data.retryAfter;
    throw error;
  }
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data;
}

const fmtDate = (s) => (s ? s.slice(0, 10) : '');
function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return iso.slice(0, 10);
}

/* ============ 内联图标 (24x24 stroke) ============ */
const I = (paths, fill = false) =>
  `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const ICO = {
  home: I('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  tag: I('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><circle cx="7" cy="7" r="1.6"/>'),
  clock: I('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  folder: I('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  hot: I('<path d="M12 22c4.4 0 7-2.8 7-6.7 0-3.1-1.7-5.5-4.6-8.3.1 2.1-.6 3.5-1.9 4.3.1-3.8-1.7-6.8-4.3-8.8.1 3.2-3.2 5.8-3.2 10.2C5 18.9 7.7 22 12 22z"/>'),
  mail: I('<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'),
  message: I('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  user: I('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  search: I('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  sun: I('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
  moon: I('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  up: I('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
  right: I('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
  down: I('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
  left: I('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
  heart: I('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
  eye: I('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  calendar: I('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  pen: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  list: I('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
  bookmark: I('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
  pin: I('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
  github: I('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  music: I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  play: I('<polygon points="6 3 20 12 6 21 6 3"/>', true),
  pause: I('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>', true),
  volume: I('<polygon points="4 9 8 9 13 5 13 19 8 15 4 15 4 9"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'),
  mute: I('<polygon points="4 9 8 9 13 5 13 19 8 15 4 15 4 9"/><line x1="17" y1="9" x2="21" y2="15"/><line x1="21" y1="9" x2="17" y2="15"/>'),
  replay: I('<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/>'),
  shuffle: I('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>'),
  next: I('<polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/>', false),
  tv: I('<rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/>'),
};

/* ============ 全局状态 ============ */
const state = {
  site: null,
  posts: [],
  hotTopics: null,
  heroImage: null,
  viewer: null,
  dark: localStorage.getItem('leaf-dark') === '1',
};

function musicTracks(site) {
  const playlist = Array.isArray(site?.musicPlaylist)
    ? site.musicPlaylist.filter((item) => item && item.url).map((item) => ({ title: item.title || '背景音乐', url: item.url }))
    : [];
  return playlist.length ? playlist : (site?.musicUrl ? [{ title: site.musicTitle || '背景音乐', url: site.musicUrl }] : []);
}

function applyDark() {
  document.body.classList.toggle('dark', state.dark);
  const b = $('#btn-dark');
  if (b) b.innerHTML = state.dark ? ICO.sun : ICO.moon;
}

function updatePublicLoginButton() {
  const link = $('#public-login');
  if (!link) return;
  const label = $('span', link);
  link.href = state.viewer ? '/me' : '/login';
  if (label) label.textContent = state.viewer ? '我的' : '登录';
  link.title = state.viewer ? `我的：${state.viewer.username || state.viewer.email || ''}` : '登录';
}

function renderFriendLinks(site) {
  const box = $('#footer-links');
  if (!box) return;
  const links = Array.isArray(site.friendLinks) ? site.friendLinks : [];
  box.innerHTML = links.length ? `<span class="friend-links__label">友情链接</span>${links.map((item) => `<a href="${esc(item.url)}" target="_blank" rel="nofollow noopener noreferrer" title="${esc(item.description || item.name)}">${esc(item.name)}</a>`).join('<i>·</i>')}` : '';
  box.classList.toggle('hidden', !links.length);
}

function toast(msg) {
  const zone = $('.toast-zone');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  zone.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function pickHeroImage(site) {
  const fallback = site.heroImage || '/img/leaf-hero-v2.png?v=1';
  const images = Array.isArray(site.heroImages) ? site.heroImages.filter((item) => item && item.url && item.enabled !== false) : [];
  if (!site.heroRotation || images.length < 2) return images[0]?.url || fallback;
  const key = 'leaf-hero-rotation-index';
  const previous = Number(localStorage.getItem(key) || -1);
  const next = (Number.isFinite(previous) ? previous + 1 : 0) % images.length;
  localStorage.setItem(key, String(next));
  return images[next].url;
}

function setupAmbientEffects(site) {
  const root = $('#site-effects');
  if (!root) return;
  const effects = site.effects || {};
  const blossoms = effects.sakura ? Array.from({ length: 24 }, (_, index) => {
    const left = (index * 37 + 5) % 100;
    const delay = (index % 8) * 1.7;
    const duration = 10 + (index % 6) * 2;
    const drift = -80 + (index % 9) * 20;
    return `<span class="sakura-petal" style="left:${left}%;animation-delay:${delay}s;animation-duration:${duration}s;--petal-drift:${drift}px">🌸</span>`;
  }).join('') : '';
  const lanterns = effects.lanterns ? [12, 28, 71, 88].map((left, index) => `
    <span class="effect-lantern" style="left:${left}%;animation-delay:${index * .8}s"><i></i><b></b></span>`).join('') : '';
  root.innerHTML = `${blossoms}${lanterns}`;
  document.body.classList.toggle('has-sakura', Boolean(effects.sakura));
  document.body.classList.toggle('has-lanterns', Boolean(effects.lanterns));
}

function siteLogo(site) {
  return site.logo || site.avatar || '/img/avatar.svg?v=g1';
}

/* ============ 点击粒子：像素碎屑迸溅 ============ */
const SPARK_COLORS = ['#4aedd9', '#a8fff0', '#c17ff5', '#ffffff', '#5ec9a0', '#ffd75e'];
document.addEventListener('click', (e) => {
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('span');
    s.className = 'click-spark';
    const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.6;
    const dist = 26 + Math.random() * 30;
    s.style.left = e.clientX + 'px';
    s.style.top = e.clientY + 'px';
    s.style.background = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
    s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    s.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
    if (Math.random() > 0.5) s.style.width = '4px';
    if (Math.random() > 0.6) s.style.height = '8px';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 650);
  }
});

/* ============ 导航栏 / 全局壳 ============ */
function buildShell() {
  const site = state.site;
  const tracks = musicTracks(site);
  const firstTrack = tracks[0] || null;
  const items = [
    ['/', '主页', ICO.home],
    ...(site.journalEnabled !== false ? [['/journal', site.journalName || '随笔', ICO.pen]] : []),
    ['/categories', '分类', ICO.folder],
    ['/tags', '标签', ICO.tag],
    ['/archive', '时间线', ICO.clock],
    ['/guestbook', '留言板', ICO.message],
    ['/about', '关于', ICO.user],
  ];
  $('#navbar').innerHTML = `
    <div class="navbar__inner">
      <a class="navbar__logo" href="/">
        <img src="${esc(siteLogo(site))}" data-fallback="/img/avatar.svg?v=g1" alt="logo">${esc(site.title)}
      </a>
      <nav class="nav-links" id="nav-links">
        ${items.map(([href, txt, ico]) => `<a href="${href}">${ico}<span class="txt">${txt}</span></a>`).join('')}
      </nav>
      <a class="login-link" id="public-login" href="/login" title="登录">${ICO.user}<span>登录</span></a>
      <button class="icon-btn" id="btn-search" title="搜索 (Ctrl+K)">${ICO.search}</button>
      <button class="icon-btn" id="btn-dark" title="昼夜切换">${ICO.moon}</button>
    </div>`;

  $('#search-mask').innerHTML = `
    <div class="search-panel glass">
      <div class="search-panel__bar">
        ${ICO.search}
        <input id="search-input" placeholder="搜索文章，回车确认…">
        <kbd>ESC</kbd>
      </div>
      <div class="search-results" id="search-results">
        <div class="search-empty">输入关键词，搜一搜全站文章</div>
      </div>
    </div>`;

  $('#float-btns').innerHTML = `
    <div class="music-dock" id="music-dock">
      <section class="music-panel hidden" id="music-panel" aria-hidden="true">
        <div class="music-panel__head">
          <div><span class="music-panel__eyebrow">LEAF FM · 01</span><strong>林间电台</strong></div>
        </div>
        <div class="music-track">
          <div class="music-disc" id="music-disc"><span>♫</span><i></i></div>
          <div class="music-track__info">
            <span class="music-track__label">NOW PLAYING</span>
            <strong id="music-track-title">${esc(firstTrack?.title || '还没有音乐')}</strong>
            <small id="music-track-status">${tracks.length ? `${tracks.length} 首歌曲 · 点击播放` : '请先到后台设置音频地址'}</small>
          </div>
        </div>
        <div class="music-wave" id="music-wave" aria-hidden="true">${Array.from({ length: 16 }, (_, i) => `<i style="--bar:${(i * 7) % 5 + 2}"></i>`).join('')}</div>
        <input class="music-progress" id="music-progress" type="range" min="0" max="0" value="0" step="0.1" aria-label="播放进度" ${tracks.length ? '' : 'disabled'}>
        <div class="music-time"><span id="music-current">00:00</span><span id="music-duration">00:00</span></div>
        <div class="music-controls">
          <button type="button" id="music-shuffle" title="随机播放">${ICO.shuffle}</button>
          <button type="button" id="music-replay" title="从头播放">${ICO.replay}</button>
          <button type="button" id="music-play" class="music-controls__main" title="播放">${ICO.play}</button>
          <button type="button" id="music-next" title="下一首">${ICO.next}</button>
          <button type="button" id="music-volume" title="静音">${ICO.volume}</button>
        </div>
      </section>
      <button class="music-fab" id="btn-music" type="button" title="${tracks.length ? '打开音乐播放器' : '音乐未配置'}">
        <span class="music-fab__ring"></span>${ICO.music}<b>♪</b>
      </button>
      ${firstTrack ? `<audio id="site-audio" src="${esc(firstTrack.url)}" preload="metadata"></audio>` : ''}
    </div>
    <button class="icon-btn" id="to-top" title="回到顶部">${ICO.up}</button>`;

  $('#btn-dark').addEventListener('click', () => {
    state.dark = !state.dark;
    localStorage.setItem('leaf-dark', state.dark ? '1' : '0');
    applyDark();
  });

  $('#btn-search').addEventListener('click', openSearch);
  $('#search-mask').addEventListener('click', (e) => {
    if (e.target === $('#search-mask')) closeSearch();
  });
  let searchTimer = null;
  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(e.target.value), 260);
  });
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
  });

  $('#to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  updatePublicLoginButton();
  setupMusicPlayer(site, tracks);
}

function setupMusicPlayer(site, tracks = musicTracks(site)) {
  const button = $('#btn-music');
  const panel = $('#music-panel');
  const dock = $('#music-dock');
  const playButton = $('#music-play');
  const shuffleButton = $('#music-shuffle');
  const replayButton = $('#music-replay');
  const nextButton = $('#music-next');
  const volumeButton = $('#music-volume');
  const progress = $('#music-progress');
  const currentTime = $('#music-current');
  const duration = $('#music-duration');
  const trackTitle = $('#music-track-title');
  const trackStatus = $('#music-track-status');
  const disc = $('#music-disc');
  const wave = $('#music-wave');
  const audio = $('#site-audio');
  if (!button) return;

  const formatTime = (value) => {
    const seconds = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const setPanel = (open) => {
    panel?.classList.toggle('hidden', !open);
    panel?.setAttribute('aria-hidden', String(!open));
    button.classList.toggle('is-open', open);
  };
  const togglePanel = () => setPanel(!panel || panel.classList.contains('hidden'));
  const syncEmpty = () => {
    if (trackStatus) trackStatus.textContent = '请先到后台“站点设置”填写音频地址';
    if (playButton) { playButton.disabled = true; playButton.innerHTML = ICO.play; }
    if (replayButton) replayButton.disabled = true;
    if (shuffleButton) shuffleButton.disabled = true;
    if (nextButton) nextButton.disabled = true;
    if (volumeButton) volumeButton.disabled = true;
  };
  if (!audio) {
    syncEmpty();
    button.addEventListener('click', () => { togglePanel(); toast('还没有设置音乐，请到后台“站点设置”填写音频地址'); });
    return;
  }
  const timeKey = 'leaf-music-time';
  const playingKey = 'leaf-music-playing';
  const savedTime = Number(localStorage.getItem(timeKey) || 0);
  let currentIndex = 0;
  let shuffleMode = localStorage.getItem('leaf-music-shuffle') === '1';
  let restored = false;
  let seeking = false;
  const sync = () => {
    const playing = !audio.paused;
    const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
    const track = tracks[currentIndex] || { title: site.musicTitle || '背景音乐' };
    button.classList.toggle('active', playing);
    button.title = '打开音乐播放器';
    panel?.classList.toggle('is-playing', playing);
    disc?.classList.toggle('is-playing', playing);
    wave?.classList.toggle('is-playing', playing);
    if (playButton) playButton.innerHTML = playing ? ICO.pause : ICO.play;
    if (trackTitle) trackTitle.textContent = track.title;
    if (trackStatus) trackStatus.textContent = playing ? '正在播放 · 使用中间按钮暂停' : (audio.ended ? '播放结束 · 点击播放重新开始' : `${tracks.length} 首歌曲 · 点击中间按钮播放`);
    shuffleButton?.classList.toggle('active', shuffleMode);
    if (progress) {
      progress.max = hasDuration ? String(audio.duration) : '0';
      if (!seeking) progress.value = hasDuration ? String(audio.currentTime) : '0';
    }
    if (currentTime) currentTime.textContent = formatTime(audio.currentTime);
    if (duration) duration.textContent = formatTime(audio.duration);
    if (volumeButton) volumeButton.innerHTML = audio.muted ? ICO.mute : ICO.volume;
    if (nextButton) nextButton.disabled = tracks.length < 2;
  };
  const nextIndex = () => {
    if (tracks.length < 2) return currentIndex;
    if (!shuffleMode) return (currentIndex + 1) % tracks.length;
    let index = currentIndex;
    while (index === currentIndex) index = Math.floor(Math.random() * tracks.length);
    return index;
  };
  const selectTrack = async (index, autoplay) => {
    if (!tracks.length) return;
    currentIndex = Math.min(Math.max(Number(index) || 0, 0), tracks.length - 1);
    const track = tracks[currentIndex];
    audio.pause();
    audio.src = track.url;
    audio.load();
    restored = true;
    seeking = false;
    localStorage.setItem(timeKey, '0');
    if (trackTitle) trackTitle.textContent = track.title;
    if (progress) { progress.value = '0'; progress.max = '0'; }
    sync();
    if (autoplay) {
      try { await audio.play(); }
      catch { if (trackStatus) trackStatus.textContent = '音乐播放失败 · 请检查音频地址'; }
    }
  };
  const restore = () => {
    if (restored) return;
    restored = true;
    if (savedTime > 0 && Number.isFinite(audio.duration) && savedTime < audio.duration) audio.currentTime = savedTime;
  };
  const togglePlayback = async () => {
    if (audio.paused) {
      restore();
      try { await audio.play(); toast(`正在播放：${tracks[currentIndex]?.title || site.musicTitle || '背景音乐'}`); }
      catch { toast('音乐播放失败，请检查音频地址'); }
    } else audio.pause();
    sync();
  };
  audio.addEventListener('loadedmetadata', restore, { once: true });
  audio.addEventListener('loadedmetadata', sync);
  audio.addEventListener('durationchange', sync);
  audio.addEventListener('timeupdate', () => {
    localStorage.setItem(timeKey, String(audio.currentTime));
    if (!seeking) sync();
  });
  audio.addEventListener('play', () => { localStorage.setItem(playingKey, '1'); sync(); });
  audio.addEventListener('pause', () => { localStorage.setItem(playingKey, '0'); sync(); });
  audio.addEventListener('ended', () => {
    localStorage.setItem(timeKey, '0');
    localStorage.setItem(playingKey, '0');
    if (tracks.length > 1) selectTrack(nextIndex(), true);
    else sync();
  });
  audio.addEventListener('error', () => { if (trackStatus) trackStatus.textContent = '音频加载失败 · 请检查地址或文件格式'; });
  button.addEventListener('click', togglePanel);
  playButton?.addEventListener('click', togglePlayback);
  shuffleButton?.addEventListener('click', () => {
    shuffleMode = !shuffleMode;
    localStorage.setItem('leaf-music-shuffle', shuffleMode ? '1' : '0');
    sync();
  });
  replayButton?.addEventListener('click', () => { restore(); audio.currentTime = 0; if (audio.paused) togglePlayback(); else sync(); });
  nextButton?.addEventListener('click', () => selectTrack(nextIndex(), !audio.paused));
  volumeButton?.addEventListener('click', () => { audio.muted = !audio.muted; sync(); });
  let seekTarget = 0;
  const seekTo = (value) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const target = Math.min(Math.max(Number(value) || 0, 0), audio.duration);
    if (typeof audio.fastSeek === 'function') audio.fastSeek(target);
    else audio.currentTime = target;
  };
  const finishSeek = () => {
    if (!seeking) return;
    seeking = false;
    seekTo(seekTarget);
    sync();
  };
  progress?.addEventListener('pointerdown', () => { seeking = true; seekTarget = Number(progress.value) || 0; });
  progress?.addEventListener('input', () => {
    if (!Number.isFinite(audio.duration)) return;
    seekTarget = Math.min(Math.max(Number(progress.value) || 0, 0), audio.duration);
    if (currentTime) currentTime.textContent = formatTime(seekTarget);
  });
  progress?.addEventListener('change', finishSeek);
  progress?.addEventListener('pointerup', finishSeek);
  progress?.addEventListener('pointercancel', finishSeek);
  dock?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', (event) => { if (!dock?.contains(event.target)) setPanel(false); });
  sync();
}

/* ============ 路由 ============ */
const routes = new Map();
let homeHeroCleanup = null;
let articleCleanup = null;
let homeReturn = null;
function route(pattern, view) { routes.set(pattern, view); }

async function navigate(url, push = true) {
  let u = new URL(url, location.origin);
  const isHomePath = (pathname) => pathname === '/' || pathname === '/index.html';
  if (push && isHomePath(location.pathname) && u.pathname.startsWith('/post/')) {
    homeReturn = { url: location.pathname + location.search, y: window.scrollY };
  }
  let restoreHomeY = 0;
  if (homeReturn && isHomePath(u.pathname)) {
    restoreHomeY = homeReturn.y;
    if (push && u.pathname + u.search !== homeReturn.url) {
      u = new URL(homeReturn.url, location.origin);
    }
  }
  const view = matchRoute(u.pathname);
  homeHeroCleanup?.();
  homeHeroCleanup = null;
  articleCleanup?.();
  articleCleanup = null;
  if (push) history.pushState(null, '', u.href);
  setActiveNav(u.pathname);

  const viewEl = $('#view');
  viewEl.classList.add('view-leaving');
  await wait(210);

  window.scrollTo(0, 0);
  document.body.classList.remove('content-blur');
  window.dispatchEvent(new Event('scroll'));
  viewEl.classList.remove('view-leaving');
  viewEl.innerHTML = '<div style="min-height:60vh"></div>';
  try {
    await view(viewEl, u);
  } catch (err) {
    viewEl.innerHTML = errorHtml(err.message);
  }
  if (homeReturn && isHomePath(u.pathname)) {
    if (restoreHomeY > 0) requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: restoreHomeY, behavior: 'auto' })));
    homeReturn = null;
  }
  setupReveals(viewEl);
  bindSlogans(viewEl);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* 滚动浮现：元素进入视口才淡入上移（scroll + 轮询双保险，兼容所有浏览器） */
let revealEls = [];
let revealTimer = null;
function setupReveals(root) {
  revealEls = $$('.reveal:not(.in)', root);
  revealEls.forEach((el, i) => {
    el.classList.remove('in');
    el.style.transitionDelay = `${Math.min(i * 70, 450)}ms`;
  });
  checkReveals();
}
function checkReveals() {
  if (!revealEls.length) return;
  const vh = window.innerHeight;
  revealEls = revealEls.filter((el) => {
    if (el.getBoundingClientRect().top < vh * 0.94) {
      el.classList.add('in');
      // 进入后再清除延迟，连续滚动更顺滑
      setTimeout(() => { el.style.transitionDelay = ''; }, 800);
      return false;
    }
    return true;
  });
}
window.addEventListener('scroll', checkReveals, { passive: true });
window.addEventListener('resize', checkReveals, { passive: true });
setInterval(checkReveals, 250);

/* 打字机标语：宽度按字数精确计算（含字距），光标贴着文字 */
function bindSlogans(root) {
  $$('.hero__slogan', root).forEach((slogan) => {
    const text = slogan.dataset.text || slogan.textContent;
    const len = [...text].length;
    // 每个全角字符 ≈ 1em，另有 2px 字距，再加一点余量让光标刚好贴在句尾
    slogan.style.setProperty('--type-w', `calc(${len} * (1em + 2px) + 0.6em)`);
    slogan.style.setProperty('--type-steps', len);
    slogan.style.setProperty('--type-dur', Math.max(1.2, len * 0.16) + 's');
    slogan.style.animation = 'none';
    void slogan.offsetWidth;
    slogan.style.animation = '';
  });
}

function matchRoute(path) {
  if (path === '/' || path === '/index.html') return views.home;
  if (routes.has(path)) return routes.get(path);
  const m = path.match(/^\/post\/(.+)$/);
  if (m) return (el, u) => views.post(el, new URLSearchParams({ slug: decodeURIComponent(m[1]) }), u);
  return views.notFound;
}

function setActiveNav(path) {
  $$('#nav-links a').forEach((a) => {
    const href = a.getAttribute('href');
    const base = href.split('?')[0];
    const hasQuery = href.includes('?');
    const queryMatches = !hasQuery || location.search === href.slice(href.indexOf('?'));
    const isCategoryOverview = base === '/categories' && !hasQuery && Boolean(location.search);
    a.classList.toggle('active', !isCategoryOverview && queryMatches && (base === '/' ? path === '/' : path.startsWith(base)));
  });
}

/* 全站内部链接拦截 + data-href 委托（避免 <a> 嵌套 <a>） */
document.addEventListener('click', (e) => {
  const dh = e.target.closest('[data-href]');
  if (dh && !e.target.closest('a[href]')) {
    e.preventDefault();
    e.stopPropagation();
    navigate(dh.dataset.href);
    return;
  }
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//')) return;
  if (a.hasAttribute('data-native') || href.startsWith('/admin/') || href.startsWith('/api/')) return;
  if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener('popstate', () => navigate(location.href, false));

/* ============ 视图 ============ */
const views = {};

function sidebarHtml(stats) {
  return `
  <aside class="sidebar">
    <div class="glass content-switcher reveal">
      <div class="content-switcher__label">${ICO.list}<span>内容分类</span></div>
      <div class="content-switcher__buttons" role="tablist" aria-label="主页内容分类">
        <button class="content-switcher__btn active" type="button" role="tab" aria-selected="true" data-home-mode="blog">${ICO.bookmark}<span>我的博客</span></button>
        <button class="content-switcher__btn" type="button" role="tab" aria-selected="false" data-home-mode="hot">${ICO.hot}<span>每日热点</span></button>
      </div>
    </div>
    <div class="glass profile-card reveal">
      <div class="profile-card__name">${esc(state.site.title)}</div>
      <div class="profile-card__desc">${esc(state.site.description)}</div>
      <div class="profile-card__links">
        <a href="/about">${ICO.user}进一步了解我？</a>
        <a href="/archive">${ICO.clock}最近更新了什么？</a>
        <a href="/guestbook">${ICO.bookmark}我的留言板</a>
      </div>
    </div>
    <div class="glass author-card reveal">
      <img class="author-card__avatar" src="${esc(state.site.avatar)}" data-fallback="/img/avatar.svg?v=g1" alt="avatar">
      <div class="author-card__name">${esc(state.site.authorName || '博主')}</div>
      <div class="author-card__role">${esc(state.site.authorRole || 'AUTHOR')}</div>
      <div class="author-card__stats">
        <div><div class="num">${stats.tags}</div><div class="lab">标签</div></div>
        <div><div class="num">${stats.categories}</div><div class="lab">分类</div></div>
        <div><div class="num">${stats.posts}</div><div class="lab">文章</div></div>
      </div>
    </div>
    ${state.site.donationEnabled ? `<div class="glass donation-card reveal">
      <div class="donation-card__title">支持一下</div>
      <p>${esc(state.site.donationText || '如果内容对你有帮助，欢迎请我喝杯咖啡 ☕')}</p>
      ${state.site.donationQr ? `<img src="${esc(state.site.donationQr)}" alt="打赏二维码" loading="lazy">` : '<div class="donation-card__empty">请在后台配置二维码</div>'}
    </div>` : ''}
  </aside>`;
}

function postCardHtml(p) {
  return `
  <a class="glass glass-hover post-card reveal" href="/post/${encodeURIComponent(p.slug)}">
    <div class="post-card__cover">
      <img src="${esc(p.cover)}" data-fallback="/covers/theme.svg?v=g1" alt="${esc(p.title)}" loading="lazy">
      ${p.pinned ? `<span class="pin-badge">${ICO.pin} 置顶</span>` : ''}
    </div>
    <div class="post-card__body">
      <div class="post-card__title">${esc(p.title)}</div>
      <div class="post-card__excerpt">${esc(p.excerpt)}</div>
      <div class="post-card__foot">
        <span class="meta">${ICO.calendar}${fmtDate(p.date)}</span>
        <span class="meta" data-href="/categories?c=${encodeURIComponent(p.category)}" style="cursor:pointer">${ICO.folder}${esc(p.category)}</span>
        <span class="meta">${ICO.eye}${p.views} 阅读</span>
        <span class="meta">${ICO.heart}${p.likes}</span>
        <span class="post-card__more">阅读全文 ${ICO.right}</span>
      </div>
    </div>
  </a>`;
}

/* ---- 首页 ---- */
views.home = async (el) => {
  const PAGE = 5;
  const qPage = +(new URLSearchParams(location.search).get('page') || 1);
  let page = qPage;
  const heroImage = state.heroImage || state.site.heroImage || '/img/leaf-hero-v2.png?v=1';
  const hasMusic = musicTracks(state.site).length > 0;

  el.innerHTML = `
    <section class="hero">
      <div class="hero__backdrop" data-hero-image="${esc(heroImage)}" aria-hidden="true"></div>
      <div class="hero__veil" aria-hidden="true"></div>
      <div class="hero__content">
        <h1 class="hero__title">${esc(state.site.title)}</h1>
        <p class="hero__slogan" data-text="${esc(state.site.subtitle)}">${esc(state.site.subtitle)}</p>
      </div>
      <a class="glass hero__scroll" href="#home-list" data-scroll>${ICO.down}</a>
      <div class="glass hero__social">
        ${state.site.github ? `<a href="${esc(state.site.github)}" target="_blank" rel="noopener" title="GitHub">${ICO.github}</a>` : ''}
        ${state.site.email ? `<a href="mailto:${esc(state.site.email)}" title="邮箱">${ICO.mail}</a>` : ''}
        <a href="https://www.bilibili.com" target="_blank" rel="noopener" title="B站">${ICO.tv}</a>
        <a href="#" id="hero-music" title="${hasMusic ? '打开音乐播放器' : '设置音乐后播放'}">${ICO.music}</a>
        <span class="divider"></span>
        <a href="/guestbook" title="留言板">${ICO.message}</a>
      </div>
    </section>
    <main class="main-wrap overlap" id="home-list">
      <div class="layout">
        ${sidebarHtml(state.stats)}
        <div>
          <div class="home-feed-head">
            <div>
              <div class="home-feed-head__title" id="home-feed-title">我的博客</div>
              <div class="home-feed-head__meta" id="home-feed-meta">记录代码、游戏和生活</div>
            </div>
          </div>
          <div class="post-list" id="post-list"></div>
          <div class="hot-topics-list hidden" id="hot-topics-list"></div>
          <div class="pagination" id="pager"></div>
        </div>
      </div>
    </main>`;
  document.title = `${state.site.title} · ${esc(state.site.en)}`;

  const renderPage = () => {
    const pages = Math.ceil(state.posts.length / PAGE);
    page = Math.min(Math.max(page, 1), pages);
    const slice = state.posts.slice((page - 1) * PAGE, page * PAGE);
    $('#post-list').innerHTML = slice.map(postCardHtml).join('');
    let html = `<button class="glass page-btn" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${ICO.left}</button>`;
    for (let i = 1; i <= pages; i++) html += `<button class="glass page-btn ${i === page ? 'current' : ''}" data-p="${i}">${i}</button>`;
    html += `<button class="glass page-btn" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>${ICO.right}</button>`;
    $('#pager').innerHTML = html;
    $$('#pager .page-btn').forEach((b) => b.addEventListener('click', () => {
      page = +b.dataset.p;
      history.replaceState(null, '', page > 1 ? `/?page=${page}` : '/');
      renderPage();
      $('#home-list').scrollIntoView({ behavior: 'smooth' });
    }));
    // 新卡片进入视口时才浮现
    setupReveals($('#post-list'));
  };
  renderPage();

  const hotList = $('#hot-topics-list');
  const renderHotDay = (data, selectedDate) => {
    const day = data.days.find((item) => item.date === selectedDate) || data.days[0];
    if (!day) {
      hotList.innerHTML = '<div class="glass hot-topics-empty">暂时没有获取到热点，请稍后再试。</div>';
      return;
    }
    const updated = day.updatedAt ? new Date(day.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '等待更新';
    const groups = [
      { key: 'tech', label: '科技热点', icon: ICO.list, items: day.categories?.tech || [] },
      { key: 'game', label: '游戏热点', icon: ICO.hot, items: day.categories?.game || [] },
      { key: 'github', label: 'GitHub 热点', icon: ICO.github, items: day.categories?.github || [] },
      { key: 'entertainment', label: '娱乐热点', icon: ICO.message, items: day.categories?.entertainment || [] },
    ];
    hotList.innerHTML = `
      <div class="hot-topics__summary glass">
        <span>${ICO.hot} ${day.date === data.today ? '今日热点' : '昨日热点'}</span>
        <small>${day.date === data.today ? '' : '历史保留数据 · '}${esc(day.date)} · 更新于 ${esc(updated)}</small>
      </div>
      <div class="hot-topics__tabs" role="tablist" aria-label="热点日期">
        ${data.days.map((item) => `
          <button class="hot-topic-day-btn ${item.date === day.date ? 'active' : ''}" type="button" role="tab" aria-selected="${item.date === day.date ? 'true' : 'false'}" data-hot-date="${esc(item.date)}">
            <span>${item.date === data.today ? '今天' : '昨天'}</span><small>${esc(item.date)}</small>
          </button>`).join('')}
      </div>
      ${groups.map((group) => `
        <section class="hot-topics__group">
          <h3 class="hot-topics__group-title">${group.icon}<span>${group.label}</span><small>${group.items.length} 条</small></h3>
          <div class="hot-topics__items">
            ${group.items.length ? group.items.map((item, index) => `
              <a class="glass glass-hover hot-topic-card reveal" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer nofollow">
                <span class="hot-topic-card__rank">${String(index + 1).padStart(2, '0')}</span>
                <span class="hot-topic-card__body">
                  <span class="hot-topic-card__title">${esc(item.title)}</span>
                  <span class="hot-topic-card__meta">${esc(item.source || '未知来源')}${item.publishedAt ? ` · ${esc(fmtDate(item.publishedAt))}` : ''}</span>
                </span>
                <span class="hot-topic-card__arrow">${ICO.right}</span>
              </a>`).join('') : '<div class="glass hot-topics__group-empty">这个分类暂时没有可用热点。</div>'}
          </div>
        </section>`).join('')}
      </div>`;
    $$('.hot-topic-day-btn', hotList).forEach((button) => {
      button.addEventListener('click', () => renderHotDay(data, button.dataset.hotDate));
    });
    setupReveals(hotList);
  };

  const renderHotTopics = async () => {
    if (!hotList) return;
    hotList.innerHTML = '<div class="glass hot-topics-empty">正在获取今日热点…</div>';
    try {
      const data = state.hotTopics || await api('/api/hot-topics');
      state.hotTopics = data;
      if (!data.enabled) {
        hotList.innerHTML = '<div class="glass hot-topics-empty">每日热点功能尚未开启。</div>';
        return;
      }
      if (!Array.isArray(data.days) || !data.days.length) {
        hotList.innerHTML = '<div class="glass hot-topics-empty">暂时没有获取到热点，请稍后再试。</div>';
        return;
      }
      renderHotDay(data, data.today || data.days[0].date);
    } catch (error) {
      hotList.innerHTML = `<div class="glass hot-topics-empty">热点暂时加载失败：${esc(error.message)}</div>`;
    }
  };

  const setHomeMode = (mode) => {
    const isHot = mode === 'hot';
    $$('.content-switcher__btn', el).forEach((button) => {
      const active = button.dataset.homeMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('#post-list').classList.toggle('hidden', isHot);
    $('#pager').classList.toggle('hidden', isHot);
    hotList.classList.toggle('hidden', !isHot);
    $('#home-feed-title').textContent = isHot ? '每日热点' : '我的博客';
    $('#home-feed-meta').textContent = isHot ? '每天自动整理，点击标题查看原文' : '记录代码、游戏和生活';
    if (isHot) void renderHotTopics();
    else renderPage();
  };
  $$('.content-switcher__btn', el).forEach((button) => {
    button.addEventListener('click', () => setHomeMode(button.dataset.homeMode));
  });

  // 首页首屏的背景图会随滚动缓慢放大、虚化并淡出，离开首页时清理监听。
  const hero = $('.hero', el);
  const backdrop = $('.hero__backdrop', el);
  const heroContent = $('.hero__content', el);
  const heroScroll = $('.hero__scroll', el);
  const heroSocial = $('.hero__social', el);
  const safeImage = backdrop?.dataset.heroImage?.replace(/["\\\r\n]/g, '');
  let heroPreload = null;
  if (backdrop && safeImage) {
    const fallbackImage = '/img/leaf-hero-v2.png?v=1';
    backdrop.style.backgroundImage = `url("${fallbackImage}")`;
    heroPreload = new Image();
    heroPreload.onload = () => { backdrop.style.backgroundImage = `url("${safeImage}")`; };
    heroPreload.src = safeImage;
  }
  let heroRaf = 0;
  const updateHero = () => {
    if (heroRaf) return;
    heroRaf = requestAnimationFrame(() => {
      heroRaf = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / Math.max(hero.offsetHeight * 0.82, 1)));
      if (backdrop) {
        backdrop.style.transform = `scale(${1.04 + progress * 0.1}) translateY(${progress * 26}px)`;
        backdrop.style.filter = `blur(${progress * 4}px) saturate(${1.08 - progress * 0.12})`;
        backdrop.style.opacity = String(Math.max(0.72, 0.96 - progress * 0.24));
      }
      if (heroContent) {
        heroContent.style.opacity = String(Math.max(0.12, 1 - progress * 0.9));
        heroContent.style.transform = `translateY(${-progress * 36}px)`;
      }
      if (heroScroll) heroScroll.style.opacity = String(Math.max(0, 1 - progress * 2));
      if (heroSocial) heroSocial.style.opacity = String(Math.max(0.2, 1 - progress * 1.3));
    });
  };
  window.addEventListener('scroll', updateHero, { passive: true });
  updateHero();
  homeHeroCleanup = () => {
    window.removeEventListener('scroll', updateHero);
    if (heroRaf) cancelAnimationFrame(heroRaf);
    if (heroPreload) { heroPreload.onload = null; heroPreload.onerror = null; }
  };

  // 打字机重放
  const slogan = $('.hero__slogan', el);
  slogan.style.width = '0';
  void slogan.offsetWidth;
  if ($('#hero-music')) $('#hero-music').addEventListener('click', (event) => { event.preventDefault(); $('#btn-music')?.click(); });
};

function commentCardHtml(item) {
  return `<article class="comment-card glass-hover">
    <div class="comment-card__head"><strong class="comment-card__name">${esc(item.name || '登录用户')}</strong>${item.isAuthor ? '<span class="author-badge">博主</span>' : ''}<time class="comment-card__time">${timeAgo(item.time)}</time></div>
    <div class="comment-card__message">${esc(item.message)}</div>
  </article>`;
}

function postCommentsHtml(post) {
  const items = Array.isArray(post.comments) ? post.comments : [];
  const composer = state.viewer
    ? `<div class="comment-form">
        <textarea class="g-input" id="post-comment-message" maxlength="500" placeholder="写下你对这篇文章的想法…（最长 500 字）"></textarea>
        <div><button class="btn-primary" id="post-comment-submit">${ICO.pen}发布留言</button></div>
      </div>`
    : `<div class="login-required">登录后才能给这篇文章留言。<a class="auth-inline" href="/login">现在登录</a></div>`;
  return `<section class="glass post-comments reveal" id="post-comments">
    <div class="comments-head"><h3>文章留言</h3><span id="post-comment-count">${post.commentCount || 0} 条</span></div>
    ${composer}
    <div class="comment-list" id="post-comment-list">${items.length ? items.map(commentCardHtml).join('') : '<div class="comment-empty">还没有留言，来留下第一句话吧。</div>'}</div>
  </section>`;
}

function journalCardHtml(item) {
  const comments = Array.isArray(item.comments) ? item.comments : [];
  const composer = state.viewer
    ? `<div class="comment-form">
        <textarea class="g-input" data-journal-message maxlength="500" placeholder="想说点什么？（最长 500 字）"></textarea>
        <div><button class="btn-primary" type="button" data-journal-submit>${ICO.pen}发布留言</button></div>
      </div>`
    : `<div class="login-required">登录后可以给这条随笔留言。<a class="auth-inline" href="/login">现在登录</a></div>`;
  return `<article class="glass journal-card reveal" data-journal-id="${esc(item.id)}">
    <time class="journal-card__time">${timeAgo(item.time)}</time>
    <div class="md journal-card__content">${item.contentHtml || '<p class="journal-empty">这条随笔还没有内容。</p>'}</div>
    <section class="journal-card__comments">
      <div class="comments-head"><h3>随手评论</h3><span data-journal-count>${item.commentCount || 0} 条</span></div>
      ${composer}
      <div class="comment-list" data-journal-comments>${comments.length ? comments.map(commentCardHtml).join('') : '<div class="comment-empty">还没有评论，来留下第一句话吧。</div>'}</div>
    </section>
  </article>`;
}

/* ---- 文章页 ---- */
views.post = async (el, params) => {
  const slug = params.get('slug');
  const p = await api('/api/posts/' + encodeURIComponent(slug));
  document.title = `${p.title} · ${state.site.title}`;

  el.innerHTML = `
  <div class="page-hero">
    <h1 style="font-size:26px">${esc(p.title)}</h1>
    <div class="post-meta" style="justify-content:center;border:none;padding-bottom:0">
      <span class="meta">${ICO.calendar}${fmtDate(p.date)}</span>
      <span class="meta">${ICO.clock}约 ${p.minutes} 分钟</span>
      <a class="meta" href="/categories?c=${encodeURIComponent(p.category)}">${ICO.folder}${esc(p.category)}</a>
      ${p.tags.map((t) => `<a class="tag-mini" href="/tags?t=${encodeURIComponent(t)}"># ${esc(t)}</a>`).join('')}
      <span class="meta">${ICO.eye}${p.views} 阅读</span>
    </div>
  </div>
  <main class="main-wrap" style="padding-top:0">
    <div class="glass post-banner reveal"><img src="${esc(p.cover)}" data-fallback="/covers/theme.svg?v=g1" alt="${esc(p.title)}"></div>
    <div class="post-layout">
      <div>
        <article class="glass post-article reveal">
          <div class="md" id="md">${p.contentHtml}</div>
          <div class="like-row">
            <button class="like-btn${p.likedByViewer ? ' liked' : ''}" id="like-btn" aria-pressed="${p.likedByViewer ? 'true' : 'false'}">${ICO.heart}<span>${p.likedByViewer ? '你已赞过这篇文章' : state.viewer ? '喜欢这篇文章' : '登录后点赞'}</span><b id="like-num">${p.likes}</b></button>
          </div>
          ${state.site.donationEnabled && state.site.donationQr ? `<div class="post-donation"><div><strong>喜欢这篇文章？</strong><p>${esc(state.site.donationText || '欢迎请我喝杯咖啡 ☕')}</p></div><img src="${esc(state.site.donationQr)}" alt="打赏二维码" loading="lazy"></div>` : ''}
        </article>
        ${postCommentsHtml(p)}
        <div class="pn-grid">
          ${p.prev ? `<a class="glass pn-card reveal" href="/post/${encodeURIComponent(p.prev.slug)}"><span class="lab">← 上一篇</span>${esc(p.prev.title)}</a>` : `<span class="glass pn-card off reveal"><span class="lab">← 上一篇</span>没有更早的了</span>`}
          ${p.next ? `<a class="glass pn-card next reveal" href="/post/${encodeURIComponent(p.next.slug)}"><span class="lab">下一篇 →</span>${esc(p.next.title)}</a>` : `<span class="glass pn-card next off reveal"><span class="lab">下一篇 →</span>已经是最新了</span>`}
        </div>
      </div>
      <aside>
        <div class="glass toc-card reveal">
          <h4>${ICO.list}目录</h4>
          ${p.toc.length ? `<ul class="toc-list">${p.toc.map((t) =>
            `<li><a class="${t.level === 3 ? 'l3' : ''}" href="#${t.slug}" data-slug="${t.slug}">${esc(t.text)}</a></li>`).join('')}</ul>`
    : '<div class="toc-empty">本文没有小标题</div>'}
        </div>
      </aside>
    </div>
    ${p.related.length ? `
    <div class="side-title">相关推荐</div>
    <div class="rel-grid">
      ${p.related.map((r) => `
        <a class="glass glass-hover rel-card reveal" href="/post/${encodeURIComponent(r.slug)}">
          <img src="${esc(r.cover)}" data-fallback="/covers/theme.svg?v=g1" alt="" loading="lazy">
          <span class="t">${esc(r.title)}</span>
        </a>`).join('')}
    </div>` : ''}
  </main>`;

  // 点赞
  $('#like-btn').addEventListener('click', async () => {
    if (!state.viewer) return toast('请先登录后再点赞');
    if (p.likedByViewer) return toast('你已经点过赞了');
    try {
      const r = await api(`/api/posts/${encodeURIComponent(p.slug)}/like`, { method: 'POST' });
      p.likedByViewer = true;
      $('#like-num').textContent = r.likes;
      const b = $('#like-btn');
      b.classList.add('liked');
      b.setAttribute('aria-pressed', 'true');
      b.querySelector('span').textContent = '你已赞过这篇文章';
    } catch (e) {
      if (e.code === 'ALREADY_LIKED' || e.status === 409) {
        p.likedByViewer = true;
        $('#like-btn').classList.add('liked');
        $('#like-btn').setAttribute('aria-pressed', 'true');
        $('#like-btn span').textContent = '你已赞过这篇文章';
        $('#like-num').textContent = e.likes ?? $('#like-num').textContent;
        return toast('你已经点过赞了');
      }
      toast('点赞失败：' + e.message);
    }
  });

  $('#post-comment-submit')?.addEventListener('click', async () => {
    const textarea = $('#post-comment-message');
    const message = textarea.value.trim();
    if (!message) return toast('留言内容不能为空哦');
    try {
      const item = await api(`/api/posts/${encodeURIComponent(p.slug)}/comments`, {
        method: 'POST', body: JSON.stringify({ message }),
      });
      if (item.pending) {
        textarea.value = '';
        return toast('留言已提交，等待审核后展示 🌱');
      }
      p.comments = [item, ...(p.comments || [])];
      p.commentCount = (p.commentCount || 0) + 1;
      $('#post-comment-list .comment-empty')?.remove();
      $('#post-comment-list').insertAdjacentHTML('afterbegin', commentCardHtml(item));
      $('#post-comment-count').textContent = `${p.commentCount} 条`;
      textarea.value = '';
      toast('留言已发布 🌱');
    } catch (e) {
      toast(e.status === 401 ? '请先登录后再留言' : '留言失败：' + e.message);
    }
  });

  // 目录高亮：目录卡片随文章自然滚动，不会吸附或自行滚动。
  const heads = $$('#md h2, #md h3');
  const links = $$('.toc-list a', el);
  let activeSlug = '';
  links.forEach((link) => link.addEventListener('click', (event) => {
    const target = document.getElementById(link.dataset.slug);
    if (!target) return;
    event.preventDefault();
    const offset = window.innerWidth <= 720 ? 76 : 96;
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', `${location.pathname}${location.search}#${link.dataset.slug}`);
  }));
  const spy = () => {
    if (!heads.length || !links.length) return;
    let cur = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top < 130) cur = h;
    if (cur.id === activeSlug) return;
    activeSlug = cur.id;
    links.forEach((a) => {
      const active = a.dataset.slug === cur.id;
      a.classList.toggle('on', active);
      if (active) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  };
  window.addEventListener('scroll', spy, { passive: true });
  const spyTimer = setInterval(() => {
    spy();
  }, 250);
  articleCleanup = () => {
    window.removeEventListener('scroll', spy);
    clearInterval(spyTimer);
  };
  spy();
};

/* ---- 归档 ---- */
views.archive = async (el) => {
  const data = await api('/api/archives');
  document.title = `时间线 · ${state.site.title}`;
  el.innerHTML = `
  <div class="page-hero"><h1>时间线</h1><p>共 ${data.total} 篇 · 每一格都是一段时光</p></div>
  <main class="main-wrap" style="padding-top:0;max-width:900px">
    <div class="glass timeline-card reveal">
      ${data.years.map((y) => `
        <div class="tl-year">${y.year} <small>（${y.count} 篇）</small></div>
        <div class="tl-list">
          ${y.posts.map((p) => `
            <div class="tl-item">
              <time>${fmtDate(p.date)}</time>
              <a href="/post/${encodeURIComponent(p.slug)}">${esc(p.title)}</a>
              <span class="cat">${esc(p.category)}</span>
            </div>`).join('')}
        </div>`).join('')}
    </div>
  </main>`;
};

/* ---- 分类 ---- */
views.categories = async (el, u) => {
  const cats = await api('/api/categories');
  document.title = `分类 · ${state.site.title}`;
  const target = u.searchParams.get('c');
  const isJournal = target && target === (state.site.journalName || '随笔');
  const visibleCats = target ? cats.filter((item) => item.name === target) : cats;
  const icons = ['🍃', '💻', '🌤', '🛠'];
  el.innerHTML = `
  <div class="page-hero"><h1>${esc(isJournal ? target : '分类')}</h1><p>${esc(isJournal ? (state.site.journalDescription || '记录生活、灵感和那些不想忘记的小事。') : `共 ${cats.length} 个分类`)}</p></div>
  <main class="main-wrap" style="padding-top:0">
    <div class="cat-grid">
      ${visibleCats.map((c, i) => `
        <div class="glass glass-hover cat-card reveal" style="cursor:pointer" data-jump="/categories?c=${encodeURIComponent(c.name)}">
          <div class="cat-card__head">
            <div class="cat-card__ico">${icons[i % icons.length]}</div>
            <h3>${esc(c.name)}</h3>
            <span class="count">${c.count} 篇</span>
          </div>
          <ul>
            ${c.posts.slice(0, 5).map((p) => `
              <li><time>${fmtDate(p.date)}</time><a href="/post/${encodeURIComponent(p.slug)}">${esc(p.title)}</a></li>`).join('')}
          </ul>
        </div>`).join('')}
    </div>
    ${target && !visibleCats.length ? '<div class="glass search-empty reveal">这个分类还没有文章，去后台新建一篇吧。</div>' : ''}
  </main>`;
  $$('.cat-card', el).forEach((c) => c.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    navigate(c.dataset.jump);
  }));
};

/* ---- 随笔：只有正文和时间，不强制标题 ---- */
views.journal = async (el) => {
  const data = await api('/api/journals');
  const name = state.site.journalName || '随笔';
  document.title = `${name} · ${state.site.title}`;
  el.innerHTML = `
  <div class="page-hero"><h1>${esc(name)}</h1><p>${esc(state.site.journalDescription || '想到什么就写什么，留下一点轻松的日常。')}</p></div>
  <main class="main-wrap" style="padding-top:0;max-width:860px">
    <div class="journal-feed" id="journal-feed">
      ${data.items.length ? data.items.map(journalCardHtml).join('') : '<div class="glass journal-empty-card reveal">还没有随笔，去后台写下第一段吧。</div>'}
    </div>
  </main>`;

  $$('[data-journal-submit]', el).forEach((button) => button.addEventListener('click', async () => {
    const card = button.closest('[data-journal-id]');
    const id = card?.dataset.journalId;
    const textarea = $('[data-journal-message]', card);
    const message = textarea?.value.trim();
    if (!id || !message) return toast('留言内容不能为空哦');
    button.disabled = true;
    try {
      const item = await api(`/api/journals/${encodeURIComponent(id)}/comments`, { method: 'POST', body: JSON.stringify({ message }) });
      if (item.pending) {
        textarea.value = '';
        return toast('评论已提交，等待审核后展示 🌱');
      }
      const list = $('[data-journal-comments]', card);
      $('.comment-empty', list)?.remove();
      list.insertAdjacentHTML('afterbegin', commentCardHtml(item));
      const count = $('[data-journal-count]', card);
      count.textContent = `${Number(count.textContent.replace(/\D/g, '') || 0) + 1} 条`;
      textarea.value = '';
      toast('评论已发布 🌱');
    } catch (error) {
      toast(error.status === 401 ? '请先登录后再评论' : `评论失败：${error.message}`);
    } finally {
      button.disabled = false;
    }
  }));
};

/* ---- 标签 ---- */
views.tags = async (el, u) => {
  const tags = await api('/api/tags');
  document.title = `标签 · ${state.site.title}`;
  const active = u.searchParams.get('t');
  el.innerHTML = `
  <div class="page-hero"><h1>标签</h1><p>共 ${tags.length} 个标签</p></div>
  <main class="main-wrap" style="padding-top:0;max-width:860px">
    <div class="glass tag-cloud reveal">
      ${tags.map((t) => `<a class="tag-chip ${t.name === active ? 'on' : ''}" href="/tags?t=${encodeURIComponent(t.name)}">${esc(t.name)}<b>${t.count}</b></a>`).join('')}
    </div>
    <div class="tag-list" id="tag-list"></div>
  </main>`;
  const box = $('#tag-list');
  if (active) {
    const res = await api('/api/posts?tag=' + encodeURIComponent(active) + '&limit=50');
    box.innerHTML = res.items.map((p) => `
      <div class="glass glass-hover tag-item reveal">
        <time>${fmtDate(p.date)}</time>
        <a href="/post/${encodeURIComponent(p.slug)}">${esc(p.title)}</a>
        <span class="cat">${esc(p.category)}</span>
      </div>`).join('') || '<div class="search-empty">这个标签还没有文章</div>';
    setupReveals(box);
  } else {
    box.innerHTML = '<div class="search-empty">👆 点击上面的标签查看文章</div>';
  }
};

/* ---- 留言板 ---- */
views.guestbook = async (el) => {
  document.title = `留言板 · ${state.site.title}`;
  const composer = state.viewer
    ? `<div class="auth-note">将以“${esc(state.viewer.username || '登录用户')}”的名义留言。名字可以在“我的”里修改。</div>
      <div class="g-field">
        <label>想说的话</label>
        <textarea class="g-input" id="g-msg" maxlength="500" placeholder="写点鼓励、吐槽或者随手的心情…（最长 500 字）"></textarea>
      </div>
      <button class="btn-primary" id="g-submit">${ICO.pen}签下留言</button>`
    : `<div class="login-required">登录后才能在留言板留下足迹。<a class="auth-inline" href="/login">现在登录</a></div>`;
  el.innerHTML = `
  <div class="page-hero"><h1>留言板</h1><p>来吧，留下你的足迹 🌱</p></div>
  <main class="main-wrap" style="padding-top:0;max-width:780px">
    <div class="glass guest-form reveal">${composer}</div>
    <div class="guest-list" id="guest-list"></div>
  </main>`;

  const AVAS = ['🍃', '🌿', '🌸', '🍀', '🌊'];
  const COLORS = ['linear-gradient(135deg,#5ec9a0,#3a9ad8)', 'linear-gradient(135deg,#f2a052,#ff6b81)', 'linear-gradient(135deg,#b89af0,#7a8af0)', 'linear-gradient(135deg,#7adf8f,#3a9a6a)', 'linear-gradient(135deg,#8fc4ff,#5a7ae8)'];

  async function loadList() {
    const { items, total } = await api('/api/guestbook');
    $('#guest-list').innerHTML = (total ? `<div style="text-align:center;color:var(--text-faint);font-size:13px">共 ${total} 条留言</div>` : '') +
      (items.map((g) => `
      <div class="glass glass-hover guest-item reveal">
        <div class="guest-item__ava" style="background:${COLORS[g.avatar % 5]}">${AVAS[g.avatar % 5]}</div>
        <div>
          <div class="guest-item__head">
            <span class="guest-item__name">${esc(g.name)}</span>${g.isAuthor ? '<span class="author-badge">博主</span>' : ''}
            <span class="guest-item__time">${timeAgo(g.time)}</span>
          </div>
          <div class="guest-item__msg">${esc(g.message)}</div>
        </div>
      </div>`).join('') || '<div class="glass reveal" style="padding:34px;text-align:center;color:var(--text-faint)">还没有留言，做第一个吧！</div>');
    setupReveals($('#guest-list'));
  }

  $('#g-submit')?.addEventListener('click', async () => {
    const message = $('#g-msg').value.trim();
    if (!message) return toast('留言内容不能为空哦');
    try {
      await api('/api/guestbook', { method: 'POST', body: JSON.stringify({ message }) });
      $('#g-msg').value = '';
      toast('留言已提交，等待审核后展示 🌱');
      loadList();
    } catch (e) { toast('保存失败：' + e.message); }
  });

  await loadList();
};

/* ---- 用户认证：登录和注册分开，注册验证码只用于建立账号 ---- */
function bindOtpSender(button, emailInput, codeInput, hint, endpoint) {
  let cooldownTimer = null;
  const startCooldown = (seconds) => {
    clearInterval(cooldownTimer);
    let remaining = Math.max(1, Number(seconds) || 60);
    button.disabled = true;
    button.textContent = `${remaining} 秒后重发`;
    cooldownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(cooldownTimer); cooldownTimer = null;
        button.disabled = false; button.textContent = '重新发送';
      } else button.textContent = `${remaining} 秒后重发`;
    }, 1000);
  };
  const resetButton = () => {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
    button.disabled = false;
    button.textContent = '发送验证码';
  };
  const requestOtp = () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    return api(endpoint, { method: 'POST', body: JSON.stringify({ email: emailInput.value.trim().toLowerCase() }), signal: controller.signal })
      .finally(() => clearTimeout(timeout));
  };
  button.addEventListener('click', async () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!/@qq\.com$/i.test(email)) return toast('目前只允许使用 @qq.com 邮箱');
    startCooldown(60);
    hint.textContent = '验证码正在发送，请稍候查看邮箱…';
    let result = null;
    try {
      result = await requestOtp();
    } catch (error) {
      // SMTP 偶尔响应较慢：请求超时后再询问一次服务器，识别“已发送/正在发送/发送失败”。
      if (error.name === 'AbortError') {
        button.textContent = '确认发送状态…';
        hint.textContent = '邮件服务器响应较慢，正在确认发送状态…';
        try { result = await requestOtp(); } catch (retryError) { error = retryError; }
      }
      if (!result) {
        if (error.code === 'OTP_COOLDOWN' || error.code === 'OTP_SENDING') {
          const waitSeconds = error.retryAfter || 60;
          hint.textContent = error.code === 'OTP_SENDING'
            ? '验证码正在发送，请稍候查看邮箱。'
            : `验证码已经发送过了，请等待 ${waitSeconds} 秒后再试。`;
          startCooldown(waitSeconds);
        } else {
          resetButton();
          hint.textContent = error.name === 'AbortError' ? '发送超时，请稍后重试。' : (error.message || '验证码发送失败，请稍后再试。');
          toast(hint.textContent);
        }
        return;
      }
    }
    if (result) {
      hint.textContent = `验证码已发送，有效期 ${Math.round((result.expiresIn || 600) / 60)} 分钟，请查看邮箱。`;
      startCooldown(result.retryAfter || 60);
      codeInput.focus();
    }
  });
}

function bindLogout(buttonId, after = '/login') {
  $(buttonId)?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.viewer = null;
    csrfToken = '';
    updatePublicLoginButton();
    toast('已退出登录');
    await navigate(after, false);
  });
}

views.login = async (el) => {
  document.title = `登录 · ${state.site.title}`;
  if (state.viewer) {
    el.innerHTML = `<div class="page-hero"><h1>我的</h1><p>${esc(state.viewer.username || state.viewer.email)}</p></div>
      <main class="main-wrap auth-wrap"><div class="glass auth-card reveal">
        <p class="auth-success">你已经登录，可以留言和点赞；每篇文章只能点赞一次。</p>
        <a class="btn-primary auth-button-link" href="/me">进入我的资料</a>
      </div></main>`;
    return;
  }
  el.innerHTML = `<div class="page-hero"><h1>登录</h1><p>使用已注册的 QQ 邮箱和密码</p></div>
    <main class="main-wrap auth-wrap"><form class="glass auth-card reveal" id="login-form">
      <div class="auth-note">只允许 <b>@qq.com</b> 邮箱。已经注册过的账号直接输入密码登录。</div>
      <label class="auth-label">QQ 邮箱<input class="g-input" id="login-email" type="email" autocomplete="email" placeholder="例如：123456@qq.com" required></label>
      <label class="auth-label auth-field-gap">密码<input class="g-input" id="login-password" type="password" autocomplete="current-password" minlength="8" required></label>
      <button class="btn-primary auth-submit" type="submit">${ICO.user}登录</button>
      <div class="auth-links"><span>还没有账号？</span><a href="/register">注册新账号</a></div>
      <p class="auth-hint">如果忘记密码，请联系站点管理员；当前验证码只用于注册和更换邮箱。旧的无密码账号需要先在后台删除，再重新注册。</p>
    </form></main>`;
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#login-email').value.trim().toLowerCase();
    const password = $('#login-password').value;
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      state.viewer = result.user;
      updatePublicLoginButton();
      toast('登录成功');
      await navigate('/me', true);
    } catch (error) { toast(error.message); }
  });
};

views.register = async (el) => {
  document.title = `注册 · ${state.site.title}`;
  if (state.viewer) return navigate('/me', false);
  el.innerHTML = `<div class="page-hero"><h1>注册</h1><p>验证 QQ 邮箱后设置登录密码</p></div>
    <main class="main-wrap auth-wrap"><form class="glass auth-card reveal" id="register-form">
      <div class="auth-note">只允许 <b>@qq.com</b> 邮箱。验证码发到你的邮箱，注册完成后以后直接使用密码登录。</div>
      <label class="auth-label">QQ 邮箱<input class="g-input" id="register-email" type="email" autocomplete="email" placeholder="例如：123456@qq.com" required></label>
      <label class="auth-label auth-field-gap">用户名 <span class="auth-muted">（可不填，之后可以修改）</span><input class="g-input" id="register-username" maxlength="30" autocomplete="nickname" placeholder="给自己取个名字"></label>
      <div class="auth-code-row"><input class="g-input" id="register-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" required><button class="btn-primary" id="register-send" type="button">发送验证码</button></div>
      <label class="auth-label auth-field-gap">设置密码<input class="g-input" id="register-password" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="至少 8 位" required></label>
      <label class="auth-label auth-field-gap">确认密码<input class="g-input" id="register-confirm" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></label>
      <button class="btn-primary auth-submit" type="submit">${ICO.user}完成注册</button>
      <div class="auth-links"><span>已经有账号？</span><a href="/login">返回登录</a></div>
      <p class="auth-hint" id="register-hint">验证码有效期 10 分钟；邮件服务需要先在 .env 中配置。</p>
    </form></main>`;
  const emailInput = $('#register-email');
  const codeInput = $('#register-code');
  bindOtpSender($('#register-send'), emailInput, codeInput, $('#register-hint'), '/api/auth/register/request-code');
  $('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const code = codeInput.value.trim();
    const password = $('#register-password').value;
    if (!/^\d{6}$/.test(code)) return toast('请输入 6 位验证码');
    if (password !== $('#register-confirm').value) return toast('两次输入的密码不一致');
    try {
      const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, code, password, username: $('#register-username').value.trim() }) });
      state.viewer = result.user;
      updatePublicLoginButton();
      toast('注册成功，欢迎来到博客');
      await navigate('/me', true);
    } catch (error) { toast(error.message); }
  });
};

views.profile = async (el) => {
  document.title = `我的 · ${state.site.title}`;
  if (!state.viewer) {
    el.innerHTML = `<div class="page-hero"><h1>我的</h1><p>登录后管理个人资料</p></div><main class="main-wrap auth-wrap"><div class="glass auth-card reveal"><p class="auth-success">登录后可以留言、点赞和修改个人资料。</p><a class="btn-primary auth-button-link" href="/login">去登录</a></div></main>`;
    return;
  }
  const viewer = state.viewer;
  el.innerHTML = `<div class="page-hero"><h1>我的</h1><p>${esc(viewer.email)}</p></div>
    <main class="main-wrap auth-wrap profile-wrap">
      <section class="glass auth-card reveal profile-main-card"><div class="profile-heading"><img id="profile-avatar-preview" class="profile-avatar-preview" src="${esc(viewer.avatar)}" data-fallback="/img/avatar.svg?v=g1" alt="头像"><div><h2>${esc(viewer.username || '我的资料')}</h2><p class="auth-hint">注册于 ${esc(fmtDate(viewer.createdAt))}</p></div></div>
        <form id="profile-form" class="profile-form"><label class="auth-label">用户名<input class="g-input" id="profile-username" maxlength="30" value="${esc(viewer.username || '')}" required></label><label class="auth-label auth-field-gap">头像地址<input class="g-input" id="profile-avatar" maxlength="500" value="${esc(viewer.avatar || '')}" placeholder="/img/avatar.svg?v=g1"></label><button class="btn-primary auth-submit" type="submit">保存资料</button><p class="auth-hint" id="profile-hint"></p></form>
      </section>
      <section class="glass auth-card reveal"><h2 class="profile-section-title">更换邮箱</h2><p class="auth-hint">新邮箱必须是 QQ 邮箱，验证码会发送到新邮箱。</p><form id="email-form"><label class="auth-label">新 QQ 邮箱<input class="g-input" id="change-email" type="email" autocomplete="email" placeholder="新的 QQ 邮箱" required></label><div class="auth-code-row"><input class="g-input" id="change-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" required><button class="btn-primary" id="change-send" type="button">发送验证码</button></div><button class="btn-primary auth-submit" type="submit">确认更换邮箱</button><p class="auth-hint" id="email-hint">验证码有效期 10 分钟。</p></form></section>
      <section class="auth-actions"><button class="btn-ghost" id="profile-logout" type="button">退出登录</button></section>
    </main>`;
  const avatarInput = $('#profile-avatar');
  const avatarPreview = $('#profile-avatar-preview');
  avatarInput.addEventListener('input', () => { avatarPreview.src = avatarInput.value.trim() || '/img/avatar.svg?v=g1'; });
  avatarPreview.addEventListener('error', () => { avatarPreview.src = '/img/avatar.svg?v=g1'; });
  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/auth/profile', { method: 'PUT', body: JSON.stringify({ username: $('#profile-username').value.trim(), avatar: avatarInput.value.trim() }) });
      state.viewer = result.user; updatePublicLoginButton();
      $('.profile-heading h2').textContent = result.user.username;
      avatarInput.value = result.user.avatar;
      avatarPreview.src = result.user.avatar;
      $('#profile-hint').textContent = '资料已保存。';
      toast('个人资料已更新');
    } catch (error) { $('#profile-hint').textContent = error.message; }
  });
  bindOtpSender($('#change-send'), $('#change-email'), $('#change-code'), $('#email-hint'), '/api/auth/change-email/request-code');
  $('#email-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#change-email').value.trim().toLowerCase();
    const code = $('#change-code').value.trim();
    if (!/^\d{6}$/.test(code)) return toast('请输入 6 位验证码');
    try {
      const result = await api('/api/auth/change-email', { method: 'POST', body: JSON.stringify({ email, code }) });
      state.viewer = result.user; updatePublicLoginButton();
      $('#email-hint').textContent = '邮箱已更换。';
      toast('邮箱已更新');
    } catch (error) { toast(error.message); }
  });
  bindLogout('#profile-logout');
};

/* ---- 关于 ---- */
views.about = async (el) => {
  document.title = `关于 · ${state.site.title}`;
  el.innerHTML = `
  <div class="page-hero"><h1>关于</h1><p>一个安静的角落</p></div>
  <main class="main-wrap" style="padding-top:0;max-width:900px">
    <div class="glass author-card reveal" style="padding:36px">
      <img class="author-card__avatar" src="${esc(state.site.avatar)}" data-fallback="/img/avatar.svg?v=g1" alt="" style="width:92px;height:92px">
      <div class="author-card__name" style="font-size:22px">${esc(state.site.authorName)}</div>
      <div class="author-card__role">${esc(state.site.authorRole)}</div>
      <div class="profile-card__desc" style="margin-top:12px;white-space:pre-line">${esc(state.site.about)}</div>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:center">
        ${state.site.github ? `<a class="tag-chip" href="${esc(state.site.github)}" target="_blank" rel="noopener">GitHub</a>` : ''}
        ${state.site.email ? `<a class="tag-chip" href="mailto:${esc(state.site.email)}">邮箱</a>` : ''}
        <a class="tag-chip" href="/guestbook">留言板</a>
      </div>
    </div>
    <div class="about-grid">
      ${[['📝', state.stats.posts, '文章'], ['🗂', state.stats.categories, '分类'], ['🏷', state.stats.tags, '标签'], ['👁', state.stats.views, '总阅读']]
      .map(([i, v, l]) => `<div class="glass about-stat reveal"><div class="num">${v}</div><div class="lab">${i} ${l}</div></div>`).join('')}
    </div>
    <div class="glass about-card reveal">
      <h2>🧩 我在玩什么</h2>
      <div class="skill-wrap">
        ${(state.site.skills || []).map((s) => `<span class="skill-chip">${esc(s)}</span>`).join('')}
      </div>
    </div>
    <div class="glass about-card reveal">
      <h2>🛤 站点足迹</h2>
      <div class="tl-list">
        ${(state.site.timeline || []).map((item) => `<div class="tl-item"><time>${esc(item.date)}</time><span>${esc(item.text)}</span></div>`).join('')}
      </div>
    </div>
  </main>`;
};

/* ---- 404 ---- */
views.notFound = async (el) => {
  document.title = `404 · ${state.site.title}`;
  el.innerHTML = `
  <div class="error-view">
    <div class="code">404</div>
    <p>这一页走丢了，也许被苦力怕炸掉了。</p>
    <a class="btn-primary" href="/">回到主页 ${ICO.right}</a>
  </div>`;
};

function errorHtml(msg) {
  return `<div class="error-view"><div class="code">:(</div><p>加载失败：${esc(msg)}</p><a class="btn-primary" href="/">回到主页</a></div>`;
}

/* ============ 搜索 ============ */
function openSearch() {
  $('#search-mask').classList.add('show');
  setTimeout(() => $('#search-input').focus(), 80);
}
function closeSearch() {
  $('#search-mask').classList.remove('show');
  $('#search-input').value = '';
  $('#search-results').innerHTML = '<div class="search-empty">输入关键词，搜一搜全站文章</div>';
}
async function doSearch(q) {
  const box = $('#search-results');
  if (!q.trim()) {
    box.innerHTML = '<div class="search-empty">输入关键词，搜一搜全站文章</div>';
    return;
  }
  const res = await api('/api/search?q=' + encodeURIComponent(q));
  box.innerHTML = res.items.length
    ? res.items.map((p) => `
        <a href="/post/${encodeURIComponent(p.slug)}" data-close-search>
        <div class="t">${esc(p.title)}</div>
        <div class="d">${fmtDate(p.date)} · ${esc(p.category)}</div>
      </a>`).join('')
    : '<div class="search-empty">什么都没找到，换个词试试？</div>';
}

/* ============ 滚动相关 ============ */
function initScrollFx() {
  const bar = $('#progress');
  const top = $('#to-top');
  const nav = $('#navbar');
  const update = () => {
    const y = window.scrollY;
    const total = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (total > 0 ? Math.min(100, y / total * 100) : 0) + '%';
    top.classList.toggle('show', y > 500);
    nav.classList.toggle('scrolled', y > 30);
    const hero = $('.hero');
    const heroEnd = hero ? hero.offsetTop + hero.offsetHeight : Number.POSITIVE_INFINITY;
    const blurWhenReading = location.pathname === '/' && y > heroEnd + Math.min(180, window.innerHeight * 0.18);
    document.body.classList.toggle('content-blur', blurWhenReading);
  };
  window.addEventListener('scroll', update, { passive: true });
  setInterval(update, 300);
  update();
}

/* ============ 启动 ============ */
(async function boot() {
  installAssetFallbacks();
  const loader = $('#loader');
  const setupIntro = (site) => {
    if (!loader) return;
    const title = $('[data-intro-title]', loader);
    const text = $('[data-intro-text]', loader);
    const introTitle = site.introTitle || `欢迎来到 ${site.title || '我的博客'}`;
    const introImage = String(state.heroImage || site.heroImage || '/img/leaf-hero-v2.png?v=1').replace(/["\\\r\n]/g, '');
    const fallbackImage = '/img/leaf-hero-v2.png?v=1';
    loader.style.setProperty('--intro-image', `url("${fallbackImage}")`);
    const bgStage = $('.bg-stage');
    if (bgStage) bgStage.style.setProperty('--site-image', `url("${fallbackImage}")`);
    if (introImage !== fallbackImage) {
      const introPreload = new Image();
      introPreload.onload = () => {
        loader.style.setProperty('--intro-image', `url("${introImage}")`);
        if (bgStage) bgStage.style.setProperty('--site-image', `url("${introImage}")`);
      };
      introPreload.src = introImage;
    }
    if (title) {
      title.textContent = '';
      [...introTitle].forEach((char, index) => {
        const span = document.createElement('span');
        span.textContent = char;
        span.style.setProperty('--i', index);
        title.appendChild(span);
      });
    }
    if (text) text.textContent = site.introText || '向下滚动，开始阅读';
    const isHome = () => location.pathname === '/' || location.pathname === '/index.html';
    let introEnabled = isHome();
    let dismissed = !introEnabled;
    let lastScrollY = window.scrollY;
    let hideTimer = null;
    if (!introEnabled) loader.classList.add('hide');
    const dismiss = () => {
      if (dismissed || !introEnabled || !isHome()) return;
      dismissed = true;
      clearTimeout(hideTimer);
      loader.classList.add('leaving');
      const charCount = Math.max(1, [...introTitle].length);
      hideTimer = setTimeout(() => loader.classList.add('hide'), Math.min(2200, 520 + charCount * 48));
    };
    const onScroll = () => {
      if (!isHome()) {
        introEnabled = false;
        dismissed = true;
        clearTimeout(hideTimer);
        loader.classList.add('hide');
        lastScrollY = window.scrollY;
        return;
      }
      if (!introEnabled) { loader.classList.add('hide'); return; }
      const y = window.scrollY;
      if (y > 12) dismiss();
      lastScrollY = y;
    };
    const onWheel = (event) => { if (!introEnabled || !isHome()) return; if (event.deltaY > 0) dismiss(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', () => { if (introEnabled && isHome() && window.scrollY > 12) dismiss(); }, { passive: true });
    onScroll();
  };

  try {
    applyDark();
    state.site = await api('/api/site');
    state.heroImage = pickHeroImage(state.site);
    setupIntro(state.site);
    setupAmbientEffects(state.site);
    buildShell();
    $('#footer-title').textContent = state.site.title;
    $('#footer-text').textContent = state.site.footer || state.site.subtitle;
    renderFriendLinks(state.site);
    initScrollFx();

    // 注册路由
    route('/archive', views.archive);
    route('/journal', views.journal);
    route('/categories', views.categories);
    route('/tags', views.tags);
    route('/guestbook', views.guestbook);
    route('/login', views.login);
    route('/register', views.register);
    route('/me', views.profile);
    route('/about', views.about);

    const [postsRes, stats, viewerRes] = await Promise.all([
      api('/api/posts?limit=50'),
      api('/api/stats'),
      api('/api/me'),
    ]);
    state.posts = postsRes.items;
    state.stats = stats;
    state.viewer = viewerRes.user || null;
    updatePublicLoginButton();

    // 搜索结果点击 → 关闭并跳转（交给全局链接委托）
    $('#search-results').addEventListener('click', (e) => {
      if (e.target.closest('a')) closeSearch();
    });

    await navigate(location.pathname + location.search, false);
  } catch (err) {
    $('#view').innerHTML = errorHtml(err.message);
    loader?.classList.add('hide');
  }
})();
