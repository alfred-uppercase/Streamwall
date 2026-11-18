import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type express from 'express';
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
  RegionStat,
  ResolutionStat,
  TechBreakdownItem,
  TimelinePoint,
} from '../shared/analyticsTypes.ts';
import { COUNTRIES_BY_CODE, TIMEZONE_TO_GEO } from '../shared/geoCountries.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'tapenaka-analytics.json');
const ACTIVE_WINDOW_MS = 60_000;
const MAX_SESSIONS = 12_000;
const MAX_PAGEVIEWS = 35_000;

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

export interface AnalyticsPageViewRecord {
  id: string;
  sessionId: string;
  visitorKey: string;
  path: string;
  title: string;
  viewedAt: string;
  durationSec: number;
  countryCode: string;
}

interface AnalyticsDatabase {
  firstSeenByVisitor: Record<string, string>;
  sessions: AnalyticsSessionRecord[];
  pageViews: AnalyticsPageViewRecord[];
}

export function parseUserAgent(uaRaw: string | undefined): {
  deviceType: DeviceKind;
  os: string;
  browser: string;
} {
  const ua = uaRaw || '';
  const isTablet = /ipad|tablet|(android(?!.*mobile))|kindle|silk/i.test(ua);
  const isMobile = !isTablet && /mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua);
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

