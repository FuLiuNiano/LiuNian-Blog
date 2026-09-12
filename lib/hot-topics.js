'use strict';

const HOT_TOPIC_CATEGORIES = ['tech', 'game', 'github', 'entertainment'];

// RSSHub 的路由和公共实例会变化，因此小黑盒、微博、抖音都配置了备用实例。
const RSSHUB_MIRRORS = [
  'https://rsshub.app',
  'https://rsshub.yfi.moe',
  'https://rsshub.chyi.org',
  'https://rsshub.jamesflare.com',
];

const DEFAULT_FEEDS = [
  // 科技：只使用有编辑团队的科技媒体官方 RSS，按发布时间优先展示最新内容。
  { category: 'tech', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { category: 'tech', name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { category: 'tech', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { category: 'tech', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
  { category: 'tech', name: 'Wired', url: 'https://www.wired.com/feed/rss' },

  // 游戏：优先小黑盒；公共 RSSHub 不可用时，用官方/专业游戏媒体补位。
  { category: 'game', name: '小黑盒游戏新闻', url: `${RSSHUB_MIRRORS[0]}/xiaoheihe/news` },
  { category: 'game', name: '小黑盒游戏折扣', url: `${RSSHUB_MIRRORS[0]}/xiaoheihe/discount/pc` },
  { category: 'game', name: '小黑盒游戏新闻备用', url: `${RSSHUB_MIRRORS[1]}/xiaoheihe/news` },
  { category: 'game', name: '小黑盒游戏新闻备用 2', url: `${RSSHUB_MIRRORS[2]}/xiaoheihe/news` },
  { category: 'game', name: 'IGN 游戏新闻', url: 'https://www.ign.com/rss/articles/feed' },
  { category: 'game', name: 'Steam 新闻', url: 'https://store.steampowered.com/feeds/news.xml' },
  { category: 'game', name: 'GameSpot 游戏新闻', url: 'https://www.gamespot.com/feeds/mashup/' },

  // GitHub 官方 API：近 3 天新建且已有关注度的公开项目，按 star 数排序。
  { category: 'github', kind: 'github-search', name: 'GitHub 新星项目' },
  // API 受限时使用 GitHub Trending RSS 备用。
  { category: 'github', name: 'GitHub Trending 备用', url: `${RSSHUB_MIRRORS[0]}/github/trending/daily` },
  { category: 'github', name: 'GitHub Trending 备用 2', url: `${RSSHUB_MIRRORS[1]}/github/trending/daily` },

  // 娱乐：微博、抖音热搜，数据只保存标题和公开原文链接。
  { category: 'entertainment', name: '微博热搜', url: `${RSSHUB_MIRRORS[0]}/weibo/search/hot` },
  { category: 'entertainment', name: '微博热搜备用', url: `${RSSHUB_MIRRORS[1]}/weibo/search/hot` },
  { category: 'entertainment', name: '抖音热搜', url: `${RSSHUB_MIRRORS[0]}/douyin/hot` },
  { category: 'entertainment', name: '抖音热搜备用', url: `${RSSHUB_MIRRORS[1]}/douyin/hot` },
];

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ITEM_AGE_HOURS = 72;

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
  if (/xiaoheihe|heybox|ign\.com|gamespot|steampowered|pcgamer|gaming/.test(sourceUrl)) return 'game';
  if (/weibo|douyin|tiktok/.test(sourceUrl)) return 'entertainment';
  return 'tech';
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
      title,
      url,
      source: cleanText(feed.name, 80) || '公开来源',
      publishedAt,
      rank: feedIndex * 1000 + index + 1,
    };
  }).filter(Boolean);
}

async function fetchText(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
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
      title: `${fullName}${details ? ` · ${details}` : ''}${description ? ` — ${description}` : ''}`.slice(0, 180),
      url: normalizeUrl(repo.html_url),
      source: 'GitHub 新星项目',
      publishedAt: parsePublishedAt(repo.pushed_at || repo.updated_at || repo.created_at),
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
        name: '来源 ' + (index + 1),
        url,
        kind: /api\.github\.com\/search\/repositories/i.test(url) ? 'github-search' : 'rss',
      };
    }
    const url = String(item?.url || '').trim();
    return {
      category: inferCategory(item?.category, url),
      kind: item?.kind === 'github-search' ? 'github-search' : 'rss',
      name: cleanText(item?.name, 80) || '来源 ' + (index + 1),
      url,
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

async function fetchHotTopics({ feeds, limit = 10 } = {}) {
  const feedList = normalizeFeeds(feeds);
  const categoryLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const results = await Promise.allSettled(feedList.map((feed, index) => (
    feed.kind === 'github-search' ? fetchGithubSearch(feed, index, categoryLimit) : fetchFeed(feed, index)
  )));
  const entries = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter(isFreshEnough)
    .sort((a, b) => {
      if (a.category !== b.category) return HOT_TOPIC_CATEGORIES.indexOf(a.category) - HOT_TOPIC_CATEGORIES.indexOf(b.category);
      if (a.score !== undefined || b.score !== undefined) return (b.score || 0) - (a.score || 0);
      const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return bTime - aTime || a.rank - b.rank;
    });
  const unique = [];
  const seen = new Set();
  const categoryCounts = Object.fromEntries(HOT_TOPIC_CATEGORIES.map((category) => [category, 0]));
  for (const item of entries) {
    const category = HOT_TOPIC_CATEGORIES.includes(item.category) ? item.category : 'tech';
    const key = `${category}:${canonicalKey(item)}`;
    if (seen.has(key) || categoryCounts[category] >= categoryLimit) continue;
    seen.add(key);
    categoryCounts[category]++;
    unique.push({
      category,
      title: item.title,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
    });
  }
  if (!unique.length) throw new Error('所有热点来源均未返回有效内容');
  return unique;
}

module.exports = { DEFAULT_FEEDS, HOT_TOPIC_CATEGORIES, fetchHotTopics };
