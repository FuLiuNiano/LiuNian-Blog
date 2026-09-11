'use strict';

const fs = require('fs');
const path = require('path');
const { backupDatabase } = require('../lib/database');

const appRoot = path.resolve(__dirname, '..');
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
loadEnvFile();
const backupRoot = path.resolve(process.env.BACKUP_DIR || path.join(appRoot, 'backups'));
const keep = Math.min(Math.max(Number(process.env.BACKUP_KEEP || 7) || 7, 1), 365);

async function createBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `leaf-blog-${stamp}`;
  const destination = path.join(backupRoot, backupName);

  if (backupRoot === appRoot || backupRoot === path.parse(backupRoot).root) {
    throw new Error('BACKUP_DIR 不能是项目根目录或磁盘根目录');
  }

  fs.mkdirSync(destination, { recursive: true });
  for (const relative of ['data', 'public/music', 'public/uploads']) {
    const source = path.join(appRoot, relative);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(destination, relative), {
      recursive: true,
      errorOnExist: true,
      filter: (item) => {
        const name = path.basename(item);
        return !/\.(?:lock|tmp)$/i.test(name) && !/^leaf-blog\.db(?:-(?:wal|shm))?$/i.test(name);
      },
    });
  }

  const dbPath = path.resolve(process.env.DB_PATH || path.join(appRoot, 'data', 'leaf-blog.db'));
  await backupDatabase(dbPath, path.join(destination, 'data', 'leaf-blog.db'));

  const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('leaf-blog-'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of backups.slice(keep)) {
    const target = path.resolve(backupRoot, name);
    if (path.dirname(target) === backupRoot && path.basename(target).startsWith('leaf-blog-')) {
      fs.rmSync(target, { recursive: true, force: false });
    }
  }

  return destination;
}

if (require.main === module) {
  createBackup()
    .then((destination) => console.log(`备份完成：${destination}`))
    .catch((error) => {
      console.error(`备份失败：${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { createBackup };
