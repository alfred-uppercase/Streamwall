import crypto from 'node:crypto';
import type {
  ErrorLogLevel,
  ErrorLogListResponse,
  ErrorLogRecord,
  ErrorLogSource,
} from '../shared/types.ts';
import { getSqliteDb } from './persistentDb.ts';

const VALID_LEVELS = new Set<ErrorLogLevel>(['warn', 'error', 'fatal']);
const VALID_SOURCES = new Set<ErrorLogSource>([
  'server',
  'client',
  'api',
  'upstream',
  'auth',
  'billing',
  'push',
  'mail',
]);

const SENSITIVE_KEY_RE =
  /(password|pass|token|secret|authorization|cookie|apikey|api_key|p256dh|authkey|privatekey|smtp_pass|webhook)/i;

const MAX_RETAINED_LOGS = 2000;

interface RawErrorLogRow {
  id: string;
  level: string;
  source: string;
  message: string;
  stack: string | null;
  route: string | null;
  method: string | null;
  status_code: number | null;
  user_id: string | null;
  user_agent: string | null;
  context_json: string | null;
  created_at: string;
}

const db = getSqliteDb();

const insertLogStmt = db.prepare(`
  INSERT INTO error_logs (
    id, level, source, message, stack, route, method, status_code, user_id, user_agent, context_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const trimOldLogsStmt = db.prepare(`
  DELETE FROM error_logs
  WHERE id NOT IN (
    SELECT id FROM error_logs ORDER BY created_at DESC LIMIT ?
  )
`);

export function sanitizeLogContext(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[TRUNCATED]';
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message.slice(0, 500),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogContext(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
    for (const [key, val] of entries) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeLogContext(val, depth + 1);
      }
    }
    return out;
  }
  return String(value).slice(0, 200);
}

export function normalizeErrorLevel(raw: unknown): ErrorLogLevel {
  const val = String(raw ?? '').trim().toLowerCase() as ErrorLogLevel;
  return VALID_LEVELS.has(val) ? val : 'error';
}

export function normalizeErrorSource(raw: unknown): ErrorLogSource {
  const val = String(raw ?? '').trim().toLowerCase() as ErrorLogSource;
  return VALID_SOURCES.has(val) ? val : 'server';
}

export function recordErrorLog(input: {
  level?: ErrorLogLevel | string;
  source?: ErrorLogSource | string;
  message: string;
  stack?: string | null;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  userId?: string | null;
  userAgent?: string | null;
  context?: Record<string, unknown> | null;
  err?: unknown;
}): ErrorLogRecord {
  const level = normalizeErrorLevel(input.level);
  const source = normalizeErrorSource(input.source);

  let message = String(input.message ?? '').trim();
  let stack = input.stack ? String(input.stack).trim() : null;

  if (input.err instanceof Error) {
    if (!message) message = input.err.message;
    if (!stack && input.err.stack) stack = input.err.stack;
  } else if (!message && input.err) {
    message = String(input.err);
  }

  message = (message || 'Erreur inconnue').slice(0, 1000);
  if (stack && stack.length > 4000) {
    stack = `${stack.slice(0, 4000)}\n…[truncated]`;
  }

  const route = input.route ? String(input.route).slice(0, 300) : null;
  const method = input.method ? String(input.method).toUpperCase().slice(0, 16) : null;
  const statusCode =
    typeof input.statusCode === 'number' && Number.isFinite(input.statusCode)
      ? Math.trunc(input.statusCode)
      : null;
  const userId = input.userId ? String(input.userId).slice(0, 128) : null;
  const userAgent = input.userAgent ? String(input.userAgent).slice(0, 300) : null;
  const sanitizedContext =
    input.context && typeof input.context === 'object'
      ? (sanitizeLogContext(input.context) as Record<string, unknown>)
      : null;
  const contextJson = sanitizedContext ? JSON.stringify(sanitizedContext) : null;

  const id = `err_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const createdAt = new Date().toISOString();

  try {
    insertLogStmt.run(
      id,
      level,
      source,
      message,
      stack,
      route,
      method,
      statusCode,
      userId,
      userAgent,
      contextJson,
      createdAt
    );
    trimOldLogsStmt.run(MAX_RETAINED_LOGS);
  } catch {
    // Never throw inside logger
  }

  if (process.env.TAPENAKA_SILENT_LOGS !== '1') {
    const structured = JSON.stringify({
      ts: createdAt,
      level,
      source,
      route,
      statusCode,
      message,
    });
    if (level === 'warn') {
      console.warn(`[ErrorLog] ${structured}`);
    } else {
      console.error(`[ErrorLog] ${structured}`);
    }
  }

  return {
    id,
    level,
    source,
    message,
    stack,
    route,
    method,
    statusCode,
    userId,
    userAgent,
    context: sanitizedContext,
    createdAt,
  };
}

