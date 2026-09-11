'use strict';

const fs = require('fs');

const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 15 * 1000;

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function acquireLock(filePath) {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  let handle = null;
  while (!handle) {
    try {
      handle = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(handle, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
      return { handle, lockPath };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) fs.rmSync(lockPath, { force: true });
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`等待文件锁超时：${filePath}`);
      }
      sleepSync(LOCK_WAIT_MS);
    }
  }
}

function releaseLock(lock) {
  try { fs.closeSync(lock.handle); } catch {}
  try { fs.rmSync(lock.lockPath, { force: true }); } catch {}
}

function tempName(filePath) {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}

function replaceFile(tempPath, filePath) {
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

function writeTextAtomic(filePath, text) {
  const lock = acquireLock(filePath);
  const tempPath = tempName(filePath);
  try {
    fs.writeFileSync(tempPath, String(text), 'utf8');
    replaceFile(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  } finally {
    releaseLock(lock);
  }
}

function writeJsonAtomic(filePath, value) {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

module.exports = { writeJsonAtomic, writeTextAtomic };
