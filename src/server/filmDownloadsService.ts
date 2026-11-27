import crypto from 'node:crypto';
import type { FilmDownloadItem } from '../shared/types.ts';
import { InFlightCoalescer, TimedLruCache } from './cacheUtils.ts';
import { encryptProtectedLink, sanitizeExternalDownloadUrl } from './linkProtectService.ts';

export const DEFAULT_FILM_DOWNLOAD_API_URL = 'https://streamwall.behoririka.mg/api/api_f.php';
export const DEFAULT_FILM_DOWNLOAD_MESSAGE =
  'Le téléchargement direct est réservé aux membres Pro et aux administrateurs.';

interface NormalizedUpstreamDownload {
  id: number;
  filename: string;
  quality: string;
  url: string;
}

const filmDownloadsCache = new TimedLruCache<NormalizedUpstreamDownload[]>(400);
const filmDownloadsCoalescer = new InFlightCoalescer();

const DOWNLOADS_TTL_MS = 120_000;
const DOWNLOADS_STALE_MS = 300_000;

export function clearFilmDownloadsCache(): void {
  filmDownloadsCache.clear();
}

export function sanitizeFilmDownloadMessage(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_FILM_DOWNLOAD_MESSAGE;
  const cleaned = raw
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 500);
  return cleaned || DEFAULT_FILM_DOWNLOAD_MESSAGE;
}

export function maskFilmDownloadToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
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

  if (h.includes(':')) {
    if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
    if (h.startsWith('::ffff:')) {
      const mapped = h.slice('::ffff:'.length);
      return isPrivateOrLoopbackHost(mapped);
    }
  }

  return false;
}

export function validateFilmDownloadApiUrl(
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
    return {
      ok: false,
      error: 'URL invalide. Exemple : https://streamwall.behoririka.mg/api/api_f.php',
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
  parsed.hash = '';
  return { ok: true, url: parsed.toString() };
}

function normalizeUpstreamDownloadItem(
  raw: Record<string, unknown>,
  fallbackIdx: number
): NormalizedUpstreamDownload | null {
  const safeUrl = sanitizeExternalDownloadUrl(raw.url);
  if (!safeUrl) return null;

  const parsedId = Number(raw.id);
  const id = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : fallbackIdx + 1;

  const rawFilename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
  const filename = rawFilename.slice(0, 140) || 'Téléchargement';

  const rawQuality = typeof raw.quality === 'string' ? raw.quality.trim() : '';
  const quality = rawQuality.slice(0, 48);

  return {
    id,
    filename,
    quality,
    url: safeUrl,
  };
}

function toProtectedPublicItem(
  entry: NormalizedUpstreamDownload,
  filmId: number
): FilmDownloadItem | null {
  const protectToken = encryptProtectedLink({
    url: entry.url,
    filename: entry.filename,
    quality: entry.quality,
    filmId,
  });
  if (!protectToken) return null;
  return {
    id: entry.id,
    filename: entry.filename,
    quality: entry.quality,
    protectToken,
  };
}

function tokenFingerprint(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export interface FilmDownloadFetchErrorInfo {
  reason: string;
  statusCode?: number;
}

export async function fetchFilmDownloads(
  filmId: number,
  config: { apiUrl: string; apiKey: string },
  onError?: (info: FilmDownloadFetchErrorInfo) => void
): Promise<FilmDownloadItem[]> {
  const apiUrl = config.apiUrl.trim();
  const apiKey = config.apiKey.trim();
  if (!apiUrl || !apiKey || !Number.isInteger(filmId) || filmId < 1) {
    return [];
  }

  const cacheKey = `film_dl:${apiUrl}:${filmId}:${tokenFingerprint(apiKey)}`;
  let upstreamItems = filmDownloadsCache.get(cacheKey);

  if (!upstreamItems) {
    upstreamItems = await filmDownloadsCoalescer.run(cacheKey, async () => {
      const recheck = filmDownloadsCache.get(cacheKey);
      if (recheck) return recheck;

      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(7_000),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'Mozilla/5.0 (Tapenaka StreamWall)',
          },
          body: JSON.stringify({ film_id: filmId }),
        });

        if (!res.ok) {
          onError?.({
            reason: `API téléchargement HTTP ${res.status}`,
            statusCode: res.status,
          });
          return filmDownloadsCache.getStale(cacheKey) ?? [];
        }

        const json = (await res.json()) as {
          success?: unknown;
          downloads?: unknown[];
          error?: unknown;
        };

        if (!json || json.success !== true || !Array.isArray(json.downloads)) {
          const upstreamErr =
            json && typeof json.error === 'string' && json.error.trim()
              ? `: ${json.error.trim().slice(0, 120)}`
              : '';
          onError?.({
            reason: `Réponse API téléchargement invalide${upstreamErr}`,
            statusCode: res.status,
          });
          return filmDownloadsCache.getStale(cacheKey) ?? [];
        }

        const items: NormalizedUpstreamDownload[] = [];
        for (let i = 0; i < json.downloads.length; i++) {
          const entry = json.downloads[i];
          if (!entry || typeof entry !== 'object') continue;
          const normalized = normalizeUpstreamDownloadItem(entry as Record<string, unknown>, i);
          if (normalized) items.push(normalized);
        }

        return filmDownloadsCache.set(cacheKey, items, DOWNLOADS_TTL_MS, DOWNLOADS_STALE_MS);
      } catch (err) {
        onError?.({
          reason:
            err instanceof Error && err.message
              ? `Erreur réseau API téléchargement : ${err.message.slice(0, 140)}`
              : 'Erreur réseau API téléchargement',
        });
        return filmDownloadsCache.getStale(cacheKey) ?? [];
      }
    });
  }

  return upstreamItems
    .map((entry) => toProtectedPublicItem(entry, filmId))
    .filter((item): item is FilmDownloadItem => Boolean(item));
}

