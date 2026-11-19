export type ItemType = 'film' | 'serie' | 'anime';

export interface Item {
  id: string;
  titre: string;
  poster: string | null;
  qualite: string | null;
  langue: string | null;
  item_type: ItemType;
  saison: string | number | null;
  genre?: string | null;
  annee?: number | null;
  tmdbId?: string | null;
}

export interface Slide extends Item {
  descr: string | null;
  backdrop: string | null;
  trailer?: string | null;
}

export interface DetailItem {
  id: string | number;
  titre: string;
  descr: string | null;
  qualite: string | null;
  langue: string | null;
  type: ItemType;
  tmdbId: string | null;
  poster: string | null;
  trailer: string | null;
  backdrop: string | null;
  genre: string | null;
  annee: number | null;
  saison?: string | number | null;
}

export interface CastMember {
  nom: string;
  photo: string | null;
  role: string | null;
}

export interface Episode {
  saison: number;
  episode: number;
  titre: string | null;
  description?: string | null;
  still?: string | null;
  airDate?: string | null;
  runtime?: number | null;
  available?: boolean;
  url?: string | null;
}

export interface SeasonMeta {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  availableCount: number;
  available: boolean;
  airDate?: string | null;
  poster?: string | null;
}

export interface DetailResponse {
  item: DetailItem | null;
  cast: CastMember[];
  related: Item[];
  sameGenre: Item[];
  episodes: Episode[];
  seasonsMeta?: SeasonMeta[];
  tmdbRating?: {
    average: number;
    count: number;
  } | null;
  rating: {
    average: number | null;
    count: number;
    myScore: number | null;
  };
}

export interface CatalogueFilters {
  q: string;
  type: string;
  genre: string;
  year: string;
  lang: string;
  sort: 'recent' | 'pertinence' | 'annee_desc';
  page: number;
}

export interface CataloguePage {
  total: number;
  page: number;
  pages: number;
  approximatif: boolean;
  upstreamStatus: 'live' | 'fallback';
  items: Item[];
}

export interface WatchProgress {
  item: Item;
  tmdbId: string | null;
  season: number;
  episode: number;
  updatedAt: string;
  watchedEpisodes: string[]; // "S1E1", "S1E2", etc.
}

export interface WatchEventRecord {
  id: string;
  userId: string;
  item: Item;
  season: number;
  episode: number;
  viewedAt: string;
}

export type PlanTier = 'free' | 'pro';
export type BillingCycle = 'none' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime' | 'custom';
export type PaymentMethod = 'crypto_gate' | 'manual';
export type PaymentOrderStatus = 'pending' | 'paid' | 'rejected' | 'expired';

export interface PlanPlayers {
  film: string;
  serie: string;
}

export interface SubscriptionPlan {
  id: string;
  tier: PlanTier;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  durationDays: number; // 0 = illimité
  autoRenew: boolean;
  active: boolean;
  features: string[];
  players: PlanPlayers;
  createdAt: string;
  updatedAt: string;
}

export interface QueuedSubscription {
  id: string;
  planId: string;
  planName: string;
  tier: 'pro';
  startsAt: string;
  expiresAt: string | null;
  durationDays: number;
  autoRenew: boolean;
  source: UserSubscription['source'];
  createdAt: string;
}

export interface UserSubscription {
  userId: string;
  planId: string;
  planName: string;
  tier: PlanTier;
  startsAt?: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  source: 'free' | 'admin_manual' | 'crypto_gate' | 'manual_payment';
  status: 'active' | 'expired';
  updatedAt: string;
  queued?: QueuedSubscription[];
}

export interface PaymentOrder {
  id: string;
  userId: string;
  username: string;
  userEmail: string;
  planId: string;
  planName: string;
  amount: number;
  currency: string;
  durationDays: number;
  method: PaymentMethod;
  status: PaymentOrderStatus;
  externalPaymentId?: string | null;
  checkoutUrl?: string | null;
  manualReference?: string | null;
  manualChannel?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string | null;
}

export interface BillingConfig {
  cryptoGateConfigured: boolean;
  cryptoGateEnabled: boolean;
  manualPaymentEnabled: boolean;
  manualPaymentTitle: string;
  manualPaymentInstructions: string;
  defaultCurrency: string;
  proOffersMenuVisible: boolean;
}

export interface AdminPaymentSecretsStatus {
  apiKeyConfigured: boolean;
  apiKeyMask: string;
  webhookConfigured: boolean;
  webhookMask: string;
}

