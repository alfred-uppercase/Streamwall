import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_PLAYERS,
  PLAYER_KEYS,
  TEMPLATE_RE,
  fillTemplate,
  getContentDetailPath,
  isFullUrlTemplate,
  matchesTemplate,
  stripOriginFromTemplate,
} from './src/shared/types.ts';
import type {
  AdminNotificationTarget,
  CatalogueFilters,
  CataloguePage,
  CastMember,
  CommentRecord,
  CustomApiDetailResponse,
  DetailItem,
  DetailResponse,
  EmailTemplateKey,
  EndpointCheck,
  Episode,
  Item,
  ItemType,
  LastSeriesItem,
  PinoyDetailResponse,
  PinoyListFilters,
  PlayerKey,
  PlayerTemplates,
  RankingEntry,
  SiteConfig,
  Slide,
  UserProfile,
  WatchEventRecord,
  WatchProgress,
} from './src/shared/types.ts';
import {
  FALLBACK_GENRES,
  FALLBACK_ITEMS,
  FALLBACK_SLIDER,
  buildFallbackDetail,
} from './src/server/fallbackData.ts';
import {
  createAdminClient,
  createAnonClient,
  invalidateSbAdminOverviewCache,
  invalidateSbCommentsCache,
  invalidateSbMemberCache,
  invalidateSbSettingsCache,
  invalidateSbUserCache,
  isSupabaseEnabled,
  sbGetAdminOverview,
  sbGetApiOrigin,
  sbGetComments,
  sbGetEmbedProvider,
  sbGetFilmDownloadApiUrl,
  sbGetFilmDownloadMessage,
  sbGetMemberData,
  sbGetPinoyApiUrl,
  sbGetPinoyDownloadMessage,
  sbGetPinoyMediaBaseUrl,
  sbGetPinoyPlayerTemplate,
  sbGetPlayerTemplates,
  sbGetRankings,
  sbGetSiteConfig,
  sbGetTmdbApiKey,
  sbResolveUser,
} from './src/server/supabaseAdapter.ts';
import {
  DEFAULT_PINOY_DOWNLOAD_MESSAGE as PINOY_DOWNLOAD_MESSAGE_DEFAULT,
  DEFAULT_PINOY_MEDIA_BASE_URL as PINOY_MEDIA_DEFAULT,
  DEFAULT_PINOY_PLAYER_TEMPLATE as PINOY_PLAYER_DEFAULT,
  clearPinoyCache,
  fetchPinoyDetail,
  fetchPinoyFacets,
  fetchPinoyList,
  resolvePinoyPlayerUrl,
  sanitizePinoyDownloadMessage,
  validatePinoyApiUrl,
  validatePinoyMediaBaseUrl,
  validatePinoyPlayerTemplate,
} from './src/server/pinoyService.ts';
import { InFlightCoalescer, TimedLruCache } from './src/server/cacheUtils.ts';
import {
  antiBotAndRateLimitMiddleware,
  checkLoginLockout,
  clearLoginFailures,
  consumeRateLimit,
  createCaptchaChallenge,
  csrfOriginCheckMiddleware,
  escapeHtml,
  getClientIp,
  getSessionCookieOptions,
  isHoneypotTriggered,
  payloadSanitizerMiddleware,
  recordLoginFailure,
  securityHeadersMiddleware,
  stripDangerousText,
  verifyCaptchaChallenge,
} from './src/server/security.ts';
import { clearTmdbCache, enrichDetailWithTmdb } from './src/server/tmdbService.ts';
import {
  EMAIL_TEMPLATE_KEYS,
  clearMailLogs,
  getAdminSmtpStatus,
  isSmtpReady,
  listEmailTemplates,
  listMailLogs,
  resetEmailTemplate,
  sendEmailChangeVerificationEmail,
  sendPasswordChangeVerificationEmail,
  sendPasswordResetEmail,
  sendSignupVerificationEmail,
  sendTemplateTestEmail,
  sendTestEmail,
  sendWelcomeEmail,
  setMailSiteNameResolver,
  shouldRequireSignupConfirmation,
  updateAdminSmtpConfig,
  updateEmailTemplate,
} from './src/server/mailer.ts';
import type { AnalyticsPeriodKey } from './src/shared/analyticsTypes.ts';
import {
  computeAnalyticsDashboard,
  computePlayReport,
  computeRealtimeAnalytics,
  getActivePresenceStats,
  getOnlineMemberPresence,
  getTopContentStats,
  parseUserAgent,
  recordAnalyticsCollect,
  recordPlayEvent,
  resolveGeoFromRequest,
  setActiveMembersCountProvider,
  touchActiveUserPresence,
} from './src/server/analyticsStore.ts';
import {
  assignUserPlan,
  banUser,
  canPlanAccessFilmDownloads,
  cleanupUserBillingData,
  countActiveDirectoryUsers,
  createCryptoGateOrder,
  createManualOrder,
  deletePlan,
  ensureExpiryWarningNotification,
  getAdminPaymentSecretsStatus,
  getAllPlanTemplates,
  getBillingConfig,
  getUserBanInfo,
  getUserSubscription,
  getUserTheme,
  isEmailInDirectory,
  isUserBanned,
  isUsernameInDirectory,
  isUserPro,
  listAllOrders,
  listPlans,
  listUserOrders,
  pruneUserDirectory,
  registerUserDirectoryEntry,
  resolvePlanTemplateForUser,
  resolveUserAvatar,
  reviewOrder,
  setBillingAppUrl,
  setUserAvatarChoice,
  setUserTheme,
  syncPendingCryptoGateOrdersForUser,
  unbanUser,
  updateAdminPaymentSecrets,
  updateBillingConfig,
  upsertPlan,
  verifyAndProcessCryptoGateWebhook,
} from './src/server/billingStore.ts';
import {
  cleanupUserNotifications,
  clearUserNotifications,
  createGuestNotification,
  createNotification,
  deleteGuestNotification,
  listAdminBroadcasts,
  listGuestNotifications,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  recordAdminBroadcast,
} from './src/server/notificationsStore.ts';
import {
  deletePushSubscriptionsForUser,
  getPushStats,
  getVapidPublicKey,
  removePushSubscription,
  sendPushToAll,
  sendPushToEndpoint,
  sendPushToGuests,
  sendPushToUsers,
  upsertPushSubscription,
} from './src/server/webPushStore.ts';
import {
  deletePopup,
  listActivePopups,
  listAllPopups,
  resolvePopupAssetFile,
  trackPopupEvent,
  upsertPopup,
} from './src/server/popupsStore.ts';
import {
  getPersistenceSummary,
  hydrateModulesFromSupabase,
  readModuleSnapshot,
  writeModuleSnapshot,
} from './src/server/persistentDb.ts';
import {
  countPendingRequestsAndReports,
  createBrokenReport,
  createOrVoteContentRequest,
  deleteBrokenReport,
  deleteContentRequest,
  listBrokenReports,
  listContentRequests,
  toggleVoteContentRequest,
  updateBrokenReportStatus,
  updateContentRequestStatus,
} from './src/server/requestsStore.ts';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  cleanupUserFriendRequests,
  clearFriendRequestsBetween,
  createOrMatchFriendRequest,
  declineFriendRequest,
  listUserFriendRequests,
} from './src/server/friendsStore.ts';
import {
  getPrivacyPageConfig,
  resetPrivacyPageConfig,
  updatePrivacyPageConfig,
} from './src/server/privacyStore.ts';
import {
  clearErrorLogs,
  installProcessErrorHandlers,
  listErrorLogs,
  recordErrorLog,
} from './src/server/errorLogger.ts';
import {
  createPersistentSession,
  decodeJwtExpiryMs,
  deletePersistentSession,
  getPersistentSession,
  resolvePersistentSupabaseSession,
  revokeAllSessionsForUser,
} from './src/server/sessionStore.ts';
import {
  deleteCustomModule,
  getCustomModule,
  getSiteNavigation,
  isPinoyModuleActive,
  isPinoyModuleDeleted,
  listCustomModules,
  resetSiteNavigation,
  syncPinoyModuleFromSettings,
  updateSiteNavigation,
  upsertCustomModule,
  validateCustomModuleDraft,
} from './src/server/customModulesStore.ts';
import {
  clearCustomApiCache,
  fetchCustomDetail,
  fetchCustomFacets,
  fetchCustomList,
  resolveCustomPlayerUrl,
  testCustomModuleConfig,
} from './src/server/customApiService.ts';
import {
  DEFAULT_FILM_DOWNLOAD_API_URL,
  DEFAULT_FILM_DOWNLOAD_MESSAGE,
  clearFilmDownloadsCache,
  fetchFilmDownloads,
  maskFilmDownloadToken,
  sanitizeFilmDownloadMessage,
  testFilmDownloadApi,
  validateFilmDownloadApiUrl,
} from './src/server/filmDownloadsService.ts';
import { decryptProtectedLink } from './src/server/linkProtectService.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const DEFAULT_ORIGIN = (process.env.STREAMWALL_API_ORIGIN || 'https://streamwall.behoririka.mg').replace(
  /\/+$/,
  ''
);
const DEFAULT_TMDB_API_KEY = (
  process.env.TMDB_API_KEY || 'cba03e8974108acd7a3b1442dccc6712'
).trim();
const DEFAULT_PINOY_API_URL = (process.env.PINOY_API_URL || '').trim();
const DEFAULT_PINOY_MEDIA_BASE_URL = (
  process.env.PINOY_MEDIA_BASE_URL || PINOY_MEDIA_DEFAULT
).trim();
const DEFAULT_PINOY_PLAYER_TEMPLATE = (
  process.env.PINOY_PLAYER_TEMPLATE || PINOY_PLAYER_DEFAULT
).trim();
const DEFAULT_PINOY_DOWNLOAD_MESSAGE = sanitizePinoyDownloadMessage(
  process.env.PINOY_DOWNLOAD_MESSAGE || PINOY_DOWNLOAD_MESSAGE_DEFAULT
);
const ENV_FILM_DOWNLOAD_API_URL = (
  process.env.FILM_DOWNLOAD_API_URL || DEFAULT_FILM_DOWNLOAD_API_URL
).trim();
const ENV_FILM_DOWNLOAD_API_KEY = (process.env.FILM_DOWNLOAD_API_KEY || '').trim();
const ENV_FILM_DOWNLOAD_MESSAGE = sanitizeFilmDownloadMessage(
  process.env.FILM_DOWNLOAD_MESSAGE || DEFAULT_FILM_DOWNLOAD_MESSAGE
);

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'member';
  emailVerified?: boolean;
  createdAt: string;
}

interface StoredSession {
  token: string;
  userId: string;
  createdAt: string;
}

interface StoredResetToken {
  token: string;
  userId: string;
  expiresAt: number;
}

interface StoredVerifyToken {
  token: string;
  userId: string;
  expiresAt: number;
}

interface StoredPresence {
  userId: string;
  lastSeen: string;
  currentItem: Item | null;
  page: string;
}

interface StoredRating {
  userId: string;
  itemKey: string;
  score: number;
  updatedAt: string;
}

interface DatabaseShape {
  settings: {
    api_origin: string;
    embed_provider?: string;
    tmdb_api_key?: string;
    pinoy_api_url?: string;
    pinoy_media_base_url?: string;
    pinoy_player_template?: string;
    pinoy_download_message?: string;
    film_download_api_url?: string;
    film_download_api_key?: string;
    film_download_message?: string;
    site_name?: string;
    favicon_url?: string;
    players: PlayerTemplates;
  };
  users: StoredUser[];
  sessions: StoredSession[];
  resetTokens: StoredResetToken[];
  verifyTokens?: StoredVerifyToken[];
  favorites: Record<string, Item[]>;
  watchEvents: WatchEventRecord[];
  watchProgress: Record<string, WatchProgress[]>;
  comments: CommentRecord[];
  friendships: { userId: string; friendId: string; createdAt: string }[];
  presence: Record<string, StoredPresence>;
  ratings: StoredRating[];
}

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(`tapenaka_salt_${pw}`).digest('hex');
}

const DATA_DIR = path.join(__dirname, '.data');
const DB_FILE = path.join(DATA_DIR, 'tapenaka-store.json');
const PENDING_SIGNUPS_FILE = path.join(DATA_DIR, 'tapenaka-pending-signups.json');

interface PendingSignupEntry {
  email: string;
  username: string;
  password: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  lastSentAt: number;
  attempts: number;
}

function loadPendingSignups(): Record<string, PendingSignupEntry> {
  const parsed = readModuleSnapshot<Record<string, PendingSignupEntry>>(
    'pending_signups',
    PENDING_SIGNUPS_FILE
  );
  if (!parsed) return {};
  const now = Date.now();
  const cleaned: Record<string, PendingSignupEntry> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v && v.expiresAt > now) {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

const pendingSignups: Record<string, PendingSignupEntry> = loadPendingSignups();

function savePendingSignups(): void {
  const now = Date.now();
  for (const k of Object.keys(pendingSignups)) {
    if (pendingSignups[k].expiresAt <= now) {
      delete pendingSignups[k];
    }
  }
  writeModuleSnapshot('pending_signups', pendingSignups);
}

const OTP_CHALLENGES_FILE = path.join(DATA_DIR, 'tapenaka-otp-challenges.json');

interface OtpChallengeEntry {
  purpose: 'password_reset' | 'email_change' | 'password_change';
  userId: string;
  email: string;
  username: string;
  newEmail?: string;
  newPassword?: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  lastSentAt: number;
  attempts: number;
}

function loadOtpChallenges(): Record<string, OtpChallengeEntry> {
  const parsed = readModuleSnapshot<Record<string, OtpChallengeEntry>>(
    'otp_challenges',
    OTP_CHALLENGES_FILE
  );
  if (!parsed) return {};
  const now = Date.now();
  const cleaned: Record<string, OtpChallengeEntry> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v && v.expiresAt > now) {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

const otpChallenges: Record<string, OtpChallengeEntry> = loadOtpChallenges();

function saveOtpChallenges(): void {
  const now = Date.now();
  for (const k of Object.keys(otpChallenges)) {
    if (otpChallenges[k].expiresAt <= now) {
      delete otpChallenges[k];
    }
  }
  writeModuleSnapshot('otp_challenges', otpChallenges);
}

function cleanupUserOtpChallenges(userId: string, email?: string): void {
  let dirty = false;
  const cleanEmail = (email || '').trim().toLowerCase();
  for (const [key, entry] of Object.entries(otpChallenges)) {
    if (
      entry.userId === userId ||
      (cleanEmail &&
        (entry.email.trim().toLowerCase() === cleanEmail ||
          (entry.newEmail || '').trim().toLowerCase() === cleanEmail))
    ) {
      delete otpChallenges[key];
      dirty = true;
    }
  }
  if (dirty) saveOtpChallenges();
}

const EMAIL_COOLDOWNS_FILE = path.join(DATA_DIR, 'tapenaka-email-cooldowns.json');
const EMAIL_CHANGE_COOLDOWN_MS = 30 * 86_400_000;

function loadEmailCooldowns(): Record<string, string> {
  const parsed = readModuleSnapshot<Record<string, string>>(
    'email_cooldowns',
    EMAIL_COOLDOWNS_FILE
  );
  return parsed && typeof parsed === 'object' ? parsed : {};
}

const emailChangeTimestamps: Record<string, string> = loadEmailCooldowns();

function saveEmailCooldowns(): void {
  writeModuleSnapshot('email_cooldowns', emailChangeTimestamps);
}

function getUserEmailChangeStatus(userId: string): {
  lastEmailChangedAt: string | null;
  nextEmailChangeAt: string | null;
  blocked: boolean;
  remainingDays: number;
} {
  const lastIso = emailChangeTimestamps[userId] || null;
  if (!lastIso) {
    return { lastEmailChangedAt: null, nextEmailChangeAt: null, blocked: false, remainingDays: 0 };
  }
  const lastMs = new Date(lastIso).getTime();
  if (!Number.isFinite(lastMs)) {
    return { lastEmailChangedAt: null, nextEmailChangeAt: null, blocked: false, remainingDays: 0 };
  }
  const nextMs = lastMs + EMAIL_CHANGE_COOLDOWN_MS;
  const now = Date.now();
  if (nextMs > now) {
    return {
      lastEmailChangedAt: lastIso,
      nextEmailChangeAt: new Date(nextMs).toISOString(),
      blocked: true,
      remainingDays: Math.max(1, Math.ceil((nextMs - now) / 86_400_000)),
    };
  }
  return {
    lastEmailChangedAt: lastIso,
    nextEmailChangeAt: null,
    blocked: false,
    remainingDays: 0,
  };
}

function recordUserEmailChanged(userId: string): void {
  emailChangeTimestamps[userId] = new Date().toISOString();
  saveEmailCooldowns();
}

function cleanupUserEmailCooldown(userId: string): void {
  if (emailChangeTimestamps[userId]) {
    delete emailChangeTimestamps[userId];
    saveEmailCooldowns();
  }
}

function validateUsernameFormat(raw: string): { valid: boolean; clean: string; error?: string } {
  const clean = raw.trim();
  if (clean.length < 3) {
    return { valid: false, clean, error: 'Le pseudo doit contenir au moins 3 caractères.' };
  }
  if (clean.length > 30) {
    return { valid: false, clean, error: 'Le pseudo ne doit pas dépasser 30 caractères.' };
  }
  if (clean.includes('@')) {
    return { valid: false, clean, error: 'Le pseudo ne doit pas contenir le caractère @.' };
  }
  if (!/^[a-zA-Z0-9_.\-\s]+$/.test(clean)) {
    return {
      valid: false,
      clean,
      error: 'Le pseudo ne peut contenir que des lettres, chiffres, espaces, _, - ou .',
    };
  }
  return { valid: true, clean };
}

async function listAllSupabaseAuthUsers(adminSb: SupabaseClient) {
  const all: Array<{
    id: string;
    email?: string;
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
    deleted_at?: string | null;
    user_metadata?: Record<string, unknown>;
  }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data: listData, error } = await adminSb.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) break;
    const batch = listData?.users ?? [];
    all.push(...(batch as typeof all));
    if (batch.length < 1000) break;
  }
  const active = all.filter((u) => !u.deleted_at);
  pruneUserDirectory(new Set(active.map((u) => u.id)));
  return active;
}

async function deleteSupabaseUserAndRelations(
  adminSb: SupabaseClient,
  targetId: string
): Promise<{ ok: boolean; error?: string }> {
  await Promise.allSettled([
    adminSb.from('notifications').delete().or(`recipient_id.eq.${targetId},actor_id.eq.${targetId}`),
    adminSb.from('user_roles').delete().eq('user_id', targetId),
    adminSb.from('user_presence').delete().eq('user_id', targetId),
    adminSb.from('favorites').delete().eq('user_id', targetId),
    adminSb.from('watch_events').delete().eq('user_id', targetId),
    adminSb.from('comments').delete().eq('user_id', targetId),
    adminSb.from('friendships').delete().or(`user_id.eq.${targetId},friend_id.eq.${targetId}`),
    adminSb.from('profiles').delete().eq('id', targetId),
  ]);
  const { error: delErr } = await adminSb.auth.admin.deleteUser(targetId, false);
  if (delErr && !String(delErr.message || '').toLowerCase().includes('not found')) {
    return { ok: false, error: delErr.message };
  }
  return { ok: true };
}

async function isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
  const target = username.trim().toLowerCase();
  if (!target) return false;

  if (!isSupabaseEnabled()) {
    return db.users.some(
      (u) => u.id !== excludeUserId && u.username.trim().toLowerCase() === target
    );
  }

  const adminSb = createAdminClient();
  const reader = adminSb ?? createAnonClient();
  try {
    const { data: rows } = await reader
      .from('profiles')
      .select('id,username')
      .ilike('username', target)
      .limit(10);
    if (
      Array.isArray(rows) &&
      rows.some(
        (r: { id?: string; username?: string }) =>
          String(r.id || '') !== (excludeUserId || '') &&
          String(r.username || '').trim().toLowerCase() === target
      )
    ) {
      return true;
    }
  } catch {
    // Continue to auth check
  }

  if (adminSb) {
    try {
      const users = await listAllSupabaseAuthUsers(adminSb);
      for (const au of users) {
        if (excludeUserId && au.id === excludeUserId) continue;
        const meta = (au.user_metadata ?? {}) as Record<string, unknown>;
        const uName =
          (typeof meta.username === 'string' && meta.username) ||
          (typeof meta.full_name === 'string' && meta.full_name) ||
          '';
        if (uName.trim().toLowerCase() === target) {
          return true;
        }
      }
      return false;
    } catch {
      // Fall back to directory if auth list failed
    }
  }

  if (isUsernameInDirectory(target, excludeUserId)) return true;
  return false;
}

async function findUnconfirmedUserIdByEmail(email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target || !isSupabaseEnabled()) return null;
  const adminSb = createAdminClient();
  if (!adminSb) return null;
  try {
    const users = await listAllSupabaseAuthUsers(adminSb);
    const match = users.find((u) => (u.email || '').trim().toLowerCase() === target);
    if (match && !match.email_confirmed_at && !match.confirmed_at) {
      return match.id;
    }
  } catch {
    // Non-fatal
  }
  return null;
}

async function isEmailTaken(
  email: string,
  options?: { allowUnconfirmed?: boolean }
): Promise<boolean> {
  const target = email.trim().toLowerCase();
  if (!target) return false;

  if (!isSupabaseEnabled()) {
    return db.users.some((u) => u.email.trim().toLowerCase() === target);
  }

  const adminSb = createAdminClient();
  if (adminSb) {
    try {
      const users = await listAllSupabaseAuthUsers(adminSb);
      const match = users.find((u) => (u.email || '').trim().toLowerCase() === target);
      if (!match) return false;
      if (options?.allowUnconfirmed && !match.email_confirmed_at && !match.confirmed_at) {
        return false;
      }
      return true;
    } catch {
      // Fall back to directory if auth list failed
    }
  }

  if (isEmailInDirectory(target)) return true;
  return false;
}

function mapSupabaseSignupError(rawMessage: string): { status: number; message: string } {
  const lower = rawMessage.toLowerCase();
  if (
    lower.includes('already registered') ||
    lower.includes('already exists') ||
    lower.includes('email_exists')
  ) {
    return { status: 409, message: 'Un compte utilise déjà cette adresse email.' };
  }
  if (lower.includes('duplicate') || lower.includes('unique') || lower.includes('profiles_username')) {
    return { status: 409, message: 'Ce pseudo est déjà utilisé. Veuillez en choisir un autre.' };
  }
  if (
    lower.includes('database error saving new user') ||
    lower.includes('database error creating new user')
  ) {
    return {
      status: 400,
      message:
        'Impossible d’enregistrer le profil dans la base Supabase (vérifiez que ce pseudo est unique et que la table profiles / trigger handle_new_user accepte la création du membre).',
    };
  }
  return { status: 400, message: rawMessage };
}

function createSeedDb(): DatabaseShape {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  const alfredId = '11111111-1111-4111-8111-111111111111';
  const mamisoaId = '22222222-2222-4222-8222-222222222222';
  const tahinaId = '33333333-3333-4333-8333-333333333333';

  const filmTrain = FALLBACK_ITEMS[0];
  const filmDisinvited = FALLBACK_ITEMS[1];
  const filmWeird = FALLBACK_ITEMS[2];
  const serieGift = FALLBACK_ITEMS[3];
  const serieSugar = FALLBACK_ITEMS[8];

  return {
    settings: {
      api_origin: DEFAULT_ORIGIN,
      embed_provider: DEFAULT_ORIGIN,
      tmdb_api_key: DEFAULT_TMDB_API_KEY,
      pinoy_api_url: DEFAULT_PINOY_API_URL,
      pinoy_media_base_url: DEFAULT_PINOY_MEDIA_BASE_URL,
      pinoy_player_template: DEFAULT_PINOY_PLAYER_TEMPLATE,
      pinoy_download_message: DEFAULT_PINOY_DOWNLOAD_MESSAGE,
      film_download_api_url: ENV_FILM_DOWNLOAD_API_URL,
      film_download_api_key: '',
      film_download_message: ENV_FILM_DOWNLOAD_MESSAGE,
      site_name: 'StreamWall',
      favicon_url: '/favicon.ico',
      players: { ...DEFAULT_PLAYERS },
    },
    users: [
      {
        id: alfredId,
        email: 'alfred@tapenaka.mg',
        passwordHash: hashPassword('tapenaka2026'),
        username: 'alfred',
        avatar: '/src/assets/images/avatar_member_alfred_1794922115601.jpg',
        role: 'admin',
        createdAt: iso(-14 * 86_400_000),
      },
      {
        id: mamisoaId,
        email: 'mamisoa@tapenaka.mg',
        passwordHash: hashPassword('tapenaka2026'),
        username: 'mamisoa',
        avatar: '/src/assets/images/avatar_member_mamisoa_1794922117135.jpg',
        role: 'member',
        createdAt: iso(-10 * 86_400_000),
      },
      {
        id: tahinaId,
        email: 'tahina@tapenaka.mg',
        passwordHash: hashPassword('tapenaka2026'),
        username: 'tahina',
        avatar: null,
        role: 'member',
        createdAt: iso(-6 * 86_400_000),
      },
    ],
    sessions: [],
    resetTokens: [],
    favorites: {
      [alfredId]: [filmTrain, serieGift, filmDisinvited],
      [mamisoaId]: [filmDisinvited, serieSugar],
      [tahinaId]: [filmWeird],
    },
    watchEvents: [
      {
        id: crypto.randomUUID(),
        userId: alfredId,
        item: filmTrain,
        season: 1,
        episode: 1,
        viewedAt: iso(-2 * 3_600_000),
      },
      {
        id: crypto.randomUUID(),
        userId: mamisoaId,
        item: filmTrain,
        season: 1,
        episode: 1,
        viewedAt: iso(-5 * 3_600_000),
      },
      {
        id: crypto.randomUUID(),
        userId: tahinaId,
        item: filmTrain,
        season: 1,
        episode: 1,
        viewedAt: iso(-18 * 3_600_000),
      },
      {
        id: crypto.randomUUID(),
        userId: mamisoaId,
        item: serieGift,
        season: 1,
        episode: 1,
        viewedAt: iso(-1 * 3_600_000),
      },
      {
        id: crypto.randomUUID(),
        userId: alfredId,
        item: serieGift,
        season: 1,
        episode: 2,
        viewedAt: iso(-26 * 3_600_000),
      },
      {
        id: crypto.randomUUID(),
        userId: alfredId,
        item: filmDisinvited,
        season: 1,
        episode: 1,
        viewedAt: iso(-48 * 3_600_000),
      },
      {
        id: crypto.randomUUID(),
        userId: tahinaId,
        item: filmDisinvited,
        season: 1,
        episode: 1,
        viewedAt: iso(-52 * 3_600_000),
      },
      {
        id: crypto.randomUUID(),
        userId: mamisoaId,
        item: serieSugar,
        season: 1,
        episode: 1,
        viewedAt: iso(-72 * 3_600_000),
      },
    ],
    watchProgress: {
      [alfredId]: [
        {
          item: serieGift,
          tmdbId: serieGift.tmdbId ?? '314647',
          season: 1,
          episode: 2,
          updatedAt: iso(-2 * 3_600_000),
          watchedEpisodes: ['S1E1', 'S1E2'],
        },
        {
          item: filmTrain,
          tmdbId: filmTrain.tmdbId ?? '1541560',
          season: 1,
          episode: 1,
          updatedAt: iso(-6 * 3_600_000),
          watchedEpisodes: ['S1E1'],
        },
      ],
      [mamisoaId]: [
        {
          item: serieGift,
          tmdbId: serieGift.tmdbId ?? '314647',
          season: 1,
          episode: 1,
          updatedAt: iso(-1 * 3_600_000),
          watchedEpisodes: ['S1E1'],
        },
      ],
    },
    comments: [
      {
        id: 'c1000000-0000-4000-8000-000000000001',
        itemType: 'film',
        itemId: '24044',
        itemTitle: 'Stop! That! Train!',
        userId: mamisoaId,
        username: 'mamisoa',
        avatar: '/src/assets/images/avatar_member_mamisoa_1794922117135.jpg',
        parentId: null,
        body: "Rythme super fun du début à la fin ! @alfred la qualité TRUEFRENCH passe nickel sur le lecteur membre.",
        createdAt: iso(-4 * 3_600_000),
      },
      {
        id: 'c1000000-0000-4000-8000-000000000002',
        itemType: 'film',
        itemId: '24044',
        itemTitle: 'Stop! That! Train!',
        userId: alfredId,
        username: 'alfred',
        avatar: '/src/assets/images/avatar_member_alfred_1794922115601.jpg',
        parentId: 'c1000000-0000-4000-8000-000000000001',
        body: "Carrément @mamisoa ! J’ai aussi corrigé le proxy HLS pour que tous les serveurs chargent instantanément.",
        createdAt: iso(-3 * 3_600_000),
      },
      {
        id: 'c1000000-0000-4000-8000-000000000003',
        itemType: 'serie',
        itemId: '9650',
        itemTitle: 'GIFT',
        userId: tahinaId,
        username: 'tahina',
        avatar: null,
        parentId: null,
        body: 'Belle découverte dramatique, le premier épisode pose une ambiance très juste.',
        createdAt: iso(-12 * 3_600_000),
      },
    ],
    friendships: [
      { userId: alfredId, friendId: mamisoaId, createdAt: iso(-8 * 86_400_000) },
      { userId: mamisoaId, friendId: alfredId, createdAt: iso(-8 * 86_400_000) },
      { userId: alfredId, friendId: tahinaId, createdAt: iso(-3 * 86_400_000) },
    ],
    presence: {
      [mamisoaId]: {
        userId: mamisoaId,
        lastSeen: iso(-25_000),
        currentItem: serieGift,
        page: '/serie/9650',
      },
    },
    ratings: [
      { userId: alfredId, itemKey: 'film:24044', score: 5, updatedAt: iso(-3 * 3_600_000) },
      { userId: mamisoaId, itemKey: 'film:24044', score: 4, updatedAt: iso(-4 * 3_600_000) },
      { userId: tahinaId, itemKey: 'serie:9650', score: 5, updatedAt: iso(-12 * 3_600_000) },
    ],
  };
}

