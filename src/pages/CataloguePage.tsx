import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Clock, MessageSquarePlus, RotateCcw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CatalogueFilters } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { PosterCard, PosterSkeletonGrid } from '../components/PosterCard';

const SEARCH_HISTORY_KEY = 'tapenaka_catalogue_search_history';
const MAX_SEARCH_HISTORY = 5;

function readSearchHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue;
      const cleaned = entry.trim().slice(0, 120);
      if (cleaned.length < 2) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(cleaned);
      if (deduped.length >= MAX_SEARCH_HISTORY) break;
    }
    return deduped;
  } catch {
    return [];
  }
}

function writeSearchHistory(items: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify(items.slice(0, MAX_SEARCH_HISTORY))
    );
  } catch {
    // Ignore private-mode / quota errors
  }
}

function upsertSearchHistoryList(
  prev: string[],
  rawTerm: string,
  replaceTerm?: string | null
): string[] {
  const cleaned = rawTerm.trim().slice(0, 120);
  if (cleaned.length < 2) return prev;
  const cleanedLower = cleaned.toLowerCase();
  const replaceLower = replaceTerm ? replaceTerm.trim().toLowerCase() : null;
  const filtered = prev.filter((item) => {
    const lower = item.toLowerCase();
    if (lower === cleanedLower) return false;
    if (replaceLower && lower === replaceLower) return false;
    return true;
  });
  return [cleaned, ...filtered].slice(0, MAX_SEARCH_HISTORY);
}

const MAX_YEAR = Math.max(2026, new Date().getFullYear());
const MIN_YEAR = 1900;
const YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => String(MAX_YEAR - i));

const TYPE_OPTIONS = [
  { value: 'all', label: 'Tout' },
  { value: 'film', label: 'Films' },
  { value: 'serie', label: 'Séries' },
  { value: 'anime', label: 'Animes' },
] as const;

