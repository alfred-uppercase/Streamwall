import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Eye,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  MousePointerClick,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  PopupAudience,
  PopupConfig,
  PopupContentMode,
  PopupDeviceTarget,
  PopupFrequency,
  PopupPageScope,
  PopupTriggerType,
} from '../shared/types';
import { api } from '../lib/client';
import { POPUP_STORAGE_KEY, POPUP_SESSION_KEY } from './PopupManager';

interface PopupDraft {
  id?: string;
  name: string;
  enabled: boolean;
  mode: PopupContentMode;
  title: string;
  bodyText: string;
  buttonLabel: string;
  buttonUrl: string;
  buttonNewTab: boolean;
  imageUrl: string;
  imageUploadDataUrl: string | null;
  imageAlt: string;
  imageLink: string;
  imageNewTab: boolean;
  triggerType: PopupTriggerType;
  delaySeconds: number;
  scrollPercent: number;
  minPageViews: number;
  pageScope: PopupPageScope;
  customPaths: string;
  excludePaths: string;
  audience: PopupAudience;
  deviceTarget: PopupDeviceTarget;
  frequency: PopupFrequency;
  customIntervalDays: number;
  closeOnBackdrop: boolean;
  autoCloseSeconds: number;
  priority: number;
  startAt: string;
  endAt: string;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyDraft(): PopupDraft {
  return {
    name: '',
    enabled: true,
    mode: 'text',
    title: '',
    bodyText: '',
    buttonLabel: 'Découvrir',
    buttonUrl: '/abonnement',
    buttonNewTab: false,
    imageUrl: '',
    imageUploadDataUrl: null,
    imageAlt: '',
    imageLink: '',
    imageNewTab: false,
    triggerType: 'after_delay',
    delaySeconds: 10,
    scrollPercent: 40,
    minPageViews: 2,
    pageScope: 'all',
    customPaths: '',
    excludePaths: '/admin, /auth, /reset-password',
    audience: 'all',
    deviceTarget: 'all',
    frequency: 'once_per_week',
    customIntervalDays: 7,
    closeOnBackdrop: true,
    autoCloseSeconds: 0,
    priority: 10,
    startAt: '',
    endAt: '',
  };
}

function popupToDraft(p: PopupConfig): PopupDraft {
  return {
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    mode: p.mode,
    title: p.title,
    bodyText: p.bodyText,
    buttonLabel: p.buttonLabel,
    buttonUrl: p.buttonUrl,
    buttonNewTab: p.buttonNewTab,
    imageUrl: p.imageUrl,
    imageUploadDataUrl: null,
    imageAlt: p.imageAlt,
    imageLink: p.imageLink,
    imageNewTab: p.imageNewTab,
    triggerType: p.triggerType,
    delaySeconds: p.delaySeconds,
    scrollPercent: p.scrollPercent,
    minPageViews: p.minPageViews,
    pageScope: p.pageScope,
    customPaths: p.customPaths,
    excludePaths: p.excludePaths,
    audience: p.audience,
    deviceTarget: p.deviceTarget,
    frequency: p.frequency,
    customIntervalDays: p.customIntervalDays,
    closeOnBackdrop: p.closeOnBackdrop,
    autoCloseSeconds: p.autoCloseSeconds,
    priority: p.priority,
    startAt: toDatetimeLocalValue(p.startAt),
    endAt: toDatetimeLocalValue(p.endAt),
  };
}

const TRIGGER_LABELS: Record<PopupTriggerType, string> = {
  after_delay: 'Après un délai (secondes)',
  on_scroll: 'Au défilement de la page (%)',
  on_exit_intent: 'Intention de quitter la page',
  after_page_views: 'Après X pages vues',
  on_player_open: 'À l’ouverture du lecteur vidéo',
  immediate: 'Immédiat à l’affichage',
};

const FREQUENCY_LABELS: Record<PopupFrequency, string> = {
  once_per_week: '1 fois par semaine (7 jours)',
  once_per_day: '1 fois par jour (24h)',
  once_per_session: '1 fois par session',
  custom_days: 'Personnalisé (tous les X jours)',
  once_ever: '1 seule fois au total',
};

const AUDIENCE_LABELS: Record<PopupAudience, string> = {
  all: 'Tous les visiteurs',
  guests: 'Invités uniquement',
  free: 'Membres Gratuits uniquement',
  guests_and_free: 'Invités & Membres Gratuits',
  pro: 'Membres Pro uniquement',
};

const PAGE_SCOPE_LABELS: Record<PopupPageScope, string> = {
  all: 'Toutes les pages (hors admin)',
  home: 'Accueil uniquement (/)',
  catalogue: 'Catalogue & Suggestions',
  detail: 'Fiches Films, Séries & Animes',
  pricing: 'Page Offres / Abonnement',
  custom: 'Chemins personnalisés',
};

export function AdminPopupsTab() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const popupsQuery = useQuery({
    queryKey: ['admin-popups'],
    queryFn: () => api.adminPopups(),
  });

