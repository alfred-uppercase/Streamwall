import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PrivacyIconKey, PrivacyItem, PrivacyPageConfig, PrivacySection } from '../shared/types';
import { api } from '../lib/client';
import { PrivacyIcon } from '../pages/PrivacyPage';

const ICON_OPTIONS: { value: PrivacyIconKey; label: string }[] = [
  { value: 'lock', label: 'Cadenas (Email / Chiffrement)' },
  { value: 'key', label: 'Clé (Mot de passe / Accès)' },
  { value: 'shield', label: 'Bouclier (Sécurité / OWASP)' },
  { value: 'users', label: 'Profils / Utilisateurs' },
  { value: 'message', label: 'Commentaires / Anonymat' },
  { value: 'eye', label: 'Œil (Historique / Visibilité)' },
  { value: 'devices', label: 'Appareils connectés' },
  { value: 'database', label: 'Base de données / Transparence' },
  { value: 'card', label: 'Paiements sécurisés' },
  { value: 'alert', label: 'Anti-abus / Alerte' },
  { value: 'eye-off', label: 'Œil barré (Anti-spoilers)' },
  { value: 'shield-check', label: 'Bouclier validé (Modération)' },
  { value: 'globe', label: 'Réseau / Web' },
  { value: 'file-text', label: 'Document / Mentions' },
];

function createEmptyItem(): PrivacyItem {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    icon: 'shield',
    title: 'Nouveau point de confidentialité',
    description: '',
    technicalDetails: '',
  };
}

