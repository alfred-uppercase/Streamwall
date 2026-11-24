import React, { memo, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Film, Play, RotateCcw, Search, Settings, Star } from 'lucide-react';
import type { Item, PinoyFilm, PinoyListFilters } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { FavoriteButton, PosterSkeletonGrid } from '../components/PosterCard';

function sanitizePosterUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function pinoyToFavoriteItem(film: PinoyFilm): Item {
  return {
    id: film.slug || String(film.id),
    titre: film.titre,
    poster: sanitizePosterUrl(film.poster),
    qualite: film.note !== null ? `★ ${film.note.toFixed(1)}` : null,
    langue: film.pays || null,
    item_type: 'pinoy',
    saison: null,
    genre: film.genres[0] ?? null,
    annee: film.annee,
  };
}

const PinoyCard = memo(function PinoyCard({ film }: { film: PinoyFilm }) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [film.poster]);

  const safePoster = sanitizePosterUrl(film.poster);
  const showImg = Boolean(safePoster && !imgFailed);

  const metaParts = [
    film.annee ? String(film.annee) : null,
    film.duree || null,
    film.pays || null,
  ].filter(Boolean);

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
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 sm:gap-3 bg-gradient-to-b from-card to-background p-2.5 sm:p-4 text-center">
              <Film className="size-6 sm:size-8 text-primary/70" />
              <span className="line-clamp-3 font-display text-[11px] sm:text-sm font-semibold text-foreground/90">
                {film.titre}
              </span>
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <span className="inline-flex size-8 sm:size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <Play className="size-3.5 sm:size-5 fill-current ml-0.5" />
            </span>
          </div>
        </div>

        <h3 className="mt-1.5 sm:mt-2.5 line-clamp-1 text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
          {film.titre}
        </h3>

        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] sm:text-xs text-muted-foreground tabular-nums leading-tight">
          {film.note !== null && (
            <span className="inline-flex items-center gap-0.5 font-medium text-amber-400 shrink-0">
              <Star className="size-3 fill-current" />
              <span>{film.note.toFixed(1)}</span>
            </span>
          )}
          {film.note !== null && metaParts.length > 0 && <span aria-hidden="true">·</span>}
          {metaParts.length > 0 && <span className="truncate">{metaParts.join(' · ')}</span>}
        </p>
      </Link>

      <div className="absolute right-1.5 top-1.5 sm:right-2 sm:top-2 z-10">
        <FavoriteButton item={pinoyToFavoriteItem(film)} compact />
      </div>
    </div>
  );
});

