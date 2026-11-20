import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Film,
  Flag,
  Lock,
  Play,
  Search,
  SkipForward,
  Star,
  UserRound,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { TYPE_LABELS } from '../shared/types';
import type { CastMember, Episode, Item, ItemType, SeasonMeta } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { FavoriteButton, PosterCard } from '../components/PosterCard';
import { CommentsSection } from '../components/CommentsSection';

const FALLBACK_CINEMA_BACKDROP = '/src/assets/images/cinema_hero_backdrop_1794922115112.jpg';

function extractYouTubeVideoId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    const vParam = url.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;
    const pathMatch = url.pathname.match(/(?:embed|shorts|v|live)\/([a-zA-Z0-9_-]{11})/i);
    if (pathMatch?.[1]) return pathMatch[1];
    if (url.hostname.includes('youtu.be')) {
      const slug = url.pathname.replace(/^\/+/, '').split('/')[0];
      if (slug && /^[a-zA-Z0-9_-]{11}$/.test(slug)) return slug;
    }
  } catch {
    const fallbackMatch = trimmed.match(/([a-zA-Z0-9_-]{11})/);
    if (fallbackMatch?.[1]) return fallbackMatch[1];
  }
  return null;
}

function CastCard({ member }: { member: CastMember }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col items-center text-center">
      <div className="size-20 overflow-hidden rounded-full border border-border bg-card">
        {member.photo && !failed ? (
          <img
            src={member.photo}
            alt={member.nom}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <UserRound className="size-7" />
          </div>
        )}
      </div>
      <p className="mt-2 line-clamp-1 text-xs font-semibold text-foreground">{member.nom}</p>
      {member.role && (
        <p className="line-clamp-1 text-[11px] text-muted-foreground">{member.role}</p>
      )}
    </div>
  );
}

