import type { DetailItem, Episode, ItemType, SeasonMeta } from '../shared/types.ts';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_STILL_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w300';

const tmdbCache = new Map<string, { expiresAt: number; value: unknown }>();

export function clearTmdbCache(): void {
  tmdbCache.clear();
}

function getCachedTmdb<T>(key: string): T | null {
  const entry = tmdbCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tmdbCache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCachedTmdb<T>(key: string, value: T, ttlMs = 15 * 60_000): T {
  if (tmdbCache.size > 500) {
    const oldest = tmdbCache.keys().next().value;
    if (oldest) tmdbCache.delete(oldest);
  }
  tmdbCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

async function fetchTmdbJson<T>(endpoint: string, apiKey: string): Promise<T | null> {
  if (!apiKey) return null;
  const cacheKey = `${apiKey.slice(0, 6)}:${endpoint}`;
  const cached = getCachedTmdb<T>(cacheKey);
  if (cached) return cached;

  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${TMDB_BASE}${endpoint}${sep}api_key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(7_000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as T;
    return setCachedTmdb(cacheKey, json);
  } catch {
    return null;
  }
}

interface TmdbShowResponse {
  id: number;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  seasons?: Array<{
    season_number: number;
    name: string;
    episode_count: number;
    air_date: string | null;
    poster_path: string | null;
  }>;
}

interface TmdbSeasonResponse {
  season_number: number;
  name?: string;
  episodes?: Array<{
    episode_number: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
    air_date?: string | null;
    runtime?: number | null;
  }>;
}

function buildFallbackSeasonsMeta(episodes: Episode[]): SeasonMeta[] {
  const map = new Map<number, Episode[]>();
  for (const ep of episodes) {
    const s = ep.saison || 1;
    const arr = map.get(s) ?? [];
    arr.push(ep);
    map.set(s, arr);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, eps]) => ({
      seasonNumber,
      name: `Saison ${seasonNumber}`,
      episodeCount: eps.length,
      availableCount: eps.length,
      available: true,
      airDate: null,
      poster: null,
    }));
}

