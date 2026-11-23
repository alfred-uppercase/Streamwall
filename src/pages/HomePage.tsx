import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import { TYPE_LABELS } from '../shared/types';
import type { Slide, WatchProgress } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { PosterCard, PosterSkeletonGrid } from '../components/PosterCard';
import { ProCrownBadge, UserAvatar } from '../components/UserAvatar';

const FALLBACK_CINEMA_BACKDROP = '/src/assets/images/cinema_hero_backdrop_1794922115112.jpg';

const HOME_CATEGORIES: readonly { genre: string; label: string }[] = [
  { genre: 'Action', label: 'Action' },
  { genre: 'Science-Fiction', label: 'Science-Fiction' },
  { genre: 'Thriller', label: 'Thriller' },
  { genre: 'Horreur', label: 'Horreur' },
  { genre: 'Comédie', label: 'Comédie' },
  { genre: 'Animation', label: 'Animation' },
];

function CategoryStripSection() {
  return (
    <section aria-label="Catégories" className="mb-14">
      <div className="grid grid-cols-[repeat(3,auto)] justify-start gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5">
        {HOME_CATEGORIES.map((cat) => (
          <Link
            key={cat.genre}
            to={`/catalogue?genre=${encodeURIComponent(cat.genre)}`}
            className="inline-flex w-fit justify-self-start items-center rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors duration-150 hover:border-primary/70 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-4 sm:py-2.5 sm:text-sm"
          >
            <span className="whitespace-nowrap">{cat.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function HeroSlider({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failedBackdrops, setFailedBackdrops] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (slides.length <= 1 || paused) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % slides.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [slides.length, paused]);

  const current = slides[index] ?? slides[0];
  if (!current) return null;

  const backdropSrc =
    !failedBackdrops[current.id] && (current.backdrop || current.poster)
      ? (current.backdrop || current.poster)!
      : FALLBACK_CINEMA_BACKDROP;

  const metaParts = [
    `À la une`,
    TYPE_LABELS[current.item_type] ?? current.item_type,
    current.annee ? String(current.annee) : null,
    current.qualite || null,
    current.langue || null,
  ].filter(Boolean);

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Sélection à la une"
      className="relative overflow-hidden border-b border-border bg-zinc-950 dark:bg-card"
    >
      <div className="relative flex min-h-[84dvh] flex-col justify-end sm:min-h-[32rem] sm:justify-center lg:min-h-[36rem]">
        <img
          key={`bg-${current.id}`}
          src={backdropSrc}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedBackdrops((prev) => ({ ...prev, [current.id]: true }))}
          className="absolute inset-0 h-full w-full object-cover opacity-90 brightness-105 transition-opacity duration-300"
        />
        {/* Top scrim ensures the transparent overlaid header always remains readable */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/75 via-black/35 to-transparent" />
        {/* Side and bottom scrims: black gradient in light mode, theme background gradient in dark mode */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/90 via-black/50 to-transparent dark:from-background/90 dark:via-background/45" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent sm:from-black/85 sm:via-black/30 dark:from-background dark:via-background/60 dark:sm:from-background/85 dark:sm:via-background/25" />

        <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between gap-8 px-4 pt-24 pb-16 sm:px-6 sm:pt-28 sm:pb-16 md:pt-32">
          <div className="min-w-0 max-w-2xl space-y-3 sm:space-y-4">
            <p className="text-xs font-medium text-primary tabular-nums drop-shadow-xs">
              {metaParts.join(' · ')}
            </p>

            <h1 className="font-display text-3xl font-bold tracking-tight text-white dark:text-foreground drop-shadow-sm sm:text-4xl md:text-5xl">
              {current.titre}
            </h1>

            {current.genre && (
              <p className="text-xs sm:text-sm text-white/75 dark:text-muted-foreground">{current.genre}</p>
            )}

            {current.descr && (
              <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-white/90 dark:text-foreground/90 sm:text-base">
                {current.descr}
              </p>
            )}

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <Link
                to={`/${current.item_type}/${current.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
              >
                <Play className="size-4 fill-current" />
                <span>Voir et regarder</span>
              </Link>
              <Link
                to="/catalogue"
                className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-black/45 px-4 py-2.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-black/65 dark:border-border dark:bg-background/80 dark:text-foreground dark:hover:bg-accent whitespace-nowrap shrink-0"
              >
                <span>Explorer le catalogue</span>
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          {current.poster && (
            <Link
              to={`/${current.item_type}/${current.id}`}
              className="hidden lg:block shrink-0 overflow-hidden rounded-xl border border-white/15 dark:border-border shadow-2xl transition-transform duration-200 hover:scale-[1.02]"
            >
              <img
                src={current.poster}
                alt={current.titre}
                referrerPolicy="no-referrer"
                className="h-72 w-48 object-cover"
              />
            </Link>
          )}
        </div>

        {slides.length > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10">
            <div className="pointer-events-auto mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6">
              <div className="flex items-center gap-2">
                {slides.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`Afficher ${s.titre}`}
                    onClick={() => setIndex(idx)}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      idx === index
                        ? 'w-8 bg-primary'
                        : 'w-2.5 bg-white/40 hover:bg-white/75 dark:bg-muted-foreground/45 dark:hover:bg-muted-foreground'
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Titre précédent"
                  onClick={() => setIndex((prev) => (prev - 1 + slides.length) % slides.length)}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-white/25 bg-black/50 text-white hover:bg-black/70 dark:border-border dark:bg-background/80 dark:text-foreground dark:hover:bg-accent"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Titre suivant"
                  onClick={() => setIndex((prev) => (prev + 1) % slides.length)}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-white/25 bg-black/50 text-white hover:bg-black/70 dark:border-border dark:bg-background/80 dark:text-foreground dark:hover:bg-accent"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ContinueWatchingSection({ items }: { items: WatchProgress[] }) {
  const queryClient = useQueryClient();
  const removeMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: string }) => api.removeProgress(type, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      void queryClient.invalidateQueries({ queryKey: ['member'] });
    },
  });

  if (items.length === 0) return null;

  const recentFive = items.slice(0, 5);

  return (
    <section className="mb-12">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold text-foreground">
            Dernières lectures ({recentFive.length}/5)
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Vos 5 derniers titres visionnés · La reprise exacte est gérée automatiquement par le lecteur.
          </p>
        </div>
        <Link
          to="/favoris"
          className="text-sm font-medium text-muted-foreground hover:text-primary whitespace-nowrap shrink-0"
        >
          Voir l’historique
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {recentFive.map((entry) => {
          const isEpisodic = entry.item.item_type !== 'film';
          const resumeLabel = isEpisodic
            ? `Saison ${entry.season} · Épisode ${entry.episode}`
            : new Date(entry.updatedAt).toLocaleDateString('fr-FR');
          return (
            <div
              key={`${entry.item.item_type}:${entry.item.id}`}
              className="group relative flex min-w-0 w-full items-center gap-3 sm:gap-4 overflow-hidden rounded-xl border border-border bg-card p-3 sm:p-3.5 transition-colors hover:border-primary/70"
            >
              <Link
                to={`/${entry.item.item_type}/${entry.item.id}?autoplay=1&s=${entry.season}&e=${entry.episode}`}
                className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4"
              >
                <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-md bg-background border border-border">
                  {entry.item.poster && (
                    <img
                      src={entry.item.poster}
                      alt={entry.item.titre}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm sm:text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                    {entry.item.titre}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
                    {TYPE_LABELS[entry.item.item_type]} · {resumeLabel}
                  </p>
                  <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Play className="size-3.5 fill-current" />
                    <span>Regarder</span>
                  </span>
                </div>
              </Link>
              <button
                type="button"
                aria-label={`Retirer ${entry.item.titre} de l’historique`}
                title="Retirer de l’historique"
                onClick={() =>
                  removeMutation.mutate({ type: entry.item.item_type, id: entry.item.id })
                }
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HomePage() {
  useDocumentTitle('Accueil');
  const { isMember, user } = useAuth();
  const homeQuery = useQuery({
    queryKey: ['home', user?.id ?? 'guest'],
    queryFn: () => api.home(),
    staleTime: 60_000,
  });

  const data = homeQuery.data;
  const heroSlides = data
    ? data.slider.length > 0
      ? data.slider
      : data.latest.slice(0, 5).map((item) => ({ ...item, descr: null, backdrop: null }))
    : [];
  const hasHero = homeQuery.isLoading || heroSlides.length > 0;

  return (
    <div>
      {homeQuery.isLoading ? (
        <section className="relative overflow-hidden border-b border-border bg-card">
          <div className="min-h-[84dvh] sm:min-h-[32rem] lg:min-h-[36rem] animate-pulse bg-card/80 pt-24 pb-16" />
        </section>
      ) : (
        heroSlides.length > 0 && <HeroSlider slides={heroSlides} />
      )}

      <main
        className={`mx-auto max-w-7xl px-4 pb-8 sm:px-6 sm:pb-10 ${
          hasHero ? 'pt-8 sm:pt-10' : 'pt-24 sm:pt-28'
        }`}
      >
        {isMember && data && <ContinueWatchingSection items={data.continueWatching} />}

        {/* Derniers ajouts */}
        <section className="mb-8">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl font-bold text-foreground">Derniers ajouts</h2>
            <Link
              to="/catalogue"
              className="text-sm font-medium text-muted-foreground hover:text-primary whitespace-nowrap shrink-0"
            >
              Tout le catalogue →
            </Link>
          </div>
          {homeQuery.isLoading ? (
            <PosterSkeletonGrid count={12} />
          ) : data?.latest.length ? (
            <div className="grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
              {data.latest.map((item) => (
                <PosterCard key={`${item.item_type}:${item.id}`} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun titre disponible pour le moment.</p>
          )}
        </section>

        <CategoryStripSection />

        {/* Uniquement pour toi */}
        {isMember && Boolean(data?.forYou.length) && (
          <section className="mb-14">
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-foreground">
                  Uniquement pour toi
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Recommandations basées sur vos derniers visionnages
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
              {data!.forYou.map((item) => (
                <PosterCard key={`fy-${item.item_type}:${item.id}`} item={item} />
              ))}
            </div>
          </section>
        )}

      {/* Activité des amis */}
      {isMember && Boolean(data?.friendsActivity.length) && (
        <section className="mb-14">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Regardé récemment par vos amis
            </h2>
            <Link
              to="/profil"
              className="text-sm font-medium text-muted-foreground hover:text-primary whitespace-nowrap shrink-0"
            >
              Gérer mes amis
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data!.friendsActivity.map((act, idx) => (
              <Link
                key={`${act.username}-${act.item.id}-${idx}`}
                to={`/${act.item.item_type}/${act.item.id}`}
                className="flex min-w-0 w-full items-center gap-3 sm:gap-4 overflow-hidden rounded-xl border border-border bg-card p-3.5 sm:p-4 transition-colors hover:border-primary/70"
              >
                {act.item.poster && (
                  <img
                    src={act.item.poster}
                    alt={act.item.titre}
                    referrerPolicy="no-referrer"
                    className="h-16 w-11 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{act.item.titre}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <UserAvatar
                      avatar={act.avatar}
                      seed={act.username}
                      username={act.username}
                      isPro={act.isPro}
                      size="xs"
                    />
                    <span className="truncate font-medium text-foreground/90">@{act.username}</span>
                    {act.isPro && <ProCrownBadge />}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {new Date(act.viewedAt).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Top de la semaine */}
      <section className="mb-8">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-foreground">Top de la semaine</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Classement par nombre de spectateurs distincts sur 7 jours
            </p>
          </div>
        </div>
        {data?.week.length ? (
          <div className="grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
            {data.week.map((entry, idx) => (
              <PosterCard
                key={`wk-${entry.item.item_type}:${entry.item.id}`}
                item={entry.item}
                rankNumber={idx + 1}
                subtitleOverride={`${entry.viewers} spectateur${entry.viewers > 1 ? 's' : ''}`}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Aucun visionnage membre enregistré cette semaine.
            </p>
            <Link
              to="/catalogue"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              <span>Explorer le catalogue</span>
            </Link>
          </div>
        )}
      </section>
      </main>
    </div>
  );
}
