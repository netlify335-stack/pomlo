import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let db = null;
let dataDirPath = '';

export function initDatabase(dataDir) {
  dataDirPath = dataDir;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'pomelo.sqlite');
  const projectDataDir = path.join(process.cwd(), 'data');
  if (path.resolve(dataDir) !== path.resolve(projectDataDir) && fs.existsSync(projectDataDir)) {
    try {
      const srcDb = path.join(projectDataDir, 'pomelo.sqlite');
      if (!fs.existsSync(dbPath) && fs.existsSync(srcDb)) {
        fs.copyFileSync(srcDb, dbPath);
      }
    } catch { /* ignore */ }
  }

  db = new DatabaseSync(dbPath);

  // Performance Pragmas
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -64000;
  `);

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_docs_col ON documents(collection);
    CREATE INDEX IF NOT EXISTS idx_docs_col_time ON documents(collection, updated_at);

    CREATE TABLE IF NOT EXISTS key_value (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (namespace, key)
    );

    CREATE TABLE IF NOT EXISTS trash (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      trashed_at TEXT NOT NULL
    );
  `);

  // Initial migration check: if SQLite is empty, migrate from existing JSON files
  migrateFromJsonIfEmpty();

  return db;
}

function migrateFromJsonIfEmpty() {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM documents').get();
  if (countRow && countRow.count > 0) {
    return; // Already populated
  }

  console.log('⚡ Migrating existing JSON data into SQLite (pomelo.sqlite)...');
  const collections = ['bills', 'clients', 'templates', 'products', 'expenses', 'recurring', 'receipts', 'profiles', 'purchases'];
  const insertDoc = db.prepare(`
    INSERT OR REPLACE INTO documents (collection, id, data, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const col of collections) {
    const dir = path.join(dataDirPath, col);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          const parsed = JSON.parse(content);
          const id = parsed.id || path.basename(file, '.json');
          insertDoc.run(col, String(id), content, new Date().toISOString());
        } catch { /* skip corrupted file */ }
      }
    }
  }

  // Migrate meta.json
  const metaPath = path.join(dataDirPath, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      setAllMeta(meta);
    } catch { /* ignore */ }
  }

  // Migrate profile.json
  const profilePath = path.join(dataDirPath, 'profile.json');
  if (fs.existsSync(profilePath)) {
    try {
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      setProfile(profile);
    } catch { /* ignore */ }
  }

  // Migrate local-prefs.json
  const prefsPath = path.join(dataDirPath, 'local-prefs.json');
  if (fs.existsSync(prefsPath)) {
    try {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      if (prefs.value && typeof prefs.value === 'object') {
        setLocalPrefs(prefs.value, []);
      }
    } catch { /* ignore */ }
  }

  // Migrate trash
  const trashDir = path.join(dataDirPath, 'trash');
  if (fs.existsSync(trashDir)) {
    const files = fs.readdirSync(trashDir).filter(f => f.endsWith('.json'));
    const insertTrash = db.prepare('INSERT OR REPLACE INTO trash (id, data, trashed_at) VALUES (?, ?, ?)');
    for (const file of files) {
      try {
        const p = path.join(trashDir, file);
        const content = fs.readFileSync(p, 'utf-8');
        const stat = fs.statSync(p);
        const id = path.basename(file, '.json');
        insertTrash.run(id, content, stat.mtime.toISOString());
      } catch { /* ignore */ }
    }
  }

  console.log('✅ SQLite initial migration complete.');
}

// Documents CRUD
export function getAll(collection) {
  const stmt = db.prepare('SELECT data FROM documents WHERE collection = ?');
  const rows = stmt.all(collection);
  const results = [];
  for (const r of rows) {
    try { results.push(JSON.parse(r.data)); } catch { /* ignore parse error */ }
  }
  return results;
}

export function getOne(collection, id) {
  const stmt = db.prepare('SELECT data FROM documents WHERE collection = ? AND id = ?');
  const row = stmt.get(collection, String(id));
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

export function setOne(collection, id, data) {
  const idStr = String(id || data?.id);
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
  const stmt = db.prepare(`
    INSERT INTO documents (collection, id, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(collection, id) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `);
  stmt.run(collection, idStr, jsonStr, new Date().toISOString());

  // Also write to data/ directory for optional filesystem/manual file sync
  try {
    const colDir = path.join(dataDirPath, collection);
    if (!fs.existsSync(colDir)) fs.mkdirSync(colDir, { recursive: true });
    const safeName = idStr.replace(/[/\\:*?"<>|]/g, '_');
    const fPath = path.join(colDir, safeName + '.json');
    fs.writeFileSync(fPath, jsonStr, 'utf-8');
  } catch { /* ignore file mirror errors */ }
}

export function deleteOne(collection, id) {
  const idStr = String(id);
  const stmt = db.prepare('DELETE FROM documents WHERE collection = ? AND id = ?');
  stmt.run(collection, idStr);

  try {
    const safeName = idStr.replace(/[/\\:*?"<>|]/g, '_');
    const fPath = path.join(dataDirPath, collection, safeName + '.json');
    if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
  } catch { /* ignore */ }
}

export function exists(collection, id) {
  const stmt = db.prepare('SELECT 1 FROM documents WHERE collection = ? AND id = ? LIMIT 1');
  return !!stmt.get(collection, String(id));
}

// Meta Key-Value
export function getMeta(key) {
  const stmt = db.prepare("SELECT value FROM key_value WHERE namespace = 'meta' AND key = ?");
  const row = stmt.get(String(key));
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setMeta(key, value) {
  const valStr = JSON.stringify(value);
  const stmt = db.prepare(`
    INSERT INTO key_value (namespace, key, value)
    VALUES ('meta', ?, ?)
    ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(String(key), valStr);
}

export function getAllMeta() {
  const stmt = db.prepare("SELECT key, value FROM key_value WHERE namespace = 'meta'");
  const rows = stmt.all();
  const res = {};
  for (const r of rows) {
    try { res[r.key] = JSON.parse(r.value); } catch { res[r.key] = r.value; }
  }
  return res;
}

export function setAllMeta(metaObj) {
  if (!metaObj || typeof metaObj !== 'object') return;
  const stmt = db.prepare(`
    INSERT INTO key_value (namespace, key, value)
    VALUES ('meta', ?, ?)
    ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value
  `);
  for (const [k, v] of Object.entries(metaObj)) {
    stmt.run(String(k), JSON.stringify(v));
  }
}

// Profile
const DEFAULT_PROFILE = {
  businessName: '', address: '', state: '', gstin: '', pan: '',
  email: '', phone: '', bankName: '', accountNumber: '', ifsc: '',
  logo: '', signature: '', upiId: '', googleClientId: '', googleDriveFolder: 'Pomelo Invoices',
};

export function getProfile() {
  const stmt = db.prepare("SELECT value FROM key_value WHERE namespace = 'profile' AND key = 'current'");
  const row = stmt.get();
  if (!row) return DEFAULT_PROFILE;
  try { return { ...DEFAULT_PROFILE, ...JSON.parse(row.value) }; } catch { return DEFAULT_PROFILE; }
}

export function setProfile(profileObj) {
  const valStr = JSON.stringify(profileObj || DEFAULT_PROFILE);
  const stmt = db.prepare(`
    INSERT INTO key_value (namespace, key, value)
    VALUES ('profile', 'current', ?)
    ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(valStr);

  try {
    fs.writeFileSync(path.join(dataDirPath, 'profile.json'), valStr, 'utf-8');
  } catch { /* ignore */ }
}

// Local Prefs
export function getLocalPrefs() {
  const stmt = db.prepare("SELECT key, value FROM key_value WHERE namespace = 'local_prefs'");
  const rows = stmt.all();
  const value = {};
  for (const r of rows) {
    value[r.key] = r.value;
  }
  return value;
}

export function setLocalPrefs(setObj = {}, removeKeys = []) {
  const insertStmt = db.prepare(`
    INSERT INTO key_value (namespace, key, value)
    VALUES ('local_prefs', ?, ?)
    ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value
  `);
  const delStmt = db.prepare("DELETE FROM key_value WHERE namespace = 'local_prefs' AND key = ?");

  for (const [k, v] of Object.entries(setObj)) {
    insertStmt.run(String(k), String(v));
  }
  for (const k of removeKeys) {
    delStmt.run(String(k));
  }
}

// Trash
export function getTrash() {
  const stmt = db.prepare('SELECT id, data, trashed_at FROM trash');
  const rows = stmt.all();
  const results = [];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.data);
      results.push({ ...parsed, _trashedAt: r.trashed_at });
    } catch { /* ignore */ }
  }
  return results;
}

export function moveToTrash(billId) {
  const idStr = String(billId);
  const bill = getOne('bills', idStr);
  if (!bill) return false;

  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO trash (id, data, trashed_at) VALUES (?, ?, ?)').run(idStr, JSON.stringify(bill), now);
  deleteOne('bills', idStr);
  return true;
}

export function restoreFromTrash(billId) {
  const idStr = String(billId);
  const row = db.prepare('SELECT data FROM trash WHERE id = ?').get(idStr);
  if (!row) return null;

  if (exists('bills', idStr)) {
    return 'conflict';
  }

  const bill = JSON.parse(row.data);
  setOne('bills', idStr, bill);
  db.prepare('DELETE FROM trash WHERE id = ?').run(idStr);
  return true;
}

export function deleteFromTrash(billId) {
  db.prepare('DELETE FROM trash WHERE id = ?').run(String(billId));
}

export function purgeOldTrash(thirtyDaysAgoIso) {
  db.prepare('DELETE FROM trash WHERE trashed_at < ?').run(thirtyDaysAgoIso);
}

// Database stats for health check
export function getDatabaseStats() {
  try {
    const docCount = db.prepare('SELECT COUNT(*) as c FROM documents').get()?.c || 0;
    const billCount = db.prepare("SELECT COUNT(*) as c FROM documents WHERE collection = 'bills'").get()?.c || 0;
    const clientCount = db.prepare("SELECT COUNT(*) as c FROM documents WHERE collection = 'clients'").get()?.c || 0;
    const productCount = db.prepare("SELECT COUNT(*) as c FROM documents WHERE collection = 'products'").get()?.c || 0;
    const dbPath = path.join(dataDirPath, 'pomelo.sqlite');
    const sizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    return {
      type: 'sqlite',
      version: '3.x (node:sqlite)',
      databaseFile: 'data/pomelo.sqlite',
      sizeBytes,
      totalDocuments: docCount,
      bills: billCount,
      clients: clientCount,
      products: productCount,
    };
  } catch {
    return { type: 'sqlite', status: 'ready' };
  }
}
