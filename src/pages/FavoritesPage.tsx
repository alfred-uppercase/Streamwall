import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Heart, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { TYPE_LABELS } from '../shared/types';
import { api } from '../lib/client';
import { PosterCard, PosterSkeletonGrid } from '../components/PosterCard';

export function FavoritesPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'favorites' | 'progress' | 'history'>('favorites');
  const [favType, setFavType] = useState<'all' | 'film' | 'serie' | 'anime'>('all');

  const memberQuery = useQuery({
    queryKey: ['member'],
    queryFn: () => api.member(),
  });

  const clearHistoryMutation = useMutation({
    mutationFn: () => api.clearHistory(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      toast.success('Votre historique de visionnage a été effacé.');
    },
  });

  const favorites = memberQuery.data?.favorites ?? [];
  const filteredFavorites =
    favType === 'all' ? favorites : favorites.filter((f) => f.item_type === favType);
  const progress = memberQuery.data?.progress ?? [];
  const history = memberQuery.data?.history ?? [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Ma liste</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Retrouvez vos favoris privés et votre historique limité aux 5 dernières lectures (reprise gérée automatiquement par le lecteur).
          </p>
        </div>

        {tab === 'history' && history.length > 0 && (
          <button
            type="button"
            disabled={clearHistoryMutation.isPending}
            onClick={() => clearHistoryMutation.mutate()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-destructive whitespace-nowrap shrink-0"
          >
            <Trash2 className="size-4" />
            <span>Effacer l’historique</span>
          </button>
        )}
      </div>

      {/* Primary tabs */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div
          role="tablist"
          aria-label="Sections de ma liste"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'favorites'}
            onClick={() => setTab('favorites')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors tabular-nums whitespace-nowrap shrink-0 ${
              tab === 'favorites'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Heart className="size-4" />
            <span>Favoris ({favorites.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'progress'}
            onClick={() => setTab('progress')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors tabular-nums whitespace-nowrap shrink-0 ${
              tab === 'progress'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Play className="size-4" />
            <span>5 dernières ({Math.min(5, progress.length)})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            onClick={() => setTab('history')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors tabular-nums whitespace-nowrap shrink-0 ${
              tab === 'history'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Clock className="size-4" />
            <span>Historique ({Math.min(5, history.length)})</span>
          </button>
        </div>

        {tab === 'favorites' && favorites.length > 0 && (
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {(
              [
                ['all', 'Tout'],
                ['film', 'Films'],
                ['serie', 'Séries'],
                ['anime', 'Animes'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFavType(val)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  favType === val
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {memberQuery.isLoading ? (
        <PosterSkeletonGrid count={6} />
      ) : tab === 'favorites' ? (
        filteredFavorites.length > 0 ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {filteredFavorites.map((item) => (
              <PosterCard key={`${item.item_type}:${item.id}`} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <p className="text-base font-medium text-foreground">
              Vous n’avez pas encore de favoris dans cette catégorie.
            </p>
            <p className="mt-1 mb-5 text-sm text-muted-foreground">
              Cliquez sur le cœur d’une affiche pour retrouver vos titres ici.
            </p>
            <Link
              to="/catalogue"
              className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Parcourir le catalogue
            </Link>
          </div>
        )
      ) : tab === 'progress' ? (
        progress.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {progress.map((entry) => (
              <Link
                key={`${entry.item.item_type}:${entry.item.id}`}
                to={`/${entry.item.item_type}/${entry.item.id}?autoplay=1&s=${entry.season}&e=${entry.episode}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/70"
              >
                {entry.item.poster && (
                  <img
                    src={entry.item.poster}
                    alt={entry.item.titre}
                    referrerPolicy="no-referrer"
                    className="h-20 w-14 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{entry.item.titre}</p>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {TYPE_LABELS[entry.item.item_type]}
                    {entry.item.item_type !== 'film'
                      ? ` · Saison ${entry.season} · Épisode ${entry.episode}`
                      : ''}
                  </p>
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Play className="size-3.5 fill-current" />
                    <span>Reprendre</span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Aucune lecture en cours pour le moment.
            </p>
          </div>
        )
      ) : history.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {history.map((ev) => (
            <li key={ev.id}>
              <Link
                to={`/${ev.item.item_type}/${ev.item.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-accent"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  {ev.item.poster && (
                    <img
                      src={ev.item.poster}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-12 w-8 shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {ev.item.titre}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {TYPE_LABELS[ev.item.item_type]}
                      {ev.item.item_type !== 'film' ? ` · S${ev.season} · É${ev.episode}` : ''}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {new Date(ev.viewedAt).toLocaleString('fr-FR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Aucun visionnage dans votre historique.</p>
        </div>
      )}
    </main>
  );
}
