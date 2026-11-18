import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RotateCcw, Search } from 'lucide-react';
import type { CatalogueFilters } from '../shared/types';
import { api } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { PosterCard, PosterSkeletonGrid } from '../components/PosterCard';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1950 + 1 }, (_, i) => String(CURRENT_YEAR - i));

const TYPE_OPTIONS = [
  { value: 'all', label: 'Tout' },
  { value: 'film', label: 'Films' },
  { value: 'serie', label: 'Séries' },
  { value: 'anime', label: 'Animes' },
] as const;

export function CataloguePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQ = searchParams.get('q') ?? '';
  const [input, setInput] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [type, setType] = useState(searchParams.get('type') ?? 'all');
  const [genre, setGenre] = useState(searchParams.get('genre') ?? '');
  const [year, setYear] = useState(searchParams.get('year') ?? '');
  const [lang, setLang] = useState(searchParams.get('lang') ?? '');
  const [sort, setSort] = useState<CatalogueFilters['sort']>(
    (searchParams.get('sort') as CatalogueFilters['sort']) || 'recent'
  );
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));

  const pageTitle = q
    ? `Recherche « ${q} »`
    : type === 'film'
      ? 'Films'
      : type === 'serie'
        ? 'Séries'
        : type === 'anime'
          ? 'Animes'
          : 'Catalogue';
  useDocumentTitle(pageTitle);

  // Debounce search query
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

  // Keep URL query parameters synchronized for shareable searches
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (type !== 'all') next.set('type', type);
    if (genre) next.set('genre', genre);
    if (year) next.set('year', year);
    if (lang) next.set('lang', lang);
    if (sort !== 'recent') next.set('sort', sort);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
  }, [q, type, genre, year, lang, sort, page, setSearchParams]);

  const filters: CatalogueFilters = { q, type, genre, year, lang, sort, page };

  const catalogueQuery = useQuery({
    queryKey: ['catalogue', filters],
    queryFn: () => api.catalogue(filters),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const genresQuery = useQuery({
    queryKey: ['catalogue-genres'],
    queryFn: () => api.genres(),
    staleTime: 600_000,
  });

  const genres = genresQuery.data?.genres ?? [];
  const data = catalogueQuery.data;
  const items = data?.items ?? [];

  const hasActiveFilters =
    Boolean(input) ||
    type !== 'all' ||
    Boolean(genre) ||
    Boolean(year) ||
    Boolean(lang) ||
    sort !== 'recent';

  function resetAll() {
    setInput('');
    setQ('');
    setType('all');
    setGenre('');
    setYear('');
    setLang('');
    setSort('recent');
    setPage(1);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Catalogue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recherchez parmi l’ensemble des films, séries et animes disponibles.
          </p>
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
          {catalogueQuery.isFetching
            ? 'Actualisation…'
            : `${(data?.total ?? 0).toLocaleString('fr-FR')} résultat${
                (data?.total ?? 0) > 1 ? 's' : ''
              }${data?.approximatif ? ' (approchants)' : ''}`}
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-primary" />
        <input
          type="search"
          aria-label="Rechercher un titre"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Quel film, série ou anime recherchez-vous ?"
          className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-4 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      {/* Filter toolbar */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        {/* Segmented category selector */}
        <div
          role="group"
          aria-label="Filtrer par catégorie"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1"
        >
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={type === opt.value}
              onClick={() => {
                setType(opt.value);
                setPage(1);
              }}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                type === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

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
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        <select
          aria-label="Année de sortie"
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
        >
          <option value="">Toutes les années</option>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <select
          aria-label="Langue audio"
          value={lang}
          onChange={(e) => {
            setLang(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="">Toutes les langues</option>
          <option value="vf">VF / Français</option>
          <option value="vostfr">VOSTFR</option>
        </select>

        <select
          aria-label="Trier par"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as CatalogueFilters['sort']);
            setPage(1);
          }}
          className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="recent">Plus récents</option>
          <option value="pertinence">Pertinence</option>
          <option value="annee_desc">Année décroissante</option>
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
      {catalogueQuery.isLoading && !data ? (
        <PosterSkeletonGrid count={18} />
      ) : catalogueQuery.isError ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-base font-medium text-foreground">
            Le catalogue est momentanément indisponible.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vérifiez votre connexion ou réessayez dans quelques secondes.
          </p>
        </div>
      ) : items.length > 0 ? (
        <div
          className={`grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 transition-opacity duration-150 ${
            catalogueQuery.isFetching ? 'opacity-65' : 'opacity-100'
          }`}
        >
          {items.map((item) => (
            <PosterCard key={`${item.item_type}:${item.id}`} item={item} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-base font-medium text-foreground">
            Aucun titre ne correspond à ces filtres.
          </p>
          <p className="mt-1 mb-5 text-sm text-muted-foreground">
            Essayez d’élargir la recherche ou de réinitialiser les critères sélectionnés.
          </p>
          <button
            type="button"
            onClick={resetAll}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Réinitialiser les filtres
          </button>
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
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
            Page {data.page.toLocaleString('fr-FR')} / {data.pages.toLocaleString('fr-FR')}
          </span>
          <button
            type="button"
            disabled={page >= data.pages}
            onClick={() => {
              setPage((p) => Math.min(data.pages, p + 1));
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