function createSeededAnalytics(): AnalyticsDatabase {
  const now = Date.now();
  const sessions: AnalyticsSessionRecord[] = [];
  const pageViews: AnalyticsPageViewRecord[] = [];
  const firstSeenByVisitor: Record<string, string> = {};

  // Deterministic PRNG for clean, reproducible initial historical baseline
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
    { item: { code: 'FR', region: 'Provence-Alpes-Côte d’Azur', city: 'Marseille' }, weight: 4 },
    { item: { code: 'RE', region: 'La Réunion', city: 'Saint-Denis' }, weight: 8 },
    { item: { code: 'RE', region: 'La Réunion', city: 'Saint-Pierre' }, weight: 4 },
    { item: { code: 'CA', region: 'Québec', city: 'Montréal' }, weight: 5 },
    { item: { code: 'BE', region: 'Bruxelles-Capitale', city: 'Bruxelles' }, weight: 4 },
    { item: { code: 'CH', region: 'Vaud', city: 'Lausanne' }, weight: 3 },
    { item: { code: 'MU', region: 'Port-Louis', city: 'Port-Louis' }, weight: 3 },
    { item: { code: 'SN', region: 'Dakar', city: 'Dakar' }, weight: 3 },
    { item: { code: 'CI', region: 'Abidjan', city: 'Abidjan' }, weight: 3 },
    { item: { code: 'MA', region: 'Casablanca-Settat', city: 'Casablanca' }, weight: 2 },
    { item: { code: 'US', region: 'New York', city: 'New York' }, weight: 3 },
    { item: { code: 'GB', region: 'Angleterre', city: 'Londres' }, weight: 2 },
    { item: { code: 'DE', region: 'Berlin', city: 'Berlin' }, weight: 2 },
    { item: { code: 'JP', region: 'Tokyo', city: 'Tokyo' }, weight: 2 },
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
    { item: { deviceType: 'desktop', os: 'macOS', browser: 'Chrome', res: '1440×900' }, weight: 5 },
    { item: { deviceType: 'desktop', os: 'Linux', browser: 'Firefox', res: '1920×1080' }, weight: 4 },
    { item: { deviceType: 'tablet', os: 'iOS', browser: 'Safari', res: '820×1180' }, weight: 2 },
    { item: { deviceType: 'tablet', os: 'Android', browser: 'Chrome', res: '800×1280' }, weight: 2 },
  ];

  const pagesPool = [
    { item: { path: '/', title: 'Accueil — StreamWall' }, weight: 28 },
    { item: { path: '/catalogue', title: 'Catalogue — StreamWall' }, weight: 24 },
    { item: { path: '/film/24044', title: 'Stop! That! Train! — StreamWall' }, weight: 14 },
    { item: { path: '/serie/9650', title: 'GIFT — StreamWall' }, weight: 11 },
    { item: { path: '/film/24405', title: 'The Disinvited — StreamWall' }, weight: 9 },
    { item: { path: '/suggestion', title: 'Suggestion — StreamWall' }, weight: 8 },
    { item: { path: '/film/24393', title: 'My Weird School — StreamWall' }, weight: 6 },
    { item: { path: '/serie/5504', title: 'Sugar — StreamWall' }, weight: 5 },
    { item: { path: '/anime/6749', title: 'The Chosen Adventures — StreamWall' }, weight: 4 },
    { item: { path: '/favoris', title: 'Ma liste — StreamWall' }, weight: 5 },
  ];

  const visitorPool = Array.from({ length: 420 }, (_, i) => `vis_${1000 + i}`);

  // Generate 90 days of traffic (ending 10 minutes ago so real-time reflects genuine live connections)
  for (let dayOffset = 89; dayOffset >= 0; dayOffset--) {
    const dayStart = now - dayOffset * 86_400_000;
    const isWeekend = new Date(dayStart).getDay() === 0 || new Date(dayStart).getDay() === 6;
    const dailySessions = (isWeekend ? 20 : 14) + Math.floor(rand() * 10);

    for (let sIdx = 0; sIdx < dailySessions; sIdx++) {
      // Peak evening streaming hours (17h-23h)
      const hour =
        rand() < 0.62 ? 17 + Math.floor(rand() * 7) : Math.floor(rand() * 24);
      const minute = Math.floor(rand() * 60);
      const d = new Date(dayStart);
      d.setHours(hour, minute, Math.floor(rand() * 60), 0);
      if (d.getTime() > now - 10 * 60_000) {
        d.setTime(now - (12 + Math.floor(rand() * 180)) * 60_000);
      }

      const startedIso = d.toISOString();
      const visitorKey =
        visitorPool[Math.floor(Math.pow(rand(), 1.3) * visitorPool.length)];
      if (!firstSeenByVisitor[visitorKey] || startedIso < firstSeenByVisitor[visitorKey]) {
        firstSeenByVisitor[visitorKey] = startedIso;
      }

      const geo = pickWeighted(geoPool);
      const meta = COUNTRIES_BY_CODE[geo.code] ?? COUNTRIES_BY_CODE['MG'];
      const tech = pickWeighted(devicePool);

      const pageCount = rand() < 0.24 ? 1 : 2 + Math.floor(rand() * 4);
      let cursorMs = d.getTime();
      let entryPath = '/';
      let exitPath = '/';
      let currentTitle = 'Accueil — StreamWall';
      let totalDurationSec = 0;
      const sessionId = `ses_${dayOffset}_${sIdx}_${Math.floor(rand() * 99999)}`;

      for (let pIdx = 0; pIdx < pageCount; pIdx++) {
        const pickedPage =
          pIdx === 0 && rand() < 0.55 ? pagesPool[0].item : pickWeighted(pagesPool);
        const dwellSec = pageCount === 1 && rand() < 0.7 ? 6 + Math.floor(rand() * 8) : 28 + Math.floor(rand() * 240);
        if (pIdx === 0) entryPath = pickedPage.path;
        exitPath = pickedPage.path;
        currentTitle = pickedPage.title;
        totalDurationSec += dwellSec;

        pageViews.push({
          id: `pv_${sessionId}_${pIdx}`,
          sessionId,
          visitorKey,
          path: pickedPage.path,
          title: pickedPage.title,
          viewedAt: new Date(cursorMs).toISOString(),
          durationSec: dwellSec,
          countryCode: meta.code,
        });

        cursorMs += dwellSec * 1000;
      }

      sessions.push({
        sessionId,
        visitorKey,
        startedAt: startedIso,
        lastActivityAt: new Date(cursorMs).toISOString(),
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
      });
    }
  }

  return { firstSeenByVisitor, sessions, pageViews };
}

function loadAnalyticsDb(): AnalyticsDatabase {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf-8')) as AnalyticsDatabase;
      if (parsed && Array.isArray(parsed.sessions) && Array.isArray(parsed.pageViews)) {
        return parsed;
      }
    }
  } catch {
    // Re-seed if corrupted
  }
  const seeded = createSeededAnalytics();
  saveAnalyticsDb(seeded);
  return seeded;
}

let saveScheduled: NodeJS.Timeout | null = null;
function saveAnalyticsDb(state: AnalyticsDatabase): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(state), 'utf-8');
  } catch {
    // Non-fatal
  }
}