function loadDb(): DatabaseShape {
  const parsed = readModuleSnapshot<DatabaseShape>('store', DB_FILE);
  if (parsed && Array.isArray(parsed.users) && parsed.settings) {
    return parsed;
  }
  const seeded = createSeedDb();
  saveDb(seeded);
  return seeded;
}

function saveDb(state: DatabaseShape): void {
  writeModuleSnapshot('store', state);
}

const db: DatabaseShape = loadDb();

const upstreamCache = new TimedLruCache<unknown>(2_000);
const upstreamCoalescer = new InFlightCoalescer();

function getCached<T>(key: string): T | null {
  return upstreamCache.get(key) as T | null;
}

function getStaleCached<T>(key: string): T | null {
  return upstreamCache.getStale(key) as T | null;
}

function setCached<T>(key: string, value: T, ttlMs: number, staleTtlMs = ttlMs * 3): T {
  return upstreamCache.set(key, value, ttlMs, staleTtlMs) as T;
}

function coalesceUpstream<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return upstreamCoalescer.run(key, fn);
}

async function getOrigin(): Promise<string> {
  const localOrigin = (db.settings.api_origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
  if (isSupabaseEnabled()) {
    return sbGetApiOrigin(localOrigin);
  }
  return localOrigin;
}

async function getEmbedProvider(): Promise<string> {
  const localProvider = (
    db.settings.embed_provider ||
    db.settings.api_origin ||
    DEFAULT_ORIGIN
  ).replace(/\/+$/, '');
  if (isSupabaseEnabled()) {
    return sbGetEmbedProvider(localProvider);
  }
  return localProvider;
}

function resolveAppOrigin(req: express.Request): string {
  const headerOrigin = String(req.headers.origin || '').trim().replace(/\/+$/, '');
  if (headerOrigin) {
    setBillingAppUrl(headerOrigin);
    return headerOrigin;
  }
  const envUrl = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl) {
    setBillingAppUrl(envUrl);
    return envUrl;
  }
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const built = host ? `${proto}://${host}`.replace(/\/+$/, '') : '';
  if (built) setBillingAppUrl(built);
  return built;
}

