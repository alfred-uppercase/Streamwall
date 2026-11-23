import type {
  PinoyDetailResponse,
  PinoyFacetsResponse,
  PinoyFilm,
  PinoyListFilters,
  PinoyListResponse,
  PinoyPlayerSource,
} from '../shared/types.ts';
import { InFlightCoalescer, TimedLruCache } from './cacheUtils.ts';

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
  apiUrl = ''
): PinoyFilm | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  const titre = typeof r.titre === 'string' ? r.titre.trim() : '';
  const slug = typeof r.slug === 'string' ? r.slug.trim() : '';
  if (!Number.isFinite(id) || id <= 0 || !titre || !slug) return null;

  const rawGenres = Array.isArray(r.genres) ? r.genres : [];
  const genres = rawGenres
    .map((g) => (typeof g === 'string' ? g.trim() : ''))
    .filter(Boolean)
    .slice(0, 12);

  const rawGalerie = Array.isArray(r.galerie) ? r.galerie : [];
  const galerie = rawGalerie
    .map((u) => resolvePinoyMediaUrl(u, mediaBaseUrl, apiUrl))
    .filter((u): u is string => Boolean(u))
    .slice(0, 24);

  const anneeNum = r.annee !== null && r.annee !== undefined ? Number(r.annee) : NaN;
  const noteNum = r.note !== null && r.note !== undefined ? Number(r.note) : NaN;

  return {
    id,
    titre,
    titre_original: typeof r.titre_original === 'string' && r.titre_original.trim() ? r.titre_original.trim() : null,
    slug,
    url_source: sanitizeExternalHttpUrl(r.url_source),
    annee: Number.isFinite(anneeNum) && anneeNum > 1800 ? Math.trunc(anneeNum) : null,
    date_sortie: typeof r.date_sortie === 'string' && r.date_sortie.trim() ? r.date_sortie.trim() : null,
    sortie_le: typeof r.sortie_le === 'string' && r.sortie_le.trim() ? r.sortie_le.trim() : null,
    pays: typeof r.pays === 'string' && r.pays.trim() ? r.pays.trim().slice(0, 16) : null,
    duree: typeof r.duree === 'string' && r.duree.trim() ? r.duree.trim().slice(0, 40) : null,
    note: Number.isFinite(noteNum) && noteNum >= 0 ? Math.round(noteNum * 10) / 10 : null,
    genres,
    synopsis: typeof r.synopsis === 'string' && r.synopsis.trim() ? r.synopsis.trim() : null,
    poster: resolvePinoyMediaUrl(r.poster, mediaBaseUrl, apiUrl),
    galerie,
  };
}

function normalizePlayerSource(raw: unknown): PinoyPlayerSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const url = sanitizeExternalHttpUrl(r.url);
  if (!url) return null;
  const provider =
    typeof r.provider === 'string' && r.provider.trim() ? r.provider.trim().slice(0, 64) : 'Serveur';
  const quality =
    typeof r.quality === 'string' && r.quality.trim() ? r.quality.trim().slice(0, 32) : null;
  const language =
    typeof r.language === 'string' && r.language.trim() ? r.language.trim().slice(0, 32) : null;
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