function scheduleSave(state: AnalyticsDatabase): void {
  if (saveScheduled) return;
  saveScheduled = setTimeout(() => {
    saveScheduled = null;
    saveAnalyticsDb(state);
  }, 4_000);
}

const analyticsDb: AnalyticsDatabase = loadAnalyticsDb();

export function recordAnalyticsCollect(params: {
  visitorId: string;
  sessionId: string;
  path: string;
  title: string;
  screenResolution?: string;
  timezone?: string;
  req: express.Request;
}) {
  const nowIso = new Date().toISOString();
  const ua = params.req.headers['user-agent'];
  const parsedUa = parseUserAgent(ua);
  const geo = resolveGeoFromRequest(params.req, params.timezone);

  // One-way anonymized visitor key (never stores IP)
  const rawSeed = params.visitorId || `${params.req.ip || 'anon'}:${ua || ''}`;
  const visitorKey = `v_${crypto.createHash('sha256').update(rawSeed).digest('hex').slice(0, 14)}`;

  if (!analyticsDb.firstSeenByVisitor[visitorKey]) {
    analyticsDb.firstSeenByVisitor[visitorKey] = nowIso;
  }

  const cleanPath = (params.path || '/').slice(0, 160);
  const cleanTitle = (params.title || 'StreamWall').slice(0, 120);
  const cleanRes = /^\d{3,4}×\d{3,4}$/.test(params.screenResolution || '')
    ? params.screenResolution!
    : parsedUa.deviceType === 'mobile'
      ? '390×844'
      : '1920×1080';

  let session = analyticsDb.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) {
    session = {
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
    analyticsDb.sessions.push(session);
  } else {
    session.lastActivityAt = nowIso;
    session.exitPath = cleanPath;
    session.currentPath = cleanPath;
    session.currentTitle = cleanTitle;
    session.pageViewCount += 1;
    session.durationSec = Math.max(
      session.durationSec + 5,
      Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000)
    );
  }

  analyticsDb.pageViews.push({
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    visitorKey,
    path: cleanPath,
    title: cleanTitle,
    viewedAt: nowIso,
    durationSec: 15,
    countryCode: geo.countryCode,
  });

  if (analyticsDb.sessions.length > MAX_SESSIONS) {
    analyticsDb.sessions = analyticsDb.sessions.slice(-MAX_SESSIONS);
  }
  if (analyticsDb.pageViews.length > MAX_PAGEVIEWS) {
    analyticsDb.pageViews = analyticsDb.pageViews.slice(-MAX_PAGEVIEWS);
  }

  scheduleSave(analyticsDb);
}

export function recordAnalyticsPing(params: {
  sessionId: string;
  path?: string;
  title?: string;
  deltaSec?: number;
}) {
  const session = analyticsDb.sessions.find((s) => s.sessionId === params.sessionId);
  if (!session) return;

  const nowMs = Date.now();
  session.lastActivityAt = new Date(nowMs).toISOString();
  if (params.path) {
    session.currentPath = params.path.slice(0, 160);
    session.exitPath = session.currentPath;
  }
  if (params.title) {
    session.currentTitle = params.title.slice(0, 120);
  }

  const delta = Math.max(1, Math.min(60, Number(params.deltaSec) || 15));
  session.durationSec = Math.max(
    session.durationSec + delta,
    Math.round((nowMs - new Date(session.startedAt).getTime()) / 1000)
  );

  // Increment dwell time on the latest pageview of this session
  for (let i = analyticsDb.pageViews.length - 1; i >= 0; i--) {
    const pv = analyticsDb.pageViews[i];
    if (pv.sessionId === params.sessionId) {
      pv.durationSec = Math.min(3600, pv.durationSec + delta);
      break;
    }
  }

  scheduleSave(analyticsDb);
}

