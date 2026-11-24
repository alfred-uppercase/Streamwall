import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from '../shared/types.ts';
import { InFlightCoalescer, TimedLruCache } from './cacheUtils.ts';
import { getSqliteDb } from './persistentDb.ts';
import { createAnonClient, createUserClient, sbResolveUser } from './supabaseAdapter.ts';

export const SESSION_TTL_MS = 35 * 86_400_000; // 35 days (> 1 month)
const SLIDE_INTERVAL_MS = 3_600_000; // Refresh last_seen / expires_at in SQLite at most once/hour
const SESSION_CACHE_TTL_MS = 20_000;

export interface PersistentSessionRecord {
  token: string;
  userId: string;
  provider: 'local' | 'supabase';
  sbAccessToken: string | null;
  sbRefreshToken: string | null;
  sbExpiresAt: number | null;
  userSnapshot: UserProfile | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: number;
}

const sqlite = getSqliteDb();

const selectSessionStmt = sqlite.prepare(`
  SELECT token, user_id, provider, sb_access_token, sb_refresh_token, sb_expires_at,
         user_json, created_at, last_seen_at, expires_at
  FROM user_sessions
  WHERE token = ?
`);

const upsertSessionStmt = sqlite.prepare(`
  INSERT INTO user_sessions (
    token, user_id, provider, sb_access_token, sb_refresh_token, sb_expires_at,
    user_json, created_at, last_seen_at, expires_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(token) DO UPDATE SET
    user_id = excluded.user_id,
    provider = excluded.provider,
    sb_access_token = excluded.sb_access_token,
    sb_refresh_token = excluded.sb_refresh_token,
    sb_expires_at = excluded.sb_expires_at,
    user_json = excluded.user_json,
    last_seen_at = excluded.last_seen_at,
    expires_at = excluded.expires_at
`);

const touchSessionStmt = sqlite.prepare(`
  UPDATE user_sessions
  SET last_seen_at = ?, expires_at = ?
  WHERE token = ?
`);

const deleteSessionStmt = sqlite.prepare('DELETE FROM user_sessions WHERE token = ?');
const deleteUserSessionsStmt = sqlite.prepare('DELETE FROM user_sessions WHERE user_id = ?');
const purgeExpiredSessionsStmt = sqlite.prepare('DELETE FROM user_sessions WHERE expires_at <= ?');
const countActiveSessionUsersStmt = sqlite.prepare(`
  SELECT COUNT(DISTINCT user_id) AS cnt
  FROM user_sessions
  WHERE expires_at > ?
`);

const sessionMemCache = new TimedLruCache<PersistentSessionRecord>(2_000);
const refreshCoalescer = new InFlightCoalescer();

function parseUserJson(raw: string | null): UserProfile | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function generateSessionToken(): string {
  return `sws_${crypto.randomBytes(24).toString('hex')}`;
}

export function createPersistentSession(params: {
  userId: string;
  provider: 'local' | 'supabase';
  sbAccessToken?: string | null;
  sbRefreshToken?: string | null;
  sbExpiresAtMs?: number | null;
  userSnapshot?: UserProfile | null;
  token?: string;
}): PersistentSessionRecord {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const token = params.token || generateSessionToken();
  const record: PersistentSessionRecord = {
    token,
    userId: params.userId,
    provider: params.provider,
    sbAccessToken: params.sbAccessToken ?? null,
    sbRefreshToken: params.sbRefreshToken ?? null,
    sbExpiresAt: params.sbExpiresAtMs ?? null,
    userSnapshot: params.userSnapshot ?? null,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    expiresAt: nowMs + SESSION_TTL_MS,
  };

  upsertSessionStmt.run(
    record.token,
    record.userId,
    record.provider,
    record.sbAccessToken,
    record.sbRefreshToken,
    record.sbExpiresAt,
    record.userSnapshot ? JSON.stringify(record.userSnapshot) : null,
    record.createdAt,
    record.lastSeenAt,
    record.expiresAt
  );
  sessionMemCache.set(token, record, SESSION_CACHE_TTL_MS, SESSION_CACHE_TTL_MS * 2);
  return record;
}

export function getPersistentSession(token: string): PersistentSessionRecord | null {
  if (!token) return null;
  const cached = sessionMemCache.get(token);
  const now = Date.now();
  if (cached) {
    if (cached.expiresAt <= now) {
      deletePersistentSession(token);
      return null;
    }
    maybeSlideSession(cached, now);
    return cached;
  }

  const row = selectSessionStmt.get(token) as
    | {
        token: string;
        user_id: string;
        provider: string;
        sb_access_token: string | null;
        sb_refresh_token: string | null;
        sb_expires_at: number | null;
        user_json: string | null;
        created_at: string;
        last_seen_at: string;
        expires_at: number;
      }
    | undefined;

  if (!row) return null;
  if (Number(row.expires_at) <= now) {
    deletePersistentSession(token);
    return null;
  }

  const record: PersistentSessionRecord = {
    token: row.token,
    userId: row.user_id,
    provider: row.provider === 'supabase' ? 'supabase' : 'local',
    sbAccessToken: row.sb_access_token ?? null,
    sbRefreshToken: row.sb_refresh_token ?? null,
    sbExpiresAt: typeof row.sb_expires_at === 'number' ? row.sb_expires_at : null,
    userSnapshot: parseUserJson(row.user_json),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: Number(row.expires_at),
  };

  sessionMemCache.set(token, record, SESSION_CACHE_TTL_MS, SESSION_CACHE_TTL_MS * 2);
  maybeSlideSession(record, now);
  return record;
}

