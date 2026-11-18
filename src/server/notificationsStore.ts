import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NotificationKind, NotificationRecord } from '../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'tapenaka-notifications.json');

interface NotificationsDatabase {
  notifications: NotificationRecord[];
}

function loadNotificationsDb(): NotificationsDatabase {
  try {
    if (fs.existsSync(NOTIFICATIONS_FILE)) {
      const parsed = JSON.parse(
        fs.readFileSync(NOTIFICATIONS_FILE, 'utf-8')
      ) as NotificationsDatabase;
      if (parsed && Array.isArray(parsed.notifications)) {
        return parsed;
      }
    }
  } catch {
    // Re-seed if corrupted
  }
  return { notifications: [] };
}

function saveNotificationsDb(state: NotificationsDatabase): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}

const notificationsDb: NotificationsDatabase = loadNotificationsDb();

export function createNotification(input: {
  userId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  link: string;
  dedupKey?: string;
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
  return record;
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