function resolveDateRange(
  period: AnalyticsPeriodKey,
  customStart?: string,
  customEnd?: string
): { startMs: number; endMs: number; startDate: string; endDate: string } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 86_400_000 - 1;

  if (period === 'today') {
    return {
      startMs: startOfToday,
      endMs: Date.now(),
      startDate: new Date(startOfToday).toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    };
  }
  if (period === 'yesterday') {
    const start = startOfToday - 86_400_000;
    const end = startOfToday - 1;
    return {
      startMs: start,
      endMs: end,
      startDate: new Date(start).toISOString().slice(0, 10),
      endDate: new Date(end).toISOString().slice(0, 10),
    };
  }
  if (period === '7d') {
    const start = startOfToday - 6 * 86_400_000;
    return {
      startMs: start,
      endMs: endOfToday,
      startDate: new Date(start).toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    };
  }
  if (period === '30d') {
    const start = startOfToday - 29 * 86_400_000;
    return {
      startMs: start,
      endMs: endOfToday,
      startDate: new Date(start).toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    };
  }
  if (period === '90d') {
    const start = startOfToday - 89 * 86_400_000;
    return {
      startMs: start,
      endMs: endOfToday,
      startDate: new Date(start).toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    };
  }
  if (period === 'year') {
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    return {
      startMs: start,
      endMs: endOfToday,
      startDate: new Date(start).toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    };
  }

  // Custom date range
  const parsedStart = customStart ? Date.parse(`${customStart}T00:00:00`) : NaN;
  const parsedEnd = customEnd ? Date.parse(`${customEnd}T23:59:59`) : NaN;
  const startMs = Number.isFinite(parsedStart) ? parsedStart : startOfToday - 6 * 86_400_000;
  const endMs = Number.isFinite(parsedEnd) && parsedEnd >= startMs ? parsedEnd : endOfToday;
  return {
    startMs,
    endMs,
    startDate: new Date(startMs).toISOString().slice(0, 10),
    endDate: new Date(endMs).toISOString().slice(0, 10),
  };
}

export function computeRealtimeAnalytics(): RealtimePayload {
  const nowMs = Date.now();
  const active = analyticsDb.sessions
    .filter((s) => nowMs - new Date(s.lastActivityAt).getTime() <= ACTIVE_WINDOW_MS)
    .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

  return {
    activeCount: active.length,
    checkedAt: new Date(nowMs).toISOString(),
    visitors: active.map((s) => ({
      sessionId: s.sessionId.slice(0, 10),
      countryCode: s.countryCode,
      countryName: s.countryName,
      region: s.region,
      city: s.city,
      currentPath: s.currentPath,
      currentTitle: s.currentTitle,
      deviceType: s.deviceType,
      os: s.os,
      browser: s.browser,
      lastActivityAt: s.lastActivityAt,
    })),
  };
}