function maybeSlideSession(record: PersistentSessionRecord, nowMs: number): void {
  const lastSeenMs = Date.parse(record.lastSeenAt);
  if (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs < SLIDE_INTERVAL_MS) {
    return;
  }
  const nowIso = new Date(nowMs).toISOString();
  const nextExpiresAt = nowMs + SESSION_TTL_MS;
  record.lastSeenAt = nowIso;
  record.expiresAt = nextExpiresAt;
  try {
    touchSessionStmt.run(nowIso, nextExpiresAt, record.token);
  } catch {
    // Non-fatal
  }
}

export function deletePersistentSession(token: string): void {
  if (!token) return;
  sessionMemCache.delete(token);
  try {
    deleteSessionStmt.run(token);
  } catch {
    // Non-fatal
  }
}

export function revokeAllSessionsForUser(userId: string): void {
  if (!userId) return;
  sessionMemCache.clear();
  try {
    deleteUserSessionsStmt.run(userId);
  } catch {
    // Non-fatal
  }
}

export function purgeExpiredPersistentSessions(): void {
  try {
    purgeExpiredSessionsStmt.run(Date.now());
  } catch {
    // Non-fatal
  }
}

export function countActivePersistentSessionUsers(): number {
  try {
    const row = countActiveSessionUsersStmt.get(Date.now()) as { cnt?: number } | undefined;
    return Number(row?.cnt) || 0;
  } catch {
    return 0;
  }
}

export function decodeJwtExpiryMs(jwt: string): number | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isHardAuthInvalidation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof rec.status === 'number' ? rec.status : 0;
  const code = String(rec.code ?? '').toLowerCase();
  const msg = String(rec.message ?? '').toLowerCase();
  if (status === 400 || status === 401 || status === 403) {
    return true;
  }
  return (
    code.includes('refresh_token') ||
    code.includes('invalid_grant') ||
    msg.includes('refresh token') ||
    msg.includes('invalid grant') ||
    msg.includes('already used') ||
    msg.includes('revoked')
  );
}

export async function resolvePersistentSupabaseSession(
  token: string
): Promise<{ user: UserProfile; client: SupabaseClient } | null> {
  const session = getPersistentSession(token);
  if (!session || session.provider !== 'supabase') {
    return null;
  }

  const now = Date.now();
  const sbExp = session.sbExpiresAt ?? (session.sbAccessToken ? decodeJwtExpiryMs(session.sbAccessToken) : null);

  // Access token is still fresh (> 2 min left)
  if (session.sbAccessToken && (!sbExp || sbExp - 120_000 > now)) {
    const resolved = await sbResolveUser(session.sbAccessToken);
    if (resolved) {
      session.userSnapshot = resolved.user;
      return resolved;
    }
  }

  // Otherwise refresh via single coalesced request so concurrent browser API calls don't double-spend single-use refresh_token
  if (!session.sbRefreshToken) {
    return null;
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
  return refreshCoalescer.run(`sb-refresh:${tokenHash}`, async () => {
    const latest = getPersistentSession(token);
    if (!latest || latest.provider !== 'supabase' || !latest.sbRefreshToken) {
      return null;
    }

    const latestExp =
      latest.sbExpiresAt ?? (latest.sbAccessToken ? decodeJwtExpiryMs(latest.sbAccessToken) : null);
    if (latest.sbAccessToken && (!latestExp || latestExp - 120_000 > Date.now())) {
      const resolved = await sbResolveUser(latest.sbAccessToken);
      if (resolved) return resolved;
    }

    try {
      const sb = createAnonClient();
      const { data, error } = await sb.auth.refreshSession({
        refresh_token: latest.sbRefreshToken,
      });

      if (error || !data.session?.access_token) {
        if (error && isHardAuthInvalidation(error)) {
          deletePersistentSession(token);
          return null;
        }
        // Transient network hiccup: keep cached snapshot if still within 35d window
        if (latest.userSnapshot && latest.sbAccessToken) {
          return {
            user: latest.userSnapshot,
            client: createUserClient(latest.sbAccessToken),
          };
        }
        return null;
      }

      const nextAccess = data.session.access_token;
      const nextRefresh = data.session.refresh_token || latest.sbRefreshToken;
      const nextExp = decodeJwtExpiryMs(nextAccess) ?? Date.now() + 3_600_000;
      const resolved = await sbResolveUser(nextAccess, { skipCache: true });
      const snapshot = resolved?.user ?? latest.userSnapshot;

      const updated = createPersistentSession({
        token,
        userId: latest.userId,
        provider: 'supabase',
        sbAccessToken: nextAccess,
        sbRefreshToken: nextRefresh,
        sbExpiresAtMs: nextExp,
        userSnapshot: snapshot,
      });

      if (resolved) {
        return resolved;
      }
      if (updated.userSnapshot) {
        return { user: updated.userSnapshot, client: createUserClient(nextAccess) };
      }
      return null;
    } catch {
      if (latest.userSnapshot) {
        return {
          user: latest.userSnapshot,
          client: latest.sbAccessToken ? createUserClient(latest.sbAccessToken) : createAnonClient(),
        };
      }
      return null;
    }
  });
}

// Initial cleanup on module load
purgeExpiredPersistentSessions();
