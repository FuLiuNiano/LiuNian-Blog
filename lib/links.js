'use strict';

const dns = require('dns');
const net = require('net');

function configuredBlocklist() {
  return String(process.env.LINK_BLOCKLIST || '')
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

function privateIpv4(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && b >= 18 && b <= 19);
}

function privateIp(address) {
  const value = String(address || '').toLowerCase();
  if (net.isIP(value) === 4) return privateIpv4(value);
  if (net.isIP(value) !== 6) return true;
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
  if (value.startsWith('::ffff:')) return privateIpv4(value.slice(7));
  return false;
}

function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (['localhost', 'localhost.localdomain', 'broadcasthost', 'ip6-localhost'].includes(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;
  if (net.isIP(host) && privateIp(host)) return true;
  return configuredBlocklist().some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function normalizeResourceUrl(value, fallback = '') {
  const text = String(value || '').trim().slice(0, 1000);
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return fallback;
  if (/^\/(?!\/)/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || isBlockedHostname(url.hostname)) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

async function assertPublicExternalUrl(value) {
  const normalized = normalizeResourceUrl(value, '');
  if (!/^https:\/\//i.test(normalized)) throw new Error('只允许检查 HTTPS 外部地址');
  const url = new URL(normalized);
  if (isBlockedHostname(url.hostname)) throw new Error('地址指向被禁止的域名');
  const answers = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some((answer) => privateIp(answer.address))) throw new Error('地址解析到了内网或保留 IP');
  return normalized;
}

async function checkExternalUrl(value, timeoutMs = 8000) {
  const url = await assertPublicExternalUrl(value);
  const request = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        redirect: 'manual',
        headers: { 'User-Agent': 'LeafBlog-Link-Checker/1.0' },
        signal: controller.signal,
      });
      await response.body?.cancel();
      return response;
    } finally {
      clearTimeout(timer);
    }
  };

  let response = await request('HEAD');
  if (response.status === 405 || response.status === 501) response = await request('GET');
  const location = response.headers.get('location') || '';
  return {
    ok: response.status >= 200 && response.status < 400,
    status: response.status,
    location,
    url,
  };
}

module.exports = { checkExternalUrl, isBlockedHostname, normalizeResourceUrl, privateIp };
