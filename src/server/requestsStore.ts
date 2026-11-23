import crypto from 'node:crypto';
import type {
  BrokenReportRecord,
  BrokenReportStatus,
  ContentRequestRecord,
  ContentRequestStatus,
  ItemType,
} from '../shared/types.ts';
import { getSqliteDb } from './persistentDb.ts';

const db = getSqliteDb();

const VALID_TYPES: ItemType[] = ['film', 'serie', 'anime'];
const VALID_REPORT_STATUSES: BrokenReportStatus[] = ['pending', 'resolved', 'rejected'];
const VALID_REQUEST_STATUSES: ContentRequestStatus[] = [
  'pending',
  'in_progress',
  'added',
  'rejected',
];

function sanitizeItemType(raw: unknown): ItemType {
  const val = String(raw ?? '').trim().toLowerCase();
  if (VALID_TYPES.includes(val as ItemType)) return val as ItemType;
  return 'film';
}

function sanitizeReportItemType(raw: unknown): ItemType | 'pinoy' {
  const val = String(raw ?? '').trim().toLowerCase();
  if (val === 'pinoy') return 'pinoy';
  return sanitizeItemType(val);
}

function sanitizeTmdbPosterUrl(raw: unknown): string | null {
  const val = String(raw ?? '').trim();
  if (!val) return null;
  if (/^https:\/\/image\.tmdb\.org\/t\/p\/[a-z0-9_]+\/[A-Za-z0-9_.-]+$/i.test(val)) {
    return val.slice(0, 300);
  }
  return null;
}

