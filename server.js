'use strict';
/* 叶语博客 —— Node 后端（玻璃质感 SPA 版）
 * 与像素版同一套 REST API；前端为单页应用，未知路由回退到 index.html
 * 运行：node server.js   （默认 http://localhost:3000）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const nodemailer = require('nodemailer');
const { render } = require('./lib/markdown');
const { normalizeResourceUrl } = require('./lib/links');
const {
  allowRate, allowRateKey, appendSetCookie, clearSessionCookie, clearUserSessionCookie, clientKey, createSession, createUserSession,
  getAdminCsrfToken, getUserCsrfToken, getUserSession, hasValidSession, initSecurityStore, isSameOriginRequest,
  ensureDeviceId, isSecureRequest, randomId, revokeSession, revokeUserSession, revokeUserSessions, safeEqual,
  sessionCookie, sharedDelete, sharedGet, sharedSet, sharedSetIfAbsent, userSessionCookie, verifyCsrfToken,
} = require('./lib/security');
const { writeTextAtomic } = require('./lib/storage');
const { DEFAULT_FEEDS, fetchHotTopics } = require('./lib/hot-topics');

const ROOT = __dirname;
function loadEnvFile() {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[env]', error.message);
  }
}
loadEnvFile();
const { createBackup } = require('./tools/backup-data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const GUESTBOOK_FILE = path.join(DATA_DIR, 'guestbook.json');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const JOURNALS_FILE = path.join(DATA_DIR, 'journals.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SITE_FILE = path.join(DATA_DIR, 'site.json');
const { initDatabase, read: readDatabase, write: writeDatabase } = require('./lib/database');
const databaseInfo = initDatabase({ dataDir: DATA_DIR });
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const HOST = String(process.env.HOST || (IS_PRODUCTION ? '127.0.0.1' : '0.0.0.0'));
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'leaf-admin'));
const ADMIN_ACCOUNT = String(process.env.ADMIN_ACCOUNT || 'admin').trim().toLowerCase();
const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = /^(1|true|yes)$/i.test(String(process.env.SMTP_SECURE || ''));
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER).trim();
const otpMinutes = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_TTL_MS = (Number.isFinite(otpMinutes) ? Math.min(Math.max(otpMinutes, 5), 30) : 10) * 60 * 1000;
const OTP_HASH_SECRET = String(process.env.OTP_HASH_SECRET || randomId());
function envLimit(name, fallback, max) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}
const OTP_EMAIL_DAILY_LIMIT = envLimit('OTP_EMAIL_DAILY_LIMIT', 10, 100);
const OTP_IP_DAILY_LIMIT = envLimit('OTP_IP_DAILY_LIMIT', 10, 500);
const OTP_GLOBAL_DAILY_LIMIT = envLimit('OTP_GLOBAL_DAILY_LIMIT', 500, 100000);
const viewDedupMinutes = Number(process.env.VIEW_DEDUP_MINUTES || 30);
const VIEW_DEDUP_MS = (Number.isFinite(viewDedupMinutes) ? Math.min(Math.max(viewDedupMinutes, 5), 24 * 60) : 30) * 60 * 1000;
const BACKUP_ENABLED = !/^(0|false|no)$/i.test(String(process.env.BACKUP_ENABLED || 'true'));
const backupHours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
const BACKUP_INTERVAL_MS = (Number.isFinite(backupHours) ? Math.min(Math.max(backupHours, 1), 168) : 24) * 60 * 60 * 1000;
const CAPTCHA_ENABLED = /^(1|true|yes)$/i.test(String(process.env.CAPTCHA_ENABLED || ''));
const CAPTCHA_VERIFY_URL = String(process.env.CAPTCHA_VERIFY_URL || '').trim();
const CAPTCHA_SECRET = String(process.env.CAPTCHA_SECRET || '').trim();
const HOT_TOPICS_ENABLED = !/^(0|false|no)$/i.test(String(process.env.HOT_TOPICS_ENABLED || 'true'));
const HOT_TOPICS_LIMIT = envLimit('HOT_TOPICS_LIMIT', 10, 30);
const HOT_TOPICS_REFRESH_HOUR = Number.isInteger(Number(process.env.HOT_TOPICS_REFRESH_HOUR))
  ? Math.min(Math.max(Number(process.env.HOT_TOPICS_REFRESH_HOUR), 0), 23) : 7;
const HOT_TOPICS_REFRESH_MINUTE = Number.isInteger(Number(process.env.HOT_TOPICS_REFRESH_MINUTE))
  ? Math.min(Math.max(Number(process.env.HOT_TOPICS_REFRESH_MINUTE), 0), 59) : 0;
const HOT_TOPICS_FEEDS = String(process.env.HOT_TOPICS_FEEDS || '')
  .split(/\s*,\s*/).map((url) => url.trim()).filter(Boolean);

if (IS_PRODUCTION && ADMIN_PASSWORD.length < 8) {
  throw new Error('生产环境必须设置至少 8 位的 ADMIN_PASSWORD');
}

const siteDefaults = {
  title: 'LiuNianのBlog', en: "LiuNian's Blog", subtitle: '落叶生根，字句成林。',
  description: '写代码，玩游戏，记录生活的安静角落。', avatar: '/img/avatar.svg?v=g1', since: '2024-03-01',
  logo: '',
  authorName: '青叶', authorRole: 'CODE FOR FUN · PLAY FOR LIFE',
  authorAccount: '',
  about: '写代码，也玩游戏；玩游戏的间隙写代码，写代码的间隙玩游戏。\n这里记录我的折腾日常：Minecraft 模组与红石、Linux 与运维、前端小技巧，偶尔还有深夜厨房的翻车实录。',
  skills: ['Minecraft', '红石电路', '前端 & CSS', 'Node.js', 'Linux 运维', 'Docker', 'Git', '像素画', '深夜料理'],
  timeline: [{ date: '2024-03', text: '博客开荒，第一篇 Minecraft 教程上线' }, { date: '2024-07', text: '搬进自建服务器，告别白嫖主机' }, { date: '2025-05', text: '全站视觉升级：毛玻璃与极光背景' }, { date: '2025-09', text: '留言板开放，等一个有趣的灵魂' }],
  github: 'https://github.com', email: 'leaf@example.com', footer: '落叶生根，字句成林', musicTitle: '', musicUrl: '',
  introTitle: '欢迎来到 LiuNianのBlog', introText: '向下滚动，进入我的像素森林',
  heroImage: '/img/leaf-hero-v2.png?v=1',
  journalEnabled: true, journalName: '随笔', journalDescription: '记录生活、灵感和那些不想忘记的小事。',
  friendLinks: [],
  heroRotation: true,
  heroImages: [
    { url: '/img/leaf-hero-v2.png?v=1', label: '叶语森林', kind: '自有', enabled: true },
    { url: 'https://www.xtrafondos.com/wallpapers/gran-vista-a-paisaje-anime-de-primavera-13854.jpg', label: '樱花动漫春景', kind: '二次元', enabled: true },
    { url: 'https://img.goodfon.com/original/2000x1500/f/ee/koty-kot-koshka-gorod-most-perilla-noch-fonariki.jpg', label: '灯笼夜色', kind: '二次元', enabled: true },
    { url: 'https://images5.alphacoders.com/106/1061986.png', label: '星河城市', kind: '二次元', enabled: true },
    { url: 'https://www.10wallpaper.com/wallpaper/2560x1600/1609/Mountains_greatness_silence_lake-Nature_High_Quality_Wallpaper_2560x1600.jpg', label: '山湖晨雾', kind: '风景', enabled: true },
    { url: 'https://cdn.photoroom.com/v2/image-cache?path=gs%3A%2F%2Fbackground-7ef44.appspot.com%2Fbackgrounds_v3%2Fcalming%2F33_calming.jpg', label: '粉彩湖畔', kind: '风景', enabled: true },
  ],
  effects: { sakura: true, lanterns: true },
  donationEnabled: false, donationQr: '', donationText: '如果文章对你有帮助，欢迎请我喝杯咖啡 ☕',
};
function safeImageUrl(value, fallback = '') {
  return normalizeResourceUrl(value, fallback);
}
function normalizeHeroImages(value) {
  if (!Array.isArray(value)) return siteDefaults.heroImages.map((item) => ({ ...item }));
  return value.map((item) => ({
    url: safeImageUrl(item?.url, ''),
    label: String(item?.label || '').trim().slice(0, 60),
    kind: String(item?.kind || '其他').trim().slice(0, 20),
    enabled: item?.enabled !== false,
  })).filter((item) => item.url).slice(0, 30);
}
function normalizeFriendLinks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    name: String(item?.name || '').trim().slice(0, 40),
    url: safeImageUrl(item?.url, ''),
    description: String(item?.description || '').trim().slice(0, 100),
  })).filter((item) => item.name && item.url).slice(0, 30);
}
function loadSite() {
  try {
    const saved = readDatabase('site', readJsonFile(SITE_FILE, null));
    if (!saved || typeof saved !== 'object') throw new Error('站点配置不存在');
    return {
      ...siteDefaults, ...saved,
      github: safeImageUrl(saved.github, siteDefaults.github),
      logo: safeImageUrl(saved.logo, ''),
      heroImage: safeImageUrl(saved.heroImage, siteDefaults.heroImage),
      musicUrl: safeImageUrl(saved.musicUrl, ''),
      donationQr: safeImageUrl(saved.donationQr, ''),
      heroImages: normalizeHeroImages(saved.heroImages),
      friendLinks: normalizeFriendLinks(saved.friendLinks),
      effects: { ...siteDefaults.effects, ...(saved.effects && typeof saved.effects === 'object' ? saved.effects : {}) },
    };
  } catch { return { ...siteDefaults, heroImages: normalizeHeroImages(siteDefaults.heroImages), friendLinks: [], effects: { ...siteDefaults.effects } }; }
}
function readJsonFile(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}
let siteConfig = loadSite();
function persistSite() { writeDatabase('site', siteConfig); }

