import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PLAYERS,
  TEMPLATE_RE,
  type AdminPaymentSecretsStatus,
  type BillingConfig,
  type BillingCycle,
  type ItemType,
  type PaymentOrder,
  type PlanTier,
  type PlayerTemplates,
  type SubscriptionPlan,
  type UserSubscription,
  type UserThemePreference,
} from '../shared/types.ts';
import {
  isSmtpReady,
  sendSubscriptionActivatedEmail,
  sendSubscriptionExpiredEmail,
} from './mailer.ts';
import { createNotification } from './notificationsStore.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const BILLING_FILE = path.join(DATA_DIR, 'tapenaka-billing.json');

let knownAppUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');

export function setBillingAppUrl(url: string): void {
  const clean = (url || '').trim().replace(/\/+$/, '');
  if (clean && /^https?:\/\//i.test(clean)) {
    knownAppUrl = clean;
  }
}

export interface BanRecord {
  bannedAt: string;
  reason: string;
  bannedBy: string;
}

interface BillingDatabase {
  plans: SubscriptionPlan[];
  subscriptions: Record<string, UserSubscription>;
  orders: PaymentOrder[];
  avatars: Record<string, string>; // userId -> "avatar:01".."avatar:12"
  themes: Record<string, UserThemePreference>;
  userDirectory?: Record<string, { email: string; username: string }>;
  bannedUsers?: Record<string, BanRecord>;
  cryptoGateApiKey?: string;
  cryptoGateWebhookSecret?: string;
  config: {
    cryptoGateEnabled: boolean;
    manualPaymentEnabled: boolean;
    manualPaymentTitle: string;
    manualPaymentInstructions: string;
    defaultCurrency: string;
    proOffersMenuVisible: boolean;
  };
}

