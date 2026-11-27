import React, { memo, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  Crown,
  Download,
  ExternalLink,
  Film,
  Flag,
  Globe,
  Lock,
  Play,
  Server,
  Star,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  Item,
  LockedPinoyDownloadItem,
  PinoyFilm,
  PinoyPlayerSource,
} from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { CommentsSection } from '../components/CommentsSection';
import { FavoriteButton } from '../components/PosterCard';

const FALLBACK_CINEMA_BACKDROP = '/src/assets/images/cinema_hero_backdrop_1794922115112.jpg';

function sanitizeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function sanitizePlayerUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\/api\/public\/watch\/[a-zA-Z0-9/._-]+$/.test(trimmed)) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function pinoyToFavoriteItem(film: PinoyFilm, badgeText?: string | null): Item {
  return {
    id: film.slug || String(film.id),
    titre: film.titre,
    poster: sanitizeHttpUrl(film.poster),
    qualite: film.note !== null ? `★ ${film.note.toFixed(1)}` : badgeText || null,
    langue: film.pays || null,
    item_type: 'pinoy',
    saison: null,
    genre: film.genres[0] ?? null,
    annee: film.annee,
  };
}

const SimilarPinoyCard = memo(function SimilarPinoyCard({
  film,
  badgeText,
}: {
  film: PinoyFilm;
  badgeText?: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const safePoster = sanitizeHttpUrl(film.poster);
  const showImg = Boolean(safePoster && !imgFailed);

  return (
    <div className="group relative flex flex-col">
      <Link
        to={`/pinoy/${encodeURIComponent(film.slug)}`}
        className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-border bg-card transition-colors duration-200 group-hover:border-primary/80">
          {showImg ? (
            <img
              src={safePoster!}
              alt={film.titre}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-card to-background p-3 text-center">
              <Film className="size-6 text-primary/70" />
              <span className="line-clamp-3 font-display text-xs font-semibold text-foreground/90">
                {film.titre}
              </span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <Play className="size-4 fill-current ml-0.5" />
            </span>
          </div>
        </div>
        <h3 className="mt-2 line-clamp-1 text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          {film.titre}
        </h3>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">
          {[film.annee ? String(film.annee) : null, film.duree || null].filter(Boolean).join(' · ')}
        </p>
      </Link>

      <div className="absolute right-1.5 top-1.5 sm:right-2 sm:top-2 z-10">
        <FavoriteButton item={pinoyToFavoriteItem(film, badgeText)} compact />
      </div>
    </div>
  );
});

export function PinoyDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user, loading: authLoading, isMember, isAdmin, isPro } = useAuth();
  const [posterFailed, setPosterFailed] = useState(false);
  const [galleryHeroFailed, setGalleryHeroFailed] = useState(false);
  const [posterHeroFailed, setPosterHeroFailed] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [playerModalOpen, setPlayerModalOpen] = useState(false);
  const [selectedPlayerIdx, setSelectedPlayerIdx] = useState(0);

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [guestAuthAlertOpen, setGuestAuthAlertOpen] = useState(false);
  const [lockedDownloadPrompt, setLockedDownloadPrompt] =
    useState<LockedPinoyDownloadItem | null>(null);
  const [reportReason, setReportReason] = useState('Lien mort / ne charge pas');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  useEffect(() => {
    setPosterFailed(false);
    setGalleryHeroFailed(false);
    setPosterHeroFailed(false);
    setDescExpanded(false);
    setPlayerModalOpen(false);
    setSelectedPlayerIdx(0);
    setReportModalOpen(false);
    setGuestAuthAlertOpen(false);
    setLockedDownloadPrompt(null);
  }, [slug]);

  useEffect(() => {
    if (!playerModalOpen && !reportModalOpen && !guestAuthAlertOpen && !lockedDownloadPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lockedDownloadPrompt) {
          setLockedDownloadPrompt(null);
          return;
        }
        if (guestAuthAlertOpen) {
          setGuestAuthAlertOpen(false);
          return;
        }
        if (reportModalOpen) {
          setReportModalOpen(false);
          return;
        }
        setPlayerModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playerModalOpen, reportModalOpen, guestAuthAlertOpen, lockedDownloadPrompt]);

  const detailQuery = useQuery({
    queryKey: [
      'pinoy-detail',
      slug,
      isMember ? (user?.id ?? 'member') : 'guest',
      isAdmin || isPro ? 'privileged' : 'standard',
    ],
    queryFn: () => api.pinoyDetail(slug),
    enabled: Boolean(slug) && !authLoading,
    staleTime: 30_000,
    retry: false,
  });

  const data = detailQuery.data;
  const mod = data?.module ?? null;
  const film = data?.film ?? null;
  const moduleName = mod?.name?.trim() || 'Pinoy';
  const badgeLabel = mod?.badgeText?.trim() || 'Film Pinoy';

  useDocumentTitle(film ? `${film.titre} · ${moduleName}` : moduleName);

  const embedPlayers: PinoyPlayerSource[] = (data?.players.embed ?? []).filter((p) =>
    Boolean(sanitizePlayerUrl(p.url))
  );
  const downloadPlayers: PinoyPlayerSource[] = (data?.players.download ?? []).filter((p) =>
    Boolean(sanitizeHttpUrl(p.url))
  );
  const lockedDownloads: LockedPinoyDownloadItem[] = data?.lockedDownloads ?? [];
  const activePlayer = embedPlayers[selectedPlayerIdx] ?? embedPlayers[0] ?? null;

  const downloadProOnly = mod?.player.downloadProOnly ?? true;
  const canDownload = !downloadProOnly || isAdmin || isPro;
  const isDownloadLocked =
    Boolean(data?.downloadLocked) ||
    lockedDownloads.length > 0 ||
    (downloadProOnly && !canDownload && downloadPlayers.length > 0);
  const downloadRestrictionMessage =
    data?.downloadMessage?.trim() ||
    mod?.player.downloadRestrictionMessage ||
    'Le téléchargement direct est réservé aux membres Pro et aux administrateurs.';

  const showHeroGallery = mod ? mod.sections.detailShowHeroGallery : true;
  const showSynopsis = mod ? mod.sections.detailShowSynopsis : true;
  const showAvailablePlayersList = mod ? mod.sections.detailShowAvailablePlayersList : false;
  const showDownloads = mod ? mod.sections.detailShowDownloads : true;
  const showGallerySection = mod ? mod.sections.detailShowGallerySection : false;
  const showSimilar = mod ? mod.sections.detailShowSimilar : true;
  const showComments = mod ? mod.sections.detailShowComments : true;
  const showReportButton = mod ? mod.sections.detailShowReportButton : true;
  const showServerSwitcherInModal = mod?.player.showServerSwitcherInModal ?? false;

  function openReportModal() {
    if (!isMember) {
      toast.error('Connecte-toi pour pouvoir demander ou signaler un contenu.');
      setGuestAuthAlertOpen(true);
      return;
    }
    setReportReason('Lien mort / ne charge pas');
    setReportDetails('');
    setReportModalOpen(true);
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!film || reportSubmitting) return;
    if (!isMember) {
      setReportModalOpen(false);
      setGuestAuthAlertOpen(true);
      return;
    }
    setReportSubmitting(true);
    try {
      await api.reportBrokenStream({
        itemType: 'pinoy',
        itemId: film.slug,
        itemTitle: film.titre,
        reason: reportReason,
        comment: reportDetails.trim(),
      });
      toast.success('Signalement envoyé à l’équipe. Merci pour votre aide !');
      setReportModalOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Envoi du signalement impossible.');
    } finally {
      setReportSubmitting(false);
    }
  }

  if (authLoading || detailQuery.isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 sm:px-6 sm:pt-28">
        <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />
      </main>
    );
  }

  if (detailQuery.isError || !film) {
    return (
      <main className="mx-auto max-w-7xl px-4 pt-24 pb-16 text-center sm:px-6 sm:pt-28">
        <h1 className="font-display text-3xl font-bold text-foreground">Contenu introuvable</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">
          Ce titre n’existe plus ou l’API du module « {moduleName} » est momentanément inaccessible.
        </p>
        <Link
          to="/pinoy"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <ArrowLeft className="size-4" />
          <span>Retour au catalogue {moduleName}</span>
        </Link>
      </main>
    );
  }

  const safePoster = sanitizeHttpUrl(film.poster);
  const safeGallery = film.galerie
    .map((u) => sanitizeHttpUrl(u))
    .filter((u): u is string => Boolean(u));
  const firstGalleryPhoto = showHeroGallery && !galleryHeroFailed ? safeGallery[0] ?? null : null;
  const fallbackPosterPhoto = !posterHeroFailed ? safePoster : null;
  const backdropUrl = firstGalleryPhoto ?? fallbackPosterPhoto ?? FALLBACK_CINEMA_BACKDROP;

  const descrText = film.synopsis?.trim() || '';
  const isLongDescr = descrText.length > 240;

  const metaLine = [
    badgeLabel,
    film.annee ? String(film.annee) : null,
    film.duree || null,
    film.pays || null,
    film.date_sortie || film.sortie_le || null,
  ].filter(Boolean);

  return (
    <div>
      {/* Hero section */}
      <section className="relative overflow-hidden border-b border-border bg-zinc-950 dark:bg-card">
        <img
          src={backdropUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => {
            if (firstGalleryPhoto) {
              setGalleryHeroFailed(true);
            } else if (fallbackPosterPhoto) {
              setPosterHeroFailed(true);
            }
          }}
          className="absolute inset-0 h-full w-full object-cover object-center opacity-75 brightness-105 transition-opacity duration-300"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 via-black/30 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent dark:from-background/90 dark:via-background/40" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent dark:from-background dark:via-background/55" />

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-8 px-4 pt-24 pb-10 sm:px-6 sm:pt-28 md:flex-row md:items-end md:pt-32 md:pb-14">
          <div className="w-44 shrink-0 overflow-hidden rounded-xl border border-white/15 dark:border-border bg-card shadow-2xl sm:w-56">
            {safePoster && !posterFailed ? (
              <img
                src={safePoster}
                alt={film.titre}
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
            <Link
              to="/pinoy"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-primary"
            >
              <ArrowLeft className="size-3.5" />
              <span>Catalogue {moduleName}</span>
            </Link>

            <p className="text-xs font-medium text-primary tabular-nums drop-shadow-xs">
              {metaLine.join(' · ')}
            </p>

            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-white dark:text-foreground drop-shadow-sm sm:text-5xl">
                {film.titre}
              </h1>
              {film.titre_original && film.titre_original !== film.titre && (
                <p className="mt-1 text-sm text-white/75 dark:text-muted-foreground">
                  {film.titre_original}
                </p>
              )}
            </div>

            {film.genres.length > 0 && (
              <p className="text-sm text-white/80 dark:text-muted-foreground">
                {film.genres.join(' · ')}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/90 dark:text-foreground">
              {film.note !== null && (
                <div className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                  <Star className="size-4 fill-amber-400 text-amber-400" />
                  <span>{film.note.toFixed(1)}</span>
                  <span className="text-xs font-normal text-white/70 dark:text-muted-foreground">
                    / 10
                  </span>
                </div>
              )}
              {film.duree && (
                <div className="inline-flex items-center gap-1.5 text-xs text-white/80 dark:text-muted-foreground">
                  <Clock className="size-3.5" />
                  <span>{film.duree}</span>
                </div>
              )}
              {film.pays && (
                <div className="inline-flex items-center gap-1.5 text-xs text-white/80 dark:text-muted-foreground">
                  <Globe className="size-3.5" />
                  <span>{film.pays}</span>
                </div>
              )}
            </div>

            {showSynopsis && descrText && (
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

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {activePlayer && (
                <button
                  type="button"
                  onClick={() => {
                    api.recordPlayEvent({
                      itemType: 'pinoy',
                      itemId: String(film.id),
                      slug: film.slug,
                      title: film.titre,
                      poster: film.poster,
                    });
                    setSelectedPlayerIdx(0);
                    setPlayerModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
                >
                  <Play className="size-4 fill-current" />
                  <span>Regarder maintenant</span>
                </button>
              )}

              <FavoriteButton item={pinoyToFavoriteItem(film, mod?.badgeText)} />

              {showReportButton && (
                <button
                  type="button"
                  onClick={openReportModal}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black/45 px-4 py-3 text-xs font-semibold text-white hover:bg-black/70 whitespace-nowrap shrink-0"
                >
                  <Flag className="size-3.5 text-amber-400" />
                  <span>Signaler un lien</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Optional Available Players List */}
      {showAvailablePlayersList && embedPlayers.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Lecteurs disponibles ({embedPlayers.length})
            </h2>
            <div className="flex flex-wrap gap-2.5">
              {embedPlayers.map((pl, idx) => (
                <button
                  key={`${pl.provider}-${idx}`}
                  type="button"
                  onClick={() => {
                    api.recordPlayEvent({
                      itemType: 'pinoy',
                      itemId: String(film.id),
                      slug: film.slug,
                      title: film.titre,
                      poster: film.poster,
                    });
                    setSelectedPlayerIdx(idx);
                    setPlayerModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/70 hover:bg-accent"
                >
                  <Server className="size-3.5 text-primary" />
                  <span>{pl.provider}</span>
                  {(pl.quality || pl.language) && (
                    <span className="text-muted-foreground font-normal">
                      ({[pl.quality, pl.language].filter(Boolean).join(' · ')})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Optional Download links (configured Pro-only or open in Module Pinoy) */}
      {showDownloads && ((!isDownloadLocked && downloadPlayers.length > 0) || isDownloadLocked) && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-foreground">
                {!isDownloadLocked && downloadPlayers.length > 0
                  ? `Liens de téléchargement (${downloadPlayers.length})`
                  : lockedDownloads.length > 0
                    ? `Liens de téléchargement (${lockedDownloads.length})`
                    : 'Liens de téléchargement'}
              </h2>
              {isDownloadLocked && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400">
                  <Crown className="size-3" />
                  <span>Réservé Pro</span>
                </span>
              )}
            </div>

            {!isDownloadLocked && downloadPlayers.length > 0 ? (
              <div className="flex flex-wrap gap-2.5">
                {downloadPlayers.map((dl, idx) => {
                  const safeHref = sanitizeHttpUrl(dl.url);
                  if (!safeHref) return null;
                  const meta = [dl.quality, dl.language].filter(Boolean).join(' · ');
                  return (
                    <a
                      key={`${dl.provider}-${idx}`}
                      href={safeHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/70 hover:bg-accent"
                    >
                      <Download className="size-3.5 text-primary" />
                      <span>Télécharger · {dl.provider}</span>
                      {meta && <span className="text-muted-foreground font-normal">({meta})</span>}
                      <ExternalLink className="size-3 text-muted-foreground" />
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {lockedDownloads.length > 0 && (
                  <div className="flex flex-wrap gap-2.5">
                    {lockedDownloads.map((dl, idx) => {
                      const meta = [dl.quality, dl.language].filter(Boolean).join(' · ');
                      return (
                        <button
                          key={`locked-${dl.provider}-${idx}`}
                          type="button"
                          onClick={() => setLockedDownloadPrompt(dl)}
                          className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-background/80 px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:border-amber-400/70 hover:bg-amber-500/10"
                        >
                          <Lock className="size-3.5 text-amber-400" />
                          <span>Télécharger · {dl.provider}</span>
                          {meta && <span className="text-muted-foreground font-normal">({meta})</span>}
                          <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                            <Crown className="size-2.5" />
                            <span>Pro</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                      <Lock className="size-4" />
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                      {downloadRestrictionMessage}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!isMember && (
                      <Link
                        to="/auth"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
                      >
                        <span>Se connecter</span>
                      </Link>
                    )}
                    <Link
                      to="/abonnement"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <Crown className="size-3.5" />
                      <span>Souscrire à une offre Pro</span>
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Optional Gallery Section */}
      {showGallerySection && safeGallery.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <h2 className="mb-4 font-display text-2xl font-semibold text-foreground">
            Galerie d’images
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {safeGallery.map((imgUrl, idx) => (
              <div
                key={`${imgUrl}-${idx}`}
                className="overflow-hidden rounded-xl border border-border bg-card aspect-video"
              >
                <img
                  src={imgUrl}
                  alt={`${film.titre} — image ${idx + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Similar films */}
      {showSimilar && data && data.similar.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <h2 className="mb-5 font-display text-2xl font-semibold text-foreground">
            Titres similaires
          </h2>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
            {data.similar.map((sim) => (
              <SimilarPinoyCard
                key={`${sim.id}:${sim.slug}`}
                film={sim}
                badgeText={mod?.badgeText}
              />
            ))}
          </div>
        </section>
      )}

      {/* Community comments & mentions */}
      {showComments && (
        <CommentsSection itemType="pinoy" itemId={film.slug} itemTitle={film.titre} />
      )}

      {/* Fullscreen Player Modal */}
      {playerModalOpen && activePlayer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Lecture de ${film.titre}`}
          className="fixed inset-0 z-50 flex flex-col bg-black"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-zinc-950 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold text-white sm:text-base">
                {film.titre}
              </p>
            </div>

            {showServerSwitcherInModal && embedPlayers.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {embedPlayers.map((srv, idx) => (
                  <button
                    key={`${srv.provider}-${idx}`}
                    type="button"
                    onClick={() => setSelectedPlayerIdx(idx)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      selectedPlayerIdx === idx
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-white/15 bg-zinc-900 text-white/80 hover:text-white'
                    }`}
                  >
                    {srv.provider}
                  </button>
                ))}
              </div>
            )}

            <div className="flex shrink-0 items-center gap-2">
              {showReportButton && (
                <button
                  type="button"
                  onClick={openReportModal}
                  title="Signaler un lien cassé ou un problème de lecture"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-zinc-800 whitespace-nowrap shrink-0"
                >
                  <Flag className="size-3.5" />
                  <span className="hidden sm:inline">Signaler</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setPlayerModalOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <X className="size-4" />
                <span>Fermer</span>
              </button>
            </div>
          </div>

          <div className="relative flex-1 bg-black">
            <iframe
              key={activePlayer.url}
              src={sanitizePlayerUrl(activePlayer.url) ?? undefined}
              title={`Regarder — ${film.titre}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
        </div>
      )}

      {/* Broken Stream Report Modal */}
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
                  {film.titre} · {moduleName}
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
                    'Mauvais film',
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
          aria-labelledby="guest-pinoy-report-alert-title"
          aria-describedby="guest-pinoy-report-alert-desc"
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
                <h2
                  id="guest-pinoy-report-alert-title"
                  className="font-display text-base font-bold text-foreground"
                >
                  Connexion requise
                </h2>
                <p id="guest-pinoy-report-alert-desc" className="text-sm text-muted-foreground">
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
      {/* Locked Download Prompt Dialog */}
      {lockedDownloadPrompt && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="pinoy-locked-dl-title"
          aria-describedby="pinoy-locked-dl-desc"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
          onClick={() => setLockedDownloadPrompt(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <Crown className="size-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h2
                  id="pinoy-locked-dl-title"
                  className="font-display text-base font-bold text-foreground"
                >
                  {!isMember ? 'Connexion ou offre Pro requise' : 'Téléchargement réservé aux offres Pro'}
                </h2>
                <p className="truncate text-xs font-medium text-primary">
                  {lockedDownloadPrompt.provider}
                  {[lockedDownloadPrompt.quality, lockedDownloadPrompt.language].filter(Boolean).length > 0
                    ? ` · ${[lockedDownloadPrompt.quality, lockedDownloadPrompt.language]
                        .filter(Boolean)
                        .join(' · ')}`
                    : ''}
                </p>
                <p
                  id="pinoy-locked-dl-desc"
                  className="pt-1 text-sm leading-relaxed text-muted-foreground"
                >
                  {downloadRestrictionMessage}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setLockedDownloadPrompt(null)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Fermer
              </button>
              {!isMember && (
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent"
                >
                  <span>Se connecter</span>
                </Link>
              )}
              <Link
                to="/abonnement"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Crown className="size-3.5" />
                <span>Souscrire à une offre Pro</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