export function CataloguePage() {
  const navigate = useNavigate();
  const { isMember, isAdmin, loading: authLoading } = useAuth();
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

  const [searchHistory, setSearchHistory] = useState<string[]>(() => readSearchHistory());
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastSessionRecordedRef = useRef<string | null>(null);
  const skipNextAutoRecordRef = useRef(false);

  // Redirect guests beyond page 2 to login, and cap connected members (non-admin) to 10 pages
  useEffect(() => {
    if (authLoading) return;
    if (!isMember && page > 2) {
      toast.info('Connectez-vous pour naviguer au-delà de la page 2.');
      navigate('/auth', { replace: true });
      return;
    }
    if (isMember && !isAdmin && page > 10) {
      setPage(10);
    }
  }, [authLoading, isMember, isAdmin, page, navigate]);

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

  // Persist settled searches (>= 2 chars) in localStorage history (max 5), coalescing progressive typing
  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.length < 2) {
      if (trimmed.length === 0) {
        lastSessionRecordedRef.current = null;
      }
      return;
    }
    if (skipNextAutoRecordRef.current) {
      skipNextAutoRecordRef.current = false;
      return;
    }
    if (trimmed === initialQ.trim() && lastSessionRecordedRef.current === null && !searchDropdownOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      const prevRecorded = lastSessionRecordedRef.current;
      const shouldReplacePrev =
        Boolean(prevRecorded) &&
        trimmed.toLowerCase().startsWith(prevRecorded!.toLowerCase());
      setSearchHistory((prev) => {
        const next = upsertSearchHistoryList(
          prev,
          trimmed,
          shouldReplacePrev ? prevRecorded : null
        );
        writeSearchHistory(next);
        return next;
      });
      lastSessionRecordedRef.current = trimmed;
    }, 950);
    return () => window.clearTimeout(timer);
  }, [input, initialQ, searchDropdownOpen]);

  // Close recent searches dropdown on outside click
  useEffect(() => {
    if (!searchDropdownOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setSearchDropdownOpen(false);
        lastSessionRecordedRef.current = null;
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [searchDropdownOpen]);

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

  const effectivePage = isAdmin ? page : isMember ? Math.min(page, 10) : Math.min(page, 2);
  const filters: CatalogueFilters = { q, type, genre, year, lang, sort, page: effectivePage };

  const catalogueQuery = useQuery({
    queryKey: ['catalogue', filters, isAdmin ? 'admin' : isMember ? 'member' : 'guest'],
    queryFn: () => api.catalogue(filters),
    enabled: !authLoading || page <= 2,
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
    skipNextAutoRecordRef.current = true;
    lastSessionRecordedRef.current = null;
    setInput('');
    setQ('');
    setType('all');
    setGenre('');
    setYear('');
    setLang('');
    setSort('recent');
    setPage(1);
    setSearchDropdownOpen(false);
  }

  function recordSearchTerm(term: string) {
    const cleaned = term.trim().slice(0, 120);
    if (cleaned.length < 2) return;
    setSearchHistory((prev) => {
      const next = upsertSearchHistoryList(prev, cleaned);
      writeSearchHistory(next);
      return next;
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    skipNextAutoRecordRef.current = true;
    lastSessionRecordedRef.current = null;
    setQ(trimmed);
    setPage(1);
    if (trimmed.length >= 2) {
      recordSearchTerm(trimmed);
    }
    setSearchDropdownOpen(false);
    searchInputRef.current?.blur();
  }

  function selectHistoryItem(term: string) {
    skipNextAutoRecordRef.current = true;
    lastSessionRecordedRef.current = null;
    setInput(term);
    setQ(term);
    setPage(1);
    recordSearchTerm(term);
    setSearchDropdownOpen(false);
    searchInputRef.current?.blur();
  }

  function removeHistoryItem(term: string) {
    setSearchHistory((prev) => {
      const next = prev.filter((item) => item.toLowerCase() !== term.toLowerCase());
      writeSearchHistory(next);
      return next;
    });
  }

  function clearHistory() {
    setSearchHistory([]);
    writeSearchHistory([]);
    setSearchDropdownOpen(false);
  }

  function clearSearchInput() {
    skipNextAutoRecordRef.current = true;
    lastSessionRecordedRef.current = null;
    setInput('');
    setQ('');
    setPage(1);
    searchInputRef.current?.focus();
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
        <div className="flex flex-wrap items-center gap-4">
          <Link
            to={`/demandes${q ? `?q=${encodeURIComponent(q)}&type=${type !== 'all' ? type : 'film'}` : type !== 'all' ? `?type=${type}` : ''}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline whitespace-nowrap"
          >
            <MessageSquarePlus className="size-3.5" />
            <span>Titre manquant ? Demander l’ajout</span>
          </Link>
          <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
            {catalogueQuery.isFetching
              ? 'Actualisation…'
              : `${(data?.total ?? 0).toLocaleString('fr-FR')} résultat${
                  (data?.total ?? 0) > 1 ? 's' : ''
                }${data?.approximatif ? ' (approchants)' : ''}`}
          </p>
        </div>
      </div>

      {/* Search input + recent search history */}
      <div ref={searchContainerRef} className="relative mb-5">
        <form onSubmit={handleSearchSubmit} role="search" className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-primary" />
          <input
            ref={searchInputRef}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Rechercher un titre"
            aria-expanded={searchDropdownOpen && searchHistory.length > 0}
            aria-controls="catalogue-search-history"
            value={input}
            onFocus={() => setSearchDropdownOpen(true)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchDropdownOpen(false);
                searchInputRef.current?.blur();
              }
            }}
            placeholder="Quel film, série ou anime recherchez-vous ?"
            className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-11 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          {input.length > 0 && (
            <button
              type="button"
              onClick={clearSearchInput}
              aria-label="Effacer la recherche"
              className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </form>

        {searchDropdownOpen && searchHistory.length > 0 && (
          <div
            id="catalogue-search-history"
            role="region"
            aria-label="Recherches récentes"
            className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Recherches récentes
              </span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={clearHistory}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Tout effacer
              </button>
            </div>
            <ul className="divide-y divide-border/40">
              {searchHistory.map((term) => (
                <li key={term} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-accent/50">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectHistoryItem(term)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-foreground"
                  >
                    <Clock className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{term}</span>
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => removeHistoryItem(term)}
                    aria-label={`Supprimer « ${term} » de l’historique`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
          className={`grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6 transition-opacity duration-150 ${
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
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to={`/demandes${q ? `?q=${encodeURIComponent(q)}&type=${type !== 'all' ? type : 'film'}` : type !== 'all' ? `?type=${type}` : ''}`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <MessageSquarePlus className="size-4" />
              <span>{q ? `Demander l’ajout de « ${q} »` : 'Demander un titre manquant'}</span>
            </Link>
            <button
              type="button"
              onClick={resetAll}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              Réinitialiser les filtres
            </button>
          </div>
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (() => {
        const memberMaxPages = isAdmin ? data.pages : isMember ? Math.min(data.pages, 10) : data.pages;
        const canClickNext = isAdmin
          ? page < data.pages
          : isMember
            ? page < Math.min(data.pages, 10)
            : page < data.pages;

        return (
          <div className="mt-10 flex flex-col items-center gap-2">
            <div className="flex items-center justify-center gap-4">
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
                Page {data.page.toLocaleString('fr-FR')} / {memberMaxPages.toLocaleString('fr-FR')}
              </span>
              <button
                type="button"
                disabled={!canClickNext}
                onClick={() => {
                  const nextPage = page + 1;
                  if (!isMember && nextPage > 2) {
                    toast.info('Connectez-vous pour consulter les pages suivantes.');
                    navigate('/auth');
                    return;
                  }
                  if (isMember && !isAdmin && nextPage > 10) {
                    return;
                  }
                  setPage(Math.min(data.pages, nextPage));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                Suivant
              </button>
            </div>
            {isMember && !isAdmin && page >= 10 && (
              <p className="text-xs text-muted-foreground">
                Navigation limitée aux 10 premières pages · Utilisez la recherche ou les filtres pour cibler un titre.
              </p>
            )}
          </div>
        );
      })()}
    </main>
  );
}