/* ---------------- 数据 ---------------- */

let postsIndex = readDatabase('posts', readJsonFile(path.join(DATA_DIR, 'posts.json'), []))
  .sort((a, b) => (a.date < b.date ? 1 : -1));
function persistPosts() {
  writeDatabase('posts', postsIndex);
}
function safeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9\-_\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function loadState() {
  try {
    const data = readDatabase('state', readJsonFile(STATE_FILE, null));
    if (!data || typeof data !== 'object') throw new Error('状态不存在');
    return {
      views: data.views && typeof data.views === 'object' ? data.views : {},
      likes: data.likes && typeof data.likes === 'object' ? data.likes : {},
      likeUsers: data.likeUsers && typeof data.likeUsers === 'object' ? data.likeUsers : {},
    };
  } catch { return { views: {}, likes: {}, likeUsers: {} }; }
}
function moderationStatus(value, fallback = 'approved') {
  return ['pending', 'approved', 'rejected'].includes(String(value || '')) ? String(value) : fallback;
}
function normalizeModeratedList(data) {
  return Array.isArray(data)
    ? data.filter((item) => item && typeof item === 'object').map((item) => ({ ...item, status: moderationStatus(item.status) }))
    : [];
}
function isPublicEntry(item) {
  return moderationStatus(item?.status) === 'approved';
}
function loadGuestbook() {
  try { return normalizeModeratedList(readDatabase('guestbook', readJsonFile(GUESTBOOK_FILE, []))); }
  catch { return []; }
}
function loadComments() {
  try {
    return normalizeModeratedList(readDatabase('comments', readJsonFile(COMMENTS_FILE, [])));
  } catch { return []; }
}
function loadJournals() {
  try {
    const data = readDatabase('journals', readJsonFile(JOURNALS_FILE, []));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function loadUsers() {
  try {
    const data = readDatabase('users', readJsonFile(USERS_FILE, []));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
const state = loadState();
let guestbook = loadGuestbook();
let comments = loadComments();
let journals = loadJournals();
let users = loadUsers();

function shanghaiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftShanghaiDate(dateKey, days) {
  const base = new Date(dateKey + 'T00:00:00+08:00');
  if (Number.isNaN(base.getTime())) return '';
  base.setUTCDate(base.getUTCDate() + days);
  return shanghaiDateKey(base);
}

function emptyHotTopicCategories() {
  return { tech: [], game: [] };
}

function normalizeHotTopicItem(item) {
  let url = '';
  try {
    const parsed = new URL(String(item?.url || ''));
    if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.toString();
  } catch { /* 忽略无效链接 */ }
  return {
    title: String(item?.title || '').trim().slice(0, 180),
    url,
    source: String(item?.source || '未知来源').trim().slice(0, 80),
    publishedAt: item?.publishedAt && !Number.isNaN(Date.parse(item.publishedAt)) ? new Date(item.publishedAt).toISOString() : null,
  };
}

function normalizeHotTopicDay(value) {
  const categories = emptyHotTopicCategories();
  if (value?.categories && typeof value.categories === 'object') {
    for (const category of Object.keys(categories)) {
      categories[category] = Array.isArray(value.categories[category])
        ? value.categories[category].map(normalizeHotTopicItem).filter((item) => item.title && item.url).slice(0, HOT_TOPICS_LIMIT)
        : [];
    }
  } else if (Array.isArray(value?.items)) {
    for (const item of value.items) {
      const category = item?.category === 'game' ? 'game' : 'tech';
      const normalized = normalizeHotTopicItem(item);
      if (normalized.title && normalized.url && categories[category].length < HOT_TOPICS_LIMIT) categories[category].push(normalized);
    }
  }
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.date || '')) ? value.date : '',
    updatedAt: value?.updatedAt && !Number.isNaN(Date.parse(value.updatedAt)) ? new Date(value.updatedAt).toISOString() : null,
    categories,
  };
}

function hotTopicDayCount(day) {
  return Object.values(day?.categories || {}).reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);
}

function normalizeHotTopics(value) {
  const candidates = Array.isArray(value?.days) ? value.days : (value?.date ? [value] : []);
  const yesterday = shiftShanghaiDate(shanghaiDateKey(), -1);
  const seen = new Set();
  const days = candidates.map(normalizeHotTopicDay)
    .filter((day) => day.date && day.date >= yesterday && !seen.has(day.date) && seen.add(day.date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 2);
  return { days };
}

const savedHotTopics = readDatabase('hot-topics', { days: [] });
let hotTopics = normalizeHotTopics(savedHotTopics);
if (JSON.stringify(savedHotTopics) !== JSON.stringify(hotTopics)) writeDatabase('hot-topics', hotTopics);
let hotTopicsRefreshPromise = null;

async function refreshHotTopics({ force = false } = {}) {
  if (!HOT_TOPICS_ENABLED) return hotTopics;
  const today = shanghaiDateKey();
  if (!force && hotTopics.days.some((day) => day.date === today && hotTopicDayCount(day))) return hotTopics;
  if (hotTopicsRefreshPromise) return hotTopicsRefreshPromise;
  hotTopicsRefreshPromise = (async () => {
    const lock = await sharedSetIfAbsent('hot-topics-refresh', today, { at: Date.now() }, 15 * 60 * 1000);
    if (!lock) return hotTopics;
    try {
      const items = await fetchHotTopics({
        feeds: HOT_TOPICS_FEEDS.length ? HOT_TOPICS_FEEDS : DEFAULT_FEEDS,
        limit: HOT_TOPICS_LIMIT,
      });
      const categories = emptyHotTopicCategories();
      for (const item of items) categories[item.category === 'game' ? 'game' : 'tech'].push(item);
      const yesterday = shiftShanghaiDate(today, -1);
      hotTopics = {
        days: [{ date: today, updatedAt: new Date().toISOString(), categories },
          ...hotTopics.days.filter((day) => day.date !== today && day.date >= yesterday)].slice(0, 2),
      };
      writeDatabase('hot-topics', hotTopics);
      console.log(`[hot-topics] 已刷新 ${items.length} 条热点（${today}）`);
    } catch (error) {
      console.error('[hot-topics] 刷新失败，继续使用上次数据：', error.message);
    } finally {
      hotTopicsRefreshPromise = null;
    }
    return hotTopics;
  })();
  return hotTopicsRefreshPromise;
}

function publicHotTopicDay(day) {
  const categories = emptyHotTopicCategories();
  for (const category of Object.keys(categories)) {
    categories[category] = Array.isArray(day?.categories?.[category])
      ? day.categories[category].map(normalizeHotTopicItem).filter((item) => item.title && item.url)
      : [];
  }
  return { date: day?.date || '', updatedAt: day?.updatedAt || null, categories };
}

function hotTopicsForClient() {
  const today = shanghaiDateKey();
  const days = hotTopics.days.map(publicHotTopicDay);
  const current = days.find((day) => day.date === today) || days[0] || null;
  const categories = current?.categories || emptyHotTopicCategories();
  return {
    enabled: HOT_TOPICS_ENABLED,
    today,
    date: current?.date || '',
    updatedAt: current?.updatedAt || null,
    stale: Boolean(current && current.date !== today),
    days,
    categories,
    items: [...categories.tech, ...categories.game],
  };
}

let stateTimer = null;
function persistState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    try { writeDatabase('state', state); } catch (error) { console.error('[state]', error.message); }
  }, 300);
}
let gbTimer = null;
function persistGuestbook() {
  clearTimeout(gbTimer);
  gbTimer = setTimeout(() => {
    try { writeDatabase('guestbook', guestbook); } catch (error) { console.error('[guestbook]', error.message); }
  }, 300);
}
let commentsTimer = null;
function persistComments() {
  clearTimeout(commentsTimer);
  commentsTimer = setTimeout(() => {
    try { writeDatabase('comments', comments); } catch (error) { console.error('[comments]', error.message); }
  }, 300);
}
let journalsTimer = null;
function persistJournals() {
  clearTimeout(journalsTimer);
  journalsTimer = setTimeout(() => {
    try { writeDatabase('journals', journals); } catch (error) { console.error('[journals]', error.message); }
  }, 300);
}
let usersTimer = null;
function persistUsers() {
  clearTimeout(usersTimer);
  usersTimer = setTimeout(() => {
    try { writeDatabase('users', users); } catch (error) { console.error('[users]', error.message); }
  }, 300);
}

