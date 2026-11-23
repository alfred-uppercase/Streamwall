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
  Star,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PinoyFilm, PinoyPlayerSource } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { CommentsSection } from '../components/CommentsSection';

const FALLBACK_CINEMA_BACKDROP = '/src/assets/images/cinema_hero_backdrop_1794922115112.jpg';

function sanitizeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

const SimilarPinoyCard = memo(function SimilarPinoyCard({ film }: { film: PinoyFilm }) {
  const [imgFailed, setImgFailed] = useState(false);
  const safePoster = sanitizeHttpUrl(film.poster);
  const showImg = Boolean(safePoster && !imgFailed);

  return (
    <Link
      to={`/pinoy/${encodeURIComponent(film.slug)}`}
      className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
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
  );
});

export function PinoyDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { isMember, isAdmin, isPro } = useAuth();
  const canDownload = isAdmin || isPro;
  const [posterFailed, setPosterFailed] = useState(false);
  const [galleryHeroFailed, setGalleryHeroFailed] = useState(false);
  const [posterHeroFailed, setPosterHeroFailed] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [playerModalOpen, setPlayerModalOpen] = useState(false);

  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [guestAuthAlertOpen, setGuestAuthAlertOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Lien mort / ne charge pas');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  useEffect(() => {
    setPosterFailed(false);
    setGalleryHeroFailed(false);
    setPosterHeroFailed(false);
    setDescExpanded(false);
    setPlayerModalOpen(false);
    setReportModalOpen(false);
    setGuestAuthAlertOpen(false);
  }, [slug]);

  useEffect(() => {
    if (!playerModalOpen && !reportModalOpen && !guestAuthAlertOpen) return;
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
        setPlayerModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playerModalOpen, reportModalOpen, guestAuthAlertOpen]);

  const detailQuery = useQuery({
    queryKey: ['pinoy-detail', slug, canDownload ? 'unlocked' : 'locked'],
    queryFn: () => api.pinoyDetail(slug),
    enabled: Boolean(slug),
    staleTime: 180_000,
  });

  const data = detailQuery.data;
  const film = data?.film ?? null;
  useDocumentTitle(film ? `${film.titre} · Pinoy` : 'Film Pinoy');

  const embedPlayers: PinoyPlayerSource[] = (data?.players.embed ?? []).filter((p) =>
    Boolean(sanitizeHttpUrl(p.url))
  );
  const downloadPlayers: PinoyPlayerSource[] = (data?.players.download ?? []).filter((p) =>
    Boolean(sanitizeHttpUrl(p.url))
  );
  const isDownloadLocked =
    Boolean(data?.downloadLocked) || (!canDownload && downloadPlayers.length > 0);
  const downloadRestrictionMessage =
    data?.downloadMessage?.trim() ||
    'Le téléchargement direct est réservé aux membres Pro et aux administrateurs.';
  const primaryPlayer = embedPlayers[0] ?? null;

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

  if (detailQuery.isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 sm:px-6 sm:pt-28">
        <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />
      </main>
    );
  }

  if (detailQuery.isError || !film) {
    return (
      <main className="mx-auto max-w-7xl px-4 pt-24 pb-16 text-center sm:px-6 sm:pt-28">
        <h1 className="font-display text-3xl font-bold text-foreground">Film Pinoy introuvable</h1>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">
          Ce film n’existe plus ou l’API Pinoy est momentanément inaccessible.
        </p>
        <Link
          to="/pinoy"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <ArrowLeft className="size-4" />
          <span>Retour au catalogue Pinoy</span>
        </Link>
      </main>
    );
  }

  const safePoster = sanitizeHttpUrl(film.poster);
  const safeGallery = film.galerie
    .map((u) => sanitizeHttpUrl(u))
    .filter((u): u is string => Boolean(u));
  const firstGalleryPhoto = !galleryHeroFailed ? safeGallery[0] ?? null : null;
  const fallbackPosterPhoto = !posterHeroFailed ? safePoster : null;
  const backdropUrl = firstGalleryPhoto ?? fallbackPosterPhoto ?? FALLBACK_CINEMA_BACKDROP;

  const descrText = film.synopsis?.trim() || '';
  const isLongDescr = descrText.length > 240;

  const metaLine = [
    'Film Pinoy',
    film.annee ? String(film.annee) : null,
    film.duree || null,
    film.pays || null,
    film.date_sortie || film.sortie_le || null,
  ].filter(Boolean);

  return (
    <div>
      {/* Hero section — première photo de la galerie en bannière Background */}
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
              <span>Catalogue Pinoy</span>
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

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {primaryPlayer && (
                <button
                  type="button"
                  onClick={() => setPlayerModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
                >
                  <Play className="size-4 fill-current" />
                  <span>Regarder maintenant</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Direct download links (Admin & Pro only) */}
      {((canDownload && downloadPlayers.length > 0) || isDownloadLocked) && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-foreground">
                {canDownload && downloadPlayers.length > 0
                  ? `Liens de téléchargement (${downloadPlayers.length})`
                  : 'Liens de téléchargement'}
              </h2>
              {isDownloadLocked && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400">
                  <Crown className="size-3" />
                  <span>Réservé Pro & Admin</span>
                </span>
              )}
            </div>

            {canDownload && downloadPlayers.length > 0 ? (
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
                    to="/pricing"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Crown className="size-3.5" />
                    <span>Passer Pro</span>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Similar Pinoy films */}
      {data && data.similar.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <h2 className="mb-5 font-display text-2xl font-semibold text-foreground">
            Films similaires
          </h2>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
            {data.similar.map((sim) => (
              <SimilarPinoyCard key={`${sim.id}:${sim.slug}`} film={sim} />
            ))}
          </div>
        </section>
      )}

      {/* Community comments & mentions */}
      <CommentsSection itemType="pinoy" itemId={film.slug} itemTitle={film.titre} />

      {/* Fullscreen Player Modal */}
      {playerModalOpen && primaryPlayer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Lecture de ${film.titre}`}
          className="fixed inset-0 z-50 flex flex-col bg-black"
        >
          <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-zinc-950 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-white sm:text-base">
                {film.titre}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={openReportModal}
                title="Signaler un lien cassé ou un problème de lecture"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <Flag className="size-3.5" />
                <span className="hidden sm:inline">Signaler</span>
              </button>
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
              key={primaryPlayer.url}
              src={sanitizeHttpUrl(primaryPlayer.url) ?? undefined}
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
                  {film.titre} · Pinoy
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
    </div>
  );
}
