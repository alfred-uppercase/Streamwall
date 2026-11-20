import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AdminBroadcastRecord,
  AdminNotificationTarget,
  NotificationKind,
  NotificationRecord,
} from '../shared/types.ts';
import { readModuleSnapshot, writeModuleSnapshot } from './persistentDb.ts';
import { sendPushToUsers } from './webPushStore.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'tapenaka-notifications.json');

interface NotificationsDatabase {
  notifications: NotificationRecord[];
  guestNotifications?: NotificationRecord[];
  adminBroadcasts?: AdminBroadcastRecord[];
}

function loadNotificationsDb(): NotificationsDatabase {
  const parsed = readModuleSnapshot<NotificationsDatabase>('notifications', NOTIFICATIONS_FILE);
  if (parsed && Array.isArray(parsed.notifications)) {
    return {
      notifications: parsed.notifications,
      guestNotifications: Array.isArray(parsed.guestNotifications)
        ? parsed.guestNotifications
        : [],
      adminBroadcasts: Array.isArray(parsed.adminBroadcasts) ? parsed.adminBroadcasts : [],
    };
  }
  return { notifications: [], guestNotifications: [], adminBroadcasts: [] };
}

function saveNotificationsDb(state: NotificationsDatabase): void {
  writeModuleSnapshot('notifications', state);
}

const notificationsDb: NotificationsDatabase = loadNotificationsDb();

export function createNotification(input: {
  userId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  link: string;
  dedupKey?: string;
  skipPush?: boolean;
}): NotificationRecord | null {
  if (!input.userId) return null;

  if (input.dedupKey) {
    const existing = notificationsDb.notifications.find(
      (n) => n.userId === input.userId && n.dedupKey === input.dedupKey
    );
    if (existing) return null;
  }

  const record: NotificationRecord = {
    id: `ntf_${crypto.randomBytes(6).toString('hex')}`,
    userId: input.userId,
    kind: input.kind,
    title: input.title.trim().slice(0, 120),
    message: input.message.trim().slice(0, 400),
    link: input.link || '/',
    read: false,
    ...(input.dedupKey ? { dedupKey: input.dedupKey } : {}),
    createdAt: new Date().toISOString(),
  };

  notificationsDb.notifications.unshift(record);
  if (notificationsDb.notifications.length > 2500) {
    notificationsDb.notifications = notificationsDb.notifications.slice(0, 2500);
  }
  saveNotificationsDb(notificationsDb);

  if (!input.skipPush) {
    void sendPushToUsers([record.userId], {
      title: record.title,
      body: record.message,
      url: record.link,
      tag: `ntf:${record.kind}:${record.id}`,
    }).catch(() => undefined);
  }

  return record;
}

export function createGuestNotification(input: {
  kind: NotificationKind;
  title: string;
  message: string;
  link: string;
}): NotificationRecord {
  const record: NotificationRecord = {
    id: `gntf_${crypto.randomBytes(6).toString('hex')}`,
    userId: 'guest',
    audience: 'guest',
    kind: input.kind,
    title: input.title.trim().slice(0, 120),
    message: input.message.trim().slice(0, 400),
    link: input.link || '/',
    read: false,
    createdAt: new Date().toISOString(),
  };
  const list = notificationsDb.guestNotifications ?? [];
  list.unshift(record);
  notificationsDb.guestNotifications = list.slice(0, 30);
  saveNotificationsDb(notificationsDb);
  return record;
}

export function listGuestNotifications(): NotificationRecord[] {
  return (notificationsDb.guestNotifications ?? []).slice(0, 30);
}

export function deleteGuestNotification(notificationId: string): boolean {
  const list = notificationsDb.guestNotifications ?? [];
  const next = list.filter((n) => n.id !== notificationId);
  if (next.length === list.length) return false;
  notificationsDb.guestNotifications = next;
  saveNotificationsDb(notificationsDb);
  return true;
}

export function recordAdminBroadcast(input: {
  target: AdminNotificationTarget;
  recipientCount: number;
  title: string;
  message: string;
  link: string;
}): AdminBroadcastRecord {
  const entry: AdminBroadcastRecord = {
    id: `brd_${crypto.randomBytes(6).toString('hex')}`,
    target: input.target,
    recipientCount: input.recipientCount,
    title: input.title.trim().slice(0, 120),
    message: input.message.trim().slice(0, 400),
    link: input.link || '/',
    createdAt: new Date().toISOString(),
  };
  const list = notificationsDb.adminBroadcasts ?? [];
  list.unshift(entry);
  notificationsDb.adminBroadcasts = list.slice(0, 40);
  saveNotificationsDb(notificationsDb);
  return entry;
}

export function listAdminBroadcasts(): AdminBroadcastRecord[] {
  return notificationsDb.adminBroadcasts ?? [];
}

export function listUserNotifications(userId: string): {
  notifications: NotificationRecord[];
  unreadCount: number;
} {
  const list = notificationsDb.notifications
    .filter((n) => n.userId === userId)
    .slice(0, 60);
  const unreadCount = list.filter((n) => !n.read).length;
  return { notifications: list, unreadCount };
}

export function markNotificationRead(userId: string, notificationId: string): boolean {
  const target = notificationsDb.notifications.find(
    (n) => n.id === notificationId && n.userId === userId
  );
  if (!target) return false;
  if (!target.read) {
    target.read = true;
    saveNotificationsDb(notificationsDb);
  }
  return true;
}

export function markAllNotificationsRead(userId: string): void {
  let changed = false;
  for (const n of notificationsDb.notifications) {
    if (n.userId === userId && !n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) saveNotificationsDb(notificationsDb);
}

export function clearUserNotifications(userId: string, onlyRead = false): void {
  const before = notificationsDb.notifications.length;
  notificationsDb.notifications = notificationsDb.notifications.filter((n) => {
    if (n.userId !== userId) return true;
    return onlyRead ? !n.read : false;
  });
  if (notificationsDb.notifications.length !== before) {
    saveNotificationsDb(notificationsDb);
  }
}

export function cleanupUserNotifications(userId: string): void {
  clearUserNotifications(userId, false);
}