export async function fetchPinoyFacets(apiUrl: string): Promise<PinoyFacetsResponse> {
  const validation = validatePinoyApiUrl(apiUrl);
  if (!validation.ok || !validation.url) {
    return {
      status: 'unconfigured',
      genres: [],
      pays: [],
      annees: { min: null, max: null },
    };
  }

  const cacheKey = `pinoy:facets:${validation.url}`;
  const fresh = pinoyCache.get(cacheKey) as PinoyFacetsResponse | null;
  if (fresh) return fresh;

  return pinoyCoalescer.run(cacheKey, async () => {
    const recheck = pinoyCache.get(cacheKey) as PinoyFacetsResponse | null;
    if (recheck) return recheck;

    try {
      const target = buildPinoyEndpointUrl(validation.url, { action: 'facets' });
      const json = await fetchJsonFromPinoy(target);

      const rawGenres = Array.isArray(json.genres) ? json.genres : [];
      const genres = rawGenres
        .map((g) => {
          if (!g || typeof g !== 'object') return null;
          const rec = g as Record<string, unknown>;
          const nom = typeof rec.nom === 'string' ? rec.nom.trim() : '';
          const total = Number(rec.total) || 0;
          return nom ? { nom, total } : null;
        })
        .filter((x): x is { nom: string; total: number } => Boolean(x));

      const rawPays = Array.isArray(json.pays) ? json.pays : [];
      const pays = rawPays
        .map((p) => {
          if (!p || typeof p !== 'object') return null;
          const rec = p as Record<string, unknown>;
          const code = typeof rec.code === 'string' ? rec.code.trim() : '';
          const total = Number(rec.total) || 0;
          return code ? { code, total } : null;
        })
        .filter((x): x is { code: string; total: number } => Boolean(x));

      const rawAnnees =
        json.annees && typeof json.annees === 'object'
          ? (json.annees as Record<string, unknown>)
          : {};
      const minY = Number(rawAnnees.min);
      const maxY = Number(rawAnnees.max);

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
  mediaBaseUrl = DEFAULT_PINOY_MEDIA_BASE_URL
): Promise<PinoyListResponse> {
  const validation = validatePinoyApiUrl(apiUrl);
  if (!validation.ok || !validation.url) {
    return {
      status: 'unconfigured',
      page: 1,
      per_page: 24,
      total: 0,
      total_pages: 0,
      items: [],
    };
  }

  const normalizedKey = JSON.stringify({
    u: validation.url,
    m: mediaBaseUrl,
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
      const target = buildPinoyEndpointUrl(validation.url, {
        action: 'list',
        page: filters.page,
        per_page: 24,
        q: filters.q || undefined,
        genre: filters.genre || undefined,
        pays: filters.pays || undefined,
        annee: filters.annee || undefined,
        sort: filters.sort || 'recent',
      });
      const json = await fetchJsonFromPinoy(target);

      const rawItems = Array.isArray(json.items) ? json.items : [];
      const items = rawItems
        .map((it) => normalizeFilm(it, mediaBaseUrl, validation.url))
        .filter((x): x is PinoyFilm => Boolean(x));

      const payload: PinoyListResponse = {
        status: 'live',
        page: Math.max(1, Number(json.page) || filters.page),
        per_page: Math.max(1, Number(json.per_page) || 24),
        total: Math.max(0, Number(json.total) || items.length),
        total_pages: Math.max(0, Number(json.total_pages) || (items.length > 0 ? 1 : 0)),
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
        per_page: 24,
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
  playerTemplate = DEFAULT_PINOY_PLAYER_TEMPLATE
): Promise<PinoyDetailResponse> {
  const validation = validatePinoyApiUrl(apiUrl);
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

  const cacheKey = `pinoy:detail:${validation.url}:${mediaBaseUrl}:${playerTemplate}:${cleanSlug}`;
  const fresh = pinoyCache.get(cacheKey) as PinoyDetailResponse | null;
  if (fresh) return fresh;

  return pinoyCoalescer.run(cacheKey, async () => {
    const recheck = pinoyCache.get(cacheKey) as PinoyDetailResponse | null;
    if (recheck) return recheck;

    try {
      const target = buildPinoyEndpointUrl(validation.url, {
        action: 'detail',
        slug: cleanSlug,
        similar_limit: similarLimit,
      });
      const json = await fetchJsonFromPinoy(target);
      const film = normalizeFilm(json.film, mediaBaseUrl, validation.url);

      const rawPlayers =
        json.players && typeof json.players === 'object'
          ? (json.players as Record<string, unknown>)
          : {};
      const upstreamEmbed = (Array.isArray(rawPlayers.embed) ? rawPlayers.embed : [])
        .map((p) => normalizePlayerSource(p))
        .filter((x): x is PinoyPlayerSource => Boolean(x));

      const customPlayerUrl = film ? resolvePinoyPlayerUrl(playerTemplate, film) : null;
      const embed: PinoyPlayerSource[] = [];
      const seenEmbedUrls = new Set<string>();
      if (customPlayerUrl) {
        embed.push({
          provider: 'Lecteur Pinoy',
          url: customPlayerUrl,
          quality: 'HD',
          language: null,
        });
        seenEmbedUrls.add(customPlayerUrl);
      }
      for (const srv of upstreamEmbed) {
        if (!seenEmbedUrls.has(srv.url)) {
          seenEmbedUrls.add(srv.url);
          embed.push(srv);
        }
      }

      const rawDownload = (Array.isArray(rawPlayers.download) ? rawPlayers.download : [])
        .map((p) => normalizePlayerSource(p))
        .filter((x): x is PinoyPlayerSource => Boolean(x));

      const download: PinoyPlayerSource[] = [];
      const seenDownloadUrls = new Set<string>();

      for (const dl of rawDownload) {
        const directUrl =
          embedToDirectDownloadUrl(dl.url, dl.provider) ??
          (isDirectDownloadUrl(dl.url) ? dl.url : null);
        if (directUrl && !seenDownloadUrls.has(directUrl)) {
          seenDownloadUrls.add(directUrl);
          download.push({ ...dl, url: directUrl });
        }
      }

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

      const rawSimilar = Array.isArray(json.similar) ? json.similar : [];
      const similar = rawSimilar
        .map((s) => normalizeFilm(s, mediaBaseUrl, validation.url))
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
