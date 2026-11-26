import type {
  CustomApiModuleConfig,
  PinoyDetailResponse,
  PinoyFacetsResponse,
  PinoyFilm,
  PinoyListFilters,
  PinoyListResponse,
  PinoyPlayerSource,
} from '../shared/types.ts';
import { InFlightCoalescer, TimedLruCache } from './cacheUtils.ts';

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function getFieldByPath(root: unknown, pathStr: string): unknown {
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

const pinoyCache = new TimedLruCache<unknown>(250);
const pinoyCoalescer = new InFlightCoalescer();

const FACETS_TTL_MS = 10 * 60_000;
const FACETS_STALE_MS = 60 * 60_000;
const LIST_TTL_MS = 2 * 60_000;
const LIST_STALE_MS = 15 * 60_000;
const DETAIL_TTL_MS = 5 * 60_000;
const DETAIL_STALE_MS = 30 * 60_000;

export const DEFAULT_PINOY_MEDIA_BASE_URL = 'https://streamwall.behoririka.mg/';
export const DEFAULT_PINOY_PLAYER_TEMPLATE = 'https://streamwall.behoririka.mg/pinoy/{id}';
export const DEFAULT_PINOY_DOWNLOAD_MESSAGE =
  'Le téléchargement direct est réservé aux membres Pro et aux administrateurs.';

export function sanitizePinoyDownloadMessage(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PINOY_DOWNLOAD_MESSAGE;
  const cleaned = raw
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 500);
  return cleaned || DEFAULT_PINOY_DOWNLOAD_MESSAGE;
}

export function clearPinoyCache(): void {
  pinoyCache.clear();
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '::' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.arpa')
  ) {
    return true;
  }

  // IPv4 literal check
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  // IPv6 ULA / link-local / mapped IPv4
  if (h.includes(':')) {
    if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
    if (h.startsWith('::ffff:')) {
      const mapped = h.slice('::ffff:'.length);
      return isPrivateOrLoopbackHost(mapped);
    }
  }

  return false;
}

export function validatePinoyApiUrl(
  raw: string
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { ok: true, url: '' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'URL invalide. Exemple : https://monsite.com/korotoko_ph.php' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Seuls les protocoles HTTP et HTTPS sont autorisés.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Les identifiants dans l’URL ne sont pas autorisés.' };
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return { ok: false, error: 'Les adresses locales ou privées ne sont pas autorisées.' };
  }
  parsed.hash = '';
  return { ok: true, url: parsed.toString() };
}

export function validatePinoyMediaBaseUrl(
  raw: string
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { ok: true, url: '' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Domaine média invalide. Exemple : https://streamwall.behoririka.mg/' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Seuls les protocoles HTTP et HTTPS sont autorisés.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Les identifiants dans l’URL ne sont pas autorisés.' };
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return { ok: false, error: 'Les adresses locales ou privées ne sont pas autorisées.' };
  }
  parsed.hash = '';
  parsed.search = '';
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return { ok: true, url: parsed.toString() };
}

export function validatePinoyPlayerTemplate(
  raw: string
): { ok: true; template: string } | { ok: false; error: string } {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { ok: true, template: '' };
  }
  const sample = trimmed
    .replace(/\{id\}/gi, '15')
    .replace(/\{slug\}/gi, 'sample-film');
  let parsed: URL;
  try {
    parsed = new URL(sample);
  } catch {
    return {
      ok: false,
      error: 'URL du player Pinoy invalide. Exemple : https://streamwall.behoririka.mg/pinoy/{id}',
    };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Seuls les protocoles HTTP et HTTPS sont autorisés.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Les identifiants dans l’URL ne sont pas autorisés.' };
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return { ok: false, error: 'Les adresses locales ou privées ne sont pas autorisées.' };
  }
  const hashIdx = trimmed.indexOf('#');
  const cleanTemplate = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  return { ok: true, template: cleanTemplate };
}