export function PinoyCataloguePage() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQ = searchParams.get('q') ?? '';
  const [input, setInput] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [genre, setGenre] = useState(searchParams.get('genre') ?? '');
  const [pays, setPays] = useState(searchParams.get('pays') ?? '');
  const [annee, setAnnee] = useState(searchParams.get('annee') ?? '');
  const [sort, setSort] = useState<PinoyListFilters['sort']>(() => {
    const raw = searchParams.get('sort');
    return raw === 'recent' || raw === 'oldest' || raw === 'az' || raw === 'za' || raw === 'note'
      ? raw
      : 'recent';
  });
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));

  useDocumentTitle(q ? `Pinoy · « ${q} »` : 'Pinoy · Films');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = input.trim();
      if (trimmed !== q) {
        setQ(trimmed);
        setPage(1);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [input, q]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (genre) next.set('genre', genre);
    if (pays) next.set('pays', pays);
    if (annee) next.set('annee', annee);
    if (sort !== 'recent') next.set('sort', sort);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
  }, [q, genre, pays, annee, sort, page, setSearchParams]);

  const filters: PinoyListFilters = { q, genre, pays, annee, sort, page };

  const facetsQuery = useQuery({
    queryKey: ['pinoy-facets'],
    queryFn: () => api.pinoyFacets(),
    staleTime: 300_000,
    retry: false,
  });

  const listQuery = useQuery({
    queryKey: ['pinoy-list', filters],
    queryFn: () => api.pinoyList(filters),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });

  const years = useMemo(() => {
    const maxY = facetsQuery.data?.annees.max ?? new Date().getFullYear();
    const minY = facetsQuery.data?.annees.min ?? 1980;
    const clampedMin = Math.max(1900, Math.min(minY, maxY));
    const list: string[] = [];
    for (let y = maxY; y >= clampedMin; y--) {
      list.push(String(y));
    }
    return list;
  }, [facetsQuery.data?.annees.max, facetsQuery.data?.annees.min]);

  const genres = facetsQuery.data?.genres ?? [];
  const countries = facetsQuery.data?.pays ?? [];
  const data = listQuery.data;
  const items = data?.items ?? [];
  const isUnconfigured = data?.status === 'unconfigured';

  const hasActiveFilters =
    Boolean(input) || Boolean(genre) || Boolean(pays) || Boolean(annee) || sort !== 'recent';

  function resetAll() {
    setInput('');
    setQ('');
    setGenre('');
    setPays('');
    setAnnee('');
    setSort('recent');
    setPage(1);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Pinoy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catalogue de films Pinoy avec lecteur intégré et liens disponibles.
          </p>
        </div>
        {!isUnconfigured && (
          <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
            {listQuery.isFetching
              ? 'Actualisation…'
              : `${(data?.total ?? 0).toLocaleString('fr-FR')} film${
                  (data?.total ?? 0) > 1 ? 's' : ''
                }`}
          </p>
        )}
      </div>

      {/* Search bar */}
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-primary" />
        <input
          type="search"
          aria-label="Rechercher un film Pinoy"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Rechercher un titre, titre original ou synopsis…"
          className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      {/* Filter toolbar */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <select
          aria-label="Genre"
          value={genre}
          onChange={(e) => {
            setGenre(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="">Tous les genres</option>
          {genres.map((g) => (
            <option key={g.nom} value={g.nom}>
              {g.nom} ({g.total})
            </option>
          ))}
        </select>

        {countries.length > 0 && (
          <select
            aria-label="Pays"
            value={pays}
            onChange={(e) => {
              setPays(e.target.value);
              setPage(1);
            }}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">Tous les pays</option>
            {countries.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} ({p.total})
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Année"
          value={annee}
          onChange={(e) => {
            setAnnee(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
        >
          <option value="">Toutes les années</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <select
          aria-label="Trier par"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as PinoyListFilters['sort']);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="recent">Plus récents</option>
          <option value="oldest">Plus anciens</option>
          <option value="note">Mieux notés</option>
          <option value="az">Titre A → Z</option>
          <option value="za">Titre Z → A</option>
        </select>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground whitespace-nowrap shrink-0"
          >
            <RotateCcw className="size-3.5" />
            <span>Réinitialiser</span>
          </button>
        )}
      </div>

      {/* Results grid */}
      {listQuery.isLoading && !data ? (
        <PosterSkeletonGrid count={18} />
      ) : isUnconfigured ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center space-y-3">
          <Film className="mx-auto size-10 text-primary/80" />
          <h2 className="font-display text-xl font-semibold text-foreground">
            Source API Pinoy à configurer
          </h2>
          <p className="mx-auto max-w-lg text-sm text-muted-foreground">
            {isAdmin
              ? 'Renseignez l’URL complète de votre script korotoko_ph.php dans l’administration pour charger le catalogue Pinoy.'
              : 'Le catalogue Pinoy est en cours de configuration et sera bientôt disponible.'}
          </p>
          {isAdmin && (
            <div className="pt-2">
              <Link
                to="/admin?tab=api"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Settings className="size-4" />
                <span>Configurer l’API Pinoy</span>
              </Link>
            </div>
          )}
        </div>
      ) : listQuery.isError ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center space-y-3">
          <p className="text-base font-medium text-foreground">
            Le catalogue Pinoy est désactivé ou momentanément indisponible.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vérifiez la configuration dans l’administration ou réessayez dans quelques instants.
          </p>
          {isAdmin && (
            <Link
              to="/admin?tab=modules"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              <Settings className="size-3.5" />
              <span>Gérer APIs & Lecteurs</span>
            </Link>
          )}
        </div>
      ) : items.length > 0 ? (
        <div
          className={`grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6 transition-opacity duration-150 ${
            listQuery.isFetching ? 'opacity-65' : 'opacity-100'
          }`}
        >
          {items.map((film) => (
            <PinoyCard key={`${film.id}:${film.slug}`} film={film} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-base font-medium text-foreground">
            Aucun film Pinoy ne correspond à ces critères.
          </p>
          <p className="mt-1 mb-5 text-sm text-muted-foreground">
            Essayez d’élargir la recherche ou de réinitialiser les filtres.
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAll}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      )}

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            Précédent
          </button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {data.page.toLocaleString('fr-FR')} / {data.total_pages.toLocaleString('fr-FR')}
          </span>
          <button
            type="button"
            disabled={page >= data.total_pages}
            onClick={() => {
              setPage((p) => Math.min(data.total_pages, p + 1));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            Suivant
          </button>
        </div>
      )}
    </main>
  );
}
