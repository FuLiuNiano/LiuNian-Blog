'use strict';

const crypto = require('node:crypto');

const HOT_TOPIC_CATEGORIES = ['tech', 'game', 'github', 'entertainment'];

// RSSHub 的路由和公共实例会变化，因此小黑盒、微博、抖音都配置了备用实例。
const RSSHUB_MIRRORS = [
  'https://rsshub.app',
  'https://rsshub.yfi.moe',
  'https://rsshub.chyi.org',
  'https://rsshub.jamesflare.com',
];
const DOUYIN_HOT_URL = 'https://www.douyin.com/aweme/v1/web/hot/search/list/';
const XIAOHEIHE_FEED_URL = 'https://api.xiaoheihe.cn/bbs/app/feeds/news';

const DEFAULT_FEEDS = [
  // 科技：只使用有编辑团队的科技媒体官方 RSS，按发布时间优先展示最新内容。
  { category: 'tech', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { category: 'tech', name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { category: 'tech', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { category: 'tech', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
  { category: 'tech', name: 'Wired', url: 'https://www.wired.com/feed/rss' },

  // 游戏：优先小黑盒；公共 RSSHub 不可用时，用 GameSpot/Steam 补位。
  { category: 'game', provider: 'xiaoheihe', priority: 1, kind: 'xiaoheihe', name: '小黑盒游戏新闻', url: XIAOHEIHE_FEED_URL },
  { category: 'game', provider: 'xiaoheihe', priority: 2, name: '小黑盒游戏折扣', url: `${RSSHUB_MIRRORS[0]}/xiaoheihe/discount/pc` },
  { category: 'game', provider: 'xiaoheihe', priority: 3, name: '小黑盒游戏新闻备用', url: `${RSSHUB_MIRRORS[1]}/xiaoheihe/news` },
  { category: 'game', provider: 'xiaoheihe', priority: 4, name: '小黑盒游戏新闻备用 2', url: `${RSSHUB_MIRRORS[2]}/xiaoheihe/news` },
  { category: 'game', provider: 'xiaoheihe', priority: 5, name: '小黑盒游戏新闻备用 3', url: `${RSSHUB_MIRRORS[3]}/xiaoheihe/news` },
  { category: 'game', provider: 'gamespot', priority: 20, name: 'GameSpot 游戏新闻备用', url: 'https://www.gamespot.com/feeds/game-news/' },
  { category: 'game', provider: 'steam', priority: 30, name: 'Steam 新闻备用', url: 'https://store.steampowered.com/feeds/news.xml' },

  // GitHub 官方 API：近 3 天新建且已有关注度的公开项目，按 star 数排序。
  { category: 'github', provider: 'github', priority: 1, kind: 'github-search', name: 'GitHub 新星项目' },
  // API 受限时使用 GitHub Trending RSS 备用。
  { category: 'github', name: 'GitHub Trending 备用', url: `${RSSHUB_MIRRORS[0]}/github/trending/daily` },
  { category: 'github', name: 'GitHub Trending 备用 2', url: `${RSSHUB_MIRRORS[1]}/github/trending/daily` },

  // 娱乐：微博、抖音热搜，数据只保存标题和公开原文链接。
  { category: 'entertainment', provider: 'weibo', priority: 1, name: '微博热搜', url: `${RSSHUB_MIRRORS[0]}/weibo/search/hot` },
  { category: 'entertainment', provider: 'weibo', priority: 2, name: '微博热搜备用', url: `${RSSHUB_MIRRORS[1]}/weibo/search/hot` },
  { category: 'entertainment', provider: 'weibo', priority: 3, name: '微博热搜备用 2', url: `${RSSHUB_MIRRORS[2]}/weibo/search/hot` },
  { category: 'entertainment', provider: 'weibo', priority: 4, name: '微博热搜备用 3', url: `${RSSHUB_MIRRORS[3]}/weibo/search/hot` },
  { category: 'entertainment', provider: 'douyin', priority: 1, kind: 'douyin-hot', name: '抖音热搜', url: DOUYIN_HOT_URL },
  { category: 'entertainment', provider: 'douyin', priority: 2, name: '抖音热搜 RSS 备用', url: `${RSSHUB_MIRRORS[0]}/douyin/hot` },
  { category: 'entertainment', provider: 'douyin', priority: 3, name: '抖音热搜 RSS 备用 2', url: `${RSSHUB_MIRRORS[1]}/douyin/hot` },
  { category: 'entertainment', provider: 'douyin', priority: 4, name: '抖音热搜 RSS 备用 3', url: `${RSSHUB_MIRRORS[2]}/douyin/hot` },
];

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ITEM_AGE_HOURS = 72;
const TRANSLATION_ENABLED = !/^(0|false|no|off)$/i.test(String(process.env.HOT_TOPICS_TRANSLATION_ENABLED || 'true'));
const TRANSLATION_MAX_ITEMS = Math.min(Math.max(Number(process.env.HOT_TOPICS_TRANSLATION_MAX_ITEMS) || 40, 1), 120);
const translationCache = new Map();

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const parsed = /^x/i.test(code) ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
}

function cleanText(value, maxLength = 240) {
  return decodeXml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function firstTag(block, names) {
  for (const name of names) {
    const match = String(block).match(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
    if (match) return match[1];
  }
  return '';
}

function itemLink(block) {
  const attribute = String(block).match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  if (attribute) return decodeXml(attribute[1]).trim();
  return decodeXml(firstTag(block, ['link', 'guid', 'id'])).trim();
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function parsePublishedAt(value) {
  const timestamp = Date.parse(String(value || '').trim());
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function inferCategory(category, url = '') {
  const value = String(category || '').trim().toLowerCase();
  if (HOT_TOPIC_CATEGORIES.includes(value)) return value;
  const sourceUrl = String(url).toLowerCase();
  if (sourceUrl.includes('github')) return 'github';
  if (/xiaoheihe|heybox|gamespot|steampowered|pcgamer|gaming/.test(sourceUrl)) return 'game';
  if (/weibo|douyin|tiktok/.test(sourceUrl)) return 'entertainment';
  return 'tech';
}

function inferProvider(provider, url = '') {
  const explicit = String(provider || '').trim().toLowerCase();
  if (explicit) return explicit;
  const sourceUrl = String(url).toLowerCase();
  if (/xiaoheihe|heybox/.test(sourceUrl)) return 'xiaoheihe';
  if (sourceUrl.includes('weibo')) return 'weibo';
  if (/douyin|tiktok/.test(sourceUrl)) return 'douyin';
  if (sourceUrl.includes('github')) return 'github';
  if (sourceUrl.includes('gamespot')) return 'gamespot';
  if (sourceUrl.includes('steampowered')) return 'steam';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
}

function parseFeed(xml, feed, feedIndex) {
  const blocks = String(xml).match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return blocks.map((block, index) => {
    const title = cleanText(firstTag(block, ['title']), 180);
    const url = normalizeUrl(itemLink(block));
    const publishedAt = parsePublishedAt(firstTag(block, ['pubDate', 'published', 'updated', 'dc:date', 'date']));
    if (!title || !url) return null;
    return {
      category: inferCategory(feed.category, feed.url),
      provider: inferProvider(feed.provider, feed.url),
      title,
      url,
      source: cleanText(feed.name, 80) || '公开来源',
      publishedAt,
      priority: Number(feed.priority) || feedIndex + 1,
      rank: feedIndex * 1000 + index + 1,
    };
  }).filter(Boolean);
}

async function fetchText(url, headers = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'LiuNian-Blog/1.0 (+daily-hot-topics)', ...headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_FEED_BYTES) throw new Error('来源内容过大');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeed(feed, feedIndex) {
  const xml = await fetchText(feed.url, {
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  });
  return parseFeed(xml, feed, feedIndex);
}

const XIAOHEIHE_CHARSET = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89';

function mapWithCharset(value, charset, sliceEnd) {
  const pool = charset.slice(0, sliceEnd);
  return [...String(value)].map((character) => pool.charCodeAt(0) >= 0
    ? pool[character.charCodeAt(0) % pool.length]
    : '').join('');
}

function substituteWithCharset(value, charset) {
  return [...String(value)].map((character) => charset[character.charCodeAt(0) % charset.length]).join('');
}

function rotateByte(value) {
  return 128 & value ? 255 & ((value << 1) ^ 27) : value << 1;
}

function xhhMixFourBytes(bytes) {
  const vm = (value) => rotateByte(value);
  const qm = (value) => vm(value) ^ value;
  const sm = (value) => qm(vm(value));
  const ym = (value) => sm(qm(vm(value)));
  const gm = (value) => ym(value) ^ sm(value) ^ qm(value);
  const mixed = [
    gm(bytes[0]) ^ ym(bytes[1]) ^ sm(bytes[2]) ^ qm(bytes[3]),
    qm(bytes[0]) ^ gm(bytes[1]) ^ ym(bytes[2]) ^ sm(bytes[3]),
    sm(bytes[0]) ^ qm(bytes[1]) ^ gm(bytes[2]) ^ ym(bytes[3]),
    ym(bytes[0]) ^ sm(bytes[1]) ^ qm(bytes[2]) ^ gm(bytes[3]),
  ];
  bytes.splice(0, 4, ...mixed);
}

function xiaoheiheHkey(path, timeSec, nonce) {
  const normalizedPath = `/${String(path).split('/').filter(Boolean).join('/')}/`;
  const partA = mapWithCharset(String(timeSec + 1), XIAOHEIHE_CHARSET, -2);
  const partB = substituteWithCharset(normalizedPath, XIAOHEIHE_CHARSET);
  const partC = substituteWithCharset(nonce, XIAOHEIHE_CHARSET);
  let mixedInput = '';
  for (let index = 0; index < Math.max(partA.length, partB.length, partC.length); index++) {
    if (index < partA.length) mixedInput += partA[index];
    if (index < partB.length) mixedInput += partB[index];
    if (index < partC.length) mixedInput += partC[index];
  }
  const md5hex = crypto.createHash('md5').update(mixedInput.slice(0, 20), 'utf8').digest('hex');
  const last6 = [...md5hex.slice(-6)].map((character) => character.charCodeAt(0));
  xhhMixFourBytes(last6);
  const suffix = String(last6.reduce((total, value) => total + value, 0) % 100).padStart(2, '0');
  const prefix = mapWithCharset(md5hex.slice(0, 5), XIAOHEIHE_CHARSET, -4);
  return `${prefix}${suffix}`;
}

async function fetchXiaoheihe(feed, feedIndex, limit) {
  const timeSec = Math.floor(Date.now() / 1000);
  const nonce = crypto.createHash('md5')
    .update(`${timeSec}${Math.random()}`, 'utf8')
    .digest('hex')
    .toUpperCase();
  const params = new URLSearchParams({
    os_type: 'web',
    app: 'heybox',
    client_type: 'web',
    version: '999.0.4',
    web_version: '2.5',
    x_client_type: 'web',
    x_app: 'heybox_website',
    heybox_id: '',
    x_os_type: 'Windows',
    device_info: 'Chrome',
    device_id: crypto.randomBytes(16).toString('hex'),
    pull: '0',
    offset: '0',
    limit: String(Math.min(Math.max(limit * 2, 10), 30)),
    dw: '604',
    _time: String(timeSec),
    nonce,
    hkey: xiaoheiheHkey(new URL(feed.url).pathname, timeSec, nonce),
  });
  const payload = JSON.parse(await fetchText(
    `${feed.url}?${params.toString()}`,
    {
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://www.xiaoheihe.cn',
      Referer: 'https://www.xiaoheihe.cn/',
    },
  ));
  if (payload?.status !== 'ok' || !Array.isArray(payload?.result?.links)) {
    throw new Error(payload?.msg || '小黑盒返回格式异常');
  }
  return payload.result.links.slice(0, Math.min(Math.max(limit * 2, 10), 30)).map((item, index) => {
    const title = cleanText(item?.title || item?.name, 180);
    const linkId = String(item?.linkid || item?.link_id || '').trim();
    const url = normalizeUrl(item?.share_url || item?.url)
      || (linkId ? normalizeUrl(`https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?link_id=${encodeURIComponent(linkId)}`) : '');
    const timeValue = Number(item?.modify_at || item?.update_at || item?.create_at);
    return {
      category: 'game',
      provider: 'xiaoheihe',
      title,
      url,
      source: cleanText(feed.name, 80) || '小黑盒游戏新闻',
      publishedAt: Number.isFinite(timeValue) && timeValue > 0 ? new Date(timeValue * 1000).toISOString() : null,
      priority: Number(feed.priority) || 1,
      rank: feedIndex * 1000 + index + 1,
    };
  }).filter((item) => item.title && item.url);
}

async function fetchDouyinHot(feed, feedIndex, limit) {
  const params = new URLSearchParams({
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    detail_list: '1',
    source: '6',
    main_billboard_count: '5',
  });
  const payload = JSON.parse(await fetchText(
    `${feed.url || DOUYIN_HOT_URL}?${params.toString()}`,
    {
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://www.douyin.com/hot',
    },
  ));
  const list = payload?.data?.word_list || payload?.data?.trending_list;
  if (!Array.isArray(list)) throw new Error('抖音热搜返回格式异常');
  return list.slice(0, Math.min(Math.max(limit * 2, 10), 50)).map((item, index) => {
    const word = cleanText(item?.word || item?.sentence, 180);
    const url = normalizeUrl(`https://www.douyin.com/search/${encodeURIComponent(word)}`);
    const eventTime = Number(item?.event_time);
    const publishedAt = Number.isFinite(eventTime) && eventTime > 0
      ? new Date(eventTime * 1000).toISOString()
      : new Date().toISOString();
    return {
      category: 'entertainment',
      provider: 'douyin',
      title: word,
      url,
      source: cleanText(feed.name, 80) || '抖音热搜',
      publishedAt,
      priority: Number(feed.priority) || 1,
      rank: feedIndex * 1000 + index + 1,
      score: Number(item?.hot_value) || 0,
    };
  }).filter((item) => item.title && item.url);
}

function githubStarLabel(value) {
  const stars = Number(value) || 0;
  return stars >= 1000 ? `${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1)}k` : String(stars);
}

async function fetchGithubSearch(feed, feedIndex, limit) {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    q: `created:>=${since} stars:>3 fork:false archived:false`,
    sort: 'stars',
    order: 'desc',
    per_page: String(Math.min(Math.max(limit * 2, 10), 50)),
  });
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const payload = JSON.parse(await fetchText(`https://api.github.com/search/repositories?${params}`, headers));
  if (!Array.isArray(payload.items)) throw new Error('GitHub API 返回格式异常');
  return payload.items.map((repo, index) => {
    const fullName = cleanText(repo.full_name, 120);
    const description = cleanText(repo.description, 90);
    const language = cleanText(repo.language, 30);
    const details = [`★${githubStarLabel(repo.stargazers_count)}`, language].filter(Boolean).join(' · ');
    return {
      category: 'github',
      provider: 'github',
      title: `${fullName}${details ? ` · ${details}` : ''}${description ? ` — ${description}` : ''}`.slice(0, 180),
      url: normalizeUrl(repo.html_url),
      source: 'GitHub 新星项目',
      publishedAt: parsePublishedAt(repo.pushed_at || repo.updated_at || repo.created_at),
      priority: Number(feed.priority) || 1,
      rank: feedIndex * 1000 + index + 1,
      score: Number(repo.stargazers_count) || 0,
    };
  }).filter((item) => item.title && item.url);
}

function normalizeFeeds(feeds) {
  const list = Array.isArray(feeds) && feeds.length ? feeds : DEFAULT_FEEDS;
  return list.map((item, index) => {
    if (typeof item === 'string') {
      const raw = item.trim();
      const match = raw.match(/^(tech|game|github|entertainment)\|(.+)$/i);
      const url = (match ? match[2] : raw).trim();
      return {
        category: inferCategory(match?.[1], url),
        provider: inferProvider('', url),
        name: '来源 ' + (index + 1),
        url,
        kind: /api\.github\.com\/search\/repositories/i.test(url) ? 'github-search' : 'rss',
        priority: index + 1,
      };
    }
    const url = String(item?.url || '').trim();
    return {
      category: inferCategory(item?.category, url),
      provider: inferProvider(item?.provider, url),
      kind: ['github-search', 'douyin-hot', 'xiaoheihe'].includes(item?.kind) ? item.kind : 'rss',
      name: cleanText(item?.name, 80) || '来源 ' + (index + 1),
      url,
      priority: Number(item?.priority) || index + 1,
    };
  }).filter((item) => item.kind === 'github-search' || item.url).slice(0, 40);
}

function canonicalKey(item) {
  try {
    const url = new URL(item.url);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return item.title.toLocaleLowerCase().replace(/\s+/g, ' ');
  }
}

function isFreshEnough(item) {
  if (!item.publishedAt) return true;
  const timestamp = Date.parse(item.publishedAt);
  return Number.isNaN(timestamp) || Date.now() - timestamp <= MAX_ITEM_AGE_HOURS * 60 * 60 * 1000;
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function translationTarget(title) {
  const value = String(title || '').trim();
  const separator = value.indexOf(' — ');
  if (separator > 0 && separator < value.length - 3) {
    return { prefix: value.slice(0, separator + 3), text: value.slice(separator + 3) };
  }
  return { prefix: '', text: value };
}

async function translateWithGoogle(text) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: 'zh-CN',
    dt: 't',
    q: text,
  });
  const payload = JSON.parse(await fetchText(
    `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
    { Accept: 'application/json' },
    6000,
  ));
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part) => Array.isArray(part) ? part[0] : '').join('')
    : '';
  return cleanText(translated, 240);
}

async function translateWithMyMemory(text) {
  // MyMemory 不接受 auto 作为源语言；热点英文标题默认按 en 翻译。
  const params = new URLSearchParams({ q: text, langpair: 'en|zh-CN' });
  const payload = JSON.parse(await fetchText(
    `https://api.mymemory.translated.net/get?${params.toString()}`,
    { Accept: 'application/json' },
    6000,
  ));
  if (Number(payload?.responseStatus) !== 200) throw new Error('翻译服务返回错误');
  return cleanText(payload?.responseData?.translatedText, 240);
}

async function translateTitle(title) {
  const value = String(title || '').trim();
  if (!TRANSLATION_ENABLED || !value || hasChinese(value)) return value;
  if (translationCache.has(value)) return translationCache.get(value);

  const { prefix, text } = translationTarget(value);
  let translated = '';
  try {
    translated = await translateWithMyMemory(text);
  } catch {
    try { translated = await translateWithGoogle(text); } catch { translated = ''; }
  }
  const resultText = translated.replace(/\bvs\.?\b/gi, '对阵');
  const result = resultText ? `${prefix}${resultText}`.slice(0, 180) : value;
  translationCache.set(value, result);
  return result;
}

async function translateItems(items) {
  if (!TRANSLATION_ENABLED || !items.length) return items;
  const targets = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !hasChinese(item.title))
    .slice(0, TRANSLATION_MAX_ITEMS);
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      target.item.title = await translateTitle(target.item.title);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
  return items;
}

function itemTime(item) {
  return item.publishedAt ? Date.parse(item.publishedAt) || 0 : 0;
}

function itemProvider(item) {
  return String(item.provider || item.source || 'unknown').trim().toLowerCase();
}

function sortEntries(entries) {
  return entries.sort((a, b) => {
    if (a.category !== b.category) {
      return HOT_TOPIC_CATEGORIES.indexOf(a.category) - HOT_TOPIC_CATEGORIES.indexOf(b.category);
    }
    if (a.category === 'github' && (a.score !== undefined || b.score !== undefined)) {
      return (b.score || 0) - (a.score || 0) || itemTime(b) - itemTime(a) || a.rank - b.rank;
    }
    if (a.category === 'game') {
      return (Number(a.priority) || 999) - (Number(b.priority) || 999)
        || itemTime(b) - itemTime(a)
        || a.rank - b.rank;
    }
    return itemTime(b) - itemTime(a)
      || (Number(a.priority) || 999) - (Number(b.priority) || 999)
      || a.rank - b.rank;
  });
}

async function fetchHotTopics({ feeds, limit = 10 } = {}) {
  const feedList = normalizeFeeds(feeds);
  const categoryLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const results = await Promise.allSettled(feedList.map((feed, index) => (
    feed.kind === 'github-search'
      ? fetchGithubSearch(feed, index, categoryLimit)
      : feed.kind === 'douyin-hot'
        ? fetchDouyinHot(feed, index, categoryLimit)
        : feed.kind === 'xiaoheihe'
          ? fetchXiaoheihe(feed, index, categoryLimit)
        : fetchFeed(feed, index)
  )));
  const entries = sortEntries(results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter(isFreshEnough));
  const unique = [];
  const seen = new Set();
  const categoryCounts = Object.fromEntries(HOT_TOPIC_CATEGORIES.map((category) => [category, 0]));
  const addItem = (item) => {
    const category = HOT_TOPIC_CATEGORIES.includes(item.category) ? item.category : 'tech';
    const key = `${category}:${canonicalKey(item)}`;
    if (seen.has(key) || categoryCounts[category] >= categoryLimit) return false;
    seen.add(key);
    categoryCounts[category]++;
    unique.push({
      category,
      title: item.title,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
    });
    return true;
  };

  // 微博和抖音使用不同的源，先各取一条，再按新鲜度补齐，避免单一来源占满整个分类。
  const entertainmentEntries = entries.filter((item) => item.category === 'entertainment');
  const entertainmentProviders = new Set();
  for (const category of HOT_TOPIC_CATEGORIES) {
    const categoryEntries = category === 'entertainment'
      ? entertainmentEntries
      : entries.filter((item) => item.category === category);
    if (category === 'entertainment') {
      for (const item of categoryEntries) {
        const provider = itemProvider(item);
        if (entertainmentProviders.has(provider)) continue;
        if (addItem(item)) entertainmentProviders.add(provider);
      }
    }
    for (const item of categoryEntries) addItem(item);
  }

  await translateItems(unique);
  if (!unique.length) throw new Error('所有热点来源均未返回有效内容');
  return unique;
}

module.exports = { DEFAULT_FEEDS, HOT_TOPIC_CATEGORIES, fetchHotTopics };
