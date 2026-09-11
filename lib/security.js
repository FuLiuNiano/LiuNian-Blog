'use strict';

const crypto = require('crypto');
const net = require('net');
const { createClient } = require('redis');

const sessions = new Map();
const userSessions = new Map();
const rateBuckets = new Map();
const cooldowns = new Map();
const sharedMemory = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEVICE_COOKIE_NAME = 'leaf_device';
const DEVICE_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

let redisClient = null;
let redisMode = 'memory';
let redisErrorLogged = false;

function redisIsReady() {
  return Boolean(redisClient && redisClient.isReady);
}

function disableRedis(error) {
  if (!redisErrorLogged) {
    console.error('[redis] 连接中断，暂时降级为单机内存状态：', error?.message || error);
    redisErrorLogged = true;
  }
  redisMode = 'memory-fallback';
  const client = redisClient;
  redisClient = null;
  try { client?.destroy(); } catch {}
}

async function initSecurityStore() {
  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) {
    redisMode = 'memory';
    return { mode: redisMode, redis: false };
  }
  try {
    const client = createClient({
      url,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: () => false,
      },
    });
    client.on('error', (error) => {
      if (!redisErrorLogged) console.error('[redis] 客户端错误：', error.message);
    });
    await client.connect();
    redisClient = client;
    redisMode = 'redis';
    redisErrorLogged = false;
    return { mode: redisMode, redis: true };
  } catch (error) {
    disableRedis(error);
    return { mode: redisMode, redis: false, error: error.message };
  }
}

function getSecurityStoreStatus() {
  return { mode: redisMode, redis: redisIsReady() };
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 40);
}

function sharedKey(namespace, identity) {
  return `leaf:${namespace}:${hash(identity)}`;
}

function memoryGet(key) {
  const item = sharedMemory.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    sharedMemory.delete(key);
    return undefined;
  }
  return item.value;
}

function memorySet(key, value, ttlMs) {
  sharedMemory.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
}

function memoryDelete(key) {
  sharedMemory.delete(key);
}

async function sharedGet(namespace, identity) {
  const key = sharedKey(namespace, identity);
  if (redisIsReady()) {
    try {
      const raw = await redisClient.get(key);
      if (raw === null) return undefined;
      return JSON.parse(raw);
    } catch (error) {
      disableRedis(error);
    }
  }
  return memoryGet(key);
}

async function sharedSet(namespace, identity, value, ttlMs) {
  const key = sharedKey(namespace, identity);
  memorySet(key, value, ttlMs);
  if (redisIsReady()) {
    try {
      await redisClient.setEx(key, Math.max(1, Math.ceil(ttlMs / 1000)), JSON.stringify(value));
      return;
    } catch (error) {
      disableRedis(error);
    }
  }
}

async function sharedDelete(namespace, identity) {
  const key = sharedKey(namespace, identity);
  memoryDelete(key);
  if (redisIsReady()) {
    try { await redisClient.del(key); }
    catch (error) { disableRedis(error); }
  }
}

async function sharedSetIfAbsent(namespace, identity, value, ttlMs) {
  const key = sharedKey(namespace, identity);
  if (redisIsReady()) {
    try {
      const result = await redisClient.set(key, JSON.stringify(value), {
        NX: true, EX: Math.max(1, Math.ceil(ttlMs / 1000)),
      });
      if (result !== 'OK') return false;
      memorySet(key, value, ttlMs);
      return true;
    } catch (error) {
      disableRedis(error);
    }
  }
  if (memoryGet(key) !== undefined) return false;
  memorySet(key, value, ttlMs);
  return true;
}

