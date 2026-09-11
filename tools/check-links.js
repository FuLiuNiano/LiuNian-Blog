'use strict';

const fs = require('fs');
const path = require('path');
const { checkExternalUrl, normalizeResourceUrl } = require('../lib/links');
const { initDatabase, read } = require('../lib/database');

const appRoot = path.resolve(__dirname, '..');
const dataDir = path.join(appRoot, 'data');

function loadEnvFile() {
  try {
    const text = fs.readFileSync(path.join(appRoot, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function collectResources(site) {
  const resources = [];
  const seen = new Set();
  const add = (type, label, value) => {
    const url = normalizeResourceUrl(value, '');
    if (!/^https:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    resources.push({ type, label, url });
  };
  add('站点', 'GitHub', site.github);
  add('背景图', '首页主图', site.heroImage);
  for (const [index, item] of (Array.isArray(site.heroImages) ? site.heroImages : []).entries()) {
    if (item?.enabled !== false) add('背景图', item.label || `轮换图 ${index + 1}`, item.url);
  }
  add('音乐', site.musicTitle || '背景音乐', site.musicUrl);
  add('二维码', '打赏二维码', site.donationQr);
  for (const [index, item] of (Array.isArray(site.friendLinks) ? site.friendLinks : []).entries()) {
    add('友链', item.name || `友情链接 ${index + 1}`, item.url);
  }
  return resources;
}

async function main() {
  loadEnvFile();
  initDatabase({ dataDir });
  const site = read('site', {});
  const resources = collectResources(site);
  if (!resources.length) {
    console.log('没有需要检查的 HTTPS 外部资源；本站路径不需要网络检查。');
    return;
  }

  console.log(`开始检查 ${resources.length} 个 HTTPS 外部资源（不跟随跳转）...`);
  let failures = 0;
  for (const resource of resources) {
    try {
      const result = await checkExternalUrl(resource.url);
      const redirect = result.location ? ` -> ${result.location}` : '';
      console.log(`${result.ok ? '✓' : '✗'} [${resource.type}] ${resource.label}: HTTP ${result.status}${redirect}`);
      if (!result.ok) failures++;
    } catch (error) {
      failures++;
      console.log(`✗ [${resource.type}] ${resource.label}: ${error.message}`);
    }
  }
  if (failures) {
    console.error(`检查完成：${failures} 个资源需要处理。`);
    process.exitCode = 1;
  } else {
    console.log('检查完成：所有外部资源均可访问。');
  }
}

main().catch((error) => {
  console.error(`检查失败：${error.message}`);
  process.exitCode = 1;
});
