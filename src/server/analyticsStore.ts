import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type express from 'express';
import { getSqliteDb, readModuleSnapshot } from './persistentDb.ts';
import { countActivePersistentSessionUsers } from './sessionStore.ts';
import { isSuspiciousBotUserAgent } from './security.ts';
import type {
  AnalyticsDashboardPayload,
  AnalyticsPeriodKey,
  CityStat,
  ContentStat,
  CountryStat,
  DeviceKind,
  HourlyBucket,
  PageStat,
  RealtimePayload,
  RealtimeVisitor,
  RegionStat,
  ResolutionStat,
  TechBreakdownItem,
  TimelinePoint,
} from '../shared/analyticsTypes.ts';
import { COUNTRIES_BY_CODE, TIMEZONE_TO_GEO } from '../shared/geoCountries.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const LEGACY_ANALYTICS_FILE = path.join(DATA_DIR, 'tapenaka-analytics.json');

const REALTIME_WINDOW_MS = 5 * 60_000;
const MAX_RECENT_SESSIONS = 2_000;
const FLUSH_DELAY_MS = 2_000;

export interface AnalyticsSessionRecord {
  sessionId: string;
  visitorKey: string;
  startedAt: string;
  lastActivityAt: string;
  durationSec: number;
  entryPath: string;
  exitPath: string;
  currentPath: string;
  currentTitle: string;
  pageViewCount: number;
  countryCode: string;
  countryName: string;
  continent: string;
  region: string;
  city: string;
  deviceType: DeviceKind;
  os: string;
  browser: string;
  screenResolution: string;
}

interface AnalyticsPageViewRecord {
  id: string;
  sessionId: string;
  visitorKey: string;
  path: string;
  title: string;
  viewedAt: string;
  durationSec: number;
  countryCode: string;
}

interface LegacyAnalyticsDatabase {
  firstSeenByVisitor?: Record<string, string>;
  sessions?: AnalyticsSessionRecord[];
  pageViews?: AnalyticsPageViewRecord[];
}

interface DailyPageStat {
  title: string;
  views: number;
  durationSum: number;
  entries: number;
  exits: number;
  bounces: number;
  visitors: string[];
}

interface DailyGeoCount {
  countryCode: string;
  countryName: string;
  continent?: string;
  region?: string;
  city?: string;
  sessions: number;
  pageViews: number;
  visitors: string[];
}

interface DailyBucket {
  day: string; // YYYY-MM-DD (UTC)
  sessions: number;
  pageViews: number;
  bounces: number;
  durationSum: number;
  newVisitors: number;
  visitors: string[];
  hourly: number[]; // 24 slots
  countries: Record<string, DailyGeoCount>;
  regions: Record<string, DailyGeoCount>;
  cities: Record<string, DailyGeoCount>;
  devices: Record<string, number>;
  os: Record<string, number>;
  browsers: Record<string, number>;
  resolutions: Record<string, number>;
  pages: Record<string, DailyPageStat>;
}

let activeMembersCountProvider: (() => number) | null = null;

export function setActiveMembersCountProvider(fn: () => number): void {
  activeMembersCountProvider = fn;
}

function createEmptyDailyBucket(day: string): DailyBucket {
  return {
    day,
    sessions: 0,
    pageViews: 0,
    bounces: 0,
    durationSum: 0,
    newVisitors: 0,
    visitors: [],
    hourly: Array.from({ length: 24 }, () => 0),
    countries: {},
    regions: {},
    cities: {},
    devices: { mobile: 0, desktop: 0, tablet: 0 },
    os: {},
    browsers: {},
    resolutions: {},
    pages: {},
  };
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addUniqueVisitor(list: string[], visitorKey: string, cap = 50_000): boolean {
  if (list.includes(visitorKey)) return false;
  if (list.length < cap) {
    list.push(visitorKey);
    return true;
  }
  return false;
}

export function parseUserAgent(uaRaw: string | undefined): {
  deviceType: DeviceKind;
  os: string;
  browser: string;
} {
  const ua = uaRaw || '';
  const isTablet = /ipad|tablet|(android(?!.*mobile))|kindle|silk/i.test(ua);
  const isMobile =
    !isTablet && /mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua);
  const deviceType: DeviceKind = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

  let os = 'Autre';
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/cros/i.test(ua)) os = 'ChromeOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Autre';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/samsungbrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari';

  return { deviceType, os, browser };
}

export function resolveGeoFromRequest(
  req: express.Request,
  timezone?: string
): {
  countryCode: string;
  countryName: string;
  continent: string;
  region: string;
  city: string;
} {
  const headerCountry = String(
    req.headers['cf-ipcountry'] ||
      req.headers['x-vercel-ip-country'] ||
      req.headers['x-appengine-country'] ||
      ''
  )
    .trim()
    .toUpperCase();

  if (headerCountry && headerCountry !== 'XX' && COUNTRIES_BY_CODE[headerCountry]) {
    const meta = COUNTRIES_BY_CODE[headerCountry];
    const region = String(
      req.headers['cf-region'] || req.headers['x-appengine-region'] || meta.name
    ).trim();
    const city = String(
      req.headers['cf-ipcity'] || req.headers['x-appengine-city'] || meta.name
    ).trim();
    return {
      countryCode: meta.code,
      countryName: meta.name,
      continent: meta.continent,
      region: region || meta.name,
      city: city || meta.name,
    };
  }

  if (timezone && TIMEZONE_TO_GEO[timezone]) {
    const tz = TIMEZONE_TO_GEO[timezone];
    const meta = COUNTRIES_BY_CODE[tz.countryCode] ?? COUNTRIES_BY_CODE['MG'];
    return {
      countryCode: meta.code,
      countryName: meta.name,
      continent: meta.continent,
      region: tz.region,
      city: tz.city,
    };
  }

  const acceptLang = String(req.headers['accept-language'] || '').toLowerCase();
  let code = 'MG';
  let region = 'Analamanga';
  let city = 'Antananarivo';
  if (acceptLang.includes('fr-fr')) {
    code = 'FR';
    region = 'Île-de-France';
    city = 'Paris';
  } else if (acceptLang.includes('fr-ca') || acceptLang.includes('en-ca')) {
    code = 'CA';
    region = 'Québec';
    city = 'Montréal';
  } else if (acceptLang.includes('fr-be')) {
    code = 'BE';
    region = 'Bruxelles-Capitale';
    city = 'Bruxelles';
  } else if (acceptLang.includes('fr-ch')) {
    code = 'CH';
    region = 'Vaud';
    city = 'Lausanne';
  } else if (acceptLang.includes('en-us')) {
    code = 'US';
    region = 'New York';
    city = 'New York';
  } else if (acceptLang.includes('en-gb')) {
    code = 'GB';
    region = 'Angleterre';
    city = 'Londres';
  }

  const meta = COUNTRIES_BY_CODE[code] ?? COUNTRIES_BY_CODE['MG'];
  return {
    countryCode: meta.code,
    countryName: meta.name,
    continent: meta.continent,
    region,
    city,
  };
}