const OTP_REGISTER_NAMESPACE = 'otp:register';
const OTP_EMAIL_CHANGE_NAMESPACE = 'otp:email-change';
let mailer = null;
let mailerPromise = null;
function emailIsAllowed(email) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@qq\.com$/i.test(email);
}
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function getUserById(id) {
  return users.find((user) => user.id === id) || null;
}
function accountName(email) {
  return normalizeEmail(email).split('@')[0];
}
function isBlogAuthor(user) {
  if (!user) return false;
  if (user.isAdmin === true) return true;
  const configured = String(siteConfig.authorAccount || ADMIN_ACCOUNT).trim().toLowerCase();
  return accountName(user.email) === ADMIN_ACCOUNT || accountName(user.email) === configured;
}
function isAdminOwner(user) {
  return Boolean(user && (user.isAdmin === true || accountName(user.email) === ADMIN_ACCOUNT));
}
async function canAccessAdmin(req) {
  return isAdminOwner(getUserById(await getUserSession(req)));
}
async function getMailer() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !Number.isInteger(SMTP_PORT) || SMTP_PORT <= 0) return null;
  if (mailer) return mailer;
  if (!mailerPromise) {
    mailerPromise = dns.promises.lookup(SMTP_HOST, { family: 4 }).then(({ address }) => {
      mailer = nodemailer.createTransport({
        // 使用 Windows 系统 DNS 解析出的 IPv4，避开 Node 直连 DNS/IPv6 首次超时。
        host: address, servername: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
        pool: true, maxConnections: 1, maxMessages: 100,
        dnsTimeout: 5000, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        tls: { servername: SMTP_HOST },
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      return mailer;
    }).finally(() => { mailerPromise = null; });
  }
  return mailerPromise;
}
function resetMailer() {
  try { mailer?.close(); } catch { /* 忽略关闭旧连接时的错误 */ }
  mailer = null;
  mailerPromise = null;
}
function otpHash(code) {
  return crypto.createHmac('sha256', OTP_HASH_SECRET).update(String(code)).digest('hex');
}
function newOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function passwordDigest(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64, {
    N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024,
  }).toString('hex');
}
function createPassword(password) {
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  return { passwordSalt, passwordHash: passwordDigest(password, passwordSalt) };
}
function verifyPassword(user, password) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  return safeEqual(passwordDigest(password, user.passwordSalt), user.passwordHash);
}
function defaultUsername(email) {
  const local = String(email || '').split('@')[0].replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24);
  return local.length >= 2 ? local : `${local || 'QQ'}用户`;
}
function normalizeUsername(value, fallback) {
  return String(value || fallback || '').trim().replace(/[<>]/g, '').slice(0, 30);
}
function usernameAvailable(username, currentId) {
  const wanted = String(username || '').toLocaleLowerCase();
  return !users.some((item) => item.id !== currentId && String(item.username || defaultUsername(item.email)).trim().toLocaleLowerCase() === wanted);
}
function normalizeAvatar(value) {
  const avatar = String(value || '').trim().slice(0, 500);
  return normalizeResourceUrl(avatar, '/img/avatar.svg?v=g1');
}
function userForClient(user) {
  return user ? {
    id: user.id, email: user.email,
    username: user.username || defaultUsername(user.email),
    avatar: normalizeAvatar(user.avatar), createdAt: user.createdAt,
  } : null;
}
function userForAdmin(user) {
  return user ? {
    id: user.id, email: user.email,
    username: user.username || defaultUsername(user.email),
    avatar: normalizeAvatar(user.avatar), createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  } : null;
}
async function consumeOtp(namespace, key, code) {
  const value = String(code || '').trim();
  if (!/^\d{6}$/.test(value)) return { error: '请输入 6 位验证码', code: 'INVALID_OTP_FORMAT', status: 400 };
  const challenge = await sharedGet(namespace, key);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    await sharedDelete(namespace, key);
    return { error: '验证码已过期，请重新获取', code: 'OTP_EXPIRED', status: 400 };
  }
  challenge.attempts++;
  if (challenge.attempts > 5) {
    await sharedDelete(namespace, key);
    return { error: '验证码错误次数过多，请重新获取', code: 'OTP_LOCKED', status: 429 };
  }
  if (!safeEqual(otpHash(value), challenge.hash)) {
    await sharedSet(namespace, key, challenge, Math.max(1000, challenge.expiresAt - Date.now()));
    return { error: '验证码不正确', code: 'OTP_INVALID', status: 400 };
  }
  await sharedDelete(namespace, key);
  return null;
}
async function sendOtp(namespace, key, email, subject) {
  const now = Date.now();
  const previous = await sharedGet(namespace, key);
  if (previous && previous.sentAt + 60 * 1000 > now) {
    return { error: '验证码已发送，请 60 秒后再试', code: 'OTP_COOLDOWN', status: 429, retryAfter: Math.ceil((previous.sentAt + 60 * 1000 - now) / 1000) };
  }
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return { error: '邮件服务尚未配置，请先填写 .env 中的 SMTP 配置', code: 'SMTP_NOT_CONFIGURED', status: 503 };
  const sendingKey = `${namespace}:${key}`;
  if (!await sharedSetIfAbsent('otp-sending', sendingKey, { startedAt: now }, 30 * 1000)) {
    return { error: '验证码正在发送，请稍候', code: 'OTP_SENDING', status: 429, retryAfter: 30 };
  }
  const code = newOtp();
  let lastError = null;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const transport = await getMailer();
        await transport.sendMail({
          from: SMTP_FROM, to: email, subject,
          text: `你的 LiuNianのBlog 验证码是：${code}\n\n验证码 ${Math.round(OTP_TTL_MS / 60000)} 分钟内有效，请勿把验证码告诉别人。`,
        });
        const sentAt = Date.now();
        await sharedSet(namespace, key, { hash: otpHash(code), expiresAt: sentAt + OTP_TTL_MS, sentAt, attempts: 0 }, OTP_TTL_MS);
        return { ok: true, expiresIn: Math.round(OTP_TTL_MS / 1000), retryAfter: 60 };
      } catch (error) {
        lastError = error;
        resetMailer();
        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    console.error('[smtp]', lastError?.code || '', lastError?.message || 'unknown error');
    return { error: '验证码邮件发送失败，请检查 SMTP 授权码或网络后重试', code: 'SMTP_SEND_FAILED', status: 502 };
  } finally {
    await sharedDelete('otp-sending', sendingKey);
  }
}

const contentCache = new Map();
function getPostContent(slug) {
  if (contentCache.has(slug)) return contentCache.get(slug);
  try {
    const md = fs.readFileSync(path.join(CONTENT_DIR, slug + '.md'), 'utf8');
    contentCache.set(slug, md);
    return md;
  } catch { return null; }
}

function postMeta(p) {
  return {
    slug: p.slug, title: p.title, date: p.date, category: p.category,
    tags: p.tags, pinned: !!p.pinned, cover: p.cover, excerpt: p.excerpt,
    minutes: p.minutes, published: p.published !== false,
    views: state.views[p.slug] || 0, likes: state.likes[p.slug] || 0,
  };
}

function journalForClient(item) {
  const journalComments = comments.filter((comment) => comment.journalId === item.id && isPublicEntry(comment));
  return {
    id: item.id,
    contentHtml: render(String(item.content || '')),
    time: item.time,
    comments: journalComments.slice(-100).reverse().map(publicComment),
    commentCount: journalComments.length,
  };
}

function journalForAdmin(item) {
  return { id: item.id, content: String(item.content || ''), time: item.time };
}

function paginate(list, pageStr, limitStr) {
  const limit = Math.min(Math.max(parseInt(limitStr || '10', 10) || 10, 1), 50);
  const page = Math.max(parseInt(pageStr || '1', 10) || 1, 1);
  const total = list.length;
  const pages = Math.max(Math.ceil(total / limit), 1);
  const items = list.slice((page - 1) * limit, page * limit);
  return { items, page, limit, total, pages, hasMore: page < pages };
}

/* ---------------- API ---------------- */

function sendJson(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  res.end(JSON.stringify(data));
}

function applySecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:", "media-src 'self' data: blob: https: http:",
    "font-src 'self' data:", "connect-src 'self'", "object-src 'none'",
    "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'",
  ].join('; '));
  if (isSecureRequest(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  return domain ? `${name.slice(0, 2)}***@${domain}` : '';
}

function securityLog(event, req, details = {}) {
  console.log('[security]', JSON.stringify({
    time: new Date().toISOString(), event, ip: clientKey(req), ...details,
  }));
}

function isAutomatedViewRequest(req) {
  const userAgent = String(req.headers['user-agent'] || '').toLowerCase();
  const purpose = `${req.headers.purpose || ''} ${req.headers['sec-purpose'] || ''}`.toLowerCase();
  return !userAgent || /bot|crawler|spider|slurp|preview|headless|phantom|selenium|playwright|puppeteer|scrapy|curl|wget|python-requests|go-http-client|lighthouse|uptimerobot/i.test(userAgent) || /prefetch|prerender|preview/i.test(purpose);
}

async function recordPostView(req, res, post, userId = '') {
  if (isAutomatedViewRequest(req)) return false;
  const deviceId = ensureDeviceId(req, res);
  const visitor = userId ? `user:${userId}` : `device:${deviceId}:ip:${clientKey(req)}`;
  const key = `${post.slug}:${visitor}`;
  if (!await sharedSetIfAbsent('post-view', key, { at: Date.now() }, VIEW_DEDUP_MS)) return false;
  state.views[post.slug] = (state.views[post.slug] || 0) + 1;
  persistState();
  return true;
}

function rejectCsrf(req, res, expected) {
  if (verifyCsrfToken(req, expected)) return false;
  securityLog('csrf-rejected', req, { path: req.url });
  sendJson(res, 403, { error: '安全校验已失效，请刷新页面后重试', code: 'CSRF_REJECTED' });
  return true;
}

async function rejectOtpLimits(req, res, email) {
  const day = 24 * 60 * 60 * 1000;
  const deviceId = ensureDeviceId(req, res);
  const checks = [
    [await allowRate(req, 'otp-send-minute', 1, 60 * 1000), '验证码发送过于频繁，请 60 秒后再试'],
    [await allowRate(req, 'otp-send-day', OTP_IP_DAILY_LIMIT, day), '当前网络今天发送验证码次数过多，请明天再试'],
    [await allowRateKey('otp-send-device-minute', deviceId, 1, 60 * 1000), '当前设备发送验证码过于频繁，请 60 秒后再试'],
    [await allowRateKey('otp-send-device-day', deviceId, OTP_IP_DAILY_LIMIT, day), '当前设备今天发送验证码次数过多，请明天再试'],
    [await allowRateKey('otp-email-day', email, OTP_EMAIL_DAILY_LIMIT, day), '这个邮箱今天发送验证码次数过多，请明天再试'],
    [await allowRateKey('otp-global-day', 'all', OTP_GLOBAL_DAILY_LIMIT, day), '本站今日验证码发送额度已用完，请明天再试'],
  ];
  const blocked = checks.find(([result]) => !result.ok);
  if (!blocked) return false;
  const [result, message] = blocked;
  res.setHeader('Retry-After', String(result.retryAfter));
  securityLog('otp-rate-limited', req, { email: maskEmail(email), retryAfter: result.retryAfter });
  sendJson(res, 429, { error: message, code: 'OTP_RATE_LIMITED', retryAfter: result.retryAfter });
  return true;
}

async function otpRequestIsRepeat(namespace, key) {
  const [challenge, sending] = await Promise.all([
    sharedGet(namespace, key),
    sharedGet('otp-sending', `${namespace}:${key}`),
  ]);
  return Boolean(sending || (challenge && challenge.sentAt + 60 * 1000 > Date.now()));
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;
    req.on('data', (c) => {
      if (settled) return;
      buf += c;
      if (Buffer.byteLength(buf, 'utf8') > 2 * 1024 * 1024) {
        settled = true;
        const error = new Error('请求体过大'); error.statusCode = 413;
        reject(error); req.resume();
      }
    });
    req.on('end', () => {
      if (settled) return;
      if (!buf.trim()) return resolve({});
      try {
        const value = JSON.parse(buf);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          const error = new Error('请求体必须是 JSON 对象'); error.statusCode = 400; return reject(error);
        }
        resolve(value);
      } catch {
        const error = new Error('JSON 格式无效'); error.statusCode = 400; reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function rejectWhenLimited(req, res, scope, limit, windowMs, message) {
  const checks = [
    ['ip', await allowRateKey(`${scope}:ip`, clientKey(req), limit, windowMs)],
    ['device', await allowRateKey(`${scope}:device`, ensureDeviceId(req, res), limit, windowMs)],
  ];
  const blocked = checks.find(([, result]) => !result.ok);
  if (!blocked) return false;
  const [dimension, result] = blocked;
  res.setHeader('Retry-After', String(result.retryAfter));
  securityLog(result.cooldown ? 'cooldown-started' : 'rate-limited', req, { scope, dimension, retryAfter: result.retryAfter });
  sendJson(res, 429, { error: result.cooldown ? `${message}，已进入冷却，请稍后再试` : message, retryAfter: result.retryAfter, code: result.cooldown ? 'COOLDOWN' : 'RATE_LIMITED' });
  return true;
}

async function verifyCaptcha(req, token, action) {
  if (!CAPTCHA_ENABLED) return { ok: true, skipped: true };
  if (!CAPTCHA_VERIFY_URL || !CAPTCHA_SECRET) {
    return { ok: false, status: 503, code: 'CAPTCHA_NOT_CONFIGURED', error: '人机验证尚未配置，请联系管理员' };
  }
  if (!String(token || '').trim()) {
    return { ok: false, status: 400, code: 'CAPTCHA_REQUIRED', error: '请先完成安全验证' };
  }
  let verifyUrl;
  try {
    verifyUrl = new URL(CAPTCHA_VERIFY_URL);
    if (!['http:', 'https:'].includes(verifyUrl.protocol)) throw new Error('unsupported protocol');
  } catch {
    return { ok: false, status: 503, code: 'CAPTCHA_CONFIG_INVALID', error: '人机验证配置无效，请联系管理员' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: CAPTCHA_SECRET, response: String(token).trim(), remoteip: clientKey(req), action }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
      return { ok: false, status: 400, code: 'CAPTCHA_FAILED', error: '安全验证未通过，请重试' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, status: 502, code: 'CAPTCHA_UNAVAILABLE', error: error.name === 'AbortError' ? '安全验证服务响应超时，请稍后重试' : '安全验证服务暂时不可用，请稍后重试' };
  } finally {
    clearTimeout(timer);
  }
}

async function rejectCaptcha(req, res, body, action) {
  const result = await verifyCaptcha(req, body?.captchaToken, action);
  if (result.ok) return false;
  securityLog('captcha-rejected', req, { action, code: result.code });
  sendJson(res, result.status, { error: result.error, code: result.code });
  return true;
}

async function rejectAccountWhenLimited(req, res, scope, userId, limit, windowMs, message) {
  const result = await allowRateKey(`${scope}:account`, userId, limit, windowMs);
  if (result.ok) return false;
  res.setHeader('Retry-After', String(result.retryAfter));
  securityLog(result.cooldown ? 'cooldown-started' : 'rate-limited', req, { scope, dimension: 'account', userId, retryAfter: result.retryAfter });
  sendJson(res, 429, { error: result.cooldown ? `${message}，已进入冷却，请稍后再试` : message, retryAfter: result.retryAfter, code: result.cooldown ? 'COOLDOWN' : 'RATE_LIMITED' });
  return true;
}

async function isAdmin(req) {
  return (await hasValidSession(req)) && (await canAccessAdmin(req));
}

async function requireUser(req, res) {
  const userId = await getUserSession(req);
  if (!userId || !getUserById(userId)) {
    sendJson(res, 401, { error: '请先登录后再留言或点赞', code: 'LOGIN_REQUIRED' });
    return null;
  }
  return userId;
}

function publicComment(item) {
  const user = getUserById(item.userId);
  return {
    id: item.id,
    postSlug: item.postSlug || null,
    journalId: item.journalId || null,
    name: item.name,
    message: item.message,
    avatar: item.avatar,
    time: item.time,
    isAuthor: isBlogAuthor(user),
  };
}

function publicGuestbookEntry(item) {
  const user = getUserById(item.userId);
  return {
    id: item.id, name: item.name, message: item.message,
    avatar: item.avatar, time: item.time, isAuthor: isBlogAuthor(user),
  };
}

function buildToc(md) {
  const seen = new Set();
  const toc = [];
  let inCode = false;
  for (const line of String(md).split('\n')) {
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      const raw = m[2].trim().replace(/[*_`~]/g, '');
      let base = raw.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
      if (!base) base = 'sec';
      let slug = base, n = 2;
      while (seen.has(slug)) slug = base + '-' + n++;
      seen.add(slug);
      if (m[1].length >= 2 && m[1].length <= 3) toc.push({ level: m[1].length, text: raw, slug });
    }
  }
  return toc;
}

async function handleApi(req, res, pathname, query) {
  const method = req.method.toUpperCase();
  // 为限流、阅读去重和后续 Redis 迁移准备稳定的匿名设备标识。
  ensureDeviceId(req, res);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !isSameOriginRequest(req)) {
    securityLog('cross-origin-rejected', req, { method, path: pathname });
    return sendJson(res, 403, { error: '拒绝跨站请求', code: 'ORIGIN_REJECTED' });
  }

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
  }

  if (pathname === '/api/hot-topics' && method === 'GET') {
    if (!HOT_TOPICS_ENABLED) return sendJson(res, 200, hotTopicsForClient());
    const today = shanghaiDateKey();
    if (!hotTopics.days.some((day) => day.date === today && hotTopicDayCount(day))) await refreshHotTopics();
    return sendJson(res, 200, hotTopicsForClient());
  }

  if (pathname === '/api/me' && method === 'GET') {
    const userId = await getUserSession(req);
    const user = userId ? getUserById(userId) : null;
    return sendJson(res, 200, {
      loggedIn: Boolean(user), user: userForClient(user),
      csrfToken: user ? await getUserCsrfToken(req) : '',
    });
  }

  if ((pathname === '/api/auth/register/request-code' || pathname === '/api/auth/request-code') && method === 'POST') {
    const body = await readBody(req);
    if (await rejectCaptcha(req, res, body, 'register-code')) return;
    const email = normalizeEmail(body.email);
    if (!emailIsAllowed(email)) return sendJson(res, 400, { error: '目前只允许使用 @qq.com 邮箱', code: 'EMAIL_NOT_ALLOWED' });
    const existing = users.find((item) => item.email === email);
    if (existing) return sendJson(res, 409, { error: '这个邮箱已经注册，请直接使用密码登录', code: 'EMAIL_REGISTERED' });
    if (!await otpRequestIsRepeat(OTP_REGISTER_NAMESPACE, email) && await rejectOtpLimits(req, res, email)) return;
    const result = await sendOtp(OTP_REGISTER_NAMESPACE, email, email, 'LiuNianのBlog 注册验证码');
    securityLog(result.ok ? 'otp-sent' : 'otp-send-failed', req, { email: maskEmail(email), code: result.code || 'OK' });
    return sendJson(res, result.status || 200, result);
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    if (await rejectWhenLimited(req, res, 'auth-register', 15, 10 * 60 * 1000, '注册尝试过于频繁，请稍后再试')) return;
    const body = await readBody(req);
    if (await rejectCaptcha(req, res, body, 'register')) return;
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    const password = String(body.password || '');
    if (!emailIsAllowed(email)) return sendJson(res, 400, { error: '目前只允许使用 @qq.com 邮箱', code: 'EMAIL_NOT_ALLOWED' });
    const registerEmailRate = await allowRateKey('auth-register:email', email, 3, 24 * 60 * 60 * 1000);
    if (!registerEmailRate.ok) {
      res.setHeader('Retry-After', String(registerEmailRate.retryAfter));
      return sendJson(res, 429, { error: '这个邮箱注册尝试过于频繁，请稍后再试', code: registerEmailRate.cooldown ? 'COOLDOWN' : 'RATE_LIMITED', retryAfter: registerEmailRate.retryAfter });
    }
    const existing = users.find((item) => item.email === email);
    if (existing) return sendJson(res, 409, { error: '这个邮箱已经注册，请直接使用密码登录', code: 'EMAIL_REGISTERED' });
    if (password.length < 8 || password.length > 72) return sendJson(res, 400, { error: '密码长度需要为 8 至 72 位', code: 'INVALID_PASSWORD' });
    const otpError = await consumeOtp(OTP_REGISTER_NAMESPACE, email, code);
    if (otpError) return sendJson(res, otpError.status, otpError);
    const username = normalizeUsername(body.username, defaultUsername(email));
    if (username.length < 2) return sendJson(res, 400, { error: '用户名至少需要 2 个字符', code: 'INVALID_USERNAME' });
    if (!usernameAvailable(username)) return sendJson(res, 409, { error: '这个用户名已经被使用，请换一个', code: 'USERNAME_TAKEN' });
    const now = new Date().toISOString();
    const user = { id: randomId(), email, createdAt: now };
    users.push(user);
    Object.assign(user, createPassword(password), {
      username, avatar: normalizeAvatar(body.avatar), lastLoginAt: now,
    });
    persistUsers();
    const { token, csrfToken } = await createUserSession(user.id);
    appendSetCookie(res, userSessionCookie(token, isSecureRequest(req)));
    securityLog('user-registered', req, { userId: user.id, email: maskEmail(email) });
    return sendJson(res, 200, { ok: true, user: userForClient(user), csrfToken });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (await rejectWhenLimited(req, res, 'auth-login', 10, 10 * 60 * 1000, '登录尝试过于频繁，请稍后再试')) return;
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!emailIsAllowed(email) || !password) {
      securityLog('user-login-failed', req, { email: maskEmail(email) });
      return sendJson(res, 401, { error: '邮箱或密码错误', code: 'INVALID_CREDENTIALS' });
    }
    const user = users.find((item) => item.email === email);
    if (!user?.passwordHash || !verifyPassword(user, password)) {
      const emailRate = await allowRateKey('auth-login-email', email, 8, 10 * 60 * 1000);
      if (!emailRate.ok) {
        res.setHeader('Retry-After', String(emailRate.retryAfter));
        securityLog('user-login-rate-limited', req, { email: maskEmail(email) });
        return sendJson(res, 429, { error: '登录尝试过于频繁，请稍后再试', code: 'LOGIN_RATE_LIMITED', retryAfter: emailRate.retryAfter });
      }
      securityLog('user-login-failed', req, { email: maskEmail(email) });
      return sendJson(res, 401, { error: '邮箱或密码错误', code: 'INVALID_CREDENTIALS' });
    }
    user.lastLoginAt = new Date().toISOString();
    persistUsers();
    const { token, csrfToken } = await createUserSession(user.id);
    appendSetCookie(res, userSessionCookie(token, isSecureRequest(req)));
    securityLog('user-login-succeeded', req, { userId: user.id, email: maskEmail(email) });
    return sendJson(res, 200, { ok: true, user: userForClient(user), csrfToken });
  }

  if (pathname === '/api/auth/verify-code' && method === 'POST') {
    return sendJson(res, 410, { error: '现在请在注册页面填写验证码和密码；已注册账号请直接登录', code: 'AUTH_FLOW_CHANGED' });
  }

  if (pathname === '/api/auth/profile' && method === 'PUT') {
    const userId = await requireUser(req, res);
    if (!userId) return;
    if (rejectCsrf(req, res, await getUserCsrfToken(req))) return;
    const body = await readBody(req);
    const username = normalizeUsername(body.username, '');
    if (username.length < 2) return sendJson(res, 400, { error: '用户名至少需要 2 个字符', code: 'INVALID_USERNAME' });
    if (!usernameAvailable(username, userId)) return sendJson(res, 409, { error: '这个用户名已经被使用，请换一个', code: 'USERNAME_TAKEN' });
    const user = getUserById(userId);
    user.username = username;
    user.avatar = normalizeAvatar(body.avatar);
    persistUsers();
    return sendJson(res, 200, { ok: true, user: userForClient(user) });
  }

  if (pathname === '/api/auth/change-email/request-code' && method === 'POST') {
    const userId = await requireUser(req, res);
    if (!userId) return;
    if (rejectCsrf(req, res, await getUserCsrfToken(req))) return;
    const body = await readBody(req);
    if (await rejectCaptcha(req, res, body, 'change-email-code')) return;
    const email = normalizeEmail(body.email);
    if (!emailIsAllowed(email)) return sendJson(res, 400, { error: '目前只允许使用 @qq.com 邮箱', code: 'EMAIL_NOT_ALLOWED' });
    const current = getUserById(userId);
    if (current.email === email) return sendJson(res, 400, { error: '新邮箱不能和当前邮箱相同', code: 'SAME_EMAIL' });
    if (users.some((item) => item.email === email && item.id !== userId)) return sendJson(res, 409, { error: '这个邮箱已经注册，请换一个', code: 'EMAIL_REGISTERED' });
    const otpKey = `${userId}:${email}`;
    if (!await otpRequestIsRepeat(OTP_EMAIL_CHANGE_NAMESPACE, otpKey) && await rejectOtpLimits(req, res, email)) return;
    const result = await sendOtp(OTP_EMAIL_CHANGE_NAMESPACE, otpKey, email, 'LiuNianのBlog 更换邮箱验证码');
    securityLog(result.ok ? 'otp-sent' : 'otp-send-failed', req, { userId, email: maskEmail(email), code: result.code || 'OK' });
    return sendJson(res, result.status || 200, result);
  }

  if (pathname === '/api/auth/change-email' && method === 'POST') {
    if (await rejectWhenLimited(req, res, 'auth-change-email', 10, 10 * 60 * 1000, '操作过于频繁，请稍后再试')) return;
    const userId = await requireUser(req, res);
    if (!userId) return;
    if (rejectCsrf(req, res, await getUserCsrfToken(req))) return;
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    if (!emailIsAllowed(email)) return sendJson(res, 400, { error: '目前只允许使用 @qq.com 邮箱', code: 'EMAIL_NOT_ALLOWED' });
    if (users.some((item) => item.email === email && item.id !== userId)) return sendJson(res, 409, { error: '这个邮箱已经注册，请换一个', code: 'EMAIL_REGISTERED' });
    const otpError = await consumeOtp(OTP_EMAIL_CHANGE_NAMESPACE, `${userId}:${email}`, body.code);
    if (otpError) return sendJson(res, otpError.status, otpError);
    const user = getUserById(userId);
    user.email = email;
    persistUsers();
    return sendJson(res, 200, { ok: true, user: userForClient(user) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const csrfToken = await getUserCsrfToken(req);
    if (csrfToken && rejectCsrf(req, res, csrfToken)) return;
    await revokeUserSession(req);
    appendSetCookie(res, clearUserSessionCookie(isSecureRequest(req)));
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    if (await rejectWhenLimited(req, res, 'admin-login', 5, 10 * 60 * 1000, '登录尝试过于频繁，请稍后再试')) return;
    const ownerUser = getUserById(await getUserSession(req));
    if (!isAdminOwner(ownerUser)) {
      securityLog('admin-login-not-owner', req);
      return sendJson(res, 403, { error: '请先登录博主账号后再进入后台', code: 'ADMIN_OWNER_REQUIRED' });
    }
    if (!ADMIN_PASSWORD) return sendJson(res, 503, { error: '后台未配置 ADMIN_PASSWORD' });
    const body = await readBody(req);
    if (!safeEqual(body.password, ADMIN_PASSWORD)) {
      securityLog('admin-login-failed', req);
      return sendJson(res, 401, { error: '管理密码错误' });
    }
    const { token, csrfToken } = await createSession();
    appendSetCookie(res, sessionCookie(token, isSecureRequest(req)));
    securityLog('admin-login-succeeded', req);
    return sendJson(res, 200, { ok: true, expiresIn: 8 * 60 * 60, csrfToken });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    const csrfToken = await getAdminCsrfToken(req);
    if (csrfToken && rejectCsrf(req, res, csrfToken)) return;
    await revokeSession(req);
    appendSetCookie(res, clearSessionCookie(isSecureRequest(req)));
    return sendJson(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!(await isAdmin(req))) return sendJson(res, 401, { error: '登录已失效，请重新登录' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && rejectCsrf(req, res, await getAdminCsrfToken(req))) return;
    if (method !== 'GET' && await rejectWhenLimited(req, res, 'admin-write', 120, 60 * 1000, '操作过于频繁，请稍后再试')) return;
  }

  if (pathname === '/api/admin/session' && method === 'GET') {
    return sendJson(res, 200, { ok: true, csrfToken: await getAdminCsrfToken(req) });
  }

  if (pathname === '/api/admin/hot-topics/refresh' && method === 'POST') {
    await refreshHotTopics({ force: true });
    const result = hotTopicsForClient();
    if (!result.items.length) return sendJson(res, 502, { error: '热点来源暂时不可用，请稍后重试' });
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (pathname === '/api/guestbook' && method === 'POST' && await rejectWhenLimited(req, res, 'guestbook', 5, 10 * 60 * 1000, '留言过于频繁，请稍后再试')) return;
  if (method === 'POST' && /^\/api\/posts\/[^/]+\/comments$/.test(pathname)
    && await rejectWhenLimited(req, res, 'comments', 5, 10 * 60 * 1000, '留言过于频繁，请稍后再试')) return;
  if (method === 'POST' && /^\/api\/journals\/[^/]+\/comments$/.test(pathname)
    && await rejectWhenLimited(req, res, 'journal-comments', 5, 10 * 60 * 1000, '留言过于频繁，请稍后再试')) return;
  if (method === 'POST' && /^\/api\/posts\/[^/]+\/(view|like)$/.test(pathname) && await rejectWhenLimited(req, res, 'engagement', 60, 60 * 1000, '操作过于频繁，请稍后再试')) return;

  if (pathname === '/api/admin/posts' && method === 'GET') {
    return sendJson(res, 200, postsIndex.map((p) => ({ ...postMeta(p), content: getPostContent(p.slug) || '' })));
  }
  if (pathname === '/api/admin/site' && method === 'GET') return sendJson(res, 200, siteConfig);
  if (pathname === '/api/admin/site' && method === 'PUT') {
    const body = await readBody(req);
    const textFields = ['title', 'en', 'subtitle', 'description', 'avatar', 'logo', 'since', 'authorName', 'authorRole', 'authorAccount', 'about', 'github', 'email', 'footer', 'musicTitle', 'musicUrl', 'introTitle', 'introText', 'heroImage', 'journalName', 'journalDescription', 'donationQr', 'donationText'];
    for (const key of textFields) if (key in body) siteConfig[key] = String(body[key] || '').trim().slice(0, key === 'about' ? 5000 : 500);
    if ('logo' in body) siteConfig.logo = safeImageUrl(body.logo, '');
    if ('avatar' in body) siteConfig.avatar = safeImageUrl(body.avatar, siteDefaults.avatar);
    if ('github' in body) siteConfig.github = safeImageUrl(body.github, '');
    if ('musicUrl' in body) siteConfig.musicUrl = safeImageUrl(body.musicUrl, '');
    if ('heroImage' in body) siteConfig.heroImage = safeImageUrl(body.heroImage, siteDefaults.heroImage);
    if ('donationQr' in body) siteConfig.donationQr = safeImageUrl(body.donationQr, '');
    if ('journalEnabled' in body) siteConfig.journalEnabled = body.journalEnabled === true || body.journalEnabled === 'true' || body.journalEnabled === 'on';
    if (Array.isArray(body.friendLinks)) siteConfig.friendLinks = normalizeFriendLinks(body.friendLinks);
    if ('heroRotation' in body) siteConfig.heroRotation = body.heroRotation === true || body.heroRotation === 'true' || body.heroRotation === 'on';
    if (Array.isArray(body.heroImages)) siteConfig.heroImages = normalizeHeroImages(body.heroImages);
    if (body.effects && typeof body.effects === 'object') {
      siteConfig.effects = {
        ...siteConfig.effects,
        sakura: body.effects.sakura === true || body.effects.sakura === 'true' || body.effects.sakura === 'on',
        lanterns: body.effects.lanterns === true || body.effects.lanterns === 'true' || body.effects.lanterns === 'on',
      };
    }
    if ('donationEnabled' in body) siteConfig.donationEnabled = body.donationEnabled === true || body.donationEnabled === 'true' || body.donationEnabled === 'on';
    if (Array.isArray(body.skills)) siteConfig.skills = body.skills.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 30);
    if (Array.isArray(body.timeline)) siteConfig.timeline = body.timeline.map((x) => ({ date: String(x.date || '').slice(0, 30), text: String(x.text || '').slice(0, 300) })).filter((x) => x.date || x.text).slice(0, 30);
    persistSite(); return sendJson(res, 200, siteConfig);
  }
  if (pathname === '/api/admin/journals' && method === 'GET') {
    return sendJson(res, 200, journals.slice().sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))).map(journalForAdmin));
  }
  if (pathname === '/api/admin/journals' && method === 'POST') {
    const body = await readBody(req);
    const content = String(body.content || '').trim();
    if (!content) return sendJson(res, 400, { error: '随笔内容不能为空' });
    if (Buffer.byteLength(content, 'utf8') > 256 * 1024) return sendJson(res, 413, { error: '随笔不能超过 256 KB' });
    const entry = { id: randomId(), content, time: new Date().toISOString() };
    journals.push(entry); persistJournals();
    return sendJson(res, 200, journalForAdmin(entry));
  }
  const adminJournal = pathname.match(/^\/api\/admin\/journals\/([^/]+)$/);
  if (adminJournal && (method === 'PUT' || method === 'DELETE')) {
    const id = decodeURIComponent(adminJournal[1]);
    const index = journals.findIndex((item) => item.id === id);
    if (index < 0) return sendJson(res, 404, { error: '随笔不存在' });
    if (method === 'DELETE') {
      journals.splice(index, 1); comments = comments.filter((item) => item.journalId !== id);
      persistJournals(); persistComments();
      return sendJson(res, 200, { ok: true });
    }
    const body = await readBody(req);
    const content = String(body.content || '').trim();
    if (!content) return sendJson(res, 400, { error: '随笔内容不能为空' });
    if (Buffer.byteLength(content, 'utf8') > 256 * 1024) return sendJson(res, 413, { error: '随笔不能超过 256 KB' });
    journals[index].content = content; persistJournals();
    return sendJson(res, 200, journalForAdmin(journals[index]));
  }
  if (pathname === '/api/admin/comments' && method === 'GET') {
    return sendJson(res, 200, comments.slice(-500).reverse());
  }
  if (pathname === '/api/admin/users' && method === 'GET') {
    return sendJson(res, 200, users.slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map(userForAdmin));
  }
  const adminUser = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUser && method === 'DELETE') {
    const id = decodeURIComponent(adminUser[1]);
    const index = users.findIndex((item) => item.id === id);
    if (index < 0) return sendJson(res, 404, { error: '用户不存在' });
    const [removed] = users.splice(index, 1);
    await revokeUserSessions(id);
    await sharedDelete(OTP_REGISTER_NAMESPACE, removed.email);
    persistUsers();
    securityLog('admin-user-deleted', req, { userId: id, email: maskEmail(removed.email) });
    return sendJson(res, 200, { ok: true, user: userForAdmin(removed) });
  }
  if (pathname === '/api/admin/preview' && method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, { html: render(String(body.content || '')) });
  }
  if (pathname === '/api/admin/posts' && (method === 'POST' || method === 'PUT')) {
    const body = await readBody(req);
    const slug = safeSlug(body.slug || body.title);
    if (!slug || !String(body.title || '').trim()) return sendJson(res, 400, { error: '标题和 slug 不能为空' });
    const content = String(body.content || '');
    if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) return sendJson(res, 413, { error: '文章正文不能超过 1 MB' });
    const existing = postsIndex.find((p) => p.slug === slug);
    const post = {
      slug, title: String(body.title).trim().slice(0, 120),
      excerpt: String(body.excerpt || '').trim().slice(0, 300),
      cover: String(body.cover || '/covers/theme.svg?v=g1'), date: String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      category: String(body.category || '未分类').trim().slice(0, 30),
      tags: Array.isArray(body.tags) ? body.tags.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 12) : String(body.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12),
      pinned: !!body.pinned, published: body.published !== false,
      minutes: Math.max(1, Number(body.minutes) || 5),
    };
    if (method === 'PUT' && !existing) return sendJson(res, 404, { error: '文章不存在' });
    if (method === 'POST' && existing) return sendJson(res, 409, { error: '文章路径已存在，请换一个 slug' });
    if (existing) Object.assign(existing, post); else postsIndex.push(post);
    postsIndex.sort((a, b) => (a.date < b.date ? 1 : -1));
    try {
      writeTextAtomic(path.join(CONTENT_DIR, slug + '.md'), content);
      contentCache.delete(slug); persistPosts();
    } catch (error) {
      console.error('[post-save]', error.message);
      return sendJson(res, 500, { error: '文章保存失败' });
    }
    return sendJson(res, 200, postMeta(post));
  }
  const adminPost = pathname.match(/^\/api\/admin\/posts\/([^/]+)$/);
  if (adminPost && method === 'DELETE') {
    const slug = decodeURIComponent(adminPost[1]); const idx = postsIndex.findIndex((p) => p.slug === slug);
    if (idx < 0) return sendJson(res, 404, { error: '文章不存在' });
    try {
      fs.unlinkSync(path.join(CONTENT_DIR, slug + '.md'));
    } catch (error) {
      if (error.code !== 'ENOENT') return sendJson(res, 500, { error: '文章正文删除失败' });
    }
    postsIndex.splice(idx, 1); persistPosts(); contentCache.delete(slug);
    return sendJson(res, 200, { ok: true });
  }
  const adminGb = pathname.match(/^\/api\/admin\/guestbook\/([^/]+)$/);
  if (adminGb && (method === 'PATCH' || method === 'DELETE')) {
    const id = decodeURIComponent(adminGb[1]);
    const entry = guestbook.find((item) => item.id === id);
    if (method === 'DELETE') {
      const before = guestbook.length; guestbook = guestbook.filter((x) => x.id !== id);
      if (before === guestbook.length) return sendJson(res, 404, { error: '留言不存在' });
      persistGuestbook(); return sendJson(res, 200, { ok: true });
    }
    if (!entry) return sendJson(res, 404, { error: '留言不存在' });
    const body = await readBody(req);
    const status = moderationStatus(body.status, '');
    if (!status) return sendJson(res, 400, { error: '审核状态无效' });
    entry.status = status;
    persistGuestbook();
    return sendJson(res, 200, { ok: true, status });
  }
  const adminComment = pathname.match(/^\/api\/admin\/comments\/([^/]+)$/);
  if (adminComment && (method === 'PATCH' || method === 'DELETE')) {
    const id = decodeURIComponent(adminComment[1]);
    const entry = comments.find((item) => item.id === id);
    if (method === 'PATCH') {
      if (!entry) return sendJson(res, 404, { error: '留言不存在' });
      const body = await readBody(req);
      const status = moderationStatus(body.status, '');
      if (!status) return sendJson(res, 400, { error: '审核状态无效' });
      entry.status = status;
      persistComments();
      return sendJson(res, 200, { ok: true, status });
    }
    const before = comments.length;
    comments = comments.filter((x) => x.id !== id);
    if (before === comments.length) return sendJson(res, 404, { error: '留言不存在' });
    persistComments(); return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/site' && method === 'GET') {
    return sendJson(res, 200, siteConfig);
  }

  if (pathname === '/api/posts' && method === 'GET') {
    const category = query.get('category');
    const tag = query.get('tag');
    let list = postsIndex.filter((p) => p.published !== false);
    if (category) list = list.filter((p) => p.category === category);
    if (tag) list = list.filter((p) => p.tags.includes(tag));
    return sendJson(res, 200, paginate(list.map(postMeta), query.get('page'), query.get('limit')));
  }

  if (pathname === '/api/posts/pinned' && method === 'GET') {
    return sendJson(res, 200, postsIndex.filter((p) => p.published !== false && p.pinned).map(postMeta));
  }

  const slugView = pathname.match(/^\/api\/posts\/([^/]+)\/(view|like)$/);
  if (slugView && method === 'POST') {
    const post = postsIndex.find((p) => p.published !== false && p.slug === decodeURIComponent(slugView[1]));
    if (!post) return sendJson(res, 404, { error: 'post not found' });
    if (slugView[2] === 'like') {
    const userId = await requireUser(req, res);
      if (!userId) return;
    if (rejectCsrf(req, res, await getUserCsrfToken(req))) return;
      const likedUsers = new Set(Array.isArray(state.likeUsers[post.slug]) ? state.likeUsers[post.slug] : []);
      if (likedUsers.has(userId)) {
        return sendJson(res, 409, {
          error: '你已经点过赞了', code: 'ALREADY_LIKED', slug: post.slug,
          views: state.views[post.slug] || 0, likes: state.likes[post.slug] || 0, liked: true,
        });
      }
      likedUsers.add(userId);
      state.likeUsers[post.slug] = [...likedUsers];
      state.likes[post.slug] = (state.likes[post.slug] || 0) + 1;
      persistState();
      return sendJson(res, 200, { slug: post.slug, views: state.views[post.slug] || 0, likes: state.likes[post.slug] || 0, liked: true });
    }
    const counted = await recordPostView(req, res, post, await getUserSession(req));
    return sendJson(res, 200, { slug: post.slug, views: state.views[post.slug] || 0, likes: state.likes[post.slug] || 0, counted });
  }

  if (pathname === '/api/journals' && method === 'GET') {
    const items = journals.slice()
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
      .map(journalForClient);
    return sendJson(res, 200, { items, total: journals.length });
  }

  const journalCommentRoute = pathname.match(/^\/api\/journals\/([^/]+)\/comments$/);
  if (journalCommentRoute && (method === 'GET' || method === 'POST')) {
    const id = decodeURIComponent(journalCommentRoute[1]);
    const journal = journals.find((item) => item.id === id);
    if (!journal) return sendJson(res, 404, { error: 'journal not found' });
    if (method === 'GET') {
      return sendJson(res, 200, { items: comments.filter((item) => item.journalId === id && isPublicEntry(item)).slice(-100).reverse().map(publicComment) });
    }
    const userId = await requireUser(req, res);
    if (!userId) return;
    if (rejectCsrf(req, res, await getUserCsrfToken(req))) return;
    if (await rejectAccountWhenLimited(req, res, 'journal-comments', userId, 5, 10 * 60 * 1000, '评论过于频繁')) return;
    const body = await readBody(req);
    if (await rejectCaptcha(req, res, body, 'journal-comment')) return;
    const message = String(body.message || '').trim().slice(0, 500);
    if (!message) return sendJson(res, 400, { error: '留言内容不能为空' });
    const entry = {
      id: randomId(), journalId: id, userId,
      name: getUserById(userId)?.username || '登录用户',
      message, avatar: Math.floor(Math.random() * 5), time: new Date().toISOString(), status: 'pending',
    };
    comments.push(entry);
    persistComments();
    return sendJson(res, 200, { ...publicComment(entry), pending: true });
  }

  const commentRoute = pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
  if (commentRoute && (method === 'GET' || method === 'POST')) {
    const slug = decodeURIComponent(commentRoute[1]);
    const post = postsIndex.find((p) => p.published !== false && p.slug === slug);
    if (!post) return sendJson(res, 404, { error: 'post not found' });
    if (method === 'GET') {
      return sendJson(res, 200, { items: comments.filter((item) => item.postSlug === slug && isPublicEntry(item)).slice(-100).reverse().map(publicComment) });
    }
    const userId = await requireUser(req, res);
    if (!userId) return;
    if (rejectCsrf(req, res, await getUserCsrfToken(req))) return;
    if (await rejectAccountWhenLimited(req, res, 'comments', userId, 5, 10 * 60 * 1000, '留言过于频繁')) return;
    const body = await readBody(req);
    if (await rejectCaptcha(req, res, body, 'comment')) return;
    const message = String(body.message || '').trim().slice(0, 500);
    if (!message) return sendJson(res, 400, { error: '留言内容不能为空' });
    const entry = {
      id: randomId(), postSlug: slug, userId,
      name: getUserById(userId)?.username || '登录用户',
      message, avatar: Math.floor(Math.random() * 5), time: new Date().toISOString(), status: 'pending',
    };
    comments.push(entry);
    persistComments();
    return sendJson(res, 200, { ...publicComment(entry), pending: true });
  }

  const slugMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (slugMatch && method === 'GET') {
    const post = postsIndex.find((p) => p.published !== false && p.slug === decodeURIComponent(slugMatch[1]));
    if (!post) return sendJson(res, 404, { error: 'post not found' });
    const md = getPostContent(post.slug) || '';
    const publicPosts = postsIndex.filter((p) => p.published !== false);
    const idx = publicPosts.indexOf(post);
    const userId = await getUserSession(req);
    const postComments = comments.filter((item) => item.postSlug === post.slug && isPublicEntry(item));
    await recordPostView(req, res, post, userId);
    return sendJson(res, 200, {
      ...postMeta(post),
      likedByViewer: Boolean(userId && Array.isArray(state.likeUsers[post.slug]) && state.likeUsers[post.slug].includes(userId)),
      comments: postComments.slice(-100).reverse().map(publicComment),
      commentCount: postComments.length,
      contentHtml: render(md),
      toc: buildToc(md),
      prev: publicPosts[idx + 1] ? { slug: publicPosts[idx + 1].slug, title: publicPosts[idx + 1].title } : null,
      next: publicPosts[idx - 1] ? { slug: publicPosts[idx - 1].slug, title: publicPosts[idx - 1].title } : null,
      related: postsIndex
        .filter((p) => p.published !== false && p.slug !== post.slug && (p.category === post.category || p.tags.some((t) => post.tags.includes(t))))
        .slice(0, 3)
        .map(postMeta),
    });
  }

  if (pathname === '/api/categories' && method === 'GET') {
    const map = {};
    for (const p of postsIndex.filter((x) => x.published !== false)) {
      map[p.category] = map[p.category] || { name: p.category, count: 0, posts: [] };
      map[p.category].count++;
      map[p.category].posts.push({ slug: p.slug, title: p.title, date: p.date });
    }
    return sendJson(res, 200, Object.values(map).sort((a, b) => b.count - a.count));
  }

  if (pathname === '/api/tags' && method === 'GET') {
    const map = {};
    for (const p of postsIndex.filter((x) => x.published !== false)) {
      for (const t of p.tags) {
        map[t] = map[t] || { name: t, count: 0, posts: [] };
        map[t].count++;
        map[t].posts.push({ slug: p.slug, title: p.title, date: p.date });
      }
    }
    return sendJson(res, 200, Object.values(map).sort((a, b) => b.count - a.count));
  }

  if (pathname === '/api/archives' && method === 'GET') {
    const map = {};
    for (const p of postsIndex.filter((x) => x.published !== false)) {
      const year = p.date.slice(0, 4);
      map[year] = map[year] || [];
      map[year].push({ slug: p.slug, title: p.title, date: p.date, category: p.category });
    }
    const years = Object.keys(map).sort((a, b) => b - a).map((y) => ({ year: y, count: map[y].length, posts: map[y] }));
    return sendJson(res, 200, { years, total: postsIndex.filter((p) => p.published !== false).length });
  }

  if (pathname === '/api/search' && method === 'GET') {
    const q = (query.get('q') || '').trim().toLowerCase();
    if (!q) return sendJson(res, 200, { q, items: [] });
    const items = postsIndex.filter((p) => p.published !== false).filter((p) => {
      const md = getPostContent(p.slug) || '';
      return (p.title + p.excerpt + p.category + p.tags.join(' ') + md).toLowerCase().includes(q);
    }).slice(0, 20).map(postMeta);
    return sendJson(res, 200, { q, items });
  }

  if (pathname === '/api/stats' && method === 'GET') {
    const published = postsIndex.filter((p) => p.published !== false);
    const topPosts = published.map(postMeta).sort((a, b) => (b.views - a.views) || (b.likes - a.likes)).slice(0, 8);
    return sendJson(res, 200, {
      posts: published.length,
      published: published.length,
      drafts: postsIndex.length - published.length,
      categories: new Set(published.map((p) => p.category)).size,
      tags: new Set(published.flatMap((p) => p.tags)).size,
      views: Object.values(state.views).reduce((a, b) => a + b, 0),
      likes: Object.values(state.likes).reduce((a, b) => a + b, 0),
      comments: guestbook.filter(isPublicEntry).length + comments.filter(isPublicEntry).length,
      journals: journals.length,
      users: users.length,
      topPosts,
      uptimeDays: Math.max(1, Math.floor((Date.now() - new Date('2024-03-01').getTime()) / 86400000)),
    });
  }

  if (pathname === '/api/guestbook' && method === 'GET') {
    const visibleGuestbook = guestbook.filter(isPublicEntry);
    return sendJson(res, 200, { items: visibleGuestbook.slice(-100).reverse().map(publicGuestbookEntry), total: visibleGuestbook.length });
  }

  if (pathname === '/api/guestbook' && method === 'POST') {
    const userId = await requireUser(req, res);
    if (!userId) return;
    if (rejectCsrf(req, res, await getUserCsrfToken(req))) return;
    if (await rejectAccountWhenLimited(req, res, 'guestbook', userId, 5, 10 * 60 * 1000, '留言过于频繁')) return;
    const body = await readBody(req);
    if (await rejectCaptcha(req, res, body, 'guestbook')) return;
    const name = getUserById(userId)?.username || '登录用户';
    const message = String(body.message || '').trim().slice(0, 500);
    if (!message) return sendJson(res, 400, { error: '留言内容不能为空' });
    const entry = {
      id: randomId(),
      userId,
      name, message,
      avatar: Math.floor(Math.random() * 5), status: 'pending',
      time: new Date().toISOString(),
    };
    guestbook.push(entry);
    persistGuestbook();
    return sendJson(res, 200, { ...publicGuestbookEntry(entry), pending: true });
  }

  return sendJson(res, 404, { error: 'api not found' });
}

/* ---------------- 静态文件 + SPA 回退 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(500); return res.end('error'); }
    const ext = path.extname(filePath).toLowerCase();
    const longCache = ['.png', '.jpg', '.woff2', '.woff', '.ttf'].includes(ext);
    res.writeHead(code, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    res.end(buf);
  });
}

function serveStatic(req, res, pathname) {
  if (/(^|\/)(?:\.env(?:\.[^/]*)?|data|logs|backups|\.git|node_modules|\.run)(?:\/|$)/i.test(pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    return res.end('Not Found');
  }
  if (pathname === '/favicon.ico') pathname = '/favicon.svg';
  let filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) { filePath = path.join(filePath, 'index.html'); stat = fs.statSync(filePath); }
    if (!err && stat.isFile()) return send(res, 200, filePath);

    // 无扩展名的干净路由 → SPA 回退；带扩展名的缺失资源 → 404
    if (!path.extname(pathname)) return send(res, 200, path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });
}

function scheduleAutomaticBackups() {
  if (!BACKUP_ENABLED) return;
  let backupRunning = false;
  const run = async () => {
    if (backupRunning) return;
    backupRunning = true;
    try { console.log(`[backup] 自动备份完成：${await createBackup()}`); }
    catch (error) { console.error('[backup] 自动备份失败：', error.message); }
    finally { backupRunning = false; }
  };
  void run();
  const timer = setInterval(run, BACKUP_INTERVAL_MS);
  timer.unref();
}

function nextHotTopicsDelay() {
  const now = Date.now();
  const today = shanghaiDateKey();
  const clock = `${String(HOT_TOPICS_REFRESH_HOUR).padStart(2, '0')}:${String(HOT_TOPICS_REFRESH_MINUTE).padStart(2, '0')}:00`;
  let target = Date.parse(`${today}T${clock}+08:00`);
  if (!Number.isFinite(target) || target <= now) {
    const tomorrow = new Date(`${today}T00:00:00+08:00`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    target = Date.parse(`${shanghaiDateKey(tomorrow)}T${clock}+08:00`);
  }
  return Math.max(1000, target - now);
}

function scheduleAutomaticHotTopics() {
  if (!HOT_TOPICS_ENABLED) return;
  const run = async () => {
    try { await refreshHotTopics(); }
    finally {
      const timer = setTimeout(run, nextHotTopicsDelay());
      timer.unref();
    }
  };
  void run();
}

/* ---------------- 服务器 ---------------- */

const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try {
    applySecurityHeaders(req, res);
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = decodeURIComponent(u.pathname);
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, u.searchParams);
    } else {
      if (pathname === '/admin' || pathname.startsWith('/admin/')) {
        if (!canAccessAdmin(req)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end('请先登录博主账号后再访问管理后台');
        }
      }
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error('[error]', pathname, err.message);
    if (!res.headersSent) sendJson(res, Number(err.statusCode) || 500, { error: err.statusCode ? err.message : 'internal error' });
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;

initSecurityStore().then((store) => {
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  🍃 叶语のBlog（玻璃质感版）已启动');
    console.log(`  🍃 http://localhost:${PORT}`);
    console.log(`  🍃 文章 ${postsIndex.length} 篇 · 留言 ${guestbook.length} 条`);
    console.log(`  🍃 数据库：SQLite ${databaseInfo.path}`);
    if (databaseInfo.migrated.length) console.log(`  🍃 已从 JSON 迁移：${databaseInfo.migrated.join('、')}`);
    const sharedStateLabel = store.redis ? 'Redis' : store.mode === 'memory-fallback' ? '单机内存（Redis 不可用）' : '单机内存（未配置 Redis）';
    console.log(`  🍃 共享状态：${sharedStateLabel}`);
    if (!process.env.ADMIN_PASSWORD) console.log(process.env.NODE_ENV === 'production' ? '  ⚠ 生产环境未配置 ADMIN_PASSWORD，后台登录已禁用' : '  ⚠ 当前使用开发默认密码 leaf-admin，部署前请设置 ADMIN_PASSWORD');
    scheduleAutomaticBackups();
    scheduleAutomaticHotTopics();
    console.log('');
  });
});
