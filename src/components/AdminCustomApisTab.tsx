import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Plus,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  CustomApiEndpointsConfig,
  CustomApiFieldMapping,
  CustomApiFiltersConfig,
  CustomApiModuleConfig,
  CustomApiPlayerConfig,
  CustomApiSectionsConfig,
  CustomApiTestReport,
  MenuIconKey,
} from '../shared/types';
import { api } from '../lib/client';
import { MENU_ICON_OPTIONS } from '../lib/menuIcons';

type EditorSubTab = 'endpoints' | 'fields' | 'filters' | 'sections' | 'player';

function makeEmptyModuleDraft(): CustomApiModuleConfig {
  const now = new Date().toISOString();
  return {
    id: '',
    slug: 'nouveau-catalogue',
    name: 'Nouveau catalogue',
    enabled: true,
    badgeText: 'Catalogue',
    icon: 'film',
    endpoints: {
      apiUrl: '',
      mediaBaseUrl: 'https://streamwall.behoririka.mg/',
      actionParam: 'action',
      facetsAction: 'facets',
      listAction: 'list',
      detailAction: 'detail',
      detailKeyParam: 'slug',
      queryParam: 'q',
      genreParam: 'genre',
      countryParam: 'pays',
      yearParam: 'annee',
      sortParam: 'sort',
      pageParam: 'page',
      perPageParam: 'per_page',
      perPage: 24,
      similarLimitParam: 'similar_limit',
      similarLimit: 12,
    },
    fields: {
      listItemsPath: 'items',
      listPagePath: 'page',
      listTotalPath: 'total',
      listTotalPagesPath: 'total_pages',
      facetsGenresPath: 'genres',
      facetsCountriesPath: 'pays',
      facetsYearMinPath: 'annees.min',
      facetsYearMaxPath: 'annees.max',
      detailItemPath: 'film',
      detailEmbedsPath: 'players.embed',
      detailDownloadsPath: 'players.download',
      detailSimilarPath: 'similar',
      itemIdField: 'id',
      itemSlugField: 'slug',
      itemTitleField: 'titre',
      itemOriginalTitleField: 'titre_original',
      itemYearField: 'annee',
      itemReleaseDateField: 'date_sortie',
      itemCountryField: 'pays',
      itemDurationField: 'duree',
      itemRatingField: 'note',
      itemGenresField: 'genres',
      itemSynopsisField: 'synopsis',
      itemPosterField: 'poster',
      itemGalleryField: 'galerie',
      playerUrlField: 'url',
      playerProviderField: 'provider',
      playerQualityField: 'quality',
      playerLanguageField: 'language',
    },
    filters: {
      showSearch: true,
      searchPlaceholder: 'Rechercher un titre ou synopsis…',
      showGenreFilter: true,
      showCountryFilter: true,
      showYearFilter: true,
      showSortFilter: true,
      defaultSort: 'recent',
      sortOptions: [
        { value: 'recent', label: 'Plus récents' },
        { value: 'oldest', label: 'Plus anciens' },
        { value: 'note', label: 'Mieux notés' },
        { value: 'az', label: 'Titre A → Z' },
        { value: 'za', label: 'Titre Z → A' },
      ],
    },
    sections: {
      catalogueTitle: 'Nouveau catalogue',
      catalogueSubtitle: 'Catalogue alimenté par API personnalisée avec lecteur intégré.',
      mobileGridCols: 3,
      desktopGridCols: 6,
      showRating: true,
      showYear: true,
      showDuration: true,
      showCountry: true,
      detailShowHeroGallery: true,
      detailShowSynopsis: true,
      detailShowAvailablePlayersList: false,
      detailShowDownloads: true,
      detailShowGallerySection: false,
      detailShowSimilar: true,
      detailShowComments: true,
      detailShowReportButton: true,
    },
    player: {
      playerUrlTemplate: 'https://streamwall.behoririka.mg/pinoy/{id}',
      primaryPlayerLabel: 'Lecteur principal',
      useSameOriginProxy: true,
      showServerSwitcherInModal: false,
      includeUpstreamEmbeds: true,
      downloadProOnly: true,
      downloadRestrictionMessage:
        'Le téléchargement direct est réservé aux membres Pro.',
      onlyDirectDownloads: true,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function AdminCustomApisTab() {
  const queryClient = useQueryClient();
  const modulesQuery = useQuery({
    queryKey: ['admin-custom-modules'],
    queryFn: () => api.adminCustomModules(),
  });

  const [draft, setDraft] = useState<CustomApiModuleConfig>(() => makeEmptyModuleDraft());
  const [subTab, setSubTab] = useState<EditorSubTab>('endpoints');
  const [syncMenu, setSyncMenu] = useState(true);
  const [showDesktop, setShowDesktop] = useState(true);
  const [showMobile, setShowMobile] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [testReport, setTestReport] = useState<CustomApiTestReport | null>(null);
  const initialSelectedRef = useRef(false);

  const modules = modulesQuery.data?.modules ?? [];

  useEffect(() => {
    if (initialSelectedRef.current || modules.length === 0) return;
    initialSelectedRef.current = true;
    const preferred = modules.find((m) => m.slug === 'pinoy') ?? modules[0];
    if (preferred) {
      setDraft(preferred);
    }
  }, [modules]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.adminSaveCustomModule({
        ...draft,
        syncMenu,
        showDesktop,
        showMobile,
        showFooter,
      }),
    onSuccess: (res) => {
      setDraft(res.module);
      const routePreview = res.module.slug === 'pinoy' ? '/pinoy' : `/c/${res.module.slug}`;
      void queryClient.invalidateQueries({ queryKey: ['admin-custom-modules'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-navigation'] });
      void queryClient.invalidateQueries({ queryKey: ['site-navigation'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['pinoy-facets'] });
      void queryClient.invalidateQueries({ queryKey: ['pinoy-list'] });
      void queryClient.invalidateQueries({ queryKey: ['pinoy-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['custom-facets', res.module.slug] });
      void queryClient.invalidateQueries({ queryKey: ['custom-list', res.module.slug] });
      void queryClient.invalidateQueries({ queryKey: ['custom-detail', res.module.slug] });
      toast.success(`Module « ${res.module.name} » enregistré et prêt sur ${routePreview}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Erreur d’enregistrement'),
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => api.adminDeleteCustomModule(slug),
    onSuccess: () => {
      setDraft(makeEmptyModuleDraft());
      setTestReport(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-custom-modules'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-navigation'] });
      void queryClient.invalidateQueries({ queryKey: ['site-navigation'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['pinoy-facets'] });
      void queryClient.invalidateQueries({ queryKey: ['pinoy-list'] });
      void queryClient.invalidateQueries({ queryKey: ['pinoy-detail'] });
      toast.success('Module supprimé');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Suppression impossible'),
  });

  const testMutation = useMutation({
    mutationFn: () => api.adminTestCustomModule(draft),
    onSuccess: (report) => {
      setTestReport(report);
      if (report.ok) toast.success(report.message);
      else toast.error(report.message);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Test impossible'),
  });

  function patchEndpoints(patch: Partial<CustomApiEndpointsConfig>) {
    setDraft((d) => ({ ...d, endpoints: { ...d.endpoints, ...patch } }));
  }

  function patchFields(patch: Partial<CustomApiFieldMapping>) {
    setDraft((d) => ({ ...d, fields: { ...d.fields, ...patch } }));
  }

  function patchFilters(patch: Partial<CustomApiFiltersConfig>) {
    setDraft((d) => ({ ...d, filters: { ...d.filters, ...patch } }));
  }

  function patchSections(patch: Partial<CustomApiSectionsConfig>) {
    setDraft((d) => ({ ...d, sections: { ...d.sections, ...patch } }));
  }

  function patchPlayer(patch: Partial<CustomApiPlayerConfig>) {
    setDraft((d) => ({ ...d, player: { ...d.player, ...patch } }));
  }

  function applyPinoyTemplate() {
    const fresh = makeEmptyModuleDraft();
    setDraft({
      ...draft,
      endpoints: { ...fresh.endpoints, apiUrl: draft.endpoints.apiUrl },
      fields: fresh.fields,
      filters: fresh.filters,
      sections: {
        ...fresh.sections,
        catalogueTitle: draft.name || 'Catalogue',
        catalogueSubtitle: `Catalogue ${draft.name || 'personnalisé'} avec lecteur intégré.`,
      },
      player: fresh.player,
    });
    toast.info('Modèle JSON & lecteur type Pinoy appliqué');
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left list of configured modules */}
      <aside className="lg:col-span-4 space-y-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-foreground">
              Modules API ({modules.length})
            </h2>
            <button
              type="button"
              onClick={() => {
                setDraft(makeEmptyModuleDraft());
                setTestReport(null);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-3.5" />
              <span>Nouveau</span>
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Créez de nouvelles sections catalogue (comme Pinoy) accessibles sur{' '}
            <code className="font-mono text-primary">/c/&lt;slug&gt;</code> avec filtres, champs JSON, sections de page et lecteurs configurables.
          </p>

          {modules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Aucun module personnalisé créé. Utilisez l’éditeur à droite pour créer votre premier catalogue API.
            </div>
          ) : (
            <ul className="space-y-2">
              {modules.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(m);
                      setTestReport(null);
                    }}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      draft.slug === m.slug && draft.id === m.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-background hover:bg-accent/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-foreground">{m.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          m.enabled
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-zinc-500/15 text-muted-foreground'
                        }`}
                      >
                        {m.enabled ? 'Actif' : 'Désactivé'}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-primary">
                      {m.slug === 'pinoy' ? '/pinoy' : `/c/${m.slug}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Right module editor */}
      <section className="lg:col-span-8 space-y-5">
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">
                {draft.id ? `Éditer : ${draft.name}` : 'Créer un module API & Lecteur'}
              </h2>
              <p className="text-xs text-muted-foreground">
                Route catalogue :{' '}
                <code className="font-mono text-primary">
                  {draft.slug === 'pinoy' ? '/pinoy' : `/c/${draft.slug || 'slug'}`}
                </code>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={applyPinoyTemplate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent"
              >
                <Sparkles className="size-3.5 text-primary" />
                <span>Préremplir modèle type Pinoy</span>
              </button>
              {draft.id && draft.enabled && (
                <Link
                  to={draft.slug === 'pinoy' ? '/pinoy' : `/c/${encodeURIComponent(draft.slug)}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent"
                >
                  <ExternalLink className="size-3.5 text-primary" />
                  <span>Ouvrir</span>
                </Link>
              )}
              {draft.id && (
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(draft.slug)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" />
                  <span>Supprimer</span>
                </button>
              )}
              <button
                type="button"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Save className="size-3.5" />
                <span>{saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}</span>
              </button>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
            {(
              [
                ['endpoints', '1. Général & Endpoints'],
                ['fields', '2. Champs JSON'],
                ['filters', '3. Filtres'],
                ['sections', '4. Sections & Grille'],
                ['player', '5. Lecteurs & Téléchargement'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSubTab(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  subTab === k
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {/* SUB-TAB 1: GENERAL & ENDPOINTS */}
          {subTab === 'endpoints' && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">Nom affiché</span>
                  <input
                    value={draft.name}
                    maxLength={50}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Ex : Drama Asiatique"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">
                    {draft.slug === 'pinoy' ? 'Slug URL (/pinoy)' : 'Slug URL (/c/<slug>)'}
                  </span>
                  <input
                    value={draft.slug}
                    maxLength={40}
                    disabled={draft.id === 'mod_pinoy_builtin'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                      })
                    }
                    placeholder="drama"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">Badge / étiquette fiche</span>
                  <input
                    value={draft.badgeText}
                    maxLength={24}
                    onChange={(e) => setDraft({ ...draft, badgeText: e.target.value })}
                    placeholder="Drama"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3 items-end">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Icône menu</span>
                    <select
                      value={draft.icon}
                      onChange={(e) => setDraft({ ...draft, icon: e.target.value as MenuIconKey })}
                      className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    >
                      {MENU_ICON_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>Module activé</span>
                  </label>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-border">
                <label className="block text-xs sm:col-span-2">
                  <span className="mb-1 block font-medium text-foreground">
                    URL API distante (HTTPS)
                  </span>
                  <input
                    type="url"
                    value={draft.endpoints.apiUrl}
                    onChange={(e) => patchEndpoints({ apiUrl: e.target.value })}
                    placeholder="https://monsite.com/api_custom.php"
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs sm:col-span-2">
                  <span className="mb-1 block font-medium text-foreground">
                    Domaine de base des médias (pour chemins relatifs)
                  </span>
                  <input
                    type="url"
                    value={draft.endpoints.mediaBaseUrl}
                    onChange={(e) => patchEndpoints({ mediaBaseUrl: e.target.value })}
                    placeholder="https://streamwall.behoririka.mg/"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 pt-2 border-t border-border">
                {(
                  [
                    ['actionParam', 'Param. action'],
                    ['facetsAction', 'Action facets'],
                    ['listAction', 'Action list'],
                    ['detailAction', 'Action detail'],
                    ['detailKeyParam', 'Param. clé détail'],
                    ['queryParam', 'Param. recherche'],
                    ['genreParam', 'Param. genre'],
                    ['countryParam', 'Param. pays'],
                    ['yearParam', 'Param. année'],
                    ['sortParam', 'Param. tri'],
                    ['pageParam', 'Param. page'],
                    ['perPageParam', 'Param. par page'],
                  ] as const
                ).map(([k, lbl]) => (
                  <label key={k} className="block text-[11px]">
                    <span className="mb-1 block text-muted-foreground">{lbl}</span>
                    <input
                      value={draft.endpoints[k]}
                      onChange={(e) => patchEndpoints({ [k]: e.target.value })}
                      className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>
                ))}
                <label className="block text-[11px]">
                  <span className="mb-1 block text-muted-foreground">Items par page</span>
                  <input
                    type="number"
                    min={6}
                    max={100}
                    value={draft.endpoints.perPage}
                    onChange={(e) =>
                      patchEndpoints({ perPage: Math.max(6, Math.min(100, Number(e.target.value) || 24)) })
                    }
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
                <label className="block text-[11px]">
                  <span className="mb-1 block text-muted-foreground">Param. similaires</span>
                  <input
                    value={draft.endpoints.similarLimitParam}
                    onChange={(e) => patchEndpoints({ similarLimitParam: e.target.value })}
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
                <label className="block text-[11px]">
                  <span className="mb-1 block text-muted-foreground">Limite similaires</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={draft.endpoints.similarLimit}
                    onChange={(e) =>
                      patchEndpoints({
                        similarLimit: Math.max(0, Math.min(30, Number(e.target.value) || 12)),
                      })
                    }
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/70 p-3">
                <span className="text-xs text-muted-foreground">
                  Vérifiez la réponse JSON (facets, liste, fiche détail) avant d’enregistrer.
                </span>
                <button
                  type="button"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
                >
                  <FlaskConical className="size-3.5" />
                  <span>{testMutation.isPending ? 'Test en cours…' : 'Tester l’API en direct'}</span>
                </button>
              </div>

              {testReport && (
                <div
                  className={`rounded-xl border p-4 text-xs space-y-2 ${
                    testReport.ok
                      ? 'border-emerald-500/30 bg-emerald-500/10'
                      : 'border-amber-500/30 bg-amber-500/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      {testReport.ok ? (
                        <CheckCircle2 className="size-4 text-emerald-400" />
                      ) : (
                        <XCircle className="size-4 text-amber-400" />
                      )}
                      <span>{testReport.message}</span>
                    </span>
                    <span className="font-mono text-muted-foreground">{testReport.latencyMs} ms</span>
                  </div>
                  <p className="text-muted-foreground tabular-nums">
                    Facets : {testReport.facetsCount.genres} genres, {testReport.facetsCount.countries}{' '}
                    pays · Liste : {testReport.listCount} éléments ({testReport.totalItems} total)
                    {testReport.sampleItem
                      ? ` · Exemple : ${testReport.sampleItem.titre} (${testReport.sampleEmbedCount} lecteur(s), ${testReport.sampleDownloadCount} téléchargement(s))`
                      : ''}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 2: JSON FIELD MAPPING */}
          {subTab === 'fields' && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Indiquez les chemins JSON (notation par points, ex :{' '}
                <code className="font-mono text-primary">players.embed</code>) retournés par votre API.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ['listItemsPath', 'Liste · tableau items'],
                    ['listPagePath', 'Liste · page courante'],
                    ['listTotalPath', 'Liste · total items'],
                    ['listTotalPagesPath', 'Liste · total pages'],
                    ['facetsGenresPath', 'Facets · genres'],
                    ['facetsCountriesPath', 'Facets · pays'],
                    ['facetsYearMinPath', 'Facets · année min'],
                    ['facetsYearMaxPath', 'Facets · année max'],
                    ['detailItemPath', 'Détail · objet item'],
                    ['detailEmbedsPath', 'Détail · embeds'],
                    ['detailDownloadsPath', 'Détail · téléchargements'],
                    ['detailSimilarPath', 'Détail · similaires'],
                    ['itemIdField', 'Item · id'],
                    ['itemSlugField', 'Item · slug'],
                    ['itemTitleField', 'Item · titre'],
                    ['itemOriginalTitleField', 'Item · titre original'],
                    ['itemYearField', 'Item · année'],
                    ['itemReleaseDateField', 'Item · date sortie'],
                    ['itemCountryField', 'Item · pays'],
                    ['itemDurationField', 'Item · durée'],
                    ['itemRatingField', 'Item · note'],
                    ['itemGenresField', 'Item · genres'],
                    ['itemSynopsisField', 'Item · synopsis'],
                    ['itemPosterField', 'Item · poster'],
                    ['itemGalleryField', 'Item · galerie'],
                    ['playerUrlField', 'Lecteur · URL'],
                    ['playerProviderField', 'Lecteur · nom serveur'],
                    ['playerQualityField', 'Lecteur · qualité'],
                    ['playerLanguageField', 'Lecteur · langue'],
                  ] as const
                ).map(([k, lbl]) => (
                  <label key={k} className="block text-[11px]">
                    <span className="mb-1 block text-muted-foreground">{lbl}</span>
                    <input
                      value={draft.fields[k]}
                      onChange={(e) => patchFields({ [k]: e.target.value })}
                      className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* SUB-TAB 3: FILTERS */}
          {subTab === 'filters' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 text-xs text-foreground">
                {(
                  [
                    ['showSearch', 'Barre de recherche'],
                    ['showGenreFilter', 'Filtre Genre'],
                    ['showCountryFilter', 'Filtre Pays'],
                    ['showYearFilter', 'Filtre Année'],
                    ['showSortFilter', 'Sélecteur de tri'],
                  ] as const
                ).map(([k, lbl]) => (
                  <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.filters[k]}
                      onChange={(e) => patchFilters({ [k]: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>{lbl}</span>
                  </label>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">
                    Texte indicatif de recherche
                  </span>
                  <input
                    value={draft.filters.searchPlaceholder}
                    onChange={(e) => patchFilters({ searchPlaceholder: e.target.value })}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">Tri par défaut</span>
                  <select
                    value={draft.filters.defaultSort}
                    onChange={(e) => patchFilters({ defaultSort: e.target.value })}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {draft.filters.sortOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} ({opt.value})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    Options de tri envoyées à l’API
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      patchFilters({
                        sortOptions: [
                          ...draft.filters.sortOptions,
                          { value: 'popular', label: 'Populaires' },
                        ],
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    <Plus className="size-3" />
                    <span>Ajouter un tri</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {draft.filters.sortOptions.map((opt, idx) => (
                    <div key={`${opt.value}-${idx}`} className="flex items-center gap-2">
                      <input
                        value={opt.value}
                        placeholder="recent"
                        onChange={(e) => {
                          const next = [...draft.filters.sortOptions];
                          next[idx] = { ...next[idx], value: e.target.value };
                          patchFilters({ sortOptions: next });
                        }}
                        className="h-8 w-36 rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground"
                      />
                      <input
                        value={opt.label}
                        placeholder="Plus récents"
                        onChange={(e) => {
                          const next = [...draft.filters.sortOptions];
                          next[idx] = { ...next[idx], label: e.target.value };
                          patchFilters({ sortOptions: next });
                        }}
                        className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
                      />
                      {draft.filters.sortOptions.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            patchFilters({
                              sortOptions: draft.filters.sortOptions.filter((_, i) => i !== idx),
                            })
                          }
                          aria-label="Supprimer option de tri"
                          className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SUB-TAB 4: SECTIONS & GRID */}
          {subTab === 'sections' && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">
                    Titre page catalogue
                  </span>
                  <input
                    value={draft.sections.catalogueTitle}
                    onChange={(e) => patchSections({ catalogueTitle: e.target.value })}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">
                    Sous-titre page catalogue
                  </span>
                  <input
                    value={draft.sections.catalogueSubtitle}
                    onChange={(e) => patchSections({ catalogueSubtitle: e.target.value })}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">
                    Colonnes grille mobile
                  </span>
                  <select
                    value={draft.sections.mobileGridCols}
                    onChange={(e) =>
                      patchSections({ mobileGridCols: Number(e.target.value) === 2 ? 2 : 3 })
                    }
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground"
                  >
                    <option value={3}>3 colonnes (compact)</option>
                    <option value={2}>2 colonnes (grandes cartes)</option>
                  </select>
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-foreground">
                    Colonnes grille ordinateur
                  </span>
                  <select
                    value={draft.sections.desktopGridCols}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      patchSections({
                        desktopGridCols: val === 4 ? 4 : val === 5 ? 5 : 6,
                      });
                    }}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground"
                  >
                    <option value={4}>4 colonnes</option>
                    <option value={5}>5 colonnes</option>
                    <option value={6}>6 colonnes</option>
                  </select>
                </label>
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-xs font-semibold text-foreground">
                  Métadonnées affichées sur les cartes catalogue
                </p>
                <div className="flex flex-wrap gap-4 text-xs text-foreground">
                  {(
                    [
                      ['showRating', 'Note'],
                      ['showYear', 'Année'],
                      ['showDuration', 'Durée'],
                      ['showCountry', 'Pays'],
                    ] as const
                  ).map(([k, lbl]) => (
                    <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.sections[k]}
                        onChange={(e) => patchSections({ [k]: e.target.checked })}
                        className="accent-primary"
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-xs font-semibold text-foreground">
                  Sections actives sur la page Détail (
                  {draft.slug === 'pinoy' ? '/pinoy/:id' : `/c/${draft.slug}/:id`})
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2 text-xs text-foreground">
                  {(
                    [
                      ['detailShowHeroGallery', '1ère image galerie en bannière Hero'],
                      ['detailShowSynopsis', 'Section Synopsis'],
                      ['detailShowAvailablePlayersList', 'Liste « Lecteurs disponibles »'],
                      ['detailShowDownloads', 'Section Téléchargements'],
                      ['detailShowGallerySection', 'Section Galerie d’images'],
                      ['detailShowSimilar', 'Section Titres similaires'],
                      ['detailShowComments', 'Section Commentaires'],
                      ['detailShowReportButton', 'Bouton Signaler un lien'],
                    ] as const
                  ).map(([k, lbl]) => (
                    <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.sections[k]}
                        onChange={(e) => patchSections({ [k]: e.target.checked })}
                        className="accent-primary"
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SUB-TAB 5: PLAYERS & DOWNLOADS */}
          {subTab === 'player' && (
            <div className="space-y-4">
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-foreground">
                  Modèle d’URL du lecteur principal (optionnel — variables{' '}
                  <code className="font-mono text-primary">{'{id}'}</code>,{' '}
                  <code className="font-mono text-primary">{'{slug}'}</code>)
                </span>
                <input
                  value={draft.player.playerUrlTemplate}
                  onChange={(e) => patchPlayer({ playerUrlTemplate: e.target.value })}
                  placeholder="https://streamwall.behoririka.mg/pinoy/{id}"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground"
                />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block font-medium text-foreground">
                  Nom du lecteur principal
                </span>
                <input
                  value={draft.player.primaryPlayerLabel}
                  maxLength={60}
                  onChange={(e) => patchPlayer({ primaryPlayerLabel: e.target.value })}
                  placeholder="Lecteur principal"
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                />
              </label>

              <div className="grid gap-2.5 sm:grid-cols-2 text-xs text-foreground pt-2">
                {(
                  [
                    ['useSameOriginProxy', 'Utiliser le proxy same-origin anti X-Frame-Options'],
                    ['showServerSwitcherInModal', 'Afficher sélecteur de serveurs dans la popup lecteur'],
                    ['includeUpstreamEmbeds', 'Inclure aussi les lecteurs embed retournés par l’API'],
                    ['downloadProOnly', 'Téléchargement réservé aux membres Pro'],
                    ['onlyDirectDownloads', 'Filtrer uniquement les liens de téléchargement direct'],
                  ] as const
                ).map(([k, lbl]) => (
                  <label key={k} className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.player[k]}
                      onChange={(e) => patchPlayer({ [k]: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>{lbl}</span>
                  </label>
                ))}
              </div>

              <label className="block text-xs">
                <span className="mb-1 block font-medium text-foreground">
                  Message affiché aux visiteurs & comptes gratuits (si téléchargement réservé Pro)
                </span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={draft.player.downloadRestrictionMessage}
                  onChange={(e) => patchPlayer({ downloadRestrictionMessage: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>

              <div className="rounded-lg border border-border bg-background/70 p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Sliders className="size-3.5 text-primary" />
                  <span>Synchronisation automatique avec le menu</span>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncMenu}
                    onChange={(e) => setSyncMenu(e.target.checked)}
                    className="accent-primary"
                  />
                  <span>Créer / mettre à jour le lien dans la navigation lors de l’enregistrement</span>
                </label>
                {syncMenu && (
                  <div className="flex flex-wrap gap-4 pl-5 text-xs text-muted-foreground">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showDesktop}
                        onChange={(e) => setShowDesktop(e.target.checked)}
                        className="accent-primary"
                      />
                      <span>Ordinateur</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showMobile}
                        onChange={(e) => setShowMobile(e.target.checked)}
                        className="accent-primary"
                      />
                      <span>Mobile</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showFooter}
                        onChange={(e) => setShowFooter(e.target.checked)}
                        className="accent-primary"
                      />
                      <span>Pied de page</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