export async function testFilmDownloadApi(
  filmId: number,
  config: { apiUrl: string; apiKey: string }
): Promise<{
  ok: boolean;
  statusCode: number;
  count: number;
  sample: FilmDownloadItem | null;
  message: string;
}> {
  const apiUrl = config.apiUrl.trim();
  const apiKey = config.apiKey.trim();
  if (!apiUrl) {
    return {
      ok: false,
      statusCode: 0,
      count: 0,
      sample: null,
      message: "L'URL de l'API de téléchargement est vide.",
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      statusCode: 0,
      count: 0,
      sample: null,
      message: 'Aucune clé API Bearer configurée.',
    };
  }
  const safeFilmId = Number.isInteger(filmId) && filmId >= 1 ? filmId : 1;

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0 (Tapenaka StreamWall)',
      },
      body: JSON.stringify({ film_id: safeFilmId }),
    });

    const text = await res.text();
    let json: { success?: unknown; count?: unknown; downloads?: unknown[]; error?: unknown } | null = null;
    try {
      json = JSON.parse(text) as {
        success?: unknown;
        count?: unknown;
        downloads?: unknown[];
        error?: unknown;
      };
    } catch {
      return {
        ok: false,
        statusCode: res.status,
        count: 0,
        sample: null,
        message: `Réponse non-JSON reçue (HTTP ${res.status}).`,
      };
    }

    if (!res.ok || json?.success !== true) {
      const errMsg = typeof json?.error === 'string' && json.error ? json.error : `HTTP ${res.status}`;
      return {
        ok: false,
        statusCode: res.status,
        count: 0,
        sample: null,
        message: `Échec API : ${errMsg}`,
      };
    }

    const rawDownloads = Array.isArray(json.downloads) ? json.downloads : [];
    const normalized = rawDownloads
      .map((entry, idx) =>
        entry && typeof entry === 'object'
          ? normalizeUpstreamDownloadItem(entry as Record<string, unknown>, idx)
          : null
      )
      .filter((x): x is NormalizedUpstreamDownload => Boolean(x));

    const sampleItem = normalized[0] ? toProtectedPublicItem(normalized[0], safeFilmId) : null;

    return {
      ok: true,
      statusCode: res.status,
      count: normalized.length,
      sample: sampleItem,
      message:
        normalized.length > 0
          ? `Connexion réussie (${normalized.length} lien${normalized.length > 1 ? 's' : ''} trouvé${normalized.length > 1 ? 's' : ''} pour le film #${safeFilmId}).`
          : `Connexion réussie (HTTP 200), aucun lien trouvé pour le film #${safeFilmId}.`,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: 0,
      count: 0,
      sample: null,
      message: err instanceof Error ? err.message : "Impossible de joindre l'API.",
    };
  }
}