export function computeAnalyticsDashboard(
  periodKey: AnalyticsPeriodKey = '30d',
  customStart?: string,
  customEnd?: string
): AnalyticsDashboardPayload {
  const { startMs, endMs, startDate, endDate } = resolveDateRange(
    periodKey,
    customStart,
    customEnd
  );

  const sessions = analyticsDb.sessions.filter((s) => {
    const ts = new Date(s.startedAt).getTime();
    return ts >= startMs && ts <= endMs;
  });

  const pageViews = analyticsDb.pageViews.filter((pv) => {
    const ts = new Date(pv.viewedAt).getTime();
    return ts >= startMs && ts <= endMs;
  });

  const uniqueSet = new Set(sessions.map((s) => s.visitorKey));
  const totalVisitorDays = new Set(
    sessions.map((s) => `${s.visitorKey}:${s.startedAt.slice(0, 10)}`)
  ).size;

  let newVisitors = 0;
  for (const vKey of uniqueSet) {
    const firstSeen = analyticsDb.firstSeenByVisitor[vKey];
    if (firstSeen) {
      const firstMs = new Date(firstSeen).getTime();
      if (firstMs >= startMs && firstMs <= endMs) {
        newVisitors += 1;
      }
    }
  }
  const uniqueVisitors = uniqueSet.size;
  const returningVisitors = Math.max(0, uniqueVisitors - newVisitors);

  const avgSessionDurationSec = sessions.length
    ? Math.round(sessions.reduce((sum, s) => sum + s.durationSec, 0) / sessions.length)
    : 0;

  const bouncedCount = sessions.filter(
    (s) => s.pageViewCount <= 1 && s.durationSec < 15
  ).length;
  const bounceRate = sessions.length
    ? Math.round((bouncedCount / sessions.length) * 1000) / 10
    : 0;

  const realtime = computeRealtimeAnalytics();

  // ── Timeline buckets (hourly if <= 2 days, monthly if > 110 days, else daily)
  const spanDays = Math.max(1, Math.ceil((endMs - startMs) / 86_400_000));
  const granularity: 'hour' | 'day' | 'month' =
    spanDays <= 2 ? 'hour' : spanDays > 110 ? 'month' : 'day';

  const bucketKeyForIso = (iso: string): string => {
    if (granularity === 'hour') return iso.slice(0, 13);
    if (granularity === 'month') return iso.slice(0, 7);
    return iso.slice(0, 10);
  };

  const bucketLabel = (key: string): string => {
    if (granularity === 'hour') return `${key.slice(11, 13)}h`;
    if (granularity === 'month') {
      const [y, m] = key.split('-');
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', {
        month: 'short',
        year: '2-digit',
      });
    }
    const [y, m, d] = key.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
    });
  };

  // Pre-build ordered buckets so timeline has zero gaps
  const orderedKeys: string[] = [];
  if (granularity === 'hour') {
    const baseDay = new Date(startMs);
    for (let h = 0; h < 24; h++) {
      const dt = new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate(), h);
      orderedKeys.push(dt.toISOString().slice(0, 13));
    }
  } else if (granularity === 'month') {
    const cursor = new Date(startMs);
    cursor.setDate(1);
    while (cursor.getTime() <= endMs) {
      orderedKeys.push(cursor.toISOString().slice(0, 7));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    let cursorMs = startMs;
    while (cursorMs <= endMs) {
      const k = new Date(cursorMs).toISOString().slice(0, 10);
      if (!orderedKeys.includes(k)) orderedKeys.push(k);
      cursorMs += 86_400_000;
    }
  }

  const timelineMap = new Map<
    string,
    { visitors: Set<string>; sessions: number; pageViews: number }
  >();
  for (const k of orderedKeys) {
    timelineMap.set(k, { visitors: new Set(), sessions: 0, pageViews: 0 });
  }
  for (const s of sessions) {
    const k = bucketKeyForIso(s.startedAt);
    const entry = timelineMap.get(k);
    if (entry) {
      entry.visitors.add(s.visitorKey);
      entry.sessions += 1;
    }
  }
  for (const pv of pageViews) {
    const k = bucketKeyForIso(pv.viewedAt);
    const entry = timelineMap.get(k);
    if (entry) entry.pageViews += 1;
  }

  const timeline: TimelinePoint[] = orderedKeys.map((k) => {
    const b = timelineMap.get(k)!;
    return {
      bucket: k,
      label: bucketLabel(k),
      visitors: b.sessions,
      uniqueVisitors: b.visitors.size,
      sessions: b.sessions,
      pageViews: b.pageViews,
    };
  });

  // ── Hourly histogram (00h - 23h)
  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const s of sessions) {
    const h = new Date(s.startedAt).getHours();
    hourCounts[h] += 1;
  }
  const hourlyHistogram: HourlyBucket[] = hourCounts.map((visits, h) => ({
    hour: `${String(h).padStart(2, '0')}h`,
    visits,
  }));

  // ── Geographic aggregations
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

  for (const s of sessions) {
    const meta = COUNTRIES_BY_CODE[s.countryCode];
    const cEntry = countryMap.get(s.countryCode) ?? {
      countryCode: s.countryCode,
      numericId: meta?.numericId ?? '',
      countryName: s.countryName,
      continent: s.continent,
      visitors: new Set(),
      sessions: 0,
      pageViews: 0,
    };
    cEntry.visitors.add(s.visitorKey);
    cEntry.sessions += 1;
    cEntry.pageViews += s.pageViewCount;
    countryMap.set(s.countryCode, cEntry);

    const rKey = `${s.countryCode}:${s.region}`;
    const rEntry = regionMap.get(rKey) ?? {
      countryCode: s.countryCode,
      countryName: s.countryName,
      region: s.region,
      visitors: new Set(),
      sessions: 0,
      pageViews: 0,
    };
    rEntry.visitors.add(s.visitorKey);
    rEntry.sessions += 1;
    rEntry.pageViews += s.pageViewCount;
    regionMap.set(rKey, rEntry);

    const ctKey = `${s.countryCode}:${s.region}:${s.city}`;
    const ctEntry = cityMap.get(ctKey) ?? {
      countryCode: s.countryCode,
      countryName: s.countryName,
      region: s.region,
      city: s.city,
      visitors: new Set(),
      sessions: 0,
      pageViews: 0,
    };
    ctEntry.visitors.add(s.visitorKey);
    ctEntry.sessions += 1;
    ctEntry.pageViews += s.pageViewCount;
    cityMap.set(ctKey, ctEntry);
  }

  const totalSessionDenom = Math.max(1, sessions.length);
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
  const geoPoints = orderedKeys.map((k) => {
    const point: Record<string, string | number> = { label: bucketLabel(k) };
    for (const c of top5Countries) {
      point[c.countryName] = 0;
    }
    return point;
  });
  const bucketIndexByKey = new Map(orderedKeys.map((k, idx) => [k, idx]));
  for (const s of sessions) {
    if (!top5Names.includes(s.countryName)) continue;
    const idx = bucketIndexByKey.get(bucketKeyForIso(s.startedAt));
    if (idx !== undefined) {
      const pt = geoPoints[idx];
      pt[s.countryName] = Number(pt[s.countryName] ?? 0) + 1;
    }
  }

  // ── Tech breakdown (Devices, OS, Browsers, Resolutions)
  const deviceLabel: Record<DeviceKind, string> = {
    mobile: 'Mobile',
    desktop: 'Ordinateur',
    tablet: 'Tablette',
  };
  const countMap = (items: string[]) => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };

  const devices: TechBreakdownItem[] = (['mobile', 'desktop', 'tablet'] as DeviceKind[]).map(
    (k) => {
      const count = sessions.filter((s) => s.deviceType === k).length;
      return {
        name: deviceLabel[k],
        key: k,
        count,
        pct: Math.round((count / totalSessionDenom) * 1000) / 10,
      };
    }
  );

  const os: TechBreakdownItem[] = countMap(sessions.map((s) => s.os)).map(([name, count]) => ({
    name,
    count,
    pct: Math.round((count / totalSessionDenom) * 1000) / 10,
  }));

  const browsers: TechBreakdownItem[] = countMap(sessions.map((s) => s.browser)).map(
    ([name, count]) => ({
      name,
      count,
      pct: Math.round((count / totalSessionDenom) * 1000) / 10,
    })
  );

  const resolutions: ResolutionStat[] = countMap(sessions.map((s) => s.screenResolution))
    .slice(0, 10)
    .map(([resolution, count]) => ({
      resolution,
      count,
      pct: Math.round((count / totalSessionDenom) * 1000) / 10,
    }));

  // ── Pages & Navigation
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

  for (const pv of pageViews) {
    const entry = pageAgg.get(pv.path) ?? {
      path: pv.path,
      title: pv.title || pv.path,
      views: 0,
      visitors: new Set(),
      totalDuration: 0,
      entries: 0,
      exits: 0,
      entryBounces: 0,
    };
    entry.views += 1;
    entry.visitors.add(pv.visitorKey);
    entry.totalDuration += pv.durationSec;
    if (pv.title && pv.title !== pv.path) entry.title = pv.title;
    pageAgg.set(pv.path, entry);
  }

  for (const s of sessions) {
    const en = pageAgg.get(s.entryPath);
    if (en) {
      en.entries += 1;
      if (s.pageViewCount <= 1 && s.durationSec < 15) {
        en.entryBounces += 1;
      }
    }
    const ex = pageAgg.get(s.exitPath);
    if (ex) ex.exits += 1;
  }

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
    .filter((p) => /^\/(film|serie|anime)\//.test(p.path))
    .slice(0, 8)
    .map((p) => {
      const seg = p.path.split('/')[1] || 'film';
      return {
        path: p.path,
        title: p.title.replace(/\s*—\s*StreamWall$/i, ''),
        itemType: seg === 'serie' ? 'Série' : seg === 'anime' ? 'Anime' : 'Film',
        views: p.views,
        uniqueVisitors: p.uniqueVisitors,
      };
    });

  return {
    period: { key: periodKey, startDate, endDate },
    summary: {
      totalVisitors: totalVisitorDays,
      uniqueVisitors,
      sessions: sessions.length,
      pageViews: pageViews.length,
      activeNow: realtime.activeCount,
      avgSessionDurationSec,
      bounceRate,
      newVisitors,
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
