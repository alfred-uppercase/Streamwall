import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Play, Shuffle } from 'lucide-react';
import { TYPE_LABELS } from '../shared/types';
import { api } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { PosterCard, PosterSkeletonGrid } from '../components/PosterCard';

const TYPES = [
  { value: 'all', label: 'Surprise totale' },
  { value: 'film', label: 'Films' },
  { value: 'serie', label: 'Séries' },
  { value: 'anime', label: 'Animes' },
] as const;

export function SuggestionPage() {
  useDocumentTitle('Suggestion');
  const [type, setType] = useState('all');
  const [genre, setGenre] = useState('');
  const [seed, setSeed] = useState(1);

  const genresQuery = useQuery({
    queryKey: ['catalogue-genres'],
    queryFn: () => api.genres(),
    staleTime: 600_000,
  });

  const suggestionQuery = useQuery({
    queryKey: ['suggestions', type, genre, seed],
    queryFn: () => api.suggestions(type, genre),
    staleTime: Infinity,
  });

  const spotlight = suggestionQuery.data?.spotlight ?? null;
  const items = suggestionQuery.data?.items ?? [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
            Suggestion au hasard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hésitant ce soir ? Tirez une sélection aléatoire filtrée selon votre humeur.
          </p>
        </div>

        <button
          type="button"
          disabled={suggestionQuery.isFetching}
          onClick={() => setSeed((s) => s + 1)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Shuffle className="size-4" />
          <span>{suggestionQuery.isFetching ? 'Tirage en cours…' : 'Nouvelle sélection'}</span>
        </button>
      </div>

      {/* Mood / Category filter bar */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Catégorie aléatoire"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1"
        >
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={type === t.value}
              onClick={() => {
                setType(t.value);
                setSeed((s) => s + 1);
              }}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                type === t.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          aria-label="Genre pour la suggestion"
          value={genre}
          onChange={(e) => {
            setGenre(e.target.value);
            setSeed((s) => s + 1);
          }}
          className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="">Tous les genres</option>
          {(genresQuery.data?.genres ?? []).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {/* Spotlight pick */}
      {spotlight && (
        <section className="mb-10 flex flex-col gap-6 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center">
          {spotlight.poster && (
            <img
              src={spotlight.poster}
              alt={spotlight.titre}
              referrerPolicy="no-referrer"
              className="h-44 w-30 shrink-0 rounded-lg object-cover border border-border"
            />
          )}
          <div className="min-w-0 flex-1 space-y-2.5">
            <p className="text-xs font-medium text-primary tabular-nums">
              Tirage coup de cœur · {TYPE_LABELS[spotlight.item_type]}
              {spotlight.annee ? ` · ${spotlight.annee}` : ''}
              {spotlight.qualite ? ` · ${spotlight.qualite}` : ''}
              {spotlight.langue ? ` · ${spotlight.langue}` : ''}
            </p>
            <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
              {spotlight.titre}
            </h2>
            {spotlight.genre && (
              <p className="text-sm text-muted-foreground">{spotlight.genre}</p>
            )}
            <div className="pt-2">
              <Link
                to={`/${spotlight.item_type}/${spotlight.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
              >
                <Play className="size-4 fill-current" />
                <span>Ouvrir ce titre</span>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* 12 random cards */}
      {suggestionQuery.isLoading ? (
        <PosterSkeletonGrid count={12} />
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <PosterCard key={`${item.item_type}:${item.id}`} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
