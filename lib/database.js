'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DOCUMENTS = [
  ['site', 'site.json'],
  ['posts', 'posts.json'],
  ['state', 'state.json'],
  ['guestbook', 'guestbook.json'],
  ['comments', 'comments.json'],
  ['journals', 'journals.json'],
  ['users', 'users.json'],
];

let database = null;
let databasePath = '';

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`[database] 无法读取旧 JSON：${filePath}`, error.message);
    return undefined;
  }
}

function initDatabase({ dataDir }) {
  if (database) return { db: database, path: databasePath, migrated: [] };

  const configuredPath = String(process.env.DB_PATH || '').trim();
  databasePath = path.resolve(configuredPath || path.join(dataDir, 'leaf-blog.db'));
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_documents (
      name TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const findDocument = database.prepare('SELECT 1 FROM app_documents WHERE name = ?');
  const insertDocument = database.prepare(
    'INSERT INTO app_documents (name, data, updated_at) VALUES (?, ?, ?)',
  );
  const migrated = [];
  const migrate = database.transaction(() => {
    for (const [name, fileName] of DOCUMENTS) {
      if (findDocument.get(name)) continue;
      const value = readJsonFile(path.join(dataDir, fileName));
      if (value === undefined) continue;
      insertDocument.run(name, JSON.stringify(value), new Date().toISOString());
      migrated.push(name);
    }
  });
  migrate();

  if (migrated.length) {
    database.prepare(
      'INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)',
    ).run('migration:json-to-sqlite-v1', JSON.stringify(migrated), new Date().toISOString());
  }

  return { db: database, path: databasePath, migrated };
}

function read(name, fallback) {
  if (!database) throw new Error('SQLite 尚未初始化');
  const row = database.prepare('SELECT data FROM app_documents WHERE name = ?').get(name);
  if (!row) return fallback;
  try {
    return JSON.parse(row.data);
  } catch (error) {
    console.error(`[database] 文档 ${name} 内容损坏，使用内存默认值：`, error.message);
    return fallback;
  }
}

function write(name, value) {
  if (!database) throw new Error('SQLite 尚未初始化');
  const data = JSON.stringify(value);
  database.prepare(`
    INSERT INTO app_documents (name, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(name, data, new Date().toISOString());
}

async function backupDatabase(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) return false;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destinationPath);
  } finally {
    source.close();
  }
  return true;
}

function getDatabasePath() {
  return databasePath;
}

module.exports = { backupDatabase, getDatabasePath, initDatabase, read, write };
