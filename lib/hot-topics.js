'use strict';

const DEFAULT_FEEDS = [
  { category: 'tech', name: '科技新闻', url: 'https://www.bing.com/news/search?q=%E7%A7%91%E6%8A%80&format=rss' },
  { category: 'tech', name: '人工智能', url: 'https://www.bing.com/news/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&format=rss' },
  { category: 'game', name: '小黑盒游戏新闻', url: 'https://rsshub.app/xiaoheihe/news' },
  { category: 'game', name: '小黑盒游戏折扣', url: 'https://rsshub.app/xiaoheihe/discount/pc' },
  { category: 'game', name: '小黑盒新闻备用来源', url: 'https://rsshub.minaduki.dev/xiaoheihe/news' },
];

const MAX_FEED_BYTES = 2 * 1024 * 1024;

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
  return decodeXml(firstTag(block, ['link', 'guid'])).trim();
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

function parseFeed(xml, feed, feedIndex) {
  const blocks = String(xml).match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return blocks.map((block, index) => {
    const title = cleanText(firstTag(block, ['title']), 180);
    const url = normalizeUrl(itemLink(block));
    const publishedAt = firstTag(block, ['pubDate', 'published', 'updated', 'date']);
    const source = cleanText(firstTag(block, ['source', 'creator', 'author']), 80) || feed.name;
    if (!title || !url) return null;
    return {
      category: feed.category === 'game' ? 'game' : 'tech',
      title,
      url,
      source,
      publishedAt: Number.isNaN(Date.parse(publishedAt)) ? null : new Date(publishedAt).toISOString(),
      rank: feedIndex * 1000 + index + 1,
    };
  }).filter(Boolean);
}

async function fetchFeed(feed, feedIndex) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(feed.url, {
      headers: { 'User-Agent': 'LiuNian-Blog/1.0 (+daily-hot-topics)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const xml = await response.text();
    if (Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES) throw new Error('RSS 内容过大');
    return parseFeed(xml, feed, feedIndex);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFeeds(feeds) {
  const list = Array.isArray(feeds) && feeds.length ? feeds : DEFAULT_FEEDS;
  return list.map((item, index) => {
    if (typeof item === 'string') {
      const url = item.trim();
      return { category: /xiaoheihe|heybox/i.test(url) ? 'game' : 'tech', name: '来源 ' + (index + 1), url };
    }
    const url = String(item?.url || '').trim();
    return {
      category: item?.category === 'game' || /xiaoheihe|heybox/i.test(url) ? 'game' : 'tech',
      name: cleanText(item?.name, 40) || '来源 ' + (index + 1),
      url,
    };
  }).filter((item) => item.url).slice(0, 20);
}

async function fetchHotTopics({ feeds, limit = 10 } = {}) {
  const feedList = normalizeFeeds(feeds);
  const results = await Promise.allSettled(feedList.map((feed, index) => fetchFeed(feed, index)));
  const entries = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const unique = [];
  const seen = new Set();
  const categoryCounts = { tech: 0, game: 0 };
  const categoryLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
  for (const item of entries.sort((a, b) => a.rank - b.rank)) {
    const key = item.url || item.title.toLocaleLowerCase();
    if (seen.has(key) || categoryCounts[item.category] >= categoryLimit) continue;
    seen.add(key);
    categoryCounts[item.category]++;
    unique.push({
      category: item.category,
      title: item.title,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
    });
  }
  if (!unique.length) throw new Error('所有热点来源均未返回有效内容');
  return unique;
}

module.exports = { DEFAULT_FEEDS, fetchHotTopics };
