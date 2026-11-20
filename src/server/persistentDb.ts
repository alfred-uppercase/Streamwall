import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createAdminClient, isSupabaseEnabled } from './supabaseAdapter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', '..', '.data');
export const SQLITE_FILE = path.join(DATA_DIR, 'tapenaka.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new DatabaseSync(SQLITE_FILE);

sqlite.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS kv_modules (
    module_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS broken_reports (
    id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_title TEXT NOT NULL,
    season INTEGER,
    episode INTEGER,
    reason TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    user_id TEXT,
    username TEXT NOT NULL DEFAULT 'Visiteur',
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_broken_reports_status_created
    ON broken_reports (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS content_requests (
    id TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    title TEXT NOT NULL,
    year INTEGER,
    tmdb_id TEXT,
    tmdb_poster_url TEXT,
    tmdb_overview TEXT,
    note TEXT NOT NULL DEFAULT '',
    user_id TEXT,
    username TEXT NOT NULL DEFAULT 'Visiteur',
    votes INTEGER NOT NULL DEFAULT 1,
    voter_keys TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT NOT NULL DEFAULT '',
    resolved_item_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_content_requests_status_votes
    ON content_requests (status, votes DESC, created_at DESC);
`);

const selectModuleStmt = sqlite.prepare(
  'SELECT payload FROM kv_modules WHERE module_key = ?'
);
const upsertModuleStmt = sqlite.prepare(`
  INSERT INTO kv_modules (module_key, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(module_key) DO UPDATE SET
    payload = excluded.payload,
    updated_at = excluded.updated_at
`);
const listModulesStmt = sqlite.prepare(
  'SELECT module_key, updated_at FROM kv_modules ORDER BY module_key ASC'
);

const pendingSupabaseSync = new Map<string, NodeJS.Timeout>();

function scheduleSupabaseMirror(moduleKey: string, payload: string): void {
  if (!isSupabaseEnabled()) return;
  const admin = createAdminClient();
  if (!admin) return;

  const existingTimer = pendingSupabaseSync.get(moduleKey);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    pendingSupabaseSync.delete(moduleKey);
    void (async () => {
      try {
        await admin.from('app_settings').upsert(
          {
            key: `tapenaka_module_${moduleKey}`,
            value: payload,
          },
          { onConflict: 'key' }
        );
      } catch {
        // Ignore transient remote sync failure
      }
    })();
  }, 1500);

  pendingSupabaseSync.set(moduleKey, timer);
}

export function getSqliteDb(): DatabaseSync {
  return sqlite;
}

export function readModuleSnapshot<T>(
  moduleKey: string,
  legacyJsonPath?: string | null
): T | null {
  try {
    const row = selectModuleStmt.get(moduleKey) as { payload?: string } | undefined;
    if (row && typeof row.payload === 'string') {
      return JSON.parse(row.payload) as T;
    }
  } catch {
    // Fall back to legacy file if SQLite row corrupted
  }

  if (legacyJsonPath && fs.existsSync(legacyJsonPath)) {
    try {
      const raw = fs.readFileSync(legacyJsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as T;
      upsertModuleStmt.run(moduleKey, JSON.stringify(parsed), new Date().toISOString());
      return parsed;
    } catch {
      // Ignore corrupt legacy JSON
    }
  }

  return null;
}

export function writeModuleSnapshot<T>(moduleKey: string, value: T): void {
  try {
    const payload = JSON.stringify(value);
    const now = new Date().toISOString();
    upsertModuleStmt.run(moduleKey, payload, now);
    scheduleSupabaseMirror(moduleKey, payload);
  } catch {
    // Non-fatal
  }
}

export async function hydrateModulesFromSupabase(): Promise<void> {
  if (!isSupabaseEnabled()) return;
  const admin = createAdminClient();
  if (!admin) return;
  try {
    const { data, error } = await admin
      .from('app_settings')
      .select('key,value')
      .like('key', 'tapenaka_module_%');
    if (error || !Array.isArray(data)) return;
    for (const row of data as { key: string; value: string }[]) {
      const moduleKey = row.key.replace(/^tapenaka_module_/, '');
      if (!moduleKey || typeof row.value !== 'string') continue;
      const local = selectModuleStmt.get(moduleKey) as { payload?: string } | undefined;
      if (!local?.payload) {
        upsertModuleStmt.run(moduleKey, row.value, new Date().toISOString());
      }
    }
  } catch {
    // Ignore remote hydration failures silently
  }
}

export function getPersistenceSummary(): {
  engine: 'sqlite';
  file: string;
  supabaseMirror: boolean;
  modules: { key: string; updatedAt: string }[];
} {
  const rows = listModulesStmt.all() as { module_key: string; updated_at: string }[];
  return {
    engine: 'sqlite',
    file: '.data/tapenaka.sqlite',
    supabaseMirror: Boolean(isSupabaseEnabled() && createAdminClient()),
    modules: rows.map((r) => ({ key: r.module_key, updatedAt: r.updated_at })),
  };
}
