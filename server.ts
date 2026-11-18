import crypto from 'node:crypto';
import fs from 'node:fs';
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
  isFullUrlTemplate,
  matchesTemplate,
} from './src/shared/types.ts';
import type {
  CatalogueFilters,
  CataloguePage,
  CastMember,
  CommentRecord,
  DetailItem,
  EndpointCheck,
  Episode,
  Item,
  ItemType,
  PlayerKey,
  PlayerTemplates,
  RankingEntry,
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
  isSupabaseEnabled,
  sbGetAdminOverview,
  sbGetApiOrigin,
  sbGetComments,
  sbGetEmbedProvider,
  sbGetMemberData,
  sbGetPlayerTemplates,
  sbGetRankings,
  sbGetTmdbApiKey,
  sbResolveUser,
} from './src/server/supabaseAdapter.ts';
import { clearTmdbCache, enrichDetailWithTmdb } from './src/server/tmdbService.ts';
import {
  getAdminSmtpStatus,
  isSmtpReady,
  sendEmailChangeNotice,
  sendPasswordResetEmail,
  sendSignupVerificationEmail,
  sendTestEmail,
  sendWelcomeEmail,
  shouldRequireSignupConfirmation,
  updateAdminSmtpConfig,
} from './src/server/mailer.ts';
import type { AnalyticsPeriodKey } from './src/shared/analyticsTypes.ts';
import {
  computeAnalyticsDashboard,
  computeRealtimeAnalytics,
  recordAnalyticsCollect,
  recordAnalyticsPing,
} from './src/server/analyticsStore.ts';
import {
  assignUserPlan,
  createCryptoGateOrder,
  createManualOrder,
  deletePlan,
  ensureExpiryWarningNotification,
  getAdminPaymentSecretsStatus,
  getAllPlanTemplates,
  getBillingConfig,
  getUserSubscription,
  getUserTheme,
  isUserPro,
  listAllOrders,
  listPlans,
  listUserOrders,
  resolvePlanTemplateForUser,
  resolveUserAvatar,
  reviewOrder,
  setUserAvatarChoice,
  setUserTheme,
  updateAdminPaymentSecrets,
  updateBillingConfig,
  upsertPlan,
  verifyAndProcessCryptoGateWebhook,
} from './src/server/billingStore.ts';
import {
  clearUserNotifications,
  createNotification,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './src/server/notificationsStore.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const ONLINE_WINDOW_MS = 90_000;
const DEFAULT_ORIGIN = (process.env.STREAMWALL_API_ORIGIN || 'https://streamwall.behoririka.mg').replace(
  /\/+$/,
  ''
);
const DEFAULT_TMDB_API_KEY = (
  process.env.TMDB_API_KEY || 'cba03e8974108acd7a3b1442dccc6712'
).trim();

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
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as DatabaseShape;
      if (parsed && Array.isArray(parsed.users) && parsed.settings) {
        return parsed;
      }
    }
  } catch {
    // Fallback
  }
  const seeded = createSeedDb();
  saveDb(seeded);
  return seeded;
}

function saveDb(state: DatabaseShape): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}

const db: DatabaseShape = loadDb();

const upstreamCache = new Map<string, { expiresAt: number; value: unknown }>();

function getCached<T>(key: string): T | null {
  const entry = upstreamCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    upstreamCache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number): T {
  if (upstreamCache.size > 400) {
    const oldestKey = upstreamCache.keys().next().value;
    if (oldestKey) upstreamCache.delete(oldestKey);
  }
  upstreamCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
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
  if (headerOrigin) return headerOrigin;
  const envUrl = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl) return envUrl;
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return host ? `${proto}://${host}`.replace(/\/+$/, '') : '';
}

