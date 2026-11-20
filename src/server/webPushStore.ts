import { generateVAPIDKeys, sendNotification, setVapidDetails } from 'web-push';
import type { PushDispatchResult, PushStats } from '../shared/types.ts';
import { getSqliteDb, readModuleSnapshot, writeModuleSnapshot } from './persistentDb.ts';

interface VapidConfigRecord {
  publicKey: string;
  privateKey: string;
  subject: string;
  createdAt: string;
}

export interface StoredPushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string | null;
  is_pro: number;
  user_agent: string;
  created_at: string;
  updated_at: string;
  last_sent_at: string | null;
}

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
}

function loadOrCreateVapidConfig(): VapidConfigRecord {
  const envPublic = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPrivate = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const envSubject = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:contact@streamwall.app';

  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject: envSubject,
      createdAt: new Date().toISOString(),
    };
  }

  const stored = readModuleSnapshot<VapidConfigRecord>('web_push_vapid');
  if (stored && stored.publicKey && stored.privateKey) {
    return {
      publicKey: stored.publicKey,
      privateKey: stored.privateKey,
      subject: stored.subject || envSubject,
      createdAt: stored.createdAt || new Date().toISOString(),
    };
  }

  const generated = generateVAPIDKeys();
  const created: VapidConfigRecord = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: envSubject,
    createdAt: new Date().toISOString(),
  };
  writeModuleSnapshot('web_push_vapid', created);
  return created;
}

const vapidConfig = loadOrCreateVapidConfig();
setVapidDetails(vapidConfig.subject, vapidConfig.publicKey, vapidConfig.privateKey);

const db = getSqliteDb();

const upsertSubStmt = db.prepare(`
  INSERT INTO push_subscriptions (
    endpoint, p256dh, auth, user_id, is_pro, user_agent, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(endpoint) DO UPDATE SET
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_id = excluded.user_id,
    is_pro = excluded.is_pro,
    user_agent = CASE WHEN excluded.user_agent != '' THEN excluded.user_agent ELSE push_subscriptions.user_agent END,
    updated_at = excluded.updated_at
`);

const deleteSubByEndpointStmt = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
const selectAllSubsStmt = db.prepare('SELECT * FROM push_subscriptions');
const selectGuestSubsStmt = db.prepare('SELECT * FROM push_subscriptions WHERE user_id IS NULL');
const selectSubByEndpointStmt = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?');
const touchLastSentStmt = db.prepare(
  'UPDATE push_subscriptions SET last_sent_at = ? WHERE endpoint = ?'
);

function summarizeUserAgent(rawUa: string): string {
  const ua = rawUa.toLowerCase();
  if (!ua) return 'Navigateur web';
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('opr/') || ua.includes('opera')
      ? 'Opera'
      : ua.includes('firefox')
        ? 'Firefox'
        : ua.includes('chrome') || ua.includes('crios')
          ? 'Chrome'
          : ua.includes('safari')
            ? 'Safari'
            : 'Navigateur';
  const os =
    ua.includes('iphone') || ua.includes('ipad')
      ? 'iOS'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('windows')
          ? 'Windows'
          : ua.includes('mac os')
            ? 'macOS'
            : ua.includes('linux')
              ? 'Linux'
              : '';
  return os ? `${browser} (${os})` : browser;
}

export function getVapidPublicKey(): string {
  return vapidConfig.publicKey;
}

export function upsertPushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userId: string | null;
  isPro: boolean;
  userAgent?: string;
}): void {
  const now = new Date().toISOString();
  const deviceLabel = summarizeUserAgent(input.userAgent || '');
  upsertSubStmt.run(
    input.endpoint,
    input.p256dh,
    input.auth,
    input.userId || null,
    input.isPro ? 1 : 0,
    deviceLabel,
    now,
    now
  );
}

export function removePushSubscription(endpoint: string): boolean {
  const info = deleteSubByEndpointStmt.run(endpoint);
  return Number(info.changes ?? 0) > 0;
}

export function deletePushSubscriptionsForUser(userId: string): void {
  if (!userId) return;
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
}

export function syncPushSubscriptionProFlag(userId: string, isPro: boolean): void {
  if (!userId) return;
  db.prepare('UPDATE push_subscriptions SET is_pro = ?, updated_at = ? WHERE user_id = ?').run(
    isPro ? 1 : 0,
    new Date().toISOString(),
    userId
  );
}

export function getPushStats(): PushStats {
  const rows = selectAllSubsStmt.all() as unknown as StoredPushSubscriptionRow[];
  let memberDevices = 0;
  let guestDevices = 0;
  let proDevices = 0;
  for (const row of rows) {
    if (row.user_id) {
      memberDevices += 1;
      if (row.is_pro) proDevices += 1;
    } else {
      guestDevices += 1;
    }
  }
  return {
    totalDevices: rows.length,
    memberDevices,
    guestDevices,
    proDevices,
  };
}

async function dispatchToRows(
  rows: StoredPushSubscriptionRow[],
  payload: WebPushPayload
): Promise<PushDispatchResult> {
  if (rows.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, removed: 0 };
  }

  const bodyJson = JSON.stringify({
    title: payload.title.trim().slice(0, 120) || 'StreamWall',
    body: payload.body.trim().slice(0, 400),
    url: payload.url || '/',
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/favicon.png',
    tag: payload.tag || `sw-${Date.now()}`,
  });

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const now = new Date().toISOString();

  const BATCH_SIZE = 20;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((row) =>
        sendNotification(
          {
            endpoint: row.endpoint,
            keys: {
              p256dh: row.p256dh,
              auth: row.auth,
            },
          },
          bodyJson,
          { TTL: 86_400 }
        )
      )
    );

    results.forEach((res, idx) => {
      const targetRow = batch[idx];
      if (!targetRow) return;
      if (res.status === 'fulfilled') {
        sent += 1;
        touchLastSentStmt.run(now, targetRow.endpoint);
      } else {
        failed += 1;
        const err = res.reason as { statusCode?: number } | undefined;
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          deleteSubByEndpointStmt.run(targetRow.endpoint);
          removed += 1;
        }
      }
    });
  }

  return {
    attempted: rows.length,
    sent,
    failed,
    removed,
  };
}

export async function sendPushToAll(payload: WebPushPayload): Promise<PushDispatchResult> {
  const rows = selectAllSubsStmt.all() as unknown as StoredPushSubscriptionRow[];
  return dispatchToRows(rows, payload);
}

export async function sendPushToGuests(payload: WebPushPayload): Promise<PushDispatchResult> {
  const rows = selectGuestSubsStmt.all() as unknown as StoredPushSubscriptionRow[];
  return dispatchToRows(rows, payload);
}

export async function sendPushToUsers(
  userIds: string[],
  payload: WebPushPayload
): Promise<PushDispatchResult> {
  const uniqueIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, removed: 0 };
  }
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`)
    .all(...uniqueIds) as unknown as StoredPushSubscriptionRow[];
  return dispatchToRows(rows, payload);
}

export async function sendPushToEndpoint(
  endpoint: string,
  payload: WebPushPayload
): Promise<PushDispatchResult> {
  const row = selectSubByEndpointStmt.get(endpoint) as unknown as
    | StoredPushSubscriptionRow
    | undefined;
  if (!row) {
    return { attempted: 0, sent: 0, failed: 0, removed: 0 };
  }
  return dispatchToRows([row], payload);
}