export type EmailProvider = 'smtp' | 'resend' | 'brevo';

export type EmailTemplateKey =
  | 'signup_welcome'
  | 'signup_verify'
  | 'email_change'
  | 'password_change'
  | 'subscription_activated'
  | 'subscription_expired'
  | 'password_reset';

export interface EmailTemplateConfig {
  key: EmailTemplateKey;
  label: string;
  description: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  enabled: boolean;
  variables: string[];
  updatedAt: string;
}

export interface MailLogEntry {
  id: string;
  createdAt: string;
  to: string;
  from: string;
  provider: EmailProvider;
  templateKey: EmailTemplateKey | 'test' | 'custom';
  subject: string;
  status: 'sent' | 'failed';
  error: string | null;
  providerMessageId: string | null;
  latencyMs: number;
}

export interface AdminSmtpSettings {
  provider: EmailProvider;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  clearPass?: boolean;
  resendApiKey?: string;
  clearResendApiKey?: boolean;
  brevoApiKey?: string;
  clearBrevoApiKey?: boolean;
  fromName: string;
  fromEmail: string;
  requireSignupConfirmation: boolean;
}

export interface AdminSmtpStatus {
  provider: EmailProvider;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passConfigured: boolean;
  passMask: string;
  resendApiKeyConfigured: boolean;
  resendApiKeyMask: string;
  brevoApiKeyConfigured: boolean;
  brevoApiKeyMask: string;
  fromName: string;
  fromEmail: string;
  requireSignupConfirmation: boolean;
}

export type ThemeMode = 'dark' | 'light';

export interface UserThemePreference {
  presetId: string;
  mode: ThemeMode;
  accentHex: string;
}

export type NotificationKind =
  | 'comment_reply'
  | 'comment_mention'
  | 'pro_activated'
  | 'pro_expiring_soon'
  | 'pro_expired'
  | 'admin_announcement';

export type AdminNotificationTarget = 'all' | 'pro' | 'free' | 'guest' | 'user';

export interface AdminBroadcastRecord {
  id: string;
  target: AdminNotificationTarget;
  recipientCount: number;
  title: string;
  message: string;
  link: string;
  createdAt: string;
}

export interface SiteConfig {
  siteName: string;
  faviconUrl: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  audience?: 'member' | 'guest';
  kind: NotificationKind;
  title: string;
  message: string;
  link: string;
  read: boolean;
  dedupKey?: string;
  createdAt: string;
}

export type PopupContentMode = 'text' | 'image';

export type PopupTriggerType =
  | 'after_delay'
  | 'on_scroll'
  | 'on_exit_intent'
  | 'after_page_views'
  | 'on_player_open'
  | 'immediate';

export type PopupPageScope =
  | 'all'
  | 'home'
  | 'catalogue'
  | 'detail'
  | 'pricing'
  | 'custom';

export type PopupAudience =
  | 'all'
  | 'guests'
  | 'free'
  | 'guests_and_free'
  | 'pro';

export type PopupDeviceTarget = 'all' | 'desktop' | 'mobile';

export type PopupFrequency =
  | 'once_per_week'
  | 'once_per_day'
  | 'once_per_session'
  | 'custom_days'
  | 'once_ever';

export interface PopupConfig {
  id: string;
  name: string;
  enabled: boolean;
  mode: PopupContentMode;
  title: string;
  bodyText: string;
  buttonLabel: string;
  buttonUrl: string;
  buttonNewTab: boolean;
  imageUrl: string;
  imageAlt: string;
  imageLink: string;
  imageNewTab: boolean;
  triggerType: PopupTriggerType;
  delaySeconds: number;
  scrollPercent: number;
  minPageViews: number;
  pageScope: PopupPageScope;
  customPaths: string;
  excludePaths: string;
  audience: PopupAudience;
  deviceTarget: PopupDeviceTarget;
  frequency: PopupFrequency;
  customIntervalDays: number;
  closeOnBackdrop: boolean;
  autoCloseSeconds: number;
  priority: number;
  startAt: string | null;
  endAt: string | null;
  impressions: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  avatar: string | null;
  role: 'admin' | 'member';
  createdAt: string;
  isPro?: boolean;
  subscription?: UserSubscription;
  theme?: UserThemePreference | null;
  banned?: boolean;
  banReason?: string | null;
  lastEmailChangedAt?: string | null;
  nextEmailChangeAt?: string | null;
}

