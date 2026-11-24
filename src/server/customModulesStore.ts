import crypto from 'node:crypto';
import type {
  CustomApiEndpointsConfig,
  CustomApiFieldMapping,
  CustomApiFiltersConfig,
  CustomApiModuleConfig,
  CustomApiPlayerConfig,
  CustomApiPublicModule,
  CustomApiSectionsConfig,
  CustomApiSortOption,
  MenuAuthRule,
  MenuIconKey,
  MenuLinkConfig,
  SiteNavigationConfig,
} from '../shared/types.ts';
import { readModuleSnapshot, writeModuleSnapshot } from './persistentDb.ts';
import {
  DEFAULT_PINOY_DOWNLOAD_MESSAGE,
  DEFAULT_PINOY_MEDIA_BASE_URL,
  DEFAULT_PINOY_PLAYER_TEMPLATE,
  validatePinoyApiUrl,
  validatePinoyMediaBaseUrl,
  validatePinoyPlayerTemplate,
} from './pinoyService.ts';

const VALID_ICONS = new Set<MenuIconKey>([
  'home',
  'layout-grid',
  'film',
  'tv',
  'clapperboard',
  'sparkles',
  'heart',
  'crown',
  'shield',
  'user',
  'globe',
  'compass',
  'flame',
  'play',
  'folder',
  'star',
  'message-square',
  'lock',
]);

const VALID_AUTH_RULES = new Set<MenuAuthRule>([
  'all',
  'member',
  'guest',
  'pro',
  'admin',
  'pro_offers',
]);

const RESERVED_SLUGS = new Set([
  'film',
  'serie',
  'anime',
  'catalogue',
  'favoris',
  'profil',
  'auth',
  'admin',
  'abonnement',
  'pricing',
  'suggestion',
  'demandes',
  'communaute',
  'confidentialite',
  'reset-password',
  'api',
  'c',
  'assets',
]);

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function cleanText(raw: unknown, maxLen: number, fallback = ''): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').trim();
  return (cleaned || fallback).slice(0, maxLen);
}

function cleanIdentifier(raw: unknown, maxLen: number, fallback: string): string {
  const cleaned = cleanText(raw, maxLen, fallback).replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned || fallback;
}

function cleanFieldPath(raw: unknown, maxLen: number, fallback: string): string {
  const cleaned = cleanText(raw, maxLen, fallback).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!cleaned) return fallback;
  const parts = cleaned.split('.').filter(Boolean);
  if (parts.length === 0) return fallback;
  for (const part of parts) {
    if (FORBIDDEN_PATH_SEGMENTS.has(part)) return fallback;
  }
  return parts.join('.');
}

export function sanitizeMenuPath(raw: unknown): string | null {
  const val = cleanText(raw, 200, '');
  if (!val) return null;
  if (/^\/[a-zA-Z0-9/_-]*$/.test(val)) {
    return val === '/' ? '/' : val.replace(/\/+$/, '');
  }
  return null;
}

export function normalizeSlug(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function validateCustomModuleSlug(raw: unknown): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = normalizeSlug(raw);
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    return {
      ok: false,
      error: 'Le slug doit contenir entre 2 et 40 caractères (lettres minuscules, chiffres, tirets).',
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return {
      ok: false,
      error: `Le slug « ${slug} » est réservé par le système.`,
    };
  }
  return { ok: true, slug };
}

export function createDefaultNavigationConfig(): SiteNavigationConfig {
  const now = new Date().toISOString();
  return {
    updatedAt: now,
    communityNavSeeded: true,
    items: [
      {
        id: 'nav_accueil',
        label: 'Accueil',
        path: '/',
        icon: 'home',
        exact: true,
        enabled: true,
        desktop: false,
        mobile: true,
        footer: false,
        order: 10,
        authRule: 'all',
        systemKey: 'home',
      },
      {
        id: 'nav_favoris',
        label: 'Ma liste',
        path: '/favoris',
        icon: 'heart',
        exact: false,
        enabled: true,
        desktop: true,
        mobile: true,
        footer: false,
        order: 20,
        authRule: 'member',
        systemKey: 'favorites',
      },
      {
        id: 'nav_catalogue',
        label: 'Catalogue',
        path: '/catalogue',
        icon: 'layout-grid',
        exact: false,
        enabled: true,
        desktop: true,
        mobile: true,
        footer: true,
        order: 30,
        authRule: 'all',
        systemKey: 'catalogue',
      },
      {
        id: 'nav_pinoy',
        label: 'Pinoy',
        path: '/pinoy',
        icon: 'film',
        exact: false,
        enabled: true,
        desktop: true,
        mobile: true,
        footer: true,
        order: 40,
        authRule: 'all',
        systemKey: 'pinoy',
      },
      {
        id: 'nav_suggestion',
        label: 'Suggestion',
        path: '/suggestion',
        icon: 'sparkles',
        exact: false,
        enabled: true,
        desktop: true,
        mobile: true,
        footer: true,
        order: 50,
        authRule: 'all',
        systemKey: 'suggestion',
      },
      {
        id: 'nav_communaute',
        label: 'Communauté',
        path: '/communaute',
        icon: 'message-square',
        exact: false,
        enabled: true,
        desktop: false,
        mobile: true,
        footer: true,
        order: 55,
        authRule: 'all',
        systemKey: 'community',
      },
      {
        id: 'nav_demandes',
        label: 'Demandes',
        path: '/demandes',
        icon: 'message-square',
        exact: false,
        enabled: true,
        desktop: false,
        mobile: false,
        footer: true,
        order: 60,
        authRule: 'all',
        systemKey: 'requests',
      },
      {
        id: 'nav_abonnement',
        label: 'Devenir Pro',
        path: '/abonnement',
        icon: 'crown',
        exact: false,
        enabled: true,
        desktop: true,
        mobile: false,
        footer: true,
        order: 70,
        authRule: 'pro_offers',
        systemKey: 'pro',
      },
      {
        id: 'nav_confidentialite',
        label: 'Confidentialité',
        path: '/confidentialite',
        icon: 'lock',
        exact: false,
        enabled: true,
        desktop: false,
        mobile: false,
        footer: true,
        order: 80,
        authRule: 'all',
        systemKey: 'privacy',
      },
      {
        id: 'nav_admin',
        label: 'Admin',
        path: '/admin',
        icon: 'shield',
        exact: false,
        enabled: true,
        desktop: true,
        mobile: false,
        footer: false,
        order: 90,
        authRule: 'admin',
        systemKey: 'admin',
      },
      {
        id: 'nav_compte',
        label: 'Mon compte',
        path: '/profil',
        icon: 'user',
        exact: false,
        enabled: true,
        desktop: false,
        mobile: true,
        footer: true,
        order: 100,
        authRule: 'all',
        isAccount: true,
        systemKey: 'account',
      },
    ],
  };
}