const sqlite = getSqliteDb();

const countDailyRowsStmt = sqlite.prepare('SELECT COUNT(*) AS cnt FROM analytics_daily');
const selectDailyStmt = sqlite.prepare('SELECT payload FROM analytics_daily WHERE day = ?');
const selectDailyRangeStmt = sqlite.prepare(
  'SELECT day, payload FROM analytics_daily WHERE day >= ? AND day <= ? ORDER BY day ASC'
);
const upsertDailyStmt = sqlite.prepare(`
  INSERT INTO analytics_daily (day, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(day) DO UPDATE SET
    payload = excluded.payload,
    updated_at = excluded.updated_at
`);
const selectVisitorStmt = sqlite.prepare(
  'SELECT first_day FROM analytics_visitors WHERE visitor_key = ?'
);
const insertVisitorIgnoreStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO analytics_visitors (visitor_key, first_day)
  VALUES (?, ?)
`);
const selectRecentSessionsStmt = sqlite.prepare(
  'SELECT payload FROM analytics_recent_sessions ORDER BY last_activity_ms DESC LIMIT ?'
);
const upsertRecentSessionStmt = sqlite.prepare(`
  INSERT INTO analytics_recent_sessions (
    session_id, visitor_key, day, started_ms, last_activity_ms, page_views, duration_sec, payload
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    last_activity_ms = excluded.last_activity_ms,
    page_views = excluded.page_views,
    duration_sec = excluded.duration_sec,
    payload = excluded.payload
`);
const pruneRecentSessionsStmt = sqlite.prepare(`
  DELETE FROM analytics_recent_sessions
  WHERE session_id NOT IN (
    SELECT session_id FROM analytics_recent_sessions ORDER BY last_activity_ms DESC LIMIT ?
  )
`);

const dailyCache = new Map<string, DailyBucket>();
const dirtyDays = new Set<string>();
const dirtySessions = new Map<string, AnalyticsSessionRecord>();
const recentSessionsMap = new Map<string, AnalyticsSessionRecord>();
const knownVisitorsCache = new Map<string, string>();
const realtimeVisitorsMap = new Map<string, RealtimeVisitor & { lastSeenMs: number }>();

let flushTimer: NodeJS.Timeout | null = null;
let shutdownHooksInstalled = false;

function getOrLoadDailyBucket(day: string): DailyBucket {
  const hit = dailyCache.get(day);
  if (hit) return hit;

  try {
    const row = selectDailyStmt.get(day) as { payload?: string } | undefined;
    if (row && typeof row.payload === 'string') {
      const parsed = JSON.parse(row.payload) as DailyBucket;
      if (parsed && parsed.day === day) {
        dailyCache.set(day, parsed);
        return parsed;
      }
    }
  } catch {
    // Fall back to empty bucket
  }

  const created = createEmptyDailyBucket(day);
  dailyCache.set(day, created);
  return created;
}

function getOrMarkVisitorFirstDay(visitorKey: string, day: string): string {
  const cached = knownVisitorsCache.get(visitorKey);
  if (cached) return cached;

  try {
    const row = selectVisitorStmt.get(visitorKey) as { first_day?: string } | undefined;
    if (row?.first_day) {
      if (knownVisitorsCache.size > 20_000) knownVisitorsCache.clear();
      knownVisitorsCache.set(visitorKey, row.first_day);
      return row.first_day;
    }
    insertVisitorIgnoreStmt.run(visitorKey, day);
    if (knownVisitorsCache.size > 20_000) knownVisitorsCache.clear();
    knownVisitorsCache.set(visitorKey, day);
    return day;
  } catch {
    return day;
  }
}

function applyNewSessionToBucket(
  bucket: DailyBucket,
  s: AnalyticsSessionRecord,
  isNewVisitor: boolean
): void {
  bucket.sessions += 1;
  bucket.pageViews += Math.max(1, s.pageViewCount);
  if (s.pageViewCount <= 1 && s.durationSec < 15) {
    bucket.bounces += 1;
  }
  bucket.durationSum += Math.max(5, s.durationSec);
  if (isNewVisitor) bucket.newVisitors += 1;
  addUniqueVisitor(bucket.visitors, s.visitorKey);

  const hour = new Date(s.startedAt).getUTCHours();
  if (hour >= 0 && hour < 24) {
    bucket.hourly[hour] = (bucket.hourly[hour] ?? 0) + 1;
  }

  // Country
  const cEntry =
    bucket.countries[s.countryCode] ??
    (bucket.countries[s.countryCode] = {
      countryCode: s.countryCode,
      countryName: s.countryName,
      continent: s.continent,
      sessions: 0,
      pageViews: 0,
      visitors: [],
    });
  cEntry.sessions += 1;
  cEntry.pageViews += Math.max(1, s.pageViewCount);
  addUniqueVisitor(cEntry.visitors, s.visitorKey, 15_000);

  // Region
  const rKey = `${s.countryCode}:${s.region}`;
  const rEntry =
    bucket.regions[rKey] ??
    (bucket.regions[rKey] = {
      countryCode: s.countryCode,
      countryName: s.countryName,
      region: s.region,
      sessions: 0,
      pageViews: 0,
      visitors: [],
    });
  rEntry.sessions += 1;
  rEntry.pageViews += Math.max(1, s.pageViewCount);
  addUniqueVisitor(rEntry.visitors, s.visitorKey, 10_000);

  // City
  const ctKey = `${s.countryCode}:${s.region}:${s.city}`;
  const ctEntry =
    bucket.cities[ctKey] ??
    (bucket.cities[ctKey] = {
      countryCode: s.countryCode,
      countryName: s.countryName,
      region: s.region,
      city: s.city,
      sessions: 0,
      pageViews: 0,
      visitors: [],
    });
  ctEntry.sessions += 1;
  ctEntry.pageViews += Math.max(1, s.pageViewCount);
  addUniqueVisitor(ctEntry.visitors, s.visitorKey, 10_000);

  // Tech
  bucket.devices[s.deviceType] = (bucket.devices[s.deviceType] ?? 0) + 1;
  bucket.os[s.os] = (bucket.os[s.os] ?? 0) + 1;
  bucket.browsers[s.browser] = (bucket.browsers[s.browser] ?? 0) + 1;
  bucket.resolutions[s.screenResolution] = (bucket.resolutions[s.screenResolution] ?? 0) + 1;

  // Entry page
  const pEntry =
    bucket.pages[s.entryPath] ??
    (bucket.pages[s.entryPath] = {
      title: s.currentTitle || s.entryPath,
      views: 0,
      durationSum: 0,
      entries: 0,
      exits: 0,
      bounces: 0,
      visitors: [],
    });
  pEntry.entries += 1;
  if (s.pageViewCount <= 1 && s.durationSec < 15) {
    pEntry.bounces += 1;
  }
  if (s.exitPath === s.entryPath) {
    pEntry.exits += 1;
  } else {
    const exEntry =
      bucket.pages[s.exitPath] ??
      (bucket.pages[s.exitPath] = {
        title: s.currentTitle || s.exitPath,
        views: 0,
        durationSum: 0,
        entries: 0,
        exits: 0,
        bounces: 0,
        visitors: [],
      });
    exEntry.exits += 1;
  }
}

function seedPastHistoryIfFresh(): void {
  const now = Date.now();
  let seed = 421907;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pickWeighted = <T>(items: { item: T; weight: number }[]): T => {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = rand() * total;
    for (const entry of items) {
      r -= entry.weight;
      if (r <= 0) return entry.item;
    }
    return items[0].item;
  };

  const geoPool = [
    { item: { code: 'MG', region: 'Analamanga', city: 'Antananarivo' }, weight: 32 },
    { item: { code: 'MG', region: 'Atsinanana', city: 'Toamasina' }, weight: 7 },
    { item: { code: 'MG', region: 'Vakinankaratra', city: 'Antsirabe' }, weight: 5 },
    { item: { code: 'MG', region: 'Boeny', city: 'Mahajanga' }, weight: 4 },
    { item: { code: 'FR', region: 'Île-de-France', city: 'Paris' }, weight: 16 },
    { item: { code: 'FR', region: 'Auvergne-Rhône-Alpes', city: 'Lyon' }, weight: 6 },
    { item: { code: 'RE', region: 'La Réunion', city: 'Saint-Denis' }, weight: 8 },
    { item: { code: 'CA', region: 'Québec', city: 'Montréal' }, weight: 5 },
    { item: { code: 'BE', region: 'Bruxelles-Capitale', city: 'Bruxelles' }, weight: 4 },
    { item: { code: 'CH', region: 'Vaud', city: 'Lausanne' }, weight: 3 },
    { item: { code: 'MU', region: 'Port-Louis', city: 'Port-Louis' }, weight: 3 },
  ];

  const devicePool: {
    item: { deviceType: DeviceKind; os: string; browser: string; res: string };
    weight: number;
  }[] = [
    { item: { deviceType: 'mobile', os: 'Android', browser: 'Chrome', res: '360×800' }, weight: 34 },
    { item: { deviceType: 'mobile', os: 'iOS', browser: 'Safari', res: '390×844' }, weight: 20 },
    { item: { deviceType: 'desktop', os: 'Windows', browser: 'Chrome', res: '1920×1080' }, weight: 20 },
    { item: { deviceType: 'desktop', os: 'Windows', browser: 'Edge', res: '1920×1080' }, weight: 6 },
    { item: { deviceType: 'desktop', os: 'macOS', browser: 'Safari', res: '1440×900' }, weight: 7 },
    { item: { deviceType: 'desktop', os: 'Linux', browser: 'Firefox', res: '1920×1080' }, weight: 4 },
  ];

  const pagesPool = [
    { item: { path: '/', title: 'Accueil — StreamWall' }, weight: 28 },
    { item: { path: '/catalogue', title: 'Catalogue — StreamWall' }, weight: 24 },
    { item: { path: '/pinoy', title: 'Pinoy — StreamWall' }, weight: 16 },
    { item: { path: '/suggestion', title: 'Suggestion — StreamWall' }, weight: 8 },
    { item: { path: '/favoris', title: 'Ma liste — StreamWall' }, weight: 5 },
  ];

  const visitorPool = Array.from({ length: 420 }, (_, i) => `vis_${1000 + i}`);
  const buckets = new Map<string, DailyBucket>();

  // Seed ONLY completed past days (89 .. 1). Never seed artificial fake numbers into today (dayOffset = 0)!
  for (let dayOffset = 89; dayOffset >= 1; dayOffset--) {
    const dayStart = now - dayOffset * 86_400_000;
    const day = utcDayKey(dayStart);
    const bucket = buckets.get(day) ?? createEmptyDailyBucket(day);
    buckets.set(day, bucket);

    const isWeekend = new Date(dayStart).getUTCDay() === 0 || new Date(dayStart).getUTCDay() === 6;
    const dailySessions = (isWeekend ? 20 : 14) + Math.floor(rand() * 10);

    for (let sIdx = 0; sIdx < dailySessions; sIdx++) {
      const hour = rand() < 0.62 ? 17 + Math.floor(rand() * 7) : Math.floor(rand() * 24);
      const d = new Date(dayStart);
      d.setUTCHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      const visitorKey = visitorPool[Math.floor(Math.pow(rand(), 1.3) * visitorPool.length)];
      const firstDay = getOrMarkVisitorFirstDay(visitorKey, day);
      const isNewVisitor = firstDay === day;

      const geo = pickWeighted(geoPool);
      const meta = COUNTRIES_BY_CODE[geo.code] ?? COUNTRIES_BY_CODE['MG'];
      const tech = pickWeighted(devicePool);
      const pageCount = rand() < 0.24 ? 1 : 2 + Math.floor(rand() * 4);
      let entryPath = '/';
      let exitPath = '/';
      let currentTitle = 'Accueil — StreamWall';
      let totalDurationSec = 0;

      for (let pIdx = 0; pIdx < pageCount; pIdx++) {
        const pickedPage = pIdx === 0 && rand() < 0.55 ? pagesPool[0].item : pickWeighted(pagesPool);
        const dwellSec =
          pageCount === 1 && rand() < 0.7 ? 6 + Math.floor(rand() * 8) : 28 + Math.floor(rand() * 240);
        if (pIdx === 0) entryPath = pickedPage.path;
        exitPath = pickedPage.path;
        currentTitle = pickedPage.title;
        totalDurationSec += dwellSec;

        const pStat =
          bucket.pages[pickedPage.path] ??
          (bucket.pages[pickedPage.path] = {
            title: pickedPage.title,
            views: 0,
            durationSum: 0,
            entries: 0,
            exits: 0,
            bounces: 0,
            visitors: [],
          });
        pStat.views += 1;
        pStat.durationSum += dwellSec;
        addUniqueVisitor(pStat.visitors, visitorKey, 20_000);
      }

      const session: AnalyticsSessionRecord = {
        sessionId: `ses_${dayOffset}_${sIdx}_${Math.floor(rand() * 99999)}`,
        visitorKey,
        startedAt: d.toISOString(),
        lastActivityAt: d.toISOString(),
        durationSec: totalDurationSec,
        entryPath,
        exitPath,
        currentPath: exitPath,
        currentTitle,
        pageViewCount: pageCount,
        countryCode: meta.code,
        countryName: meta.name,
        continent: meta.continent,
        region: geo.region,
        city: geo.city,
        deviceType: tech.deviceType,
        os: tech.os,
        browser: tech.browser,
        screenResolution: tech.res,
      };
      applyNewSessionToBucket(bucket, session, isNewVisitor);
    }
  }

  const nowIso = new Date().toISOString();
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    for (const [day, b] of buckets.entries()) {
      upsertDailyStmt.run(day, JSON.stringify(b), nowIso);
      dailyCache.set(day, b);
    }
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}

function migrateLegacyAnalyticsIfPresent(): boolean {
  const legacy = readModuleSnapshot<LegacyAnalyticsDatabase>('analytics', LEGACY_ANALYTICS_FILE);
  if (!legacy || !Array.isArray(legacy.sessions) || legacy.sessions.length === 0) {
    return false;
  }

  const buckets = new Map<string, DailyBucket>();
  const sorted = [...legacy.sessions].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)
  );

  for (const s of sorted) {
    const day = (s.startedAt || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const firstDay = getOrMarkVisitorFirstDay(s.visitorKey, day);
    const bucket = buckets.get(day) ?? createEmptyDailyBucket(day);
    buckets.set(day, bucket);
    applyNewSessionToBucket(bucket, s, firstDay === day);
  }

  for (const pv of legacy.pageViews ?? []) {
    const day = (pv.viewedAt || '').slice(0, 10);
    const bucket = buckets.get(day);
    if (!bucket) continue;
    const pStat =
      bucket.pages[pv.path] ??
      (bucket.pages[pv.path] = {
        title: pv.title || pv.path,
        views: 0,
        durationSum: 0,
        entries: 0,
        exits: 0,
        bounces: 0,
        visitors: [],
      });
    pStat.views += 1;
    pStat.durationSum += Number(pv.durationSec) || 15;
    if (pv.title && pv.title !== pv.path) pStat.title = pv.title;
    addUniqueVisitor(pStat.visitors, pv.visitorKey, 20_000);
  }

  const nowIso = new Date().toISOString();
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    for (const [day, b] of buckets.entries()) {
      upsertDailyStmt.run(day, JSON.stringify(b), nowIso);
      dailyCache.set(day, b);
    }
    for (const s of sorted.slice(-MAX_RECENT_SESSIONS)) {
      recentSessionsMap.set(s.sessionId, s);
      upsertRecentSessionStmt.run(
        s.sessionId,
        s.visitorKey,
        s.startedAt.slice(0, 10),
        Date.parse(s.startedAt) || Date.now(),
        Date.parse(s.lastActivityAt) || Date.now(),
        s.pageViewCount,
        s.durationSec,
        JSON.stringify(s)
      );
    }
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
  return true;
}

function initializeAnalyticsStore(): void {
  const row = countDailyRowsStmt.get() as { cnt?: number } | undefined;
  const count = Number(row?.cnt) || 0;
  if (count === 0) {
    const migrated = migrateLegacyAnalyticsIfPresent();
    if (!migrated) {
      seedPastHistoryIfFresh();
    }
  } else {
    try {
      const rows = selectRecentSessionsStmt.all(MAX_RECENT_SESSIONS) as { payload: string }[];
      for (const r of rows) {
        const parsed = JSON.parse(r.payload) as AnalyticsSessionRecord;
        if (parsed?.sessionId) {
          recentSessionsMap.set(parsed.sessionId, parsed);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (!shutdownHooksInstalled) {
    shutdownHooksInstalled = true;
    const onExit = () => {
      flushAnalyticsNow();
    };
    process.once('beforeExit', onExit);
    process.once('SIGINT', onExit);
    process.once('SIGTERM', onExit);
  }
}

initializeAnalyticsStore();

export function flushAnalyticsNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (dirtyDays.size === 0 && dirtySessions.size === 0) return;

  const daysToFlush = [...dirtyDays];
  const sessionsToFlush = [...dirtySessions.values()];
  dirtyDays.clear();
  dirtySessions.clear();

  const nowIso = new Date().toISOString();
  try {
    sqlite.exec('BEGIN IMMEDIATE');
    for (const day of daysToFlush) {
      const bucket = dailyCache.get(day);
      if (bucket) {
        upsertDailyStmt.run(day, JSON.stringify(bucket), nowIso);
      }
    }
    for (const s of sessionsToFlush) {
      upsertRecentSessionStmt.run(
        s.sessionId,
        s.visitorKey,
        s.startedAt.slice(0, 10),
        Date.parse(s.startedAt) || Date.now(),
        Date.parse(s.lastActivityAt) || Date.now(),
        s.pageViewCount,
        s.durationSec,
        JSON.stringify(s)
      );
    }
    if (recentSessionsMap.size > MAX_RECENT_SESSIONS) {
      pruneRecentSessionsStmt.run(MAX_RECENT_SESSIONS);
    }
    sqlite.exec('COMMIT');
  } catch {
    try {
      sqlite.exec('ROLLBACK');
    } catch {
      // Ignore rollback failure
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushAnalyticsNow();
  }, FLUSH_DELAY_MS);
  if (typeof flushTimer.unref === 'function') {
    flushTimer.unref();
  }
}

function pruneRealtimeVisitors(nowMs: number): void {
  for (const [k, v] of realtimeVisitorsMap.entries()) {
    if (nowMs - v.lastSeenMs > REALTIME_WINDOW_MS) {
      realtimeVisitorsMap.delete(k);
    }
  }
  while (realtimeVisitorsMap.size > 2_000) {
    const oldest = realtimeVisitorsMap.keys().next().value;
    if (!oldest) break;
    realtimeVisitorsMap.delete(oldest);
  }
}

export function touchActiveUserPresence(params: {
  sessionId: string;
  countryCode?: string;
  countryName?: string;
  region?: string;
  city?: string;
  path?: string;
  title?: string;
  deviceType?: DeviceKind;
  os?: string;
  browser?: string;
}): void {
  const nowMs = Date.now();
  const prev = realtimeVisitorsMap.get(params.sessionId);
  realtimeVisitorsMap.set(params.sessionId, {
    sessionId: params.sessionId,
    countryCode: params.countryCode ?? prev?.countryCode ?? 'MG',
    countryName: params.countryName ?? prev?.countryName ?? 'Madagascar',
    region: params.region ?? prev?.region ?? 'Analamanga',
    city: params.city ?? prev?.city ?? 'Antananarivo',
    currentPath: (params.path ?? prev?.currentPath ?? '/').slice(0, 160),
    currentTitle: (params.title ?? prev?.currentTitle ?? 'StreamWall').slice(0, 120),
    deviceType: params.deviceType ?? prev?.deviceType ?? 'desktop',
    os: params.os ?? prev?.os ?? 'Autre',
    browser: params.browser ?? prev?.browser ?? 'Chrome',
    lastActivityAt: new Date(nowMs).toISOString(),
    lastSeenMs: nowMs,
  });
  if (realtimeVisitorsMap.size > 500) {
    pruneRealtimeVisitors(nowMs);
  }
}

export function recordAnalyticsCollect(params: {
  visitorId: string;
  sessionId: string;
  path: string;
  title: string;
  screenResolution?: string;
  timezone?: string;
  req: express.Request;
}) {
  const ua = String(params.req.headers['user-agent'] ?? '');
  if (isSuspiciousBotUserAgent(ua)) {
    return;
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const todayKey = nowIso.slice(0, 10);
  const parsedUa = parseUserAgent(ua);
  const geo = resolveGeoFromRequest(params.req, params.timezone);

  const rawSeed = params.visitorId || `${params.req.ip || 'anon'}:${ua}`;
  const visitorKey = `v_${crypto.createHash('sha256').update(rawSeed).digest('hex').slice(0, 14)}`;

  const cleanPath = (params.path || '/').slice(0, 160);
  const cleanTitle = (params.title || 'StreamWall').slice(0, 120);
  const cleanRes = /^\d{3,4}×\d{3,4}$/.test(params.screenResolution || '')
    ? params.screenResolution!
    : parsedUa.deviceType === 'mobile'
      ? '390×844'
      : '1920×1080';

  const existing = recentSessionsMap.get(params.sessionId);
  if (!existing) {
    const firstDay = getOrMarkVisitorFirstDay(visitorKey, todayKey);
    const isNewVisitor = firstDay === todayKey;

    const session: AnalyticsSessionRecord = {
      sessionId: params.sessionId,
      visitorKey,
      startedAt: nowIso,
      lastActivityAt: nowIso,
      durationSec: 5,
      entryPath: cleanPath,
      exitPath: cleanPath,
      currentPath: cleanPath,
      currentTitle: cleanTitle,
      pageViewCount: 1,
      countryCode: geo.countryCode,
      countryName: geo.countryName,
      continent: geo.continent,
      region: geo.region,
      city: geo.city,
      deviceType: parsedUa.deviceType,
      os: parsedUa.os,
      browser: parsedUa.browser,
      screenResolution: cleanRes,
    };

    recentSessionsMap.set(params.sessionId, session);
    if (recentSessionsMap.size > MAX_RECENT_SESSIONS) {
      const oldestKey = recentSessionsMap.keys().next().value;
      if (oldestKey) recentSessionsMap.delete(oldestKey);
    }

    const bucket = getOrLoadDailyBucket(todayKey);
    applyNewSessionToBucket(bucket, session, isNewVisitor);

    const pStat =
      bucket.pages[cleanPath] ??
      (bucket.pages[cleanPath] = {
        title: cleanTitle,
        views: 0,
        durationSum: 0,
        entries: 0,
        exits: 0,
        bounces: 0,
        visitors: [],
      });
    pStat.views += 1;
    pStat.durationSum += 15;
    addUniqueVisitor(pStat.visitors, visitorKey, 20_000);

    dirtyDays.add(todayKey);
    dirtySessions.set(session.sessionId, session);
  } else {
    const sessionDay = existing.startedAt.slice(0, 10) || todayKey;
    const bucket = getOrLoadDailyBucket(sessionDay);
    const prevDuration = existing.durationSec;
    const prevPages = existing.pageViewCount;
    const prevExit = existing.exitPath;

    const nextDuration = Math.max(
      prevDuration + 5,
      Math.round((nowMs - (Date.parse(existing.startedAt) || nowMs)) / 1000)
    );
    const deltaDuration = Math.max(0, Math.min(3600, nextDuration - prevDuration));

    existing.lastActivityAt = nowIso;
    existing.exitPath = cleanPath;
    existing.currentPath = cleanPath;
    existing.currentTitle = cleanTitle;
    existing.pageViewCount = prevPages + 1;
    existing.durationSec = nextDuration;

    bucket.pageViews += 1;
    bucket.durationSum += deltaDuration;
    if (prevPages === 1 && prevDuration < 15) {
      bucket.bounces = Math.max(0, bucket.bounces - 1);
      const entryStat = bucket.pages[existing.entryPath];
      if (entryStat) {
        entryStat.bounces = Math.max(0, entryStat.bounces - 1);
      }
    }

    const cEntry = bucket.countries[existing.countryCode];
    if (cEntry) cEntry.pageViews += 1;
    const rEntry = bucket.regions[`${existing.countryCode}:${existing.region}`];
    if (rEntry) rEntry.pageViews += 1;
    const ctEntry = bucket.cities[`${existing.countryCode}:${existing.region}:${existing.city}`];
    if (ctEntry) ctEntry.pageViews += 1;

    if (prevExit !== cleanPath) {
      const oldExitStat = bucket.pages[prevExit];
      if (oldExitStat && oldExitStat.exits > 0) oldExitStat.exits -= 1;
      const nextExitStat =
        bucket.pages[cleanPath] ??
        (bucket.pages[cleanPath] = {
          title: cleanTitle,
          views: 0,
          durationSum: 0,
          entries: 0,
          exits: 0,
          bounces: 0,
          visitors: [],
        });
      nextExitStat.exits += 1;
    }

    const pStat =
      bucket.pages[cleanPath] ??
      (bucket.pages[cleanPath] = {
        title: cleanTitle,
        views: 0,
        durationSum: 0,
        entries: 0,
        exits: 0,
        bounces: 0,
        visitors: [],
      });
    pStat.views += 1;
    pStat.durationSum += 15;
    if (cleanTitle && cleanTitle !== cleanPath) pStat.title = cleanTitle;
    addUniqueVisitor(pStat.visitors, existing.visitorKey, 20_000);

    dirtyDays.add(sessionDay);
    dirtySessions.set(existing.sessionId, existing);
  }

  touchActiveUserPresence({
    sessionId: params.sessionId,
    countryCode: geo.countryCode,
    countryName: geo.countryName,
    region: geo.region,
    city: geo.city,
    path: cleanPath,
    title: cleanTitle,
    deviceType: parsedUa.deviceType,
    os: parsedUa.os,
    browser: parsedUa.browser,
  });

  scheduleFlush();
}

export function recordAnalyticsPing(_params: {
  sessionId: string;
  path?: string;
  title?: string;
  deltaSec?: number;
}) {
  // No-op: live presence is updated passively without timer write bursts.
}

function resolveDateRange(
  period: AnalyticsPeriodKey,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string } {
  const now = new Date();
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayStr = utcDayKey(todayUtcMs);

  if (period === 'today') {
    return { startDate: todayStr, endDate: todayStr };
  }
  if (period === 'yesterday') {
    const yStr = utcDayKey(todayUtcMs - 86_400_000);
    return { startDate: yStr, endDate: yStr };
  }
  if (period === '7d') {
    return { startDate: utcDayKey(todayUtcMs - 6 * 86_400_000), endDate: todayStr };
  }
  if (period === '30d') {
    return { startDate: utcDayKey(todayUtcMs - 29 * 86_400_000), endDate: todayStr };
  }
  if (period === '90d') {
    return { startDate: utcDayKey(todayUtcMs - 89 * 86_400_000), endDate: todayStr };
  }
  if (period === 'year') {
    const jan1Str = `${now.getUTCFullYear()}-01-01`;
    return { startDate: jan1Str, endDate: todayStr };
  }

  const validRe = /^\d{4}-\d{2}-\d{2}$/;
  const startDate =
    customStart && validRe.test(customStart)
      ? customStart
      : utcDayKey(todayUtcMs - 6 * 86_400_000);
  const endDate =
    customEnd && validRe.test(customEnd) && customEnd >= startDate ? customEnd : todayStr;
  return { startDate, endDate };
}

function enumerateDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  let cursorMs = Date.parse(`${startDate}T00:00:00.000Z`);
  const endMs = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(cursorMs) || !Number.isFinite(endMs) || cursorMs > endMs) {
    return [startDate];
  }
  let guard = 0;
  while (cursorMs <= endMs && guard < 400) {
    days.push(utcDayKey(cursorMs));
    cursorMs += 86_400_000;
    guard += 1;
  }
  return days;
}

function loadBucketsInRange(startDate: string, endDate: string): DailyBucket[] {
  const byDay = new Map<string, DailyBucket>();
  try {
    const rows = selectDailyRangeStmt.all(startDate, endDate) as {
      day: string;
      payload: string;
    }[];
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.payload) as DailyBucket;
        if (parsed?.day) byDay.set(parsed.day, parsed);
      } catch {
        // Skip malformed row
      }
    }
  } catch {
    // Ignore SQLite read error
  }

  // Overlay latest in-memory cached / dirty buckets (guarantees real-time up-to-the-ms accuracy)
  for (const [day, cached] of dailyCache.entries()) {
    if (day >= startDate && day <= endDate) {
      byDay.set(day, cached);
    }
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function computeRealtimeAnalytics(): RealtimePayload {
  const nowMs = Date.now();
  pruneRealtimeVisitors(nowMs);
  const visitors = [...realtimeVisitorsMap.values()]
    .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
    .slice(0, 50)
    .map(({ lastSeenMs: _ignored, ...rest }) => rest);

  return {
    activeCount: realtimeVisitorsMap.size,
    checkedAt: new Date(nowMs).toISOString(),
    visitors,
  };
}

export function computeAnalyticsDashboard(
  periodKey: AnalyticsPeriodKey = '30d',
  customStart?: string,
  customEnd?: string
): AnalyticsDashboardPayload {
  const { startDate, endDate } = resolveDateRange(periodKey, customStart, customEnd);
  const buckets = loadBucketsInRange(startDate, endDate);
  const bucketByDay = new Map(buckets.map((b) => [b.day, b]));

  const todayKey = utcDayKey(Date.now());
  const todayBucket = getOrLoadDailyBucket(todayKey);

  let totalSessions = 0;
  let totalPageViews = 0;
  let totalBounces = 0;
  let totalDurationSum = 0;
  let totalVisitorDays = 0;
  let newVisitors = 0;
  const uniqueVisitorsSet = new Set<string>();

  const hourCounts = Array.from({ length: 24 }, () => 0);

  const countryMap = new Map<
    string,
    {
      countryCode: string;
      numericId: string;
      countryName: string;
      continent: string;
      visitors: Set<string>;
      sessions: number;
      pageViews: number;
    }
  >();
  const regionMap = new Map<
    string,
    {
      countryCode: string;
      countryName: string;
      region: string;
      visitors: Set<string>;
      sessions: number;
      pageViews: number;
    }
  >();
  const cityMap = new Map<
    string,
    {
      countryCode: string;
      countryName: string;
      region: string;
      city: string;
      visitors: Set<string>;
      sessions: number;
      pageViews: number;
    }
  >();

  const deviceCounts: Record<DeviceKind, number> = { mobile: 0, desktop: 0, tablet: 0 };
  const osCounts = new Map<string, number>();
  const browserCounts = new Map<string, number>();
  const resCounts = new Map<string, number>();

  const pageAgg = new Map<
    string,
    {
      path: string;
      title: string;
      views: number;
      visitors: Set<string>;
      totalDuration: number;
      entries: number;
      exits: number;
      entryBounces: number;
    }
  >();

  for (const b of buckets) {
    totalSessions += b.sessions;
    totalPageViews += b.pageViews;
    totalBounces += b.bounces;
    totalDurationSum += b.durationSum;
    newVisitors += b.newVisitors;
    totalVisitorDays += b.visitors.length || b.sessions;
    for (const v of b.visitors) uniqueVisitorsSet.add(v);

    for (let h = 0; h < 24; h++) {
      hourCounts[h] += b.hourly[h] ?? 0;
    }

    for (const c of Object.values(b.countries)) {
      const meta = COUNTRIES_BY_CODE[c.countryCode];
      const entry = countryMap.get(c.countryCode) ?? {
        countryCode: c.countryCode,
        numericId: meta?.numericId ?? '',
        countryName: c.countryName,
        continent: c.continent ?? meta?.continent ?? '',
        visitors: new Set(),
        sessions: 0,
        pageViews: 0,
      };
      entry.sessions += c.sessions;
      entry.pageViews += c.pageViews;
      for (const v of c.visitors) entry.visitors.add(v);
      countryMap.set(c.countryCode, entry);
    }

    for (const [rKey, r] of Object.entries(b.regions)) {
      const entry = regionMap.get(rKey) ?? {
        countryCode: r.countryCode,
        countryName: r.countryName,
        region: r.region ?? '',
        visitors: new Set(),
        sessions: 0,
        pageViews: 0,
      };
      entry.sessions += r.sessions;
      entry.pageViews += r.pageViews;
      for (const v of r.visitors) entry.visitors.add(v);
      regionMap.set(rKey, entry);
    }

    for (const [ctKey, c] of Object.entries(b.cities)) {
      const entry = cityMap.get(ctKey) ?? {
        countryCode: c.countryCode,
        countryName: c.countryName,
        region: c.region ?? '',
        city: c.city ?? '',
        visitors: new Set(),
        sessions: 0,
        pageViews: 0,
      };
      entry.sessions += c.sessions;
      entry.pageViews += c.pageViews;
      for (const v of c.visitors) entry.visitors.add(v);
      cityMap.set(ctKey, entry);
    }

    deviceCounts.mobile += b.devices.mobile ?? 0;
    deviceCounts.desktop += b.devices.desktop ?? 0;
    deviceCounts.tablet += b.devices.tablet ?? 0;

    for (const [k, v] of Object.entries(b.os)) osCounts.set(k, (osCounts.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(b.browsers))
      browserCounts.set(k, (browserCounts.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(b.resolutions))
      resCounts.set(k, (resCounts.get(k) ?? 0) + v);

    for (const [pPath, p] of Object.entries(b.pages)) {
      const entry = pageAgg.get(pPath) ?? {
        path: pPath,
        title: p.title || pPath,
        views: 0,
        visitors: new Set(),
        totalDuration: 0,
        entries: 0,
        exits: 0,
        entryBounces: 0,
      };
      entry.views += p.views;
      entry.totalDuration += p.durationSum;
      entry.entries += p.entries;
      entry.exits += p.exits;
      entry.entryBounces += p.bounces;
      if (p.title && p.title !== pPath) entry.title = p.title;
      for (const v of p.visitors) entry.visitors.add(v);
      pageAgg.set(pPath, entry);
    }
  }

  const uniqueVisitors = uniqueVisitorsSet.size;
  const clampedNew = Math.min(uniqueVisitors, newVisitors);
  const returningVisitors = Math.max(0, uniqueVisitors - clampedNew);
  const avgSessionDurationSec = totalSessions ? Math.round(totalDurationSum / totalSessions) : 0;
  const bounceRate = totalSessions ? Math.round((totalBounces / totalSessions) * 1000) / 10 : 0;

  const realtime = computeRealtimeAnalytics();
  const activeSessionsCount = countActivePersistentSessionUsers();
  const registeredMembers = activeMembersCountProvider ? activeMembersCountProvider() : 0;
  const totalActiveUsers = Math.max(registeredMembers, activeSessionsCount);

  // Timeline
  const allDays = enumerateDays(startDate, endDate);
  const granularity: 'day' | 'month' = allDays.length > 110 ? 'month' : 'day';
  const timeline: TimelinePoint[] = [];

  if (granularity === 'day') {
    for (const d of allDays) {
      const b = bucketByDay.get(d);
      const [y, m, dayNum] = d.split('-');
      const label = new Date(Date.UTC(Number(y), Number(m) - 1, Number(dayNum))).toLocaleDateString(
        'fr-FR',
        { day: '2-digit', month: 'short', timeZone: 'UTC' }
      );
      timeline.push({
        bucket: d,
        label,
        visitors: b?.sessions ?? 0,
        uniqueVisitors: b?.visitors.length ?? 0,
        sessions: b?.sessions ?? 0,
        pageViews: b?.pageViews ?? 0,
      });
    }
  } else {
    const monthAgg = new Map<
      string,
      { visitors: Set<string>; sessions: number; pageViews: number }
    >();
    for (const d of allDays) {
      const mKey = d.slice(0, 7);
      const entry = monthAgg.get(mKey) ?? { visitors: new Set(), sessions: 0, pageViews: 0 };
      const b = bucketByDay.get(d);
      if (b) {
        entry.sessions += b.sessions;
        entry.pageViews += b.pageViews;
        for (const v of b.visitors) entry.visitors.add(v);
      }
      monthAgg.set(mKey, entry);
    }
    for (const [mKey, entry] of [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const [y, m] = mKey.split('-');
      const label = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('fr-FR', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      });
      timeline.push({
        bucket: mKey,
        label,
        visitors: entry.sessions,
        uniqueVisitors: entry.visitors.size,
        sessions: entry.sessions,
        pageViews: entry.pageViews,
      });
    }
  }

  const hourlyHistogram: HourlyBucket[] = hourCounts.map((visits, h) => ({
    hour: `${String(h).padStart(2, '0')}h`,
    visits,
  }));

  const totalSessionDenom = Math.max(1, totalSessions);
  const countries: CountryStat[] = [...countryMap.values()]
    .sort((a, b) => b.sessions - a.sessions)
    .map((c) => ({
      countryCode: c.countryCode,
      numericId: c.numericId,
      countryName: c.countryName,
      continent: c.continent,
      visitors: c.visitors.size,
      uniqueVisitors: c.visitors.size,
      sessions: c.sessions,
      pageViews: c.pageViews,
      sharePct: Math.round((c.sessions / totalSessionDenom) * 1000) / 10,
    }));

  const regions: RegionStat[] = [...regionMap.values()]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 30)
    .map((r) => ({
      countryCode: r.countryCode,
      countryName: r.countryName,
      region: r.region,
      visitors: r.visitors.size,
      sessions: r.sessions,
      pageViews: r.pageViews,
      sharePct: Math.round((r.sessions / totalSessionDenom) * 1000) / 10,
    }));

  const cities: CityStat[] = [...cityMap.values()]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 30)
    .map((c) => ({
      countryCode: c.countryCode,
      countryName: c.countryName,
      region: c.region,
      city: c.city,
      visitors: c.visitors.size,
      sessions: c.sessions,
      pageViews: c.pageViews,
      sharePct: Math.round((c.sessions / totalSessionDenom) * 1000) / 10,
    }));

  // Geo timeline for top 5 countries
  const top5Countries = countries.slice(0, 5);
  const top5Names = top5Countries.map((c) => c.countryName);
  const geoPoints = timeline.map((pt) => {
    const point: Record<string, string | number> = { label: pt.label };
    for (const name of top5Names) point[name] = 0;

    if (granularity === 'day') {
      const b = bucketByDay.get(pt.bucket);
      if (b) {
        for (const c of top5Countries) {
          point[c.countryName] = b.countries[c.countryCode]?.sessions ?? 0;
        }
      }
    } else {
      for (const b of buckets) {
        if (b.day.slice(0, 7) !== pt.bucket) continue;
        for (const c of top5Countries) {
          point[c.countryName] =
            Number(point[c.countryName] ?? 0) + (b.countries[c.countryCode]?.sessions ?? 0);
        }
      }
    }
    return point;
  });

  const deviceLabel: Record<DeviceKind, string> = {
    mobile: 'Mobile',
    desktop: 'Ordinateur',
    tablet: 'Tablette',
  };
  const devices: TechBreakdownItem[] = (['mobile', 'desktop', 'tablet'] as DeviceKind[]).map(
    (k) => {
      const count = deviceCounts[k] ?? 0;
      return {
        name: deviceLabel[k],
        key: k,
        count,
        pct: Math.round((count / totalSessionDenom) * 1000) / 10,
      };
    }
  );

  const os: TechBreakdownItem[] = [...osCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / totalSessionDenom) * 1000) / 10,
    }));

  const browsers: TechBreakdownItem[] = [...browserCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / totalSessionDenom) * 1000) / 10,
    }));

  const resolutions: ResolutionStat[] = [...resCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([resolution, count]) => ({
      resolution,
      count,
      pct: Math.round((count / totalSessionDenom) * 1000) / 10,
    }));

  const topPages: PageStat[] = [...pageAgg.values()]
    .sort((a, b) => b.views - a.views)
    .slice(0, 25)
    .map((p) => ({
      path: p.path,
      title: p.title,
      views: p.views,
      uniqueVisitors: p.visitors.size,
      avgDurationSec: p.views > 0 ? Math.round(p.totalDuration / p.views) : 0,
      entries: p.entries,
      exits: p.exits,
      bounceRate: p.entries > 0 ? Math.round((p.entryBounces / p.entries) * 1000) / 10 : 0,
    }));

  const topContent: ContentStat[] = topPages
    .filter((p) => /^\/(film|serie|anime|pinoy|c\/[^/]+)\//.test(p.path))
    .slice(0, 8)
    .map((p) => {
      const seg = p.path.split('/')[1] || 'film';
      return {
        path: p.path,
        title: p.title.replace(/\s*—\s*StreamWall$/i, ''),
        itemType:
          seg === 'serie'
            ? 'Série'
            : seg === 'anime'
              ? 'Anime'
              : seg === 'pinoy'
                ? 'Pinoy'
                : seg === 'c'
                  ? 'API'
                  : 'Film',
        views: p.views,
        uniqueVisitors: p.uniqueVisitors,
      };
    });

  return {
    period: { key: periodKey, startDate, endDate },
    summary: {
      totalVisitors: totalVisitorDays,
      uniqueVisitors,
      sessions: totalSessions,
      pageViews: totalPageViews,
      activeNow: realtime.activeCount,
      activeUsersToday: todayBucket.visitors.length,
      totalActiveUsers,
      activeSessionsCount,
      avgSessionDurationSec,
      bounceRate,
      newVisitors: clampedNew,
      returningVisitors,
    },
    timeline,
    hourlyHistogram,
    geo: {
      countries,
      regions,
      cities,
      geoTimeline: {
        seriesKeys: top5Names,
        points: geoPoints,
      },
    },
    tech: {
      devices,
      os,
      browsers,
      resolutions,
    },
    pages: {
      topPages,
      topContent,
    },
    realtime,
  };
}