function EpisodeStill({
  src,
  alt,
  unavailable,
}: {
  src?: string | null;
  alt: string;
  unavailable?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg border border-border bg-background sm:w-44">
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover transition-transform duration-300 ${
            unavailable ? 'opacity-40 grayscale' : 'group-hover:scale-105'
          }`}
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-muted-foreground/60">
          <Film className="size-6" />
        </div>
      )}
      {unavailable && (
        <div className="absolute inset-0 grid place-items-center bg-black/45">
          <Lock className="size-4 text-white/80" />
        </div>
      )}
    </div>
  );
}

export function DetailPage() {
  const params = useParams<{ type: string; id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMember, setWatchingItem } = useAuth();
  const queryClient = useQueryClient();

  const type = (['film', 'serie', 'anime'].includes(params.type ?? '')
    ? params.type
    : 'film') as ItemType;
  const id = params.id ?? '';

  const [backdropFailed, setBackdropFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodeFilter, setEpisodeFilter] = useState('');
  const [activeEpisode, setActiveEpisode] = useState<{ season: number; episode: number }>({
    season: 1,
    episode: 1,
  });
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [modal, setModal] = useState<'watch' | 'trailer' | null>(null);
  const [preparingPlayer, setPreparingPlayer] = useState(false);

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [guestAuthAlertOpen, setGuestAuthAlertOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>('Lien mort / ne charge pas');
  const [reportSeason, setReportSeason] = useState<number>(1);
  const [reportEpisode, setReportEpisode] = useState<number>(1);
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  useEffect(() => {
    setBackdropFailed(false);
    setPosterFailed(false);
    setDescExpanded(false);
    setEpisodeFilter('');
  }, [type, id]);

  const detailQuery = useQuery({
    queryKey: ['details', type, id],
    queryFn: () => api.details(type, id),
    enabled: Boolean(id),
    staleTime: 180_000,
  });

  const memberQuery = useQuery({
    queryKey: ['member'],
    queryFn: () => api.member(),
    enabled: isMember,
  });

  const item = detailQuery.data?.item ?? null;
  useDocumentTitle(item ? item.titre : TYPE_LABELS[type] ?? 'Détails');
  const episodes = useMemo(() => detailQuery.data?.episodes ?? [], [detailQuery.data?.episodes]);

  // Group episodes by season
  const seasonsMap = useMemo(() => {
    const map = new Map<number, Episode[]>();
    for (const ep of episodes) {
      const s = ep.saison || 1;
      const arr = map.get(s) ?? [];
      arr.push(ep);
      map.set(s, arr);
    }
    return map;
  }, [episodes]);

  const seasonsMeta: SeasonMeta[] = useMemo(() => {
    const raw = detailQuery.data?.seasonsMeta;
    if (raw && raw.length > 0) return raw;
    return [...seasonsMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, eps]) => ({
        seasonNumber,
        name: `Saison ${seasonNumber}`,
        episodeCount: eps.length,
        availableCount: eps.filter((e) => e.available !== false).length,
        available: eps.some((e) => e.available !== false),
        airDate: null,
        poster: null,
      }));
  }, [detailQuery.data?.seasonsMeta, seasonsMap]);

  useEffect(() => {
    if (seasonsMeta.length === 0) return;
    const current = seasonsMeta.find((s) => s.seasonNumber === selectedSeason);
    if (!current || !current.available) {
      const firstAvailable = seasonsMeta.find((s) => s.available) ?? seasonsMeta[0];
      if (firstAvailable && firstAvailable.seasonNumber !== selectedSeason) {
        setSelectedSeason(firstAvailable.seasonNumber);
      }
    }
  }, [seasonsMeta, selectedSeason]);

  const savedProgress = useMemo(() => {
    return (memberQuery.data?.progress ?? []).find(
      (p) => p.item.id === String(id) && (p.item.item_type === type || p.item.item_type === item?.type)
    );
  }, [memberQuery.data?.progress, id, type, item?.type]);

  const watchedSet = useMemo(
    () => new Set(savedProgress?.watchedEpisodes ?? []),
    [savedProgress?.watchedEpisodes]
  );

  const effectiveType: ItemType = useMemo(() => {
    if (item?.type === 'film' && episodes.length === 0) return 'film';
    return item?.type ?? type;
  }, [item?.type, episodes.length, type]);

  const normalizedItem: Item | null = useMemo(() => {
    if (!item) return null;
    return {
      id: String(item.id),
      titre: item.titre,
      poster: item.poster,
      qualite: item.qualite,
      langue: item.langue,
      item_type: effectiveType,
      saison: item.saison ?? null,
      genre: item.genre,
      annee: item.annee,
      tmdbId: item.tmdbId,
    };
  }, [item, effectiveType]);

  const launchPlayer = useCallback(
    async (seasonNum: number, episodeNum: number) => {
      if (!normalizedItem || !item) return;
      setPreparingPlayer(true);
      try {
        const res = await api.openPlayer({
          item: normalizedItem,
          tmdb: item.tmdbId ? String(item.tmdbId) : null,
          season: seasonNum,
          episode: episodeNum,
        });
        setActiveEpisode({ season: res.season, episode: res.episode });
        setSelectedSeason(res.season);
        setPlayerUrl(res.url);
        if (res.member) {
          setWatchingItem(normalizedItem);
          void queryClient.invalidateQueries({ queryKey: ['member'] });
          void queryClient.invalidateQueries({ queryKey: ['home'] });
        }
        setModal('watch');
        window.dispatchEvent(new CustomEvent('tapenaka:player-opened'));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Impossible d'ouvrir le lecteur.");
      } finally {
        setPreparingPlayer(false);
      }
    },
    [normalizedItem, item, setWatchingItem, queryClient]
  );

  // Handle ?autoplay=1&s=...&e=... from "Reprendre la lecture"
  useEffect(() => {
    if (!item || !normalizedItem) return;
    if (searchParams.get('autoplay') === '1') {
      const s = Math.max(1, Number(searchParams.get('s')) || 1);
      const e = Math.max(1, Number(searchParams.get('e')) || 1);
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete('autoplay');
      cleaned.delete('s');
      cleaned.delete('e');
      setSearchParams(cleaned, { replace: true });
      void launchPlayer(s, e);
    }
  }, [item, normalizedItem, searchParams, setSearchParams, launchPlayer]);

  // Close modals on Escape
  useEffect(() => {
    if (!modal && !reportModalOpen && !guestAuthAlertOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (guestAuthAlertOpen) {
          setGuestAuthAlertOpen(false);
          return;
        }
        if (reportModalOpen) {
          setReportModalOpen(false);
          return;
        }
        setWatchingItem(null);
        setModal(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, reportModalOpen, guestAuthAlertOpen, setWatchingItem]);

  function openReportModal(seasonOverride?: number, episodeOverride?: number) {
    if (!isMember) {
      toast.error('Connecte-toi pour pouvoir demander ou signaler un contenu.');
      setGuestAuthAlertOpen(true);
      return;
    }
    setReportReason('Lien mort / ne charge pas');
    setReportSeason(seasonOverride || selectedSeason || 1);
    setReportEpisode(episodeOverride || activeEpisode.episode || 1);
    setReportDetails('');
    setReportModalOpen(true);
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!item || reportSubmitting) return;
    if (!isMember) {
      setReportModalOpen(false);
      setGuestAuthAlertOpen(true);
      toast.error('Connecte-toi pour pouvoir demander ou signaler un contenu.');
      return;
    }
    setReportSubmitting(true);
    try {
      await api.reportBrokenStream({
        itemType: effectiveType,
        itemId: String(item.id),
        itemTitle: item.titre,
        season: effectiveType !== 'film' ? reportSeason : undefined,
        episode: effectiveType !== 'film' ? reportEpisode : undefined,
        reason: reportReason,
        comment: reportDetails.trim(),
      });
      toast.success('Merci ! Votre signalement a bien été transmis à l’équipe.');
      setReportModalOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Impossible d’envoyer le signalement.');
    } finally {
      setReportSubmitting(false);
    }
  }

  // Compute next AVAILABLE episode for quick "Épisode suivant" inside player modal
  const nextEpisode = useMemo(() => {
    if (episodes.length === 0) return null;
    const idx = episodes.findIndex(
      (ep) => ep.saison === activeEpisode.season && ep.episode === activeEpisode.episode
    );
    if (idx < 0) return null;
    for (let i = idx + 1; i < episodes.length; i++) {
      if (episodes[i].available !== false) return episodes[i];
    }
    return null;
  }, [episodes, activeEpisode]);

  const currentSeasonEpisodes = useMemo(() => {
    const rawList = seasonsMap.get(selectedSeason) ?? episodes;
    const q = episodeFilter.trim().toLowerCase();
    if (!q) return rawList;
    return rawList.filter(
      (ep) =>
        String(ep.episode).includes(q) ||
        (ep.titre ?? '').toLowerCase().includes(q) ||
        (ep.description ?? '').toLowerCase().includes(q)
    );
  }, [seasonsMap, selectedSeason, episodes, episodeFilter]);

  if (detailQuery.isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 sm:px-6 sm:pt-28">
        <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />
      </main>
    );
  }

  const detailData = detailQuery.data;

  if (detailQuery.isError || !detailData || !item || !normalizedItem) {
    return (
      <main className="mx-auto max-w-7xl px-4 pt-24 pb-16 text-center sm:px-6 sm:pt-28">
        <h1 className="font-display text-3xl font-bold text-foreground">Titre introuvable</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">
          Ce contenu n’existe pas ou le serveur de catalogue ne répond pas.
        </p>
        <Link
          to="/catalogue"
          className="inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Retour au catalogue
        </Link>
      </main>
    );
  }

  const backdropUrl =
    !backdropFailed && (item.backdrop || item.poster)
      ? (item.backdrop || item.poster)!
      : FALLBACK_CINEMA_BACKDROP;

  const firstPlayable = episodes.find((e) => e.available !== false) ?? episodes[0];
  const defaultSeason =
    savedProgress?.season ??
    firstPlayable?.saison ??
    (Number(item.saison) || seasonsMeta.find((s) => s.available)?.seasonNumber || 1);
  const defaultEpisode = savedProgress?.episode ?? firstPlayable?.episode ?? 1;

  const metaLine = [
    TYPE_LABELS[effectiveType] ?? effectiveType,
    item.annee ? String(item.annee) : null,
    seasonsMeta.length > 0 && effectiveType !== 'film'
      ? `${seasonsMeta.length} saison${seasonsMeta.length > 1 ? 's' : ''}`
      : item.saison
        ? `Saison ${item.saison}`
        : null,
    item.qualite || null,
    item.langue || null,
  ].filter(Boolean);

  const tmdbRating = detailData.tmdbRating;
  const descrText = item.descr?.trim() || '';
  const isLongDescr = descrText.length > 220;
  const activeSeasonMeta = seasonsMeta.find((s) => s.seasonNumber === selectedSeason);
  const rawSeasonCount = (seasonsMap.get(selectedSeason) ?? []).length;

  return (
    <div>
      {/* Hero section */}
      <section className="relative overflow-hidden border-b border-border bg-zinc-950 dark:bg-card">
        <img
          src={backdropUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBackdropFailed(true)}
          className="absolute inset-0 h-full w-full object-cover opacity-75 brightness-105 transition-opacity duration-300"
        />
        {/* Top scrim for transparent overlaid header contrast */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/65 via-black/25 to-transparent" />
        {/* Side & bottom gradients: black gradient in light mode, theme background in dark mode (lighter so banner isn't too dark) */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/80 via-black/35 to-transparent dark:from-background/85 dark:via-background/30" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent dark:from-background dark:via-background/50" />

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-8 px-4 pt-24 pb-10 sm:px-6 sm:pt-28 md:flex-row md:items-end md:pt-32 md:pb-14">
          <div className="w-44 shrink-0 overflow-hidden rounded-xl border border-white/15 dark:border-border bg-card shadow-2xl sm:w-56">
            {item.poster && !posterFailed ? (
              <img
                src={item.poster}
                alt={item.titre}
                referrerPolicy="no-referrer"
                onError={() => setPosterFailed(true)}
                className="aspect-[2/3] w-full object-cover"
              />
            ) : (
              <div className="grid aspect-[2/3] w-full place-items-center p-4 text-center">
                <Film className="size-10 text-primary/70" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <p className="text-xs font-medium text-primary tabular-nums drop-shadow-xs">
              {metaLine.join(' · ')}
            </p>

            <h1 className="font-display text-3xl font-bold tracking-tight text-white dark:text-foreground drop-shadow-sm sm:text-5xl">
              {item.titre}
            </h1>

            {item.genre && <p className="text-sm text-white/75 dark:text-muted-foreground">{item.genre}</p>}

            {tmdbRating && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-white dark:text-foreground tabular-nums">
                  <Star className="size-4 fill-amber-400 text-amber-400" />
                  <span>{tmdbRating.average.toFixed(1)}</span>
                  <span className="text-xs font-normal text-white/70 dark:text-muted-foreground">/ 10 TMDB</span>
                  {tmdbRating.count > 0 && (
                    <span className="text-xs font-normal text-white/70 dark:text-muted-foreground">
                      ({tmdbRating.count.toLocaleString('fr-FR')} votes)
                    </span>
                  )}
                </div>
              </div>
            )}

            {descrText && (
              <div className="max-w-3xl space-y-1.5">
                <p
                  className={`text-sm leading-relaxed text-white/90 dark:text-foreground/90 sm:text-base ${
                    !descExpanded && isLongDescr ? 'line-clamp-3' : ''
                  }`}
                >
                  {descrText}
                </p>
                {isLongDescr && (
                  <button
                    type="button"
                    onClick={() => setDescExpanded((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>{descExpanded ? 'Voir moins' : 'Voir plus'}</span>
                    {descExpanded ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Primary & secondary action row */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                disabled={preparingPlayer}
                onClick={() => void launchPlayer(defaultSeason, defaultEpisode)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="size-4 fill-current" />
                <span>
                  {preparingPlayer
                    ? 'Ouverture…'
                    : savedProgress && effectiveType !== 'film'
                      ? `Reprendre S${savedProgress.season} · É${savedProgress.episode}`
                      : 'Regarder maintenant'}
                </span>
              </button>

              {extractYouTubeVideoId(item.trailer) && (
                <button
                  type="button"
                  onClick={() => setModal('trailer')}
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-slate-200 whitespace-nowrap shrink-0"
                >
                  <Video className="size-4" />
                  <span>Bande-annonce</span>
                </button>
              )}

              {isMember ? (
                <FavoriteButton item={normalizedItem} />
              ) : (
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-black/45 px-4 py-2.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-black/65 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-accent whitespace-nowrap shrink-0"
                >
                  <span>Se connecter pour ma liste</span>
                </Link>
              )}

              <button
                type="button"
                onClick={() => openReportModal(selectedSeason, defaultEpisode)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-black/45 px-4 py-2.5 text-sm font-medium text-white/90 backdrop-blur transition-colors hover:border-amber-400/50 hover:bg-black/65 hover:text-amber-300 dark:border-border dark:bg-card/85 dark:text-muted-foreground dark:hover:border-amber-500/40 dark:hover:bg-accent dark:hover:text-amber-400 whitespace-nowrap shrink-0"
              >
                <Flag className="size-4" />
                <span>Signaler un problème</span>
              </button>
            </div>

            {!isMember && (
              <p className="text-xs text-white/75 dark:text-muted-foreground">
                Mode invité : lecteur standard avec publicité.{' '}
                <Link to="/auth" className="font-medium text-primary underline">
                  Connectez-vous
                </Link>{' '}
                pour profiter du lecteur membre sans publicité et de la reprise automatique.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Interactive Seasons Tabs & Scrollable TMDB-Enriched Episodes */}
      {(episodes.length > 0 || seasonsMeta.length > 0) && (
        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-foreground tabular-nums">
                Épisodes ({episodes.filter((e) => e.available !== false).length}
                {episodes.some((e) => e.available === false) ? ` / ${episodes.length} TMDB` : ''})
              </h2>
              {activeSeasonMeta && (
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {activeSeasonMeta.name} · {activeSeasonMeta.availableCount} disponible
                  {activeSeasonMeta.availableCount > 1 ? 's' : ''} sur{' '}
                  {activeSeasonMeta.episodeCount}
                </p>
              )}
            </div>

            {rawSeasonCount > 20 && (
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={episodeFilter}
                  onChange={(e) => setEpisodeFilter(e.target.value)}
                  placeholder="Filtrer épisode ou titre…"
                  className="w-full rounded-lg border border-input bg-card py-2 pr-3 pl-9 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Season Tab Buttons (real TMDB seasons; unavailable seasons disabled) */}
          {seasonsMeta.length > 0 && (
            <div
              role="tablist"
              aria-label="Choisir une saison"
              className="mb-5 flex items-center gap-1.5 overflow-x-auto rounded-xl border border-border bg-card p-1.5"
            >
              {seasonsMeta.map((sMeta) => {
                const isSelected = selectedSeason === sMeta.seasonNumber;
                const disabled = !sMeta.available;
                return (
                  <button
                    key={sMeta.seasonNumber}
                    type="button"
                    role="tab"
                    disabled={disabled}
                    aria-selected={isSelected}
                    title={
                      disabled
                        ? 'Pas encore disponible sur le serveur'
                        : `${sMeta.name} (${sMeta.availableCount}/${sMeta.episodeCount})`
                    }
                    onClick={() => {
                      if (!disabled) {
                        setSelectedSeason(sMeta.seasonNumber);
                        setEpisodeFilter('');
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors tabular-nums whitespace-nowrap shrink-0 ${
                      disabled
                        ? 'cursor-not-allowed bg-background/40 text-muted-foreground/45 opacity-60'
                        : isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    {disabled && <Lock className="size-3 shrink-0" />}
                    <span>Saison {sMeta.seasonNumber}</span>
                    {disabled ? (
                      <span className="text-[10px] font-normal opacity-80">
                        · Pas encore disponible
                      </span>
                    ) : (
                      <span className="text-[11px] opacity-80">
                        ({sMeta.availableCount}/{sMeta.episodeCount})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Scrollable Episodes Container */}
          {currentSeasonEpisodes.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Aucun épisode trouvé pour ce filtre.
            </div>
          ) : (
            <div className="max-h-[38rem] overflow-y-auto rounded-xl border border-border bg-card">
              <ul className="divide-y divide-border">
                {currentSeasonEpisodes.map((ep, idx) => {
                  const code = `S${ep.saison}E${ep.episode}`;
                  const isWatched = watchedSet.has(code);
                  const isAvailable = ep.available !== false;

                  return (
                    <li key={`${code}-${idx}`}>
                      <button
                        type="button"
                        disabled={preparingPlayer || !isAvailable}
                        onClick={() => {
                          if (isAvailable) void launchPlayer(ep.saison, ep.episode);
                        }}
                        className={`group flex w-full flex-col gap-3 p-4 text-left transition-colors sm:flex-row sm:items-center sm:justify-between ${
                          isAvailable
                            ? 'hover:bg-accent/70'
                            : 'cursor-not-allowed bg-background/30 opacity-60'
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-4">
                          <EpisodeStill
                            src={ep.still}
                            alt={ep.titre || `Épisode ${ep.episode}`}
                            unavailable={!isAvailable}
                          />

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                              <span className="font-mono font-semibold text-primary">
                                S{String(ep.saison).padStart(2, '0')} · É
                                {String(ep.episode).padStart(2, '0')}
                              </span>
                              {ep.runtime && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="size-3" />
                                  {ep.runtime} min
                                </span>
                              )}
                              {ep.airDate && (
                                <span>
                                  {new Date(ep.airDate).toLocaleDateString('fr-FR')}
                                </span>
                              )}
                              {isWatched && isAvailable && (
                                <span className="inline-flex items-center gap-1 font-medium text-primary">
                                  <Check className="size-3.5" />
                                  <span>Vu</span>
                                </span>
                              )}
                            </div>

                            <p className="truncate text-sm font-semibold text-foreground sm:text-base">
                              {ep.titre || `Épisode ${ep.episode}`}
                            </p>

                            {ep.description && (
                              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {ep.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center justify-end gap-2 self-end sm:self-center">
                          {isAvailable ? (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary whitespace-nowrap">
                              <Play className="size-3.5 fill-current text-primary" />
                              <span>Lancer</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/50 px-3 py-1.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                              <Lock className="size-3.5" />
                              <span>Pas encore disponible</span>
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Casting */}
      {detailData.cast.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <h2 className="mb-5 font-display text-2xl font-semibold text-foreground">Distribution</h2>
          <div className="grid grid-cols-3 gap-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9">
            {detailData.cast.map((member, idx) => (
              <CastCard key={`${member.nom}-${idx}`} member={member} />
            ))}
          </div>
        </section>
      )}

      {/* Related titles */}
      {detailData.related.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <h2 className="mb-5 font-display text-2xl font-semibold text-foreground">À voir aussi</h2>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
            {detailData.related.slice(0, 6).map((rel) => (
              <PosterCard key={`rel-${rel.id}`} item={rel} />
            ))}
          </div>
        </section>
      )}

      {/* Same genre */}
      {detailData.sameGenre.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <h2 className="mb-5 font-display text-2xl font-semibold text-foreground">
            Dans le même genre
          </h2>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
            {detailData.sameGenre.map((g) => (
              <PosterCard key={`genre-${g.id}`} item={g} />
            ))}
          </div>
        </section>
      )}

      {/* Community comments & mentions */}
      <CommentsSection itemType={type} itemId={id} itemTitle={item.titre} />

      {/* Fullscreen Watch Modal */}
      {modal === 'watch' && playerUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Lecture de ${item.titre}`}
          className="fixed inset-0 z-50 flex flex-col bg-black"
        >
          <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-zinc-950 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-white sm:text-base">
                {item.titre}
                {effectiveType !== 'film' && (
                  <span className="ml-2 font-mono text-xs font-normal text-amber-400 tabular-nums">
                    S{activeEpisode.season} · É{activeEpisode.episode}
                  </span>
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {nextEpisode && (
                <button
                  type="button"
                  onClick={() => void launchPlayer(nextEpisode.saison, nextEpisode.episode)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
                >
                  <SkipForward className="size-3.5" />
                  <span>
                    Épisode suivant (S{nextEpisode.saison}·É{nextEpisode.episode})
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => openReportModal(activeEpisode.season, activeEpisode.episode)}
                title="Signaler un lien cassé ou mauvais épisode"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <Flag className="size-3.5" />
                <span className="hidden sm:inline">Signaler</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setWatchingItem(null);
                  setModal(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <X className="size-4" />
                <span>Fermer</span>
              </button>
            </div>
          </div>

          <div className="relative flex-1 bg-black">
            <iframe
              key={playerUrl}
              src={playerUrl}
              title={`Regarder — ${item.titre}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
        </div>
      )}

      {/* Trailer Modal */}
      {modal === 'trailer' && (() => {
        const youtubeId = extractYouTubeVideoId(item.trailer);
        if (!youtubeId) return null;
        const originParam =
          typeof window !== 'undefined' && window.location?.origin
            ? `&origin=${encodeURIComponent(window.location.origin)}`
            : '';
        const embedSrc = `https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&playsinline=1&enablejsapi=1${originParam}`;
        const externalUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Bande-annonce de ${item.titre}`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xs"
            onClick={() => setModal(null)}
          >
            <div className="w-full max-w-4xl space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="truncate font-display text-lg font-semibold text-white">
                  Bande-annonce — {item.titre}
                </h2>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap"
                  >
                    <ExternalLink className="size-3.5" />
                    <span>Ouvrir sur YouTube</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap"
                  >
                    <X className="size-4" />
                    <span>Fermer</span>
                  </button>
                </div>
              </div>
              <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black shadow-2xl">
                <iframe
                  src={embedSrc}
                  title={`Bande-annonce — ${item.titre}`}
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full border-0"
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Broken Stream / Wrong Episode Report Modal */}
      {reportModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Signaler un problème de lecture"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
          onClick={() => setReportModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">
                  Signaler un problème
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.titre} · {TYPE_LABELS[effectiveType]}
                </p>
              </div>
              <button
                type="button"
                aria-label="Fermer"
                onClick={() => setReportModalOpen(false)}
                className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmitReport(e)} className="space-y-4">
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-muted-foreground">
                  Type de problème
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    'Lien mort / ne charge pas',
                    'Mauvais film ou épisode',
                    'Son / audio décalé',
                    'Sous-titres manquants',
                    'Autre problème',
                  ].map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setReportReason(label)}
                      className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                        reportReason === label
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {effectiveType !== 'film' && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-muted-foreground">Saison</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={reportSeason}
                      onChange={(e) => setReportSeason(Math.max(1, Number(e.target.value) || 1))}
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-muted-foreground">Épisode</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={reportEpisode}
                      onChange={(e) => setReportEpisode(Math.max(1, Number(e.target.value) || 1))}
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>
              )}

              <label className="block text-xs">
                <span className="mb-1 block font-medium text-muted-foreground">
                  Détails complémentaires (optionnel)
                </span>
                <textarea
                  rows={3}
                  maxLength={400}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Ex : Écran noir après 5s, ou erreur 404 sur le lecteur…"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReportModalOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={reportSubmitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Flag className="size-3.5" />
                  <span>{reportSubmitting ? 'Envoi…' : 'Envoyer le signalement'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Guest Auth Alert Dialog */}
      {guestAuthAlertOpen && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="guest-report-alert-title"
          aria-describedby="guest-report-alert-desc"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
          onClick={() => setGuestAuthAlertOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <Lock className="size-5" />
              </div>
              <div className="space-y-1">
                <h2 id="guest-report-alert-title" className="font-display text-base font-bold text-foreground">
                  Connexion requise
                </h2>
                <p id="guest-report-alert-desc" className="text-sm text-muted-foreground">
                  Connecte-toi pour pouvoir demander ou signaler un contenu.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setGuestAuthAlertOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Fermer
              </button>
              <Link
                to="/auth"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <span>Se connecter</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