function sanitizeCatalogLink(raw: unknown): string | null {
  const val = String(raw ?? '').trim();
  if (!val) return null;
  if (/^\/(film|serie|anime)\/[A-Za-z0-9_-]+$/i.test(val)) {
    return val.slice(0, 120);
  }
  if (/^https?:\/\/[^\s"'<>]+$/i.test(val)) {
    return val.slice(0, 300);
  }
  return null;
}

function mapReportRow(row: Record<string, unknown>): BrokenReportRecord {
  return {
    id: String(row.id),
    itemType: sanitizeReportItemType(row.item_type),
    itemId: String(row.item_id),
    itemTitle: String(row.item_title),
    season: typeof row.season === 'number' ? row.season : null,
    episode: typeof row.episode === 'number' ? row.episode : null,
    reason: String(row.reason),
    comment: String(row.comment ?? ''),
    userId: typeof row.user_id === 'string' && row.user_id ? row.user_id : null,
    username: String(row.username || 'Visiteur'),
    status: VALID_REPORT_STATUSES.includes(row.status as BrokenReportStatus)
      ? (row.status as BrokenReportStatus)
      : 'pending',
    adminNote: String(row.admin_note ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseVoterKeys(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapRequestRow(
  row: Record<string, unknown>,
  viewerKey?: string | null
): ContentRequestRecord {
  const voters = parseVoterKeys(row.voter_keys);
  return {
    id: String(row.id),
    mediaType: sanitizeItemType(row.media_type),
    title: String(row.title),
    year: typeof row.year === 'number' ? row.year : null,
    tmdbId: typeof row.tmdb_id === 'string' && row.tmdb_id ? row.tmdb_id : null,
    tmdbPosterUrl:
      typeof row.tmdb_poster_url === 'string' && row.tmdb_poster_url
        ? row.tmdb_poster_url
        : null,
    tmdbOverview:
      typeof row.tmdb_overview === 'string' && row.tmdb_overview ? row.tmdb_overview : null,
    note: String(row.note ?? ''),
    userId: typeof row.user_id === 'string' && row.user_id ? row.user_id : null,
    username: String(row.username || 'Visiteur'),
    votes: Math.max(1, Number(row.votes ?? 1) || 1),
    ...(viewerKey ? { hasVoted: voters.includes(viewerKey) } : {}),
    status: VALID_REQUEST_STATUSES.includes(row.status as ContentRequestStatus)
      ? (row.status as ContentRequestStatus)
      : 'pending',
    adminNote: String(row.admin_note ?? ''),
    resolvedItemUrl:
      typeof row.resolved_item_url === 'string' && row.resolved_item_url
        ? row.resolved_item_url
        : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BROKEN STREAM / BAD EPISODE REPORTS
// ─────────────────────────────────────────────────────────────────────────────
export function createBrokenReport(input: {
  itemType: unknown;
  itemId: string;
  itemTitle: string;
  season?: number | null;
  episode?: number | null;
  reason: string;
  comment?: string;
  userId?: string | null;
  username?: string | null;
}): BrokenReportRecord {
  const now = new Date().toISOString();
  const id = `rep_${crypto.randomBytes(6).toString('hex')}`;
  const itemType = sanitizeReportItemType(input.itemType);
  const itemId = String(input.itemId || '').trim().slice(0, 80);
  const itemTitle = String(input.itemTitle || '').trim().slice(0, 180) || `${itemType} #${itemId}`;
  const season =
    typeof input.season === 'number' && Number.isFinite(input.season) && input.season > 0
      ? Math.round(input.season)
      : null;
  const episode =
    typeof input.episode === 'number' && Number.isFinite(input.episode) && input.episode > 0
      ? Math.round(input.episode)
      : null;
  const reason = String(input.reason || 'Lien mort').trim().slice(0, 120) || 'Lien mort';
  const comment = String(input.comment || '').trim().slice(0, 400);
  const userId = input.userId ? String(input.userId) : null;
  const username = String(input.username || 'Visiteur').trim().slice(0, 60) || 'Visiteur';

  db.prepare(`
    INSERT INTO broken_reports (
      id, item_type, item_id, item_title, season, episode,
      reason, comment, user_id, username, status, admin_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)
  `).run(
    id,
    itemType,
    itemId,
    itemTitle,
    season,
    episode,
    reason,
    comment,
    userId,
    username,
    now,
    now
  );

  const row = db.prepare('SELECT * FROM broken_reports WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return mapReportRow(row);
}

export function listBrokenReports(): BrokenReportRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM broken_reports ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 300`
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapReportRow);
}

export function updateBrokenReportStatus(
  id: string,
  status: unknown,
  adminNote?: string
): BrokenReportRecord | null {
  const existing = db.prepare('SELECT * FROM broken_reports WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return null;

  const nextStatus: BrokenReportStatus = VALID_REPORT_STATUSES.includes(status as BrokenReportStatus)
    ? (status as BrokenReportStatus)
    : 'pending';
  const nextNote =
    typeof adminNote === 'string'
      ? adminNote.trim().slice(0, 300)
      : String(existing.admin_note ?? '');
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE broken_reports SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?'
  ).run(nextStatus, nextNote, now, id);

  const updated = db.prepare('SELECT * FROM broken_reports WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return mapReportRow(updated);
}

export function deleteBrokenReport(id: string): boolean {
  const res = db.prepare('DELETE FROM broken_reports WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSING CONTENT REQUESTS (WITH OPTIONAL TMDB METADATA, NO FILE UPLOAD)
// ─────────────────────────────────────────────────────────────────────────────
export function listContentRequests(viewerKey?: string | null): ContentRequestRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM content_requests
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'added' THEN 2 ELSE 3 END,
                votes DESC,
                created_at DESC
       LIMIT 200`
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => mapRequestRow(r, viewerKey));
}

export function createOrVoteContentRequest(input: {
  mediaType: unknown;
  title: string;
  year?: number | null;
  tmdbId?: string | null;
  tmdbPosterUrl?: string | null;
  tmdbOverview?: string | null;
  note?: string;
  userId?: string | null;
  username?: string | null;
  viewerKey: string;
}): { request: ContentRequestRecord; merged: boolean } {
  const mediaType = sanitizeItemType(input.mediaType);
  const title = String(input.title || '').trim().slice(0, 160);
  const cleanTitleKey = title.toLowerCase().replace(/\s+/g, ' ');
  const tmdbId = input.tmdbId ? String(input.tmdbId).replace(/\D/g, '').slice(0, 20) || null : null;
  const year =
    typeof input.year === 'number' && Number.isFinite(input.year) && input.year >= 1900 && input.year <= 2100
      ? Math.round(input.year)
      : null;
  const tmdbPosterUrl = sanitizeTmdbPosterUrl(input.tmdbPosterUrl);
  const tmdbOverview = input.tmdbOverview ? String(input.tmdbOverview).trim().slice(0, 500) : null;
  const note = String(input.note || '').trim().slice(0, 350);
  const userId = input.userId ? String(input.userId) : null;
  const username = String(input.username || 'Visiteur').trim().slice(0, 60) || 'Visiteur';
  const viewerKey = String(input.viewerKey || 'anon').slice(0, 120);

  // Deduplicate existing pending/in_progress request by tmdbId or normalized title+type
  const existingRows = db
    .prepare(
      `SELECT * FROM content_requests WHERE status IN ('pending', 'in_progress') ORDER BY created_at DESC LIMIT 300`
    )
    .all() as Record<string, unknown>[];

  const match = existingRows.find((r) => {
    if (tmdbId && r.tmdb_id && String(r.tmdb_id) === tmdbId && r.media_type === mediaType) {
      return true;
    }
    return (
      r.media_type === mediaType &&
      String(r.title || '').trim().toLowerCase().replace(/\s+/g, ' ') === cleanTitleKey
    );
  });

  const now = new Date().toISOString();

  if (match) {
    const voters = parseVoterKeys(match.voter_keys);
    let votes = Math.max(1, Number(match.votes ?? 1) || 1);
    if (!voters.includes(viewerKey)) {
      voters.push(viewerKey);
      votes = voters.length;
      db.prepare(
        'UPDATE content_requests SET votes = ?, voter_keys = ?, updated_at = ? WHERE id = ?'
      ).run(votes, JSON.stringify(voters.slice(-500)), now, String(match.id));
    }
    const refreshed = db
      .prepare('SELECT * FROM content_requests WHERE id = ?')
      .get(String(match.id)) as Record<string, unknown>;
    return { request: mapRequestRow(refreshed, viewerKey), merged: true };
  }

  const id = `req_${crypto.randomBytes(6).toString('hex')}`;
  const initialVoters = JSON.stringify([viewerKey]);

  db.prepare(`
    INSERT INTO content_requests (
      id, media_type, title, year, tmdb_id, tmdb_poster_url, tmdb_overview,
      note, user_id, username, votes, voter_keys, status, admin_note,
      resolved_item_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending', '', NULL, ?, ?)
  `).run(
    id,
    mediaType,
    title,
    year,
    tmdbId,
    tmdbPosterUrl,
    tmdbOverview,
    note,
    userId,
    username,
    initialVoters,
    now,
    now
  );

  const created = db.prepare('SELECT * FROM content_requests WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return { request: mapRequestRow(created, viewerKey), merged: false };
}

export function toggleVoteContentRequest(
  id: string,
  viewerKey: string
): ContentRequestRecord | null {
  const existing = db.prepare('SELECT * FROM content_requests WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return null;

  const voters = parseVoterKeys(existing.voter_keys);
  const idx = voters.indexOf(viewerKey);
  if (idx >= 0) {
    if (voters.length > 1) voters.splice(idx, 1);
  } else {
    voters.push(viewerKey);
  }
  const votes = Math.max(1, voters.length);
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE content_requests SET votes = ?, voter_keys = ?, updated_at = ? WHERE id = ?'
  ).run(votes, JSON.stringify(voters.slice(-500)), now, id);

  const updated = db.prepare('SELECT * FROM content_requests WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return mapRequestRow(updated, viewerKey);
}

export function updateContentRequestStatus(
  id: string,
  patch: {
    status: unknown;
    adminNote?: string;
    resolvedItemUrl?: string | null;
  }
): ContentRequestRecord | null {
  const existing = db.prepare('SELECT * FROM content_requests WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return null;

  const nextStatus: ContentRequestStatus = VALID_REQUEST_STATUSES.includes(
    patch.status as ContentRequestStatus
  )
    ? (patch.status as ContentRequestStatus)
    : 'pending';
  const nextNote =
    typeof patch.adminNote === 'string'
      ? patch.adminNote.trim().slice(0, 300)
      : String(existing.admin_note ?? '');
  const nextUrl =
    patch.resolvedItemUrl !== undefined
      ? sanitizeCatalogLink(patch.resolvedItemUrl)
      : typeof existing.resolved_item_url === 'string'
        ? existing.resolved_item_url
        : null;
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE content_requests SET status = ?, admin_note = ?, resolved_item_url = ?, updated_at = ? WHERE id = ?'
  ).run(nextStatus, nextNote, nextUrl, now, id);

  const updated = db.prepare('SELECT * FROM content_requests WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return mapRequestRow(updated);
}

export function deleteContentRequest(id: string): boolean {
  const res = db.prepare('DELETE FROM content_requests WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function countPendingRequestsAndReports(): {
  pendingReports: number;
  pendingRequests: number;
  totalPending: number;
} {
  const repRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM broken_reports WHERE status = 'pending'`)
    .get() as { cnt?: number } | undefined;
  const reqRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM content_requests WHERE status IN ('pending', 'in_progress')`
    )
    .get() as { cnt?: number } | undefined;
  const pendingReports = Number(repRow?.cnt ?? 0);
  const pendingRequests = Number(reqRow?.cnt ?? 0);
  return {
    pendingReports,
    pendingRequests,
    totalPending: pendingReports + pendingRequests,
  };
}