function sanitizeMenuLink(raw: unknown, index: number): MenuLinkConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const label = cleanText(r.label, 36, '');
  const path = sanitizeMenuPath(r.path);
  if (!label || !path) return null;

  const id = cleanIdentifier(r.id, 60, `nav_${crypto.randomBytes(4).toString('hex')}`);
  const iconRaw = String(r.icon ?? 'film') as MenuIconKey;
  const icon: MenuIconKey = VALID_ICONS.has(iconRaw) ? iconRaw : 'film';
  const authRaw = String(r.authRule ?? 'all') as MenuAuthRule;
  const authRule: MenuAuthRule = VALID_AUTH_RULES.has(authRaw) ? authRaw : 'all';
  const orderNum = Number(r.order);

  return {
    id,
    label,
    path,
    icon,
    exact: Boolean(r.exact),
    enabled: r.enabled !== false,
    desktop: Boolean(r.desktop),
    mobile: Boolean(r.mobile),
    footer: Boolean(r.footer),
    order: Number.isFinite(orderNum) ? Math.max(0, Math.min(9999, Math.round(orderNum))) : (index + 1) * 10,
    authRule,
    ...(r.isAccount ? { isAccount: true } : {}),
    ...(typeof r.systemKey === 'string' && r.systemKey ? { systemKey: cleanIdentifier(r.systemKey, 40, '') } : {}),
    ...(typeof r.customModuleSlug === 'string' && r.customModuleSlug
      ? { customModuleSlug: normalizeSlug(r.customModuleSlug) }
      : {}),
  };
}

function loadNavigationConfig(): SiteNavigationConfig {
  const stored = readModuleSnapshot<SiteNavigationConfig>('navigation');
  if (stored && Array.isArray(stored.items) && stored.items.length > 0) {
    const cleaned = stored.items
      .map((item, idx) => sanitizeMenuLink(item, idx))
      .filter((x): x is MenuLinkConfig => Boolean(x))
      .sort((a, b) => a.order - b.order);
    if (cleaned.length > 0) {
      let mutated = false;
      if (
        !stored.communityNavSeeded &&
        !cleaned.some((i) => i.path === '/communaute' || i.id === 'nav_communaute')
      ) {
        cleaned.push({
          id: 'nav_communaute',
          label: 'Communauté',
          path: '/communaute',
          icon: 'message-square',
          exact: false,
          enabled: true,
          desktop: false,
          mobile: true,
          footer: true,
          order: 55,
          authRule: 'all',
          systemKey: 'community',
        });
        cleaned.sort((a, b) => a.order - b.order);
        mutated = true;
      }
      const next: SiteNavigationConfig = {
        items: cleaned,
        updatedAt: stored.updatedAt || new Date().toISOString(),
        communityNavSeeded: true,
      };
      if (mutated || !stored.communityNavSeeded) {
        writeModuleSnapshot('navigation', next);
      }
      return next;
    }
  }
  const defaults = createDefaultNavigationConfig();
  writeModuleSnapshot('navigation', defaults);
  return defaults;
}

let navigationState: SiteNavigationConfig = loadNavigationConfig();

export function getSiteNavigation(): SiteNavigationConfig {
  return navigationState;
}

export function updateSiteNavigation(
  payload: Partial<SiteNavigationConfig>
): { ok: true; navigation: SiteNavigationConfig } | { ok: false; error: string } {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0) {
    return { ok: false, error: 'Le menu doit contenir au moins un élément.' };
  }
  if (rawItems.length > 40) {
    return { ok: false, error: 'Maximum 40 éléments de navigation autorisés.' };
  }

  const seenIds = new Set<string>();
  const cleaned: MenuLinkConfig[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = sanitizeMenuLink(rawItems[i], i);
    if (!item) {
      return {
        ok: false,
        error: `Élément #${i + 1} invalide : vérifiez le libellé et le chemin (doit commencer par /).`,
      };
    }
    let uniqueId = item.id;
    while (seenIds.has(uniqueId)) {
      uniqueId = `${item.id}_${i}`;
    }
    seenIds.add(uniqueId);
    cleaned.push({ ...item, id: uniqueId });
  }

  cleaned.sort((a, b) => a.order - b.order);
  const next: SiteNavigationConfig = {
    items: cleaned,
    updatedAt: new Date().toISOString(),
    communityNavSeeded: true,
  };
  navigationState = next;
  writeModuleSnapshot('navigation', next);
  return { ok: true, navigation: next };
}