function createEmptySection(): PrivacySection {
  return {
    id: `section-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Nouvelle section',
    items: [createEmptyItem()],
  };
}

export function AdminPrivacyTab() {
  const queryClient = useQueryClient();
  const privacyQuery = useQuery({
    queryKey: ['admin-privacy'],
    queryFn: () => api.adminPrivacy(),
  });

  const [draft, setDraft] = useState<PrivacyPageConfig | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (privacyQuery.data?.privacy && !draft) {
      setDraft(structuredClone(privacyQuery.data.privacy));
    }
  }, [privacyQuery.data?.privacy, draft]);

  const saveMutation = useMutation({
    mutationFn: (payload: PrivacyPageConfig) => api.adminSavePrivacy(payload),
    onSuccess: (res) => {
      setDraft(structuredClone(res.privacy));
      queryClient.setQueryData(['admin-privacy'], res);
      queryClient.setQueryData(['privacy-page'], res);
      toast.success('Page Confidentialité enregistrée.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.adminResetPrivacy(),
    onSuccess: (res) => {
      setDraft(structuredClone(res.privacy));
      setConfirmReset(false);
      queryClient.setQueryData(['admin-privacy'], res);
      queryClient.setQueryData(['privacy-page'], res);
      toast.success('Contenu par défaut restauré.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Impossible de réinitialiser.');
    },
  });

  if (privacyQuery.isLoading || !draft) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Chargement de l’éditeur Confidentialité…
      </div>
    );
  }

  function updateSection(secIndex: number, updater: (sec: PrivacySection) => PrivacySection) {
    setDraft((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map((s, idx) => (idx === secIndex ? updater(s) : s));
      return { ...prev, sections };
    });
  }

  function moveSection(secIndex: number, direction: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = secIndex + direction;
      if (target < 0 || target >= prev.sections.length) return prev;
      const sections = [...prev.sections];
      const [moved] = sections.splice(secIndex, 1);
      sections.splice(target, 0, moved);
      return { ...prev, sections };
    });
  }

  function removeSection(secIndex: number) {
    setDraft((prev) => {
      if (!prev || prev.sections.length <= 1) return prev;
      return {
        ...prev,
        sections: prev.sections.filter((_, idx) => idx !== secIndex),
      };
    });
  }

  function addSection() {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: [...prev.sections, createEmptySection()],
      };
    });
  }

  function moveItem(secIndex: number, itemIndex: number, direction: -1 | 1) {
    updateSection(secIndex, (sec) => {
      const target = itemIndex + direction;
      if (target < 0 || target >= sec.items.length) return sec;
      const items = [...sec.items];
      const [moved] = items.splice(itemIndex, 1);
      items.splice(target, 0, moved);
      return { ...sec, items };
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">
            Éditeur de la page Confidentialité
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Personnalisez librement les sections, cartes, icônes et détails techniques affichés sur{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
              /confidentialite
            </code>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/confidentialite"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-medium text-foreground hover:bg-accent whitespace-nowrap"
          >
            <ExternalLink className="size-3.5" />
            <span>Voir la page</span>
          </Link>

          {confirmReset ? (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs">
              <span className="text-amber-200">Restaurer les textes d’origine ?</span>
              <button
                type="button"
                disabled={resetMutation.isPending}
                onClick={() => resetMutation.mutate()}
                className="rounded bg-amber-500 px-2 py-0.5 font-semibold text-black hover:opacity-90"
              >
                Confirmer
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-1.5 text-muted-foreground hover:text-foreground"
              >
                Annuler
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap"
            >
              <RotateCcw className="size-3.5" />
              <span>Réinitialiser</span>
            </button>
          )}

          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(draft)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            <Save className="size-3.5" />
            <span>{saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}</span>
          </button>
        </div>
      </div>

      {/* Page Header Settings */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">
              Titre principal de la page
            </label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">
              Sous-titre / Introduction
            </label>
            <input
              type="text"
              value={draft.subtitle}
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Sections List */}
      <div className="space-y-6">
        {draft.sections.map((section, secIndex) => (
          <div key={section.id} className="rounded-xl border border-border bg-card p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex-1 min-w-[240px]">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-primary">
                  Section {secIndex + 1}
                </label>
                <input
                  type="text"
                  value={section.title}
                  onChange={(e) =>
                    updateSection(secIndex, (sec) => ({ ...sec, title: e.target.value }))
                  }
                  placeholder="Titre de section (ex. Protection de votre identité)"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 self-end">
                <button
                  type="button"
                  title="Monter la section"
                  disabled={secIndex === 0}
                  onClick={() => moveSection(secIndex, -1)}
                  className="rounded-lg border border-border bg-background p-2 text-muted-foreground hover:text-foreground disabled:opacity-35"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  title="Descendre la section"
                  disabled={secIndex === draft.sections.length - 1}
                  onClick={() => moveSection(secIndex, 1)}
                  className="rounded-lg border border-border bg-background p-2 text-muted-foreground hover:text-foreground disabled:opacity-35"
                >
                  <ArrowDown className="size-4" />
                </button>
                <button
                  type="button"
                  title="Supprimer la section"
                  disabled={draft.sections.length <= 1}
                  onClick={() => removeSection(secIndex)}
                  className="rounded-lg border border-border bg-background p-2 text-muted-foreground hover:border-red-500/40 hover:text-red-400 disabled:opacity-35"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {section.items.map((item, itemIndex) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-xl border border-border/80 bg-background/60 p-4 space-y-3"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-primary">
                        <PrivacyIcon icon={item.icon} className="size-4 shrink-0" />
                        <span className="text-xs font-semibold text-muted-foreground">
                          Bloc {itemIndex + 1}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={itemIndex === 0}
                          onClick={() => moveItem(secIndex, itemIndex, -1)}
                          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                          title="Déplacer avant"
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={itemIndex === section.items.length - 1}
                          onClick={() => moveItem(secIndex, itemIndex, 1)}
                          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                          title="Déplacer après"
                        >
                          <ArrowDown className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateSection(secIndex, (sec) => ({
                              ...sec,
                              items: sec.items.filter((_, idx) => idx !== itemIndex),
                            }))
                          }
                          className="rounded p-1 text-muted-foreground hover:text-red-400"
                          title="Supprimer ce bloc"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Icône
                      </label>
                      <select
                        value={item.icon}
                        onChange={(e) =>
                          updateSection(secIndex, (sec) => ({
                            ...sec,
                            items: sec.items.map((it, idx) =>
                              idx === itemIndex
                                ? { ...it, icon: e.target.value as PrivacyIconKey }
                                : it
                            ),
                          }))
                        }
                        className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      >
                        {ICON_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Titre
                      </label>
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) =>
                          updateSection(secIndex, (sec) => ({
                            ...sec,
                            items: sec.items.map((it, idx) =>
                              idx === itemIndex ? { ...it, title: e.target.value } : it
                            ),
                          }))
                        }
                        className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Texte principal
                      </label>
                      <textarea
                        rows={4}
                        value={item.description}
                        onChange={(e) =>
                          updateSection(secIndex, (sec) => ({
                            ...sec,
                            items: sec.items.map((it, idx) =>
                              idx === itemIndex ? { ...it, description: e.target.value } : it
                            ),
                          }))
                        }
                        className="w-full rounded-lg border border-input bg-background p-2.5 text-xs leading-relaxed text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Détails techniques (optionnel — affiche le menu dépliable)
                      </label>
                      <textarea
                        rows={2}
                        value={item.technicalDetails ?? ''}
                        placeholder="Laisser vide pour masquer « Détails techniques »"
                        onChange={(e) =>
                          updateSection(secIndex, (sec) => ({
                            ...sec,
                            items: sec.items.map((it, idx) =>
                              idx === itemIndex ? { ...it, technicalDetails: e.target.value } : it
                            ),
                          }))
                        }
                        className="w-full rounded-lg border border-input bg-background p-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() =>
                  updateSection(secIndex, (sec) => ({
                    ...sec,
                    items: [...sec.items, createEmptyItem()],
                  }))
                }
                className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/30 p-4 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Plus className="size-5" />
                <span>Ajouter un bloc dans cette section</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={addSection}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
        >
          <Plus className="size-4 text-primary" />
          <span>Ajouter une section</span>
        </button>

        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <CheckCircle2 className="size-4" />
          <span>{saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer les modifications'}</span>
        </button>
      </div>
    </div>
  );
}
