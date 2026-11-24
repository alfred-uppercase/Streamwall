import type {
  CustomApiDetailResponse,
  CustomApiFacetsResponse,
  CustomApiItem,
  CustomApiListResponse,
  CustomApiModuleConfig,
  CustomApiTestReport,
  PinoyPlayerSource,
} from '../shared/types.ts';
import { InFlightCoalescer, TimedLruCache } from './cacheUtils.ts';
import { toPublicCustomModule } from './customModulesStore.ts';
import {
  embedToDirectDownloadUrl,
  isDirectDownloadUrl,
  resolvePinoyMediaUrl,
  sanitizeExternalHttpUrl,
  validatePinoyApiUrl,
  validatePinoyPlayerTemplate,
} from './pinoyService.ts';

const customCache = new TimedLruCache<unknown>(300);
const customCoalescer = new InFlightCoalescer();

const FACETS_TTL_MS = 10 * 60_000;
const FACETS_STALE_MS = 60 * 60_000;
const LIST_TTL_MS = 2 * 60_000;
const LIST_STALE_MS = 15 * 60_000;
const DETAIL_TTL_MS = 5 * 60_000;
const DETAIL_STALE_MS = 30 * 60_000;

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function clearCustomApiCache(slug?: string): void {
  if (!slug) {
    customCache.clear();
    return;
  }
  // TimedLruCache is fast and tiny; clearing all guarantees fresh reads right after admin edits
  customCache.clear();
}