export function resolvePinoyPlayerUrl(
  template: string,
  film: Pick<PinoyFilm, 'id' | 'slug'>
): string | null {
  const validation = validatePinoyPlayerTemplate(template);
  if (!validation.ok || !validation.template) return null;

  let resolved: string;
  if (/\{id\}|\{slug\}/i.test(validation.template)) {
    resolved = validation.template
      .replace(/\{id\}/gi, String(film.id))
      .replace(/\{slug\}/gi, encodeURIComponent(film.slug));
  } else {
    const qIdx = validation.template.indexOf('?');
    const basePart = qIdx >= 0 ? validation.template.slice(0, qIdx) : validation.template;
    const queryPart = qIdx >= 0 ? validation.template.slice(qIdx) : '';
    resolved = `${basePart.replace(/\/+$/, '')}/${film.id}${queryPart}`;
  }
  return sanitizeExternalHttpUrl(resolved);
}

export function embedToDirectDownloadUrl(rawUrl: string, provider = ''): string | null {
  const safe = sanitizeExternalHttpUrl(rawUrl);
  if (!safe) return null;

  let parsed: URL;
  try {
    parsed = new URL(safe);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  const prov = provider.toLowerCase();

  // VOE: https://voe.sx/e/3od2eqbnmolo -> https://voe.sx/3od2eqbnmolo/download
  const voeMatch = path.match(/^\/(?:e|embed)\/([A-Za-z0-9_-]+)\/?$/i);
  if (voeMatch && (host === 'voe.sx' || host.endsWith('.voe.sx') || /\bvoe\b/.test(host) || /\bvoe\b/.test(prov))) {
    return `${parsed.origin}/${voeMatch[1]}/download`;
  }

  // StreamHLS: https://streamhls.to/e/1ghcfvwm4xlk -> https://savefiles.com/d/1ghcfvwm4xlk_n
  const streamHlsMatch = path.match(/^\/(?:e|embed|v)\/([A-Za-z0-9_-]+)\/?$/i);
  if (streamHlsMatch && (host.includes('streamhls') || prov.includes('streamhls'))) {
    const code = streamHlsMatch[1].endsWith('_n') ? streamHlsMatch[1] : `${streamHlsMatch[1]}_n`;
    return `https://savefiles.com/d/${code}`;
  }

  // Dood / Playmogo: https://playmogo.com/e/46l0enjz7f65 -> https://playmogo.com/d/46l0enjz7f65
  const doodMatch = path.match(/^\/(?:e|embed)\/([A-Za-z0-9_-]+)\/?$/i);
  if (
    doodMatch &&
    (host.includes('playmogo') ||
      host.includes('dood') ||
      host.includes('d000') ||
      host.includes('do0od') ||
      host.includes('ds2play') ||
      prov.includes('dood') ||
      prov.includes('playmogo'))
  ) {
    return `${parsed.origin}/d/${doodMatch[1]}`;
  }

  // Abstream: https://abstream.to/embed/5q3v8q1q23zr -> https://abstream.to/d/5q3v8q1q23zr
  const abstreamMatch = path.match(/^\/(?:embed|e)\/([A-Za-z0-9_-]+)\/?$/i);
  if (abstreamMatch && (host.includes('abstream') || prov.includes('abstream'))) {
    return `${parsed.origin}/d/${abstreamMatch[1]}`;
  }

  return null;
}

export function isDirectDownloadUrl(rawUrl: string): boolean {
  const safe = sanitizeExternalHttpUrl(rawUrl);
  if (!safe) return false;
  let parsed: URL;
  try {
    parsed = new URL(safe);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  if ((host === 'voe.sx' || host.endsWith('.voe.sx') || /\bvoe\b/.test(host)) && /^\/[A-Za-z0-9_-]+\/download\/?$/i.test(path)) {
    return true;
  }
  if (host.includes('savefiles') && /^\/d\/[A-Za-z0-9_-]+\/?$/i.test(path)) {
    return true;
  }
  if (
    (host.includes('playmogo') ||
      host.includes('dood') ||
      host.includes('d000') ||
      host.includes('do0od') ||
      host.includes('ds2play')) &&
    /^\/d\/[A-Za-z0-9_-]+\/?$/i.test(path)
  ) {
    return true;
  }
  if (host.includes('abstream') && /^\/d\/[A-Za-z0-9_-]+\/?$/i.test(path)) {
    return true;
  }
  return false;
}

export function sanitizeExternalHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getApiDirBase(apiUrl: string): { dirBase: string | null; origin: string | null } {
  const validation = validatePinoyApiUrl(apiUrl);
  if (!validation.ok || !validation.url) {
    return { dirBase: null, origin: null };
  }
  try {
    const parsed = new URL(validation.url);
    return {
      dirBase: new URL('./', parsed).toString(),
      origin: parsed.origin,
    };
  } catch {
    return { dirBase: null, origin: null };
  }
}

export function resolvePinoyMediaUrl(
  raw: unknown,
  mediaBaseUrl = DEFAULT_PINOY_MEDIA_BASE_URL,
  apiUrl = ''
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Reject control characters and path traversal
  if (/[\x00-\x1f\x7f]/.test(trimmed) || /(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) {
    return null;
  }

  const mediaValidation = validatePinoyMediaBaseUrl(mediaBaseUrl);
  const { dirBase: apiDirBase, origin: apiOrigin } = getApiDirBase(apiUrl);
  const effectiveBase =
    (mediaValidation.ok && mediaValidation.url ? mediaValidation.url : null) ?? apiDirBase;

  if (trimmed.startsWith('//')) {
    return sanitizeExternalHttpUrl(`https:${trimmed}`);
  }

  // Relative path such as "uploads/pinoy/posters/milf-2026.jpg" or "/uploads/..."
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (!effectiveBase) return null;
    try {
      const cleanRel = trimmed.replace(/^\/+/, '');
      const resolved = new URL(cleanRel, effectiveBase);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
      return resolved.toString();
    } catch {
      return null;
    }
  }

  const safeAbs = sanitizeExternalHttpUrl(trimmed);
  if (!safeAbs) return null;

  // Rewrite API-generated local upload URLs onto the configured media domain when applicable
  if (mediaValidation.ok && mediaValidation.url) {
    try {
      const parsed = new URL(safeAbs);
      if (apiDirBase && safeAbs.startsWith(apiDirBase)) {
        const rel = safeAbs.slice(apiDirBase.length).replace(/^\/+/, '');
        return new URL(rel, mediaValidation.url).toString();
      }
      if (apiOrigin && parsed.origin === apiOrigin && parsed.pathname.startsWith('/uploads/')) {
        const rel = `${parsed.pathname.replace(/^\/+/, '')}${parsed.search}`;
        return new URL(rel, mediaValidation.url).toString();
      }
    } catch {
      return safeAbs;
    }
  }

  return safeAbs;
}

function normalizeFilm(
  raw: unknown,
  mediaBaseUrl = DEFAULT_PINOY_MEDIA_BASE_URL,
  apiUrl = '',
  mod?: CustomApiModuleConfig | null
): PinoyFilm | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const f = mod?.fields;

  const rawId = getFieldByPath(r, f?.itemIdField || 'id');
  const id = Number(rawId);
  const rawTitle = getFieldByPath(r, f?.itemTitleField || 'titre');
  const titre = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const rawSlug = getFieldByPath(r, f?.itemSlugField || 'slug');
  const slug = typeof rawSlug === 'string' ? rawSlug.trim() : '';
  if (!Number.isFinite(id) || id <= 0 || !titre || !slug) return null;

  const rawGenresVal = getFieldByPath(r, f?.itemGenresField || 'genres');
  let genres: string[] = [];
  if (Array.isArray(rawGenresVal)) {
    genres = rawGenresVal
      .map((g) =>
        typeof g === 'string'
          ? g.trim()
          : g && typeof g === 'object'
            ? String((g as Record<string, unknown>).nom ?? (g as Record<string, unknown>).name ?? '').trim()
            : ''
      )
      .filter(Boolean)
      .slice(0, 12);
  } else if (typeof rawGenresVal === 'string') {
    genres = rawGenresVal
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  const rawGalerieVal = getFieldByPath(r, f?.itemGalleryField || 'galerie');
  const rawGalerie = Array.isArray(rawGalerieVal) ? rawGalerieVal : [];
  const galerie = rawGalerie
    .map((u) => resolvePinoyMediaUrl(u, mediaBaseUrl, apiUrl))
    .filter((u): u is string => Boolean(u))
    .slice(0, 24);

  const rawYear = getFieldByPath(r, f?.itemYearField || 'annee');
  const rawNote = getFieldByPath(r, f?.itemRatingField || 'note');
  const anneeNum = rawYear !== null && rawYear !== undefined ? Number(rawYear) : NaN;
  const noteNum = rawNote !== null && rawNote !== undefined ? Number(rawNote) : NaN;

  const rawOrig = getFieldByPath(r, f?.itemOriginalTitleField || 'titre_original');
  const rawRelease = getFieldByPath(r, f?.itemReleaseDateField || 'date_sortie');
  const rawCountry = getFieldByPath(r, f?.itemCountryField || 'pays');
  const rawDuration = getFieldByPath(r, f?.itemDurationField || 'duree');
  const rawSynopsis = getFieldByPath(r, f?.itemSynopsisField || 'synopsis');
  const rawPoster = getFieldByPath(r, f?.itemPosterField || 'poster');

  return {
    id,
    titre,
    titre_original: typeof rawOrig === 'string' && rawOrig.trim() ? rawOrig.trim() : null,
    slug,
    url_source: sanitizeExternalHttpUrl(r.url_source),
    annee: Number.isFinite(anneeNum) && anneeNum > 1800 ? Math.trunc(anneeNum) : null,
    date_sortie: typeof rawRelease === 'string' && rawRelease.trim() ? rawRelease.trim() : null,
    sortie_le: typeof r.sortie_le === 'string' && r.sortie_le.trim() ? r.sortie_le.trim() : null,
    pays: typeof rawCountry === 'string' && rawCountry.trim() ? rawCountry.trim().slice(0, 24) : null,
    duree:
      typeof rawDuration === 'string' && rawDuration.trim()
        ? rawDuration.trim().slice(0, 40)
        : typeof rawDuration === 'number' && rawDuration > 0
          ? `${rawDuration} min`
          : null,
    note: Number.isFinite(noteNum) && noteNum >= 0 ? Math.round(noteNum * 10) / 10 : null,
    genres,
    synopsis: typeof rawSynopsis === 'string' && rawSynopsis.trim() ? rawSynopsis.trim() : null,
    poster: resolvePinoyMediaUrl(rawPoster, mediaBaseUrl, apiUrl),
    galerie,
  };
}

function normalizePlayerSource(
  raw: unknown,
  mod?: CustomApiModuleConfig | null
): PinoyPlayerSource | null {
  if (typeof raw === 'string') {
    const url = sanitizeExternalHttpUrl(raw);
    return url ? { provider: 'Serveur', url, quality: null, language: null } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const f = mod?.fields;
  const url = sanitizeExternalHttpUrl(getFieldByPath(raw, f?.playerUrlField || 'url'));
  if (!url) return null;
  const provRaw = getFieldByPath(raw, f?.playerProviderField || 'provider');
  const qualRaw = getFieldByPath(raw, f?.playerQualityField || 'quality');
  const langRaw = getFieldByPath(raw, f?.playerLanguageField || 'language');
  const provider =
    typeof provRaw === 'string' && provRaw.trim() ? provRaw.trim().slice(0, 64) : 'Serveur';
  const quality =
    typeof qualRaw === 'string' && qualRaw.trim() ? qualRaw.trim().slice(0, 32) : null;
  const language =
    typeof langRaw === 'string' && langRaw.trim() ? langRaw.trim().slice(0, 32) : null;
  return { provider, url, quality, language };
}

function buildPinoyEndpointUrl(apiUrl: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(apiUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fetchJsonFromPinoy(targetUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(targetUrl, {
    signal: AbortSignal.timeout(8_000),
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
    throw new Error(typeof obj.message === 'string' ? obj.message : 'Erreur API Pinoy');
  }
  return obj;
}

export async function fetchPinoyFacets(
  apiUrl: string,
  mod?: CustomApiModuleConfig | null
): Promise<PinoyFacetsResponse> {
  const effectiveApiUrl = mod?.endpoints.apiUrl ?? apiUrl;
  const validation = validatePinoyApiUrl(effectiveApiUrl);
  if (!validation.ok || !validation.url) {
    return {
      status: 'unconfigured',
      genres: [],
      pays: [],
      annees: { min: null, max: null },
    };
  }

  const cacheKey = `pinoy:facets:${validation.url}:${mod?.updatedAt ?? ''}`;
  const fresh = pinoyCache.get(cacheKey) as PinoyFacetsResponse | null;
  if (fresh) return fresh;

  return pinoyCoalescer.run(cacheKey, async () => {
    const recheck = pinoyCache.get(cacheKey) as PinoyFacetsResponse | null;
    if (recheck) return recheck;

    try {
      const actionParam = mod?.endpoints.actionParam ?? 'action';
      const facetsAction = mod?.endpoints.facetsAction ?? 'facets';
      const params: Record<string, string | number | undefined> = {};
      if (actionParam && facetsAction) {
        params[actionParam] = facetsAction;
      }
      const target = buildPinoyEndpointUrl(validation.url, params);
      const json = await fetchJsonFromPinoy(target);

      const rawGenres = getFieldByPath(json, mod?.fields.facetsGenresPath || 'genres');
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

      const rawPays = getFieldByPath(json, mod?.fields.facetsCountriesPath || 'pays');
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

      const minY = Number(getFieldByPath(json, mod?.fields.facetsYearMinPath || 'annees.min'));
      const maxY = Number(getFieldByPath(json, mod?.fields.facetsYearMaxPath || 'annees.max'));

      const payload: PinoyFacetsResponse = {
        status: 'live',
        genres,
        pays,
        annees: {
          min: Number.isFinite(minY) && minY > 1800 ? Math.trunc(minY) : null,
          max: Number.isFinite(maxY) && maxY > 1800 ? Math.trunc(maxY) : null,
        },
      };
      pinoyCache.set(cacheKey, payload, FACETS_TTL_MS, FACETS_STALE_MS);
      return payload;
    } catch {
      const stale = pinoyCache.getStale(cacheKey) as PinoyFacetsResponse | null;
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

export async function fetchPinoyList(
  apiUrl: string,
  filters: PinoyListFilters,
  mediaBaseUrl = DEFAULT_PINOY_MEDIA_BASE_URL,
  mod?: CustomApiModuleConfig | null
): Promise<PinoyListResponse> {
  const effectiveApiUrl = mod?.endpoints.apiUrl ?? apiUrl;
  const effectiveMediaBase = mod ? mod.endpoints.mediaBaseUrl : mediaBaseUrl;
  const perPage = Math.max(6, Math.min(100, mod?.endpoints.perPage || 24));
  const validation = validatePinoyApiUrl(effectiveApiUrl);
  if (!validation.ok || !validation.url) {
    return {
      status: 'unconfigured',
      page: 1,
      per_page: perPage,
      total: 0,
      total_pages: 0,
      items: [],
    };
  }

  const normalizedKey = JSON.stringify({
    u: validation.url,
    m: effectiveMediaBase,
    upd: mod?.updatedAt ?? '',
    perPage,
    q: filters.q,
    genre: filters.genre,
    pays: filters.pays,
    annee: filters.annee,
    sort: filters.sort,
    page: filters.page,
  });
  const cacheKey = `pinoy:list:${normalizedKey}`;
  const fresh = pinoyCache.get(cacheKey) as PinoyListResponse | null;
  if (fresh) return fresh;

  return pinoyCoalescer.run(cacheKey, async () => {
    const recheck = pinoyCache.get(cacheKey) as PinoyListResponse | null;
    if (recheck) return recheck;

    try {
      const ep = mod?.endpoints;
      const actionParam = ep?.actionParam ?? 'action';
      const listAction = ep?.listAction ?? 'list';
      const pageParam = ep?.pageParam ?? 'page';
      const perPageParam = ep?.perPageParam ?? 'per_page';
      const queryParam = ep?.queryParam ?? 'q';
      const genreParam = ep?.genreParam ?? 'genre';
      const countryParam = ep?.countryParam ?? 'pays';
      const yearParam = ep?.yearParam ?? 'annee';
      const sortParam = ep?.sortParam ?? 'sort';

      const params: Record<string, string | number | undefined> = {};
      if (actionParam && listAction) params[actionParam] = listAction;
      if (pageParam) params[pageParam] = filters.page;
      if (perPageParam) params[perPageParam] = perPage;
      if (queryParam && filters.q) params[queryParam] = filters.q;
      if (genreParam && filters.genre) params[genreParam] = filters.genre;
      if (countryParam && filters.pays) params[countryParam] = filters.pays;
      if (yearParam && filters.annee) params[yearParam] = filters.annee;
      if (sortParam && filters.sort) params[sortParam] = filters.sort;

      const target = buildPinoyEndpointUrl(validation.url, params);
      const json = await fetchJsonFromPinoy(target);

      const rawItems = getFieldByPath(json, mod?.fields.listItemsPath || 'items');
      const listArr = Array.isArray(rawItems) ? rawItems : Array.isArray(json) ? json : [];
      const items = listArr
        .map((it) => normalizeFilm(it, effectiveMediaBase, validation.url, mod))
        .filter((x): x is PinoyFilm => Boolean(x));

      const pageNum = Math.max(
        1,
        Number(getFieldByPath(json, mod?.fields.listPagePath || 'page')) || filters.page
      );
      const totalNum = Math.max(
        0,
        Number(getFieldByPath(json, mod?.fields.listTotalPath || 'total')) || items.length
      );
      const totalPagesNum = Math.max(
        0,
        Number(getFieldByPath(json, mod?.fields.listTotalPagesPath || 'total_pages')) ||
          (items.length > 0 ? Math.max(1, Math.ceil(totalNum / perPage)) : 0)
      );

      const payload: PinoyListResponse = {
        status: 'live',
        page: pageNum,
        per_page: Number(json.per_page) || perPage,
        total: totalNum,
        total_pages: totalPagesNum,
        items,
      };
      pinoyCache.set(cacheKey, payload, LIST_TTL_MS, LIST_STALE_MS);
      return payload;
    } catch (err) {
      const stale = pinoyCache.getStale(cacheKey) as PinoyListResponse | null;
      if (stale) return { ...stale, status: 'fallback' };
      return {
        status: 'fallback',
        page: filters.page,
        per_page: perPage,
        total: 0,
        total_pages: 0,
        items: [],
        error: err instanceof Error ? err.message : 'API Pinoy indisponible',
      };
    }
  });
}

export async function fetchPinoyDetail(
  apiUrl: string,
  slug: string,
  similarLimit = 12,
  mediaBaseUrl = DEFAULT_PINOY_MEDIA_BASE_URL,
  playerTemplate = DEFAULT_PINOY_PLAYER_TEMPLATE,
  mod?: CustomApiModuleConfig | null
): Promise<PinoyDetailResponse> {
  const effectiveApiUrl = mod?.endpoints.apiUrl ?? apiUrl;
  const effectiveMediaBase = mod ? mod.endpoints.mediaBaseUrl : mediaBaseUrl;
  const effectivePlayerTemplate = mod ? mod.player.playerUrlTemplate : playerTemplate;
  const effectiveSimilarLimit = mod ? mod.endpoints.similarLimit : similarLimit;
  const primaryLabel = mod?.player.primaryPlayerLabel || 'Lecteur Pinoy';
  const includeUpstreamEmbeds = mod ? mod.player.includeUpstreamEmbeds : true;
  const onlyDirectDownloads = mod ? mod.player.onlyDirectDownloads : true;

  const validation = validatePinoyApiUrl(effectiveApiUrl);
  if (!validation.ok || !validation.url) {
    return {
      status: 'unconfigured',
      film: null,
      players: { embed: [], download: [] },
      similar: [],
    };
  }

  const cleanSlug = slug.trim().slice(0, 200);
  if (!cleanSlug) {
    return {
      status: 'fallback',
      film: null,
      players: { embed: [], download: [] },
      similar: [],
      error: 'Slug manquant',
    };
  }

  const cacheKey = `pinoy:detail:${validation.url}:${effectiveMediaBase}:${effectivePlayerTemplate}:${mod?.updatedAt ?? ''}:${cleanSlug}`;
  const fresh = pinoyCache.get(cacheKey) as PinoyDetailResponse | null;
  if (fresh) return fresh;

  return pinoyCoalescer.run(cacheKey, async () => {
    const recheck = pinoyCache.get(cacheKey) as PinoyDetailResponse | null;
    if (recheck) return recheck;

    try {
      const ep = mod?.endpoints;
      const actionParam = ep?.actionParam ?? 'action';
      const detailAction = ep?.detailAction ?? 'detail';
      const detailKeyParam = ep?.detailKeyParam ?? 'slug';
      const similarLimitParam = ep?.similarLimitParam ?? 'similar_limit';

      const params: Record<string, string | number | undefined> = {};
      if (actionParam && detailAction) params[actionParam] = detailAction;
      if (detailKeyParam) params[detailKeyParam] = cleanSlug;
      if (similarLimitParam && effectiveSimilarLimit > 0) {
        params[similarLimitParam] = effectiveSimilarLimit;
      }

      const target = buildPinoyEndpointUrl(validation.url, params);
      const json = await fetchJsonFromPinoy(target);
      const rawFilm = getFieldByPath(json, mod?.fields.detailItemPath || 'film') ?? json;
      const film = normalizeFilm(rawFilm, effectiveMediaBase, validation.url, mod);

      const rawEmbed = getFieldByPath(json, mod?.fields.detailEmbedsPath || 'players.embed');
      const upstreamEmbed = (Array.isArray(rawEmbed) ? rawEmbed : [])
        .map((p) => normalizePlayerSource(p, mod))
        .filter((x): x is PinoyPlayerSource => Boolean(x));

      const customPlayerUrl = film ? resolvePinoyPlayerUrl(effectivePlayerTemplate, film) : null;
      const embed: PinoyPlayerSource[] = [];
      const seenEmbedUrls = new Set<string>();
      if (customPlayerUrl) {
        embed.push({
          provider: primaryLabel,
          url: customPlayerUrl,
          quality: 'HD',
          language: null,
        });
        seenEmbedUrls.add(customPlayerUrl);
      }
      if (includeUpstreamEmbeds || !customPlayerUrl) {
        for (const srv of upstreamEmbed) {
          if (!seenEmbedUrls.has(srv.url)) {
            seenEmbedUrls.add(srv.url);
            embed.push(srv);
          }
        }
      }

      const rawDownload = getFieldByPath(json, mod?.fields.detailDownloadsPath || 'players.download');
      const rawDlList = (Array.isArray(rawDownload) ? rawDownload : [])
        .map((p) => normalizePlayerSource(p, mod))
        .filter((x): x is PinoyPlayerSource => Boolean(x));

      const download: PinoyPlayerSource[] = [];
      const seenDownloadUrls = new Set<string>();

      for (const dl of rawDlList) {
        const directUrl = onlyDirectDownloads
          ? embedToDirectDownloadUrl(dl.url, dl.provider) ??
            (isDirectDownloadUrl(dl.url) ? dl.url : null)
          : dl.url;
        if (directUrl && !seenDownloadUrls.has(directUrl)) {
          seenDownloadUrls.add(directUrl);
          download.push({ ...dl, url: directUrl });
        }
      }

      if (onlyDirectDownloads) {
        for (const srv of upstreamEmbed) {
          const directUrl = embedToDirectDownloadUrl(srv.url, srv.provider);
          if (directUrl && !seenDownloadUrls.has(directUrl)) {
            seenDownloadUrls.add(directUrl);
            download.push({
              provider: srv.provider,
              url: directUrl,
              quality: srv.quality,
              language: srv.language,
            });
          }
        }
      }

      const rawSimilar = getFieldByPath(json, mod?.fields.detailSimilarPath || 'similar');
      const similar = (Array.isArray(rawSimilar) ? rawSimilar : [])
        .map((s) => normalizeFilm(s, effectiveMediaBase, validation.url, mod))
        .filter((x): x is PinoyFilm => Boolean(x));

      const payload: PinoyDetailResponse = {
        status: 'live',
        film,
        players: { embed, download },
        similar,
      };
      pinoyCache.set(cacheKey, payload, DETAIL_TTL_MS, DETAIL_STALE_MS);
      return payload;
    } catch (err) {
      const stale = pinoyCache.getStale(cacheKey) as PinoyDetailResponse | null;
      if (stale) return { ...stale, status: 'fallback' };
      return {
        status: 'fallback',
        film: null,
        players: { embed: [], download: [] },
        similar: [],
        error: err instanceof Error ? err.message : 'Film introuvable',
      };
    }
  });
}