export async function enrichDetailWithTmdb(params: {
  type: ItemType;
  item: DetailItem;
  upstreamEpisodes: Episode[];
  apiKey: string;
}): Promise<{
  item: DetailItem;
  episodes: Episode[];
  seasonsMeta: SeasonMeta[];
  tmdbRating: { average: number; count: number } | null;
}> {
  const { type, item, upstreamEpisodes, apiKey } = params;
  const fallbackEpisodes = upstreamEpisodes.map((ep) => ({ ...ep, available: true }));
  const fallbackMeta = buildFallbackSeasonsMeta(fallbackEpisodes);

  if (!apiKey) {
    return { item, episodes: fallbackEpisodes, seasonsMeta: fallbackMeta, tmdbRating: null };
  }

  const isMovie = type === 'film' || (item.type === 'film' && upstreamEpisodes.length === 0);
  const tmdbKind = isMovie ? 'movie' : 'tv';

  let tmdbId = item.tmdbId && /^\d+$/.test(String(item.tmdbId)) ? String(item.tmdbId) : null;

  // Auto-resolve TMDB ID by title + year if upstream omitted tmdbId
  if (!tmdbId && item.titre) {
    const yearParam = item.annee
      ? tmdbKind === 'movie'
        ? `&year=${item.annee}`
        : `&first_air_date_year=${item.annee}`
      : '';
    const searchRes = await fetchTmdbJson<{ results?: Array<{ id: number }> }>(
      `/search/${tmdbKind}?language=fr-FR&query=${encodeURIComponent(item.titre)}${yearParam}`,
      apiKey
    );
    const firstId = searchRes?.results?.[0]?.id;
    if (firstId) {
      tmdbId = String(firstId);
    } else if (yearParam) {
      // Retry without year filter
      const retryRes = await fetchTmdbJson<{ results?: Array<{ id: number }> }>(
        `/search/${tmdbKind}?language=fr-FR&query=${encodeURIComponent(item.titre)}`,
        apiKey
      );
      if (retryRes?.results?.[0]?.id) {
        tmdbId = String(retryRes.results[0].id);
      }
    }
  }

  if (!tmdbId) {
    return { item, episodes: fallbackEpisodes, seasonsMeta: fallbackMeta, tmdbRating: null };
  }

  const showData = await fetchTmdbJson<TmdbShowResponse>(
    `/${tmdbKind}/${tmdbId}?language=fr-FR`,
    apiKey
  );

  if (!showData) {
    return {
      item: { ...item, tmdbId },
      episodes: fallbackEpisodes,
      seasonsMeta: fallbackMeta,
      tmdbRating: null,
    };
  }

  const tmdbRating =
    typeof showData.vote_average === 'number' && showData.vote_average > 0
      ? {
          average: Math.round(showData.vote_average * 10) / 10,
          count: Number(showData.vote_count) || 0,
        }
      : null;

  const enrichedItem: DetailItem = {
    ...item,
    tmdbId,
    descr: item.descr || showData.overview?.trim() || null,
  };

  if (isMovie) {
    return {
      item: enrichedItem,
      episodes: fallbackEpisodes,
      seasonsMeta: fallbackMeta,
      tmdbRating,
    };
  }

  // Group upstream available episodes by season & key "s-e"
  const upstreamByKey = new Map<string, Episode>();
  const upstreamSeasons = new Set<number>();
  for (const ep of upstreamEpisodes) {
    const s = Math.max(0, Number(ep.saison) || 1);
    const e = Math.max(1, Number(ep.episode) || 1);
    upstreamByKey.set(`${s}-${e}`, ep);
    upstreamSeasons.add(s);
  }

  // Keep regular TMDB seasons (>= 1) plus any season present in upstream
  const tmdbSeasons = (showData.seasons ?? []).filter(
    (s) => s.season_number >= 1 || upstreamSeasons.has(s.season_number)
  );

  if (tmdbSeasons.length === 0) {
    return {
      item: enrichedItem,
      episodes: fallbackEpisodes,
      seasonsMeta: fallbackMeta,
      tmdbRating,
    };
  }

  // Limit parallel season requests safely to 20 seasons
  const seasonsToFetch = tmdbSeasons.slice(0, 20);
  const seasonResponses = await Promise.all(
    seasonsToFetch.map((s) =>
      fetchTmdbJson<TmdbSeasonResponse>(
        `/tv/${tmdbId}/season/${s.season_number}?language=fr-FR`,
        apiKey
      )
    )
  );

  const enrichedEpisodes: Episode[] = [];
  const seasonsMeta: SeasonMeta[] = [];
  const handledKeys = new Set<string>();

  seasonsToFetch.forEach((sMeta, idx) => {
    const sNum = sMeta.season_number;
    const tmdbSeasonData = seasonResponses[idx];
    const tmdbEps = tmdbSeasonData?.episodes ?? [];

    const upstreamInSeason = upstreamEpisodes.filter((ep) => (ep.saison || 1) === sNum);
    const availableCount = upstreamInSeason.length;

    seasonsMeta.push({
      seasonNumber: sNum,
      name: sMeta.name || `Saison ${sNum}`,
      episodeCount: Math.max(sMeta.episode_count || 0, tmdbEps.length, availableCount),
      availableCount,
      available: availableCount > 0,
      airDate: sMeta.air_date || null,
      poster: sMeta.poster_path ? `${TMDB_POSTER_BASE}${sMeta.poster_path}` : null,
    });

    if (tmdbEps.length > 0) {
      for (const tep of tmdbEps) {
        const key = `${sNum}-${tep.episode_number}`;
        const upEp = upstreamByKey.get(key);
        handledKeys.add(key);
        enrichedEpisodes.push({
          saison: sNum,
          episode: tep.episode_number,
          titre: tep.name?.trim() || upEp?.titre || `Épisode ${tep.episode_number}`,
          description: tep.overview?.trim() || null,
          still: tep.still_path ? `${TMDB_STILL_BASE}${tep.still_path}` : null,
          airDate: tep.air_date || null,
          runtime: tep.runtime ?? null,
          available: Boolean(upEp),
          url: upEp?.url ?? null,
        });
      }
      // Also include any upstream episodes in this season numbered beyond TMDB's list
      for (const upEp of upstreamInSeason) {
        const key = `${sNum}-${upEp.episode}`;
        if (!handledKeys.has(key)) {
          handledKeys.add(key);
          enrichedEpisodes.push({ ...upEp, available: true });
        }
      }
    } else {
      for (const upEp of upstreamInSeason) {
        const key = `${sNum}-${upEp.episode}`;
        handledKeys.add(key);
        enrichedEpisodes.push({ ...upEp, available: true });
      }
    }
  });

  // Ensure any remaining upstream episodes (e.g. season > 20) remain accessible
  for (const upEp of upstreamEpisodes) {
    const key = `${upEp.saison || 1}-${upEp.episode}`;
    if (!handledKeys.has(key)) {
      handledKeys.add(key);
      enrichedEpisodes.push({ ...upEp, available: true });
      if (!seasonsMeta.some((sm) => sm.seasonNumber === (upEp.saison || 1))) {
        seasonsMeta.push({
          seasonNumber: upEp.saison || 1,
          name: `Saison ${upEp.saison || 1}`,
          episodeCount: 1,
          availableCount: 1,
          available: true,
          airDate: null,
          poster: null,
        });
      }
    }
  }

  return {
    item: enrichedItem,
    episodes: enrichedEpisodes,
    seasonsMeta: seasonsMeta.sort((a, b) => a.seasonNumber - b.seasonNumber),
    tmdbRating,
  };
}