export function getByPath(root: unknown, pathStr: string): unknown {
  if (root === null || root === undefined) return undefined;
  const trimmed = String(pathStr ?? '').trim();
  if (!trimmed) return root;
  const parts = trimmed.split('.').filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (FORBIDDEN_SEGMENTS.has(part)) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
      continue;
    }
    if (typeof cur === 'object' && cur !== null) {
      if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
      cur = (cur as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return cur;
}

export function resolveCustomPlayerUrl(
  template: string,
  item: Pick<CustomApiItem, 'id' | 'slug' | 'routeKey'>
): string | null {
  const validation = validatePinoyPlayerTemplate(template);
  if (!validation.ok || !validation.template) return null;

  let resolved: string;
  if (/\{id\}|\{slug\}/i.test(validation.template)) {
    resolved = validation.template
      .replace(/\{id\}/gi, encodeURIComponent(item.id))
      .replace(/\{slug\}/gi, encodeURIComponent(item.slug || item.routeKey));
  } else {
    const qIdx = validation.template.indexOf('?');
    const basePart = qIdx >= 0 ? validation.template.slice(0, qIdx) : validation.template;
    const queryPart = qIdx >= 0 ? validation.template.slice(qIdx) : '';
    resolved = `${basePart.replace(/\/+$/, '')}/${encodeURIComponent(item.id || item.routeKey)}${queryPart}`;
  }
  return sanitizeExternalHttpUrl(resolved);
}

export function normalizeCustomItem(
  raw: unknown,
  mod: CustomApiModuleConfig
): CustomApiItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = mod.fields;
  const mediaBase = mod.endpoints.mediaBaseUrl;
  const apiUrl = mod.endpoints.apiUrl;

  const idRaw = getByPath(raw, f.itemIdField);
  const slugRaw = getByPath(raw, f.itemSlugField);
  const titleRaw = getByPath(raw, f.itemTitleField);

  const id = idRaw !== undefined && idRaw !== null ? String(idRaw).trim() : '';
  const slug = typeof slugRaw === 'string' ? slugRaw.trim() : '';
  const titre = typeof titleRaw === 'string' ? titleRaw.trim() : '';

  const routeKey = slug || id;
  if (!routeKey || !titre) return null;

  const origRaw = getByPath(raw, f.itemOriginalTitleField);
  const yearRaw = getByPath(raw, f.itemYearField);
  const releaseRaw = getByPath(raw, f.itemReleaseDateField);
  const countryRaw = getByPath(raw, f.itemCountryField);
  const durationRaw = getByPath(raw, f.itemDurationField);
  const ratingRaw = getByPath(raw, f.itemRatingField);
  const genresRaw = getByPath(raw, f.itemGenresField);
  const synopsisRaw = getByPath(raw, f.itemSynopsisField);
  const posterRaw = getByPath(raw, f.itemPosterField);
  const galleryRaw = getByPath(raw, f.itemGalleryField);

  let genres: string[] = [];
  if (Array.isArray(genresRaw)) {
    genres = genresRaw
      .map((g) => (typeof g === 'string' ? g.trim() : g && typeof g === 'object' ? String((g as Record<string, unknown>).nom ?? (g as Record<string, unknown>).name ?? '').trim() : ''))
      .filter(Boolean)
      .slice(0, 12);
  } else if (typeof genresRaw === 'string') {
    genres = genresRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  let galerie: string[] = [];
  if (Array.isArray(galleryRaw)) {
    galerie = galleryRaw
      .map((u) => resolvePinoyMediaUrl(u, mediaBase, apiUrl))
      .filter((u): u is string => Boolean(u))
      .slice(0, 24);
  }

  const yearNum = yearRaw !== undefined && yearRaw !== null ? Number(yearRaw) : NaN;
  const noteNum = ratingRaw !== undefined && ratingRaw !== null ? Number(ratingRaw) : NaN;

  return {
    id: id || routeKey,
    slug: slug || routeKey,
    routeKey,
    titre,
    titre_original:
      typeof origRaw === 'string' && origRaw.trim() ? origRaw.trim() : null,
    annee: Number.isFinite(yearNum) && yearNum > 1800 ? Math.trunc(yearNum) : null,
    date_sortie:
      typeof releaseRaw === 'string' && releaseRaw.trim() ? releaseRaw.trim() : null,
    pays:
      typeof countryRaw === 'string' && countryRaw.trim()
        ? countryRaw.trim().slice(0, 24)
        : null,
    duree:
      typeof durationRaw === 'string' && durationRaw.trim()
        ? durationRaw.trim().slice(0, 40)
        : typeof durationRaw === 'number' && durationRaw > 0
          ? `${durationRaw} min`
          : null,
    note: Number.isFinite(noteNum) && noteNum >= 0 ? Math.round(noteNum * 10) / 10 : null,
    genres,
    synopsis:
      typeof synopsisRaw === 'string' && synopsisRaw.trim() ? synopsisRaw.trim() : null,
    poster: resolvePinoyMediaUrl(posterRaw, mediaBase, apiUrl),
    galerie,
  };
}

function normalizeCustomPlayerSource(
  raw: unknown,
  mod: CustomApiModuleConfig
): PinoyPlayerSource | null {
  if (typeof raw === 'string') {
    const url = sanitizeExternalHttpUrl(raw);
    return url ? { provider: 'Serveur', url, quality: null, language: null } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const f = mod.fields;
  const url = sanitizeExternalHttpUrl(getByPath(raw, f.playerUrlField));
  if (!url) return null;
  const provRaw = getByPath(raw, f.playerProviderField);
  const qualRaw = getByPath(raw, f.playerQualityField);
  const langRaw = getByPath(raw, f.playerLanguageField);

  const provider =
    typeof provRaw === 'string' && provRaw.trim() ? provRaw.trim().slice(0, 64) : 'Serveur';
  const quality =
    typeof qualRaw === 'string' && qualRaw.trim() ? qualRaw.trim().slice(0, 32) : null;
  const language =
    typeof langRaw === 'string' && langRaw.trim() ? langRaw.trim().slice(0, 32) : null;
  return { provider, url, quality, language };
}

function buildCustomEndpointUrl(
  baseUrl: string,
  params: Record<string, string | number | undefined>
): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (key && value !== undefined && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fetchJsonFromCustomApi(targetUrl: string): Promise<unknown> {
  const res = await fetch(targetUrl, {
    signal: AbortSignal.timeout(8_500),
    headers: {
      accept: 'application/json',
      'user-agent': 'StreamWall-Proxy/1.0',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object') {
    throw new Error('Réponse JSON invalide');
  }
  const obj = data as Record<string, unknown>;
  if (obj.status === 'error') {
    throw new Error(typeof obj.message === 'string' ? obj.message : 'Erreur API distante');
  }
  return data;
}

export async function fetchCustomFacets(
  mod: CustomApiModuleConfig
): Promise<CustomApiFacetsResponse> {
  const validation = validatePinoyApiUrl(mod.endpoints.apiUrl);
  if (!validation.ok || !validation.url) {
    return {
      status: 'unconfigured',
      genres: [],
      pays: [],
      annees: { min: null, max: null },
    };
  }

  const cacheKey = `custom:facets:${mod.slug}:${mod.updatedAt}`;
  const fresh = customCache.get(cacheKey) as CustomApiFacetsResponse | null;
  if (fresh) return fresh;

  return customCoalescer.run(cacheKey, async () => {
    const recheck = customCache.get(cacheKey) as CustomApiFacetsResponse | null;
    if (recheck) return recheck;

    try {
      const params: Record<string, string | number | undefined> = {};
      if (mod.endpoints.actionParam && mod.endpoints.facetsAction) {
        params[mod.endpoints.actionParam] = mod.endpoints.facetsAction;
      }
      const target = buildCustomEndpointUrl(validation.url, params);
      const json = await fetchJsonFromCustomApi(target);

      const rawGenres = getByPath(json, mod.fields.facetsGenresPath);
      const genres = (Array.isArray(rawGenres) ? rawGenres : [])
        .map((g) => {
          if (typeof g === 'string') return g.trim() ? { nom: g.trim(), total: 0 } : null;
          if (!g || typeof g !== 'object') return null;
          const rec = g as Record<string, unknown>;
          const nom = String(rec.nom ?? rec.name ?? rec.label ?? '').trim();
          const total = Number(rec.total ?? rec.count) || 0;
          return nom ? { nom, total } : null;
        })
        .filter((x): x is { nom: string; total: number } => Boolean(x));

      const rawPays = getByPath(json, mod.fields.facetsCountriesPath);
      const pays = (Array.isArray(rawPays) ? rawPays : [])
        .map((p) => {
          if (typeof p === 'string') return p.trim() ? { code: p.trim(), total: 0 } : null;
          if (!p || typeof p !== 'object') return null;
          const rec = p as Record<string, unknown>;
          const code = String(rec.code ?? rec.nom ?? rec.name ?? '').trim();
          const total = Number(rec.total ?? rec.count) || 0;
          return code ? { code, total } : null;
        })
        .filter((x): x is { code: string; total: number } => Boolean(x));

      const minY = Number(getByPath(json, mod.fields.facetsYearMinPath));
      const maxY = Number(getByPath(json, mod.fields.facetsYearMaxPath));

      const payload: CustomApiFacetsResponse = {
        status: 'live',
        genres,
        pays,
        annees: {
          min: Number.isFinite(minY) && minY > 1800 ? Math.trunc(minY) : null,
          max: Number.isFinite(maxY) && maxY > 1800 ? Math.trunc(maxY) : null,
        },
      };
      customCache.set(cacheKey, payload, FACETS_TTL_MS, FACETS_STALE_MS);
      return payload;
    } catch {
      const stale = customCache.getStale(cacheKey) as CustomApiFacetsResponse | null;
      if (stale) return { ...stale, status: 'fallback' };
      return {
        status: 'fallback',
        genres: [],
        pays: [],
        annees: { min: null, max: null },
      };
    }
  });
}

export interface CustomListFilters {
  q: string;
  genre: string;
  pays: string;
  annee: string;
  sort: string;
  page: number;
}

export async function fetchCustomList(
  mod: CustomApiModuleConfig,
  filters: CustomListFilters
): Promise<CustomApiListResponse> {
  const pubMod = toPublicCustomModule(mod);
  const validation = validatePinoyApiUrl(mod.endpoints.apiUrl);
  if (!validation.ok || !validation.url) {
    return {
      status: 'unconfigured',
      module: pubMod,
      page: 1,
      per_page: mod.endpoints.perPage,
      total: 0,
      total_pages: 0,
      items: [],
    };
  }

  const normalizedKey = JSON.stringify({
    slug: mod.slug,
    upd: mod.updatedAt,
    ...filters,
  });
  const cacheKey = `custom:list:${normalizedKey}`;
  const fresh = customCache.get(cacheKey) as CustomApiListResponse | null;
  if (fresh) return fresh;

  return customCoalescer.run(cacheKey, async () => {
    const recheck = customCache.get(cacheKey) as CustomApiListResponse | null;
    if (recheck) return recheck;

    try {
      const ep = mod.endpoints;
      const params: Record<string, string | number | undefined> = {};
      if (ep.actionParam && ep.listAction) params[ep.actionParam] = ep.listAction;
      if (ep.pageParam) params[ep.pageParam] = filters.page;
      if (ep.perPageParam) params[ep.perPageParam] = ep.perPage;
      if (ep.queryParam && filters.q) params[ep.queryParam] = filters.q;
      if (ep.genreParam && filters.genre) params[ep.genreParam] = filters.genre;
      if (ep.countryParam && filters.pays) params[ep.countryParam] = filters.pays;
      if (ep.yearParam && filters.annee) params[ep.yearParam] = filters.annee;
      if (ep.sortParam && filters.sort) params[ep.sortParam] = filters.sort;

      const target = buildCustomEndpointUrl(validation.url, params);
      const json = await fetchJsonFromCustomApi(target);

      const rawItems = getByPath(json, mod.fields.listItemsPath);
      const listArr = Array.isArray(rawItems) ? rawItems : Array.isArray(json) ? json : [];
      const items = listArr
        .map((it) => normalizeCustomItem(it, mod))
        .filter((x): x is CustomApiItem => Boolean(x));

      const pageNum = Math.max(
        1,
        Number(getByPath(json, mod.fields.listPagePath)) || filters.page
      );
      const totalNum = Math.max(
        items.length,
        Number(getByPath(json, mod.fields.listTotalPath)) || items.length
      );
      const totalPagesNum = Math.max(
        items.length > 0 ? 1 : 0,
        Number(getByPath(json, mod.fields.listTotalPagesPath)) ||
          Math.ceil(totalNum / Math.max(1, ep.perPage))
      );

      const payload: CustomApiListResponse = {
        status: 'live',
        module: pubMod,
        page: pageNum,
        per_page: ep.perPage,
        total: totalNum,
        total_pages: totalPagesNum,
        items,
      };
      customCache.set(cacheKey, payload, LIST_TTL_MS, LIST_STALE_MS);
      return payload;
    } catch (err) {
      const stale = customCache.getStale(cacheKey) as CustomApiListResponse | null;
      if (stale) return { ...stale, status: 'fallback' };
      return {
        status: 'fallback',
        module: pubMod,
        page: filters.page,
        per_page: mod.endpoints.perPage,
        total: 0,
        total_pages: 0,
        items: [],
        error: err instanceof Error ? err.message : `API ${mod.name} indisponible`,
      };
    }
  });
}

export async function fetchCustomDetail(
  mod: CustomApiModuleConfig,
  itemKey: string
): Promise<CustomApiDetailResponse> {
  const pubMod = toPublicCustomModule(mod);
  const validation = validatePinoyApiUrl(mod.endpoints.apiUrl);
  if (!validation.ok || !validation.url) {
    return {
      status: 'unconfigured',
      module: pubMod,
      item: null,
      players: { embed: [], download: [] },
      similar: [],
    };
  }

  const cleanKey = itemKey.trim().slice(0, 200);
  if (!cleanKey) {
    return {
      status: 'fallback',
      module: pubMod,
      item: null,
      players: { embed: [], download: [] },
      similar: [],
      error: 'Identifiant manquant',
    };
  }

  const cacheKey = `custom:detail:${mod.slug}:${mod.updatedAt}:${cleanKey}`;
  const fresh = customCache.get(cacheKey) as CustomApiDetailResponse | null;
  if (fresh) return fresh;

  return customCoalescer.run(cacheKey, async () => {
    const recheck = customCache.get(cacheKey) as CustomApiDetailResponse | null;
    if (recheck) return recheck;

    try {
      const ep = mod.endpoints;
      const params: Record<string, string | number | undefined> = {};
      if (ep.actionParam && ep.detailAction) params[ep.actionParam] = ep.detailAction;
      if (ep.detailKeyParam) params[ep.detailKeyParam] = cleanKey;
      if (ep.similarLimitParam && ep.similarLimit > 0) {
        params[ep.similarLimitParam] = ep.similarLimit;
      }

      const target = buildCustomEndpointUrl(validation.url, params);
      const json = await fetchJsonFromCustomApi(target);

      const rawItem = getByPath(json, mod.fields.detailItemPath) ?? json;
      const item = normalizeCustomItem(rawItem, mod);

      const rawEmbed = getByPath(json, mod.fields.detailEmbedsPath);
      const upstreamEmbed = (Array.isArray(rawEmbed) ? rawEmbed : [])
        .map((p) => normalizeCustomPlayerSource(p, mod))
        .filter((x): x is PinoyPlayerSource => Boolean(x));

      const templateUrl =
        item && mod.player.playerUrlTemplate
          ? resolveCustomPlayerUrl(mod.player.playerUrlTemplate, item)
          : null;

      const embed: PinoyPlayerSource[] = [];
      const seenEmbed = new Set<string>();
      if (templateUrl && item) {
        const effectiveUrl = mod.player.useSameOriginProxy
          ? `/api/public/watch/custom/${encodeURIComponent(mod.slug)}/${encodeURIComponent(item.id)}/${encodeURIComponent(item.slug)}`
          : templateUrl;
        embed.push({
          provider: mod.player.primaryPlayerLabel || 'Lecteur principal',
          url: effectiveUrl,
          quality: 'HD',
          language: null,
        });
        seenEmbed.add(effectiveUrl);
      }
      if (mod.player.includeUpstreamEmbeds || !templateUrl) {
        for (const srv of upstreamEmbed) {
          if (!seenEmbed.has(srv.url)) {
            seenEmbed.add(srv.url);
            embed.push(srv);
          }
        }
      }

      const rawDownloads = getByPath(json, mod.fields.detailDownloadsPath);
      const rawDlList = (Array.isArray(rawDownloads) ? rawDownloads : [])
        .map((p) => normalizeCustomPlayerSource(p, mod))
        .filter((x): x is PinoyPlayerSource => Boolean(x));

      const download: PinoyPlayerSource[] = [];
      const seenDl = new Set<string>();

      for (const dl of rawDlList) {
        const finalUrl = mod.player.onlyDirectDownloads
          ? embedToDirectDownloadUrl(dl.url, dl.provider) ??
            (isDirectDownloadUrl(dl.url) ? dl.url : null)
          : dl.url;
        if (finalUrl && !seenDl.has(finalUrl)) {
          seenDl.add(finalUrl);
          download.push({ ...dl, url: finalUrl });
        }
      }
      if (mod.player.onlyDirectDownloads) {
        for (const srv of upstreamEmbed) {
          const directUrl = embedToDirectDownloadUrl(srv.url, srv.provider);
          if (directUrl && !seenDl.has(directUrl)) {
            seenDl.add(directUrl);
            download.push({
              provider: srv.provider,
              url: directUrl,
              quality: srv.quality,
              language: srv.language,
            });
          }
        }
      }

      const rawSimilar = getByPath(json, mod.fields.detailSimilarPath);
      const similar = (Array.isArray(rawSimilar) ? rawSimilar : [])
        .map((s) => normalizeCustomItem(s, mod))
        .filter((x): x is CustomApiItem => Boolean(x));

      const payload: CustomApiDetailResponse = {
        status: 'live',
        module: pubMod,
        item,
        players: { embed, download },
        similar,
      };
      customCache.set(cacheKey, payload, DETAIL_TTL_MS, DETAIL_STALE_MS);
      return payload;
    } catch (err) {
      const stale = customCache.getStale(cacheKey) as CustomApiDetailResponse | null;
      if (stale) return { ...stale, status: 'fallback' };
      return {
        status: 'fallback',
        module: pubMod,
        item: null,
        players: { embed: [], download: [] },
        similar: [],
        error: err instanceof Error ? err.message : 'Contenu introuvable',
      };
    }
  });
}

export async function testCustomModuleConfig(
  mod: CustomApiModuleConfig
): Promise<CustomApiTestReport> {
  const start = Date.now();
  const validation = validatePinoyApiUrl(mod.endpoints.apiUrl);
  if (!validation.ok || !validation.url) {
    return {
      ok: false,
      facetsOk: false,
      listOk: false,
      detailOk: false,
      facetsCount: { genres: 0, countries: 0 },
      listCount: 0,
      totalItems: 0,
      sampleItem: null,
      sampleEmbedCount: 0,
      sampleDownloadCount: 0,
      latencyMs: Date.now() - start,
      message: validation.ok ? 'Renseignez une URL API pour tester.' : validation.error,
    };
  }

  customCache.clear();
  const [facetsRes, listRes] = await Promise.all([
    fetchCustomFacets(mod),
    fetchCustomList(mod, {
      q: '',
      genre: '',
      pays: '',
      annee: '',
      sort: mod.filters.defaultSort,
      page: 1,
    }),
  ]);

  const facetsOk = facetsRes.status === 'live';
  const listOk = listRes.status === 'live';
  const first = listRes.items[0] ?? null;

  let detailOk = false;
  let sampleEmbedCount = 0;
  let sampleDownloadCount = 0;
  let sampleItem: CustomApiItem | null = first;

  if (first) {
    const detRes = await fetchCustomDetail(mod, first.routeKey);
    detailOk = detRes.status === 'live' && Boolean(detRes.item);
    sampleEmbedCount = detRes.players.embed.length;
    sampleDownloadCount = detRes.players.download.length;
    if (detRes.item) sampleItem = detRes.item;
  }

  const ok = listOk && (first ? detailOk : true);
  return {
    ok,
    facetsOk,
    listOk,
    detailOk,
    facetsCount: {
      genres: facetsRes.genres.length,
      countries: facetsRes.pays.length,
    },
    listCount: listRes.items.length,
    totalItems: listRes.total,
    sampleItem,
    sampleEmbedCount,
    sampleDownloadCount,
    latencyMs: Date.now() - start,
    message: ok
      ? `Connexion réussie (${listRes.items.length} élément(s) lus, total ${listRes.total}).`
      : listRes.error || 'Échec du test de lecture API.',
  };
}