export interface CommentRecord {
  id: string;
  itemType: ItemType;
  itemId: string;
  itemTitle?: string;
  userId: string;
  username: string;
  avatar: string | null;
  isPro?: boolean;
  parentId: string | null;
  body: string;
  createdAt: string;
}

export interface FriendRecord {
  id: string;
  username: string;
  avatar: string | null;
  isPro?: boolean;
  online: boolean;
  currentItem: Item | null;
  recentWatch: { item: Item; viewedAt: string } | null;
}

export interface RankingEntry {
  item: Item;
  viewers: number;
  plays: number;
}

export interface HomePayload {
  upstreamStatus: 'live' | 'fallback';
  slider: Slide[];
  latest: Item[];
  forYou: Item[];
  continueWatching: WatchProgress[];
  friendsActivity: {
    username: string;
    avatar: string | null;
    isPro?: boolean;
    item: Item;
    viewedAt: string;
  }[];
  week: RankingEntry[];
}

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  isPro?: boolean;
  subscription?: UserSubscription;
  createdAt: string;
  lastSeen: string | null;
  online: boolean;
  currentItem: Item | null;
  currentPage: string | null;
  plays: number;
  banned?: boolean;
  bannedAt?: string | null;
  banReason?: string | null;
}

export interface AdminOverview {
  users: AdminUserSummary[];
  top7: RankingEntry[];
  top30: RankingEntry[];
  recentComments: CommentRecord[];
  source?: 'supabase_auth' | 'supabase_rpc' | 'supabase_profiles' | 'local';
  warning?: string | null;
}

export interface EndpointCheck {
  name: string;
  endpoint: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  detail: string;
}

export interface ApiHealthReport {
  origin: string;
  checkedAt: string;
  endpoints: EndpointCheck[];
}

export const PLAYER_KEYS = [
  'player_member_film',
  'player_member_serie',
  'player_guest_film',
  'player_guest_serie',
] as const;

export type PlayerKey = (typeof PLAYER_KEYS)[number];
export type PlayerTemplates = Record<PlayerKey, string>;

export const DEFAULT_PLAYERS: PlayerTemplates = {
  player_member_film: '/film/{id}',
  player_member_serie: '/tvs/{id}/{s}/{e}',
  player_guest_film: '/film/{id}',
  player_guest_serie: '/tvs/{id}/{s}/{e}',
};

export const TEMPLATE_RE =
  /^(https?:\/\/[^\s"'<>]+|(\/([a-z0-9_.-]+|\{(id|tmdb|s|e)\}))+(\?[a-z0-9_.,~:@!$&'()*+;=%/?{}-]*)?)$/i;

export function isFullUrlTemplate(template: string): boolean {
  return /^https?:\/\//i.test(template.trim());
}

export function stripOriginFromTemplate(template: string, origin?: string): string {
  const trimmed = template.trim();
  if (!origin || !isFullUrlTemplate(trimmed)) return trimmed;
  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  if (cleanOrigin && trimmed.toLowerCase().startsWith(`${cleanOrigin.toLowerCase()}/`)) {
    return trimmed.slice(cleanOrigin.length);
  }
  return trimmed;
}

export function fillTemplate(
  template: string,
  values: { id: string; tmdb?: string | null; s?: string | number | null; e?: string | number | null }
): string | null {
  const trimmed = template.trim();
  if (!trimmed) return null;
  const map: Record<string, string> = {
    id: String(values.id ?? ''),
    tmdb: String(values.tmdb ?? ''),
    s: String(values.s || 1),
    e: String(values.e || 1),
  };
  let missing = false;
  const out = trimmed.replace(/\{(id|tmdb|s|e)\}/g, (_, key: string) => {
    const val = map[key] ?? '';
    if (!/^\d+$/.test(val)) missing = true;
    return val;
  });
  if (missing) return null;
  return isFullUrlTemplate(trimmed) ? out : out.replace(/^\/+/, '');
}

export function matchesTemplate(template: string, pathStr: string, embedOrigin?: string): boolean {
  const normalized = stripOriginFromTemplate(template, embedOrigin);
  if (!TEMPLATE_RE.test(normalized) || isFullUrlTemplate(normalized)) return false;
  const pattern = normalized
    .replace(/^\/+/, '')
    .split(/(\{(?:id|tmdb|s|e)\})/)
    .map((part) => (/^\{/.test(part) ? '\\d+' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${pattern}$`).test(pathStr);
}

export const TYPE_LABELS: Record<ItemType, string> = {
  film: 'Film',
  serie: 'Série',
  anime: 'Anime',
};