function clientKey(req) {
  const remote = String(req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  if (!/^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''))) return remote;
  const candidates = [
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    String(req.headers['x-real-ip'] || '').trim(),
  ];
  return candidates.find((value) => net.isIP(value)) || remote;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); }
    catch { cookies[part.slice(0, index).trim()] = ''; }
  }
  return cookies;
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  if (!current) return res.setHeader('Set-Cookie', cookie);
  res.setHeader('Set-Cookie', Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function deviceCookie(deviceId, secure = false) {
  return `${DEVICE_COOKIE_NAME}=${encodeURIComponent(deviceId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_COOKIE_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

function ensureDeviceId(req, res) {
  const current = parseCookies(req.headers.cookie)[DEVICE_COOKIE_NAME] || '';
  if (/^[A-Za-z0-9_-]{32,64}$/.test(current)) return current;
  const deviceId = crypto.randomBytes(24).toString('base64url');
  if (res) appendSetCookie(res, deviceCookie(deviceId, isSecureRequest(req)));
  return deviceId;
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie).admin_session || '';
}

function getUserSessionToken(req) {
  return parseCookies(req.headers.cookie).user_session || '';
}

function sessionKey(type, token) {
  return `leaf:session:${type}:${hash(token)}`;
}

function userSessionSetKey(userId) {
  return `leaf:user-sessions:${hash(userId)}`;
}

async function createSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const item = { expiresAt: Date.now() + SESSION_TTL_MS, csrfToken };
  sessions.set(token, item);
  await sharedSet('session:admin', token, item, SESSION_TTL_MS);
  return { token, csrfToken };
}

async function createUserSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const item = { userId: String(userId), expiresAt: Date.now() + SESSION_TTL_MS, csrfToken };
  userSessions.set(token, item);
  await sharedSet('session:user', token, item, SESSION_TTL_MS);
  if (redisIsReady()) {
    try {
      const setKey = userSessionSetKey(userId);
      await redisClient.sAdd(setKey, hash(token));
      await redisClient.expire(setKey, Math.ceil(SESSION_TTL_MS / 1000));
    } catch (error) { disableRedis(error); }
  }
  return { token, csrfToken };
}

async function hasValidSession(req) {
  const token = getSessionToken(req);
  const session = await sharedGet('session:admin', token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  sessions.set(token, session);
  return true;
}

async function getAdminCsrfToken(req) {
  const token = getSessionToken(req);
  const session = await sharedGet('session:admin', token);
  return session && session.expiresAt > Date.now() ? session.csrfToken : '';
}

async function revokeSession(req) {
  const token = getSessionToken(req);
  if (!token) return;
  sessions.delete(token);
  await sharedDelete('session:admin', token);
}

async function getUserSession(req) {
  const token = getUserSessionToken(req);
  const item = await sharedGet('session:user', token);
  if (!item || item.expiresAt <= Date.now()) {
    userSessions.delete(token);
    return null;
  }
  userSessions.set(token, item);
  return item.userId;
}

async function getUserCsrfToken(req) {
  const token = getUserSessionToken(req);
  const session = await sharedGet('session:user', token);
  return session && session.expiresAt > Date.now() ? session.csrfToken : '';
}

async function revokeUserSession(req) {
  const token = getUserSessionToken(req);
  if (!token) return;
  const item = userSessions.get(token) || await sharedGet('session:user', token);
  userSessions.delete(token);
  await sharedDelete('session:user', token);
  if (redisIsReady() && item?.userId) {
    try { await redisClient.sRem(userSessionSetKey(item.userId), hash(token)); }
    catch (error) { disableRedis(error); }
  }
}

async function revokeUserSessions(userId) {
  const wanted = String(userId);
  const localTokens = [];
  for (const [token, item] of userSessions) {
    if (item.userId === wanted) {
      localTokens.push(token);
      userSessions.delete(token);
      memoryDelete(sessionKey('user', token));
    }
  }
  if (redisIsReady()) {
    try {
      const setKey = userSessionSetKey(wanted);
      const members = new Set(await redisClient.sMembers(setKey));
      for (const token of localTokens) members.add(hash(token));
      if (members.size) await redisClient.del([...members].map((member) => `leaf:session:user:${member}`));
      await redisClient.del(setKey);
    } catch (error) { disableRedis(error); }
  }
}

function sessionCookie(token, secure = false) {
  return `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie(secure = false) {
  return `admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

function userSessionCookie(token, secure = false) {
  return `user_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}

function clearUserSessionCookie(secure = false) {
  return `user_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  if (!/^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ''))) return false;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function isSameOriginRequest(req) {
  const source = String(req.headers.origin || req.headers.referer || '').trim();
  if (!source) return true;
  try {
    const sourceUrl = new URL(source);
    const expectedHost = String(req.headers.host || '').trim().toLowerCase();
    const expectedProtocol = isSecureRequest(req) ? 'https:' : 'http:';
    return sourceUrl.host.toLowerCase() === expectedHost && sourceUrl.protocol === expectedProtocol;
  } catch { return false; }
}

function verifyCsrfToken(req, expected) {
  const supplied = String(req.headers['x-csrf-token'] || '');
  return Boolean(expected && supplied && safeEqual(supplied, expected));
}

function memoryAllowRateKey(scope, identity, limit, windowMs) {
  const key = `${scope}:${String(identity || 'unknown')}`;
  const now = Date.now();
  const cooldown = cooldowns.get(key);
  if (cooldown && cooldown.until > now) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((cooldown.until - now) / 1000)), cooldown: true };
  }
  if (cooldown && now - cooldown.lastViolationAt > DAY_MS) cooldowns.delete(key);

  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count++;
  rateBuckets.set(key, bucket);

  let penalty = null;
  if (bucket.count === limit + 1) {
    const previous = cooldowns.get(key);
    const strikes = previous && now - previous.lastViolationAt <= DAY_MS ? previous.strikes + 1 : 1;
    const seconds = strikes >= 3 ? 60 * 60 : strikes === 2 ? 10 * 60 : 60;
    penalty = { strikes, lastViolationAt: now, until: now + seconds * 1000 };
    cooldowns.set(key, penalty);
  }

  if (rateBuckets.size > 10000) {
    for (const [name, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(name);
  }
  if (cooldowns.size > 10000) {
    for (const [name, value] of cooldowns) if (value.until <= now && now - value.lastViolationAt > DAY_MS) cooldowns.delete(name);
  }

  if (bucket.count <= limit) return { ok: true, retryAfter: 0 };
  return {
    ok: false,
    retryAfter: Math.max(1, Math.ceil((Math.max(bucket.resetAt, penalty?.until || 0) - now) / 1000)),
    cooldown: Boolean(penalty),
  };
}

async function redisAllowRateKey(scope, identity, limit, windowMs) {
  const rateKey = sharedKey(`rate:${scope}`, identity);
  const cooldownKey = sharedKey(`cooldown:${scope}`, identity);
  const now = Date.now();
  const rawCooldown = await redisClient.get(cooldownKey);
  let cooldown = rawCooldown ? JSON.parse(rawCooldown) : null;
  if (cooldown && cooldown.until > now) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((cooldown.until - now) / 1000)), cooldown: true };
  }
  if (cooldown && now - cooldown.lastViolationAt > DAY_MS) {
    cooldown = null;
    await redisClient.del(cooldownKey);
  }

  const count = Number(await redisClient.eval(RATE_SCRIPT, {
    keys: [rateKey], arguments: [String(Math.max(1, windowMs))],
  }));
  if (count <= limit) return { ok: true, retryAfter: 0 };

  let penalty = null;
  if (count === limit + 1) {
    const strikes = cooldown && now - cooldown.lastViolationAt <= DAY_MS ? cooldown.strikes + 1 : 1;
    const seconds = strikes >= 3 ? 60 * 60 : strikes === 2 ? 10 * 60 : 60;
    penalty = { strikes, lastViolationAt: now, until: now + seconds * 1000 };
    await redisClient.setEx(cooldownKey, 24 * 60 * 60, JSON.stringify(penalty));
  }
  const ttlMs = Number(await redisClient.pTTL(rateKey));
  return {
    ok: false,
    retryAfter: Math.max(1, Math.ceil((Math.max(now + Math.max(0, ttlMs), penalty?.until || 0) - now) / 1000)),
    cooldown: Boolean(penalty),
  };
}

async function allowRateKey(scope, identity, limit, windowMs) {
  if (redisIsReady()) {
    try { return await redisAllowRateKey(scope, identity, limit, windowMs); }
    catch (error) {
      disableRedis(error);
    }
  }
  return memoryAllowRateKey(scope, identity, limit, windowMs);
}

async function allowRate(req, scope, limit, windowMs) {
  return allowRateKey(scope, clientKey(req), limit, windowMs);
}

function randomId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  SESSION_TTL_MS,
  allowRate,
  allowRateKey,
  appendSetCookie,
  clearSessionCookie,
  clearUserSessionCookie,
  clientKey,
  createSession,
  createUserSession,
  ensureDeviceId,
  getAdminCsrfToken,
  getSecurityStoreStatus,
  getUserSession,
  getUserCsrfToken,
  hasValidSession,
  initSecurityStore,
  isSameOriginRequest,
  isSecureRequest,
  randomId,
  revokeSession,
  revokeUserSession,
  revokeUserSessions,
  safeEqual,
  sessionCookie,
  sharedDelete,
  sharedGet,
  sharedSet,
  sharedSetIfAbsent,
  userSessionCookie,
  verifyCsrfToken,
};
