export type AnalyticsPeriodKey =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | '90d'
  | 'year'
  | 'custom';

export type DeviceKind = 'mobile' | 'desktop' | 'tablet';

export interface AnalyticsSummary {
  totalVisitors: number;
  uniqueVisitors: number;
  sessions: number;
  pageViews: number;
  activeNow: number;
  activeUsersToday: number;
  totalActiveUsers: number;
  activeSessionsCount: number;
  avgSessionDurationSec: number;
  bounceRate: number;
  newVisitors: number;
  returningVisitors: number;
}

export interface TimelinePoint {
  bucket: string;
  label: string;
  visitors: number;
  uniqueVisitors: number;
  sessions: number;
  pageViews: number;
}

export interface HourlyBucket {
  hour: string;
  visits: number;
}

export interface CountryStat {
  countryCode: string;
  numericId: string;
  countryName: string;
  continent: string;
  visitors: number;
  uniqueVisitors: number;
  sessions: number;
  pageViews: number;
  sharePct: number;
}

export interface RegionStat {
  countryCode: string;
  countryName: string;
  region: string;
  visitors: number;
  sessions: number;
  pageViews: number;
  sharePct: number;
}

export interface CityStat {
  countryCode: string;
  countryName: string;
  region: string;
  city: string;
  visitors: number;
  sessions: number;
  pageViews: number;
  sharePct: number;
}

export interface GeoTimelineData {
  seriesKeys: string[];
  points: Array<Record<string, string | number>>;
}

export interface TechBreakdownItem {
  name: string;
  key?: string;
  count: number;
  pct: number;
}

export interface ResolutionStat {
  resolution: string;
  count: number;
  pct: number;
}

export interface PageStat {
  path: string;
  title: string;
  views: number;
  uniqueVisitors: number;
  avgDurationSec: number;
  entries: number;
  exits: number;
  bounceRate: number;
}

export interface ContentStat {
  path: string;
  title: string;
  itemType: string;
  views: number;
  uniqueVisitors: number;
}

export interface RealtimeVisitor {
  sessionId: string;
  visitorType: 'member' | 'guest';
  userId?: string | null;
  username?: string | null;
  userRole?: 'admin' | 'member' | 'guest';
  isPro?: boolean;
  ip: string;
  countryCode: string;
  countryName: string;
  region: string;
  city: string;
  geoSource?: 'cdn' | 'timezone' | 'lang';
  currentPath: string;
  currentTitle: string;
  deviceType: DeviceKind;
  os: string;
  browser: string;
  lastActivityAt: string;
}

export interface RealtimePayload {
  activeCount: number;
  memberCount: number;
  guestCount: number;
  checkedAt: string;
  visitors: RealtimeVisitor[];
}

export interface AnalyticsDashboardPayload {
  period: {
    key: AnalyticsPeriodKey;
    startDate: string;
    endDate: string;
  };
  summary: AnalyticsSummary;
  timeline: TimelinePoint[];
  hourlyHistogram: HourlyBucket[];
  geo: {
    countries: CountryStat[];
    regions: RegionStat[];
    cities: CityStat[];
    geoTimeline: GeoTimelineData;
  };
  tech: {
    devices: TechBreakdownItem[];
    os: TechBreakdownItem[];
    browsers: TechBreakdownItem[];
    resolutions: ResolutionStat[];
  };
  pages: {
    topPages: PageStat[];
    topContent: ContentStat[];
  };
  realtime: RealtimePayload;
}

export interface PlayTimelinePoint {
  bucket: string;
  label: string;
  fullLabel: string;
  plays: number;
  moviePlays: number;
  seriesPlays: number;
}

export interface TopPlayedItem {
  key: string;
  itemType: 'film' | 'serie' | 'anime' | 'pinoy' | 'custom';
  mediaKind: 'movie' | 'series';
  itemId: string;
  title: string;
  poster: string | null;
  path: string;
  plays: number;
}

export interface PlayReportPayload {
  period: {
    key: AnalyticsPeriodKey;
    startDate: string;
    endDate: string;
  };
  totalPlays: number;
  moviePlays: number;
  seriesPlays: number;
  timeline: PlayTimelinePoint[];
  mostPlayedSeries: TopPlayedItem[];
  mostPlayedMovies: TopPlayedItem[];
}