  const popups = popupsQuery.data?.popups ?? [];
  const [draft, setDraft] = useState<PopupDraft>(emptyDraft);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!draft.id && popups.length > 0 && !draft.name && !draft.title && !draft.imageUrl) {
      setDraft(popupToDraft(popups[0]));
    }
  }, [popups, draft.id, draft.name, draft.title, draft.imageUrl]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setPreviewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  const saveMutation = useMutation({
    mutationFn: (d: PopupDraft) =>
      api.adminSavePopup({
        id: d.id,
        name: d.name.trim() || (d.mode === 'image' ? 'Popup publicitaire' : d.title.trim() || 'Popup'),
        enabled: d.enabled,
        mode: d.mode,
        title: d.title.trim(),
        bodyText: d.bodyText.trim(),
        buttonLabel: d.buttonLabel.trim(),
        buttonUrl: d.buttonUrl.trim(),
        buttonNewTab: d.buttonNewTab,
        imageUrl: d.imageUrl.trim(),
        imageUploadDataUrl: d.imageUploadDataUrl,
        imageAlt: d.imageAlt.trim(),
        imageLink: d.imageLink.trim(),
        imageNewTab: d.imageNewTab,
        triggerType: d.triggerType,
        delaySeconds: Number(d.delaySeconds) || 0,
        scrollPercent: Number(d.scrollPercent) || 40,
        minPageViews: Number(d.minPageViews) || 2,
        pageScope: d.pageScope,
        customPaths: d.customPaths.trim(),
        excludePaths: d.excludePaths.trim(),
        audience: d.audience,
        deviceTarget: d.deviceTarget,
        frequency: d.frequency,
        customIntervalDays: Number(d.customIntervalDays) || 7,
        closeOnBackdrop: d.closeOnBackdrop,
        autoCloseSeconds: Number(d.autoCloseSeconds) || 0,
        priority: Number(d.priority) || 0,
        startAt: d.startAt ? new Date(d.startAt).toISOString() : null,
        endAt: d.endAt ? new Date(d.endAt).toISOString() : null,
      }),
    onSuccess: (res) => {
      setDraft(popupToDraft(res.popup));
      if (fileInputRef.current) fileInputRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['admin-popups'] });
      void queryClient.invalidateQueries({ queryKey: ['active-popups'] });
      toast.success(`Popup « ${res.popup.name} » enregistré.`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enregistrement impossible'),
  });

  const toggleMutation = useMutation({
    mutationFn: (p: PopupConfig) => api.adminSavePopup({ ...p, enabled: !p.enabled }),
    onSuccess: (res) => {
      if (draft.id === res.popup.id) setDraft(popupToDraft(res.popup));
      void queryClient.invalidateQueries({ queryKey: ['admin-popups'] });
      void queryClient.invalidateQueries({ queryKey: ['active-popups'] });
      toast.success(res.popup.enabled ? 'Popup activé' : 'Popup mis en pause');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Modification impossible'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.adminDeletePopup(id),
    onSuccess: (_res, deletedId) => {
      if (draft.id === deletedId) {
        setDraft(emptyDraft());
      }
      void queryClient.invalidateQueries({ queryKey: ['admin-popups'] });
      void queryClient.invalidateQueries({ queryKey: ['active-popups'] });
      toast.success('Popup supprimé.');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Suppression impossible'),
  });

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3_500_000) {
      toast.error('L’image publicitaire doit faire moins de 3,5 Mo.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDraft((prev) => ({ ...prev, imageUploadDataUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  }

  function resetLocalPopupCooldown() {
    try {
      localStorage.removeItem(POPUP_STORAGE_KEY);
      sessionStorage.removeItem(POPUP_SESSION_KEY);
      toast.success('Compteur local d’affichage réinitialisé sur ce navigateur.');
    } catch {
      toast.error('Impossible de réinitialiser le stockage local.');
    }
  }

  const previewImgSrc = draft.imageUploadDataUrl || draft.imageUrl;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: List of configured popups */}
        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">
                Popups ({popups.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                Ajoutez un ou plusieurs popups texte ou photo publicitaire.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDraft(emptyDraft());
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
            >
              <Plus className="size-3.5" />
              <span>Nouveau popup</span>
            </button>
          </div>

          {popups.length === 0 ? (
            <div className="rounded-lg border border-border bg-background/60 p-6 text-center text-xs text-muted-foreground space-y-2">
              <Sparkles className="mx-auto size-5 text-primary" />
              <p>Aucun popup configuré pour le moment.</p>
              <p>Créez votre premier popup à droite (texte + bouton ou photo publicitaire).</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {popups.map((p) => {
                const selected = draft.id === p.id;
                return (
                  <li key={p.id} className="py-3 first:pt-1 last:pb-1">
                    <div
                      className={`rounded-lg p-3 transition-colors ${
                        selected ? 'bg-accent' : 'hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(popupToDraft(p));
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            {p.mode === 'image' ? (
                              <ImageIcon className="size-4 shrink-0 text-primary" />
                            ) : (
                              <Type className="size-4 shrink-0 text-primary" />
                            )}
                            <span className="truncate text-sm font-semibold text-foreground">
                              {p.name}
                            </span>
                            <span
                              className={`text-[11px] font-semibold ${
                                p.enabled ? 'text-emerald-400' : 'text-muted-foreground'
                              }`}
                            >
                              {p.enabled ? 'Actif' : 'Pause'}
                            </span>
                          </div>

                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {p.mode === 'image' ? 'Photo publicitaire sans bordure' : 'Texte & Bouton'} ·{' '}
                            {FREQUENCY_LABELS[p.frequency]}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {TRIGGER_LABELS[p.triggerType]} · {AUDIENCE_LABELS[p.audience]}
                          </p>
                          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <Eye className="size-3" />
                              {p.impressions} affichage{p.impressions > 1 ? 's' : ''}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <MousePointerClick className="size-3" />
                              {p.clicks} clic{p.clicks > 1 ? 's' : ''}
                            </span>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleMutation.mutate(p)}
                            className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                              p.enabled
                                ? 'border-border bg-background text-muted-foreground hover:text-foreground'
                                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                            }`}
                          >
                            {p.enabled ? 'Désactiver' : 'Activer'}
                          </button>
                          <button
                            type="button"
                            aria-label={`Supprimer ${p.name}`}
                            onClick={() => deleteMutation.mutate(p.id)}
                            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-border pt-3 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              Tester de nouveau sur ce navigateur :
            </span>
            <button
              type="button"
              onClick={resetLocalPopupCooldown}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent whitespace-nowrap shrink-0"
            >
              <RotateCcw className="size-3" />
              <span>Réinitialiser l’historique local</span>
            </button>
          </div>
        </section>

        {/* Right: Full Popup & Trigger Configurator */}
        <section className="rounded-xl border border-border bg-card p-6 lg:col-span-7">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate(draft);
            }}
            className="space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-foreground">
                  {draft.id ? `Modifier : ${draft.name}` : 'Créer un nouveau popup'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Choisissez entre texte avec bouton ou photo publicitaire pure (sans bordure), puis réglez le déclenchement.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  className="size-4 accent-primary"
                />
                <span>Popup actif</span>
              </label>
            </div>

            {/* Name + Format Selector */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="mb-1.5 block font-medium text-foreground">
                  Nom interne (admin)
                </span>
                <input
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Ex. Promo Offre Pro / Partenaire"
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>

              <div className="text-xs">
                <span className="mb-1.5 block font-medium text-foreground">Type de popup</span>
                <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border bg-background p-1">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, mode: 'text' })}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                      draft.mode === 'text'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Type className="size-3.5" />
                    <span>Texte & Bouton</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, mode: 'image' })}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                      draft.mode === 'image'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <ImageIcon className="size-3.5" />
                    <span>Photo publicitaire</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Content Fields based on Mode */}
            {draft.mode === 'text' ? (
              <div className="space-y-4 rounded-lg border border-border bg-background/50 p-4">
                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Titre du popup</span>
                  <input
                    maxLength={120}
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="Ex. Profitez de l’offre Pro sans publicité"
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Texte / Message</span>
                  <textarea
                    rows={3}
                    maxLength={800}
                    value={draft.bodyText}
                    onChange={(e) => setDraft({ ...draft, bodyText: e.target.value })}
                    placeholder="Décrivez votre annonce ou promotion…"
                    className="w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="mb-1.5 block font-medium text-foreground">
                      Texte du bouton (optionnel)
                    </span>
                    <input
                      maxLength={60}
                      value={draft.buttonLabel}
                      onChange={(e) => setDraft({ ...draft, buttonLabel: e.target.value })}
                      placeholder="Ex. Découvrir Pro"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1.5 block font-medium text-foreground">
                      Lien du bouton
                    </span>
                    <input
                      value={draft.buttonUrl}
                      onChange={(e) => setDraft({ ...draft, buttonUrl: e.target.value })}
                      placeholder="/abonnement ou https://..."
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>

                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={draft.buttonNewTab}
                    onChange={(e) => setDraft({ ...draft, buttonNewTab: e.target.checked })}
                    className="size-4 accent-primary"
                  />
                  <span>Ouvrir le lien du bouton dans un nouvel onglet</span>
                </label>
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border border-border bg-background/50 p-4">
                <p className="text-xs text-muted-foreground">
                  En mode photo publicitaire, le popup affiche <strong className="text-foreground">uniquement votre photo sans bordure ni texte ni bouton supplémentaire</strong>, avec un lien cliquable optionnel sur la photo.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="mb-1.5 block font-medium text-foreground">
                      URL de la photo (ou importez ci-dessous)
                    </span>
                    <input
                      value={draft.imageUrl}
                      onChange={(e) =>
                        setDraft({ ...draft, imageUrl: e.target.value, imageUploadDataUrl: null })
                      }
                      placeholder="https://... ou /assets/..."
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1.5 block font-medium text-foreground">
                      Lien sur la photo (optionnel)
                    </span>
                    <input
                      value={draft.imageLink}
                      onChange={(e) => setDraft({ ...draft, imageLink: e.target.value })}
                      placeholder="/abonnement ou https://... (laisser vide si aucun lien)"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      onChange={handleImageUpload}
                      className="hidden"
                      id="popup-image-upload"
                    />
                    <label
                      htmlFor="popup-image-upload"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
                    >
                      <Upload className="size-3.5 text-primary" />
                      <span>Importer une photo (.png, .jpg, .webp…)</span>
                    </label>
                    {draft.imageUploadDataUrl && (
                      <span className="text-xs font-medium text-emerald-400">
                        Photo prête à être enregistrée
                      </span>
                    )}
                  </div>

                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={draft.imageNewTab}
                      onChange={(e) => setDraft({ ...draft, imageNewTab: e.target.checked })}
                      className="size-4 accent-primary"
                    />
                    <span>Ouvrir le lien dans un nouvel onglet</span>
                  </label>
                </div>

                {previewImgSrc && (
                  <div className="space-y-1.5">
                    <span className="block text-[11px] font-medium text-muted-foreground">
                      Aperçu (rendu sans bordure) :
                    </span>
                    <div className="inline-block bg-transparent">
                      <img
                        src={previewImgSrc}
                        alt={draft.imageAlt || draft.name || 'Aperçu publicitaire'}
                        referrerPolicy="no-referrer"
                        className="block max-h-48 max-w-full object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Complete Trigger & Schedule Configuration */}
            <div className="space-y-4 border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-primary" />
                <h4 className="text-sm font-semibold text-foreground">
                  Configuration de déclenchement complète
                </h4>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Déclencheur</span>
                  <select
                    value={draft.triggerType}
                    onChange={(e) =>
                      setDraft({ ...draft, triggerType: e.target.value as PopupTriggerType })
                    }
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(Object.entries(TRIGGER_LABELS) as [PopupTriggerType, string][]).map(
                      ([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </label>

                {(draft.triggerType === 'after_delay' || draft.triggerType === 'on_player_open') && (
                  <label className="block text-xs">
                    <span className="mb-1.5 block font-medium text-foreground">
                      Délai avant affichage (secondes)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={600}
                      value={draft.delaySeconds}
                      onChange={(e) => setDraft({ ...draft, delaySeconds: Number(e.target.value) })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                )}

                {draft.triggerType === 'on_scroll' && (
                  <label className="block text-xs">
                    <span className="mb-1.5 block font-medium text-foreground">
                      Pourcentage de défilement (%)
                    </span>
                    <input
                      type="number"
                      min={5}
                      max={100}
                      value={draft.scrollPercent}
                      onChange={(e) => setDraft({ ...draft, scrollPercent: Number(e.target.value) })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                )}

                {draft.triggerType === 'after_page_views' && (
                  <label className="block text-xs">
                    <span className="mb-1.5 block font-medium text-foreground">
                      Nombre de pages vues dans la session
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={draft.minPageViews}
                      onChange={(e) => setDraft({ ...draft, minPageViews: Number(e.target.value) })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Fréquence d’affichage</span>
                  <select
                    value={draft.frequency}
                    onChange={(e) =>
                      setDraft({ ...draft, frequency: e.target.value as PopupFrequency })
                    }
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(Object.entries(FREQUENCY_LABELS) as [PopupFrequency, string][]).map(
                      ([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </label>

                {draft.frequency === 'custom_days' && (
                  <label className="block text-xs">
                    <span className="mb-1.5 block font-medium text-foreground">
                      Intervalle (jours)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={draft.customIntervalDays}
                      onChange={(e) =>
                        setDraft({ ...draft, customIntervalDays: Number(e.target.value) })
                      }
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                )}

                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Audience ciblée</span>
                  <select
                    value={draft.audience}
                    onChange={(e) =>
                      setDraft({ ...draft, audience: e.target.value as PopupAudience })
                    }
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(Object.entries(AUDIENCE_LABELS) as [PopupAudience, string][]).map(
                      ([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Appareil</span>
                  <select
                    value={draft.deviceTarget}
                    onChange={(e) =>
                      setDraft({ ...draft, deviceTarget: e.target.value as PopupDeviceTarget })
                    }
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="all">Tous (Desktop & Mobile)</option>
                    <option value="desktop">Ordinateur uniquement</option>
                    <option value="mobile">Mobile uniquement</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Pages ciblées</span>
                  <select
                    value={draft.pageScope}
                    onChange={(e) =>
                      setDraft({ ...draft, pageScope: e.target.value as PopupPageScope })
                    }
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(Object.entries(PAGE_SCOPE_LABELS) as [PopupPageScope, string][]).map(
                      ([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">
                    Pages exclues (séparées par virgule)
                  </span>
                  <input
                    value={draft.excludePaths}
                    onChange={(e) => setDraft({ ...draft, excludePaths: e.target.value })}
                    placeholder="/admin, /auth, /reset-password"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
              </div>

              {draft.pageScope === 'custom' && (
                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">
                    Chemins autorisés (préfixes séparés par virgule)
                  </span>
                  <input
                    value={draft.customPaths}
                    onChange={(e) => setDraft({ ...draft, customPaths: e.target.value })}
                    placeholder="/catalogue, /film/, /serie/"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
              )}

              <div className="grid gap-4 sm:grid-cols-4">
                <label className="block text-xs">
                  <span className="mb-1.5 flex items-center gap-1 font-medium text-foreground">
                    <CalendarClock className="size-3.5 text-primary" />
                    <span>Début (optionnel)</span>
                  </span>
                  <input
                    type="datetime-local"
                    value={draft.startAt}
                    onChange={(e) => setDraft({ ...draft, startAt: e.target.value })}
                    className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Fin (optionnel)</span>
                  <input
                    type="datetime-local"
                    value={draft.endAt}
                    onChange={(e) => setDraft({ ...draft, endAt: e.target.value })}
                    className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Priorité</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={draft.priority}
                    onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">
                    Fermeture auto (sec, 0=non)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={300}
                    value={draft.autoCloseSeconds}
                    onChange={(e) =>
                      setDraft({ ...draft, autoCloseSeconds: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none"
                  />
                </label>
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={draft.closeOnBackdrop}
                  onChange={(e) => setDraft({ ...draft, closeOnBackdrop: e.target.checked })}
                  className="size-4 accent-primary"
                />
                <span>Fermer le popup en cliquant en dehors</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent whitespace-nowrap"
              >
                <Eye className="size-3.5 text-primary" />
                <span>Prévisualiser en direct</span>
              </button>

              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer le popup'}
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Live Preview Modal */}
      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu du popup"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => {
            if (draft.closeOnBackdrop) setPreviewOpen(false);
          }}
        >
          {draft.mode === 'image' ? (
            <div
              className="relative inline-block max-w-[92vw] max-h-[85vh] bg-transparent border-0 p-0 shadow-none"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Fermer l’aperçu"
                onClick={() => setPreviewOpen(false)}
                className="absolute -top-3 -right-3 z-10 grid size-8 place-items-center rounded-full bg-black/80 text-white transition-colors hover:bg-black"
              >
                <X className="size-4" />
              </button>
              {previewImgSrc ? (
                draft.imageLink ? (
                  <a
                    href={draft.imageLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border-0 p-0"
                  >
                    <img
                      src={previewImgSrc}
                      alt={draft.imageAlt || draft.name || 'Publicité'}
                      referrerPolicy="no-referrer"
                      className="block max-h-[85vh] max-w-[92vw] object-contain border-0"
                    />
                  </a>
                ) : (
                  <img
                    src={previewImgSrc}
                    alt={draft.imageAlt || draft.name || 'Publicité'}
                    referrerPolicy="no-referrer"
                    className="block max-h-[85vh] max-w-[92vw] object-contain border-0"
                  />
                )
              ) : (
                <div className="rounded-lg bg-card p-6 text-xs text-muted-foreground">
                  Aucune photo sélectionnée pour cet aperçu.
                </div>
              )}
            </div>
          ) : (
            <div
              className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Fermer l’aperçu"
                onClick={() => setPreviewOpen(false)}
                className="absolute top-3.5 right-3.5 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
              {draft.title && (
                <h3 className="pr-8 font-display text-xl font-bold text-foreground">
                  {draft.title}
                </h3>
              )}
              {draft.bodyText && (
                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                  {draft.bodyText}
                </p>
              )}
              {draft.buttonLabel && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    <span>{draft.buttonLabel}</span>
                    {draft.buttonNewTab && <ExternalLink className="size-3.5" />}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