function rowToRecord(row: RawErrorLogRow): ErrorLogRecord {
  let context: Record<string, unknown> | null = null;
  if (row.context_json) {
    try {
      context = JSON.parse(row.context_json) as Record<string, unknown>;
    } catch {
      context = null;
    }
  }
  return {
    id: row.id,
    level: normalizeErrorLevel(row.level),
    source: normalizeErrorSource(row.source),
    message: row.message,
    stack: row.stack,
    route: row.route,
    method: row.method,
    statusCode: row.status_code,
    userId: row.user_id,
    userAgent: row.user_agent,
    context,
    createdAt: row.created_at,
  };
}

export function listErrorLogs(filters?: {
  level?: string;
  source?: string;
  q?: string;
  limit?: number;
}): ErrorLogListResponse {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.level && VALID_LEVELS.has(filters.level as ErrorLogLevel)) {
    where.push('level = ?');
    params.push(filters.level);
  }
  if (filters?.source && VALID_SOURCES.has(filters.source as ErrorLogSource)) {
    where.push('source = ?');
    params.push(filters.source);
  }
  if (filters?.q && filters.q.trim()) {
    const pattern = `%${filters.q.trim().slice(0, 100)}%`;
    where.push('(message LIKE ? OR route LIKE ? OR COALESCE(stack, \'\') LIKE ?)');
    params.push(pattern, pattern, pattern);
  }

  const limit = Math.min(Math.max(Number(filters?.limit) || 150, 1), 500);
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM error_logs ${whereClause} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as unknown as RawErrorLogRow[];

  const countRows = db
    .prepare('SELECT level, COUNT(*) as cnt FROM error_logs GROUP BY level')
    .all() as unknown as Array<{ level: string; cnt: number }>;

  let fatal = 0;
  let error = 0;
  let warn = 0;
  for (const r of countRows) {
    if (r.level === 'fatal') fatal = Number(r.cnt) || 0;
    else if (r.level === 'warn') warn = Number(r.cnt) || 0;
    else error += Number(r.cnt) || 0;
  }

  return {
    logs: rows.map(rowToRecord),
    counts: {
      total: fatal + error + warn,
      fatal,
      error,
      warn,
    },
  };
}

export function clearErrorLogs(olderThanDays?: number): number {
  if (typeof olderThanDays === 'number' && Number.isFinite(olderThanDays) && olderThanDays > 0) {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const res = db.prepare('DELETE FROM error_logs WHERE created_at < ?').run(cutoff);
    return Number(res.changes ?? 0);
  }
  const res = db.prepare('DELETE FROM error_logs').run();
  return Number(res.changes ?? 0);
}

let processHandlersInstalled = false;

export function installProcessErrorHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;

  process.on('unhandledRejection', (reason) => {
    recordErrorLog({
      level: 'error',
      source: 'server',
      message: reason instanceof Error ? reason.message : `Promesse rejetée non gérée : ${String(reason)}`,
      stack: reason instanceof Error ? reason.stack : null,
      err: reason,
    });
  });

  process.on('uncaughtException', (err) => {
    recordErrorLog({
      level: 'fatal',
      source: 'server',
      message: err.message || 'Exception non interceptée',
      stack: err.stack ?? null,
      err,
    });
  });
}
