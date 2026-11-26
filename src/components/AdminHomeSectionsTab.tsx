import React, { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  LayoutGrid,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { getContentTypeLabel } from '../shared/types';
import type { CatalogueFilters, HomeCustomSection, Item } from '../shared/types';
import { api } from '../lib/client';

const MAX_ITEMS = 18;

interface SectionDraft {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  order: number;
  items: Item[];
}

function makeEmptySectionDraft(nextOrder = 10): SectionDraft {
  return {
    id: '',
    title: '',
    description: '',
    enabled: true,
    order: nextOrder,
    items: [],
  };
}

function sectionToDraft(section: HomeCustomSection): SectionDraft {
  return {
    id: section.id,
    title: section.title,
    description: section.description,
    enabled: section.enabled,
    order: section.order,
    items: section.items.slice(0, MAX_ITEMS),
  };
}

function sanitizePosterUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)[a-zA-Z0-9/._-]+$/.test(trimmed)) return trimmed;
  return null;
}

export function AdminHomeSectionsTab() {
  const queryClient = useQueryClient();

  const sectionsQuery = useQuery({
    queryKey: ['admin-home-sections'],
    queryFn: () => api.adminHomeSections(),
  });

  const genresQuery = useQuery({
    queryKey: ['catalogue-genres'],
    queryFn: () => api.genres(),
    staleTime: 300_000,
  });

  const sections = sectionsQuery.data?.sections ?? [];
  const maxItems = sectionsQuery.data?.maxItems ?? MAX_ITEMS;

  const [draft, setDraft] = useState<SectionDraft>(() => makeEmptySectionDraft(10));

  // Catalogue picker filters
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pickerType, setPickerType] = useState<string>('all');
  const [pickerGenre, setPickerGenre] = useState<string>('');
  const [pickerSort, setPickerSort] = useState<CatalogueFilters['sort']>('recent');
  const [pickerPage, setPickerPage] = useState<number>(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const clean = searchInput.trim();
      if (clean !== debouncedSearch) {
        setDebouncedSearch(clean);
        setPickerPage(1);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput, debouncedSearch]);

  const pickerFilters: CatalogueFilters = useMemo(
    () => ({
      q: debouncedSearch,
      type: pickerType,
      genre: pickerGenre,
      year: '',
      lang: '',
      sort: pickerSort,
      page: pickerPage,
    }),
    [debouncedSearch, pickerType, pickerGenre, pickerSort, pickerPage]
  );

  const pickerQuery = useQuery({
    queryKey: ['admin-home-picker', pickerFilters],
    queryFn: () => api.catalogue(pickerFilters),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const selectedKeySet = useMemo(
    () => new Set(draft.items.map((it) => `${it.item_type}:${it.id}`)),
    [draft.items]
  );

  const nextDefaultOrder = useMemo(() => {
    const maxOrder = sections.reduce((max, s) => Math.max(max, s.order), 0);
    return maxOrder + 10;
  }, [sections]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.adminSaveHomeSection({
        ...(draft.id ? { id: draft.id } : {}),
        title: draft.title.trim(),
        description: draft.description.trim(),
        enabled: draft.enabled,
        order: draft.order,
        items: draft.items,
      }),
    onSuccess: (res) => {
      setDraft(sectionToDraft(res.section));
      void queryClient.invalidateQueries({ queryKey: ['admin-home-sections'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      toast.success(`Section « ${res.section.title} » enregistrée`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Enregistrement impossible');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.adminDeleteHomeSection(id),
    onSuccess: () => {
      setDraft(makeEmptySectionDraft(nextDefaultOrder));
      void queryClient.invalidateQueries({ queryKey: ['admin-home-sections'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      toast.success('Section supprimée');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible');
    },
  });

  function handleSelectSection(section: HomeCustomSection) {
    setDraft(sectionToDraft(section));
  }

  function handleNewSection() {
    setDraft(makeEmptySectionDraft(nextDefaultOrder));
  }

  function togglePickItem(item: Item) {
    const key = `${item.item_type}:${item.id}`;
    setDraft((prev) => {
      const exists = prev.items.some((x) => `${x.item_type}:${x.id}` === key);
      if (exists) {
        return {
          ...prev,
          items: prev.items.filter((x) => `${x.item_type}:${x.id}` !== key),
        };
      }
      if (prev.items.length >= maxItems) {
        toast.error(`Maximum ${maxItems} titres par section.`);
        return prev;
      }
      return {
        ...prev,
        items: [...prev.items, item],
      };
    });
  }

  function moveItem(idx: number, delta: -1 | 1) {
    const target = idx + delta;
    setDraft((prev) => {
      if (target < 0 || target >= prev.items.length) return prev;
      const next = [...prev.items];
      const [moved] = next.splice(idx, 1);
      if (!moved) return prev;
      next.splice(target, 0, moved);
      return { ...prev, items: next };
    });
  }

  function removeItemAt(idx: number) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));
  }

  const pickerItems = pickerQuery.data?.items ?? [];
  const pickerGenres = genresQuery.data?.genres ?? [];
  const atLimit = draft.items.length >= maxItems;

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left Column: Existing Custom Home Sections */}
      <aside className="lg:col-span-4 space-y-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-foreground">
              Sections Accueil ({sections.length})
            </h2>
            <button
              type="button"
              onClick={handleNewSection}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 whitespace-nowrap shrink-0"
            >
              <Plus className="size-3.5" />
              <span>Nouvelle</span>
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Créez des sélections éditoriales sur la page d’accueil (films, séries, animes) dans la limite de{' '}
            <strong className="font-semibold text-foreground tabular-nums">{maxItems} titres</strong> par section.
          </p>

          {sections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Aucune section personnalisée. Utilisez le formulaire à droite pour créer votre première sélection (ex : Top 10 film horreur).
            </div>
          ) : (
            <ul className="space-y-2">
              {sections.map((sec) => {
                const isSelected = draft.id === sec.id;
                return (
                  <li key={sec.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectSection(sec)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-background hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-sm text-foreground">
                          {sec.title}
                        </span>
                        <span
                          className={`shrink-0 text-[11px] font-semibold ${
                            sec.enabled ? 'text-emerald-400' : 'text-muted-foreground'
                          }`}
                        >
                          {sec.enabled ? 'Visible' : 'Masquée'}
                        </span>
                      </div>
                      {sec.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {sec.description}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                        <span>Ordre #{sec.order}</span>
                        <span>
                          {sec.items.length} / {maxItems} titres
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Right Column: Section Editor + Selected Strip + Catalogue Picker */}
      <section className="lg:col-span-8 space-y-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.title.trim().length < 2) {
              toast.error('Saisissez un titre d’au moins 2 caractères.');
              return;
            }
            saveMutation.mutate();
          }}
          className="rounded-xl border border-border bg-card p-5 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <LayoutGrid className="size-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <h2 className="truncate font-display text-xl font-semibold text-foreground">
                  {draft.id ? `Éditer : ${draft.title || 'Section'}` : 'Nouvelle section d’accueil'}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Affichée directement sur la page d’accueil lorsqu’elle est active et contient au moins 1 titre.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {draft.id && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const saved = sections.find((s) => s.id === draft.id);
                      if (saved) setDraft(sectionToDraft(saved));
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="size-3.5" />
                    <span>Annuler modifs</span>
                  </button>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(draft.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="size-3.5" />
                    <span>Supprimer</span>
                  </button>
                </>
              )}
              <button
                type="submit"
                disabled={saveMutation.isPending || draft.title.trim().length < 2}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Save className="size-3.5" />
                <span>{saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}</span>
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs sm:col-span-2">
              <span className="mb-1 block font-medium text-foreground">Titre de la section</span>
              <input
                required
                maxLength={120}
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Ex : Top 10 film horreur"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>

            <label className="block text-xs sm:col-span-2">
              <span className="mb-1 block font-medium text-foreground">
                Description (optionnel)
              </span>
              <textarea
                rows={2}
                maxLength={300}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Ex : Une sélection frissonnante des meilleurs films et séries d'horreur du catalogue."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>

            <label className="block text-xs">
              <span className="mb-1 block font-medium text-foreground">Ordre d’affichage</span>
              <input
                type="number"
                min={0}
                max={9999}
                value={draft.order}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    order: Math.max(0, Math.min(9999, Number(e.target.value) || 0)),
                  }))
                }
                className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
              />
            </label>

            <div className="flex items-end">
              <label className="inline-flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                  className="accent-primary"
                />
                <span>Afficher sur la page d’accueil</span>
              </label>
            </div>
          </div>

          {/* Selected items strip */}
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Titres sélectionnés ({draft.items.length} / {maxItems})
                </h3>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Cliquez sur les flèches pour réorganiser l’ordre d’apparition sur l’accueil.
                </p>
              </div>
              {draft.items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, items: [] }))}
                  className="text-xs font-medium text-muted-foreground hover:text-destructive"
                >
                  Tout retirer
                </button>
              )}
            </div>

            {atLimit && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-400">
                Limite atteinte : {maxItems} titres maximum par section. Retirez un titre pour en ajouter un autre.
              </div>
            )}

            {draft.items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                Aucun titre sélectionné pour l’instant. Choisissez jusqu’à {maxItems} films ou séries depuis le catalogue ci-dessous.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
                {draft.items.map((item, idx) => {
                  const poster = sanitizePosterUrl(item.poster);
                  return (
                    <div
                      key={`sel-${item.item_type}:${item.id}`}
                      className="flex flex-col rounded-lg border border-border bg-background overflow-hidden"
                    >
                      <div className="relative aspect-[2/3] w-full bg-card overflow-hidden">
                        {poster ? (
                          <img
                            src={poster}
                            alt={item.titre}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full w-full place-items-center p-2 text-center">
                            <Film className="size-5 text-primary/60" />
                          </div>
                        )}
                        <span className="absolute left-1.5 top-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeItemAt(idx)}
                          aria-label={`Retirer ${item.titre}`}
                          className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded bg-black/80 text-white hover:bg-destructive"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="p-2 space-y-1.5 flex-1 flex flex-col justify-between">
                        <div>
                          <p className="line-clamp-1 text-[11px] font-semibold text-foreground">
                            {item.titre}
                          </p>
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            {getContentTypeLabel(item.item_type)}
                            {item.annee ? ` · ${item.annee}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-border">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveItem(idx, -1)}
                            aria-label="Déplacer à gauche"
                            className="grid size-6 place-items-center rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-30"
                          >
                            <ArrowLeft className="size-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === draft.items.length - 1}
                            onClick={() => moveItem(idx, 1)}
                            aria-label="Déplacer à droite"
                            className="grid size-6 place-items-center rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-30"
                          >
                            <ArrowRight className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </form>

        {/* Catalogue Picker */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-foreground">
                Sélectionner depuis le catalogue
              </h3>
              <p className="text-xs text-muted-foreground">
                Cliquez sur une affiche pour l’ajouter ou la retirer de votre section ({draft.items.length}/{maxItems}).
              </p>
            </div>
            {pickerQuery.data && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {pickerQuery.data.total.toLocaleString('fr-FR')} titres disponibles
              </span>
            )}
          </div>

          {/* Search & Filters */}
          <div className="grid gap-2.5 sm:grid-cols-12">
            <div className="relative sm:col-span-5">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Rechercher un film, une série…"
                className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <select
              aria-label="Type de contenu"
              value={pickerType}
              onChange={(e) => {
                setPickerType(e.target.value);
                setPickerPage(1);
              }}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground sm:col-span-2"
            >
              <option value="all">Tous types</option>
              <option value="film">Films</option>
              <option value="serie">Séries</option>
              <option value="anime">Animes</option>
            </select>

            <select
              aria-label="Genre"
              value={pickerGenre}
              onChange={(e) => {
                setPickerGenre(e.target.value);
                setPickerPage(1);
              }}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground sm:col-span-3"
            >
              <option value="">Tous genres</option>
              {pickerGenres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>

            <select
              aria-label="Trier"
              value={pickerSort}
              onChange={(e) => {
                setPickerSort(e.target.value as CatalogueFilters['sort']);
                setPickerPage(1);
              }}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground sm:col-span-2"
            >
              <option value="recent">Récents</option>
              <option value="pertinence">Pertinence</option>
              <option value="annee_desc">Année ↓</option>
            </select>
          </div>

          {pickerQuery.isLoading && !pickerQuery.data ? (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[2/3] animate-pulse rounded-lg border border-border bg-background"
                />
              ))}
            </div>
          ) : pickerItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              Aucun titre trouvé pour ces critères.
            </div>
          ) : (
            <div
              className={`grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 transition-opacity ${
                pickerQuery.isFetching ? 'opacity-65' : 'opacity-100'
              }`}
            >
              {pickerItems.map((item) => {
                const key = `${item.item_type}:${item.id}`;
                const isPicked = selectedKeySet.has(key);
                const poster = sanitizePosterUrl(item.poster);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePickItem(item)}
                    className={`group relative flex flex-col rounded-lg border text-left transition-colors overflow-hidden ${
                      isPicked
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                        : 'border-border bg-background hover:border-primary/60'
                    }`}
                  >
                    <div className="relative aspect-[2/3] w-full bg-card overflow-hidden">
                      {poster ? (
                        <img
                          src={poster}
                          alt={item.titre}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center p-2 text-center">
                          <Film className="size-5 text-primary/60" />
                        </div>
                      )}
                      {isPicked && (
                        <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md bg-primary text-primary-foreground shadow">
                          <Check className="size-3.5" />
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="line-clamp-1 text-[11px] font-semibold text-foreground">
                        {item.titre}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground tabular-nums">
                        {getContentTypeLabel(item.item_type)}
                        {item.annee ? ` · ${item.annee}` : ''}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {pickerQuery.data && pickerQuery.data.pages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={pickerPage <= 1}
                onClick={() => setPickerPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                Précédent
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Page {pickerQuery.data.page.toLocaleString('fr-FR')} /{' '}
                {pickerQuery.data.pages.toLocaleString('fr-FR')}
              </span>
              <button
                type="button"
                disabled={pickerPage >= pickerQuery.data.pages}
                onClick={() =>
                  setPickerPage((p) => Math.min(pickerQuery.data!.pages, p + 1))
                }
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                Suivant
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