function createSeedBillingDb(): BillingDatabase {
  const now = new Date().toISOString();
  return {
    plans: [
      {
        id: 'free',
        tier: 'free',
        name: 'Gratuit',
        description: 'Accès de base au catalogue StreamWall avec lecteur invité.',
        price: 0,
        currency: 'EUR',
        billingCycle: 'none',
        durationDays: 0,
        autoRenew: false,
        active: true,
        features: [
          'Accès complet au catalogue films, séries et animes',
          'Liste de favoris & reprise de lecture',
          'Lecteur standard (avec publicité)',
          'Avatar personnalisé aléatoire',
        ],
        players: {
          film: DEFAULT_PLAYERS.player_guest_film,
          serie: DEFAULT_PLAYERS.player_guest_serie,
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'pro',
        tier: 'pro',
        name: 'Pro Mensuel',
        description: 'Streaming HD sans publicité, lecteur prioritaire et couronne Pro sur votre profil.',
        price: 4.99,
        currency: 'EUR',
        billingCycle: 'monthly',
        durationDays: 30,
        autoRenew: true,
        active: true,
        features: [
          'Lecteur Pro sans publicité & multi-serveurs',
          'Couronne dorée Pro sur votre avatar et commentaires',
          'Accès prioritaire aux nouveautés & suggestions',
          'Renouvellement flexible (Par Carte ou Crypto ou Manuel)',
        ],
        players: {
          film: DEFAULT_PLAYERS.player_member_film,
          serie: DEFAULT_PLAYERS.player_member_serie,
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'pro_yearly',
        tier: 'pro',
        name: 'Pro Annuel',
        description: '12 mois complets d’accès Pro sans publicité avec tarif réduit.',
        price: 44.99,
        currency: 'EUR',
        billingCycle: 'yearly',
        durationDays: 365,
        autoRenew: true,
        active: true,
        features: [
          'Tous les avantages Pro Mensuel pendant 1 an',
          'Économie de 25% par rapport au tarif mensuel',
          'Couronne dorée Pro sur votre avatar',
        ],
        players: {
          film: DEFAULT_PLAYERS.player_member_film,
          serie: DEFAULT_PLAYERS.player_member_serie,
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
    subscriptions: {},
    orders: [],
    avatars: {},
    themes: {},
    config: {
      cryptoGateEnabled: true,
      manualPaymentEnabled: true,
      manualPaymentTitle: 'Paiement manuel (Mobile Money / Virement)',
      manualPaymentInstructions:
        'Effectuez le transfert sur MVola / Orange Money (034 00 000 00) ou par virement, puis indiquez ci-dessous la référence exacte de votre transaction. Un administrateur validera votre accès Pro sous peu.',
      defaultCurrency: 'EUR',
      proOffersMenuVisible: false,
    },
  };
}

function loadBillingDb(): BillingDatabase {
  try {
    if (fs.existsSync(BILLING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(BILLING_FILE, 'utf-8')) as BillingDatabase;
      if (parsed && Array.isArray(parsed.plans) && parsed.config) {
        let migrated = false;
        const plans = parsed.plans.map((p) => {
          if (
            p.id === 'free' &&
            p.players &&
            (p.players.film === '/movie/{tmdb}' || p.players.serie === '/tv/{tmdb}/{s}/{e}')
          ) {
            migrated = true;
            return {
              ...p,
              players: {
                film: p.players.film === '/movie/{tmdb}' ? DEFAULT_PLAYERS.player_guest_film : p.players.film,
                serie:
                  p.players.serie === '/tv/{tmdb}/{s}/{e}'
                    ? DEFAULT_PLAYERS.player_guest_serie
                    : p.players.serie,
              },
            };
          }
          return p;
        });
        const loaded: BillingDatabase = {
          ...createSeedBillingDb(),
          ...parsed,
          plans,
          subscriptions: parsed.subscriptions ?? {},
          orders: Array.isArray(parsed.orders) ? parsed.orders : [],
          avatars: parsed.avatars ?? {},
          themes: parsed.themes ?? {},
          userDirectory: parsed.userDirectory ?? {},
          bannedUsers: parsed.bannedUsers ?? {},
        };
        if (migrated) saveBillingDb(loaded);
        return loaded;
      }
    }
  } catch {
    // Re-seed if corrupted
  }
  const seeded = createSeedBillingDb();
  saveBillingDb(seeded);
  return seeded;
}

function saveBillingDb(state: BillingDatabase): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BILLING_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}

const billingDb: BillingDatabase = loadBillingDb();

export function registerUserDirectoryEntry(userId: string, email?: string, username?: string): void {
  if (!userId || !email || !email.includes('@')) return;
  const dir = billingDb.userDirectory ?? {};
  const prev = dir[userId];
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = (username || prev?.username || cleanEmail.split('@')[0] || 'Membre').trim();
  if (prev?.email === cleanEmail && prev?.username === cleanName) return;
  dir[userId] = { email: cleanEmail, username: cleanName };
  billingDb.userDirectory = dir;
  saveBillingDb(billingDb);
}

function resolveUserContact(
  userId: string,
  fallbackEmail?: string,
  fallbackUsername?: string
): { email: string; username: string } | null {
  if (fallbackEmail && fallbackEmail.includes('@')) {
    registerUserDirectoryEntry(userId, fallbackEmail, fallbackUsername);
    return {
      email: fallbackEmail.trim().toLowerCase(),
      username: (fallbackUsername || fallbackEmail.split('@')[0] || 'Membre').trim(),
    };
  }
  const fromDir = billingDb.userDirectory?.[userId];
  if (fromDir?.email && fromDir.email.includes('@')) {
    return fromDir;
  }
  const fromOrder = billingDb.orders.find((o) => o.userId === userId && o.userEmail?.includes('@'));
  if (fromOrder) {
    return { email: fromOrder.userEmail, username: fromOrder.username || 'Membre' };
  }
  return null;
}

export function banUser(userId: string, bannedBy: string, reason?: string): BanRecord {
  const bans = billingDb.bannedUsers ?? {};
  const record: BanRecord = {
    bannedAt: new Date().toISOString(),
    reason: String(reason || '').trim().slice(0, 240),
    bannedBy,
  };
  bans[userId] = record;
  billingDb.bannedUsers = bans;
  saveBillingDb(billingDb);
  return record;
}

export function unbanUser(userId: string): void {
  if (!billingDb.bannedUsers?.[userId]) return;
  delete billingDb.bannedUsers[userId];
  saveBillingDb(billingDb);
}

export function getUserBanInfo(userId: string): BanRecord | null {
  return billingDb.bannedUsers?.[userId] ?? null;
}

export function isUserBanned(userId: string): boolean {
  return Boolean(billingDb.bannedUsers?.[userId]);
}

export function cleanupUserBillingData(userId: string): void {
  let dirty = false;
  if (billingDb.subscriptions[userId]) {
    delete billingDb.subscriptions[userId];
    dirty = true;
  }
  if (billingDb.avatars[userId]) {
    delete billingDb.avatars[userId];
    dirty = true;
  }
  if (billingDb.themes[userId]) {
    delete billingDb.themes[userId];
    dirty = true;
  }
  if (billingDb.userDirectory?.[userId]) {
    delete billingDb.userDirectory[userId];
    dirty = true;
  }
  if (billingDb.bannedUsers?.[userId]) {
    delete billingDb.bannedUsers[userId];
    dirty = true;
  }
  if (dirty) saveBillingDb(billingDb);
}

export function getFreePlan(): SubscriptionPlan {
  return (
    billingDb.plans.find((p) => p.id === 'free') ??
    billingDb.plans.find((p) => p.tier === 'free') ??
    billingDb.plans[0]
  );
}

/**
 * Checks all stored Pro subscriptions and automatically downgrades expired ones
 * back to Basic (Gratuit). Returns true if any state mutated.
 */
export function reconcileExpiredSubscriptions(): boolean {
  const now = Date.now();
  const freePlan = getFreePlan();
  let changed = false;

  for (const [userId, sub] of Object.entries(billingDb.subscriptions)) {
    if (sub.tier === 'pro' && sub.expiresAt) {
      const expMs = new Date(sub.expiresAt).getTime();
      if (Number.isFinite(expMs) && expMs <= now) {
        billingDb.subscriptions[userId] = {
          userId,
          planId: freePlan.id,
          planName: freePlan.name,
          tier: 'free',
          expiresAt: null,
          autoRenew: false,
          source: 'free',
          status: 'expired',
          updatedAt: new Date(now).toISOString(),
        };
        createNotification({
          userId,
          kind: 'pro_expired',
          title: 'Offre Pro expirée',
          message: `Votre offre ${sub.planName} est arrivée à expiration. Votre compte est repassé automatiquement en offre Basic (${freePlan.name}).`,
          link: '/abonnement',
          dedupKey: `pro_expired:${sub.planId}:${sub.expiresAt}`,
        });
        const contact = resolveUserContact(userId);
        if (contact && isSmtpReady()) {
          void sendSubscriptionExpiredEmail({
            to: contact.email,
            username: contact.username,
            planName: sub.planName,
            expiredAt: sub.expiresAt,
            renewUrl: knownAppUrl ? `${knownAppUrl}/abonnement` : '',
          });
        }
        changed = true;
      } else if (Number.isFinite(expMs) && expMs - now <= 5 * 86_400_000) {
        const daysLeft = Math.max(1, Math.ceil((expMs - now) / 86_400_000));
        createNotification({
          userId,
          kind: 'pro_expiring_soon',
          title: 'Votre offre Pro expire bientôt',
          message: `Il reste ${daysLeft} jour${daysLeft > 1 ? 's' : ''} avant l’expiration de votre offre ${sub.planName} (le ${new Date(sub.expiresAt).toLocaleDateString('fr-FR')}).`,
          link: '/abonnement',
          dedupKey: `pro_expiring_5d:${sub.planId}:${sub.expiresAt}`,
        });
      }
    }
  }

  if (changed) saveBillingDb(billingDb);
  return changed;
}

export function ensureExpiryWarningNotification(userId: string): void {
  const sub = getUserSubscription(userId);
  if (sub.tier === 'pro' && sub.expiresAt) {
    const msLeft = new Date(sub.expiresAt).getTime() - Date.now();
    if (msLeft > 0 && msLeft <= 5 * 86_400_000) {
      const daysLeft = Math.max(1, Math.ceil(msLeft / 86_400_000));
      createNotification({
        userId,
        kind: 'pro_expiring_soon',
        title: 'Votre offre Pro expire bientôt',
        message: `Il reste ${daysLeft} jour${daysLeft > 1 ? 's' : ''} avant l’expiration de votre offre ${sub.planName} (le ${new Date(sub.expiresAt).toLocaleDateString('fr-FR')}).`,
        link: '/abonnement',
        dedupKey: `pro_expiring_5d:${sub.planId}:${sub.expiresAt}`,
      });
    }
  }
}

// Periodic background sweep every 60s so expired Pro users downgrade automatically & 5-day reminders trigger
setInterval(() => {
  reconcileExpiredSubscriptions();
}, 60_000).unref();

export function getUserSubscription(userId: string): UserSubscription {
  reconcileExpiredSubscriptions();
  const existing = billingDb.subscriptions[userId];
  if (existing) return existing;

  const freePlan = getFreePlan();
  return {
    userId,
    planId: freePlan.id,
    planName: freePlan.name,
    tier: 'free',
    expiresAt: null,
    autoRenew: false,
    source: 'free',
    status: 'active',
    updatedAt: freePlan.createdAt,
  };
}

export function isUserPro(userId: string): boolean {
  return getUserSubscription(userId).tier === 'pro';
}

export function assignUserPlan(params: {
  userId: string;
  planId: string;
  durationDays?: number;
  expiresAt?: string | null;
  source: UserSubscription['source'];
  autoRenew?: boolean;
  stackDuration?: boolean;
  userEmail?: string;
  username?: string;
  appUrl?: string;
}): UserSubscription {
  reconcileExpiredSubscriptions();
  const plan =
    params.planId === 'free'
      ? getFreePlan()
      : billingDb.plans.find((p) => p.id === params.planId) ?? getFreePlan();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (params.appUrl) setBillingAppUrl(params.appUrl);
  const contact = resolveUserContact(params.userId, params.userEmail, params.username);

  if (params.planId === 'free' || plan.tier === 'free') {
    const sub: UserSubscription = {
      userId: params.userId,
      planId: plan.id,
      planName: plan.name,
      tier: 'free',
      expiresAt: null,
      autoRenew: false,
      source: params.source,
      status: 'active',
      updatedAt: nowIso,
    };
    billingDb.subscriptions[params.userId] = sub;
    saveBillingDb(billingDb);
    return sub;
  }

  let resolvedExpiresAt: string | null = null;
  if (params.expiresAt !== undefined) {
    resolvedExpiresAt = params.expiresAt;
  } else {
    const days =
      params.durationDays !== undefined ? Math.max(0, params.durationDays) : plan.durationDays;
    if (days > 0) {
      const current = billingDb.subscriptions[params.userId];
      const baseMs =
        params.stackDuration &&
        current?.tier === 'pro' &&
        current.expiresAt &&
        new Date(current.expiresAt).getTime() > nowMs
          ? new Date(current.expiresAt).getTime()
          : nowMs;
      resolvedExpiresAt = new Date(baseMs + days * 86_400_000).toISOString();
    } else {
      resolvedExpiresAt = null;
    }
  }

  const sub: UserSubscription = {
    userId: params.userId,
    planId: plan.id,
    planName: plan.name,
    tier: 'pro',
    expiresAt: resolvedExpiresAt,
    autoRenew: params.autoRenew ?? plan.autoRenew,
    source: params.source,
    status: 'active',
    updatedAt: nowIso,
  };

  billingDb.subscriptions[params.userId] = sub;
  saveBillingDb(billingDb);

  createNotification({
    userId: params.userId,
    kind: 'pro_activated',
    title: `Offre ${plan.name} activée`,
    message: resolvedExpiresAt
      ? `Votre accès Pro est désormais actif jusqu’au ${new Date(resolvedExpiresAt).toLocaleDateString('fr-FR')}. Votre couronne dorée et le lecteur dédié sont débloqués.`
      : 'Votre accès Pro illimité est désormais actif. Votre couronne dorée et le lecteur dédié sont débloqués.',
    link: '/profil',
    dedupKey: `pro_activated:${nowIso}`,
  });

  if (contact && isSmtpReady()) {
    void sendSubscriptionActivatedEmail({
      to: contact.email,
      username: contact.username,
      planName: plan.name,
      expiresAt: resolvedExpiresAt,
      appUrl: params.appUrl || knownAppUrl,
    });
  }

  ensureExpiryWarningNotification(params.userId);
  return sub;
}

export function listPlans(includeInactive = false): SubscriptionPlan[] {
  if (includeInactive) return [...billingDb.plans];
  return billingDb.plans.filter((p) => p.active);
}

export function getPlanById(planId: string): SubscriptionPlan | null {
  return billingDb.plans.find((p) => p.id === planId) ?? null;
}

export function upsertPlan(input: {
  id?: string;
  tier: PlanTier;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  durationDays: number;
  autoRenew: boolean;
  active: boolean;
  features: string[];
  players: { film: string; serie: string };
}): { plan?: SubscriptionPlan; error?: string } {
  const name = String(input.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Le nom de l’offre est requis.' };

  const filmTpl = String(input.players?.film || '').trim();
  const serieTpl = String(input.players?.serie || '').trim();
  if (!TEMPLATE_RE.test(filmTpl) || !TEMPLATE_RE.test(serieTpl)) {
    return {
      error: 'Modèle de lecteur invalide (ex: /film/{id}, /movie/{tmdb}, /tvs/{id}/{s}/{e}).',
    };
  }

  const price = Math.max(0, Number(input.price) || 0);
  const durationDays = input.tier === 'free' ? 0 : Math.max(0, Math.round(Number(input.durationDays) || 0));
  const nowIso = new Date().toISOString();

  const cleanId = (input.id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');

  const existingIdx = cleanId ? billingDb.plans.findIndex((p) => p.id === cleanId) : -1;
  if (existingIdx >= 0) {
    const updated: SubscriptionPlan = {
      ...billingDb.plans[existingIdx],
      tier: input.tier === 'pro' ? 'pro' : 'free',
      name,
      description: String(input.description || '').trim().slice(0, 240),
      price: input.tier === 'free' ? 0 : price,
      currency: String(input.currency || 'EUR').trim().toUpperCase().slice(0, 8) || 'EUR',
      billingCycle: input.billingCycle,
      durationDays,
      autoRenew: Boolean(input.autoRenew),
      active: Boolean(input.active),
      features: (input.features ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 10),
      players: { film: filmTpl, serie: serieTpl },
      updatedAt: nowIso,
    };
    billingDb.plans[existingIdx] = updated;
    saveBillingDb(billingDb);
    return { plan: updated };
  }

  const newId =
    cleanId ||
    `${input.tier}_${crypto.randomBytes(3).toString('hex')}`;
  const created: SubscriptionPlan = {
    id: newId,
    tier: input.tier === 'pro' ? 'pro' : 'free',
    name,
    description: String(input.description || '').trim().slice(0, 240),
    price: input.tier === 'free' ? 0 : price,
    currency: String(input.currency || 'EUR').trim().toUpperCase().slice(0, 8) || 'EUR',
    billingCycle: input.billingCycle,
    durationDays,
    autoRenew: Boolean(input.autoRenew),
    active: Boolean(input.active),
    features: (input.features ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 10),
    players: { film: filmTpl, serie: serieTpl },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  billingDb.plans.push(created);
  saveBillingDb(billingDb);
  return { plan: created };
}

export function deletePlan(planId: string): { ok: boolean; error?: string } {
  if (planId === 'free') {
    return { ok: false, error: 'L’offre de base Gratuit ne peut pas être supprimée.' };
  }
  const before = billingDb.plans.length;
  billingDb.plans = billingDb.plans.filter((p) => p.id !== planId);
  if (billingDb.plans.length === before) {
    return { ok: false, error: 'Offre introuvable.' };
  }
  saveBillingDb(billingDb);
  return { ok: true };
}

function resolveCryptoGateApiKey(): string {
  return (billingDb.cryptoGateApiKey || process.env.CRYPTO_GATE_API_KEY || '').trim();
}

function resolveCryptoGateWebhookSecret(): string {
  return (billingDb.cryptoGateWebhookSecret || process.env.CRYPTO_GATE_WEBHOOK_SECRET || '').trim();
}

function maskSecretValue(val: string): string {
  if (!val) return '';
  if (val.length <= 8) return '••••••••';
  return `${val.slice(0, 4)}••••${val.slice(-4)}`;
}

export function getAdminPaymentSecretsStatus(): AdminPaymentSecretsStatus {
  const apiKey = resolveCryptoGateApiKey();
  const webhook = resolveCryptoGateWebhookSecret();
  return {
    apiKeyConfigured: Boolean(apiKey),
    apiKeyMask: maskSecretValue(apiKey),
    webhookConfigured: Boolean(webhook),
    webhookMask: maskSecretValue(webhook),
  };
}

export function updateAdminPaymentSecrets(patch: {
  apiKey?: string;
  webhookSecret?: string;
  clearApiKey?: boolean;
  clearWebhookSecret?: boolean;
}): AdminPaymentSecretsStatus {
  if (patch.clearApiKey) {
    delete billingDb.cryptoGateApiKey;
  } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    billingDb.cryptoGateApiKey = patch.apiKey.trim().slice(0, 256);
  }
  if (patch.clearWebhookSecret) {
    delete billingDb.cryptoGateWebhookSecret;
  } else if (typeof patch.webhookSecret === 'string' && patch.webhookSecret.trim()) {
    billingDb.cryptoGateWebhookSecret = patch.webhookSecret.trim().slice(0, 256);
  }
  saveBillingDb(billingDb);
  return getAdminPaymentSecretsStatus();
}

export function getBillingConfig(): BillingConfig {
  return {
    cryptoGateConfigured: Boolean(resolveCryptoGateApiKey()),
    cryptoGateEnabled: billingDb.config.cryptoGateEnabled,
    manualPaymentEnabled: billingDb.config.manualPaymentEnabled,
    manualPaymentTitle: billingDb.config.manualPaymentTitle,
    manualPaymentInstructions: billingDb.config.manualPaymentInstructions,
    defaultCurrency: billingDb.config.defaultCurrency,
    proOffersMenuVisible: Boolean(billingDb.config.proOffersMenuVisible),
  };
}

export function updateBillingConfig(patch: Partial<BillingConfig>): BillingConfig {
  if (typeof patch.cryptoGateEnabled === 'boolean') {
    billingDb.config.cryptoGateEnabled = patch.cryptoGateEnabled;
  }
  if (typeof patch.manualPaymentEnabled === 'boolean') {
    billingDb.config.manualPaymentEnabled = patch.manualPaymentEnabled;
  }
  if (typeof patch.manualPaymentTitle === 'string') {
    billingDb.config.manualPaymentTitle = patch.manualPaymentTitle.trim().slice(0, 80);
  }
  if (typeof patch.manualPaymentInstructions === 'string') {
    billingDb.config.manualPaymentInstructions = patch.manualPaymentInstructions.trim().slice(0, 800);
  }
  if (typeof patch.defaultCurrency === 'string' && patch.defaultCurrency.trim()) {
    billingDb.config.defaultCurrency = patch.defaultCurrency.trim().toUpperCase().slice(0, 8);
  }
  if (typeof patch.proOffersMenuVisible === 'boolean') {
    billingDb.config.proOffersMenuVisible = patch.proOffersMenuVisible;
  }
  saveBillingDb(billingDb);
  return getBillingConfig();
}

export function resolvePlanTemplateForUser(
  userId: string | null,
  itemType: ItemType,
  fallbackTemplates: PlayerTemplates
): { template: string; plan: SubscriptionPlan } {
  if (!userId) {
    const freePlan = getFreePlan();
    return {
      template:
        itemType === 'film'
          ? fallbackTemplates.player_guest_film || freePlan.players.film
          : fallbackTemplates.player_guest_serie || freePlan.players.serie,
      plan: freePlan,
    };
  }
  const sub = getUserSubscription(userId);
  const plan = getPlanById(sub.planId) ?? getFreePlan();
  const tpl =
    itemType === 'film'
      ? plan.players.film ||
        (sub.tier === 'pro'
          ? fallbackTemplates.player_member_film
          : fallbackTemplates.player_guest_film)
      : plan.players.serie ||
        (sub.tier === 'pro'
          ? fallbackTemplates.player_member_serie
          : fallbackTemplates.player_guest_serie);
  return { template: tpl, plan };
}

export function syncFreePlanPlayers(players: { film: string; serie: string }): void {
  const idx = billingDb.plans.findIndex((p) => p.id === 'free' || p.tier === 'free');
  if (idx < 0) return;
  const film = players.film.trim();
  const serie = players.serie.trim();
  if (!TEMPLATE_RE.test(film) || !TEMPLATE_RE.test(serie)) return;
  billingDb.plans[idx] = {
    ...billingDb.plans[idx],
    players: { film, serie },
    updatedAt: new Date().toISOString(),
  };
  saveBillingDb(billingDb);
}

export function getAllPlanTemplates(): string[] {
  const out: string[] = [];
  for (const p of billingDb.plans) {
    if (p.players.film) out.push(p.players.film);
    if (p.players.serie) out.push(p.players.serie);
  }
  return out;
}

export function listAllOrders(): PaymentOrder[] {
  return [...billingDb.orders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function listUserOrders(userId: string): PaymentOrder[] {
  return listAllOrders().filter((o) => o.userId === userId);
}

export async function createCryptoGateOrder(params: {
  userId: string;
  username: string;
  userEmail: string;
  planId: string;
  originUrl: string;
}): Promise<{ order?: PaymentOrder; error?: string }> {
  const apiKey = resolveCryptoGateApiKey();
  if (!billingDb.config.cryptoGateEnabled) {
    return { error: 'Le paiement Par Carte ou Crypto est actuellement désactivé.' };
  }
  if (!apiKey) {
    return {
      error:
        'La clé API de paiement (Par Carte ou Crypto) n’est pas encore configurée dans l’administration. Utilisez le paiement manuel.',
    };
  }

  const plan = getPlanById(params.planId);
  if (!plan || !plan.active || plan.tier !== 'pro' || plan.price <= 0) {
    return { error: 'Offre Pro invalide ou inactive.' };
  }

  const orderId = `tpk_${crypto.randomBytes(6).toString('hex')}`;
  const nowIso = new Date().toISOString();
  const rawEmail = String(params.userEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return {
      error:
        'Votre compte ne possède pas encore une adresse email valide pour le paiement. Modifiez votre email dans Mon compte.',
    };
  }

  const amount = Math.round(Number(plan.price) * 100) / 100;
  const currency = (plan.currency || billingDb.config.defaultCurrency || 'EUR').trim().toUpperCase();

  const payload = {
    amount,
    currency,
    email: rawEmail,
    orderId,
    label: plan.name.slice(0, 100),
    description: `${plan.name} — StreamWall`.slice(0, 200),
  };

  try {
    const res = await fetch('https://crypto-gate.cc/api/payment-links', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });

    const json = (await res.json().catch(() => ({}))) as {
      paymentId?: string;
      id?: string;
      checkoutUrl?: string;
      url?: string;
      error?: string;
      message?: string;
      details?: unknown;
      errors?: unknown;
      issues?: unknown;
    };
    const checkoutUrl = json.checkoutUrl || json.url;
    if (!res.ok || !checkoutUrl) {
      const detailText =
        typeof json.details === 'string'
          ? json.details
          : Array.isArray(json.issues)
            ? json.issues
                .map((i: unknown) =>
                  typeof i === 'object' && i !== null && 'message' in i
                    ? String((i as { message: unknown }).message)
                    : String(i)
                )
                .join(', ')
            : json.details || json.errors
              ? JSON.stringify(json.details || json.errors)
              : '';
      const baseMsg = json.error || json.message || `Erreur du prestataire de paiement (HTTP ${res.status})`;
      return {
        error: detailText ? `${baseMsg} (${detailText})` : baseMsg,
      };
    }

    const externalPaymentId =
      json.paymentId ||
      json.id ||
      checkoutUrl.match(/\/checkout\/([a-zA-Z0-9_-]+)/)?.[1] ||
      null;

    const order: PaymentOrder = {
      id: orderId,
      userId: params.userId,
      username: params.username,
      userEmail: params.userEmail,
      planId: plan.id,
      planName: plan.name,
      amount: plan.price,
      currency: plan.currency,
      durationDays: plan.durationDays,
      method: 'crypto_gate',
      status: 'pending',
      externalPaymentId,
      checkoutUrl,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    billingDb.orders.unshift(order);
    saveBillingDb(billingDb);
    return { order };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Connexion au service de paiement impossible : ${err.message}`
          : 'Connexion au service de paiement impossible.',
    };
  }
}

export async function syncPendingCryptoGateOrdersForUser(userId: string): Promise<void> {
  const apiKey = resolveCryptoGateApiKey();
  if (!apiKey || !userId) return;

  const cutoffMs = Date.now() - 48 * 3600_000;
  const pendingOrders = billingDb.orders.filter(
    (o) =>
      o.userId === userId &&
      o.method === 'crypto_gate' &&
      o.status === 'pending' &&
      new Date(o.createdAt).getTime() >= cutoffMs
  );
  if (pendingOrders.length === 0) return;

  for (const order of pendingOrders) {
    const extId =
      order.externalPaymentId ||
      order.checkoutUrl?.match(/\/checkout\/([a-zA-Z0-9_-]+)/)?.[1] ||
      '';
    if (!extId) continue;

    try {
      const res = await fetch(`https://crypto-gate.cc/api/payment-links/${encodeURIComponent(extId)}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        payment?: { status?: string };
      };
      const st = String(data.status || data.payment?.status || '').toLowerCase();
      if (['paid', 'completed', 'confirmed', 'succeeded'].includes(st)) {
        reviewOrder(order.id, 'approve');
      } else if (['expired', 'failed', 'cancelled', 'canceled'].includes(st)) {
        order.status = 'expired';
        order.updatedAt = new Date().toISOString();
        saveBillingDb(billingDb);
      }
    } catch {
      // Non-fatal network check
    }
  }
}

export function createManualOrder(params: {
  userId: string;
  username: string;
  userEmail: string;
  planId: string;
  manualChannel: string;
  manualReference: string;
  note?: string;
}): { order?: PaymentOrder; error?: string } {
  if (!billingDb.config.manualPaymentEnabled) {
    return { error: 'Le paiement manuel est actuellement désactivé.' };
  }
  const plan = getPlanById(params.planId);
  if (!plan || !plan.active || plan.tier !== 'pro') {
    return { error: 'Offre Pro introuvable.' };
  }
  const reference = String(params.manualReference || '').trim().slice(0, 120);
  if (!reference) {
    return { error: 'Indiquez la référence de votre paiement.' };
  }

  const nowIso = new Date().toISOString();
  const order: PaymentOrder = {
    id: `man_${crypto.randomBytes(6).toString('hex')}`,
    userId: params.userId,
    username: params.username,
    userEmail: params.userEmail,
    planId: plan.id,
    planName: plan.name,
    amount: plan.price,
    currency: plan.currency,
    durationDays: plan.durationDays,
    method: 'manual',
    status: 'pending',
    manualChannel: String(params.manualChannel || 'Mobile Money / Virement').trim().slice(0, 60),
    manualReference: reference,
    note: params.note ? String(params.note).trim().slice(0, 300) : null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  billingDb.orders.unshift(order);
  saveBillingDb(billingDb);
  return { order };
}

export function reviewOrder(
  orderId: string,
  action: 'approve' | 'reject'
): { order?: PaymentOrder; subscription?: UserSubscription; error?: string } {
  const order = billingDb.orders.find((o) => o.id === orderId);
  if (!order) return { error: 'Commande introuvable.' };

  const nowIso = new Date().toISOString();
  if (action === 'reject') {
    order.status = 'rejected';
    order.updatedAt = nowIso;
    order.reviewedAt = nowIso;
    saveBillingDb(billingDb);
    return { order };
  }

  order.status = 'paid';
  order.updatedAt = nowIso;
  order.reviewedAt = nowIso;

  const sub = assignUserPlan({
    userId: order.userId,
    planId: order.planId,
    durationDays: order.durationDays,
    source: order.method === 'crypto_gate' ? 'crypto_gate' : 'manual_payment',
    stackDuration: true,
    userEmail: order.userEmail,
    username: order.username,
  });
  saveBillingDb(billingDb);
  return { order, subscription: sub };
}

export function verifyAndProcessCryptoGateWebhook(params: {
  rawBody: string;
  signatureHeader: string | undefined;
}): { ok: boolean; status: number; message: string } {
  const secret = resolveCryptoGateWebhookSecret();
  if (secret) {
    const provided = (params.signatureHeader || '').replace(/^sha256=/i, '').trim();
    const expected = crypto
      .createHmac('sha256', secret)
      .update(params.rawBody, 'utf8')
      .digest('hex');
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, status: 401, message: 'Invalid webhook signature' };
    }
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(params.rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, message: 'Invalid JSON payload' };
  }

  const paymentObj =
    (payload.payment as Record<string, unknown> | undefined) ||
    (payload.data as Record<string, unknown> | undefined);
  const orderId = String(
    payload.orderId ||
      payload.order_id ||
      paymentObj?.orderId ||
      paymentObj?.order_id ||
      (payload.metadata as Record<string, unknown> | undefined)?.orderId ||
      ''
  ).trim();
  const paymentStatus = String(
    payload.status || paymentObj?.status || payload.event || ''
  ).toLowerCase();

  if (!orderId) {
    return { ok: false, status: 400, message: 'Missing orderId' };
  }

  const order = billingDb.orders.find((o) => o.id === orderId);
  if (!order) {
    return { ok: false, status: 404, message: 'Order not found' };
  }

  if (
    ['paid', 'completed', 'confirmed', 'succeeded', 'payment.paid', 'payment.completed'].includes(
      paymentStatus
    )
  ) {
    if (order.status !== 'paid') {
      reviewOrder(order.id, 'approve');
    }
    return { ok: true, status: 200, message: 'Order activated' };
  }

  if (['expired', 'failed', 'cancelled', 'canceled', 'payment.expired', 'payment.failed'].includes(paymentStatus)) {
    order.status = 'expired';
    order.updatedAt = new Date().toISOString();
    saveBillingDb(billingDb);
  }

  return { ok: true, status: 200, message: 'Webhook processed' };
}

export const AVATAR_IDS = [
  'avatar:01',
  'avatar:02',
  'avatar:03',
  'avatar:04',
  'avatar:05',
  'avatar:06',
  'avatar:07',
  'avatar:08',
  'avatar:09',
  'avatar:10',
  'avatar:11',
  'avatar:12',
] as const;

export function getDeterministicAvatar(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_IDS[hash % AVATAR_IDS.length];
}

export function resolveUserAvatar(userId: string, existingAvatar?: string | null): string {
  const stored = billingDb.avatars[userId];
  if (stored && AVATAR_IDS.includes(stored as (typeof AVATAR_IDS)[number])) {
    return stored;
  }
  if (existingAvatar && AVATAR_IDS.includes(existingAvatar as (typeof AVATAR_IDS)[number])) {
    return existingAvatar;
  }
  return getDeterministicAvatar(userId || 'streamwall');
}

export function setUserAvatarChoice(userId: string, avatarId: string | null): string {
  if (avatarId && AVATAR_IDS.includes(avatarId as (typeof AVATAR_IDS)[number])) {
    billingDb.avatars[userId] = avatarId;
    saveBillingDb(billingDb);
    return avatarId;
  }
  const randomId = AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)];
  billingDb.avatars[userId] = randomId;
  saveBillingDb(billingDb);
  return randomId;
}

export function getUserTheme(userId: string): UserThemePreference | null {
  return billingDb.themes[userId] ?? null;
}

export function setUserTheme(
  userId: string,
  pref: UserThemePreference | null
): UserThemePreference | null {
  if (!pref) {
    delete billingDb.themes[userId];
    saveBillingDb(billingDb);
    return null;
  }
  const clean: UserThemePreference = {
    presetId: String(pref.presetId || 'custom').slice(0, 40),
    mode: pref.mode === 'light' ? 'light' : 'dark',
    accentHex: /^#[0-9a-fA-F]{6}$/.test(pref.accentHex) ? pref.accentHex : '#e6a82e',
  };
  billingDb.themes[userId] = clean;
  saveBillingDb(billingDb);
  return clean;
}