function dedupTop5History(events: WatchEventRecord[]): WatchEventRecord[] {
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
    if (out.length >= 5) break;
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

async function getPlayerTemplates(): Promise<PlayerTemplates> {
  if (isSupabaseEnabled()) {
    return sbGetPlayerTemplates();
  }
  return db.settings.players;
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
  const subscription = getUserSubscription(user.id);
  return {
    ...user,
    avatar: resolveUserAvatar(user.id, user.avatar),
    isPro: subscription.tier === 'pro',
    subscription,
    theme: getUserTheme(user.id),
  };
}

async function resolveAuth(req: express.Request): Promise<AuthResolution | null> {
  const token = extractToken(req);
  if (!token) return null;

  if (isSupabaseEnabled()) {
    const resolved = await sbResolveUser(token);
    if (!resolved) return null;
    return { user: enrichUserProfile(resolved.user), token, sbClient: resolved.client };
  }

  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return null;
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

async function fetchUpstreamSlider(): Promise<{ items: Slide[]; live: boolean }> {
  const origin = await getOrigin();
  const cacheKey = `slider:${origin}`;
  const cached = getCached<{ items: Slide[]; live: boolean }>(cacheKey);
  if (cached) return cached;

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
      return {
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
    });
    if (items.length > 0) {
      return setCached(cacheKey, { items, live: true }, 120_000);
    }
  } catch {
    // Fallback
  }
  return { items: FALLBACK_SLIDER, live: false };
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
      const genre = (r.genre as string) || null;
      const categorie = String(r.categorie ?? '').toLowerCase();
      const isFilm = r.source === 'films' || r.type === 'film' || categorie === 'film';
      const itemType: ItemType = isFilm
        ? 'film'
        : categorie === 'anime' || /anim/i.test(genre ?? '')
          ? 'anime'
          : 'serie';
      return {
        id: String(r.id ?? ''),
        titre: String(r.titre ?? ''),
        poster: (r.poster as string) || null,
        qualite: (r.qualite as string) || null,
        langue: (r.langue as string) || null,
        item_type: itemType,
        saison: null,
        genre,
        annee: r.annee ? Number(r.annee) : null,
        tmdbId: r.tmdbId ? String(r.tmdbId) : null,
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
    return setCached(cacheKey, pageData, 90_000);
  } catch {
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
}

async function fetchUpstreamGenres(): Promise<string[]> {
  const origin = await getOrigin();
  const cacheKey = `genres:${origin}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${origin}/api/korotoko.php?filtres=1`, {
      signal: AbortSignal.timeout(8_000),
      headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { genres?: string[] };
    const genres = (json.genres ?? []).filter((g) => /^[\p{L} &'-]{3,30}$/u.test(g));
    if (genres.length > 0) {
      return setCached(cacheKey, genres, 600_000);
    }
  } catch {
    // Fallback
  }
  return FALLBACK_GENRES;
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
  let usedEndpointType: 'film' | 'serie' = type === 'film' ? 'film' : 'serie';
  const cacheKey = `detail:${origin}:${type}:${id}`;
  const cached = getCached<{
    item: DetailItem | null;
    cast: CastMember[];
    related: Item[];
    episodes: Episode[];
    live: boolean;
  }>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `${origin}/details_api.php?id=${encodeURIComponent(id)}&type=${encodeURIComponent(usedEndpointType)}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall)' },
      }
    );
    let json = (res.ok || (type === 'anime' && res.status === 404)
      ? await res.json().catch(() => ({}))
      : null) as {
      item?: Record<string, unknown>;
      cast?: Array<Record<string, unknown>>;
      related?: Array<Record<string, unknown>>;
      episodes?: Array<Record<string, unknown>>;
    } | null;

    if (!json) throw new Error(`HTTP ${res.status}`);

    if (!json.item && type === 'anime') {
      const filmRes = await fetch(
        `${origin}/details_api.php?id=${encodeURIComponent(id)}&type=film`,
        {
          signal: AbortSignal.timeout(10_000),
          headers: { 'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall)' },
        }
      );
      if (filmRes.ok) {
        const filmJson = (await filmRes.json()) as typeof json;
        if (filmJson?.item) {
          json = filmJson;
          usedEndpointType = 'film';
        }
      }
    }
    if (!json.item) {
      return { item: null, cast: [], related: [], episodes: [], live: true };
    }
    const raw = json.item;
    const genre = (raw.genre as string) || null;
    const resolvedType: ItemType =
      usedEndpointType === 'film' || raw.type === 'film'
        ? 'film'
        : type === 'anime' || raw.type === 'anime' || /anim/i.test(genre ?? '')
          ? 'anime'
          : 'serie';
    const synopsis = ((raw.descr as string) || (raw.description as string) || null)?.trim() || null;

    const item: DetailItem = {
      id: String(raw.id ?? id),
      titre: String(raw.titre ?? ''),
      descr: synopsis,
      qualite: (raw.qualite as string) || null,
      langue: (raw.langue as string) || null,
      type: resolvedType,
      tmdbId: raw.tmdbId ? String(raw.tmdbId) : null,
      poster: (raw.poster as string) || null,
      trailer: (raw.trailer as string) || null,
      backdrop: (raw.backdrop as string) || (raw.baggio as string) || null,
      genre,
      annee: raw.annee ? Number(raw.annee) : null,
      saison: (raw.saison as string | number | null) ?? null,
    };

    const cast: CastMember[] = (json.cast ?? []).slice(0, 18).map((c) => ({
      nom: String(c.nom ?? ''),
      photo: (c.photo as string) || null,
      role: (c.role as string) || null,
    }));

    const related: Item[] = (json.related ?? []).slice(0, 12).map((r) => ({
      id: String(r.id ?? ''),
      titre: String(r.titre ?? ''),
      poster: (r.poster as string) || null,
      qualite: null,
      langue: null,
      item_type: resolvedType,
      saison: null,
      annee: r.annee ? Number(r.annee) : null,
      tmdbId: r.tmdbId ? String(r.tmdbId) : null,
    }));

    const episodes: Episode[] = (json.episodes ?? []).map((e, idx) => ({
      saison: Number(e.saison) || 1,
      episode: Number(e.episode) || idx + 1,
      titre: (e.titre as string) || `Épisode ${Number(e.episode) || idx + 1}`,
      url: (e.url as string) || null,
    }));

    const result = { item, cast, related, episodes, live: true };
    return setCached(cacheKey, result, 180_000);
  } catch {
    const fb = buildFallbackDetail(type, id);
    return { ...fb, live: false };
  }
}

async function startServer() {
  const app = express();

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

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    if (isSupabaseEnabled()) {
      const sb = createAnonClient();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        res.status(401).json({ error: error?.message || 'Identifiants incorrects.' });
        return;
      }
      const token = data.session.access_token;
      const resolved = await sbResolveUser(token);
      if (!resolved) {
        res.status(401).json({ error: 'Impossible de charger votre profil Supabase.' });
        return;
      }
      res.cookie('tapenaka_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 86_400_000,
      });
      res.json({ token, user: enrichUserProfile(resolved.user) });
      return;
    }

    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user || user.passwordHash !== hashPassword(password)) {
      res.status(401).json({ error: 'Identifiants incorrects. Vérifiez votre email et mot de passe.' });
      return;
    }
    if (user.emailVerified === false) {
      res.status(403).json({
        error: 'Veuillez confirmer votre adresse email via le lien reçu avant de vous connecter.',
      });
      return;
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    saveDb(db);
    res.cookie('tapenaka_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86_400_000,
    });
    res.json({
      token,
      user: enrichUserProfile({
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt,
      }),
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
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    saveDb(db);
    res.cookie('tapenaka_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86_400_000,
    });
    res.json({
      token,
      user: enrichUserProfile({
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt,
      }),
    });
  });

  app.post('/api/auth/signup', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const username = String(req.body?.username ?? '').trim().slice(0, 60);
    if (!email.includes('@') || password.length < 8 || !username) {
      res
        .status(400)
        .json({ error: 'Veuillez renseigner un pseudo, un email valide et un mot de passe (8 caractères min.).' });
      return;
    }

    const appOrigin = resolveAppOrigin(req);

    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      const sb = createAnonClient();

      // When Admin configured custom SMTP + Service Role key, generate confirmation link & deliver reliably via Nodemailer
      if (isSmtpReady() && adminSb) {
        if (shouldRequireSignupConfirmation()) {
          const { data: linkData, error: linkErr } = await adminSb.auth.admin.generateLink({
            type: 'signup',
            email,
            password,
            options: {
              data: { username },
              ...(appOrigin ? { redirectTo: `${appOrigin}/auth` } : {}),
            },
          });
          if (linkErr) {
            res.status(400).json({ error: linkErr.message });
            return;
          }
          const actionLink = linkData?.properties?.action_link;
          if (actionLink) {
            const mailRes = await sendSignupVerificationEmail({
              to: email,
              username,
              verifyUrl: actionLink,
            });
            if (!mailRes.ok) {
              res.status(502).json({
                error: `Compte créé mais échec d'envoi SMTP : ${mailRes.error || 'vérifiez la configuration SMTP en administration.'}`,
              });
              return;
            }
          }
          res.json({
            token: '',
            user: null,
            requiresConfirmation: true,
            message: `Un email de confirmation vient d’être envoyé à ${email}.`,
          });
          return;
        }
      }

      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { username },
          ...(appOrigin ? { emailRedirectTo: `${appOrigin}/auth` } : {}),
        },
      });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (!data.session) {
        res.json({
          token: '',
          user: null,
          requiresConfirmation: true,
          message: 'Consultez votre boîte mail (et vos spams) pour confirmer votre inscription.',
        });
        return;
      }
      if (isSmtpReady()) {
        void sendWelcomeEmail({ to: email, username, appUrl: appOrigin });
      }
      const token = data.session.access_token;
      const resolved = await sbResolveUser(token);
      res.cookie('tapenaka_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 86_400_000,
      });
      res.json({ token, user: resolved?.user ? enrichUserProfile(resolved.user) : null });
      return;
    }

    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'Un compte utilise déjà cette adresse email.' });
      return;
    }
    const newUserId = crypto.randomUUID();
    const assignedAvatar = resolveUserAvatar(newUserId);
    const needVerify = shouldRequireSignupConfirmation();
    const newUser: StoredUser = {
      id: newUserId,
      email,
      passwordHash: hashPassword(password),
      username,
      avatar: assignedAvatar,
      role: db.users.length === 0 ? 'admin' : 'member',
      emailVerified: !needVerify,
      createdAt: new Date().toISOString(),
    };
    db.users.push(newUser);

    if (needVerify) {
      const verifyToken = crypto.randomBytes(24).toString('hex');
      db.verifyTokens = (db.verifyTokens ?? []).filter((t) => t.userId !== newUser.id);
      db.verifyTokens.push({
        token: verifyToken,
        userId: newUser.id,
        expiresAt: Date.now() + 24 * 3600_000,
      });
      saveDb(db);
      const verifyUrl = `${appOrigin || ''}/auth?verify=${verifyToken}`;
      const mailRes = await sendSignupVerificationEmail({
        to: email,
        username,
        verifyUrl,
      });
      if (!mailRes.ok) {
        res.status(502).json({
          error: `Échec de l’envoi de l’email de confirmation : ${mailRes.error || 'vérifiez la configuration SMTP en administration.'}`,
        });
        return;
      }
      res.json({
        token: '',
        user: null,
        requiresConfirmation: true,
        message: `Un email de confirmation a été envoyé à ${email}.`,
      });
      return;
    }

    const token = crypto.randomBytes(24).toString('hex');
    db.sessions.push({ token, userId: newUser.id, createdAt: new Date().toISOString() });
    saveDb(db);
    if (isSmtpReady()) {
      void sendWelcomeEmail({ to: email, username, appUrl: appOrigin });
    }
    res.cookie('tapenaka_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86_400_000,
    });
    res.json({
      token,
      user: enrichUserProfile({
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        avatar: newUser.avatar,
        role: newUser.role,
        createdAt: newUser.createdAt,
      }),
    });
  });

  app.post('/api/auth/verify-email', (req, res) => {
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
    const sessionToken = crypto.randomBytes(24).toString('hex');
    db.sessions.push({ token: sessionToken, userId: user.id, createdAt: new Date().toISOString() });
    saveDb(db);
    res.cookie('tapenaka_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86_400_000,
    });
    res.json({
      token: sessionToken,
      user: enrichUserProfile({
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt,
      }),
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = extractToken(req);
    if (!isSupabaseEnabled() && token) {
      db.sessions = db.sessions.filter((s) => s.token !== token);
      saveDb(db);
    }
    res.clearCookie('tapenaka_session', { path: '/' });
    res.clearCookie('streamwall_watch', { path: '/api/public/watch' });
    res.json({ ok: true });
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const appOrigin = resolveAppOrigin(req);

    if (isSupabaseEnabled()) {
      const adminSb = createAdminClient();
      if (isSmtpReady() && adminSb) {
        const { data: linkData, error: linkErr } = await adminSb.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { ...(appOrigin ? { redirectTo: `${appOrigin}/reset-password` } : {}) },
        });
        if (!linkErr && linkData?.properties?.action_link) {
          const mailRes = await sendPasswordResetEmail({
            to: email,
            resetUrl: linkData.properties.action_link,
          });
          if (mailRes.ok) {
            res.json({
              message: `Email de réinitialisation envoyé à ${email}.`,
              resetPath: null,
            });
            return;
          }
        }
      }

      const sb = createAnonClient();
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        ...(appOrigin ? { redirectTo: `${appOrigin}/reset-password` } : {}),
      });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.json({
        message: 'Email de réinitialisation envoyé via Supabase Auth.',
        resetPath: null,
      });
      return;
    }

    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user) {
      res.json({
        message: 'Si un compte correspond à cet email, un lien de réinitialisation a été généré.',
        resetPath: null,
      });
      return;
    }
    const resetToken = crypto.randomBytes(20).toString('hex');
    db.resetTokens = db.resetTokens.filter((t) => t.userId !== user.id);
    db.resetTokens.push({
      token: resetToken,
      userId: user.id,
      expiresAt: Date.now() + 30 * 60_000,
    });
    saveDb(db);

    if (isSmtpReady()) {
      const resetUrl = `${appOrigin || ''}/reset-password?token=${resetToken}`;
      const mailRes = await sendPasswordResetEmail({ to: email, resetUrl });
      if (mailRes.ok) {
        res.json({
          message: `Un lien de réinitialisation a été envoyé par email à ${email}.`,
          resetPath: null,
        });
        return;
      }
    }

    res.json({
      message: 'Lien de récupération généré avec succès.',
      resetPath: `/reset-password?token=${resetToken}`,
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
        res.status(400).json({ error: 'Lien de récupération invalide ou expiré.' });
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
    res.status(401).json({ error: 'Session ou jeton de récupération requis.' });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DISCOVERY, HOME, CATALOGUE, SUGGESTIONS & DETAILS
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/home', async (req, res) => {
    const auth = await resolveAuth(req);
    const [sliderRes, catRes] = await Promise.all([
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
    ]);

    const latest = catRes.items.slice(0, 12);
    const week = isSupabaseEnabled()
      ? await sbGetRankings(auth?.sbClient ?? null, 7)
      : computeLocalRankings(7);

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
        .slice(0, 5);

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

    res.json({
      upstreamStatus: sliderRes.live || catRes.upstreamStatus === 'live' ? 'live' : 'fallback',
      slider: sliderRes.items,
      latest,
      forYou,
      continueWatching,
      friendsActivity,
      week,
    });
  });

  app.get('/api/catalogue', async (req, res) => {
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
      page: Math.min(10000, Math.max(1, Number(req.query.page) || 1)),
    };
    const page = await fetchUpstreamCatalogue(filters);
    res.json(page);
  });

  app.get('/api/catalogue/genres', async (_req, res) => {
    const genres = await fetchUpstreamGenres();
    res.json({ genres });
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

    const detail = await fetchUpstreamDetail(type, id);
    if (!detail.item) {
      res.status(404).json({ error: 'Titre introuvable' });
      return;
    }

    const tmdbApiKey = await getTmdbApiKey();
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

    res.json({
      item: enriched.item,
      cast: detail.cast,
      related: detail.related,
      sameGenre,
      episodes: enriched.episodes,
      seasonsMeta: enriched.seasonsMeta,
      tmdbRating: enriched.tmdbRating,
      rating: { average, count, myScore },
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

    if (auth) {
      if (isSupabaseEnabled() && auth.sbClient) {
        await auth.sbClient.from('watch_events').insert({
          user_id: auth.user.id,
          item_id: rawItem.id,
          item_type: rawItem.item_type,
          item: rawItem,
        });
        await auth.sbClient.from('user_presence').upsert({
          user_id: auth.user.id,
          last_seen: new Date().toISOString(),
          current_item: rawItem,
          page: `/${rawItem.item_type}/${rawItem.id}`,
        });
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
        db.presence[auth.user.id] = {
          userId: auth.user.id,
          lastSeen: new Date().toISOString(),
          currentItem: rawItem,
          page: `/${rawItem.item_type}/${rawItem.id}`,
        };
      }

      // Watch history tracking — keep only the 5 most recent watched titles
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
      db.watchProgress[auth.user.id] = list.slice(0, 5);
      saveDb(db);

      res.cookie('streamwall_watch', auth.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/public/watch',
        maxAge: 3600 * 1000,
      });
    }

    const finalUrl = isFullUrlTemplate(resolvedPath)
      ? resolvedPath
      : `/api/public/watch/${resolvedPath}`;

    res.json({
      url: finalUrl,
      member: isMember,
      season,
      episode,
    });
  });

  app.all(['/player/proxy/*', '/proxy/*', '/report.php', '/api/loader.php'], async (req, res) => {
    const embedProvider = await getEmbedProvider();
    const targetUrl = `${embedProvider}${req.originalUrl}`;
    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'user-agent': 'Mozilla/5.0 (Tapenaka StreamWall Proxy)',
          referer: `${embedProvider}/`,
          origin: embedProvider,
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
    const planTemplates = getAllPlanTemplates();
    const isGuestPath =
      matchesTemplate(t.player_guest_film, splat) || matchesTemplate(t.player_guest_serie, splat);
    const isMemberPath =
      matchesTemplate(t.player_member_film, splat) || matchesTemplate(t.player_member_serie, splat);
    const isPlanPath = planTemplates.some((tpl) => matchesTemplate(tpl, splat));

    if (!isGuestPath && !isMemberPath && !isPlanPath) {
      res.status(404).send('Lecteur introuvable');
      return;
    }

    const embedProvider = await getEmbedProvider();
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
    <code>${embedProvider}/${splat}</code>
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
      .slice(0, 5);

    if (isSupabaseEnabled() && auth.sbClient) {
      const sbData = await sbGetMemberData(auth.sbClient, auth.user);
      const enrichedFriends = sbData.friends.map((f) => ({
        ...f,
        avatar: resolveUserAvatar(f.id, f.avatar),
        isPro: isUserPro(f.id),
      }));
      res.json({
        ...sbData,
        profile: auth.user,
        friends: enrichedFriends,
        progress,
        history: dedupTop5History(sbData.history),
      });
      return;
    }

    const favorites = db.favorites[auth.user.id] ?? [];
    const history = dedupTop5History(db.watchEvents.filter((w) => w.userId === auth.user.id));

    const friendLinks = db.friendships.filter((f) => f.userId === auth.user.id);
    const now = Date.now();
    const friends = friendLinks
      .map((link) => {
        const fu = db.users.find((u) => u.id === link.friendId);
        if (!fu) return null;
        const pres = db.presence[fu.id];
        const online = Boolean(pres && now - new Date(pres.lastSeen).getTime() < ONLINE_WINDOW_MS);
        const recent = db.watchEvents
          .filter((w) => w.userId === fu.id)
          .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime())[0];
        return {
          id: fu.id,
          username: fu.username,
          avatar: resolveUserAvatar(fu.id, fu.avatar),
          isPro: isUserPro(fu.id),
          online,
          currentItem: online ? (pres?.currentItem ?? null) : null,
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
    });
  });

  app.post('/api/favorites/toggle', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const item = req.body?.item as Item | undefined;
    if (!item || !item.id) {
      res.status(400).json({ error: 'Titre invalide' });
      return;
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      const { data: existing } = await auth.sbClient
        .from('favorites')
        .select('item_id')
        .eq('user_id', auth.user.id)
        .eq('item_type', item.item_type)
        .eq('item_id', item.id)
        .maybeSingle();

      if (existing) {
        await auth.sbClient
          .from('favorites')
          .delete()
          .eq('user_id', auth.user.id)
          .eq('item_type', item.item_type)
          .eq('item_id', item.id);
        res.json({ saved: false, favorites: [] });
        return;
      }
      await auth.sbClient.from('favorites').insert({
        user_id: auth.user.id,
        item_type: item.item_type,
        item_id: item.id,
        item,
      });
      res.json({ saved: true, favorites: [] });
      return;
    }

    const current = db.favorites[auth.user.id] ?? [];
    const exists = current.some((f) => f.id === item.id && f.item_type === item.item_type);
    db.favorites[auth.user.id] = exists
      ? current.filter((f) => !(f.id === item.id && f.item_type === item.item_type))
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
    const username = String(req.body?.username ?? '').trim().slice(0, 60);
    if (!username) {
      res.status(400).json({ error: 'Le pseudo ne peut pas être vide.' });
      return;
    }

    // No photo uploads: users pick a curated avatar ID or get a random avatar
    const requestedAvatar =
      typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : null;
    const chosenAvatar = setUserAvatarChoice(auth.user.id, requestedAvatar);

    if (isSupabaseEnabled() && auth.sbClient) {
      const { error } = await auth.sbClient
        .from('profiles')
        .update({ username })
        .eq('id', auth.user.id);
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      const refreshed = await sbResolveUser(auth.token);
      res.json({
        profile: enrichUserProfile(
          refreshed?.user ?? { ...auth.user, username, avatar: chosenAvatar }
        ),
      });
      return;
    }

    const user = db.users.find((u) => u.id === auth.user.id);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable' });
      return;
    }
    user.username = username;
    user.avatar = chosenAvatar;
    for (const c of db.comments) {
      if (c.userId === user.id) {
        c.username = user.username;
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

  app.put('/api/profile/email', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const newEmail = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      res.status(400).json({ error: 'Veuillez indiquer une adresse email valide.' });
      return;
    }
    if (newEmail === auth.user.email.toLowerCase()) {
      res.json({ profile: auth.user, message: 'Cette adresse email est déjà associée à votre compte.' });
      return;
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      const adminSb = createAdminClient();
      if (adminSb) {
        const { error: adminErr } = await adminSb.auth.admin.updateUserById(auth.user.id, {
          email: newEmail,
          email_confirm: true,
        });
        if (adminErr) {
          res.status(400).json({ error: adminErr.message });
          return;
        }
        await adminSb.from('profiles').update({ email: newEmail }).eq('id', auth.user.id);
        if (isSmtpReady()) {
          void sendEmailChangeNotice({ to: newEmail, username: auth.user.username });
        }
        res.json({
          profile: { ...auth.user, email: newEmail },
          message: 'Adresse email mise à jour avec succès.',
          requiresConfirmation: false,
        });
        return;
      }

      const { error } = await auth.sbClient.auth.updateUser({ email: newEmail });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.json({
        profile: auth.user,
        message: 'Un email de confirmation a été envoyé à votre nouvelle adresse pour valider le changement.',
        requiresConfirmation: true,
      });
      return;
    }

    if (db.users.some((u) => u.id !== auth.user.id && u.email.toLowerCase() === newEmail)) {
      res.status(409).json({ error: 'Cette adresse email est déjà utilisée par un autre compte.' });
      return;
    }
    const user = db.users.find((u) => u.id === auth.user.id);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }
    user.email = newEmail;
    saveDb(db);
    if (isSmtpReady()) {
      void sendEmailChangeNotice({ to: newEmail, username: user.username });
    }
    res.json({
      profile: enrichUserProfile({
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt,
      }),
      message: 'Adresse email mise à jour avec succès.',
      requiresConfirmation: false,
    });
  });

  app.post('/api/ratings', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const itemType = String(req.body?.itemType ?? 'film');
    const itemId = String(req.body?.itemId ?? '');
    const score = Math.round(Number(req.body?.score));
    if (!itemId || score < 1 || score > 5) {
      res.status(400).json({ error: 'Note invalide (1 à 5).' });
      return;
    }
    const itemKey = `${itemType}:${itemId}`;
    const existing = db.ratings.find((r) => r.userId === auth.user.id && r.itemKey === itemKey);
    if (existing) {
      existing.score = score;
      existing.updatedAt = new Date().toISOString();
    } else {
      db.ratings.push({
        userId: auth.user.id,
        itemKey,
        score,
        updatedAt: new Date().toISOString(),
      });
    }
    saveDb(db);
    const itemRatings = db.ratings.filter((r) => r.itemKey === itemKey);
    const average =
      Math.round((itemRatings.reduce((s, r) => s + r.score, 0) / itemRatings.length) * 10) / 10;
    res.json({ average, count: itemRatings.length, myScore: score });
  });

  app.get('/api/comments/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const auth = await resolveAuth(req);

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
    const itemType = (['film', 'serie', 'anime'].includes(req.body?.itemType)
      ? req.body.itemType
      : 'film') as ItemType;
    const itemId = String(req.body?.itemId ?? '').trim();
    const itemTitle = String(req.body?.itemTitle ?? '').trim().slice(0, 120);
    const body = String(req.body?.body ?? '').trim().slice(0, 1000);
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;

    if (!itemId || !body) {
      res.status(400).json({ error: 'Commentaire vide' });
      return;
    }

    const dispatchCommentNotifications = async () => {
      const notified = new Set<string>([auth.user.id]);
      const titleLabel = itemTitle || `${itemType} #${itemId}`;
      const excerpt = body.slice(0, 120);
      const link = `/${itemType}/${itemId}`;

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

  app.post('/api/friends', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }
    const friendId = String(req.body?.friendId ?? '');
    if (!friendId || friendId === auth.user.id) {
      res.status(400).json({ error: 'Membre invalide' });
      return;
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      const { error } = await auth.sbClient
        .from('friendships')
        .insert({ user_id: auth.user.id, friend_id: friendId });
      if (error && !error.message.includes('duplicate')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.json({ ok: true });
      return;
    }

    if (!db.users.some((u) => u.id === friendId)) {
      res.status(400).json({ error: 'Membre introuvable' });
      return;
    }
    const exists = db.friendships.some(
      (f) => f.userId === auth.user.id && f.friendId === friendId
    );
    if (!exists) {
      db.friendships.push({
        userId: auth.user.id,
        friendId,
        createdAt: new Date().toISOString(),
      });
      saveDb(db);
    }
    res.json({ ok: true });
  });

  app.delete('/api/friends/:friendId', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'Connexion requise' });
      return;
    }

    if (isSupabaseEnabled() && auth.sbClient) {
      await auth.sbClient
        .from('friendships')
        .delete()
        .eq('user_id', auth.user.id)
        .eq('friend_id', req.params.friendId);
      res.json({ ok: true });
      return;
    }

    db.friendships = db.friendships.filter(
      (f) => !(f.userId === auth.user.id && f.friendId === req.params.friendId)
    );
    saveDb(db);
    res.json({ ok: true });
  });

  app.post('/api/presence/heartbeat', async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      res.json({ ok: false });
      return;
    }
    const page = String(req.body?.page ?? '/').slice(0, 200);
    const item = (req.body?.item as Item | null) ?? null;

    if (isSupabaseEnabled() && auth.sbClient) {
      await auth.sbClient.from('user_presence').upsert({
        user_id: auth.user.id,
        last_seen: new Date().toISOString(),
        current_item: item,
        page,
      });
      res.json({ ok: true });
      return;
    }

    db.presence[auth.user.id] = {
      userId: auth.user.id,
      lastSeen: new Date().toISOString(),
      currentItem: item,
      page,
    };
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
          const subscription = getUserSubscription(u.id);
          return {
            ...u,
            avatar: resolveUserAvatar(u.id, u.avatar),
            isPro: subscription.tier === 'pro',
            subscription,
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

        res.json({ ...sbOverview, users: enrichedUsers, recentComments });
        return;
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur Supabase' });
        return;
      }
    }

    const now = Date.now();
    const users = db.users.map((u) => {
      const pres = db.presence[u.id];
      const online = Boolean(pres && now - new Date(pres.lastSeen).getTime() < ONLINE_WINDOW_MS);
      const plays = db.watchEvents.filter((w) => w.userId === u.id).length;
      const subscription = getUserSubscription(u.id);
      return {
        id: u.id,
        email: u.email,
        username: u.username,
        avatar: resolveUserAvatar(u.id, u.avatar),
        isAdmin: u.role === 'admin',
        isPro: subscription.tier === 'pro',
        subscription,
        createdAt: u.createdAt,
        lastSeen: pres?.lastSeen ?? null,
        online,
        currentItem: online ? (pres?.currentItem ?? null) : null,
        currentPage: online ? (pres?.page ?? null) : null,
        plays,
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

  app.get('/api/admin/settings', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json({
      origin: await getOrigin(),
      embedProvider: await getEmbedProvider(),
      players: await getPlayerTemplates(),
      tmdbApiKey: await getTmdbApiKey(),
      smtp: getAdminSmtpStatus(),
    });
  });

  app.put('/api/admin/settings/smtp', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const status = updateAdminSmtpConfig({
      enabled: req.body?.enabled,
      host: req.body?.host,
      port: req.body?.port,
      secure: req.body?.secure,
      user: req.body?.user,
      pass: req.body?.pass,
      clearPass: req.body?.clearPass,
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
      res.status(400).json({ error: result.error || 'Échec de l’envoi SMTP.' });
      return;
    }
    res.json({ ok: true, message: `Email de test envoyé à ${to}.` });
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
    upstreamCache.clear();
    res.json({ origin: clean });
  });

  app.put('/api/admin/settings/players', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const nextPlayers = { ...(await getPlayerTemplates()) };
    for (const key of PLAYER_KEYS as readonly PlayerKey[]) {
      const val = String(req.body?.[key] ?? '').trim();
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
    res.json({ players: nextPlayers });
  });

  app.post('/api/admin/health-check', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const currentOrigin = await getOrigin();
    const currentEmbed = await getEmbedProvider();
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

  app.post(
    '/api/analytics/ping',
    express.text({ type: 'text/plain', limit: '32kb' }),
    (req, res) => {
      let body: Record<string, unknown> = {};
      if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body) as Record<string, unknown>;
        } catch {
          body = {};
        }
      } else if (req.body && typeof req.body === 'object') {
        body = req.body as Record<string, unknown>;
      }
      const sessionId = String(body.sessionId ?? '').trim().slice(0, 64);
      if (!sessionId) {
        res.status(400).json({ ok: false });
        return;
      }
      recordAnalyticsPing({
        sessionId,
        path: body.path ? String(body.path) : undefined,
        title: body.title ? String(body.title) : undefined,
        deltaSec: body.deltaSec !== undefined ? Number(body.deltaSec) : 15,
      });
      res.json({ ok: true });
    }
  );

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

  app.get('/api/admin/analytics/realtime', async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    res.json(computeRealtimeAnalytics());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SUBSCRIPTION PLANS, CRYPTOGATE & MANUAL PAYMENTS, MANUAL PRO ASSIGNMENT
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/billing/plans', (_req, res) => {
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
      res.status(401).json({ error: 'Connexion requise' });
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
    const subscription = assignUserPlan({
      userId: req.params.userId,
      planId,
      durationDays,
      expiresAt,
      source: 'admin_manual',
      autoRenew: Boolean(req.body?.autoRenew),
    });
    res.json({ subscription });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FRONTEND SERVING
  // ─────────────────────────────────────────────────────────────────────────
  const distPath = path.join(__dirname, 'dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Tapenaka — StreamWall listening on http://0.0.0.0:${PORT} (DB: ${
        isSupabaseEnabled() ? 'Supabase Online' : 'Local Store'
      })`
    );
  });
}

startServer();