export function resetSiteNavigation(): SiteNavigationConfig {
  const defaults = createDefaultNavigationConfig();
  navigationState = defaults;
  writeModuleSnapshot('navigation', defaults);
  return defaults;
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM API MODULES STORE
// ─────────────────────────────────────────────────────────────────────────────

interface CustomModulesDatabase {
  modules: CustomApiModuleConfig[];
  pinoyDeleted?: boolean;
}

export const PINOY_BUILTIN_MODULE_ID = 'mod_pinoy_builtin';

export function buildDefaultPinoyModuleConfig(overrides?: {
  apiUrl?: string;
  mediaBaseUrl?: string;
  playerUrlTemplate?: string;
  downloadRestrictionMessage?: string;
}): CustomApiModuleConfig {
  const now = new Date().toISOString();
  const baseEndpoints = createDefaultEndpointsConfig();
  const basePlayer = createDefaultPlayerConfig();
  const baseSections = createDefaultSectionsConfig('Pinoy');
  const apiUrlCheck = validatePinoyApiUrl(overrides?.apiUrl ?? process.env.PINOY_API_URL ?? '');
  const mediaCheck = validatePinoyMediaBaseUrl(
    overrides?.mediaBaseUrl ?? process.env.PINOY_MEDIA_BASE_URL ?? DEFAULT_PINOY_MEDIA_BASE_URL
  );
  const playerCheck = validatePinoyPlayerTemplate(
    overrides?.playerUrlTemplate ?? process.env.PINOY_PLAYER_TEMPLATE ?? DEFAULT_PINOY_PLAYER_TEMPLATE
  );

  return {
    id: PINOY_BUILTIN_MODULE_ID,
    slug: 'pinoy',
    name: 'Pinoy',
    enabled: true,
    badgeText: 'Pinoy',
    icon: 'film',
    endpoints: {
      ...baseEndpoints,
      apiUrl: apiUrlCheck.ok ? apiUrlCheck.url : '',
      mediaBaseUrl: mediaCheck.ok ? mediaCheck.url : DEFAULT_PINOY_MEDIA_BASE_URL,
    },
    fields: createDefaultFieldMapping(),
    filters: createDefaultFiltersConfig(),
    sections: {
      ...baseSections,
      catalogueTitle: 'Films Pinoy',
      catalogueSubtitle: 'Catalogue de films Pinoy avec lecteur intégré et liens de téléchargement.',
    },
    player: {
      ...basePlayer,
      playerUrlTemplate: playerCheck.ok ? playerCheck.template : DEFAULT_PINOY_PLAYER_TEMPLATE,
      primaryPlayerLabel: 'Lecteur Pinoy',
      useSameOriginProxy: true,
      showServerSwitcherInModal: false,
      downloadProOnly: true,
      downloadRestrictionMessage:
        (overrides?.downloadRestrictionMessage || process.env.PINOY_DOWNLOAD_MESSAGE || DEFAULT_PINOY_DOWNLOAD_MESSAGE)
          .trim()
          .slice(0, 500) || DEFAULT_PINOY_DOWNLOAD_MESSAGE,
      onlyDirectDownloads: true,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultEndpointsConfig(): CustomApiEndpointsConfig {
  return {
    apiUrl: '',
    mediaBaseUrl: DEFAULT_PINOY_MEDIA_BASE_URL,
    actionParam: 'action',
    facetsAction: 'facets',
    listAction: 'list',
    detailAction: 'detail',
    detailKeyParam: 'slug',
    queryParam: 'q',
    genreParam: 'genre',
    countryParam: 'pays',
    yearParam: 'annee',
    sortParam: 'sort',
    pageParam: 'page',
    perPageParam: 'per_page',
    perPage: 24,
    similarLimitParam: 'similar_limit',
    similarLimit: 12,
  };
}

export function createDefaultFieldMapping(): CustomApiFieldMapping {
  return {
    listItemsPath: 'items',
    listPagePath: 'page',
    listTotalPath: 'total',
    listTotalPagesPath: 'total_pages',
    facetsGenresPath: 'genres',
    facetsCountriesPath: 'pays',
    facetsYearMinPath: 'annees.min',
    facetsYearMaxPath: 'annees.max',
    detailItemPath: 'film',
    detailEmbedsPath: 'players.embed',
    detailDownloadsPath: 'players.download',
    detailSimilarPath: 'similar',
    itemIdField: 'id',
    itemSlugField: 'slug',
    itemTitleField: 'titre',
    itemOriginalTitleField: 'titre_original',
    itemYearField: 'annee',
    itemReleaseDateField: 'date_sortie',
    itemCountryField: 'pays',
    itemDurationField: 'duree',
    itemRatingField: 'note',
    itemGenresField: 'genres',
    itemSynopsisField: 'synopsis',
    itemPosterField: 'poster',
    itemGalleryField: 'galerie',
    playerUrlField: 'url',
    playerProviderField: 'provider',
    playerQualityField: 'quality',
    playerLanguageField: 'language',
  };
}

export function createDefaultFiltersConfig(): CustomApiFiltersConfig {
  return {
    showSearch: true,
    searchPlaceholder: 'Rechercher un titre ou synopsis…',
    showGenreFilter: true,
    showCountryFilter: true,
    showYearFilter: true,
    showSortFilter: true,
    defaultSort: 'recent',
    sortOptions: [
      { value: 'recent', label: 'Plus récents' },
      { value: 'oldest', label: 'Plus anciens' },
      { value: 'note', label: 'Mieux notés' },
      { value: 'az', label: 'Titre A → Z' },
      { value: 'za', label: 'Titre Z → A' },
    ],
  };
}

export function createDefaultSectionsConfig(name = 'Catalogue'): CustomApiSectionsConfig {
  return {
    catalogueTitle: name,
    catalogueSubtitle: `Catalogue ${name} avec lecteur intégré et liens disponibles.`,
    mobileGridCols: 3,
    desktopGridCols: 6,
    showRating: true,
    showYear: true,
    showDuration: true,
    showCountry: true,
    detailShowHeroGallery: true,
    detailShowSynopsis: true,
    detailShowAvailablePlayersList: false,
    detailShowDownloads: true,
    detailShowGallerySection: false,
    detailShowSimilar: true,
    detailShowComments: true,
    detailShowReportButton: true,
  };
}

export function createDefaultPlayerConfig(): CustomApiPlayerConfig {
  return {
    playerUrlTemplate: '',
    primaryPlayerLabel: 'Lecteur principal',
    useSameOriginProxy: true,
    showServerSwitcherInModal: false,
    includeUpstreamEmbeds: true,
    downloadProOnly: true,
    downloadRestrictionMessage: DEFAULT_PINOY_DOWNLOAD_MESSAGE,
    onlyDirectDownloads: true,
  };
}

function sanitizeCustomModule(
  raw: unknown,
  existing?: CustomApiModuleConfig | null
): { ok: true; module: CustomApiModuleConfig } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Configuration de module invalide.' };
  }
  const r = raw as Record<string, unknown>;
  const slugRes = validateCustomModuleSlug(r.slug ?? existing?.slug);
  if (!slugRes.ok) return slugRes;
  const slug = slugRes.slug;

  const name = cleanText(r.name ?? existing?.name, 50, '');
  if (!name) {
    return { ok: false, error: 'Le nom du module est obligatoire.' };
  }

  const iconRaw = String(r.icon ?? existing?.icon ?? 'film') as MenuIconKey;
  const icon: MenuIconKey = VALID_ICONS.has(iconRaw) ? iconRaw : 'film';
  const badgeText = cleanText(r.badgeText ?? existing?.badgeText ?? name, 24, name);

  const defEndpoints = createDefaultEndpointsConfig();
  const rawEp = (r.endpoints && typeof r.endpoints === 'object' ? r.endpoints : {}) as Record<
    string,
    unknown
  >;
  const apiUrlValidation = validatePinoyApiUrl(
    String(rawEp.apiUrl ?? existing?.endpoints.apiUrl ?? '')
  );
  if (!apiUrlValidation.ok) return { ok: false, error: apiUrlValidation.error };

  const mediaValidation = validatePinoyMediaBaseUrl(
    String(rawEp.mediaBaseUrl ?? existing?.endpoints.mediaBaseUrl ?? defEndpoints.mediaBaseUrl)
  );
  if (!mediaValidation.ok) return { ok: false, error: mediaValidation.error };

  const endpoints: CustomApiEndpointsConfig = {
    apiUrl: apiUrlValidation.url,
    mediaBaseUrl: mediaValidation.url,
    actionParam: cleanIdentifier(rawEp.actionParam, 40, existing?.endpoints.actionParam ?? defEndpoints.actionParam),
    facetsAction: cleanIdentifier(rawEp.facetsAction, 40, existing?.endpoints.facetsAction ?? defEndpoints.facetsAction),
    listAction: cleanIdentifier(rawEp.listAction, 40, existing?.endpoints.listAction ?? defEndpoints.listAction),
    detailAction: cleanIdentifier(rawEp.detailAction, 40, existing?.endpoints.detailAction ?? defEndpoints.detailAction),
    detailKeyParam: cleanIdentifier(rawEp.detailKeyParam, 40, existing?.endpoints.detailKeyParam ?? defEndpoints.detailKeyParam),
    queryParam: cleanIdentifier(rawEp.queryParam, 40, existing?.endpoints.queryParam ?? defEndpoints.queryParam),
    genreParam: cleanIdentifier(rawEp.genreParam, 40, existing?.endpoints.genreParam ?? defEndpoints.genreParam),
    countryParam: cleanIdentifier(rawEp.countryParam, 40, existing?.endpoints.countryParam ?? defEndpoints.countryParam),
    yearParam: cleanIdentifier(rawEp.yearParam, 40, existing?.endpoints.yearParam ?? defEndpoints.yearParam),
    sortParam: cleanIdentifier(rawEp.sortParam, 40, existing?.endpoints.sortParam ?? defEndpoints.sortParam),
    pageParam: cleanIdentifier(rawEp.pageParam, 40, existing?.endpoints.pageParam ?? defEndpoints.pageParam),
    perPageParam: cleanIdentifier(rawEp.perPageParam, 40, existing?.endpoints.perPageParam ?? defEndpoints.perPageParam),
    perPage: Math.max(
      6,
      Math.min(100, Number(rawEp.perPage ?? existing?.endpoints.perPage ?? defEndpoints.perPage) || 24)
    ),
    similarLimitParam: cleanIdentifier(
      rawEp.similarLimitParam,
      40,
      existing?.endpoints.similarLimitParam ?? defEndpoints.similarLimitParam
    ),
    similarLimit: Math.max(
      0,
      Math.min(
        30,
        Number(rawEp.similarLimit ?? existing?.endpoints.similarLimit ?? defEndpoints.similarLimit) || 12
      )
    ),
  };

  const defFields = createDefaultFieldMapping();
  const rawFields = (r.fields && typeof r.fields === 'object' ? r.fields : {}) as Record<
    string,
    unknown
  >;
  const fields: CustomApiFieldMapping = {
    listItemsPath: cleanFieldPath(rawFields.listItemsPath, 80, existing?.fields.listItemsPath ?? defFields.listItemsPath),
    listPagePath: cleanFieldPath(rawFields.listPagePath, 80, existing?.fields.listPagePath ?? defFields.listPagePath),
    listTotalPath: cleanFieldPath(rawFields.listTotalPath, 80, existing?.fields.listTotalPath ?? defFields.listTotalPath),
    listTotalPagesPath: cleanFieldPath(rawFields.listTotalPagesPath, 80, existing?.fields.listTotalPagesPath ?? defFields.listTotalPagesPath),
    facetsGenresPath: cleanFieldPath(rawFields.facetsGenresPath, 80, existing?.fields.facetsGenresPath ?? defFields.facetsGenresPath),
    facetsCountriesPath: cleanFieldPath(rawFields.facetsCountriesPath, 80, existing?.fields.facetsCountriesPath ?? defFields.facetsCountriesPath),
    facetsYearMinPath: cleanFieldPath(rawFields.facetsYearMinPath, 80, existing?.fields.facetsYearMinPath ?? defFields.facetsYearMinPath),
    facetsYearMaxPath: cleanFieldPath(rawFields.facetsYearMaxPath, 80, existing?.fields.facetsYearMaxPath ?? defFields.facetsYearMaxPath),
    detailItemPath: cleanFieldPath(rawFields.detailItemPath, 80, existing?.fields.detailItemPath ?? defFields.detailItemPath),
    detailEmbedsPath: cleanFieldPath(rawFields.detailEmbedsPath, 80, existing?.fields.detailEmbedsPath ?? defFields.detailEmbedsPath),
    detailDownloadsPath: cleanFieldPath(rawFields.detailDownloadsPath, 80, existing?.fields.detailDownloadsPath ?? defFields.detailDownloadsPath),
    detailSimilarPath: cleanFieldPath(rawFields.detailSimilarPath, 80, existing?.fields.detailSimilarPath ?? defFields.detailSimilarPath),
    itemIdField: cleanFieldPath(rawFields.itemIdField, 60, existing?.fields.itemIdField ?? defFields.itemIdField),
    itemSlugField: cleanFieldPath(rawFields.itemSlugField, 60, existing?.fields.itemSlugField ?? defFields.itemSlugField),
    itemTitleField: cleanFieldPath(rawFields.itemTitleField, 60, existing?.fields.itemTitleField ?? defFields.itemTitleField),
    itemOriginalTitleField: cleanFieldPath(rawFields.itemOriginalTitleField, 60, existing?.fields.itemOriginalTitleField ?? defFields.itemOriginalTitleField),
    itemYearField: cleanFieldPath(rawFields.itemYearField, 60, existing?.fields.itemYearField ?? defFields.itemYearField),
    itemReleaseDateField: cleanFieldPath(rawFields.itemReleaseDateField, 60, existing?.fields.itemReleaseDateField ?? defFields.itemReleaseDateField),
    itemCountryField: cleanFieldPath(rawFields.itemCountryField, 60, existing?.fields.itemCountryField ?? defFields.itemCountryField),
    itemDurationField: cleanFieldPath(rawFields.itemDurationField, 60, existing?.fields.itemDurationField ?? defFields.itemDurationField),
    itemRatingField: cleanFieldPath(rawFields.itemRatingField, 60, existing?.fields.itemRatingField ?? defFields.itemRatingField),
    itemGenresField: cleanFieldPath(rawFields.itemGenresField, 60, existing?.fields.itemGenresField ?? defFields.itemGenresField),
    itemSynopsisField: cleanFieldPath(rawFields.itemSynopsisField, 60, existing?.fields.itemSynopsisField ?? defFields.itemSynopsisField),
    itemPosterField: cleanFieldPath(rawFields.itemPosterField, 60, existing?.fields.itemPosterField ?? defFields.itemPosterField),
    itemGalleryField: cleanFieldPath(rawFields.itemGalleryField, 60, existing?.fields.itemGalleryField ?? defFields.itemGalleryField),
    playerUrlField: cleanFieldPath(rawFields.playerUrlField, 60, existing?.fields.playerUrlField ?? defFields.playerUrlField),
    playerProviderField: cleanFieldPath(rawFields.playerProviderField, 60, existing?.fields.playerProviderField ?? defFields.playerProviderField),
    playerQualityField: cleanFieldPath(rawFields.playerQualityField, 60, existing?.fields.playerQualityField ?? defFields.playerQualityField),
    playerLanguageField: cleanFieldPath(rawFields.playerLanguageField, 60, existing?.fields.playerLanguageField ?? defFields.playerLanguageField),
  };

  const defFilters = createDefaultFiltersConfig();
  const rawFilters = (r.filters && typeof r.filters === 'object' ? r.filters : {}) as Record<
    string,
    unknown
  >;
  const rawSortOptions = Array.isArray(rawFilters.sortOptions)
    ? rawFilters.sortOptions
    : existing?.filters.sortOptions ?? defFilters.sortOptions;
  const sortOptions: CustomApiSortOption[] = rawSortOptions
    .map((opt) => {
      if (!opt || typeof opt !== 'object') return null;
      const o = opt as Record<string, unknown>;
      const val = cleanIdentifier(o.value, 32, '');
      const lbl = cleanText(o.label, 40, val);
      return val ? { value: val, label: lbl } : null;
    })
    .filter((x): x is CustomApiSortOption => Boolean(x))
    .slice(0, 12);

  const effectiveSorts = sortOptions.length > 0 ? sortOptions : defFilters.sortOptions;
  const reqDefaultSort = cleanIdentifier(
    rawFilters.defaultSort,
    32,
    existing?.filters.defaultSort ?? effectiveSorts[0].value
  );

  const filters: CustomApiFiltersConfig = {
    showSearch: rawFilters.showSearch !== undefined ? Boolean(rawFilters.showSearch) : (existing?.filters.showSearch ?? defFilters.showSearch),
    searchPlaceholder: cleanText(
      rawFilters.searchPlaceholder,
      120,
      existing?.filters.searchPlaceholder ?? defFilters.searchPlaceholder
    ),
    showGenreFilter: rawFilters.showGenreFilter !== undefined ? Boolean(rawFilters.showGenreFilter) : (existing?.filters.showGenreFilter ?? defFilters.showGenreFilter),
    showCountryFilter: rawFilters.showCountryFilter !== undefined ? Boolean(rawFilters.showCountryFilter) : (existing?.filters.showCountryFilter ?? defFilters.showCountryFilter),
    showYearFilter: rawFilters.showYearFilter !== undefined ? Boolean(rawFilters.showYearFilter) : (existing?.filters.showYearFilter ?? defFilters.showYearFilter),
    showSortFilter: rawFilters.showSortFilter !== undefined ? Boolean(rawFilters.showSortFilter) : (existing?.filters.showSortFilter ?? defFilters.showSortFilter),
    defaultSort: effectiveSorts.some((s) => s.value === reqDefaultSort)
      ? reqDefaultSort
      : effectiveSorts[0].value,
    sortOptions: effectiveSorts,
  };

  const defSections = createDefaultSectionsConfig(name);
  const rawSections = (r.sections && typeof r.sections === 'object' ? r.sections : {}) as Record<
    string,
    unknown
  >;
  const mobColsRaw = Number(rawSections.mobileGridCols ?? existing?.sections.mobileGridCols ?? 3);
  const deskColsRaw = Number(rawSections.desktopGridCols ?? existing?.sections.desktopGridCols ?? 6);
  const sections: CustomApiSectionsConfig = {
    catalogueTitle: cleanText(rawSections.catalogueTitle, 60, existing?.sections.catalogueTitle ?? name),
    catalogueSubtitle: cleanText(
      rawSections.catalogueSubtitle,
      180,
      existing?.sections.catalogueSubtitle ?? defSections.catalogueSubtitle
    ),
    mobileGridCols: mobColsRaw === 2 ? 2 : 3,
    desktopGridCols: deskColsRaw === 4 ? 4 : deskColsRaw === 5 ? 5 : 6,
    showRating: rawSections.showRating !== undefined ? Boolean(rawSections.showRating) : (existing?.sections.showRating ?? true),
    showYear: rawSections.showYear !== undefined ? Boolean(rawSections.showYear) : (existing?.sections.showYear ?? true),
    showDuration: rawSections.showDuration !== undefined ? Boolean(rawSections.showDuration) : (existing?.sections.showDuration ?? true),
    showCountry: rawSections.showCountry !== undefined ? Boolean(rawSections.showCountry) : (existing?.sections.showCountry ?? true),
    detailShowHeroGallery: rawSections.detailShowHeroGallery !== undefined ? Boolean(rawSections.detailShowHeroGallery) : (existing?.sections.detailShowHeroGallery ?? true),
    detailShowSynopsis: rawSections.detailShowSynopsis !== undefined ? Boolean(rawSections.detailShowSynopsis) : (existing?.sections.detailShowSynopsis ?? true),
    detailShowAvailablePlayersList:
      rawSections.detailShowAvailablePlayersList !== undefined
        ? Boolean(rawSections.detailShowAvailablePlayersList)
        : (existing?.sections.detailShowAvailablePlayersList ?? false),
    detailShowDownloads: rawSections.detailShowDownloads !== undefined ? Boolean(rawSections.detailShowDownloads) : (existing?.sections.detailShowDownloads ?? true),
    detailShowGallerySection:
      rawSections.detailShowGallerySection !== undefined
        ? Boolean(rawSections.detailShowGallerySection)
        : (existing?.sections.detailShowGallerySection ?? false),
    detailShowSimilar: rawSections.detailShowSimilar !== undefined ? Boolean(rawSections.detailShowSimilar) : (existing?.sections.detailShowSimilar ?? true),
    detailShowComments: rawSections.detailShowComments !== undefined ? Boolean(rawSections.detailShowComments) : (existing?.sections.detailShowComments ?? true),
    detailShowReportButton:
      rawSections.detailShowReportButton !== undefined
        ? Boolean(rawSections.detailShowReportButton)
        : (existing?.sections.detailShowReportButton ?? true),
  };

  const defPlayer = createDefaultPlayerConfig();
  const rawPlayer = (r.player && typeof r.player === 'object' ? r.player : {}) as Record<
    string,
    unknown
  >;
  const tplValidation = validatePinoyPlayerTemplate(
    String(rawPlayer.playerUrlTemplate ?? existing?.player.playerUrlTemplate ?? '')
  );
  if (!tplValidation.ok) return { ok: false, error: tplValidation.error };

  const player: CustomApiPlayerConfig = {
    playerUrlTemplate: tplValidation.template,
    primaryPlayerLabel: cleanText(
      rawPlayer.primaryPlayerLabel,
      60,
      existing?.player.primaryPlayerLabel ?? defPlayer.primaryPlayerLabel
    ),
    useSameOriginProxy:
      rawPlayer.useSameOriginProxy !== undefined
        ? Boolean(rawPlayer.useSameOriginProxy)
        : (existing?.player.useSameOriginProxy ?? true),
    showServerSwitcherInModal:
      rawPlayer.showServerSwitcherInModal !== undefined
        ? Boolean(rawPlayer.showServerSwitcherInModal)
        : (existing?.player.showServerSwitcherInModal ?? false),
    includeUpstreamEmbeds:
      rawPlayer.includeUpstreamEmbeds !== undefined
        ? Boolean(rawPlayer.includeUpstreamEmbeds)
        : (existing?.player.includeUpstreamEmbeds ?? true),
    downloadProOnly:
      rawPlayer.downloadProOnly !== undefined
        ? Boolean(rawPlayer.downloadProOnly)
        : (existing?.player.downloadProOnly ?? true),
    downloadRestrictionMessage: cleanText(
      rawPlayer.downloadRestrictionMessage,
      500,
      existing?.player.downloadRestrictionMessage ?? DEFAULT_PINOY_DOWNLOAD_MESSAGE
    ),
    onlyDirectDownloads:
      rawPlayer.onlyDirectDownloads !== undefined
        ? Boolean(rawPlayer.onlyDirectDownloads)
        : (existing?.player.onlyDirectDownloads ?? true),
  };

  const now = new Date().toISOString();
  const defaultId = slug === 'pinoy' ? PINOY_BUILTIN_MODULE_ID : `mod_${crypto.randomBytes(5).toString('hex')}`;
  return {
    ok: true,
    module: {
      id: existing?.id ?? defaultId,
      slug,
      name,
      enabled: r.enabled !== undefined ? Boolean(r.enabled) : (existing?.enabled ?? true),
      badgeText,
      icon,
      endpoints,
      fields,
      filters,
      sections,
      player,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
  };
}

function readLegacyPinoyStoreOverrides(): {
  apiUrl?: string;
  mediaBaseUrl?: string;
  playerUrlTemplate?: string;
  downloadRestrictionMessage?: string;
} {
  try {
    const storeSnap = readModuleSnapshot<{
      settings?: {
        pinoy_api_url?: string;
        pinoy_media_base_url?: string;
        pinoy_player_template?: string;
        pinoy_download_message?: string;
      };
    }>('store');
    const s = storeSnap?.settings;
    if (!s) return {};
    return {
      apiUrl: typeof s.pinoy_api_url === 'string' ? s.pinoy_api_url : undefined,
      mediaBaseUrl: typeof s.pinoy_media_base_url === 'string' ? s.pinoy_media_base_url : undefined,
      playerUrlTemplate:
        typeof s.pinoy_player_template === 'string' ? s.pinoy_player_template : undefined,
      downloadRestrictionMessage:
        typeof s.pinoy_download_message === 'string' ? s.pinoy_download_message : undefined,
    };
  } catch {
    return {};
  }
}

function loadCustomModulesDb(): CustomModulesDatabase {
  const stored = readModuleSnapshot<CustomModulesDatabase>('custom_modules');
  if (stored && Array.isArray(stored.modules)) {
    const valid: CustomApiModuleConfig[] = [];
    for (const m of stored.modules) {
      const res = sanitizeCustomModule(m, null);
      if (res.ok) valid.push(res.module);
    }
    const pinoyDeleted = Boolean(stored.pinoyDeleted);
    let mutated = false;
    if (!pinoyDeleted && !valid.some((m) => m.slug === 'pinoy')) {
      valid.unshift(buildDefaultPinoyModuleConfig(readLegacyPinoyStoreOverrides()));
      mutated = true;
    }
    const result: CustomModulesDatabase = {
      modules: valid,
      ...(pinoyDeleted ? { pinoyDeleted: true } : {}),
    };
    if (mutated) {
      writeModuleSnapshot('custom_modules', result);
    }
    return result;
  }
  const initial: CustomModulesDatabase = {
    modules: [buildDefaultPinoyModuleConfig(readLegacyPinoyStoreOverrides())],
  };
  writeModuleSnapshot('custom_modules', initial);
  return initial;
}

const customModulesDb: CustomModulesDatabase = loadCustomModulesDb();

function saveCustomModules(): void {
  writeModuleSnapshot('custom_modules', customModulesDb);
}

export function isPinoyModuleDeleted(): boolean {
  return Boolean(customModulesDb.pinoyDeleted);
}

export function isPinoyModuleActive(): boolean {
  if (customModulesDb.pinoyDeleted) return false;
  const mod = getCustomModule('pinoy');
  return mod ? mod.enabled : true;
}

export function syncPinoyModuleFromSettings(patch: {
  apiUrl?: string;
  mediaBaseUrl?: string;
  playerUrlTemplate?: string;
  downloadRestrictionMessage?: string;
}): void {
  if (customModulesDb.pinoyDeleted) return;
  const existing = getCustomModule('pinoy');
  if (!existing) return;
  const next: CustomApiModuleConfig = {
    ...existing,
    endpoints: {
      ...existing.endpoints,
      ...(patch.apiUrl !== undefined ? { apiUrl: patch.apiUrl } : {}),
      ...(patch.mediaBaseUrl !== undefined ? { mediaBaseUrl: patch.mediaBaseUrl } : {}),
    },
    player: {
      ...existing.player,
      ...(patch.playerUrlTemplate !== undefined ? { playerUrlTemplate: patch.playerUrlTemplate } : {}),
      ...(patch.downloadRestrictionMessage !== undefined
        ? { downloadRestrictionMessage: patch.downloadRestrictionMessage }
        : {}),
    },
    updatedAt: new Date().toISOString(),
  };
  const idx = customModulesDb.modules.findIndex((m) => m.id === existing.id);
  if (idx >= 0) {
    customModulesDb.modules[idx] = next;
    saveCustomModules();
  }
}

export function listCustomModules(includeDisabled = true): CustomApiModuleConfig[] {
  return includeDisabled
    ? [...customModulesDb.modules]
    : customModulesDb.modules.filter((m) => m.enabled);
}

export function getCustomModule(slug: string): CustomApiModuleConfig | null {
  const clean = normalizeSlug(slug);
  return customModulesDb.modules.find((m) => m.slug === clean) ?? null;
}

export function toPublicCustomModule(mod: CustomApiModuleConfig): CustomApiPublicModule {
  return {
    id: mod.id,
    slug: mod.slug,
    name: mod.name,
    enabled: mod.enabled,
    badgeText: mod.badgeText,
    icon: mod.icon,
    filters: mod.filters,
    sections: mod.sections,
    player: {
      primaryPlayerLabel: mod.player.primaryPlayerLabel,
      showServerSwitcherInModal: mod.player.showServerSwitcherInModal,
      downloadProOnly: mod.player.downloadProOnly,
      downloadRestrictionMessage: mod.player.downloadRestrictionMessage,
    },
  };
}

export function upsertCustomModule(
  payload: unknown,
  options?: { syncMenu?: boolean; showDesktop?: boolean; showMobile?: boolean; showFooter?: boolean }
): { ok: true; module: CustomApiModuleConfig } | { ok: false; error: string } {
  const rec = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const existingBySlug =
    typeof rec.slug === 'string' ? getCustomModule(rec.slug) : null;
  const existingById =
    typeof rec.id === 'string'
      ? customModulesDb.modules.find((m) => m.id === rec.id) ?? null
      : null;
  const existing = existingById ?? existingBySlug;

  const validated = sanitizeCustomModule(payload, existing);
  if (!validated.ok) return validated;

  const conflictSlug = customModulesDb.modules.find(
    (m) => m.slug === validated.module.slug && m.id !== validated.module.id
  );
  if (conflictSlug) {
    return { ok: false, error: `Un module utilise déjà le slug « ${validated.module.slug} ».` };
  }

  if (validated.module.slug === 'pinoy') {
    customModulesDb.pinoyDeleted = false;
  }

  const idx = customModulesDb.modules.findIndex((m) => m.id === validated.module.id);
  if (idx >= 0) {
    customModulesDb.modules[idx] = validated.module;
  } else {
    customModulesDb.modules.push(validated.module);
  }
  saveCustomModules();

  if (options?.syncMenu) {
    syncNavigationLinkForCustomModule(validated.module, {
      desktop: options.showDesktop ?? true,
      mobile: options.showMobile ?? true,
      footer: options.showFooter ?? true,
    });
  }

  return { ok: true, module: validated.module };
}

export function deleteCustomModule(slugOrId: string): boolean {
  const clean = slugOrId.trim();
  const target = customModulesDb.modules.find(
    (m) => m.slug === normalizeSlug(clean) || m.id === clean
  );
  if (!target) return false;
  customModulesDb.modules = customModulesDb.modules.filter((m) => m.id !== target.id);
  if (target.slug === 'pinoy') {
    customModulesDb.pinoyDeleted = true;
  }
  saveCustomModules();

  // Remove linked menu entry if present
  const nextItems = navigationState.items.filter(
    (item) =>
      item.customModuleSlug !== target.slug &&
      item.path !== `/c/${target.slug}` &&
      !(target.slug === 'pinoy' && (item.path === '/pinoy' || item.systemKey === 'pinoy'))
  );
  if (nextItems.length !== navigationState.items.length) {
    navigationState = {
      items: nextItems,
      updatedAt: new Date().toISOString(),
      communityNavSeeded: true,
    };
    writeModuleSnapshot('navigation', navigationState);
  }

  return true;
}

export function syncNavigationLinkForCustomModule(
  mod: CustomApiModuleConfig,
  surfaces: { desktop: boolean; mobile: boolean; footer: boolean }
): void {
  const isPinoy = mod.slug === 'pinoy';
  const targetPath = isPinoy ? '/pinoy' : `/c/${mod.slug}`;
  const current = [...navigationState.items];
  const idx = current.findIndex(
    (item) =>
      item.customModuleSlug === mod.slug ||
      item.path === targetPath ||
      (isPinoy && (item.path === '/pinoy' || item.systemKey === 'pinoy'))
  );

  if (idx >= 0) {
    current[idx] = {
      ...current[idx],
      label: mod.name,
      path: targetPath,
      icon: mod.icon,
      enabled: mod.enabled,
      customModuleSlug: mod.slug,
      ...(isPinoy ? { systemKey: 'pinoy' } : {}),
    };
  } else {
    const maxOrder = current.reduce((max, item) => Math.max(max, item.order), 40);
    current.push({
      id: isPinoy ? 'nav_pinoy' : `nav_mod_${mod.slug}`,
      label: mod.name,
      path: targetPath,
      icon: mod.icon,
      exact: false,
      enabled: mod.enabled,
      desktop: surfaces.desktop,
      mobile: surfaces.mobile,
      footer: surfaces.footer,
      order: isPinoy ? 40 : Math.min(85, maxOrder + 5),
      authRule: 'all',
      customModuleSlug: mod.slug,
      ...(isPinoy ? { systemKey: 'pinoy' } : {}),
    });
  }
  current.sort((a, b) => a.order - b.order);
  navigationState = {
    items: current,
    updatedAt: new Date().toISOString(),
    communityNavSeeded: true,
  };
  writeModuleSnapshot('navigation', navigationState);
}

export function validateCustomModuleDraft(
  payload: unknown
): { ok: true; module: CustomApiModuleConfig } | { ok: false; error: string } {
  return sanitizeCustomModule(payload, null);
}
