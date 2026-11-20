import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Film,
  Loader2,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  Tv,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ContentRequestStatus, ItemType, TmdbSearchSuggestion } from '../shared/types';
import { TYPE_LABELS } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';

const VISITOR_KEY_STORAGE = 'tapenaka_req_visitor_key_v1';

function getRequestVisitorKey(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY_STORAGE);
    if (existing) return existing;
    const created = `v_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
    localStorage.setItem(VISITOR_KEY_STORAGE, created);
    return created;
  } catch {
    return 'v_anon';
  }
}

const REQUEST_STATUS_META: Record<
  ContentRequestStatus,
  { label: string; badgeClass: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: {
    label: 'En attente',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    icon: Clock,
  },
  in_progress: {
    label: 'En cours d’ajout',
    badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
    icon: Sparkles,
  },
  added: {
    label: 'Ajouté',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    icon: CheckCircle2,
  },
  rejected: {
    label: 'Non disponible',
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
    icon: XCircle,
  },
};

export function RequestsPage() {
  useDocumentTitle('Demander un titre');
  const [searchParams] = useSearchParams();
  const { isMember } = useAuth();
  const queryClient = useQueryClient();
  const visitorKey = getRequestVisitorKey();

  const initialQ = searchParams.get('q') ?? '';
  const initialTypeParam = searchParams.get('type');
  const initialType: ItemType =
    initialTypeParam === 'serie' || initialTypeParam === 'anime' || initialTypeParam === 'film'
      ? initialTypeParam
      : 'film';

  const [mediaType, setMediaType] = useState<ItemType>(initialType);
  const [titleInput, setTitleInput] = useState(initialQ);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQ);
  const [selectedTmdb, setSelectedTmdb] = useState<TmdbSearchSuggestion | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [manualYear, setManualYear] = useState('');
  const [note, setNote] = useState('');
  const [guestName, setGuestName] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'added'>('all');

  const inputWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = titleInput.trim();
    if (selectedTmdb && trimmed === selectedTmdb.title) {
      setDebouncedQuery('');
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [titleInput, selectedTmdb]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (inputWrapperRef.current && !inputWrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const tmdbQuery = useQuery({
    queryKey: ['tmdb-search', mediaType, debouncedQuery],
    queryFn: () => api.tmdbSearch(debouncedQuery, mediaType),
    enabled: debouncedQuery.length >= 2 && !selectedTmdb,
    staleTime: 180_000,
  });

  const requestsQuery = useQuery({
    queryKey: ['content-requests'],
    queryFn: () => api.contentRequests(),
    staleTime: 30_000,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      api.submitContentRequest({
        mediaType,
        title: (selectedTmdb?.title || titleInput).trim(),
        year: selectedTmdb?.year ?? (manualYear ? Number(manualYear) : null),
        tmdbId: selectedTmdb?.tmdbId ?? null,
        tmdbPosterUrl: selectedTmdb?.posterUrl ?? null,
        tmdbOverview: selectedTmdb?.overview ?? null,
        note: note.trim(),
        guestName: !isMember ? guestName.trim() : undefined,
        visitorKey,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['content-requests'] });
      setTitleInput('');
      setDebouncedQuery('');
      setSelectedTmdb(null);
      setManualYear('');
      setNote('');
      setShowDropdown(false);
      toast.success(
        res.merged
          ? 'Ce titre avait déjà été demandé : votre vote (+1) a été ajouté !'
          : 'Votre demande a bien été envoyée à l’équipe.'
      );
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Impossible d’envoyer la demande.'),
  });

  const voteMutation = useMutation({
    mutationFn: (id: string) => api.voteContentRequest(id, visitorKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['content-requests'] });
    },
    onError: () => toast.error('Impossible d’enregistrer votre vote.'),
  });

  const suggestions = tmdbQuery.data?.results ?? [];
  const allRequests = requestsQuery.data?.requests ?? [];
  const filteredRequests = allRequests.filter((r) => {
    if (statusFilter === 'pending') return r.status === 'pending' || r.status === 'in_progress';
    if (statusFilter === 'added') return r.status === 'added';
    return true;
  });

  function handleSelectSuggestion(item: TmdbSearchSuggestion) {
    setSelectedTmdb(item);
    setTitleInput(item.title);
    setManualYear(item.year ? String(item.year) : '');
    if (item.mediaType === 'film') {
      setMediaType('film');
    } else if (mediaType === 'film') {
      setMediaType('serie');
    }
    setShowDropdown(false);
  }

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
            Demander un titre manquant
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Vous ne trouvez pas un film, une série ou un anime dans le catalogue ? Tapez son titre pour voir les suggestions TMDB, ou saisissez-le directement manuellement.
          </p>
        </div>
        <Link
          to="/catalogue"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent whitespace-nowrap shrink-0"
        >
          <Search className="size-3.5 text-primary" />
          <span>Vérifier dans le catalogue</span>
        </Link>
      </div>

      {/* Request Submission Card (NO file/photo upload) */}
      <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="space-y-5"
        >
          {/* Category selector */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Catégorie
            </span>
            <div
              role="group"
              aria-label="Type de titre demandé"
              className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background p-1"
            >
              {(
                [
                  ['film', 'Film'],
                  ['serie', 'Série'],
                  ['anime', 'Anime'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={mediaType === val}
                  onClick={() => {
                    setMediaType(val);
                    if (selectedTmdb) {
                      setSelectedTmdb(null);
                    }
                  }}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    mediaType === val
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Missing title input with live TMDB suggestions */}
          <div ref={inputWrapperRef} className="relative space-y-1.5">
            <label htmlFor="missing-title-input" className="block text-sm font-medium text-foreground">
              Titre du film, série ou anime <span className="text-primary">*</span>
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-primary" />
              <input
                id="missing-title-input"
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={titleInput}
                onFocus={() => {
                  if (!selectedTmdb && titleInput.trim().length >= 2) {
                    setShowDropdown(true);
                  }
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  setTitleInput(val);
                  if (selectedTmdb) setSelectedTmdb(null);
                  setShowDropdown(val.trim().length >= 2);
                }}
                placeholder="Ex : Dune, Solo Leveling, Breaking Bad…"
                className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {tmdbQuery.isFetching && !selectedTmdb && (
                <Loader2 className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
              {titleInput && !tmdbQuery.isFetching && (
                <button
                  type="button"
                  aria-label="Effacer le titre"
                  onClick={() => {
                    setTitleInput('');
                    setDebouncedQuery('');
                    setSelectedTmdb(null);
                    setManualYear('');
                    setShowDropdown(false);
                  }}
                  className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Tapez au moins 2 lettres pour afficher les suggestions TMDB, ou saisissez simplement le titre manuellement.
            </p>

            {/* Live TMDB autocomplete dropdown */}
            {showDropdown && !selectedTmdb && debouncedQuery.length >= 2 && (
              <div className="absolute left-0 right-0 top-[calc(100%-1.25rem)] z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover shadow-2xl">
                {tmdbQuery.isLoading ? (
                  <div className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span>Recherche sur TMDB en cours…</span>
                  </div>
                ) : suggestions.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {suggestions.map((s) => (
                      <li key={`${s.mediaType}:${s.tmdbId}`}>
                        {s.existingCatalogItem ? (
                          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-emerald-500/5">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="h-12 w-8 shrink-0 overflow-hidden rounded border border-border bg-background">
                                {s.posterUrl ? (
                                  <img
                                    src={s.posterUrl}
                                    alt={s.title}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="grid h-full w-full place-items-center text-muted-foreground">
                                    <Film className="size-3.5" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {s.title}
                                  {s.year ? ` (${s.year})` : ''}
                                </p>
                                <p className="text-xs text-emerald-400">
                                  Déjà disponible au catalogue
                                </p>
                              </div>
                            </div>
                            <Link
                              to={`/${s.existingCatalogItem.item_type}/${s.existingCatalogItem.id}`}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 whitespace-nowrap shrink-0"
                            >
                              <span>Ouvrir</span>
                              <ExternalLink className="size-3" />
                            </Link>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelectSuggestion(s)}
                            className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent"
                          >
                            <div className="h-14 w-9 shrink-0 overflow-hidden rounded border border-border bg-background">
                              {s.posterUrl ? (
                                <img
                                  src={s.posterUrl}
                                  alt={s.title}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="grid h-full w-full place-items-center text-muted-foreground">
                                  {s.mediaType === 'film' ? (
                                    <Film className="size-4" />
                                  ) : (
                                    <Tv className="size-4" />
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-semibold text-foreground">
                                  {s.title}
                                </span>
                                <span className="text-xs font-medium text-primary tabular-nums">
                                  {s.mediaType === 'film' ? 'Film' : 'Série / Anime'}
                                  {s.year ? ` · ${s.year}` : ''}
                                </span>
                              </div>
                              {s.originalTitle && (
                                <p className="truncate text-[11px] text-muted-foreground">
                                  Titre original : {s.originalTitle}
                                </p>
                              )}
                              {s.overview && (
                                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                  {s.overview}
                                </p>
                              )}
                            </div>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-4 py-3 text-xs text-muted-foreground">
                    Aucun résultat TMDB trouvé pour « {debouncedQuery} ». Vous pouvez soumettre ce titre manuellement ci-dessous.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Read-only TMDB selection summary card */}
          {selectedTmdb && (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-primary/35 bg-primary/5 p-3.5">
              <div className="flex min-w-0 items-start gap-3.5">
                {selectedTmdb.posterUrl && (
                  <img
                    src={selectedTmdb.posterUrl}
                    alt={selectedTmdb.title}
                    className="h-20 w-14 shrink-0 rounded-lg border border-border object-cover"
                  />
                )}
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-semibold text-primary">
                    Fiche TMDB sélectionnée #{selectedTmdb.tmdbId}
                    {selectedTmdb.year ? ` · ${selectedTmdb.year}` : ''}
                  </p>
                  <p className="truncate text-sm font-bold text-foreground">
                    {selectedTmdb.title}
                  </p>
                  {selectedTmdb.overview && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {selectedTmdb.overview}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTmdb(null)}
                className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0"
              >
                Saisie manuelle
              </button>
            </div>
          )}

          {/* Optional Year (for manual mode) + Optional Note + Optional Guest name */}
          <div className="grid gap-4 sm:grid-cols-3">
            {!selectedTmdb && (
              <label className="block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Année de sortie (optionnel)
                </span>
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  value={manualYear}
                  onChange={(e) => setManualYear(e.target.value)}
                  placeholder="Ex : 2024"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
                />
              </label>
            )}

            {!isMember && (
              <label className="block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Votre pseudo (optionnel)
                </span>
                <input
                  type="text"
                  maxLength={50}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Visiteur"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>
            )}

            <label className={`block text-sm ${selectedTmdb && isMember ? 'sm:col-span-3' : selectedTmdb || isMember ? 'sm:col-span-2' : ''}`}>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Précisions (langue VF/VOSTFR, saison, remarque…) — optionnel
              </span>
              <input
                type="text"
                maxLength={350}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex : En VF si possible, Saison 2 complète…"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground">
              Si ce titre a déjà été demandé, votre requête ajoutera automatiquement un vote de priorité (+1).
            </p>
            <button
              type="submit"
              disabled={submitMutation.isPending || titleInput.trim().length < 2}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="size-4" />
              <span>{submitMutation.isPending ? 'Envoi…' : 'Envoyer la demande'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Community Requests List */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">
              Demandes en cours ({filteredRequests.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Soutenez une demande existante avec +1 pour la faire passer en priorité.
            </p>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {(
              [
                ['all', 'Toutes'],
                ['pending', 'En attente'],
                ['added', 'Ajoutées'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setStatusFilter(val)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === val
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {requestsQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Aucune demande dans cette catégorie pour le moment.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredRequests.map((req) => {
              const statusMeta = REQUEST_STATUS_META[req.status];
              const StatusIcon = statusMeta.icon;
              return (
                <div
                  key={req.id}
                  className="flex min-w-0 items-start gap-3.5 rounded-xl border border-border bg-card p-4"
                >
                  <div className="h-22 w-15 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
                    {req.tmdbPosterUrl ? (
                      <img
                        src={req.tmdbPosterUrl}
                        alt={req.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-muted-foreground/60">
                        {req.mediaType === 'film' ? (
                          <Film className="size-6" />
                        ) : (
                          <Tv className="size-6" />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-base font-semibold text-foreground">
                          {req.title}
                        </h3>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {TYPE_LABELS[req.mediaType]}
                          {req.year ? ` · ${req.year}` : ''}
                          {req.tmdbId ? ` · TMDB #${req.tmdbId}` : ''} · Par {req.username}
                        </p>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shrink-0 ${statusMeta.badgeClass}`}
                      >
                        <StatusIcon className="size-3" />
                        <span>{statusMeta.label}</span>
                      </span>
                    </div>

                    {req.note && (
                      <p className="line-clamp-2 text-xs text-foreground/85">{req.note}</p>
                    )}

                    {req.adminNote && (
                      <p className="rounded-md border border-border bg-background/70 px-2.5 py-1.5 text-xs text-muted-foreground">
                        <strong className="text-foreground">Réponse admin :</strong> {req.adminNote}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        disabled={voteMutation.isPending}
                        onClick={() => voteMutation.mutate(req.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors tabular-nums ${
                          req.hasVoted
                            ? 'border-primary/50 bg-primary/15 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <ThumbsUp className="size-3.5" />
                        <span>+1 ({req.votes})</span>
                      </button>

                      {req.resolvedItemUrl && (
                        <Link
                          to={req.resolvedItemUrl}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          <span>Voir au catalogue →</span>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