function dedupTop6History(events: WatchEventRecord[]): WatchEventRecord[] {
  const out: WatchEventRecord[] = [];
  const seen = new Set<string>();
  const sorted = [...events].sort(
    (a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime()
  );
  for (const ev of sorted) {
    const key = `${ev.item.item_type}:${ev.item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
    if (out.length >= 6) break;
  }
  return out;
}

async function getTmdbApiKey(): Promise<string> {
  const localKey = (db.settings.tmdb_api_key || DEFAULT_TMDB_API_KEY).trim();
  if (isSupabaseEnabled()) {
    return sbGetTmdbApiKey(localKey);
  }
  return localKey;
}

async function getPinoyApiUrl(): Promise<string> {
  if (isPinoyModuleDeleted()) return '';
  const pinoyMod = getCustomModule('pinoy');
  if (pinoyMod && pinoyMod.endpoints.apiUrl.trim()) {
    return pinoyMod.endpoints.apiUrl.trim();
  }
  const localUrl = (db.settings.pinoy_api_url || DEFAULT_PINOY_API_URL).trim();
  if (isSupabaseEnabled()) {
    return sbGetPinoyApiUrl(localUrl);
  }
  return localUrl;
}

async function getPinoyMediaBaseUrl(): Promise<string> {
  const pinoyMod = getCustomModule('pinoy');
  if (pinoyMod && pinoyMod.endpoints.mediaBaseUrl.trim()) {
    return pinoyMod.endpoints.mediaBaseUrl.trim();
  }
  const localUrl = (db.settings.pinoy_media_base_url ?? DEFAULT_PINOY_MEDIA_BASE_URL).trim();
  if (isSupabaseEnabled()) {
    return sbGetPinoyMediaBaseUrl(localUrl);
  }
  return localUrl;
}

async function getPinoyPlayerTemplate(): Promise<string> {
  const pinoyMod = getCustomModule('pinoy');
  if (pinoyMod && pinoyMod.player.playerUrlTemplate.trim()) {
    return pinoyMod.player.playerUrlTemplate.trim();
  }
  const localTpl = (db.settings.pinoy_player_template ?? DEFAULT_PINOY_PLAYER_TEMPLATE).trim();
  if (isSupabaseEnabled()) {
    return sbGetPinoyPlayerTemplate(localTpl);
  }
  return localTpl;
}

async function getPinoyDownloadMessage(): Promise<string> {
  const pinoyMod = getCustomModule('pinoy');
  if (pinoyMod && pinoyMod.player.downloadRestrictionMessage.trim()) {
    return sanitizePinoyDownloadMessage(pinoyMod.player.downloadRestrictionMessage);
  }
  const localMsg = sanitizePinoyDownloadMessage(
    db.settings.pinoy_download_message ?? DEFAULT_PINOY_DOWNLOAD_MESSAGE
  );
  if (isSupabaseEnabled()) {
    return sanitizePinoyDownloadMessage(await sbGetPinoyDownloadMessage(localMsg));
  }
  return localMsg;
}

async function getFilmDownloadApiUrl(): Promise<string> {
  const raw =
    db.settings.film_download_api_url !== undefined
      ? db.settings.film_download_api_url
      : ENV_FILM_DOWNLOAD_API_URL;
  const localUrl = String(raw || '').trim();
  if (isSupabaseEnabled()) {
    return sbGetFilmDownloadApiUrl(localUrl);
  }
  return localUrl;
}

function getFilmDownloadApiKey(): string {
  return (db.settings.film_download_api_key || ENV_FILM_DOWNLOAD_API_KEY || '').trim();
}

async function getFilmDownloadMessage(): Promise<string> {
  const localMsg = sanitizeFilmDownloadMessage(
    db.settings.film_download_message ?? ENV_FILM_DOWNLOAD_MESSAGE
  );
  if (isSupabaseEnabled()) {
    return sanitizeFilmDownloadMessage(await sbGetFilmDownloadMessage(localMsg));
  }
  return localMsg;
}

async function getPlayerTemplates(): Promise<PlayerTemplates> {
  if (isSupabaseEnabled()) {
    return sbGetPlayerTemplates();
  }
  return db.settings.players;
}

const DEFAULT_SITE_CONFIG: SiteConfig = {
  siteName: 'StreamWall',
  faviconUrl: '/favicon.ico',
};

async function getSiteConfig(): Promise<SiteConfig> {
  const local: SiteConfig = {
    siteName: (db.settings.site_name || DEFAULT_SITE_CONFIG.siteName).trim() || DEFAULT_SITE_CONFIG.siteName,
    faviconUrl: (db.settings.favicon_url || DEFAULT_SITE_CONFIG.faviconUrl).trim() || DEFAULT_SITE_CONFIG.faviconUrl,
  };
  if (isSupabaseEnabled()) {
    return sbGetSiteConfig(local);
  }
  return local;
}

setMailSiteNameResolver(async () => (await getSiteConfig()).siteName);

const FAVICON_MIME_BY_EXT: Record<string, string> = {
  ico: 'image/x-icon',
  png: 'image/png',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function findUploadedFaviconFile(): { filePath: string; contentType: string } | null {
  try {
    if (!fs.existsSync(DATA_DIR)) return null;
    for (const ext of Object.keys(FAVICON_MIME_BY_EXT)) {
      const candidate = path.join(DATA_DIR, `tapenaka-favicon.${ext}`);
      if (fs.existsSync(candidate)) {
        return { filePath: candidate, contentType: FAVICON_MIME_BY_EXT[ext] };
      }
    }
  } catch {
    // Ignore fs errors
  }
  return null;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function extractToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies['tapenaka_session'] || cookies['streamwall_watch'] || null;
}

interface AuthResolution {
  user: UserProfile;
  token: string;
  sbClient: SupabaseClient | null;
}

function enrichUserProfile(user: UserProfile): UserProfile {
  registerUserDirectoryEntry(user.id, user.email, user.username);
  const subscription = getUserSubscription(user.id);
  const ban = getUserBanInfo(user.id);
  const emailCooldown = getUserEmailChangeStatus(user.id);
  return {
    ...user,
    avatar: resolveUserAvatar(user.id, user.avatar),
    isPro: subscription.tier === 'pro',
    subscription,
    theme: getUserTheme(user.id),
    banned: Boolean(ban),
    banReason: ban?.reason || null,
    lastEmailChangedAt: emailCooldown.lastEmailChangedAt,
    nextEmailChangeAt: emailCooldown.nextEmailChangeAt,
  };
}

function touchAuthPresence(req: express.Request, userId: string): void {
  try {
    const geo = resolveGeoFromRequest(req);
    const ua = parseUserAgent(String(req.headers['user-agent'] ?? ''));
    touchActiveUserPresence({
      sessionId: `u_${userId}`,
      userId,
      countryCode: geo.countryCode,
      countryName: geo.countryName,
      region: geo.region,
      city: geo.city,
      deviceType: ua.deviceType,
      os: ua.os,
      browser: ua.browser,
    });
  } catch {
    // Non-fatal
  }
}

async function resolveAuth(req: express.Request): Promise<AuthResolution | null> {
  const token = extractToken(req);
  if (!token) return null;

  if (isSupabaseEnabled()) {
    const resolved = token.startsWith('sws_')
      ? await resolvePersistentSupabaseSession(token)
      : await sbResolveUser(token);
    if (!resolved) return null;
    if (isUserBanned(resolved.user.id)) return null;
    touchAuthPresence(req, resolved.user.id);
    return { user: enrichUserProfile(resolved.user), token, sbClient: resolved.client };
  }

  let userId: string | null = null;
  const persistent = getPersistentSession(token);
  if (persistent && persistent.provider === 'local') {
    userId = persistent.userId;
  } else {
    const legacy = db.sessions.find((s) => s.token === token);
    if (legacy) userId = legacy.userId;
  }

  if (!userId) return null;
  const user = db.users.find((u) => u.id === userId);
  if (!user) return null;
  if (isUserBanned(user.id)) return null;
  touchAuthPresence(req, user.id);
  return {
    token,
    sbClient: null,
    user: enrichUserProfile({
      id: user.id,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      createdAt: user.createdAt,
    }),
  };
}

function computeLocalRankings(days: number): RankingEntry[] {
  const since = Date.now() - days * 86_400_000;
  const map = new Map<string, { item: Item; viewers: Set<string>; plays: number; lastViewed: number }>();
  for (const ev of db.watchEvents) {
    const ts = new Date(ev.viewedAt).getTime();
    if (ts < since) continue;
    const key = `${ev.item.item_type}:${ev.item.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.viewers.add(ev.userId);
      existing.plays += 1;
      if (ts > existing.lastViewed) existing.lastViewed = ts;
    } else {
      map.set(key, {
        item: ev.item,
        viewers: new Set([ev.userId]),
        plays: 1,
        lastViewed: ts,
      });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.viewers.size - a.viewers.size || b.plays - a.plays || b.lastViewed - a.lastViewed)
    .slice(0, 12)
    .map((r) => ({ item: r.item, viewers: r.viewers.size, plays: r.plays }));
}

interface IndexedCatalogEntry {
  id: string;
  titre: string;
  poster: string | null;
  backdrop: string | null;
  descr: string | null;
  trailer: string | null;
  genre: string | null;
  annee: number | null;
  langue: string | null;
  qualite: string | null;
  tmdbId: string | null;
  item_type: ItemType;
  source: 'films' | 'series';
}

const catalogIndex = new Map<string, IndexedCatalogEntry>();

function indexCatalogEntry(entry: IndexedCatalogEntry): void {
  if (!entry.id) return;
  if (catalogIndex.size > 10_000) {
    const oldest = catalogIndex.keys().next().value;
    if (oldest) catalogIndex.delete(oldest);
  }
  catalogIndex.set(`${entry.item_type}:${entry.id}`, entry);
  const endpointKey = `${entry.source === 'films' ? 'film' : 'serie'}:${entry.id}`;
  if (!catalogIndex.has(endpointKey)) {
    catalogIndex.set(endpointKey, entry);
  }
}

function getIndexedCatalogEntry(type: ItemType, id: string): IndexedCatalogEntry | null {
  return (
    catalogIndex.get(`${type}:${id}`) ??
    (type === 'anime'
      ? catalogIndex.get(`serie:${id}`) ?? catalogIndex.get(`film:${id}`)
      : null) ??
    catalogIndex.get(`film:${id}`) ??
    catalogIndex.get(`serie:${id}`) ??
    null
  );
}

function findIndexedCatalogByTmdb(
  tmdbId: string,
  mediaType: 'film' | 'serie'
): { id: string; item_type: ItemType; titre: string } | null {
  const cleanTmdb = String(tmdbId || '').trim();
  if (!cleanTmdb) return null;
  for (const entry of catalogIndex.values()) {
    if (entry.tmdbId && String(entry.tmdbId) === cleanTmdb) {
      if (mediaType === 'film' && entry.item_type === 'film') {
        return { id: entry.id, item_type: entry.item_type, titre: entry.titre };
      }
      if (mediaType === 'serie' && entry.item_type !== 'film') {
        return { id: entry.id, item_type: entry.item_type, titre: entry.titre };
      }
    }
  }
  return null;
}

function parseKorotokoRow(r: Record<string, unknown>): IndexedCatalogEntry {
  const genre = (r.genre as string) || null;
  const categorie = String(r.categorie ?? '').toLowerCase();
  const isFilm = r.source === 'films' || r.type === 'film' || categorie === 'film';
  const itemType: ItemType = isFilm
    ? 'film'
    : categorie === 'anime' || /anim/i.test(genre ?? '')
      ? 'anime'
      : 'serie';
  const entry: IndexedCatalogEntry = {
    id: String(r.id ?? ''),
    titre: String(r.titre ?? ''),
    poster: (r.poster as string) || null,
    backdrop: (r.backdrop as string) || (r.baggio as string) || null,
    descr: ((r.description as string) || (r.descr as string) || null)?.trim() || null,
    trailer: (r.trailer as string) || null,
    genre,
    annee: r.annee ? Number(r.annee) : null,
    langue: (r.langue as string) || null,
    qualite: (r.qualite as string) || null,
    tmdbId: r.tmdbId ? String(r.tmdbId) : null,
    item_type: itemType,
    source: r.source === 'series' ? 'series' : isFilm ? 'films' : 'series',
  };
  indexCatalogEntry(entry);
  return entry;
}

async function fetchKorotokoPageRaw(
  origin: string,
  categorie: string,
  page: number,
  limit = 50
): Promise<{ pages: number; entries: IndexedCatalogEntry[] }> {
  const p = new URLSearchParams({
    tri: 'recent',
    limit: String(limit),
    page: String(page),
  });
  if (categorie) p.set('categorie', categorie);
  const res = await fetch(`${origin}/api/korotoko.php?${p.toString()}`, {
    signal: AbortSignal.timeout(9_000),
    headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall)' },
  });
  if (!res.ok) return { pages: 1, entries: [] };
  const json = (await res.json()) as {
    pages?: number;
    data?: Array<Record<string, unknown>>;
  };
  const entries = (json.data ?? []).map(parseKorotokoRow);
  return { pages: Math.max(1, Number(json.pages) || 1), entries };
}

async function findCatalogEntryById(
  origin: string,
  type: ItemType,
  id: string
): Promise<IndexedCatalogEntry | null> {
  const existing = getIndexedCatalogEntry(type, id);
  if (existing) return existing;

  const targetNum = Number(id);
  const categoriesToTry =
    type === 'anime' ? ['anime', 'film', 'serie'] : [type === 'film' ? 'film' : 'serie'];

  for (const cat of categoriesToTry) {
    try {
      const p1 = await fetchKorotokoPageRaw(origin, cat, 1, 50);
      const hit1 = p1.entries.find((e) => e.id === id);
      if (hit1) return hit1;

      if (!Number.isFinite(targetNum) || targetNum <= 0 || p1.pages <= 1 || p1.entries.length === 0) {
        continue;
      }

      const minPage1Id = Number(p1.entries[p1.entries.length - 1]?.id ?? 0);
      if (minPage1Id > 0 && targetNum > minPage1Id) {
        continue;
      }

      let low = 2;
      let high = p1.pages;
      let steps = 0;
      while (low <= high && steps < 12) {
        steps += 1;
        const mid = Math.floor((low + high) / 2);
        const pageData = await fetchKorotokoPageRaw(origin, cat, mid, 50);
        const hit = pageData.entries.find((e) => e.id === id);
        if (hit) return hit;
        if (pageData.entries.length === 0) break;

        const firstId = Number(pageData.entries[0]?.id ?? 0);
        const lastId = Number(pageData.entries[pageData.entries.length - 1]?.id ?? 0);
        if (firstId > 0 && targetNum > firstId) {
          high = mid - 1;
        } else if (lastId > 0 && targetNum < lastId) {
          low = mid + 1;
        } else {
          break;
        }
      }
    } catch {
      // Try next category
    }
  }
  return getIndexedCatalogEntry(type, id);
}

async function fetchUpstreamSlider(): Promise<{ items: Slide[]; live: boolean }> {
  const origin = await getOrigin();
  const cacheKey = `slider:${origin}`;
  const cached = getCached<{ items: Slide[]; live: boolean }>(cacheKey);
  if (cached) return cached;

  return coalesceUpstream(cacheKey, async () => {
    const recheck = getCached<{ items: Slide[]; live: boolean }>(cacheKey);
    if (recheck) return recheck;

    try {
      const res = await fetch(`${origin}/api/api_slider.php`, {
        signal: AbortSignal.timeout(9_000),
        headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const items: Slide[] = (json.items ?? []).slice(0, 8).map((r) => {
        const genre = (r.genre as string) || null;
        const t: ItemType = r.type === 'film' ? 'film' : /anim/i.test(genre ?? '') ? 'anime' : 'serie';
        const slide: Slide = {
          id: String(r.id ?? ''),
          titre: String(r.titre ?? ''),
          poster: (r.poster as string) || null,
          qualite: (r.qualite as string) || null,
          langue: (r.langue as string) || null,
          item_type: t,
          saison: null,
          genre,
          annee: r.annee ? Number(r.annee) : null,
          tmdbId: r.tmdbId ? String(r.tmdbId) : null,
          descr: (r.descr as string) || (r.description as string) || null,
          backdrop: (r.backdrop as string) || (r.baggio as string) || null,
          trailer: (r.trailer as string) || null,
        };
        indexCatalogEntry({
          id: slide.id,
          titre: slide.titre,
          poster: slide.poster ?? null,
          backdrop: slide.backdrop ?? null,
          descr: slide.descr ?? null,
          trailer: slide.trailer ?? null,
          genre: slide.genre ?? null,
          annee: slide.annee ?? null,
          langue: slide.langue ?? null,
          qualite: slide.qualite ?? null,
          tmdbId: slide.tmdbId ?? null,
          item_type: t,
          source: t === 'film' ? 'films' : 'series',
        });
        return slide;
      });
      if (items.length > 0) {
        return setCached(cacheKey, { items, live: true }, 120_000, 600_000);
      }
    } catch {
      // Fallback
    }
    return getStaleCached<{ items: Slide[]; live: boolean }>(cacheKey) ?? { items: FALLBACK_SLIDER, live: false };
  });
}

function sanitizeLastSeriesPoster(raw: unknown, origin: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      return null;
    }
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const cleanRel = trimmed.replace(/^\/+/, '');
  return cleanRel ? `${origin.replace(/\/+$/, '')}/${cleanRel}` : null;
}

async function fetchUpstreamLastSeries(): Promise<{ items: LastSeriesItem[]; live: boolean }> {
  const origin = await getOrigin();
  const cacheKey = `last_serie:asc:${origin}`;
  const cached = getCached<{ items: LastSeriesItem[]; live: boolean }>(cacheKey);
  if (cached) return cached;

  return coalesceUpstream(cacheKey, async () => {
    const recheck = getCached<{ items: LastSeriesItem[]; live: boolean }>(cacheKey);
    if (recheck) return recheck;

    try {
      const res = await fetch(`${origin}/api/last_serie.php?short=asc`, {
        signal: AbortSignal.timeout(9_000),
        headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const rawItems = Array.isArray(json.items) ? json.items : [];
      const items: LastSeriesItem[] = [];

      for (const r of rawItems) {
        if (items.length >= 18) break;
        if (!r || typeof r !== 'object') continue;
        const idStr = String(r.id ?? r.serie_id ?? '').trim();
        if (!idStr) continue;

        const titreFull =
          typeof r.titre_full === 'string' && r.titre_full.trim()
            ? r.titre_full.trim()
            : typeof r.titre === 'string'
              ? r.titre.trim()
              : '';
        if (!titreFull) continue;

        const baseTitre =
          typeof r.titre === 'string' && r.titre.trim() ? r.titre.trim() : titreFull;
        const poster = sanitizeLastSeriesPoster(r.poster, origin);
        const backdrop = sanitizeLastSeriesPoster(r.backdrop, origin);
        const genre = typeof r.genre === 'string' && r.genre.trim() ? r.genre.trim() : null;
        const anneeNum = r.annee !== undefined && r.annee !== null ? Number(r.annee) : NaN;
        const annee = Number.isFinite(anneeNum) && anneeNum > 1900 ? anneeNum : null;
        const langue = typeof r.langue === 'string' && r.langue.trim() ? r.langue.trim() : null;
        const qualite = typeof r.qualite === 'string' && r.qualite.trim() ? r.qualite.trim() : null;
        const tmdbId =
          r.tmdbId !== undefined && r.tmdbId !== null && String(r.tmdbId).trim()
            ? String(r.tmdbId).trim()
            : null;
        const saisonNum = r.saison !== undefined && r.saison !== null ? Number(r.saison) : NaN;
        const saison = Number.isFinite(saisonNum) ? saisonNum : null;
        const dernierEpNum =
          r.dernier_episode !== undefined && r.dernier_episode !== null
            ? Number(r.dernier_episode)
            : NaN;
        const totalEpNum =
          r.total_episodes !== undefined && r.total_episodes !== null
            ? Number(r.total_episodes)
            : NaN;
        const descr =
          typeof r.description === 'string' && r.description.trim()
            ? r.description.trim()
            : typeof r.descr === 'string' && r.descr.trim()
              ? r.descr.trim()
              : null;

        indexCatalogEntry({
          id: idStr,
          titre: baseTitre,
          poster,
          backdrop,
          descr,
          trailer: typeof r.trailer === 'string' && r.trailer.trim() ? r.trailer.trim() : null,
          genre,
          annee,
          langue,
          qualite,
          tmdbId,
          item_type: 'serie',
          source: 'series',
        });

        items.push({
          id: idStr,
          titre: titreFull,
          poster,
          qualite,
          langue,
          item_type: 'serie',
          saison,
          genre,
          annee,
          tmdbId,
          dernier_episode: Number.isFinite(dernierEpNum) && dernierEpNum >= 0 ? dernierEpNum : null,
          total_episodes: Number.isFinite(totalEpNum) && totalEpNum >= 0 ? totalEpNum : null,
        });
      }

      if (items.length > 0) {
        return setCached(cacheKey, { items, live: true }, 90_000, 450_000);
      }
    } catch {
      // Fallback to stale cache when upstream is temporarily unreachable
    }

    const stale = getStaleCached<{ items: LastSeriesItem[]; live: boolean }>(cacheKey);
    return stale ?? { items: [], live: false };
  });
}

function buildKorotokoParams(f: CatalogueFilters): URLSearchParams {
  const sortMode = f.q ? 'pertinence' : f.sort === 'pertinence' ? 'pertinence' : 'recent';
  const p = new URLSearchParams({
    tri: sortMode,
    limit: '24',
    page: String(Math.max(1, f.page)),
  });
  if (f.q) p.set('titre', f.q);
  if (f.type === 'film' || f.type === 'serie' || f.type === 'anime') {
    p.set('categorie', f.type);
  }
  if (f.genre) p.set('genre', f.genre);
  if (/^\d{4}$/.test(f.year)) p.set('annee', f.year);
  return p;
}

async function fetchUpstreamCatalogue(filters: CatalogueFilters): Promise<CataloguePage> {
  const origin = await getOrigin();
  const params = buildKorotokoParams(filters);
  const cacheKey = `cat:${origin}:${params.toString()}:${filters.lang}:${filters.sort}`;
  const cached = getCached<CataloguePage>(cacheKey);
  if (cached) return cached;

  return coalesceUpstream(cacheKey, async () => {
    const recheck = getCached<CataloguePage>(cacheKey);
    if (recheck) return recheck;

    try {
      const res = await fetch(`${origin}/api/korotoko.php?${params.toString()}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        total?: number;
        page?: number;
        pages?: number;
        approximatif?: boolean;
        data?: Array<Record<string, unknown>>;
      };
      let items: Item[] = (json.data ?? []).map((r) => {
        const entry = parseKorotokoRow(r);
        return {
          id: entry.id,
          titre: entry.titre,
          poster: entry.poster,
          qualite: entry.qualite,
          langue: entry.langue,
          item_type: entry.item_type,
          saison: null,
          genre: entry.genre,
          annee: entry.annee,
          tmdbId: entry.tmdbId,
        };
      });

      if (filters.lang === 'vf') {
        items = items.filter((i) => /french|vf/i.test(i.langue ?? ''));
      } else if (filters.lang === 'vostfr') {
        items = items.filter((i) => /vostfr/i.test(i.langue ?? ''));
      }

      if (filters.sort === 'annee_desc') {
        items = [...items].sort((a, b) => (b.annee ?? 0) - (a.annee ?? 0));
      }

      const pageData: CataloguePage = {
        total: json.total ?? items.length,
        page: json.page ?? filters.page,
        pages: Math.max(1, json.pages ?? 1),
        approximatif: Boolean(json.approximatif),
        upstreamStatus: 'live',
        items,
      };
      return setCached(cacheKey, pageData, 90_000, 450_000);
    } catch (err) {
      const stale = getStaleCached<CataloguePage>(cacheKey);
      if (stale) return stale;

      recordErrorLog({
        level: 'warn',
        source: 'upstream',
        message: 'Échec de récupération du catalogue upstream (bascule fallback)',
        route: '/api/catalogue',
        context: { q: filters.q, type: filters.type, page: filters.page },
        err,
      });
      const qLower = filters.q.toLowerCase();
      let filtered = FALLBACK_ITEMS.filter((it) => {
        if (qLower && !it.titre.toLowerCase().includes(qLower)) return false;
        if (filters.type !== 'all' && it.item_type !== filters.type) return false;
        if (
          filters.genre &&
          !(it.genre ?? '')
            .split(',')
            .map((g) => g.trim().toLowerCase())
            .includes(filters.genre.toLowerCase())
        ) {
          return false;
        }
        if (filters.year && String(it.annee ?? '') !== filters.year) return false;
        if (filters.lang === 'vf' && !/french|vf/i.test(it.langue ?? '')) return false;
        if (filters.lang === 'vostfr' && !/vostfr/i.test(it.langue ?? '')) return false;
        return true;
      });
      if (filters.sort === 'annee_desc') {
        filtered = [...filtered].sort((a, b) => (b.annee ?? 0) - (a.annee ?? 0));
      }
      return {
        total: filtered.length,
        page: 1,
        pages: 1,
        approximatif: false,
        upstreamStatus: 'fallback',
        items: filtered,
      };
    }
  });
}

async function fetchUpstreamGenres(): Promise<string[]> {
  const apiKey = (await getTmdbApiKey()).trim();
  if (!apiKey) {
    return FALLBACK_GENRES;
  }

  const cacheKey = `tmdb-genres:fr-FR:${apiKey.slice(0, 6)}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached && cached.length > 0) return cached;

  return coalesceUpstream(cacheKey, async () => {
    const recheck = getCached<string[]>(cacheKey);
    if (recheck && recheck.length > 0) return recheck;

    try {
      const [movieRes, tvRes] = await Promise.all([
        fetch(
          `https://api.themoviedb.org/3/genre/movie/list?language=fr-FR&api_key=${encodeURIComponent(apiKey)}`,
          {
            signal: AbortSignal.timeout(7_000),
            headers: { accept: 'application/json' },
          }
        ),
        fetch(
          `https://api.themoviedb.org/3/genre/tv/list?language=fr-FR&api_key=${encodeURIComponent(apiKey)}`,
          {
            signal: AbortSignal.timeout(7_000),
            headers: { accept: 'application/json' },
          }
        ),
      ]);

      const merged = new Set<string>();
      if (movieRes.ok) {
        const movieJson = (await movieRes.json()) as { genres?: Array<{ id: number; name?: string }> };
        for (const g of movieJson.genres ?? []) {
          const name = String(g.name ?? '').trim();
          if (name) merged.add(name);
        }
      }
      if (tvRes.ok) {
        const tvJson = (await tvRes.json()) as { genres?: Array<{ id: number; name?: string }> };
        for (const g of tvJson.genres ?? []) {
          const name = String(g.name ?? '').trim();
          if (name) merged.add(name);
        }
      }

      const sorted = [...merged].sort((a, b) => a.localeCompare(b, 'fr'));
      if (sorted.length > 0) {
        return setCached(cacheKey, sorted, 6 * 3_600_000, 24 * 3_600_000);
      }
    } catch (err) {
      const stale = getStaleCached<string[]>(cacheKey);
      if (stale && stale.length > 0) return stale;

      recordErrorLog({
        level: 'warn',
        source: 'upstream',
        message: 'Échec de récupération des genres TMDB (bascule fallback)',
        route: '/api/catalogue/genres',
        err,
      });
    }
    return FALLBACK_GENRES;
  });
}

interface RawUpstreamDetailJson {
  item?: Record<string, unknown>;
  cast?: Array<Record<string, unknown>>;
  related?: Array<Record<string, unknown>>;
  episodes?: Array<Record<string, unknown>>;
}

async function queryDetailsApi(
  origin: string,
  lookupId: string,
  endpointType: 'film' | 'serie'
): Promise<RawUpstreamDetailJson | null> {
  const res = await fetch(
    `${origin}/details_api.php?id=${encodeURIComponent(lookupId)}&type=${encodeURIComponent(endpointType)}`,
    {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall)' },
    }
  );
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as RawUpstreamDetailJson | null;
}

async function fetchUpstreamDetail(
  type: ItemType,
  id: string
): Promise<{
  item: DetailItem | null;
  cast: CastMember[];
  related: Item[];
  episodes: Episode[];
  live: boolean;
}> {
  const origin = await getOrigin();
  const cacheKey = `detail:v2:${origin}:${type}:${id}`;
  const cached = getCached<{
    item: DetailItem | null;
    cast: CastMember[];
    related: Item[];
    episodes: Episode[];
    live: boolean;
  }>(cacheKey);
  if (cached) return cached;

  return coalesceUpstream(cacheKey, async () => {
    const recheck = getCached<{
      item: DetailItem | null;
      cast: CastMember[];
      related: Item[];
      episodes: Episode[];
      live: boolean;
    }>(cacheKey);
    if (recheck) return recheck;

    let usedEndpointType: 'film' | 'serie' = type === 'film' ? 'film' : 'serie';

    try {
      let json = await queryDetailsApi(origin, id, usedEndpointType);

      if ((!json?.item || String(json.item.id ?? '') !== id) && type === 'anime') {
        const filmJson = await queryDetailsApi(origin, id, 'film');
        if (filmJson?.item && String(filmJson.item.id ?? '') === id) {
          json = filmJson;
          usedEndpointType = 'film';
        }
      }

      let matchedByExactId = Boolean(json?.item && String(json.item.id ?? '') === id);
      let indexedFallback: IndexedCatalogEntry | null = null;

      // Upstream details_api.php queries tmdbId BEFORE id; if another title's tmdbId matches our requested id,
      // recover the true catalog entry by its exact id instead of returning the collided title.
      if (!matchedByExactId) {
        indexedFallback = await findCatalogEntryById(origin, type, id);
        if (indexedFallback) {
          usedEndpointType = indexedFallback.source === 'films' ? 'film' : 'serie';
          if (indexedFallback.tmdbId) {
            const viaTmdb = await queryDetailsApi(origin, indexedFallback.tmdbId, usedEndpointType);
            if (viaTmdb?.item && String(viaTmdb.item.id ?? '') === id) {
              json = viaTmdb;
              matchedByExactId = true;
            } else if (
              viaTmdb?.item &&
              String(viaTmdb.item.tmdbId ?? '') === String(indexedFallback.tmdbId)
            ) {
              // Two catalog items share the same tmdbId: keep metadata from indexedFallback and cast/episodes from viaTmdb
              json = viaTmdb;
            }
          }
        }
      }

      if (!matchedByExactId && !indexedFallback) {
        return { item: null, cast: [], related: [], episodes: [], live: true };
      }

      const raw = matchedByExactId ? json?.item : undefined;
      const genre = (raw?.genre as string) || indexedFallback?.genre || null;
      const resolvedType: ItemType = indexedFallback
        ? indexedFallback.item_type
        : usedEndpointType === 'film' || raw?.type === 'film'
          ? 'film'
          : type === 'anime' || raw?.type === 'anime' || /anim/i.test(genre ?? '')
            ? 'anime'
            : 'serie';
      const synopsis =
        ((raw?.descr as string) ||
          (raw?.description as string) ||
          indexedFallback?.descr ||
          null)?.trim() || null;

      const item: DetailItem = {
        id: String(id),
        titre: matchedByExactId
          ? String(raw?.titre ?? indexedFallback?.titre ?? '')
          : String(indexedFallback?.titre ?? ''),
        descr: synopsis,
        qualite: (matchedByExactId ? (raw?.qualite as string) : indexedFallback?.qualite) || null,
        langue: (matchedByExactId ? (raw?.langue as string) : indexedFallback?.langue) || null,
        type: resolvedType,
        tmdbId:
          (matchedByExactId && raw?.tmdbId ? String(raw.tmdbId) : indexedFallback?.tmdbId) || null,
        poster:
          (matchedByExactId ? (raw?.poster as string) : null) || indexedFallback?.poster || null,
        trailer:
          (matchedByExactId ? (raw?.trailer as string) : null) || indexedFallback?.trailer || null,
        backdrop:
          (matchedByExactId ? ((raw?.backdrop as string) || (raw?.baggio as string)) : null) ||
          indexedFallback?.backdrop ||
          null,
        genre,
        annee:
          matchedByExactId && raw?.annee
            ? Number(raw.annee)
            : indexedFallback?.annee ?? null,
        saison: (raw?.saison as string | number | null) ?? null,
      };

      const allowExtrasFromJson = Boolean(
        json?.item &&
          (String(json.item.id ?? '') === id ||
            (indexedFallback?.tmdbId &&
              String(json.item.tmdbId ?? '') === String(indexedFallback.tmdbId)))
      );

      const cast: CastMember[] = allowExtrasFromJson
        ? (json?.cast ?? []).slice(0, 18).map((c) => ({
            nom: String(c.nom ?? ''),
            photo: (c.photo as string) || null,
            role: (c.role as string) || null,
          }))
        : [];

      const related: Item[] = allowExtrasFromJson
        ? (json?.related ?? []).slice(0, 12).map((r) => {
            const relItem: Item = {
              id: String(r.id ?? ''),
              titre: String(r.titre ?? ''),
              poster: (r.poster as string) || null,
              qualite: null,
              langue: null,
              item_type: resolvedType,
              saison: null,
              annee: r.annee ? Number(r.annee) : null,
              tmdbId: r.tmdbId ? String(r.tmdbId) : null,
            };
            indexCatalogEntry({
              id: relItem.id,
              titre: relItem.titre,
              poster: relItem.poster,
              backdrop: null,
              descr: null,
              trailer: null,
              genre: null,
              annee: relItem.annee ?? null,
              langue: null,
              qualite: null,
              tmdbId: relItem.tmdbId ?? null,
              item_type: resolvedType,
              source: resolvedType === 'film' ? 'films' : 'series',
            });
            return relItem;
          })
        : [];

      const episodes: Episode[] = allowExtrasFromJson
        ? (json?.episodes ?? []).map((e, idx) => ({
            saison: Number(e.saison) || 1,
            episode: Number(e.episode) || idx + 1,
            titre: (e.titre as string) || `Épisode ${Number(e.episode) || idx + 1}`,
            url: (e.url as string) || null,
          }))
        : [];

      const result = { item, cast, related, episodes, live: true };
      return setCached(cacheKey, result, 180_000, 900_000);
    } catch (err) {
      const stale = getStaleCached<{
        item: DetailItem | null;
        cast: CastMember[];
        related: Item[];
        episodes: Episode[];
        live: boolean;
      }>(cacheKey);
      if (stale) return stale;

      recordErrorLog({
        level: 'warn',
        source: 'upstream',
        message: `Échec de récupération fiche détail (${type}/${id})`,
        route: `/api/details/${type}/${id}`,
        err,
      });
      const fb = buildFallbackDetail(type, id);
      return { ...fb, live: false };
    }
  });
}

const clientErrorRateMap = new Map<string, { count: number; resetAt: number }>();

function allowClientErrorReport(ip: string): boolean {
  const now = Date.now();
  const entry = clientErrorRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    clientErrorRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count += 1;
  return true;
}

export async function createApiApp(): Promise<express.Express> {
  setActiveMembersCountProvider(() => {
    const dirCount = countActiveDirectoryUsers();
    if (isSupabaseEnabled()) {
      return dirCount;
    }
    const activeLocal = db.users.filter((u) => !isUserBanned(u.id)).length;
    return Math.max(activeLocal, dirCount);
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use('/api', antiBotAndRateLimitMiddleware);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      db: 'sqlite',
      timestamp: new Date().toISOString(),
    });
  });

  // CryptoGate webhook MUST read raw request body before express.json() for HMAC-SHA256 verification
  app.post(
    '/api/webhooks/crypto-gate',
    express.raw({ type: '*/*', limit: '256kb' }),
    (req, res) => {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body ?? {});
      const sigHeader = String(
        req.headers['x-webhook-signature'] ||
          req.headers['x-cryptogate-signature'] ||
          req.headers['x-signature'] ||
          req.headers['x-hub-signature-256'] ||
          ''
      );
      const outcome = verifyAndProcessCryptoGateWebhook({ rawBody, signatureHeader: sigHeader });
      res.status(outcome.status).json({ ok: outcome.ok, message: outcome.message });
    }
  );

  app.use(express.json({ limit: '4mb' }));
  app.use('/api', csrfOriginCheckMiddleware);
  app.use('/api', payloadSanitizerMiddleware);

  app.use('/api', (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 500 && !res.locals.errorLogged) {
        recordErrorLog({
          level: 'error',
          source: 'api',
          message: `Réponse HTTP ${res.statusCode} sur ${req.method} ${req.originalUrl}`,
          route: req.originalUrl,
          method: req.method,
          statusCode: res.statusCode,
          userAgent: String(req.headers['user-agent'] ?? ''),
        });
      }
    });
    next();
  });

  app.post('/api/client-errors', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!allowClientErrorReport(ip)) {
      res.status(429).json({ ok: false });
      return;
    }
    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'Message d’erreur manquant.' });
      return;
    }
    const auth = await resolveAuth(req).catch(() => null);
    const entry = recordErrorLog({
      level: req.body?.level === 'fatal' || req.body?.level === 'warn' ? req.body.level : 'error',
      source: 'client',
      message,
      stack: typeof req.body?.stack === 'string' ? req.body.stack : null,
      route: typeof req.body?.route === 'string' ? req.body.route : null,
      userId: auth?.user.id ?? null,
      userAgent: String(req.headers['user-agent'] ?? ''),
      context:
        req.body?.context && typeof req.body.context === 'object'
          ? (req.body.context as Record<string, unknown>)
          : null,
    });
    res.json({ ok: true, id: entry.id });
  });

  app.get('/api/admin/logs', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json(
      listErrorLogs({
        level: typeof req.query.level === 'string' ? req.query.level : undefined,
        source: typeof req.query.source === 'string' ? req.query.source : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      })
    );
  });

  app.delete('/api/admin/logs', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const deleted = clearErrorLogs();
    res.json({ ok: true, deleted });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH ROUTES (Online Supabase when configured, local store otherwise)
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/auth/me', async (req, res) => {
    const auth = await resolveAuth(req);
    res.json({
      user: auth?.user ?? null,
      backend: isSupabaseEnabled() ? 'supabase' : 'local',
    });
  });

  app.get('/api/auth/captcha', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(createCaptchaChallenge(getClientIp(req)));
  });

  app.post('/api/auth/login', async (req, res) => {
    if (isHoneypotTriggered(req.body)) {
      res.status(400).json({ error: 'Validation du formulaire échouée.' });
      return;
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const clientIp = getClientIp(req);

    const lockState = checkLoginLockout(email, clientIp);
    if (lockState.locked) {
      const mins = Math.max(1, Math.ceil(lockState.retryAfterSeconds / 60));
      res.setHeader('Retry-After', String(lockState.retryAfterSeconds));
      res.status(429).json({
        error: `Compte temporairement verrouillé après 3 tentatives échouées. Réessayez dans ${mins} minute${mins > 1 ? 's' : ''}.`,
        locked: true,
        remainingAttempts: 0,
        retryAfterSeconds: lockState.retryAfterSeconds,
      });
      return;
    }

    const captchaCheck = verifyCaptchaChallenge({
      captchaToken: req.body?.captchaToken,
      captchaAnswer: req.body?.captchaAnswer,
      ip: clientIp,
    });
    if (!captchaCheck.ok) {
      res.status(400).json({ error: captchaCheck.error || 'Code CAPTCHA invalide.' });
      return;
    }

    const handleFailedCredentials = (baseMessage: string) => {
      const nextLock = recordLoginFailure(email, clientIp);
      if (nextLock.locked) {
        recordErrorLog({
          level: 'warn',
          source: 'security',
          message: `Verrouillage connexion 15 min après 3 échecs (${email || 'email vide'})`,
          route: req.originalUrl,
          method: req.method,
          statusCode: 429,
          userAgent: String(req.headers['user-agent'] ?? ''),
        });
        res.setHeader('Retry-After', String(nextLock.retryAfterSeconds));
        res.status(429).json({
          error:
            'Trop de tentatives incorrectes (3/3). Connexion bloquée pendant 15 minutes pour protéger votre compte.',
          locked: true,
          remainingAttempts: 0,
          retryAfterSeconds: nextLock.retryAfterSeconds,
        });
        return;
      }
      res.status(401).json({
        error: `${baseMessage} (${nextLock.remainingAttempts} tentative${nextLock.remainingAttempts > 1 ? 's' : ''} restante${nextLock.remainingAttempts > 1 ? 's' : ''} avant verrouillage).`,
        locked: false,
        remainingAttempts: nextLock.remainingAttempts,
      });
    };

    if (!email || !password) {
      handleFailedCredentials('Veuillez saisir votre email et votre mot de passe.');
      return;
    }

    if (isSupabaseEnabled()) {
      const sb = createAnonClient();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        handleFailedCredentials(error?.message || 'Identifiants incorrects.');
        return;
      }
      const accessToken = data.session.access_token;
      const resolved = await sbResolveUser(accessToken);
      if (!resolved) {
        res.status(401).json({ error: 'Impossible de charger votre profil Supabase.' });
        return;
      }
      const ban = getUserBanInfo(resolved.user.id);
      if (ban) {
        res.clearCookie('tapenaka_session', { path: '/' });
        res.status(403).json({
          error: ban.reason
            ? `Votre compte a été suspendu par un administrateur (${ban.reason}).`
            : 'Votre compte a été suspendu par un administrateur.',
        });
        return;
      }
      clearLoginFailures(email, clientIp);
      const enriched = enrichUserProfile(resolved.user);
      const persistent = createPersistentSession({
        userId: resolved.user.id,
        provider: 'supabase',
        sbAccessToken: accessToken,
        sbRefreshToken: data.session.refresh_token || null,
        sbExpiresAtMs: decodeJwtExpiryMs(accessToken) ?? Date.now() + 3_600_000,
        userSnapshot: enriched,
      });
      res.cookie('tapenaka_session', persistent.token, getSessionCookieOptions(req));
      res.json({ token: persistent.token, user: enriched });
      return;
    }

    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user || user.passwordHash !== hashPassword(password)) {
      handleFailedCredentials('Identifiants incorrects.');
      return;
    }
    const ban = getUserBanInfo(user.id);
    if (ban) {
      res.status(403).json({
        error: ban.reason
          ? `Votre compte a été suspendu par un administrateur (${ban.reason}).`
          : 'Votre compte a été suspendu par un administrateur.',
      });
      return;
    }
    if (user.emailVerified === false) {
      res.status(403).json({
        error: 'Veuillez confirmer votre adresse email via le code à 6 chiffres reçu avant de vous connecter.',
      });
      return;
    }
    clearLoginFailures(email, clientIp);
    const enriched = enrichUserProfile({
      id: user.id,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      createdAt: user.createdAt,
    });
    const persistent = createPersistentSession({
      userId: user.id,
      provider: 'local',
      userSnapshot: enriched,
    });
    db.sessions.push({ token: persistent.token, userId: user.id, createdAt: persistent.createdAt });
    saveDb(db);
    res.cookie('tapenaka_session', persistent.token, getSessionCookieOptions(req));
    res.json({
      token: persistent.token,
      user: enriched,
    });
  });

  app.post('/api/auth/demo-login', (req, res) => {
    if (isSupabaseEnabled()) {
      res
        .status(400)
        .json({ error: 'Mode Supabase en ligne actif : connectez-vous avec votre compte Supabase.' });
      return;
    }
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    const user =
      role === 'admin'
        ? db.users.find((u) => u.role === 'admin') ?? db.users[0]
        : db.users.find((u) => u.role === 'member') ?? db.users[1] ?? db.users[0];
    if (!user) {
      res.status(404).json({ error: 'Compte de démonstration introuvable.' });
      return;
    }
    const enriched = enrichUserProfile({
      id: user.id,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      createdAt: user.createdAt,
    });
    const persistent = createPersistentSession({
      userId: user.id,
      provider: 'local',
      userSnapshot: enriched,
    });
    db.sessions.push({ token: persistent.token, userId: user.id, createdAt: persistent.createdAt });
    saveDb(db);
    res.cookie('tapenaka_session', persistent.token, getSessionCookieOptions(req));
    res.json({
      token: persistent.token,
      user: enriched,
    });
  });

  app.get('/api/auth/check-username', async (req, res) => {
    const raw = String(req.query?.username ?? '');
    const check = validateUsernameFormat(raw);
    if (!check.valid) {
      res.json({ available: false, error: check.error });
      return;
    }
    const taken = await isUsernameTaken(check.clean);
    res.json({
      available: !taken,
      ...(taken ? { error: 'Ce pseudo est déjà utilisé.' } : {}),
    });
  });

  async function finalizeAccountCreation(params: {
    email: string;
    password: string;
    username: string;
    appOrigin: string;
    verifiedByCode: boolean;
    req: express.Request;
    res: express.Response;
  }): Promise<boolean> {
    const { email, password, username, appOrigin, verifiedByCode, res } = params;

    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      const sb = createAnonClient();

      if (verifiedByCode && adminSb) {
        const { data: created, error: createErr } = await adminSb.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            username,
            full_name: username,
            display_name: username,
          },
        });
        if (createErr) {
          const mapped = mapSupabaseSignupError(createErr.message);
          res.status(mapped.status).json({ error: mapped.message });
          return false;
        }
        const createdId = created.user?.id;
        if (createdId) {
          registerUserDirectoryEntry(createdId, email, username);
          // Ensure profile row has username & contact_email cleanly synced
          try {
            await adminSb
              .from('profiles')
              .upsert(
                { id: createdId, username, full_name: username, contact_email: email },
                { onConflict: 'id' }
              );
          } catch {
            // Non-fatal if trigger already handled or schema differs
          }
        }

        const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr || !signInData.session) {
          res.status(400).json({
            error:
              signInErr?.message ||
              'Compte créé mais connexion automatique impossible. Essayez de vous connecter.',
          });
          return false;
        }

        if (isSmtpReady()) {
          void sendWelcomeEmail({ to: email, username, appUrl: appOrigin });
        }

        const accessToken = signInData.session.access_token;
        const resolved = await sbResolveUser(accessToken);
        const enriched = resolved?.user ? enrichUserProfile(resolved.user) : null;
        if (resolved?.user) {
          const persistent = createPersistentSession({
            userId: resolved.user.id,
            provider: 'supabase',
            sbAccessToken: accessToken,
            sbRefreshToken: signInData.session.refresh_token || null,
            sbExpiresAtMs: decodeJwtExpiryMs(accessToken) ?? Date.now() + 3_600_000,
            userSnapshot: enriched,
          });
          res.cookie('tapenaka_session', persistent.token, getSessionCookieOptions(params.req));
          res.json({ token: persistent.token, user: enriched });
          return true;
        }
        res.cookie('tapenaka_session', accessToken, getSessionCookieOptions(params.req));
        res.json({ token: accessToken, user: null });
        return true;
      }

      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            full_name: username,
            display_name: username,
          },
          ...(appOrigin ? { emailRedirectTo: `${appOrigin}/auth` } : {}),
        },
      });
      if (error) {
        const mapped = mapSupabaseSignupError(error.message);
        res.status(mapped.status).json({ error: mapped.message });
        return false;
      }
      if (data.user?.id) {
        registerUserDirectoryEntry(data.user.id, email, username);
        if (adminSb) {
          try {
            await adminSb
              .from('profiles')
              .upsert(
                { id: data.user.id, username, full_name: username, contact_email: email },
                { onConflict: 'id' }
              );
          } catch {
            // Non-fatal
          }
        }
      }
      if (!data.session) {
        res.json({
          token: '',
          user: null,
          requiresConfirmation: true,
          message:
            'Compte créé. Consultez votre boîte mail pour confirmer votre inscription avant de vous connecter.',
        });
        return true;
      }
      if (isSmtpReady()) {
        void sendWelcomeEmail({ to: email, username, appUrl: appOrigin });
      }
      const accessToken = data.session.access_token;
      const resolved = await sbResolveUser(accessToken);
      const enriched = resolved?.user ? enrichUserProfile(resolved.user) : null;
      if (resolved?.user) {
        const persistent = createPersistentSession({
          userId: resolved.user.id,
          provider: 'supabase',
          sbAccessToken: accessToken,
          sbRefreshToken: data.session.refresh_token || null,
          sbExpiresAtMs: decodeJwtExpiryMs(accessToken) ?? Date.now() + 3_600_000,
          userSnapshot: enriched,
        });
        res.cookie('tapenaka_session', persistent.token, getSessionCookieOptions(params.req));
        res.json({ token: persistent.token, user: enriched });
        return true;
      }
      res.cookie('tapenaka_session', accessToken, getSessionCookieOptions(params.req));
      res.json({ token: accessToken, user: null });
      return true;
    }

    // Local store mode
    const newUserId = crypto.randomUUID();
    const assignedAvatar = resolveUserAvatar(newUserId);
    const newUser: StoredUser = {
      id: newUserId,
      email,
      passwordHash: hashPassword(password),
      username,
      avatar: assignedAvatar,
      role: db.users.length === 0 ? 'admin' : 'member',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
    db.users.push(newUser);
    registerUserDirectoryEntry(newUserId, email, username);

    const enriched = enrichUserProfile({
      id: newUser.id,
      email: newUser.email,
      username: newUser.username,
      avatar: newUser.avatar,
      role: newUser.role,
      createdAt: newUser.createdAt,
    });
    const persistent = createPersistentSession({
      userId: newUser.id,
      provider: 'local',
      userSnapshot: enriched,
    });
    db.sessions.push({ token: persistent.token, userId: newUser.id, createdAt: persistent.createdAt });
    saveDb(db);
    if (isSmtpReady()) {
      void sendWelcomeEmail({ to: email, username, appUrl: appOrigin });
    }
    res.cookie('tapenaka_session', persistent.token, getSessionCookieOptions(params.req));
    res.json({
      token: persistent.token,
      user: enriched,
    });
    return true;
  }

  app.post('/api/auth/signup', async (req, res) => {
    if (isHoneypotTriggered(req.body)) {
      res.status(400).json({ error: 'Validation du formulaire échouée.' });
      return;
    }
    const captchaCheck = verifyCaptchaChallenge({
      captchaToken: req.body?.captchaToken,
      captchaAnswer: req.body?.captchaAnswer,
      ip: getClientIp(req),
    });
    if (!captchaCheck.ok) {
      res.status(400).json({ error: captchaCheck.error || 'Code CAPTCHA invalide.' });
      return;
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const usernameCheck = validateUsernameFormat(String(req.body?.username ?? ''));
    if (!usernameCheck.valid) {
      res.status(400).json({ error: usernameCheck.error || 'Pseudo invalide.' });
      return;
    }
    const username = usernameCheck.clean;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      res.status(400).json({
        error: 'Veuillez renseigner un email valide et un mot de passe (8 caractères min.).',
      });
      return;
    }

    const smtpReady = isSmtpReady();
    const unconfirmedId = smtpReady ? await findUnconfirmedUserIdByEmail(email) : null;

    if (await isUsernameTaken(username, unconfirmedId ?? undefined)) {
      res.status(409).json({ error: 'Ce pseudo est déjà utilisé. Veuillez en choisir un autre.' });
      return;
    }

    if (await isEmailTaken(email, { allowUnconfirmed: smtpReady })) {
      const unconfirmedPending = !smtpReady ? await findUnconfirmedUserIdByEmail(email) : null;
      res.status(409).json({
        error: unconfirmedPending
          ? 'Une inscription non confirmée existe déjà pour cet email. Finalisez la validation ou supprimez le compte en attente dans Admin → Utilisateurs.'
          : 'Un compte utilise déjà cette adresse email.',
      });
      return;
    }

    const appOrigin = resolveAppOrigin(req);

    // 6-digit verification code flow when email gateway is active
    if (isSmtpReady()) {
      const code = String(crypto.randomInt(100000, 1000000));
      const now = Date.now();
      pendingSignups[email] = {
        email,
        username,
        password,
        code,
        createdAt: now,
        expiresAt: now + 15 * 60_000,
        lastSentAt: now,
        attempts: 0,
      };
      savePendingSignups();

      const mailRes = await sendSignupVerificationEmail({
        to: email,
        username,
        code,
        verifyUrl: appOrigin ? `${appOrigin}/auth` : '',
      });
      if (!mailRes.ok) {
        delete pendingSignups[email];
        savePendingSignups();
        res.status(502).json({
          error: `Échec de l’envoi du code de vérification : ${mailRes.error || 'vérifiez la configuration email en administration.'}`,
        });
        return;
      }

      res.json({
        token: '',
        user: null,
        requiresCode: true,
        requiresConfirmation: true,
        email,
        expiresInMinutes: 15,
        message: `Un code de vérification à 6 chiffres vient d’être envoyé à ${email}.`,
      });
      return;
    }

    if (shouldRequireSignupConfirmation()) {
      res.status(400).json({
        error:
          'La confirmation par email est activée, mais aucune passerelle email (SMTP / Resend / Brevo) n’est configurée en administration.',
      });
      return;
    }

    await finalizeAccountCreation({
      email,
      password,
      username,
      appOrigin,
      verifiedByCode: false,
      req,
      res,
    });
  });

  app.post('/api/auth/signup/verify-code', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const code = String(req.body?.code ?? '').replace(/\D/g, '').slice(0, 6);
    if (!email || code.length !== 6) {
      res.status(400).json({ error: 'Veuillez saisir le code complet à 6 chiffres.' });
      return;
    }

    const pending = pendingSignups[email];
    if (!pending || pending.expiresAt <= Date.now()) {
      if (pending) {
        delete pendingSignups[email];
        savePendingSignups();
      }
      res.status(400).json({
        error: 'Code de vérification expiré ou introuvable. Veuillez recommencer l’inscription.',
      });
      return;
    }

    if (pending.attempts >= 3) {
      delete pendingSignups[email];
      savePendingSignups();
      res.status(429).json({
        error: 'Trop de tentatives incorrectes (3/3). Veuillez demander un nouveau code.',
      });
      return;
    }

    if (pending.code !== code) {
      pending.attempts += 1;
      savePendingSignups();
      const remaining = Math.max(0, 3 - pending.attempts);
      res.status(400).json({
        error:
          remaining > 0
            ? `Code à 6 chiffres incorrect (${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}).`
            : 'Code incorrect. Veuillez demander un nouveau code.',
      });
      return;
    }

    const unconfirmedGhostId = await findUnconfirmedUserIdByEmail(pending.email);

    if (await isUsernameTaken(pending.username, unconfirmedGhostId ?? undefined)) {
      res.status(409).json({
        error: 'Ce pseudo vient d’être pris entre-temps. Veuillez en choisir un autre.',
      });
      return;
    }
    if (await isEmailTaken(pending.email, { allowUnconfirmed: true })) {
      delete pendingSignups[email];
      savePendingSignups();
      res.status(409).json({ error: 'Un compte utilise déjà cette adresse email.' });
      return;
    }

    // If an unconfirmed ghost account exists for this verified email, remove it before creating the confirmed account
    if (unconfirmedGhostId && isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (adminSb) {
        try {
          await deleteSupabaseUserAndRelations(adminSb, unconfirmedGhostId);
          cleanupUserBillingData(unconfirmedGhostId, pending.email);
        } catch {
          // Non-fatal
        }
      }
    }

    const ok = await finalizeAccountCreation({
      email: pending.email,
      password: pending.password,
      username: pending.username,
      appOrigin: resolveAppOrigin(req),
      verifiedByCode: true,
      req,
      res,
    });
    if (ok) {
      delete pendingSignups[email];
      savePendingSignups();
    }
  });

  app.post('/api/auth/signup/resend-code', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const pending = pendingSignups[email];
    if (!pending || pending.expiresAt <= Date.now()) {
      res.status(400).json({
        error: 'Session d’inscription expirée. Veuillez remplir le formulaire à nouveau.',
      });
      return;
    }

    const waitMs = 20_000 - (Date.now() - pending.lastSentAt);
    if (waitMs > 0) {
      res.status(429).json({
        error: `Patientez ${Math.ceil(waitMs / 1000)}s avant de renvoyer un code.`,
      });
      return;
    }

    const newCode = String(crypto.randomInt(100000, 1000000));
    pending.code = newCode;
    pending.expiresAt = Date.now() + 15 * 60_000;
    pending.lastSentAt = Date.now();
    pending.attempts = 0;
    savePendingSignups();

    const appOrigin = resolveAppOrigin(req);
    const mailRes = await sendSignupVerificationEmail({
      to: pending.email,
      username: pending.username,
      code: newCode,
      verifyUrl: appOrigin ? `${appOrigin}/auth` : '',
    });
    if (!mailRes.ok) {
      res.status(502).json({
        error: `Échec du renvoi du code : ${mailRes.error || 'vérifiez la configuration email.'}`,
      });
      return;
    }
    res.json({
      ok: true,
      message: `Un nouveau code à 6 chiffres vient d’être envoyé à ${pending.email}.`,
    });
  });

  app.post('/api/auth/verify-email', async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    if (!token) {
      res.status(400).json({ error: 'Jeton de confirmation manquant.' });
      return;
    }
    const list = db.verifyTokens ?? [];
    const entry = list.find((t) => t.token === token && t.expiresAt > Date.now());
    if (!entry) {
      res.status(400).json({ error: 'Lien de confirmation invalide ou expiré.' });
      return;
    }
    const user = db.users.find((u) => u.id === entry.userId);
    if (!user) {
      res.status(404).json({ error: 'Compte introuvable.' });
      return;
    }
    user.emailVerified = true;
    db.verifyTokens = list.filter((t) => t.token !== token);
    const enriched = enrichUserProfile({
      id: user.id,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      createdAt: user.createdAt,
    });
    const persistent = createPersistentSession({
      userId: user.id,
      provider: 'local',
      userSnapshot: enriched,
    });
    db.sessions.push({ token: persistent.token, userId: user.id, createdAt: persistent.createdAt });
    saveDb(db);
    if (isSmtpReady()) {
      await sendWelcomeEmail({
        to: user.email,
        username: user.username,
        appUrl: resolveAppOrigin(req),
      });
    }
    res.cookie('tapenaka_session', persistent.token, getSessionCookieOptions(req));
    res.json({
      token: persistent.token,
      user: enriched,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = extractToken(req);
    if (token) {
      deletePersistentSession(token);
      invalidateSbUserCache({ token });
    }
    if (!isSupabaseEnabled() && token) {
      db.sessions = db.sessions.filter((s) => s.token !== token);
      saveDb(db);
    }
    res.clearCookie('tapenaka_session', { path: '/' });
    res.clearCookie('streamwall_watch', { path: '/api/public/watch' });
    res.json({ ok: true });
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    if (isHoneypotTriggered(req.body)) {
      res.status(400).json({ error: 'Validation du formulaire échouée.' });
      return;
    }
    const captchaCheck = verifyCaptchaChallenge({
      captchaToken: req.body?.captchaToken,
      captchaAnswer: req.body?.captchaAnswer,
      ip: getClientIp(req),
    });
    if (!captchaCheck.ok) {
      res.status(400).json({ error: captchaCheck.error || 'Code CAPTCHA invalide.' });
      return;
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Veuillez saisir une adresse email valide.' });
      return;
    }
    if (!isSmtpReady()) {
      res.status(400).json({
        error:
          'Aucune passerelle email (SMTP / Resend / Brevo) n’est configurée en administration pour envoyer le code à 6 chiffres.',
      });
      return;
    }

    let foundUser: { id: string; email: string; username: string } | null = null;
    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (!adminSb) {
        res.status(400).json({
          error:
            'Ajoutez SUPABASE_SERVICE_ROLE_KEY dans vos secrets pour réinitialiser le mot de passe par code à 6 chiffres.',
        });
        return;
      }
      const users = await listAllSupabaseAuthUsers(adminSb);
      const match = users.find((u) => (u.email || '').trim().toLowerCase() === email);
      if (match) {
        const meta = (match.user_metadata ?? {}) as Record<string, unknown>;
        const uname =
          (typeof meta.username === 'string' && meta.username) ||
          (typeof meta.full_name === 'string' && meta.full_name) ||
          email.split('@')[0] ||
          'Membre';
        foundUser = { id: match.id, email, username: uname };
      }
    } else {
      const localUser = db.users.find((u) => u.email.trim().toLowerCase() === email);
      if (localUser) {
        foundUser = { id: localUser.id, email: localUser.email, username: localUser.username };
      }
    }

    if (!foundUser) {
      res.status(404).json({ error: 'Aucun compte trouvé avec cette adresse email.' });
      return;
    }
    if (isUserBanned(foundUser.id)) {
      res.status(403).json({ error: 'Ce compte a été suspendu par un administrateur.' });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    const key = `password_reset:${email}`;
    otpChallenges[key] = {
      purpose: 'password_reset',
      userId: foundUser.id,
      email,
      username: foundUser.username,
      code,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
      lastSentAt: now,
      attempts: 0,
    };
    saveOtpChallenges();

    const mailRes = await sendPasswordResetEmail({
      to: email,
      username: foundUser.username,
      code,
    });
    if (!mailRes.ok) {
      delete otpChallenges[key];
      saveOtpChallenges();
      res.status(502).json({
        error: `Échec de l’envoi du code : ${mailRes.error || 'vérifiez la configuration email.'}`,
      });
      return;
    }

    res.json({
      ok: true,
      requiresCode: true,
      email,
      expiresInMinutes: 15,
      message: `Un code de réinitialisation à 6 chiffres vient d’être envoyé à ${email}.`,
      resetPath: null,
    });
  });

  app.post('/api/auth/forgot-password/resend-code', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const key = `password_reset:${email}`;
    const challenge = otpChallenges[key];
    if (!challenge || challenge.expiresAt <= Date.now()) {
      res.status(400).json({
        error: 'Session de réinitialisation expirée. Veuillez recommencer.',
      });
      return;
    }
    const waitMs = 20_000 - (Date.now() - challenge.lastSentAt);
    if (waitMs > 0) {
      res.status(429).json({
        error: `Patientez ${Math.ceil(waitMs / 1000)}s avant de renvoyer un code.`,
      });
      return;
    }

    const newCode = String(crypto.randomInt(100000, 1000000));
    challenge.code = newCode;
    challenge.expiresAt = Date.now() + 15 * 60_000;
    challenge.lastSentAt = Date.now();
    challenge.attempts = 0;
    saveOtpChallenges();

    const mailRes = await sendPasswordResetEmail({
      to: challenge.email,
      username: challenge.username,
      code: newCode,
    });
    if (!mailRes.ok) {
      res.status(502).json({
        error: `Échec du renvoi du code : ${mailRes.error || 'vérifiez la configuration email.'}`,
      });
      return;
    }
    res.json({
      ok: true,
      message: `Un nouveau code à 6 chiffres vient d’être envoyé à ${challenge.email}.`,
    });
  });

  app.post('/api/auth/reset-password/verify-code', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const code = String(req.body?.code ?? '').replace(/\D/g, '').slice(0, 6);
    const password = String(req.body?.password ?? '');
    if (!email || code.length !== 6) {
      res.status(400).json({ error: 'Veuillez saisir l’adresse email et le code à 6 chiffres.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
      return;
    }

    const key = `password_reset:${email}`;
    const challenge = otpChallenges[key];
    if (!challenge || challenge.expiresAt <= Date.now()) {
      if (challenge) {
        delete otpChallenges[key];
        saveOtpChallenges();
      }
      res.status(400).json({
        error: 'Code expiré ou introuvable. Veuillez demander un nouveau code.',
      });
      return;
    }

    if (challenge.attempts >= 3) {
      delete otpChallenges[key];
      saveOtpChallenges();
      res.status(429).json({
        error: 'Trop de tentatives incorrectes (3/3). Veuillez demander un nouveau code.',
      });
      return;
    }

    if (challenge.code !== code) {
      challenge.attempts += 1;
      saveOtpChallenges();
      const remaining = Math.max(0, 3 - challenge.attempts);
      res.status(400).json({
        error:
          remaining > 0
            ? `Code à 6 chiffres incorrect (${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}).`
            : 'Code incorrect. Veuillez demander un nouveau code.',
      });
      return;
    }

    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (!adminSb) {
        res.status(400).json({ error: 'Clé SUPABASE_SERVICE_ROLE_KEY requise.' });
        return;
      }
      const { error } = await adminSb.auth.admin.updateUserById(challenge.userId, { password });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    } else {
      const user = db.users.find((u) => u.id === challenge.userId);
      if (!user) {
        res.status(404).json({ error: 'Utilisateur introuvable.' });
        return;
      }
      user.passwordHash = hashPassword(password);
      saveDb(db);
    }

    delete otpChallenges[key];
    saveOtpChallenges();
    res.json({
      ok: true,
      message: 'Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter.',
    });
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (password.length < 8) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
      return;
    }

    const auth = await resolveAuth(req);
    if (isSmtpReady() && !token) {
      res.status(400).json({
        error: 'La modification de mot de passe nécessite une validation par code à 6 chiffres envoyé par email.',
      });
      return;
    }

    if (isSupabaseEnabled()) {
      if (!auth?.sbClient) {
        res.status(401).json({ error: 'Session requise pour changer votre mot de passe.' });
        return;
      }
      const { error } = await auth.sbClient.auth.updateUser({ password });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.json({ ok: true });
      return;
    }

    if (token) {
      const record = db.resetTokens.find((t) => t.token === token && t.expiresAt > Date.now());
      if (!record) {
        res.status(400).json({ error: 'Code ou jeton invalide ou expiré.' });
        return;
      }
      const user = db.users.find((u) => u.id === record.userId);
      if (!user) {
        res.status(404).json({ error: 'Utilisateur introuvable.' });
        return;
      }
      user.passwordHash = hashPassword(password);
      db.resetTokens = db.resetTokens.filter((t) => t.token !== token);
      saveDb(db);
      res.json({ ok: true });
      return;
    }
    if (auth) {
      const localUser = db.users.find((u) => u.id === auth.user.id);
      if (localUser) {
        localUser.passwordHash = hashPassword(password);
        saveDb(db);
      }
      res.json({ ok: true });
      return;
    }
    res.status(401).json({ error: 'Session ou validation par code requise.' });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DISCOVERY, HOME, CATALOGUE, SUGGESTIONS & DETAILS
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/home', async (req, res) => {
    const auth = await resolveAuth(req);

    const getHomeBase = async () => {
      const origin = await getOrigin();
      const homeBaseKey = `home:base:v4:${origin}`;
      const cachedBase = getCached<{
        upstreamStatus: 'live' | 'fallback';
        slider: Slide[];
        latest: Item[];
        lastSeries: LastSeriesItem[];
        week: RankingEntry[];
      }>(homeBaseKey);
      if (cachedBase) return cachedBase;

      return coalesceUpstream(homeBaseKey, async () => {
        const recheck = getCached<{
          upstreamStatus: 'live' | 'fallback';
          slider: Slide[];
          latest: Item[];
          lastSeries: LastSeriesItem[];
          week: RankingEntry[];
        }>(homeBaseKey);
        if (recheck) return recheck;

        const [sliderRes, catRes, lastSeriesRes, week7] = await Promise.all([
          fetchUpstreamSlider(),
          fetchUpstreamCatalogue({
            q: '',
            type: 'all',
            genre: '',
            year: '',
            lang: '',
            sort: 'recent',
            page: 1,
          }),
          fetchUpstreamLastSeries(),
          isSupabaseEnabled() ? sbGetRankings(null, 7) : Promise.resolve(computeLocalRankings(7)),
        ]);

        const topWeek: RankingEntry[] = [];
        const pickedWeekKeys = new Set<string>();
        const pushWeekEntry = (entry: RankingEntry | null) => {
          if (!entry || !entry.item?.id || topWeek.length >= 6) return;
          const k = `${entry.item.item_type}:${entry.item.id}`;
          if (pickedWeekKeys.has(k)) return;
          pickedWeekKeys.add(k);
          topWeek.push(entry);
        };

        for (const r of week7) {
          pushWeekEntry(r);
        }

        if (topWeek.length < 6) {
          const week30 = isSupabaseEnabled()
            ? await sbGetRankings(null, 30)
            : computeLocalRankings(30);
          for (const r of week30) {
            pushWeekEntry(r);
            if (topWeek.length >= 6) break;
          }
        }

        const catalogCandidates: Item[] = [...catRes.items, ...sliderRes.items, ...FALLBACK_ITEMS];
        if (topWeek.length < 6) {
          const pageViewsTop = getTopContentStats(7, 15);
          for (const stat of pageViewsTop) {
            if (stat.itemType === 'pinoy') continue;
            const indexed = getIndexedCatalogEntry(stat.itemType, stat.itemId);
            const matched = indexed
              ? {
                  id: indexed.id,
                  titre: indexed.titre,
                  poster: indexed.poster,
                  qualite: indexed.qualite,
                  langue: indexed.langue,
                  item_type: indexed.item_type,
                  saison: null,
                  genre: indexed.genre,
                  annee: indexed.annee,
                  tmdbId: indexed.tmdbId,
                }
              : catalogCandidates.find(
                  (c) => c.id === stat.itemId && c.item_type === stat.itemType
                ) ?? null;
            if (matched) {
              pushWeekEntry({
                item: matched,
                viewers: stat.viewers,
                plays: stat.views,
              });
            }
            if (topWeek.length >= 6) break;
          }
        }

        if (topWeek.length < 6) {
          for (const candidate of catalogCandidates) {
            pushWeekEntry({ item: candidate, viewers: 0, plays: 0 });
            if (topWeek.length >= 6) break;
          }
        }

        const basePayload = {
          upstreamStatus: (
            sliderRes.live || catRes.upstreamStatus === 'live' || lastSeriesRes.live
              ? 'live'
              : 'fallback'
          ) as 'live' | 'fallback',
          slider: sliderRes.items,
          latest: catRes.items.slice(0, 12),
          lastSeries: lastSeriesRes.items.slice(0, 18),
          week: topWeek.slice(0, 6),
        };
        return setCached(homeBaseKey, basePayload, 30_000, 180_000);
      });
    };

    const base = await getHomeBase();

    let forYou: Item[] = [];
    let continueWatching: WatchProgress[] = [];
    let friendsActivity: {
      username: string;
      avatar: string | null;
      isPro?: boolean;
      item: Item;
      viewedAt: string;
    }[] = [];

    if (auth) {
      continueWatching = (db.watchProgress[auth.user.id] ?? [])
        .slice()
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 6);

      let sourceItems: Item[] = [];
      let seenKeys = new Set<string>();

      if (isSupabaseEnabled() && auth.sbClient) {
        const { data: rows } = await auth.sbClient
          .from('watch_events')
          .select('item_id,item_type,item')
          .eq('user_id', auth.user.id)
          .order('viewed_at', { ascending: false })
          .limit(40);
        const list = (rows ?? []) as { item_id: string; item_type: ItemType; item: Item }[];
        seenKeys = new Set(list.map((r) => `${r.item_type}:${r.item_id}`));
        sourceItems = [
          ...new Map(list.map((r) => [`${r.item_type}:${r.item_id}`, r.item])).values(),
        ].slice(0, 3);
      } else {
        const userWatches = db.watchEvents
          .filter((w) => w.userId === auth.user.id)
          .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime());
        seenKeys = new Set(userWatches.map((w) => `${w.item.item_type}:${w.item.id}`));
        sourceItems = [
          ...new Map(userWatches.map((w) => [`${w.item.item_type}:${w.item.id}`, w.item])).values(),
        ].slice(0, 3);
      }

      const relatedLists = await Promise.all(
        sourceItems.map(async (src) => {
          if (src.item_type !== 'film' && src.item_type !== 'serie' && src.item_type !== 'anime') {
            return [];
          }
          const d = await fetchUpstreamDetail(src.item_type, src.id);
          return d.related;
        })
      );

      const picked = new Set<string>();
      for (let i = 0; forYou.length < 6 && i < 12; i++) {
        for (const list of relatedLists) {
          const candidate = list[i];
          if (!candidate) continue;
          const k = `${candidate.item_type}:${candidate.id}`;
          if (seenKeys.has(k) || picked.has(k)) continue;
          picked.add(k);
          forYou.push(candidate);
          if (forYou.length >= 6) break;
        }
      }

      if (!isSupabaseEnabled()) {
        const friendIds = new Set(
          db.friendships.filter((f) => f.userId === auth.user.id).map((f) => f.friendId)
        );
        if (friendIds.size > 0) {
          const friendEvents = db.watchEvents
            .filter((w) => friendIds.has(w.userId))
            .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime());
          const seenFriendItems = new Set<string>();
          for (const ev of friendEvents) {
            const dedup = `${ev.userId}:${ev.item.item_type}:${ev.item.id}`;
            if (seenFriendItems.has(dedup)) continue;
            seenFriendItems.add(dedup);
            const friendUser = db.users.find((u) => u.id === ev.userId);
            if (friendUser) {
              friendsActivity.push({
                username: friendUser.username,
                avatar: resolveUserAvatar(friendUser.id, friendUser.avatar),
                isPro: isUserPro(friendUser.id),
                item: ev.item,
                viewedAt: ev.viewedAt,
              });
            }
            if (friendsActivity.length >= 6) break;
          }
        }
      }
    }

    res.setHeader('Vary', 'Authorization, Cookie');
    if (!auth && !extractToken(req)) {
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
    } else {
      res.setHeader('Cache-Control', 'private, no-store');
    }

    res.json({
      upstreamStatus: base.upstreamStatus,
      slider: base.slider,
      latest: base.latest,
      lastSeries: base.lastSeries,
      forYou,
      continueWatching,
      friendsActivity,
      week: base.week,
    });
  });

  app.get('/api/catalogue', async (req, res) => {
    const auth = await resolveAuth(req);
    const isAdmin = auth?.user.role === 'admin';
    const maxPageForRole = isAdmin ? 250 : auth ? 10 : 2;
    const requestedPage = Math.max(1, Number(req.query.page) || 1);

    if (!auth && requestedPage > 2) {
      res.status(401).json({
        error: 'Connectez-vous pour consulter au-delà de la page 2.',
        requiresAuth: true,
        maxPage: 2,
      });
      return;
    }
    if (auth && !isAdmin && requestedPage > 10) {
      res.status(403).json({
        error: 'La navigation est limitée à 10 pages maximum pour protéger le catalogue.',
        maxPage: 10,
      });
      return;
    }

    const filters: CatalogueFilters = {
      q: String(req.query.q ?? '').trim().slice(0, 100),
      type: ['all', 'film', 'serie', 'anime'].includes(String(req.query.type))
        ? String(req.query.type)
        : 'all',
      genre: String(req.query.genre ?? '').trim().slice(0, 60),
      year: /^\d{4}$/.test(String(req.query.year ?? '')) ? String(req.query.year) : '',
      lang: ['vf', 'vostfr'].includes(String(req.query.lang)) ? String(req.query.lang) : '',
      sort: ['recent', 'pertinence', 'annee_desc'].includes(String(req.query.sort))
        ? (String(req.query.sort) as CatalogueFilters['sort'])
        : 'recent',
      page: Math.min(maxPageForRole, requestedPage),
    };
    const page = await fetchUpstreamCatalogue(filters);

    res.setHeader('Vary', 'Authorization, Cookie');
    if (auth) {
      res.setHeader('Cache-Control', 'private, no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    }

    res.json(
      auth && !isAdmin
        ? {
            ...page,
            pages: Math.min(page.pages, 10),
          }
        : page
    );
  });

  app.get('/api/catalogue/genres', async (_req, res) => {
    const genres = await fetchUpstreamGenres();
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
    res.json({ genres });
  });

  app.get('/api/pinoy/facets', async (_req, res) => {
    if (!isPinoyModuleActive()) {
      res.status(404).json({ error: 'Module Pinoy désactivé ou supprimé.' });
      return;
    }
    const apiUrl = await getPinoyApiUrl();
    const facets = await fetchPinoyFacets(apiUrl);
    res.setHeader('Cache-Control', 'public, max-age=180, s-maxage=600, stale-while-revalidate=1800');
    res.json(facets);
  });

  app.get('/api/pinoy/list', async (req, res) => {
    if (!isPinoyModuleActive()) {
      res.status(404).json({ error: 'Module Pinoy désactivé ou supprimé.' });
      return;
    }
    const [apiUrl, mediaBaseUrl] = await Promise.all([getPinoyApiUrl(), getPinoyMediaBaseUrl()]);
    const rawSort = String(req.query.sort ?? 'recent').trim();
    const sort: PinoyListFilters['sort'] = ['recent', 'oldest', 'az', 'za', 'note'].includes(
      rawSort
    )
      ? (rawSort as PinoyListFilters['sort'])
      : 'recent';

    const filters: PinoyListFilters = {
      q: String(req.query.q ?? '').trim().slice(0, 120),
      genre: String(req.query.genre ?? '').trim().slice(0, 80),
      pays: /^[A-Za-z0-9_-]{1,8}$/.test(String(req.query.pays ?? '').trim())
        ? String(req.query.pays).trim()
        : '',
      annee: /^\d{4}$/.test(String(req.query.annee ?? '').trim())
        ? String(req.query.annee).trim()
        : '',
      sort,
      page: Math.max(1, Math.min(500, Number(req.query.page) || 1)),
    };
    const data = await fetchPinoyList(apiUrl, filters, mediaBaseUrl);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json(data);
  });

  app.get('/api/pinoy/detail/:slug', async (req, res) => {
    if (!isPinoyModuleActive()) {
      res.status(404).json({ error: 'Module Pinoy désactivé ou supprimé.' });
      return;
    }
    const slug = String(req.params.slug ?? '').trim().slice(0, 200);
    if (!slug || !/^[a-zA-Z0-9._-]+$/.test(slug)) {
      res.status(400).json({ error: 'Identifiant de film Pinoy invalide.' });
      return;
    }
    const [auth, apiUrl, mediaBaseUrl, playerTemplate, downloadMessage] = await Promise.all([
      resolveAuth(req),
      getPinoyApiUrl(),
      getPinoyMediaBaseUrl(),
      getPinoyPlayerTemplate(),
      getPinoyDownloadMessage(),
    ]);
    const detail = await fetchPinoyDetail(apiUrl, slug, 12, mediaBaseUrl, playerTemplate);
    if (detail.status === 'live' && !detail.film) {
      res.status(404).json({ error: 'Film Pinoy introuvable.' });
      return;
    }

    const pinoyMod = getCustomModule('pinoy');
    const useProxy = pinoyMod?.player.useSameOriginProxy !== false;
    const effectiveEmbed = detail.players.embed.map((src, index) => {
      if (index === 0 && useProxy && src.provider === 'Lecteur Pinoy' && detail.film) {
        return {
          ...src,
          url: `/api/public/watch/pinoy/${detail.film.id}/${encodeURIComponent(detail.film.slug)}`,
        };
      }
      return src;
    });

    const proOnly = pinoyMod ? pinoyMod.player.downloadProOnly : true;
    const canDownload = !proOnly || Boolean(auth && (auth.user.role === 'admin' || auth.user.isPro));
    const hasDownloads = detail.players.download.length > 0;
    const responsePayload: PinoyDetailResponse = canDownload
      ? {
          ...detail,
          players: {
            ...detail.players,
            embed: effectiveEmbed,
          },
          downloadLocked: false,
        }
      : {
          ...detail,
          players: {
            ...detail.players,
            embed: effectiveEmbed,
            download: [],
          },
          downloadLocked: hasDownloads,
          ...(hasDownloads ? { downloadMessage } : {}),
        };

    res.setHeader('Vary', 'Authorization, Cookie');
    if (!auth && !extractToken(req)) {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=1200');
    } else {
      res.setHeader('Cache-Control', 'private, no-store');
    }
    res.json(responsePayload);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DYNAMIC CUSTOM API MODULES (Public Facets, List, Detail & Same-Origin Player)
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/custom/:slug/facets', async (req, res) => {
    const mod = getCustomModule(String(req.params.slug ?? ''));
    if (!mod || !mod.enabled) {
      res.status(404).json({ error: 'Module catalogue introuvable ou désactivé.' });
      return;
    }
    const facets = await fetchCustomFacets(mod);
    res.setHeader('Cache-Control', 'public, max-age=180, s-maxage=600, stale-while-revalidate=1800');
    res.json(facets);
  });

  app.get('/api/custom/:slug/list', async (req, res) => {
    const mod = getCustomModule(String(req.params.slug ?? ''));
    if (!mod || !mod.enabled) {
      res.status(404).json({ error: 'Module catalogue introuvable ou désactivé.' });
      return;
    }
    const allowedSorts = new Set(mod.filters.sortOptions.map((s) => s.value));
    const rawSort = String(req.query.sort ?? mod.filters.defaultSort).trim();
    const sort = allowedSorts.has(rawSort) ? rawSort : mod.filters.defaultSort;

    const data = await fetchCustomList(mod, {
      q: String(req.query.q ?? '').trim().slice(0, 120),
      genre: String(req.query.genre ?? '').trim().slice(0, 80),
      pays: /^[A-Za-z0-9._-]{1,16}$/.test(String(req.query.pays ?? '').trim())
        ? String(req.query.pays).trim()
        : '',
      annee: /^\d{4}$/.test(String(req.query.annee ?? '').trim())
        ? String(req.query.annee).trim()
        : '',
      sort,
      page: Math.max(1, Math.min(500, Number(req.query.page) || 1)),
    });
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json(data);
  });

  app.get('/api/custom/:slug/detail/:itemKey', async (req, res) => {
    const mod = getCustomModule(String(req.params.slug ?? ''));
    if (!mod || !mod.enabled) {
      res.status(404).json({ error: 'Module catalogue introuvable ou désactivé.' });
      return;
    }
    const itemKey = String(req.params.itemKey ?? '').trim().slice(0, 200);
    if (!itemKey || !/^[a-zA-Z0-9._-]+$/.test(itemKey)) {
      res.status(400).json({ error: 'Identifiant de contenu invalide.' });
      return;
    }

    const [auth, detail] = await Promise.all([
      resolveAuth(req),
      fetchCustomDetail(mod, itemKey),
    ]);
    if (detail.status === 'live' && !detail.item) {
      res.status(404).json({ error: 'Contenu introuvable.' });
      return;
    }

    const canDownload = !mod.player.downloadProOnly || Boolean(auth && (auth.user.role === 'admin' || auth.user.isPro));
    const hasDownloads = detail.players.download.length > 0;
    const responsePayload: CustomApiDetailResponse = canDownload
      ? {
          ...detail,
          downloadLocked: false,
        }
      : {
          ...detail,
          players: {
            ...detail.players,
            download: [],
          },
          downloadLocked: hasDownloads,
          ...(hasDownloads ? { downloadMessage: mod.player.downloadRestrictionMessage } : {}),
        };

    res.setHeader('Vary', 'Authorization, Cookie');
    if (!auth && !extractToken(req)) {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=1200');
    } else {
      res.setHeader('Cache-Control', 'private, no-store');
    }
    res.json(responsePayload);
  });

  app.get('/api/suggestions', async (req, res) => {
    const type = ['all', 'film', 'serie', 'anime'].includes(String(req.query.type))
      ? String(req.query.type)
      : 'all';
    const genre = String(req.query.genre ?? '').trim().slice(0, 60);
    const randomPage = Math.floor(Math.random() * 5) + 1;
    const cat = await fetchUpstreamCatalogue({
      q: '',
      type,
      genre,
      year: '',
      lang: '',
      sort: 'recent',
      page: randomPage,
    });
    const pool = cat.items.length > 0 ? [...cat.items] : [...FALLBACK_ITEMS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    res.json({
      upstreamStatus: cat.upstreamStatus,
      spotlight: pool[0] ?? null,
      items: pool.slice(0, 12),
    });
  });

  app.get('/api/details/:type/:id', async (req, res) => {
    const rawType = String(req.params.type);
    const type: ItemType = ['film', 'serie', 'anime'].includes(rawType)
      ? (rawType as ItemType)
      : 'film';
    const id = String(req.params.id).slice(0, 24);
    const auth = await resolveAuth(req);
    const tmdbApiKey = await getTmdbApiKey();
    const detailCacheKey = `enriched-detail:v1:${type}:${id}:${tmdbApiKey.slice(0, 6)}`;

    type CachedDetailPayload = Omit<DetailResponse, 'rating'>;
    let baseDetail = getCached<CachedDetailPayload>(detailCacheKey);

    if (!baseDetail) {
      baseDetail = await coalesceUpstream<CachedDetailPayload | null>(detailCacheKey, async () => {
        const recheck = getCached<CachedDetailPayload>(detailCacheKey);
        if (recheck) return recheck;

        const detail = await fetchUpstreamDetail(type, id);
        if (!detail.item) {
          return null;
        }

        const enriched = await enrichDetailWithTmdb({
          type: detail.item.type === 'film' ? 'film' : type,
          item: detail.item,
          upstreamEpisodes: detail.episodes,
          apiKey: tmdbApiKey,
        });

        const firstGenre = enriched.item.genre?.split(',')[0]?.trim() ?? '';
        let sameGenre: Item[] = [];
        if (firstGenre) {
          const cat = await fetchUpstreamCatalogue({
            q: '',
            type,
            genre: firstGenre,
            year: '',
            lang: '',
            sort: 'recent',
            page: 1,
          });
          sameGenre = cat.items.filter((x) => x.id !== String(enriched.item.id)).slice(0, 6);
        }

        const built = {
          item: enriched.item,
          cast: detail.cast,
          related: detail.related,
          sameGenre,
          episodes: enriched.episodes,
          seasonsMeta: enriched.seasonsMeta,
          tmdbRating: enriched.tmdbRating,
        };
        return setCached(detailCacheKey, built, 180_000, 900_000);
      });
    }

    if (!baseDetail) {
      res.status(404).json({ error: 'Titre introuvable' });
      return;
    }

    const itemKey = `${type}:${id}`;
    const itemRatings = db.ratings.filter((r) => r.itemKey === itemKey);
    const count = itemRatings.length;
    const average =
      count > 0
        ? Math.round((itemRatings.reduce((sum, r) => sum + r.score, 0) / count) * 10) / 10
        : null;
    const myScore = auth
      ? (itemRatings.find((r) => r.userId === auth.user.id)?.score ?? null)
      : null;

    const isFilmDetail = type === 'film' || baseDetail.item?.type === 'film';
    const numericFilmId = isFilmDetail && /^\d+$/.test(id) ? Number(id) : 0;
    const canDownload = Boolean(
      auth && (auth.user.role === 'admin' || canPlanAccessFilmDownloads(auth.user.id))
    );
    let filmDownloads: Awaited<ReturnType<typeof fetchFilmDownloads>> = [];
    if (numericFilmId > 0) {
      const [dlUrl, dlKey] = await Promise.all([
        getFilmDownloadApiUrl(),
        Promise.resolve(getFilmDownloadApiKey()),
      ]);
      if (dlUrl && dlKey) {
        filmDownloads = await fetchFilmDownloads(numericFilmId, {
          apiUrl: dlUrl,
          apiKey: dlKey,
        });
      }
    }
    const hasDownloads = filmDownloads.length > 0;
    const downloadLocked = hasDownloads && !canDownload;
    const downloadMessage = downloadLocked ? await getFilmDownloadMessage() : undefined;

    res.setHeader('Vary', 'Authorization, Cookie');
    if (!auth && !extractToken(req)) {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600, stale-while-revalidate=1200');
    } else {
      res.setHeader('Cache-Control', 'private, no-cache');
    }

    res.json({
      item: baseDetail.item,
      cast: baseDetail.cast,
      related: baseDetail.related,
      sameGenre: baseDetail.sameGenre,
      episodes: baseDetail.episodes,
      seasonsMeta: baseDetail.seasonsMeta,
      tmdbRating: baseDetail.tmdbRating,
      rating: { average, count, myScore },
      ...(hasDownloads
        ? {
            downloads: canDownload ? filmDownloads : [],
            downloadCount: filmDownloads.length,
            downloadLocked,
            ...(downloadMessage ? { downloadMessage } : {}),
          }
        : {}),
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PROTECTED DOWNLOAD LINKS (/linprotect/:token -> CAPTCHA -> Redirect)
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/linprotect/inspect', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({
        error: 'Connexion requise pour accéder aux téléchargements.',
        requiresAuth: true,
        requiresPro: true,
      });
      return;
    }
    if (auth.user.role !== 'admin' && !canPlanAccessFilmDownloads(auth.user.id)) {
      res.status(403).json({
        error: await getFilmDownloadMessage(),
        requiresPro: true,
      });
      return;
    }

    const token = String(req.query.token ?? '').trim();
    const decrypted = decryptProtectedLink(token);
    if (!decrypted.ok) {
      res.status(decrypted.expired ? 410 : 400).json({ error: decrypted.error });
      return;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      filename: decrypted.data.filename,
      quality: decrypted.data.quality,
      challenge: createCaptchaChallenge(getClientIp(req)),
    });
  });

  app.post('/api/linprotect/unlock', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({
        error: 'Connexion requise pour déverrouiller ce lien.',
        requiresAuth: true,
        requiresPro: true,
      });
      return;
    }
    if (auth.user.role !== 'admin' && !canPlanAccessFilmDownloads(auth.user.id)) {
      res.status(403).json({
        error: await getFilmDownloadMessage(),
        requiresPro: true,
      });
      return;
    }

    const token = String(req.body?.token ?? '').trim();
    const decrypted = decryptProtectedLink(token);
    if (!decrypted.ok) {
      res.status(decrypted.expired ? 410 : 400).json({ error: decrypted.error });
      return;
    }

    const ip = getClientIp(req);
    if (req.body?.humanChecked !== true) {
      res.status(400).json({
        error: 'Veuillez confirmer la vérification humaine avant de continuer.',
        challenge: createCaptchaChallenge(ip),
      });
      return;
    }

    const captchaCheck = verifyCaptchaChallenge({
      captchaToken: req.body?.captchaToken,
      captchaAnswer: req.body?.captchaAnswer,
      ip,
    });
    if (!captchaCheck.ok) {
      res.status(400).json({
        error: captchaCheck.error || 'Code de sécurité incorrect.',
        challenge: createCaptchaChallenge(ip),
      });
      return;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      ok: true,
      url: decrypted.data.url,
      filename: decrypted.data.filename,
      quality: decrypted.data.quality,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PLAYER LAUNCH & SAME-ORIGIN STREAM PROXY
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/api/player/open', async (req, res) => {
    const auth = await resolveAuth(req);
    const rawItem = req.body?.item as Item | undefined;
    if (!rawItem || !rawItem.id || !rawItem.titre) {
      res.status(400).json({ error: 'Titre invalide' });
      return;
    }
    const tmdb = req.body?.tmdb ? String(req.body.tmdb).replace(/\D/g, '') : null;
    const season = Math.max(1, Math.min(500, Number(req.body?.season) || 1));
    const episode = Math.max(1, Math.min(5000, Number(req.body?.episode) || 1));

    const templates = await getPlayerTemplates();
    const isMember = Boolean(auth);
    const { template: planTpl, plan } = resolvePlanTemplateForUser(
      auth?.user.id ?? null,
      rawItem.item_type,
      templates
    );

    let resolvedPath = fillTemplate(planTpl, {
      id: rawItem.id,
      tmdb: tmdb || rawItem.tmdbId || null,
      s: season,
      e: episode,
    });

    if (!resolvedPath) {
      const fallbackTpl =
        plan.tier === 'pro'
          ? rawItem.item_type === 'film'
            ? templates.player_member_film
            : templates.player_member_serie
          : rawItem.item_type === 'film'
            ? templates.player_guest_film
            : templates.player_guest_serie;
      resolvedPath = fillTemplate(fallbackTpl, {
        id: rawItem.id,
        tmdb: tmdb || rawItem.tmdbId || null,
        s: season,
        e: episode,
      });
    }

    if (!resolvedPath && !isMember) {
      resolvedPath = fillTemplate(
        rawItem.item_type === 'film' ? templates.player_member_film : templates.player_member_serie,
        { id: rawItem.id, tmdb, s: season, e: episode }
      );
    }

    if (!resolvedPath) {
      res.status(400).json({ error: 'Lecteur indisponible pour ce titre.' });
      return;
    }

    const rawTypeStr = String(rawItem.item_type || 'film');
    const normalizedPlayType = (
      rawTypeStr.startsWith('custom:') ? 'custom' : rawTypeStr
    ) as 'film' | 'serie' | 'anime' | 'pinoy' | 'custom';
    recordPlayEvent({
      itemType: normalizedPlayType,
      itemId: String(rawItem.id),
      title: rawItem.titre,
      poster: rawItem.poster ?? null,
      moduleSlug: rawTypeStr.startsWith('custom:') ? rawTypeStr.slice(7) : null,
      req,
    });

    if (auth) {
      if (isSupabaseEnabled() && auth.sbClient) {
        try {
          await auth.sbClient.from('watch_events').insert({
            user_id: auth.user.id,
            item_id: rawItem.id,
            item_type: rawItem.item_type,
            item: rawItem,
          });
          invalidateSbMemberCache(auth.user.id);
        } catch {
          // Non-fatal if Supabase watch_events insert fails transiently
        }
      } else {
        db.watchEvents.unshift({
          id: crypto.randomUUID(),
          userId: auth.user.id,
          item: rawItem,
          season,
          episode,
          viewedAt: new Date().toISOString(),
        });
        if (db.watchEvents.length > 500) db.watchEvents = db.watchEvents.slice(0, 500);
      }

      // Watch history tracking — keep the 6 most recent watched titles
      const list = db.watchProgress[auth.user.id] ?? [];
      const epCode = `S${season}E${episode}`;
      const idx = list.findIndex(
        (p) => p.item.id === rawItem.id && p.item.item_type === rawItem.item_type
      );
      let entry: WatchProgress;
      if (idx >= 0) {
        const prev = list[idx];
        const watchedSet = new Set([...prev.watchedEpisodes, epCode]);
        list.splice(idx, 1);
        entry = {
          item: rawItem,
          tmdbId: tmdb || rawItem.tmdbId || prev.tmdbId,
          season,
          episode,
          updatedAt: new Date().toISOString(),
          watchedEpisodes: [...watchedSet],
        };
      } else {
        entry = {
          item: rawItem,
          tmdbId: tmdb || rawItem.tmdbId || null,
          season,
          episode,
          updatedAt: new Date().toISOString(),
          watchedEpisodes: [epCode],
        };
      }
      list.unshift(entry);
      db.watchProgress[auth.user.id] = list.slice(0, 6);
      saveDb(db);

      res.cookie('streamwall_watch', auth.token, getSessionCookieOptions(req, {
        path: '/api/public/watch',
        maxAge: 35 * 86_400_000,
      }));
    }

    const embedProvider = await getEmbedProvider();
    const normalizedForProxy = stripOriginFromTemplate(resolvedPath, embedProvider);
    const finalUrl = isFullUrlTemplate(normalizedForProxy)
      ? normalizedForProxy
      : `/api/public/watch/${normalizedForProxy.replace(/^\/+/, '')}`;

    res.json({
      url: finalUrl,
      member: isMember,
      season,
      episode,
    });
  });

  app.all(['/player/proxy/*', '/proxy/*', '/report.php', '/pinoy_report.php', '/api/loader.php'], async (req, res) => {
    const embedProvider = await getEmbedProvider();
    let upstreamBase = embedProvider;
    const refererHeader = String(req.headers.referer ?? '');
    if (req.path === '/pinoy_report.php' || refererHeader.includes('/api/public/watch/pinoy/')) {
      const pinoyTpl = await getPinoyPlayerTemplate();
      if (pinoyTpl) {
        try {
          upstreamBase = new URL(pinoyTpl.replace(/\{id\}/gi, '1').replace(/\{slug\}/gi, 'film')).origin;
        } catch {
          upstreamBase = embedProvider;
        }
      }
    } else {
      const customMatch = refererHeader.match(/\/api\/public\/watch\/custom\/([a-z0-9-]+)\//i);
      if (customMatch) {
        const customMod = getCustomModule(customMatch[1]);
        if (customMod?.player.playerUrlTemplate) {
          try {
            upstreamBase = new URL(
              customMod.player.playerUrlTemplate
                .replace(/\{id\}/gi, '1')
                .replace(/\{slug\}/gi, 'item')
            ).origin;
          } catch {
            upstreamBase = embedProvider;
          }
        }
      }
    }
    const targetUrl = `${upstreamBase}${req.originalUrl}`;
    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall Proxy)',
          referer: `${upstreamBase}/`,
          origin: upstreamBase,
          ...(req.headers['content-type'] ? { 'content-type': String(req.headers['content-type']) } : {}),
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(14_000),
      });
      const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status).setHeader('content-type', contentType).send(buf);
    } catch {
      res.status(502).json({ error: 'Upstream player resolver unreachable' });
    }
  });

  app.get(['/api/public/watch/pinoy/:id', '/api/public/watch/pinoy/:id/:slug'], async (req, res) => {
    if (!isPinoyModuleActive()) {
      res.status(404).send('Lecteur Pinoy désactivé ou supprimé');
      return;
    }
    const rawId = String(req.params.id ?? '').trim();
    if (!/^\d{1,12}$/.test(rawId)) {
      res.status(400).send('Identifiant Pinoy invalide');
      return;
    }
    const rawSlug = String(req.params.slug ?? 'film').trim().slice(0, 200);
    const safeSlug = /^[a-zA-Z0-9._-]+$/.test(rawSlug) ? rawSlug : 'film';

    const [playerTemplate, mediaBaseUrl] = await Promise.all([
      getPinoyPlayerTemplate(),
      getPinoyMediaBaseUrl(),
    ]);
    const targetUrl = resolvePinoyPlayerUrl(playerTemplate, {
      id: Number(rawId),
      slug: safeSlug,
    });
    if (!targetUrl) {
      res.status(404).send('Lecteur Pinoy non configuré');
      return;
    }

    try {
      const parsedTarget = new URL(targetUrl);
      const upstreamOrigin = parsedTarget.origin;
      const effectiveMediaOrigin = (mediaBaseUrl || upstreamOrigin).replace(/\/+$/, '');
      const upstream = await fetch(targetUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall Proxy)',
          referer: `${upstreamOrigin}/`,
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
      let html = await upstream.text();
      html = html.replace(/(["'])\/assets\//g, '$1/api/embed-assets/');
      html = html.replace(/url\(\s*\/assets\//gi, 'url(/api/embed-assets/');
      html = html.replace(/(["'(])\/uploads\//g, `$1${effectiveMediaOrigin}/uploads/`);
      res
        .status(200)
        .setHeader('content-type', 'text/html; charset=utf-8')
        .setHeader('cache-control', 'private, no-store')
        .send(html);
    } catch {
      res
        .status(200)
        .setHeader('content-type', 'text/html; charset=utf-8')
        .send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; background: #0b0e17; color: #f3f4f6; font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
    .box { max-width: 460px; border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 28px; background: #131826; }
    h2 { margin: 0 0 10px; font-size: 18px; color: #f5b938; }
    p { margin: 0; font-size: 14px; line-height: 1.6; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Lecteur Pinoy temporairement indisponible</h2>
    <p>Le serveur vidéo distant n’a pas répondu dans le délai imparti. Réessayez dans quelques instants.</p>
  </div>
</body>
</html>`);
    }
  });

  app.get(
    ['/api/public/watch/custom/:slug/:id', '/api/public/watch/custom/:slug/:id/:itemKey'],
    async (req, res) => {
      const mod = getCustomModule(String(req.params.slug ?? ''));
      if (!mod || !mod.enabled) {
        res.status(404).send('Lecteur introuvable');
        return;
      }
      const rawId = String(req.params.id ?? '').trim().slice(0, 120);
      const rawItemKey = String(req.params.itemKey ?? rawId).trim().slice(0, 200);
      if (!rawId || !/^[a-zA-Z0-9._-]+$/.test(rawId) || !/^[a-zA-Z0-9._-]+$/.test(rawItemKey)) {
        res.status(400).send('Identifiant lecteur invalide');
        return;
      }
      const targetUrl = resolveCustomPlayerUrl(mod.player.playerUrlTemplate, {
        id: rawId,
        slug: rawItemKey,
        routeKey: rawItemKey,
      });
      if (!targetUrl) {
        res.status(404).send('Modèle de lecteur non configuré');
        return;
      }
      try {
        const parsedTarget = new URL(targetUrl);
        const upstreamOrigin = parsedTarget.origin;
        const effectiveMediaOrigin = (mod.endpoints.mediaBaseUrl || upstreamOrigin).replace(/\/+$/, '');
        const upstream = await fetch(targetUrl, {
          headers: {
            'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall Proxy)',
            referer: `${upstreamOrigin}/`,
          },
          signal: AbortSignal.timeout(12_000),
        });
        if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
        let html = await upstream.text();
        html = html.replace(/(["'])\/assets\//g, '$1/api/embed-assets/');
        html = html.replace(/url\(\s*\/assets\//gi, 'url(/api/embed-assets/');
        html = html.replace(/(["'(])\/uploads\//g, `$1${effectiveMediaOrigin}/uploads/`);
        res
          .status(200)
          .setHeader('content-type', 'text/html; charset=utf-8')
          .setHeader('cache-control', 'private, no-store')
          .send(html);
      } catch {
        res
          .status(200)
          .setHeader('content-type', 'text/html; charset=utf-8')
          .send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; background: #0b0e17; color: #f3f4f6; font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
    .box { max-width: 460px; border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 28px; background: #131826; }
    h2 { margin: 0 0 10px; font-size: 18px; color: #f5b938; }
    p { margin: 0; font-size: 14px; line-height: 1.6; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Lecteur temporairement indisponible</h2>
    <p>Le serveur vidéo distant n’a pas répondu dans le délai imparti. Réessayez dans quelques instants.</p>
  </div>
</body>
</html>`);
      }
    }
  );

  app.get('/api/embed-assets/*', async (req, res) => {
    const assetPath = String((req.params as Record<string, string>)[0] ?? '').replace(/^\/+/, '');
    if (!assetPath || assetPath.includes('..')) {
      res.status(400).end();
      return;
    }
    const embedProvider = await getEmbedProvider();
    try {
      const upstream = await fetch(`${embedProvider}/assets/${assetPath}`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall Proxy)',
          referer: `${embedProvider}/`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const buf = Buffer.from(await upstream.arrayBuffer());
      res
        .status(200)
        .setHeader('content-type', contentType)
        .setHeader('cache-control', 'public, max-age=3600')
        .send(buf);
    } catch {
      res.status(502).end();
    }
  });

  app.get('/api/public/watch/*', async (req, res) => {
    const splat = String((req.params as Record<string, string>)[0] ?? '').replace(/^\/+/, '');
    const t = await getPlayerTemplates();
    const embedProvider = await getEmbedProvider();
    const planTemplates = getAllPlanTemplates();
    const isGuestPath =
      matchesTemplate(t.player_guest_film, splat, embedProvider) ||
      matchesTemplate(t.player_guest_serie, splat, embedProvider);
    const isMemberPath =
      matchesTemplate(t.player_member_film, splat, embedProvider) ||
      matchesTemplate(t.player_member_serie, splat, embedProvider);
    const isPlanPath = planTemplates.some((tpl) => matchesTemplate(tpl, splat, embedProvider));

    if (!isGuestPath && !isMemberPath && !isPlanPath) {
      res.status(404).send('Lecteur introuvable');
      return;
    }

    try {
      const upstream = await fetch(`${embedProvider}/${splat}`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall Proxy)',
          referer: `${embedProvider}/`,
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
      let html = await upstream.text();
      // Do NOT inject <base href> so relative fetch('/player/proxy/...'), fetch('/report.php'), and fetch('/api/loader.php') hit our same-origin proxy cleanly without CORS errors!
      html = html.replace(/(["'])\/assets\//g, '$1/api/embed-assets/');
      html = html.replace(/url\(\s*\/assets\//gi, 'url(/api/embed-assets/');
      html = html.replace(/(["'])\/(tvs|film|movie|tv)\//g, '$1/api/public/watch/$2/');
      res
        .status(200)
        .setHeader('content-type', 'text/html; charset=utf-8')
        .setHeader('cache-control', 'private, no-store')
        .send(html);
    } catch {
      res
        .status(200)
        .setHeader('content-type', 'text/html; charset=utf-8')
        .send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; background: #0b0e17; color: #f3f4f6; font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
    .box { max-width: 460px; border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 28px; background: #131826; }
    h2 { margin: 0 0 10px; font-size: 18px; color: #f5b938; }
    p { margin: 0; font-size: 14px; line-height: 1.6; color: #9ca3af; }
    code { display: inline-block; margin-top: 12px; font-size: 12px; color: #d1d5db; background: rgba(255,255,255,0.06); padding: 4px 10px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Embed temporairement indisponible</h2>
    <p>Le fournisseur d’embed ne répond pas dans le délai imparti. Vérifiez le champ « Embed provider » dans l’onglet Administration.</p>
    <code>${escapeHtml(embedProvider)}/${escapeHtml(splat)}</code>
  </div>
</body>
</html>`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MEMBER DATA, FAVORITES, PROGRESS, PROFILE, RATINGS, COMMENTS & FRIENDS
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/member', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    const progress = (db.watchProgress[auth.user.id] ?? [])
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6);

    const mapFriendRequests = (userId: string) => {
      const { incoming, outgoing } = listUserFriendRequests(userId);
      return {
        incomingFriendRequests: incoming.map((r) => ({
          ...r,
          fromAvatar: resolveUserAvatar(r.fromUserId, r.fromAvatar),
          fromIsPro: isUserPro(r.fromUserId),
          toAvatar: resolveUserAvatar(r.toUserId, r.toAvatar),
          toIsPro: isUserPro(r.toUserId),
        })),
        outgoingFriendRequests: outgoing.map((r) => ({
          ...r,
          fromAvatar: resolveUserAvatar(r.fromUserId, r.fromAvatar),
          fromIsPro: isUserPro(r.fromUserId),
          toAvatar: resolveUserAvatar(r.toUserId, r.toAvatar),
          toIsPro: isUserPro(r.toUserId),
        })),
      };
    };

    const mergeFavoriteItems = (primary: Item[], secondary: Item[]): Item[] => {
      const seen = new Set<string>();
      const out: Item[] = [];
      for (const fav of [...primary, ...secondary]) {
        if (!fav || fav.id === undefined || fav.id === null) continue;
        const normId = String(fav.id).trim();
        const normType = String(fav.item_type || '').trim();
        if (!normId || !normType) continue;
        const key = `${normType}:${normId}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ ...fav, id: normId });
        }
      }
      return out;
    };

    if (isSupabaseEnabled() && auth.sbClient) {
      const sbData = await sbGetMemberData(auth.sbClient, auth.user);
      const enrichedFriends = sbData.friends.map((f) => ({
        ...f,
        avatar: resolveUserAvatar(f.id, f.avatar),
        isPro: isUserPro(f.id),
      }));
      const mergedFavorites = mergeFavoriteItems(sbData.favorites, db.favorites[auth.user.id] ?? []);
      res.json({
        ...sbData,
        favorites: mergedFavorites,
        profile: auth.user,
        friends: enrichedFriends,
        ...mapFriendRequests(auth.user.id),
        progress,
        history: dedupTop6History(sbData.history),
      });
      return;
    }

    const favorites = mergeFavoriteItems(db.favorites[auth.user.id] ?? [], []);
    const history = dedupTop6History(db.watchEvents.filter((w) => w.userId === auth.user.id));

    const friendLinks = db.friendships.filter((f) => f.userId === auth.user.id);
    const friends = friendLinks
      .map((link) => {
        const fu = db.users.find((u) => u.id === link.friendId);
        if (!fu) return null;
        const recent = db.watchEvents
          .filter((w) => w.userId === fu.id)
          .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime())[0];
        return {
          id: fu.id,
          username: fu.username,
          avatar: resolveUserAvatar(fu.id, fu.avatar),
          isPro: isUserPro(fu.id),
          online: false,
          currentItem: null,
          recentWatch: recent ? { item: recent.item, viewedAt: recent.viewedAt } : null,
        };
      })
      .filter(Boolean);

    res.json({
      profile: auth.user,
      favorites,
      progress,
      history,
      friends,
      ...mapFriendRequests(auth.user.id),
    });
  });

  app.post('/api/favorites/toggle', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const rawItem = req.body?.item as Item | undefined;
    const normalizedId =
      rawItem?.id !== undefined && rawItem?.id !== null ? String(rawItem.id).trim() : '';
    const normalizedTitle = typeof rawItem?.titre === 'string' ? rawItem.titre.trim() : '';
    const normalizedType = String(rawItem?.item_type || '').trim();
    if (
      !rawItem ||
      !normalizedId ||
      !normalizedTitle ||
      !/^(film|serie|anime|pinoy|custom:[a-z0-9-]+)$/.test(normalizedType)
    ) {
      res.status(400).json({ error: 'Titre invalide' });
      return;
    }

    const item: Item = {
      ...rawItem,
      id: normalizedId,
      titre: normalizedTitle,
      item_type: normalizedType as Item['item_type'],
    };

    const mergeFavoritesList = (primary: Item[], secondary: Item[]): Item[] => {
      const seen = new Set<string>();
      const out: Item[] = [];
      for (const fav of [...primary, ...secondary]) {
        if (!fav || fav.id === undefined || fav.id === null) continue;
        const normId = String(fav.id).trim();
        const normType = String(fav.item_type || '').trim();
        if (!normId || !normType) continue;
        const key = `${normType}:${normId}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ ...fav, id: normId });
        }
      }
      return out;
    };

    if (isSupabaseEnabled() && auth.sbClient) {
      const localList = db.favorites[auth.user.id] ?? [];
      const existsLocally = localList.some(
        (f) => String(f.id).trim() === item.id && f.item_type === item.item_type
      );

      const { data: existing, error: selectErr } = await auth.sbClient
        .from('favorites')
        .select('item_id')
        .eq('user_id', auth.user.id)
        .eq('item_type', item.item_type)
        .eq('item_id', item.id)
        .maybeSingle();

      if ((!selectErr && existing) || existsLocally) {
        if (!selectErr && existing) {
          await auth.sbClient
            .from('favorites')
            .delete()
            .eq('user_id', auth.user.id)
            .eq('item_type', item.item_type)
            .eq('item_id', item.id);
        }
        if (existsLocally) {
          db.favorites[auth.user.id] = localList.filter(
            (f) => !(String(f.id).trim() === item.id && f.item_type === item.item_type)
          );
          saveDb(db);
        }
        invalidateSbMemberCache(auth.user.id);
        const sbData = await sbGetMemberData(auth.sbClient, auth.user);
        const merged = mergeFavoritesList(sbData.favorites, db.favorites[auth.user.id] ?? []);
        res.json({ saved: false, favorites: merged });
        return;
      }

      const { error: insertErr } = await auth.sbClient.from('favorites').insert({
        user_id: auth.user.id,
        item_type: item.item_type,
        item_id: item.id,
        item,
      });
      if (insertErr) {
        db.favorites[auth.user.id] = [
          item,
          ...localList.filter(
            (f) => !(String(f.id).trim() === item.id && f.item_type === item.item_type)
          ),
        ];
        saveDb(db);
      }
      invalidateSbMemberCache(auth.user.id);
      const sbData = await sbGetMemberData(auth.sbClient, auth.user);
      const merged = mergeFavoritesList(sbData.favorites, db.favorites[auth.user.id] ?? []);
      res.json({ saved: true, favorites: merged });
      return;
    }

    const current = db.favorites[auth.user.id] ?? [];
    const exists = current.some(
      (f) => String(f.id).trim() === item.id && f.item_type === item.item_type
    );
    db.favorites[auth.user.id] = exists
      ? current.filter((f) => !(String(f.id).trim() === item.id && f.item_type === item.item_type))
      : [item, ...current];
    saveDb(db);
    res.json({ saved: !exists, favorites: db.favorites[auth.user.id] });
  });

  app.delete('/api/progress/:type/:id', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const { type, id } = req.params;
    db.watchProgress[auth.user.id] = (db.watchProgress[auth.user.id] ?? []).filter(
      (p) => !(p.item.item_type === type && p.item.id === id)
    );
    saveDb(db);
    res.json({ ok: true });
  });

  app.delete('/api/history', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    db.watchEvents = db.watchEvents.filter((w) => w.userId !== auth.user.id);
    db.watchProgress[auth.user.id] = [];
    saveDb(db);
    res.json({ ok: true });
  });

  app.put('/api/profile', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    // Username is immutable once created
    if (
      typeof req.body?.username === 'string' &&
      req.body.username.trim() &&
      req.body.username.trim().toLowerCase() !== auth.user.username.toLowerCase()
    ) {
      res.status(403).json({ error: 'Le pseudo est définitif et ne peut plus être modifié.' });
      return;
    }

    // No photo uploads: users pick a curated avatar ID or get a random avatar
    const requestedAvatar =
      typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : null;
    const chosenAvatar = setUserAvatarChoice(auth.user.id, requestedAvatar);

    if (isSupabaseEnabled() && auth.sbClient) {
      const refreshed = await sbResolveUser(auth.token, { skipCache: true });
      res.json({
        profile: enrichUserProfile(
          refreshed?.user ?? { ...auth.user, avatar: chosenAvatar }
        ),
      });
      return;
    }

    const user = db.users.find((u) => u.id === auth.user.id);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable' });
      return;
    }
    user.avatar = chosenAvatar;
    for (const c of db.comments) {
      if (c.userId === user.id) {
        c.avatar = chosenAvatar;
      }
    }
    saveDb(db);
    res.json({
      profile: enrichUserProfile({
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: chosenAvatar,
        role: user.role,
        createdAt: user.createdAt,
      }),
    });
  });

  function formatEmailCooldownError(status: ReturnType<typeof getUserEmailChangeStatus>): string {
    const lastStr = status.lastEmailChangedAt
      ? new Date(status.lastEmailChangedAt).toLocaleDateString('fr-FR')
      : '';
    const nextStr = status.nextEmailChangeAt
      ? new Date(status.nextEmailChangeAt).toLocaleDateString('fr-FR')
      : '';
    return `Vous avez déjà modifié votre adresse email${lastStr ? ` le ${lastStr}` : ''}. Une seule modification par mois est autorisée${nextStr ? ` (prochaine modification possible le ${nextStr}, dans ${status.remainingDays} jour${status.remainingDays > 1 ? 's' : ''})` : ''}.`;
  }

  async function handleEmailChangeCodeRequest(req: express.Request, res: express.Response) {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const cooldown = getUserEmailChangeStatus(auth.user.id);
    if (cooldown.blocked) {
      res.status(429).json({ error: formatEmailCooldownError(cooldown) });
      return;
    }
    const newEmail = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      res.status(400).json({ error: 'Veuillez indiquer une adresse email valide.' });
      return;
    }
    const previousEmail = auth.user.email.trim().toLowerCase();
    if (newEmail === previousEmail) {
      res.status(400).json({ error: 'Cette adresse email est déjà associée à votre compte.' });
      return;
    }
    if (await isEmailTaken(newEmail)) {
      res.status(409).json({ error: 'Cette adresse email est déjà utilisée par un autre compte.' });
      return;
    }
    if (!isSmtpReady()) {
      res.status(400).json({
        error:
          'Aucune passerelle email (SMTP / Resend / Brevo) n’est configurée en administration pour envoyer le code à 6 chiffres.',
      });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    const key = `email_change:${auth.user.id}`;
    otpChallenges[key] = {
      purpose: 'email_change',
      userId: auth.user.id,
      email: newEmail,
      newEmail,
      username: auth.user.username,
      code,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
      lastSentAt: now,
      attempts: 0,
    };
    saveOtpChallenges();

    const mailRes = await sendEmailChangeVerificationEmail({
      to: newEmail,
      oldEmail: auth.user.email,
      username: auth.user.username,
      code,
    });
    if (!mailRes.ok) {
      delete otpChallenges[key];
      saveOtpChallenges();
      res.status(502).json({
        error: `Échec de l’envoi du code de confirmation : ${mailRes.error || 'vérifiez la configuration email.'}`,
      });
      return;
    }

    res.json({
      ok: true,
      requiresCode: true,
      requiresConfirmation: true,
      email: newEmail,
      expiresInMinutes: 15,
      message: `Un code de confirmation à 6 chiffres vient d’être envoyé à ${newEmail}.`,
    });
  }

  app.put('/api/profile/email', handleEmailChangeCodeRequest);
  app.post('/api/profile/email/request-code', handleEmailChangeCodeRequest);

  app.post('/api/profile/email/resend-code', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const cooldown = getUserEmailChangeStatus(auth.user.id);
    if (cooldown.blocked) {
      res.status(429).json({ error: formatEmailCooldownError(cooldown) });
      return;
    }
    const key = `email_change:${auth.user.id}`;
    const challenge = otpChallenges[key];
    if (!challenge || challenge.expiresAt <= Date.now() || !challenge.newEmail) {
      res.status(400).json({
        error: 'Demande de changement d’email expirée. Veuillez recommencer.',
      });
      return;
    }
    const waitMs = 20_000 - (Date.now() - challenge.lastSentAt);
    if (waitMs > 0) {
      res.status(429).json({
        error: `Patientez ${Math.ceil(waitMs / 1000)}s avant de renvoyer un code.`,
      });
      return;
    }

    const newCode = String(crypto.randomInt(100000, 1000000));
    challenge.code = newCode;
    challenge.expiresAt = Date.now() + 15 * 60_000;
    challenge.lastSentAt = Date.now();
    challenge.attempts = 0;
    saveOtpChallenges();

    const mailRes = await sendEmailChangeVerificationEmail({
      to: challenge.newEmail,
      oldEmail: auth.user.email,
      username: auth.user.username,
      code: newCode,
    });
    if (!mailRes.ok) {
      res.status(502).json({
        error: `Échec du renvoi du code : ${mailRes.error || 'vérifiez la configuration email.'}`,
      });
      return;
    }
    res.json({
      ok: true,
      message: `Un nouveau code à 6 chiffres vient d’être envoyé à ${challenge.newEmail}.`,
    });
  });

  app.post('/api/profile/email/verify-code', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const cooldown = getUserEmailChangeStatus(auth.user.id);
    if (cooldown.blocked) {
      res.status(429).json({ error: formatEmailCooldownError(cooldown) });
      return;
    }
    const code = String(req.body?.code ?? '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) {
      res.status(400).json({ error: 'Veuillez saisir le code complet à 6 chiffres.' });
      return;
    }

    const key = `email_change:${auth.user.id}`;
    const challenge = otpChallenges[key];
    if (!challenge || challenge.expiresAt <= Date.now() || !challenge.newEmail) {
      if (challenge) {
        delete otpChallenges[key];
        saveOtpChallenges();
      }
      res.status(400).json({
        error: 'Code expiré ou introuvable. Veuillez redemander un code.',
      });
      return;
    }

    if (challenge.attempts >= 3) {
      delete otpChallenges[key];
      saveOtpChallenges();
      res.status(429).json({
        error: 'Trop de tentatives incorrectes (3/3). Veuillez redemander un code.',
      });
      return;
    }

    if (challenge.code !== code) {
      challenge.attempts += 1;
      saveOtpChallenges();
      const remaining = Math.max(0, 3 - challenge.attempts);
      res.status(400).json({
        error:
          remaining > 0
            ? `Code à 6 chiffres incorrect (${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}).`
            : 'Code incorrect. Veuillez redemander un code.',
      });
      return;
    }

    const newEmail = challenge.newEmail;
    if (await isEmailTaken(newEmail)) {
      delete otpChallenges[key];
      saveOtpChallenges();
      res.status(409).json({ error: 'Cette adresse email est déjà utilisée par un autre compte.' });
      return;
    }

    let updatedBase: UserProfile = { ...auth.user, email: newEmail };
    if (isSupabaseEnabled() && auth.sbClient) {
      const adminSb = createAdminClient();
      if (!adminSb) {
        res.status(400).json({
          error: 'Clé SUPABASE_SERVICE_ROLE_KEY requise pour valider le changement d’adresse email.',
        });
        return;
      }
      const { error: adminErr } = await adminSb.auth.admin.updateUserById(auth.user.id, {
        email: newEmail,
        email_confirm: true,
      });
      if (adminErr) {
        res.status(400).json({ error: adminErr.message });
        return;
      }
      try {
        await adminSb.from('profiles').update({ contact_email: newEmail }).eq('id', auth.user.id);
      } catch {
        // Non-fatal
      }
      registerUserDirectoryEntry(auth.user.id, newEmail, auth.user.username);
    } else {
      const user = db.users.find((u) => u.id === auth.user.id);
      if (!user) {
        res.status(404).json({ error: 'Utilisateur introuvable.' });
        return;
      }
      user.email = newEmail;
      saveDb(db);
      registerUserDirectoryEntry(user.id, newEmail, user.username);
      updatedBase = {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt,
      };
    }

    recordUserEmailChanged(auth.user.id);
    const updatedProfile = enrichUserProfile(updatedBase);
    delete otpChallenges[key];
    saveOtpChallenges();
    res.json({
      ok: true,
      profile: updatedProfile,
      message: 'Adresse email vérifiée et mise à jour avec succès.',
    });
  });

  app.post('/api/profile/password/request-code', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const newPassword = String(req.body?.newPassword ?? '');
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
      return;
    }
    if (!isSmtpReady()) {
      res.status(400).json({
        error:
          'Aucune passerelle email (SMTP / Resend / Brevo) n’est configurée en administration pour envoyer le code à 6 chiffres.',
      });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    const key = `password_change:${auth.user.id}`;
    otpChallenges[key] = {
      purpose: 'password_change',
      userId: auth.user.id,
      email: auth.user.email,
      username: auth.user.username,
      newPassword,
      code,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
      lastSentAt: now,
      attempts: 0,
    };
    saveOtpChallenges();

    const mailRes = await sendPasswordChangeVerificationEmail({
      to: auth.user.email,
      username: auth.user.username,
      code,
    });
    if (!mailRes.ok) {
      delete otpChallenges[key];
      saveOtpChallenges();
      res.status(502).json({
        error: `Échec de l’envoi du code de confirmation : ${mailRes.error || 'vérifiez la configuration email.'}`,
      });
      return;
    }

    res.json({
      ok: true,
      requiresCode: true,
      email: auth.user.email,
      expiresInMinutes: 15,
      message: `Un code de confirmation à 6 chiffres vient d’être envoyé à ${auth.user.email}.`,
    });
  });

  app.post('/api/profile/password/resend-code', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const key = `password_change:${auth.user.id}`;
    const challenge = otpChallenges[key];
    if (!challenge || challenge.expiresAt <= Date.now()) {
      res.status(400).json({
        error: 'Demande de changement de mot de passe expirée. Veuillez recommencer.',
      });
      return;
    }
    const waitMs = 20_000 - (Date.now() - challenge.lastSentAt);
    if (waitMs > 0) {
      res.status(429).json({
        error: `Patientez ${Math.ceil(waitMs / 1000)}s avant de renvoyer un code.`,
      });
      return;
    }

    const newCode = String(crypto.randomInt(100000, 1000000));
    challenge.code = newCode;
    challenge.expiresAt = Date.now() + 15 * 60_000;
    challenge.lastSentAt = Date.now();
    challenge.attempts = 0;
    saveOtpChallenges();

    const mailRes = await sendPasswordChangeVerificationEmail({
      to: auth.user.email,
      username: auth.user.username,
      code: newCode,
    });
    if (!mailRes.ok) {
      res.status(502).json({
        error: `Échec du renvoi du code : ${mailRes.error || 'vérifiez la configuration email.'}`,
      });
      return;
    }
    res.json({
      ok: true,
      message: `Un nouveau code à 6 chiffres vient d’être envoyé à ${auth.user.email}.`,
    });
  });

  app.post('/api/profile/password/verify-code', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const code = String(req.body?.code ?? '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) {
      res.status(400).json({ error: 'Veuillez saisir le code complet à 6 chiffres.' });
      return;
    }

    const key = `password_change:${auth.user.id}`;
    const challenge = otpChallenges[key];
    if (!challenge || challenge.expiresAt <= Date.now() || !challenge.newPassword) {
      if (challenge) {
        delete otpChallenges[key];
        saveOtpChallenges();
      }
      res.status(400).json({
        error: 'Code expiré ou introuvable. Veuillez redemander un code.',
      });
      return;
    }

    if (challenge.attempts >= 3) {
      delete otpChallenges[key];
      saveOtpChallenges();
      res.status(429).json({
        error: 'Trop de tentatives incorrectes (3/3). Veuillez redemander un code.',
      });
      return;
    }

    if (challenge.code !== code) {
      challenge.attempts += 1;
      saveOtpChallenges();
      const remaining = Math.max(0, 3 - challenge.attempts);
      res.status(400).json({
        error:
          remaining > 0
            ? `Code à 6 chiffres incorrect (${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}).`
            : 'Code incorrect. Veuillez redemander un code.',
      });
      return;
    }

    const nextPassword = challenge.newPassword;
    if (isSupabaseEnabled() && auth.sbClient) {
      const adminSb = createAdminClient();
      if (adminSb) {
        const { error } = await adminSb.auth.admin.updateUserById(auth.user.id, {
          password: nextPassword,
        });
        if (error) {
          res.status(400).json({ error: error.message });
          return;
        }
      } else {
        const { error } = await auth.sbClient.auth.updateUser({ password: nextPassword });
        if (error) {
          res.status(400).json({ error: error.message });
          return;
        }
      }
    } else {
      const user = db.users.find((u) => u.id === auth.user.id);
      if (!user) {
        res.status(404).json({ error: 'Utilisateur introuvable.' });
        return;
      }
      user.passwordHash = hashPassword(nextPassword);
      saveDb(db);
    }

    delete otpChallenges[key];
    saveOtpChallenges();
    res.json({
      ok: true,
      message: 'Mot de passe vérifié et mis à jour avec succès.',
    });
  });

  async function handleSelfAccountDelete(req: express.Request, res: express.Response) {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    const confirmationText = String(req.body?.confirmationText ?? '').trim().toUpperCase();
    if (confirmationText !== 'SUPPRIMER') {
      res.status(400).json({
        error: 'Veuillez saisir SUPPRIMER pour confirmer la suppression définitive de votre compte.',
      });
      return;
    }

    if (auth.user.role === 'admin') {
      res.status(403).json({
        error: 'Un compte administrateur ne peut pas être supprimé.',
      });
      return;
    }

    const targetId = auth.user.id;
    const deletedEmail = auth.user.email.trim().toLowerCase();

    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (!adminSb) {
        res.status(400).json({
          error:
            'Ajoutez SUPABASE_SERVICE_ROLE_KEY dans vos secrets pour permettre la suppression définitive du compte.',
        });
        return;
      }

      const delRes = await deleteSupabaseUserAndRelations(adminSb, targetId);
      if (!delRes.ok) {
        res.status(400).json({ error: delRes.error || 'Suppression du compte impossible.' });
        return;
      }
    } else {
      const targetUser = db.users.find((u) => u.id === targetId);
      if (!targetUser) {
        res.status(404).json({ error: 'Compte introuvable.' });
        return;
      }
      if (targetUser.role === 'admin') {
        res.status(403).json({
          error: 'Un compte administrateur ne peut pas être supprimé.',
        });
        return;
      }
      db.users = db.users.filter((u) => u.id !== targetId);
      db.sessions = db.sessions.filter((s) => s.userId !== targetId);
      db.resetTokens = db.resetTokens.filter((t) => t.userId !== targetId);
      db.verifyTokens = (db.verifyTokens ?? []).filter((t) => t.userId !== targetId);
      delete db.favorites[targetId];
      delete db.watchProgress[targetId];
      db.watchEvents = db.watchEvents.filter((w) => w.userId !== targetId);
      db.comments = db.comments.filter((c) => c.userId !== targetId);
      db.friendships = db.friendships.filter((f) => f.userId !== targetId && f.friendId !== targetId);
      delete db.presence[targetId];
      db.ratings = db.ratings.filter((r) => r.userId !== targetId);
      saveDb(db);
    }

    revokeAllSessionsForUser(targetId);
    if (deletedEmail && pendingSignups[deletedEmail]) {
      delete pendingSignups[deletedEmail];
      savePendingSignups();
    }
    cleanupUserOtpChallenges(targetId, deletedEmail || undefined);
    cleanupUserBillingData(targetId, deletedEmail || undefined);
    cleanupUserNotifications(targetId);
    cleanupUserFriendRequests(targetId);
    deletePushSubscriptionsForUser(targetId);
    cleanupUserEmailCooldown(targetId);

    res.clearCookie('tapenaka_session', { path: '/' });
    res.clearCookie('streamwall_watch', { path: '/api/public/watch' });
    res.json({ ok: true, message: 'Votre compte a été supprimé définitivement.' });
  }

  app.delete('/api/profile', handleSelfAccountDelete);
  app.post('/api/profile/delete', handleSelfAccountDelete);

  app.post('/api/ratings', (_req, res) => {
    res.status(410).json({ error: 'La notation des titres a été désactivée.' });
  });

  app.get('/api/comments/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const auth = await resolveAuth(req);

    res.setHeader('Vary', 'Authorization, Cookie');
    if (!auth && !extractToken(req)) {
      res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    } else {
      res.setHeader('Cache-Control', 'private, no-cache');
    }

    if (isSupabaseEnabled()) {
      const comments = (await sbGetComments(auth?.sbClient ?? null, type, id)).map((c) => ({
        ...c,
        avatar: resolveUserAvatar(c.userId, c.avatar),
        isPro: isUserPro(c.userId),
      }));
      res.json({ comments });
      return;
    }

    const list = db.comments
      .filter((c) => c.itemType === type && c.itemId === id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((c) => ({
        ...c,
        avatar: resolveUserAvatar(c.userId, c.avatar),
        isPro: isUserPro(c.userId),
      }));
    res.json({ comments: list });
  });

  app.post('/api/comments', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise pour commenter' });
      return;
    }
    const rawItemType = String(req.body?.itemType ?? '').trim().toLowerCase();
    const itemType = (
      ['film', 'serie', 'anime', 'pinoy'].includes(rawItemType) ||
      /^custom:[a-z0-9][a-z0-9-]{1,40}$/.test(rawItemType)
        ? rawItemType
        : 'film'
    ) as CommentRecord['itemType'];
    const itemId = stripDangerousText(req.body?.itemId ?? '', 160);
    const itemTitle = stripDangerousText(req.body?.itemTitle ?? '', 120);
    const body = stripDangerousText(req.body?.body ?? '', 1000);
    const parentId = req.body?.parentId ? stripDangerousText(req.body.parentId, 80) : null;

    if (!itemId || !body) {
      res.status(400).json({ error: 'Commentaire vide' });
      return;
    }

    const dispatchCommentNotifications = async () => {
      const notified = new Set<string>([auth.user.id]);
      const titleLabel = itemTitle || `${itemType} #${itemId}`;
      const excerpt = body.slice(0, 120);
      const link = getContentDetailPath(itemType, itemId);

      try {
        if (parentId) {
          let parentAuthorId: string | null = null;
          if (isSupabaseEnabled() && auth.sbClient) {
            const reader = createAdminClient() ?? auth.sbClient;
            const { data: pRow } = await reader
              .from('comments')
              .select('user_id')
              .eq('id', parentId)
              .maybeSingle();
            if (pRow?.user_id) parentAuthorId = String(pRow.user_id);
          } else {
            parentAuthorId = db.comments.find((c) => c.id === parentId)?.userId ?? null;
          }

          if (parentAuthorId && !notified.has(parentAuthorId)) {
            notified.add(parentAuthorId);
            createNotification({
              userId: parentAuthorId,
              kind: 'comment_reply',
              title: `@${auth.user.username} a répondu à votre commentaire`,
              message: `Sur « ${titleLabel} » : ${excerpt}`,
              link,
            });
          }
        }

        const mentionMatches = [...body.matchAll(/@([\w.-]+)/g)].map((m) =>
          m[1].toLowerCase()
        );
        const uniqueHandles = [...new Set(mentionMatches)];
        for (const handle of uniqueHandles) {
          let mentionedId: string | null = null;
          if (isSupabaseEnabled() && auth.sbClient) {
            const reader = createAdminClient() ?? auth.sbClient;
            const { data: pMatches } = await reader
              .from('profiles')
              .select('id,username')
              .ilike('username', handle)
              .limit(1);
            if (pMatches && pMatches[0]?.id) {
              mentionedId = String(pMatches[0].id);
            }
          } else {
            mentionedId =
              db.users.find((u) => u.username.replace(/\s+/g, '').toLowerCase() === handle || u.username.toLowerCase() === handle)?.id ??
              null;
          }

          if (mentionedId && !notified.has(mentionedId)) {
            notified.add(mentionedId);
            createNotification({
              userId: mentionedId,
              kind: 'comment_mention',
              title: `@${auth.user.username} vous a mentionné`,
              message: `Dans « ${titleLabel} » : ${excerpt}`,
              link,
            });
          }
        }
      } catch {
        // Never fail comment creation on notification dispatch
      }
    };

    if (isSupabaseEnabled() && auth.sbClient) {
      const { data, error } = await auth.sbClient
        .from('comments')
        .insert({
          item_type: itemType,
          item_id: itemId,
          user_id: auth.user.id,
          parent_id: parentId,
          body,
        })
        .select('id,created_at')
        .single();
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      invalidateSbCommentsCache(itemType, itemId);
      await dispatchCommentNotifications();
      res.json({
        comment: {
          id: data.id,
          itemType,
          itemId,
          itemTitle: itemTitle || undefined,
          userId: auth.user.id,
          username: auth.user.username,
          avatar: auth.user.avatar,
          isPro: auth.user.isPro,
          parentId,
          body,
          createdAt: data.created_at,
        },
      });
      return;
    }

    const comment: CommentRecord = {
      id: crypto.randomUUID(),
      itemType,
      itemId,
      itemTitle: itemTitle || undefined,
      userId: auth.user.id,
      username: auth.user.username,
      avatar: auth.user.avatar,
      isPro: auth.user.isPro,
      parentId,
      body,
      createdAt: new Date().toISOString(),
    };
    db.comments.push(comment);
    saveDb(db);
    await dispatchCommentNotifications();
    res.json({ comment });
  });

  app.delete('/api/comments/:commentId', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      const { error } = await auth.sbClient
        .from('comments')
        .delete()
        .eq('id', req.params.commentId);
      if (error) {
        res.status(403).json({ error: error.message });
        return;
      }
      invalidateSbCommentsCache();
      res.json({ ok: true });
      return;
    }

    const target = db.comments.find((c) => c.id === req.params.commentId);
    if (!target) {
      res.status(404).json({ error: 'Commentaire introuvable' });
      return;
    }
    if (target.userId !== auth.user.id && auth.user.role !== 'admin') {
      res.status(403).json({ error: 'Suppression non autorisée' });
      return;
    }
    db.comments = db.comments.filter((c) => c.id !== target.id && c.parentId !== target.id);
    saveDb(db);
    res.json({ ok: true });
  });

  app.get('/api/members/search', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.json({ members: [] });
      return;
    }
    const q = String(req.query.q ?? '').trim();

    if (isSupabaseEnabled() && auth.sbClient) {
      const { data } = await auth.sbClient.rpc('search_members', { q });
      res.json({
        members: ((data ?? []) as { id: string; username: string }[]).map((m) => ({
          id: m.id,
          username: m.username,
          avatar: resolveUserAvatar(m.id),
          isPro: isUserPro(m.id),
        })),
      });
      return;
    }

    const qLower = q.toLowerCase();
    const matches = db.users
      .filter((u) => u.username && u.username.toLowerCase().startsWith(qLower))
      .slice(0, 8)
      .map((u) => ({
        id: u.id,
        username: u.username,
        avatar: resolveUserAvatar(u.id, u.avatar),
        isPro: isUserPro(u.id),
      }));
    res.json({ members: matches });
  });

  const ensureMutualFriendship = async (
    userA: string,
    userB: string,
    sbClient?: import('@supabase/supabase-js').SupabaseClient | null
  ) => {
    if (isSupabaseEnabled() && sbClient) {
      const adminSb = createAdminClient();
      const writer = adminSb ?? sbClient;
      await writer
        .from('friendships')
        .upsert(
          [
            { user_id: userA, friend_id: userB },
            { user_id: userB, friend_id: userA },
          ],
          { onConflict: 'user_id,friend_id', ignoreDuplicates: true }
        );
      invalidateSbMemberCache(userA);
      invalidateSbMemberCache(userB);
      return;
    }

    const nowIso = new Date().toISOString();
    let changed = false;
    if (!db.friendships.some((f) => f.userId === userA && f.friendId === userB)) {
      db.friendships.push({ userId: userA, friendId: userB, createdAt: nowIso });
      changed = true;
    }
    if (!db.friendships.some((f) => f.userId === userB && f.friendId === userA)) {
      db.friendships.push({ userId: userB, friendId: userA, createdAt: nowIso });
      changed = true;
    }
    if (changed) saveDb(db);
  };

  const removeMutualFriendship = async (
    userA: string,
    userB: string,
    sbClient?: import('@supabase/supabase-js').SupabaseClient | null
  ) => {
    if (isSupabaseEnabled() && sbClient) {
      const writer = createAdminClient() ?? sbClient;
      await writer.from('friendships').delete().eq('user_id', userA).eq('friend_id', userB);
      await writer.from('friendships').delete().eq('user_id', userB).eq('friend_id', userA);
      clearFriendRequestsBetween(userA, userB);
      invalidateSbMemberCache(userA);
      invalidateSbMemberCache(userB);
      return;
    }

    db.friendships = db.friendships.filter(
      (f) => !((f.userId === userA && f.friendId === userB) || (f.userId === userB && f.friendId === userA))
    );
    saveDb(db);
    clearFriendRequestsBetween(userA, userB);
  };

  app.post('/api/friends', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const friendId = String(req.body?.friendId ?? '').trim();
    if (!friendId || friendId === auth.user.id) {
      res.status(400).json({ error: 'Membre invalide' });
      return;
    }

    let targetStub: { id: string; username: string; avatar: string | null; isPro: boolean } | null = null;
    let alreadyFriends = false;

    if (isSupabaseEnabled() && auth.sbClient) {
      const reader = createAdminClient() ?? auth.sbClient;
      const { data: targetProfile } = await reader
        .from('profiles')
        .select('id,username')
        .eq('id', friendId)
        .maybeSingle();
      if (!targetProfile?.id) {
        res.status(404).json({ error: 'Membre introuvable' });
        return;
      }
      targetStub = {
        id: String(targetProfile.id),
        username: String(targetProfile.username || 'Membre'),
        avatar: resolveUserAvatar(String(targetProfile.id), null),
        isPro: isUserPro(String(targetProfile.id)),
      };
      const { data: existingLink } = await auth.sbClient
        .from('friendships')
        .select('friend_id')
        .eq('user_id', auth.user.id)
        .eq('friend_id', friendId)
        .maybeSingle();
      alreadyFriends = Boolean(existingLink);
    } else {
      const fu = db.users.find((u) => u.id === friendId);
      if (!fu) {
        res.status(404).json({ error: 'Membre introuvable' });
        return;
      }
      targetStub = {
        id: fu.id,
        username: fu.username,
        avatar: resolveUserAvatar(fu.id, fu.avatar),
        isPro: isUserPro(fu.id),
      };
      alreadyFriends = db.friendships.some(
        (f) => f.userId === auth.user.id && f.friendId === friendId
      );
    }

    const result = createOrMatchFriendRequest({
      fromUser: {
        id: auth.user.id,
        username: auth.user.username,
        avatar: resolveUserAvatar(auth.user.id, auth.user.avatar),
        isPro: Boolean(auth.user.isPro),
      },
      toUser: targetStub,
      alreadyFriends,
    });

    if (result.outcome === 'already_friends') {
      res.json({ ok: true, status: 'already_friends', request: null });
      return;
    }

    if (result.outcome === 'matched_accept') {
      await ensureMutualFriendship(auth.user.id, targetStub.id, auth.sbClient);
      createNotification({
        userId: targetStub.id,
        kind: 'friend_accepted',
        title: 'Demande d’ami acceptée',
        message: `@${auth.user.username} a accepté votre demande d’ami.`,
        link: '/profil#amis',
        dedupKey: `friend-acc:${result.request.id}`,
      });
      res.json({ ok: true, status: 'accepted', request: result.request });
      return;
    }

    if (result.outcome === 'created') {
      createNotification({
        userId: targetStub.id,
        kind: 'friend_request',
        title: 'Nouvelle demande d’ami',
        message: `@${auth.user.username} souhaite vous ajouter en ami.`,
        link: '/profil#amis',
        dedupKey: `friend-req:${result.request.id}`,
      });
    }

    res.json({
      ok: true,
      status: 'pending',
      alreadyPending: result.outcome === 'already_pending',
      request: result.request,
    });
  });

  app.post('/api/friends/requests/:requestId/accept', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    const outcome = acceptFriendRequest(req.params.requestId, auth.user.id);
    if (outcome.ok === false) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }

    await ensureMutualFriendship(outcome.request.fromUserId, auth.user.id, auth.sbClient);
    createNotification({
      userId: outcome.request.fromUserId,
      kind: 'friend_accepted',
      title: 'Demande d’ami acceptée',
      message: `@${auth.user.username} a accepté votre demande d’ami.`,
      link: '/profil#amis',
      dedupKey: `friend-acc:${outcome.request.id}`,
    });

    res.json({ ok: true, request: outcome.request });
  });

  app.post('/api/friends/requests/:requestId/decline', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    const outcome = declineFriendRequest(req.params.requestId, auth.user.id);
    if (outcome.ok === false) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }

    res.json({ ok: true, request: outcome.request });
  });

  app.delete('/api/friends/requests/:requestId', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    const outcome = cancelFriendRequest(req.params.requestId, auth.user.id);
    if (outcome.ok === false) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }

    res.json({ ok: true });
  });

  app.delete('/api/friends/:friendId', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    await removeMutualFriendship(auth.user.id, req.params.friendId, auth.sbClient);
    res.json({ ok: true });
  });

  // Live presence tracking removed to prevent concurrent database write contention.
  // Keep endpoint as a zero-DB no-op so any cached client tabs do not receive 404 errors.
  app.post('/api/presence/heartbeat', (_req, res) => {
    res.json({ ok: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN CONSOLE ROUTES
  // ─────────────────────────────────────────────────────────────────────────
  async function requireAdmin(
    req: express.Request,
    res: express.Response
  ): Promise<AuthResolution | null> {
    const auth = await resolveAuth(req);
    if (!auth || auth.user.role !== 'admin') {
      res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
      return null;
    }
    return auth;
  }

  app.get('/api/admin/overview', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const onlineUsersMap = getOnlineMemberPresence();
    const activeStats = getActivePresenceStats();

    if (isSupabaseEnabled() && auth.sbClient) {
      try {
        const sbOverview = await sbGetAdminOverview(auth.sbClient);
        const sbReader = createAdminClient() ?? auth.sbClient;
        const { data: commentRows } = await sbReader
          .from('comments')
          .select('id,item_type,item_id,user_id,parent_id,body,created_at')
          .order('created_at', { ascending: false })
          .limit(25);

        const enrichedUsers = sbOverview.users.map((u) => {
          registerUserDirectoryEntry(u.id, u.email, u.username);
          const subscription = getUserSubscription(u.id);
          const ban = getUserBanInfo(u.id);
          const liveInfo = onlineUsersMap.get(u.id);
          const online = !ban && (Boolean(liveInfo) || Boolean(u.online));
          return {
            ...u,
            online,
            lastSeen: liveInfo?.lastSeen ?? u.lastSeen,
            currentPage: liveInfo?.currentPage ?? u.currentPage,
            avatar: resolveUserAvatar(u.id, u.avatar),
            isPro: subscription.tier === 'pro',
            subscription,
            banned: Boolean(ban),
            bannedAt: ban?.bannedAt ?? null,
            banReason: ban?.reason ?? null,
          };
        });

        const recentComments: CommentRecord[] = (
          (commentRows ?? []) as Array<{
            id: string;
            item_type: ItemType;
            item_id: string;
            user_id: string;
            parent_id: string | null;
            body: string;
            created_at: string;
          }>
        ).map((c) => {
          const author = enrichedUsers.find((u) => u.id === c.user_id);
          return {
            id: c.id,
            itemType: c.item_type,
            itemId: c.item_id,
            userId: c.user_id,
            username: author?.username || 'Membre',
            avatar: resolveUserAvatar(c.user_id, author?.avatar ?? null),
            isPro: isUserPro(c.user_id),
            parentId: c.parent_id,
            body: c.body,
            createdAt: c.created_at,
          };
        });

        res.json({ ...sbOverview, users: enrichedUsers, recentComments, activeStats });
        return;
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur Supabase' });
        return;
      }
    }

    const users = db.users.map((u) => {
      registerUserDirectoryEntry(u.id, u.email, u.username);
      const plays = db.watchEvents.filter((w) => w.userId === u.id).length;
      const subscription = getUserSubscription(u.id);
      const ban = getUserBanInfo(u.id);
      const liveInfo = onlineUsersMap.get(u.id);
      const online = !ban && Boolean(liveInfo);
      return {
        id: u.id,
        email: u.email,
        username: u.username,
        avatar: resolveUserAvatar(u.id, u.avatar),
        isAdmin: u.role === 'admin',
        isPro: subscription.tier === 'pro',
        subscription,
        createdAt: u.createdAt,
        lastSeen: liveInfo?.lastSeen ?? null,
        online,
        currentItem: null,
        currentPage: liveInfo?.currentPage ?? null,
        plays,
        banned: Boolean(ban),
        bannedAt: ban?.bannedAt ?? null,
        banReason: ban?.reason ?? null,
      };
    });

    const recentComments = [...db.comments]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 25)
      .map((c) => ({
        ...c,
        avatar: resolveUserAvatar(c.userId, c.avatar),
        isPro: isUserPro(c.userId),
      }));

    res.json({
      users,
      top7: computeLocalRankings(7),
      top30: computeLocalRankings(30),
      recentComments,
      activeStats,
      source: 'local',
      warning: null,
    });
  });

  app.get('/api/admin/users/:userId/history', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    if (isSupabaseEnabled() && auth.sbClient) {
      const sbReader = createAdminClient() ?? auth.sbClient;
      const { data, error } = await sbReader
        .from('watch_events')
        .select('id,user_id,item,viewed_at')
        .eq('user_id', req.params.userId)
        .order('viewed_at', { ascending: false })
        .limit(100);
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      const history = (
        (data ?? []) as { id: string; user_id: string; item: Item; viewed_at: string }[]
      ).map((r) => ({
        id: r.id,
        userId: r.user_id,
        item: r.item,
        season: 1,
        episode: 1,
        viewedAt: r.viewed_at,
      }));
      res.json({ history });
      return;
    }

    const rows = db.watchEvents
      .filter((w) => w.userId === req.params.userId)
      .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime())
      .slice(0, 100);
    res.json({ history: rows });
  });

  app.post('/api/admin/users/:userId/role', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (!adminSb) {
        res.status(400).json({
          error: 'Ajoutez SUPABASE_SERVICE_ROLE_KEY dans vos secrets pour modifier les rôles depuis ici.',
        });
        return;
      }
      if (req.params.userId === auth.user.id) {
        res.status(400).json({ error: 'Impossible de retirer votre propre rôle administrateur.' });
        return;
      }
      const nextRole = req.body?.role === 'admin' ? 'admin' : 'user';
      if (nextRole === 'admin') {
        await adminSb
          .from('user_roles')
          .upsert({ user_id: req.params.userId, role: 'admin' }, { onConflict: 'user_id,role' });
      } else {
        await adminSb
          .from('user_roles')
          .delete()
          .eq('user_id', req.params.userId)
          .eq('role', 'admin');
      }
      invalidateSbUserCache({ userId: req.params.userId });
      invalidateSbAdminOverviewCache();
      res.json({ ok: true, role: nextRole === 'admin' ? 'admin' : 'member' });
      return;
    }

    const target = db.users.find((u) => u.id === req.params.userId);
    if (!target) {
      res.status(404).json({ error: 'Utilisateur introuvable' });
      return;
    }
    if (target.id === auth.user.id) {
      res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre rôle administrateur.' });
      return;
    }
    target.role = req.body?.role === 'admin' ? 'admin' : 'member';
    saveDb(db);
    res.json({ ok: true, role: target.role });
  });

  app.post('/api/admin/users/:userId/ban', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const targetId = String(req.params.userId || '').trim();
    if (!targetId) {
      res.status(400).json({ error: 'Identifiant utilisateur invalide.' });
      return;
    }
    if (targetId === auth.user.id) {
      res.status(400).json({ error: 'Impossible de bannir votre propre compte administrateur.' });
      return;
    }

    const shouldBan = Boolean(req.body?.banned);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 240);

    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (adminSb) {
        const { error: sbErr } = await adminSb.auth.admin.updateUserById(targetId, {
          ban_duration: shouldBan ? '876000h' : 'none',
        });
        if (sbErr) {
          res.status(400).json({ error: sbErr.message });
          return;
        }
      }
    } else {
      const target = db.users.find((u) => u.id === targetId);
      if (!target) {
        res.status(404).json({ error: 'Utilisateur introuvable' });
        return;
      }
      if (shouldBan) {
        db.sessions = db.sessions.filter((s) => s.userId !== targetId);
        delete db.presence[targetId];
        saveDb(db);
      }
    }

    if (shouldBan) {
      revokeAllSessionsForUser(targetId);
      invalidateSbUserCache({ userId: targetId });
      invalidateSbAdminOverviewCache();
      const record = banUser(targetId, auth.user.id, reason);
      res.json({ ok: true, banned: true, bannedAt: record.bannedAt, banReason: record.reason });
    } else {
      invalidateSbUserCache({ userId: targetId });
      invalidateSbAdminOverviewCache();
      unbanUser(targetId);
      res.json({ ok: true, banned: false, bannedAt: null, banReason: null });
    }
  });

  app.post('/api/admin/users/:userId/revoke-pro', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const targetId = String(req.params.userId || '').trim();
    if (!targetId) {
      res.status(400).json({ error: 'Identifiant utilisateur invalide.' });
      return;
    }
    const subscription = assignUserPlan({
      userId: targetId,
      planId: 'free',
      durationDays: 0,
      source: 'admin_manual',
      autoRenew: false,
      appUrl: resolveAppOrigin(req),
    });
    res.json({ ok: true, subscription });
  });

  app.delete('/api/admin/users/:userId', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const targetId = String(req.params.userId || '').trim();
    if (!targetId) {
      res.status(400).json({ error: 'Identifiant utilisateur invalide.' });
      return;
    }
    if (targetId === auth.user.id) {
      res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte administrateur.' });
      return;
    }

    let deletedEmail = '';
    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (!adminSb) {
        res.status(400).json({
          error:
            'Ajoutez la clé secrète SUPABASE_SERVICE_ROLE_KEY dans vos secrets pour supprimer définitivement un compte Supabase Auth.',
        });
        return;
      }
      try {
        const { data: uData } = await adminSb.auth.admin.getUserById(targetId);
        deletedEmail = (uData?.user?.email || '').trim().toLowerCase();
      } catch {
        // Ignore lookup error
      }
      const delRes = await deleteSupabaseUserAndRelations(adminSb, targetId);
      if (!delRes.ok) {
        res.status(400).json({ error: delRes.error || 'Suppression impossible' });
        return;
      }
    } else {
      const targetUser = db.users.find((u) => u.id === targetId);
      if (!targetUser) {
        res.status(404).json({ error: 'Utilisateur introuvable' });
        return;
      }
      deletedEmail = targetUser.email.trim().toLowerCase();
      db.users = db.users.filter((u) => u.id !== targetId);
      db.sessions = db.sessions.filter((s) => s.userId !== targetId);
      db.resetTokens = db.resetTokens.filter((t) => t.userId !== targetId);
      db.verifyTokens = (db.verifyTokens ?? []).filter((t) => t.userId !== targetId);
      delete db.favorites[targetId];
      delete db.watchProgress[targetId];
      db.watchEvents = db.watchEvents.filter((w) => w.userId !== targetId);
      db.comments = db.comments.filter((c) => c.userId !== targetId);
      db.friendships = db.friendships.filter((f) => f.userId !== targetId && f.friendId !== targetId);
      delete db.presence[targetId];
      db.ratings = db.ratings.filter((r) => r.userId !== targetId);
      saveDb(db);
    }

    revokeAllSessionsForUser(targetId);
    if (deletedEmail && pendingSignups[deletedEmail]) {
      delete pendingSignups[deletedEmail];
      savePendingSignups();
    }
    cleanupUserOtpChallenges(targetId, deletedEmail || undefined);
    cleanupUserBillingData(targetId, deletedEmail || undefined);
    cleanupUserNotifications(targetId);
    cleanupUserFriendRequests(targetId);
    deletePushSubscriptionsForUser(targetId);
    cleanupUserEmailCooldown(targetId);
    invalidateSbAdminOverviewCache();
    res.json({ ok: true });
  });

  app.get('/api/site/navigation', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(getSiteNavigation());
  });

  app.get('/api/admin/navigation', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json(getSiteNavigation());
  });

  app.put('/api/admin/navigation', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const outcome = updateSiteNavigation(req.body ?? {});
    if (!outcome.ok) {
      res.status(400).json({ error: outcome.error });
      return;
    }
    res.json(outcome.navigation);
  });

  app.post('/api/admin/navigation/reset', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json(resetSiteNavigation());
  });

  app.get('/api/admin/custom-modules', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({ modules: listCustomModules(true) });
  });

  app.post('/api/admin/custom-modules/test', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const validated = validateCustomModuleDraft(req.body ?? {});
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const report = await testCustomModuleConfig(validated.module);
    res.json(report);
  });

  app.post('/api/admin/custom-modules', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const outcome = upsertCustomModule(body, {
      syncMenu: body.syncMenu !== false,
      showDesktop: body.showDesktop !== false,
      showMobile: body.showMobile !== false,
      showFooter: body.showFooter !== false,
    });
    if (!outcome.ok) {
      res.status(400).json({ error: outcome.error });
      return;
    }
    if (outcome.module.slug === 'pinoy') {
      db.settings.pinoy_api_url = outcome.module.endpoints.apiUrl;
      db.settings.pinoy_media_base_url = outcome.module.endpoints.mediaBaseUrl;
      db.settings.pinoy_player_template = outcome.module.player.playerUrlTemplate;
      db.settings.pinoy_download_message = outcome.module.player.downloadRestrictionMessage;
      saveDb(db);
      clearPinoyCache();
    }
    clearCustomApiCache(outcome.module.slug);
    res.json({ module: outcome.module, navigation: getSiteNavigation() });
  });

  app.put('/api/admin/custom-modules/:slug', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const body = { ...(req.body ?? {}), slug: req.body?.slug ?? req.params.slug } as Record<string, unknown>;
    const outcome = upsertCustomModule(body, {
      syncMenu: body.syncMenu !== false,
      showDesktop: body.showDesktop !== false,
      showMobile: body.showMobile !== false,
      showFooter: body.showFooter !== false,
    });
    if (!outcome.ok) {
      res.status(400).json({ error: outcome.error });
      return;
    }
    if (outcome.module.slug === 'pinoy') {
      db.settings.pinoy_api_url = outcome.module.endpoints.apiUrl;
      db.settings.pinoy_media_base_url = outcome.module.endpoints.mediaBaseUrl;
      db.settings.pinoy_player_template = outcome.module.player.playerUrlTemplate;
      db.settings.pinoy_download_message = outcome.module.player.downloadRestrictionMessage;
      saveDb(db);
      clearPinoyCache();
    }
    clearCustomApiCache(outcome.module.slug);
    res.json({ module: outcome.module, navigation: getSiteNavigation() });
  });

  app.delete('/api/admin/custom-modules/:slug', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const rawSlug = String(req.params.slug ?? '');
    const ok = deleteCustomModule(rawSlug);
    if (!ok) {
      res.status(404).json({ error: 'Module introuvable.' });
      return;
    }
    if (rawSlug.trim().toLowerCase() === 'pinoy' || rawSlug.trim() === 'mod_pinoy_builtin') {
      clearPinoyCache();
    }
    clearCustomApiCache();
    res.json({ ok: true, navigation: getSiteNavigation() });
  });

  app.get('/api/site/config', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json(await getSiteConfig());
  });

  app.get('/api/site/favicon', (_req, res) => {
    const uploaded = findUploadedFaviconFile();
    if (uploaded) {
      res
        .status(200)
        .setHeader('content-type', uploaded.contentType)
        .setHeader('cache-control', 'public, max-age=300')
        .send(fs.readFileSync(uploaded.filePath));
      return;
    }
    const fallback = path.join(__dirname, 'public', 'favicon.ico');
    if (fs.existsSync(fallback)) {
      res.sendFile(fallback);
      return;
    }
    res.status(404).end();
  });

  app.get('/api/admin/settings', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({
      origin: await getOrigin(),
      embedProvider: await getEmbedProvider(),
      players: await getPlayerTemplates(),
      tmdbApiKey: await getTmdbApiKey(),
      pinoyApiUrl: await getPinoyApiUrl(),
      pinoyMediaBaseUrl: await getPinoyMediaBaseUrl(),
      pinoyPlayerTemplate: await getPinoyPlayerTemplate(),
      pinoyDownloadMessage: await getPinoyDownloadMessage(),
      filmDownload: {
        apiUrl: await getFilmDownloadApiUrl(),
        apiKeyConfigured: Boolean(getFilmDownloadApiKey()),
        apiKeyMask: maskFilmDownloadToken(getFilmDownloadApiKey()),
        message: await getFilmDownloadMessage(),
      },
      smtp: getAdminSmtpStatus(),
      site: await getSiteConfig(),
      supabaseServiceRoleConfigured: Boolean(createAdminClient()),
      persistence: getPersistenceSummary(),
    });
  });

  app.put('/api/admin/settings/site', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const current = await getSiteConfig();
    const rawName = String(req.body?.siteName ?? current.siteName).trim().slice(0, 60);
    if (!rawName) {
      res.status(400).json({ error: 'Le nom du site ne peut pas être vide.' });
      return;
    }

    let nextFaviconUrl = current.faviconUrl || '/favicon.ico';
    const uploadDataUrl =
      typeof req.body?.faviconUploadDataUrl === 'string'
        ? req.body.faviconUploadDataUrl.trim()
        : '';

    if (uploadDataUrl) {
      const m = uploadDataUrl.match(
        /^data:image\/(x-icon|vnd\.microsoft\.icon|png|svg\+xml|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i
      );
      if (!m) {
        res.status(400).json({
          error: 'Format de favicon non supporté. Utilisez ICO, PNG, SVG, JPG ou WEBP.',
        });
        return;
      }
      const mimeSub = m[1].toLowerCase();
      const ext =
        mimeSub === 'svg+xml'
          ? 'svg'
          : mimeSub === 'x-icon' || mimeSub === 'vnd.microsoft.icon'
            ? 'ico'
            : mimeSub === 'jpeg'
              ? 'jpg'
              : mimeSub;
      const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
      if (buf.length === 0 || buf.length > 1_500_000) {
        res.status(400).json({ error: 'Le fichier favicon doit faire moins de 1,5 Mo.' });
        return;
      }
      fs.mkdirSync(DATA_DIR, { recursive: true });
      for (const oldExt of Object.keys(FAVICON_MIME_BY_EXT)) {
        const oldPath = path.join(DATA_DIR, `tapenaka-favicon.${oldExt}`);
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch {
            // Ignore cleanup failure
          }
        }
      }
      fs.writeFileSync(path.join(DATA_DIR, `tapenaka-favicon.${ext}`), buf);
      nextFaviconUrl = `/api/site/favicon?v=${Date.now()}`;
    } else if (typeof req.body?.faviconUrl === 'string') {
      const rawUrl = req.body.faviconUrl.trim();
      if (!rawUrl) {
        nextFaviconUrl = '/favicon.ico';
      } else if (/^(\/[^\s"'<>]+|https?:\/\/[^\s"'<>]+)$/i.test(rawUrl)) {
        nextFaviconUrl = rawUrl;
      } else {
        res.status(400).json({
          error: 'URL de favicon invalide (ex. /favicon.ico ou https://exemple.com/icon.png).',
        });
        return;
      }
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      const writer = createAdminClient() ?? auth.sbClient;
      const now = new Date().toISOString();
      const { error } = await writer.from('app_settings').upsert([
        { key: 'site_name', value: rawName, updated_at: now },
        { key: 'favicon_url', value: nextFaviconUrl, updated_at: now },
      ]);
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    }

    db.settings.site_name = rawName;
    db.settings.favicon_url = nextFaviconUrl;
    saveDb(db);
    invalidateSbSettingsCache();

    res.json({
      site: {
        siteName: rawName,
        faviconUrl: nextFaviconUrl,
      },
    });
  });

  app.get('/api/admin/notifications', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({
      broadcasts: listAdminBroadcasts(),
      guestNotifications: listGuestNotifications(),
      pushStats: getPushStats(),
    });
  });

  app.delete('/api/admin/notifications/guest/:id', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const ok = deleteGuestNotification(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Notification invité introuvable.' });
      return;
    }
    res.json({ ok: true, guestNotifications: listGuestNotifications() });
  });

  app.post('/api/admin/notifications', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const rawTarget = String(req.body?.target ?? 'all');
    const target: AdminNotificationTarget = ['all', 'pro', 'free', 'guest', 'user'].includes(rawTarget)
      ? (rawTarget as AdminNotificationTarget)
      : 'all';
    const title = String(req.body?.title ?? '').trim().slice(0, 120);
    const message = String(req.body?.message ?? '').trim().slice(0, 400);
    const rawLink = String(req.body?.link ?? '/').trim();
    const link = rawLink && /^(\/[^\s"'<>]*|https?:\/\/[^\s"'<>]+)$/i.test(rawLink) ? rawLink : '/';

    if (!title || !message) {
      res.status(400).json({ error: 'Renseignez un titre et un message pour la notification.' });
      return;
    }

    const sendPush = req.body?.sendPush !== false;
    let sentCount = 0;
    let pushRecipientIds: string[] = [];

    if (target === 'guest') {
      createGuestNotification({
        kind: 'admin_announcement',
        title,
        message,
        link,
      });
      sentCount = 1;
    } else {
      let knownUserIds: string[] = [];
      if (isSupabaseEnabled() && auth.sbClient) {
        try {
          const sbOverview = await sbGetAdminOverview(auth.sbClient);
          knownUserIds = sbOverview.users.map((u) => u.id);
        } catch (err) {
          res.status(500).json({
            error: err instanceof Error ? err.message : 'Impossible de charger les utilisateurs Supabase.',
          });
          return;
        }
      } else {
        knownUserIds = db.users.map((u) => u.id);
      }

      let recipientIds: string[] = [];
      if (target === 'user') {
        const requested: string[] = Array.isArray(req.body?.userIds)
          ? (req.body.userIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
          : [];
        const single = req.body?.userId ? String(req.body.userId).trim() : '';
        const rawSelected: string[] = [...new Set(single ? [...requested, single] : requested)];
        if (rawSelected.length === 0) {
          res.status(400).json({ error: 'Sélectionnez au moins un utilisateur cible.' });
          return;
        }
        const knownSet = new Set(knownUserIds);
        recipientIds = knownSet.size > 0 ? rawSelected.filter((id) => knownSet.has(id)) : rawSelected;
        if (recipientIds.length === 0) {
          res.status(404).json({ error: 'Aucun utilisateur valide trouvé dans la sélection.' });
          return;
        }
      } else if (target === 'pro') {
        recipientIds = knownUserIds.filter((id) => isUserPro(id));
      } else if (target === 'free') {
        recipientIds = knownUserIds.filter((id) => !isUserPro(id));
      } else {
        recipientIds = knownUserIds;
      }

      pushRecipientIds = recipientIds;

      for (const userId of recipientIds) {
        const created = createNotification({
          userId,
          kind: 'admin_announcement',
          title,
          message,
          link,
          skipPush: true,
        });
        if (created) sentCount += 1;
      }

      if (target === 'all') {
        createGuestNotification({
          kind: 'admin_announcement',
          title,
          message,
          link,
        });
      }
    }

    let pushResult = { attempted: 0, sent: 0, failed: 0, removed: 0 };
    if (sendPush) {
      const pushPayload = {
        title,
        body: message,
        url: link,
        tag: `admin-${target}-${Date.now()}`,
      };
      if (target === 'all') {
        pushResult = await sendPushToAll(pushPayload);
      } else if (target === 'guest') {
        pushResult = await sendPushToGuests(pushPayload);
      } else {
        pushResult = await sendPushToUsers(pushRecipientIds, pushPayload);
      }
    }

    const broadcast = recordAdminBroadcast({
      target,
      recipientCount: sentCount,
      title,
      message,
      link,
    });

    res.json({ ok: true, sentCount, broadcast, pushResult, pushStats: getPushStats() });
  });

  app.put('/api/admin/settings/smtp', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const status = updateAdminSmtpConfig({
      provider: req.body?.provider,
      enabled: req.body?.enabled,
      host: req.body?.host,
      port: req.body?.port,
      secure: req.body?.secure,
      user: req.body?.user,
      pass: req.body?.pass,
      clearPass: req.body?.clearPass,
      resendApiKey: req.body?.resendApiKey,
      clearResendApiKey: req.body?.clearResendApiKey,
      brevoApiKey: req.body?.brevoApiKey,
      clearBrevoApiKey: req.body?.clearBrevoApiKey,
      fromName: req.body?.fromName,
      fromEmail: req.body?.fromEmail,
      requireSignupConfirmation: req.body?.requireSignupConfirmation,
    });
    res.json({ smtp: status });
  });

  app.post('/api/admin/settings/smtp/test', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const to = String(req.body?.to ?? auth.user.email ?? '').trim();
    if (!to.includes('@')) {
      res.status(400).json({ error: 'Indiquez une adresse email de destination valide.' });
      return;
    }
    const result = await sendTestEmail(to);
    if (!result.ok) {
      res.status(400).json({ error: result.error || 'Échec de l’envoi email.' });
      return;
    }
    res.json({ ok: true, message: `Email de test envoyé à ${to}.` });
  });

  app.get('/api/admin/mail/templates', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({ templates: listEmailTemplates() });
  });

  app.put('/api/admin/mail/templates/:key', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const key = String(req.params.key || '') as EmailTemplateKey;
    if (!EMAIL_TEMPLATE_KEYS.includes(key)) {
      res.status(404).json({ error: 'Template email introuvable.' });
      return;
    }
    const updated = updateEmailTemplate(key, {
      subject: typeof req.body?.subject === 'string' ? req.body.subject : undefined,
      heading: typeof req.body?.heading === 'string' ? req.body.heading : undefined,
      body: typeof req.body?.body === 'string' ? req.body.body : undefined,
      ctaLabel: typeof req.body?.ctaLabel === 'string' ? req.body.ctaLabel : undefined,
      bgColor: typeof req.body?.bgColor === 'string' ? req.body.bgColor : undefined,
      cardBgColor: typeof req.body?.cardBgColor === 'string' ? req.body.cardBgColor : undefined,
      textColor: typeof req.body?.textColor === 'string' ? req.body.textColor : undefined,
      accentColor: typeof req.body?.accentColor === 'string' ? req.body.accentColor : undefined,
      useCustomHtml: typeof req.body?.useCustomHtml === 'boolean' ? req.body.useCustomHtml : undefined,
      customHtml: typeof req.body?.customHtml === 'string' ? req.body.customHtml : undefined,
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Template email introuvable.' });
      return;
    }
    res.json({ template: updated });
  });

  app.post('/api/admin/mail/templates/:key/reset', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const key = String(req.params.key || '') as EmailTemplateKey;
    if (!EMAIL_TEMPLATE_KEYS.includes(key)) {
      res.status(404).json({ error: 'Template email introuvable.' });
      return;
    }
    const template = resetEmailTemplate(key);
    res.json({ template });
  });

  app.post('/api/admin/mail/templates/:key/test', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const key = String(req.params.key || '') as EmailTemplateKey;
    if (!EMAIL_TEMPLATE_KEYS.includes(key)) {
      res.status(404).json({ error: 'Template email introuvable.' });
      return;
    }
    const to = String(req.body?.to ?? auth.user.email ?? '').trim();
    if (!to.includes('@')) {
      res.status(400).json({ error: 'Indiquez une adresse email de destination valide.' });
      return;
    }
    const result = await sendTemplateTestEmail({
      to,
      templateKey: key,
      appUrl: resolveAppOrigin(req),
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error || 'Échec de l’envoi du test.' });
      return;
    }
    res.json({ ok: true, message: `Aperçu du template envoyé à ${to}.` });
  });

  app.get('/api/admin/mail/logs', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const status = req.query.status ? String(req.query.status) : 'all';
    const q = req.query.q ? String(req.query.q) : '';
    res.json({ logs: listMailLogs({ status, q }) });
  });

  app.delete('/api/admin/mail/logs', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    clearMailLogs();
    res.json({ ok: true });
  });

  app.put('/api/admin/settings/embed-provider', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const raw = String(req.body?.embedProvider ?? '').trim();
    if (!/^https?:\/\/[^/\s]+\/?$/i.test(raw)) {
      res
        .status(400)
        .json({ error: 'Indiquez uniquement le domaine racine, ex. https://streamwall.behoririka.mg/' });
      return;
    }
    const clean = raw.replace(/\/+$/, '');
    if (isSupabaseEnabled() && auth.sbClient) {
      const { error } = await auth.sbClient
        .from('app_settings')
        .upsert({ key: 'embed_provider', value: clean, updated_at: new Date().toISOString() });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    }
    db.settings.embed_provider = clean;
    saveDb(db);
    invalidateSbSettingsCache();
    res.json({ embedProvider: clean });
  });

  app.put('/api/admin/settings/tmdb', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const rawKey = String(req.body?.tmdbApiKey ?? '').trim();
    if (rawKey && !/^[a-zA-Z0-9._-]{12,128}$/.test(rawKey)) {
      res.status(400).json({ error: 'Clé API TMDB invalide.' });
      return;
    }
    const nextKey = rawKey || DEFAULT_TMDB_API_KEY;
    if (isSupabaseEnabled() && auth.sbClient) {
      const { error } = await auth.sbClient
        .from('app_settings')
        .upsert({ key: 'tmdb_api_key', value: nextKey, updated_at: new Date().toISOString() });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    }
    db.settings.tmdb_api_key = nextKey;
    saveDb(db);
    invalidateSbSettingsCache();
    upstreamCache.clear();
    clearTmdbCache();
    res.json({ tmdbApiKey: nextKey });
  });

  app.put('/api/admin/settings/origin', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const raw = String(req.body?.origin ?? '').trim();
    if (!/^https?:\/\/[^/\s]+\/?$/i.test(raw)) {
      res
        .status(400)
        .json({ error: 'Indiquez uniquement le domaine racine, ex. https://streamwall.behoririka.mg' });
      return;
    }
    const clean = raw.replace(/\/+$/, '');
    if (isSupabaseEnabled() && auth.sbClient) {
      const { error } = await auth.sbClient
        .from('app_settings')
        .upsert({ key: 'api_origin', value: clean, updated_at: new Date().toISOString() });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    } else {
      db.settings.api_origin = clean;
      saveDb(db);
    }
    invalidateSbSettingsCache();
    upstreamCache.clear();
    res.json({ origin: clean });
  });

  app.put('/api/admin/settings/pinoy', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const currentApiUrl = await getPinoyApiUrl();
    const currentMediaBaseUrl = await getPinoyMediaBaseUrl();
    const currentPlayerTemplate = await getPinoyPlayerTemplate();
    const currentDownloadMessage = await getPinoyDownloadMessage();

    const nextRawApiUrl =
      req.body?.pinoyApiUrl !== undefined ? String(req.body.pinoyApiUrl).trim() : currentApiUrl;
    const nextRawMediaBaseUrl =
      req.body?.pinoyMediaBaseUrl !== undefined
        ? String(req.body.pinoyMediaBaseUrl).trim()
        : currentMediaBaseUrl;
    const nextRawPlayerTemplate =
      req.body?.pinoyPlayerTemplate !== undefined
        ? String(req.body.pinoyPlayerTemplate).trim()
        : currentPlayerTemplate;
    const nextDownloadMessage =
      req.body?.pinoyDownloadMessage !== undefined
        ? sanitizePinoyDownloadMessage(req.body.pinoyDownloadMessage)
        : currentDownloadMessage;

    const apiValidation = validatePinoyApiUrl(nextRawApiUrl);
    if (!apiValidation.ok) {
      res.status(400).json({ error: apiValidation.error });
      return;
    }

    const mediaValidation = validatePinoyMediaBaseUrl(nextRawMediaBaseUrl);
    if (!mediaValidation.ok) {
      res.status(400).json({ error: mediaValidation.error });
      return;
    }

    const playerValidation = validatePinoyPlayerTemplate(nextRawPlayerTemplate);
    if (!playerValidation.ok) {
      res.status(400).json({ error: playerValidation.error });
      return;
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      const writer = createAdminClient() ?? auth.sbClient;
      const now = new Date().toISOString();
      const { error } = await writer.from('app_settings').upsert([
        { key: 'pinoy_api_url', value: apiValidation.url, updated_at: now },
        { key: 'pinoy_media_base_url', value: mediaValidation.url, updated_at: now },
        { key: 'pinoy_player_template', value: playerValidation.template, updated_at: now },
        { key: 'pinoy_download_message', value: nextDownloadMessage, updated_at: now },
      ]);
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    }
    db.settings.pinoy_api_url = apiValidation.url;
    db.settings.pinoy_media_base_url = mediaValidation.url;
    db.settings.pinoy_player_template = playerValidation.template;
    db.settings.pinoy_download_message = nextDownloadMessage;
    saveDb(db);
    syncPinoyModuleFromSettings({
      apiUrl: apiValidation.url,
      mediaBaseUrl: mediaValidation.url,
      playerUrlTemplate: playerValidation.template,
      downloadRestrictionMessage: nextDownloadMessage,
    });
    invalidateSbSettingsCache();
    clearPinoyCache();
    res.json({
      pinoyApiUrl: apiValidation.url,
      pinoyMediaBaseUrl: mediaValidation.url,
      pinoyPlayerTemplate: playerValidation.template,
      pinoyDownloadMessage: nextDownloadMessage,
    });
  });

  app.put('/api/admin/settings/film-download', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const currentUrl = await getFilmDownloadApiUrl();
    const currentMessage = await getFilmDownloadMessage();

    const nextRawUrl =
      req.body?.apiUrl !== undefined ? String(req.body.apiUrl).trim() : currentUrl;
    const urlValidation = validateFilmDownloadApiUrl(nextRawUrl);
    if (!urlValidation.ok) {
      res.status(400).json({ error: urlValidation.error });
      return;
    }

    const nextMessage =
      req.body?.message !== undefined
        ? sanitizeFilmDownloadMessage(req.body.message)
        : currentMessage;

    const clearApiKey = Boolean(req.body?.clearApiKey);
    const rawNewKey =
      typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (rawNewKey && (rawNewKey.length < 6 || rawNewKey.length > 512 || /[\r\n\0]/.test(rawNewKey))) {
      res.status(400).json({ error: 'Clé API invalide (6 à 512 caractères sans retour à la ligne).' });
      return;
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      const writer = createAdminClient() ?? auth.sbClient;
      const now = new Date().toISOString();
      const { error } = await writer.from('app_settings').upsert([
        { key: 'film_download_api_url', value: urlValidation.url, updated_at: now },
        { key: 'film_download_message', value: nextMessage, updated_at: now },
      ]);
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    }

    db.settings.film_download_api_url = urlValidation.url;
    db.settings.film_download_message = nextMessage;
    if (clearApiKey) {
      db.settings.film_download_api_key = '';
    } else if (rawNewKey) {
      db.settings.film_download_api_key = rawNewKey;
    }
    saveDb(db);
    invalidateSbSettingsCache();
    clearFilmDownloadsCache();

    const effectiveKey = getFilmDownloadApiKey();
    res.json({
      filmDownload: {
        apiUrl: urlValidation.url,
        apiKeyConfigured: Boolean(effectiveKey),
        apiKeyMask: maskFilmDownloadToken(effectiveKey),
        message: nextMessage,
      },
    });
  });

  app.post('/api/admin/settings/film-download/test', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const rawUrl =
      req.body?.apiUrl !== undefined
        ? String(req.body.apiUrl).trim()
        : await getFilmDownloadApiUrl();
    const urlValidation = validateFilmDownloadApiUrl(rawUrl);
    if (!urlValidation.ok) {
      res.status(400).json({ error: urlValidation.error });
      return;
    }

    const rawKey =
      typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()
        ? req.body.apiKey.trim()
        : getFilmDownloadApiKey();
    const filmIdNum = Number(req.body?.filmId);
    const safeFilmId = Number.isInteger(filmIdNum) && filmIdNum >= 1 ? filmIdNum : 1;

    const report = await testFilmDownloadApi(safeFilmId, {
      apiUrl: urlValidation.url,
      apiKey: rawKey,
    });
    res.json(report);
  });

  app.put('/api/admin/settings/players', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const nextPlayers = { ...(await getPlayerTemplates()) };
    for (const key of PLAYER_KEYS as readonly PlayerKey[]) {
      if (req.body?.[key] === undefined) continue;
      const val = String(req.body[key] ?? '').trim();
      if (!TEMPLATE_RE.test(val)) {
        res.status(400).json({ error: `Modèle invalide pour ${key} (ex: /film/{id})` });
        return;
      }
      nextPlayers[key] = val;
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      const now = new Date().toISOString();
      const { error } = await auth.sbClient
        .from('app_settings')
        .upsert(PLAYER_KEYS.map((k) => ({ key: k, value: nextPlayers[k], updated_at: now })));
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
    } else {
      db.settings.players = nextPlayers;
      saveDb(db);
    }
    invalidateSbSettingsCache();
    res.json({ players: nextPlayers });
  });

  app.post('/api/admin/health-check', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const currentOrigin = await getOrigin();
    const currentEmbed = await getEmbedProvider();
    const currentPinoyUrl = await getPinoyApiUrl();
    const candidateOrigin = String(req.body?.origin ?? currentOrigin)
      .trim()
      .replace(/\/+$/, '');

    const targets: { name: string; base: string; path: string }[] = [
      { name: 'Carrousel À la une', base: candidateOrigin, path: '/api/api_slider.php' },
      { name: 'Catalogue & Filtres', base: candidateOrigin, path: '/api/korotoko.php?limit=2&page=1&tri=recent' },
      { name: 'Accueil historique', base: candidateOrigin, path: '/api_home.php?type=all&q=' },
      { name: 'Fiche détail', base: candidateOrigin, path: '/details_api.php?id=24044&type=film' },
      { name: 'Embed Film', base: currentEmbed, path: '/film/54552' },
      { name: 'Embed Série', base: currentEmbed, path: '/tvs/658/1/1' },
      ...(currentPinoyUrl
        ? [
            {
              name: 'API Films Pinoy',
              base: currentPinoyUrl.split('?')[0],
              path: '?action=facets',
            },
          ]
        : []),
    ];

    const endpoints: EndpointCheck[] = await Promise.all(
      targets.map(async (t) => {
        const started = Date.now();
        try {
          const r = await fetch(`${t.base}${t.path}`, {
            signal: AbortSignal.timeout(7_000),
            headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka Diagnostic)' },
          });
          const latencyMs = Date.now() - started;
          return {
            name: t.name,
            endpoint: `${t.base}${t.path}`,
            ok: r.ok,
            status: r.status,
            latencyMs,
            detail: r.ok ? 'Réponse HTTP valide' : `Erreur HTTP ${r.status}`,
          };
        } catch (err) {
          return {
            name: t.name,
            endpoint: `${t.base}${t.path}`,
            ok: false,
            status: null,
            latencyMs: Date.now() - started,
            detail: err instanceof Error ? err.message : 'Délai dépassé / 522',
          };
        }
      })
    );

    res.json({
      origin: candidateOrigin,
      checkedAt: new Date().toISOString(),
      endpoints,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WEB ANALYTICS & REAL-TIME TRAFFIC ROUTES (PRIVACY-PRESERVING)
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/api/analytics/collect', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const visitorId = String(body.visitorId ?? '').trim().slice(0, 64);
    const sessionId = String(body.sessionId ?? '').trim().slice(0, 64);
    if (!visitorId || !sessionId) {
      res.status(400).json({ ok: false });
      return;
    }
    recordAnalyticsCollect({
      visitorId,
      sessionId,
      path: String(body.path ?? '/'),
      title: String(body.title ?? 'StreamWall'),
      screenResolution: body.screenResolution ? String(body.screenResolution) : undefined,
      timezone: body.timezone ? String(body.timezone) : undefined,
      req,
    });
    res.json({ ok: true });
  });

  // Real-time dwell pings disabled to prevent concurrent visitor write bursts.
  app.post('/api/analytics/ping', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/analytics/play', (req, res) => {
    const ip = getClientIp(req);
    const rl = consumeRateLimit(`play_event:${ip}`, 90, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ ok: false, error: 'Trop de requêtes' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawType = String(body.itemType ?? '').trim();
    if (!['film', 'serie', 'anime', 'pinoy', 'custom'].includes(rawType)) {
      res.status(400).json({ ok: false, error: 'Type de contenu invalide' });
      return;
    }
    const itemId = String(body.itemId ?? '').trim().slice(0, 120);
    const title = String(body.title ?? '').trim().slice(0, 160);
    if (!itemId || !title) {
      res.status(400).json({ ok: false, error: 'Paramètres manquants' });
      return;
    }
    recordPlayEvent({
      itemType: rawType as 'film' | 'serie' | 'anime' | 'pinoy' | 'custom',
      itemId,
      title,
      poster: typeof body.poster === 'string' ? body.poster : null,
      slug: typeof body.slug === 'string' ? body.slug : null,
      moduleSlug: typeof body.moduleSlug === 'string' ? body.moduleSlug : null,
      req,
    });
    res.json({ ok: true });
  });

  app.get('/api/admin/analytics', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const rawPeriod = String(req.query.period ?? '30d');
    const allowedPeriods: AnalyticsPeriodKey[] = [
      'today',
      'yesterday',
      '7d',
      '30d',
      '90d',
      'year',
      'custom',
    ];
    const period: AnalyticsPeriodKey = allowedPeriods.includes(rawPeriod as AnalyticsPeriodKey)
      ? (rawPeriod as AnalyticsPeriodKey)
      : '30d';
    const customStart = req.query.start ? String(req.query.start).slice(0, 10) : undefined;
    const customEnd = req.query.end ? String(req.query.end).slice(0, 10) : undefined;
    res.json(computeAnalyticsDashboard(period, customStart, customEnd));
  });

  app.get('/api/admin/analytics/plays', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const rawPeriod = String(req.query.period ?? '7d');
    const allowedPeriods: AnalyticsPeriodKey[] = [
      'today',
      'yesterday',
      '7d',
      '30d',
      '90d',
      'year',
      'custom',
    ];
    const period: AnalyticsPeriodKey = allowedPeriods.includes(rawPeriod as AnalyticsPeriodKey)
      ? (rawPeriod as AnalyticsPeriodKey)
      : '7d';
    const customStart = req.query.start ? String(req.query.start).slice(0, 10) : undefined;
    const customEnd = req.query.end ? String(req.query.end).slice(0, 10) : undefined;
    res.json(computePlayReport(period, customStart, customEnd));
  });

  app.get('/api/admin/analytics/realtime', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json(computeRealtimeAnalytics());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SUBSCRIPTION PLANS, CRYPTOGATE & MANUAL PAYMENTS, MANUAL PRO ASSIGNMENT
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/billing/plans', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({
      plans: listPlans(false),
      config: getBillingConfig(),
    });
  });

  app.get('/api/billing/me', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    await syncPendingCryptoGateOrdersForUser(auth.user.id);
    res.json({
      subscription: getUserSubscription(auth.user.id),
      orders: listUserOrders(auth.user.id),
    });
  });

  app.post('/api/billing/checkout/crypto-gate', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const planId = String(req.body?.planId ?? '').trim();
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
    const originUrl = process.env.APP_URL || (host ? `${proto}://${host}` : '');
    const result = await createCryptoGateOrder({
      userId: auth.user.id,
      username: auth.user.username,
      userEmail: auth.user.email,
      planId,
      originUrl,
    });
    if (result.error || !result.order) {
      res.status(400).json({ error: result.error || 'Paiement impossible.' });
      return;
    }
    res.json({ order: result.order });
  });

  app.post('/api/billing/checkout/manual', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const result = createManualOrder({
      userId: auth.user.id,
      username: auth.user.username,
      userEmail: auth.user.email,
      planId: String(req.body?.planId ?? ''),
      manualChannel: String(req.body?.manualChannel ?? 'Mobile Money / Virement'),
      manualReference: String(req.body?.manualReference ?? ''),
      note: req.body?.note ? String(req.body.note) : undefined,
    });
    if (result.error || !result.order) {
      res.status(400).json({ error: result.error || 'Commande impossible.' });
      return;
    }
    res.json({ order: result.order });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // NOTIFICATIONS & USER THEME PREFERENCES
  // ─────────────────────────────────────────────────────────────────────────
  app.put('/api/profile/theme', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const raw = req.body as { presetId?: string; mode?: 'dark' | 'light'; accentHex?: string } | null;
    if (!raw || !raw.accentHex) {
      const theme = setUserTheme(auth.user.id, null);
      res.json({ theme });
      return;
    }
    const saved = setUserTheme(auth.user.id, {
      presetId: String(raw.presetId || 'custom'),
      mode: raw.mode === 'light' ? 'light' : 'dark',
      accentHex: String(raw.accentHex),
    });
    res.json({ theme: saved });
  });

  app.get('/api/notifications', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      const guestNotifs = listGuestNotifications();
      res.json({
        notifications: guestNotifs,
        unreadCount: guestNotifs.length,
        guest: true,
      });
      return;
    }
    ensureExpiryWarningNotification(auth.user.id);
    res.json(listUserNotifications(auth.user.id));
  });

  app.post('/api/notifications/read-all', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    markAllNotificationsRead(auth.user.id);
    res.json(listUserNotifications(auth.user.id));
  });

  app.post('/api/notifications/:id/read', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    markNotificationRead(auth.user.id, req.params.id);
    res.json(listUserNotifications(auth.user.id));
  });

  app.delete('/api/notifications', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const onlyRead = req.query.readOnly === '1';
    clearUserNotifications(auth.user.id, onlyRead);
    res.json(listUserNotifications(auth.user.id));
  });

  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
    res.json({ publicKey: getVapidPublicKey() });
  });

  app.post('/api/push/subscribe', async (req, res) => {
    const auth = await resolveAuth(req);
    const endpoint = String(req.body?.endpoint ?? '').trim();
    const p256dh = String(req.body?.keys?.p256dh ?? '').trim();
    const authKey = String(req.body?.keys?.auth ?? '').trim();

    if (!/^https:\/\/.+/i.test(endpoint) || !p256dh || !authKey) {
      res.status(400).json({ error: 'Abonnement Push Web invalide.' });
      return;
    }

    const userId = auth?.user.id ?? null;
    const isPro = userId ? isUserPro(userId) : false;
    upsertPushSubscription({
      endpoint,
      p256dh,
      auth: authKey,
      userId,
      isPro,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });

    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint = String(req.body?.endpoint ?? '').trim();
    if (!endpoint) {
      res.status(400).json({ error: 'Endpoint manquant.' });
      return;
    }
    removePushSubscription(endpoint);
    res.json({ ok: true });
  });

  app.post('/api/push/test', async (req, res) => {
    const auth = await resolveAuth(req);
    const endpoint = String(req.body?.endpoint ?? '').trim();
    const site = await getSiteConfig();
    const payload = {
      title: `${site.siteName} · Test Push PWA`,
      body: 'Les notifications Push Web sont bien activées sur cet appareil !',
      url: auth ? '/profil' : '/',
      tag: `test-push-${Date.now()}`,
    };

    if (endpoint) {
      const result = await sendPushToEndpoint(endpoint, payload);
      if (result.attempted === 0) {
        res.status(404).json({ error: 'Abonnement introuvable pour cet appareil. Réactivez les notifications.' });
        return;
      }
      res.json({ ok: result.sent > 0, ...result });
      return;
    }

    if (auth) {
      const result = await sendPushToUsers([auth.user.id], payload);
      res.json({ ok: result.sent > 0, ...result });
      return;
    }

    res.status(400).json({ error: 'Aucun appareil ciblé pour le test Push.' });
  });

  app.get('/api/privacy', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ privacy: getPrivacyPageConfig() });
  });

  app.get('/api/admin/privacy', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({ privacy: getPrivacyPageConfig() });
  });

  app.put('/api/admin/privacy', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const privacy = updatePrivacyPageConfig(req.body);
    res.json({ privacy });
  });

  app.post('/api/admin/privacy/reset', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const privacy = resetPrivacyPageConfig();
    res.json({ privacy });
  });

  app.get('/api/admin/billing', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({
      plans: listPlans(true),
      config: getBillingConfig(),
      orders: listAllOrders(),
      secrets: getAdminPaymentSecretsStatus(),
    });
  });

  app.put('/api/admin/billing/secrets', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const secrets = updateAdminPaymentSecrets({
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      webhookSecret: typeof body.webhookSecret === 'string' ? body.webhookSecret : undefined,
      clearApiKey: body.clearApiKey === true,
      clearWebhookSecret: body.clearWebhookSecret === true,
    });
    res.json({
      secrets,
      config: getBillingConfig(),
    });
  });

  app.post('/api/admin/billing/plans', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = upsertPlan({
      id: body.id ? String(body.id) : undefined,
      tier: body.tier === 'pro' ? 'pro' : 'free',
      name: String(body.name ?? ''),
      description: String(body.description ?? ''),
      price: Number(body.price ?? 0),
      currency: String(body.currency ?? 'EUR'),
      billingCycle: String(body.billingCycle ?? 'monthly') as
        | 'none'
        | 'monthly'
        | 'quarterly'
        | 'yearly'
        | 'lifetime'
        | 'custom',
      durationDays: Number(body.durationDays ?? 30),
      autoRenew: Boolean(body.autoRenew),
      active: body.active !== false,
      features: Array.isArray(body.features) ? body.features.map(String) : [],
      players: {
        film: String((body.players as Record<string, unknown> | undefined)?.film ?? ''),
        serie: String((body.players as Record<string, unknown> | undefined)?.serie ?? ''),
      },
      filmDownloadsEnabled:
        typeof body.filmDownloadsEnabled === 'boolean' ? body.filmDownloadsEnabled : undefined,
    });
    if (result.error || !result.plan) {
      res.status(400).json({ error: result.error || 'Offre invalide.' });
      return;
    }
    res.json({ plan: result.plan });
  });

  app.delete('/api/admin/billing/plans/:planId', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const result = deletePlan(req.params.planId);
    if (!result.ok) {
      res.status(400).json({ error: result.error || 'Suppression impossible.' });
      return;
    }
    res.json({ ok: true });
  });

  app.put('/api/admin/billing/config', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const config = updateBillingConfig((req.body ?? {}) as Record<string, unknown>);
    res.json({ config });
  });

  app.post('/api/admin/billing/orders/:orderId/review', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const action = req.body?.action === 'reject' ? 'reject' : 'approve';
    const result = reviewOrder(req.params.orderId, action);
    if (result.error || !result.order) {
      res.status(404).json({ error: result.error || 'Commande introuvable.' });
      return;
    }
    res.json({ order: result.order, subscription: result.subscription ?? null });
  });

  app.post('/api/admin/users/:userId/subscription', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const targetId = String(req.params.userId || '').trim();
    const planId = String(req.body?.planId ?? 'pro');
    const durationDays =
      req.body?.durationDays !== undefined && req.body?.durationDays !== ''
        ? Number(req.body.durationDays)
        : undefined;
    const expiresAt =
      req.body?.expiresAt !== undefined
        ? req.body.expiresAt
          ? String(req.body.expiresAt)
          : null
        : undefined;

    let targetEmail: string | undefined;
    let targetUsername: string | undefined;
    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (adminSb) {
        const { data: uRes } = await adminSb.auth.admin.getUserById(targetId).catch(() => ({ data: null }));
        if (uRes?.user) {
          targetEmail = uRes.user.email ?? undefined;
          const meta = (uRes.user.user_metadata ?? {}) as Record<string, unknown>;
          targetUsername =
            (typeof meta.username === 'string' && meta.username) ||
            targetEmail?.split('@')[0];
        }
      }
    } else {
      const localUser = db.users.find((u) => u.id === targetId);
      if (localUser) {
        targetEmail = localUser.email;
        targetUsername = localUser.username;
      }
    }

    const subscription = assignUserPlan({
      userId: targetId,
      planId,
      durationDays,
      expiresAt,
      source: 'admin_manual',
      autoRenew: Boolean(req.body?.autoRenew),
      replaceExisting: Boolean(req.body?.replaceExisting),
      userEmail: targetEmail,
      username: targetUsername,
      appUrl: resolveAppOrigin(req),
    });
    res.json({ subscription });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIGURABLE POPUPS (PUBLIC + ADMIN)
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/popups/active', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ popups: listActivePopups() });
  });

  app.post('/api/popups/:id/track', (req, res) => {
    const ev = req.body?.event === 'click' ? 'click' : 'impression';
    trackPopupEvent(req.params.id, ev);
    res.json({ ok: true });
  });

  app.get('/api/popups/asset/:filename', (req, res) => {
    const asset = resolvePopupAssetFile(req.params.filename);
    if (!asset) {
      res.status(404).end();
      return;
    }
    res
      .status(200)
      .setHeader('content-type', asset.contentType)
      .setHeader('cache-control', 'public, max-age=86400')
      .send(fs.readFileSync(asset.filePath));
  });

  app.get('/api/admin/popups', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({ popups: listAllPopups() });
  });

  app.post('/api/admin/popups', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const result = upsertPopup((req.body ?? {}) as Record<string, unknown>);
    if (result.error || !result.popup) {
      res.status(400).json({ error: result.error || 'Configuration du popup invalide.' });
      return;
    }
    res.json({ popup: result.popup });
  });

  app.delete('/api/admin/popups/:id', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const ok = deletePopup(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Popup introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TMDB SUGGESTIONS, BROKEN LINK REPORTS & MISSING TITLE REQUESTS
  // ─────────────────────────────────────────────────────────────────────────
  const reportRateLimit = new Map<string, number[]>();
  function checkSubmissionRateLimit(key: string, maxPerWindow = 10, windowMs = 900_000): boolean {
    const now = Date.now();
    const recent = (reportRateLimit.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxPerWindow) return false;
    recent.push(now);
    reportRateLimit.set(key, recent);
    return true;
  }

  app.get('/api/tmdb/search', async (req, res) => {
    const query = String(req.query.q ?? '').trim();
    const typeFilter = String(req.query.type ?? 'all').trim().toLowerCase();
    if (query.length < 2) {
      res.json({ results: [] });
      return;
    }

    const cacheKey = `tmdb_search:${typeFilter}:${query.toLowerCase()}`;
    const cached = getCached<{ results: unknown[] }>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const tmdbKey = await getTmdbApiKey();
    if (!tmdbKey) {
      res.json({ results: [] });
      return;
    }

    const endpoint =
      typeFilter === 'film'
        ? 'search/movie'
        : typeFilter === 'serie' || typeFilter === 'anime'
          ? 'search/tv'
          : 'search/multi';

    try {
      const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
      url.searchParams.set('api_key', tmdbKey);
      url.searchParams.set('language', 'fr-FR');
      url.searchParams.set('include_adult', 'false');
      url.searchParams.set('query', query);

      const upstream = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
      if (!upstream.ok) {
        res.json({ results: [] });
        return;
      }
      const json = (await upstream.json()) as { results?: Array<Record<string, unknown>> };
      const rawResults = Array.isArray(json.results) ? json.results : [];

      const results = rawResults
        .filter((r) => {
          if (endpoint === 'search/multi') {
            return r.media_type === 'movie' || r.media_type === 'tv';
          }
          return true;
        })
        .slice(0, 8)
        .map((r) => {
          const isMovie =
            endpoint === 'search/movie' || (endpoint === 'search/multi' && r.media_type === 'movie');
          const mediaType: 'film' | 'serie' = isMovie ? 'film' : 'serie';
          const title = String(r.title || r.name || r.original_title || r.original_name || '').trim();
          const originalTitleRaw = String(r.original_title || r.original_name || '').trim();
          const originalTitle =
            originalTitleRaw && originalTitleRaw.toLowerCase() !== title.toLowerCase()
              ? originalTitleRaw
              : null;
          const dateStr = String(r.release_date || r.first_air_date || '').trim();
          const yearMatch = dateStr.match(/^(\d{4})/);
          const year = yearMatch ? Number(yearMatch[1]) : null;
          const posterPath = typeof r.poster_path === 'string' && r.poster_path ? r.poster_path : null;
          const tmdbId = String(r.id ?? '');
          const overview = typeof r.overview === 'string' && r.overview.trim() ? r.overview.trim() : null;
          const existingCatalogItem = findIndexedCatalogByTmdb(tmdbId, mediaType);

          return {
            tmdbId,
            mediaType,
            title,
            originalTitle,
            year,
            overview,
            posterUrl: posterPath ? `https://image.tmdb.org/t/p/w185${posterPath}` : null,
            existingCatalogItem,
          };
        })
        .filter((x) => x.tmdbId && x.title);

      const payload = setCached(cacheKey, { results }, 300_000);
      res.json(payload);
    } catch {
      res.json({ results: [] });
    }
  });

  app.post('/api/reports/broken', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({
        error: 'Connecte-toi pour pouvoir demander ou signaler un contenu.',
      });
      return;
    }

    const rateKey = `rep:u:${auth.user.id}`;
    if (!checkSubmissionRateLimit(rateKey, 10, 900_000)) {
      res.status(429).json({
        error: 'Trop de signalements envoyés récemment. Veuillez patienter quelques minutes.',
      });
      return;
    }

    const itemId = stripDangerousText(req.body?.itemId ?? '', 80);
    const itemTitle = stripDangerousText(req.body?.itemTitle ?? '', 180);
    const reason = stripDangerousText(req.body?.reason ?? '', 120);
    if (!itemId || !itemTitle || !reason) {
      res.status(400).json({ error: 'Informations du signalement incomplètes.' });
      return;
    }

    const season =
      req.body?.season !== undefined && req.body?.season !== null && req.body?.season !== ''
        ? Number(req.body.season)
        : null;
    const episode =
      req.body?.episode !== undefined && req.body?.episode !== null && req.body?.episode !== ''
        ? Number(req.body.episode)
        : null;

    const report = createBrokenReport({
      itemType: req.body?.itemType,
      itemId,
      itemTitle,
      season,
      episode,
      reason,
      comment: stripDangerousText(req.body?.comment ?? '', 400),
      userId: auth.user.id,
      username: auth.user.username,
    });

    res.json({ ok: true, report });
  });

  app.get('/api/requests', async (req, res) => {
    const auth = await resolveAuth(req);
    const visitorKeyHeader = String(req.headers['x-visitor-id'] || '').trim();
    const viewerKey = auth
      ? `u:${auth.user.id}`
      : visitorKeyHeader
        ? `v:${visitorKeyHeader}`
        : `ip:${req.ip || 'anon'}`;
    const requests = listContentRequests(viewerKey);
    res.json({ requests });
  });

  app.post('/api/requests', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({
        error: 'Connecte-toi pour pouvoir demander ou signaler un contenu.',
      });
      return;
    }

    const viewerKey = `u:${auth.user.id}`;
    if (!checkSubmissionRateLimit(`req:${viewerKey}`, 12, 900_000)) {
      res.status(429).json({
        error: 'Vous avez envoyé plusieurs demandes récemment. Merci de patienter quelques minutes.',
      });
      return;
    }

    const title = stripDangerousText(req.body?.title ?? '', 160);
    if (title.length < 2) {
      res.status(400).json({ error: 'Veuillez saisir un titre d’au moins 2 caractères.' });
      return;
    }

    const yearRaw = req.body?.year !== undefined && req.body?.year !== null && req.body?.year !== ''
      ? Number(req.body.year)
      : null;

    const result = createOrVoteContentRequest({
      mediaType: req.body?.mediaType,
      title,
      year: yearRaw,
      tmdbId: req.body?.tmdbId ? stripDangerousText(req.body.tmdbId, 24) : null,
      tmdbPosterUrl: req.body?.tmdbPosterUrl ? String(req.body.tmdbPosterUrl) : null,
      tmdbOverview: req.body?.tmdbOverview ? stripDangerousText(req.body.tmdbOverview, 600) : null,
      note: stripDangerousText(req.body?.note ?? '', 400),
      userId: auth.user.id,
      username: auth.user.username,
      viewerKey,
    });

    res.json({ ok: true, request: result.request, merged: result.merged });
  });

  app.post('/api/requests/:id/vote', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({
        error: 'Connecte-toi pour pouvoir demander ou signaler un contenu.',
      });
      return;
    }
    const viewerKey = `u:${auth.user.id}`;
    const updated = toggleVoteContentRequest(req.params.id, viewerKey);
    if (!updated) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }
    res.json({ ok: true, request: updated });
  });

  app.get('/api/admin/requests', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({
      brokenReports: listBrokenReports(),
      contentRequests: listContentRequests(),
      counts: countPendingRequestsAndReports(),
    });
  });

  app.put('/api/admin/reports/:id', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const before = listBrokenReports().find((r) => r.id === req.params.id);
    const updated = updateBrokenReportStatus(
      req.params.id,
      req.body?.status,
      typeof req.body?.adminNote === 'string' ? req.body.adminNote : undefined
    );
    if (!updated) {
      res.status(404).json({ error: 'Signalement introuvable.' });
      return;
    }

    if (
      updated.userId &&
      before?.status !== updated.status &&
      (updated.status === 'resolved' || updated.status === 'rejected')
    ) {
      const epText =
        updated.season && updated.episode ? ` (S${updated.season}·É${updated.episode})` : '';
      createNotification({
        userId: updated.userId,
        kind: 'admin_announcement',
        title:
          updated.status === 'resolved'
            ? 'Signalement traité'
            : 'Signalement examiné',
        message:
          updated.status === 'resolved'
            ? `Votre signalement pour « ${updated.itemTitle}${epText} » a été corrigé.${updated.adminNote ? ` Note : ${updated.adminNote}` : ''}`
            : `Votre signalement pour « ${updated.itemTitle}${epText} » a été fermé.${updated.adminNote ? ` Note : ${updated.adminNote}` : ''}`,
        link: getContentDetailPath(updated.itemType, updated.itemId),
      });
    }

    res.json({ report: updated });
  });

  app.delete('/api/admin/reports/:id', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const ok = deleteBrokenReport(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Signalement introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  app.put('/api/admin/requests/:id', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const before = listContentRequests().find((r) => r.id === req.params.id);
    const updated = updateContentRequestStatus(req.params.id, {
      status: req.body?.status,
      adminNote: typeof req.body?.adminNote === 'string' ? req.body.adminNote : undefined,
      resolvedItemUrl:
        req.body?.resolvedItemUrl !== undefined ? req.body.resolvedItemUrl : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }

    if (
      updated.userId &&
      before?.status !== updated.status &&
      (updated.status === 'added' || updated.status === 'rejected')
    ) {
      createNotification({
        userId: updated.userId,
        kind: 'admin_announcement',
        title:
          updated.status === 'added'
            ? 'Titre ajouté au catalogue !'
            : 'Mise à jour de votre demande',
        message:
          updated.status === 'added'
            ? `Bonne nouvelle : « ${updated.title} » vient d’être ajouté au catalogue.${updated.adminNote ? ` ${updated.adminNote}` : ''}`
            : `Votre demande pour « ${updated.title} » n’a pas pu être retenue.${updated.adminNote ? ` Raison : ${updated.adminNote}` : ''}`,
        link: updated.resolvedItemUrl || '/demandes',
      });
    }

    res.json({ request: updated });
  });

  app.delete('/api/admin/requests/:id', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const ok = deleteContentRequest(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Demande introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  await hydrateModulesFromSupabase();

  // Global API error middleware (captures uncaught Express route exceptions without leaking stack traces)
  app.use(
    '/api',
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.locals.errorLogged = true;
      recordErrorLog({
        level: 'fatal',
        source: 'api',
        message: err instanceof Error ? err.message : 'Erreur interne non interceptée',
        stack: err instanceof Error ? err.stack ?? null : null,
        route: req.originalUrl,
        method: req.method,
        statusCode: 500,
        userAgent: String(req.headers['user-agent'] ?? ''),
        context: req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : null,
        err,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erreur interne du serveur.' });
      }
    }
  );

  return app;
}

async function startServer() {
  installProcessErrorHandlers();
  const app = await createApiApp();

  // ─────────────────────────────────────────────────────────────────────────
  // FRONTEND SERVING
  // ─────────────────────────────────────────────────────────────────────────
  const httpServer = http.createServer(app);
  const distPath = path.join(__dirname, 'dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Tapenaka — StreamWall listening on http://0.0.0.0:${PORT} (DB: SQLite + ${
        isSupabaseEnabled() ? 'Supabase Online' : 'Local Mode'
      })`
    );
  });
}

if (process.env.TAPENAKA_DISABLE_AUTOSTART !== '1') {
  startServer();
}
