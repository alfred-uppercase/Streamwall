import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fillTemplate,
  isFullUrlTemplate,
  type BillingConfig,
  type BillingCycle,
  type PaymentOrder,
  type PlanTier,
  type SubscriptionPlan,
} from '../shared/types';
import { api } from '../lib/client';

interface PlanDraft {
  id?: string;
  tier: PlanTier;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  durationDays: number;
  autoRenew: boolean;
  active: boolean;
  featuresText: string;
  filmPlayer: string;
  seriePlayer: string;
  filmDownloadsEnabled: boolean;
}

function emptyDraft(): PlanDraft {
  return {
    tier: 'pro',
    name: '',
    description: '',
    price: 4.99,
    currency: 'EUR',
    billingCycle: 'monthly',
    durationDays: 30,
    autoRenew: true,
    active: true,
    featuresText: 'Lecteur Pro sans publicité\nCouronne dorée Pro sur votre avatar',
    filmPlayer: '/film/{id}',
    seriePlayer: '/tvs/{id}/{s}/{e}',
    filmDownloadsEnabled: true,
  };
}

function planToDraft(plan: SubscriptionPlan): PlanDraft {
  return {
    id: plan.id,
    tier: plan.tier,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    billingCycle: plan.billingCycle,
    durationDays: plan.durationDays,
    autoRenew: plan.autoRenew,
    active: plan.active,
    featuresText: plan.features.join('\n'),
    filmPlayer: plan.players.film,
    seriePlayer: plan.players.serie,
    filmDownloadsEnabled:
      typeof plan.filmDownloadsEnabled === 'boolean'
        ? plan.filmDownloadsEnabled
        : plan.tier === 'pro',
  };
}

export function AdminBillingTab() {
  const queryClient = useQueryClient();
  const billingQuery = useQuery({
    queryKey: ['admin-billing'],
    queryFn: () => api.adminBilling(),
    refetchInterval: 20_000,
  });
  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.adminSettings(),
  });
  const embedBase = (settingsQuery.data?.embedProvider || 'https://streamwall.behoririka.mg').replace(/\/+$/, '');

  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [configEdit, setConfigEdit] = useState<Partial<BillingConfig>>({});
  const [orderFilter, setOrderFilter] = useState<'all' | 'pending' | 'paid' | 'rejected'>('all');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const plans = billingQuery.data?.plans ?? [];
  const baseConfig = billingQuery.data?.config;
  const secretsStatus = billingQuery.data?.secrets;
  const mergedConfig: BillingConfig | null = baseConfig ? { ...baseConfig, ...configEdit } : null;
  const orders = billingQuery.data?.orders ?? [];

  useEffect(() => {
    if (!draft && plans.length > 0) {
      setDraft(planToDraft(plans.find((p) => p.tier === 'pro') ?? plans[0]));
    }
  }, [plans, draft]);

  const savePlanMutation = useMutation({
    mutationFn: (d: PlanDraft) =>
      api.adminSavePlan({
        id: d.id,
        tier: d.tier,
        name: d.name.trim(),
        description: d.description.trim(),
        price: d.tier === 'free' ? 0 : Number(d.price) || 0,
        currency: d.currency.trim() || 'EUR',
        billingCycle: d.tier === 'free' ? 'none' : d.billingCycle,
        durationDays: d.tier === 'free' ? 0 : Math.max(0, Number(d.durationDays) || 0),
        autoRenew: d.tier === 'free' ? false : d.autoRenew,
        active: d.active,
        features: d.featuresText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        players: {
          film: d.filmPlayer.trim(),
          serie: d.seriePlayer.trim(),
        },
        filmDownloadsEnabled: d.filmDownloadsEnabled,
      }),
    onSuccess: (res) => {
      setDraft(planToDraft(res.plan));
      void queryClient.invalidateQueries({ queryKey: ['admin-billing'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-plans'] });
      void queryClient.invalidateQueries({ queryKey: ['details'] });
      toast.success(`Offre « ${res.plan.name} » enregistrée.`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Erreur d’enregistrement.'),
  });

  const toggleFilmDownloadsMutation = useMutation({
    mutationFn: ({ plan, enabled }: { plan: SubscriptionPlan; enabled: boolean }) =>
      api.adminSavePlan({
        id: plan.id,
        tier: plan.tier,
        name: plan.name,
        description: plan.description,
        price: plan.price,
        currency: plan.currency,
        billingCycle: plan.billingCycle,
        durationDays: plan.durationDays,
        autoRenew: plan.autoRenew,
        active: plan.active,
        features: plan.features,
        players: plan.players,
        filmDownloadsEnabled: enabled,
      }),
    onSuccess: (res) => {
      setDraft((prev) => (prev?.id === res.plan.id ? planToDraft(res.plan) : prev));
      void queryClient.invalidateQueries({ queryKey: ['admin-billing'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-plans'] });
      void queryClient.invalidateQueries({ queryKey: ['details'] });
      toast.success(
        `Téléchargement films ${
          res.plan.filmDownloadsEnabled ? 'activé' : 'désactivé'
        } pour « ${res.plan.name} ».`
      );
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Mise à jour impossible.'),
  });

  const deletePlanMutation = useMutation({
    mutationFn: (planId: string) => api.adminDeletePlan(planId),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-billing'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-plans'] });
      toast.success('Offre supprimée.');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Suppression impossible.'),
  });

  const saveConfigMutation = useMutation({
    mutationFn: (cfg: Partial<BillingConfig>) => api.adminSaveBillingConfig(cfg),
    onSuccess: () => {
      setConfigEdit({});
      void queryClient.invalidateQueries({ queryKey: ['admin-billing'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-plans'] });
      toast.success('Configuration des paiements enregistrée.');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enregistrement impossible.'),
  });

  const saveSecretsMutation = useMutation({
    mutationFn: (payload: {
      apiKey?: string;
      webhookSecret?: string;
      clearApiKey?: boolean;
      clearWebhookSecret?: boolean;
    }) => api.adminSavePaymentSecrets(payload),
    onSuccess: () => {
      setApiKeyInput('');
      setWebhookSecretInput('');
      void queryClient.invalidateQueries({ queryKey: ['admin-billing'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-plans'] });
      toast.success('Clé API de paiement mise à jour.');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enregistrement impossible.'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ orderId, action }: { orderId: string; action: 'approve' | 'reject' }) =>
      api.adminReviewOrder(orderId, action),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-billing'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      toast.success(
        vars.action === 'approve'
          ? 'Paiement validé et statut Pro activé.'
          : 'Demande de paiement refusée.'
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action impossible.'),
  });

  const filteredOrders = orders.filter((o) => (orderFilter === 'all' ? true : o.status === orderFilter));
  const pendingCount = orders.filter((o) => o.status === 'pending').length;

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhooks/crypto-gate`
      : '/api/webhooks/crypto-gate';

  const filmPreview = draft
    ? fillTemplate(draft.filmPlayer, { id: '24044', tmdb: '1541560', s: 1, e: 1 })
    : null;
  const seriePreview = draft
    ? fillTemplate(draft.seriePlayer, { id: '24044', tmdb: '1541560', s: 1, e: 2 })
    : null;

  return (
    <div className="space-y-8">
      {/* 1. Offers Management + Player Config per Offer */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">
                Offres Gratuit & Pro
              </h2>
              <p className="text-xs text-muted-foreground">
                Prix, renouvellement et lecteur attribué à chaque offre.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft(emptyDraft())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
            >
              <Plus className="size-3.5" />
              <span>Nouvelle offre</span>
            </button>
          </div>

          <ul className="divide-y divide-border">
            {plans.map((plan) => {
              const selected = draft?.id === plan.id;
              const downloadsEnabled =
                typeof plan.filmDownloadsEnabled === 'boolean'
                  ? plan.filmDownloadsEnabled
                  : plan.tier === 'pro';
              return (
                <li key={plan.id} className="py-3 first:pt-1 last:pb-1">
                  <div
                    className={`flex items-start justify-between gap-3 rounded-lg p-3 transition-colors ${
                      selected ? 'bg-accent' : 'hover:bg-accent/50'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <button
                        type="button"
                        onClick={() => setDraft(planToDraft(plan))}
                        className="w-full text-left"
                      >
                        <div className="flex items-center gap-2">
                          {plan.tier === 'pro' && (
                            <Crown className="size-4 fill-amber-400 text-amber-400 shrink-0" />
                          )}
                          <span className="truncate text-sm font-semibold text-foreground">
                            {plan.name}
                          </span>
                          {!plan.active && (
                            <span className="text-xs text-muted-foreground">(Inactive)</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                          {plan.tier === 'free'
                            ? 'Gratuit · Basic'
                            : `${plan.price.toFixed(2)} ${plan.currency} · ${
                                plan.durationDays > 0 ? `${plan.durationDays}j` : 'Illimité'
                              }${plan.autoRenew ? ' · Renouv. auto' : ''}`}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground truncate">
                          Film : {plan.players.film} · Série : {plan.players.serie}
                        </p>
                      </button>

                      <label
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/80 bg-background/70 px-2.5 py-1 text-[11px] transition-colors hover:bg-background"
                      >
                        <input
                          type="checkbox"
                          checked={downloadsEnabled}
                          disabled={toggleFilmDownloadsMutation.isPending}
                          onChange={(e) =>
                            toggleFilmDownloadsMutation.mutate({
                              plan,
                              enabled: e.target.checked,
                            })
                          }
                          className="size-3.5 accent-primary"
                        />
                        <span className="text-muted-foreground">Téléchargements films :</span>
                        <span
                          className={
                            downloadsEnabled
                              ? 'font-semibold text-emerald-500'
                              : 'font-medium text-muted-foreground'
                          }
                        >
                          {downloadsEnabled ? 'Inclus' : 'Désactivé'}
                        </span>
                      </label>
                    </div>

                    {plan.id !== 'free' && (
                      <button
                        type="button"
                        aria-label={`Supprimer ${plan.name}`}
                        onClick={() => deletePlanMutation.mutate(plan.id)}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Plan Editor */}
        <section className="rounded-xl border border-border bg-card p-6 lg:col-span-7">
          {!draft ? (
            <p className="text-sm text-muted-foreground">
              Sélectionnez une offre existante ou cliquez sur « Nouvelle offre ».
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                savePlanMutation.mutate(draft);
              }}
              className="space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <h3 className="font-display text-lg font-semibold text-foreground">
                  {draft.id ? `Modifier : ${draft.name || draft.id}` : 'Créer une nouvelle offre'}
                </h3>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                    className="size-4 accent-primary"
                  />
                  <span>Offre visible et active</span>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-foreground">Nom de l’offre</span>
                  <input
                    required
                    maxLength={60}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Ex: Pro Mensuel"
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-foreground">Niveau d’accès</span>
                  <select
                    disabled={draft.id === 'free'}
                    value={draft.tier}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        tier: e.target.value === 'pro' ? 'pro' : 'free',
                        ...(e.target.value === 'free'
                          ? { price: 0, billingCycle: 'none', durationDays: 0, autoRenew: false }
                          : { billingCycle: draft.billingCycle === 'none' ? 'monthly' : draft.billingCycle, durationDays: draft.durationDays || 30 }),
                      })
                    }
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                  >
                    <option value="free">Gratuit (Basic)</option>
                    <option value="pro">Pro (Couronne dorée + Lecteur Pro)</option>
                  </select>
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-foreground">Description courte</span>
                <input
                  maxLength={240}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Résumé affiché sur la page des offres…"
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>

              {draft.tier === 'pro' && (
                <div className="grid gap-4 sm:grid-cols-4">
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-foreground">Prix</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.price}
                      onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-foreground">Devise</span>
                    <input
                      maxLength={8}
                      value={draft.currency}
                      onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                      placeholder="EUR"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-foreground">Cycle</span>
                    <select
                      value={draft.billingCycle}
                      onChange={(e) => {
                        const cycle = e.target.value as BillingCycle;
                        const presetDays =
                          cycle === 'monthly'
                            ? 30
                            : cycle === 'quarterly'
                              ? 90
                              : cycle === 'yearly'
                                ? 365
                                : cycle === 'lifetime'
                                  ? 0
                                  : draft.durationDays;
                        setDraft({ ...draft, billingCycle: cycle, durationDays: presetDays });
                      }}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    >
                      <option value="monthly">Mensuel</option>
                      <option value="quarterly">Trimestriel</option>
                      <option value="yearly">Annuel</option>
                      <option value="lifetime">À vie</option>
                      <option value="custom">Personnalisé</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-foreground">
                      Durée (jours, 0 = ∞)
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={draft.durationDays}
                      onChange={(e) => setDraft({ ...draft, durationDays: Number(e.target.value) })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>
              )}

              {draft.tier === 'pro' && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.autoRenew}
                    onChange={(e) => setDraft({ ...draft, autoRenew: e.target.checked })}
                    className="size-4 accent-primary"
                  />
                  <span>
                    Proposer le renouvellement récurrent (retour automatique en Basic si non renouvelé avant expiration)
                  </span>
                </label>
              )}

              {/* Per-Offer Player Configuration */}
              <div className="space-y-3 border-t border-border pt-4">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    Configuration du lecteur de cette offre
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Chemin relatif (ex. <code className="font-mono text-primary">/film/{'{id}'}</code>) ou URL complète (ex. <code className="font-mono text-primary">https://serveur.com/embed/{'{tmdb}'}</code>). Variables : <code className="font-mono text-primary">{'{id}'}</code>,{' '}
                    <code className="font-mono text-primary">{'{tmdb}'}</code>,{' '}
                    <code className="font-mono text-primary">{'{s}'}</code>,{' '}
                    <code className="font-mono text-primary">{'{e}'}</code>.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Lecteur Films</span>
                    <input
                      required
                      value={draft.filmPlayer}
                      onChange={(e) => setDraft({ ...draft, filmPlayer: e.target.value })}
                      placeholder={
                        draft.tier === 'pro'
                          ? '/film/{id} ou https://serveur.com/film/{id}'
                          : '/film/{id} ou /movie/{tmdb}'
                      }
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                      Aperçu :{' '}
                      {!filmPreview
                        ? 'Modèle invalide'
                        : isFullUrlTemplate(filmPreview)
                          ? filmPreview
                          : `${embedBase}/${filmPreview}`}
                    </span>
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">
                      Lecteur Séries & Animes
                    </span>
                    <input
                      required
                      value={draft.seriePlayer}
                      onChange={(e) => setDraft({ ...draft, seriePlayer: e.target.value })}
                      placeholder={
                        draft.tier === 'pro'
                          ? '/tvs/{id}/{s}/{e} ou https://serveur.com/tvs/{id}/{s}/{e}'
                          : '/tvs/{id}/{s}/{e} ou /tv/{tmdb}/{s}/{e}'
                      }
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                    <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                      Aperçu :{' '}
                      {!seriePreview
                        ? 'Modèle invalide'
                        : isFullUrlTemplate(seriePreview)
                          ? seriePreview
                          : `${embedBase}/${seriePreview}`}
                    </span>
                  </label>
                </div>

                <label className="inline-flex items-center gap-2 pt-1 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.filmDownloadsEnabled}
                    onChange={(e) =>
                      setDraft({ ...draft, filmDownloadsEnabled: e.target.checked })
                    }
                    className="size-4 accent-primary"
                  />
                  <span>
                    Autoriser le téléchargement direct des films pour cette offre (passerelle LinProtect)
                  </span>
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-foreground">
                  Avantages inclus (1 par ligne)
                </span>
                <textarea
                  rows={3}
                  value={draft.featuresText}
                  onChange={(e) => setDraft({ ...draft, featuresText: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={savePlanMutation.isPending}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  {savePlanMutation.isPending ? 'Enregistrement…' : 'Enregistrer l’offre'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      {/* 2. Payment Gateways Configuration */}
      {mergedConfig && (
        <section className="rounded-xl border border-border bg-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">
                Visibilité & Passerelles de paiement
              </h2>
              <p className="text-xs text-muted-foreground">
                Contrôlez l’affichage du menu « Devenir Pro », le paiement Par Carte ou Crypto et le paiement manuel.
              </p>
            </div>
            <div
              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                mergedConfig.cryptoGateConfigured ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <ShieldCheck className="size-4" />
              <span>
                {mergedConfig.cryptoGateConfigured
                  ? `Clé API Par Carte ou Crypto active${secretsStatus?.apiKeyMask ? ` (${secretsStatus.apiKeyMask})` : ''}`
                  : 'Clé API Par Carte ou Crypto non configurée'}
              </span>
            </div>
          </div>

          {/* Public Navbar Visibility Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-background p-4">
            <div className="flex items-start gap-3">
              {mergedConfig.proOffersMenuVisible ? (
                <Eye className="mt-0.5 size-5 shrink-0 text-primary" />
              ) : (
                <EyeOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Menu « Devenir Pro » dans la barre de navigation
                </p>
                <p className="text-xs text-muted-foreground">
                  {mergedConfig.proOffersMenuVisible
                    ? 'Visible par tous les visiteurs et membres dans le header.'
                    : 'Masqué de la navigation publique pour vos tests. La page /abonnement reste accessible directement pour tester.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                to="/abonnement"
                className="text-xs font-medium text-primary hover:underline whitespace-nowrap shrink-0"
              >
                Tester /abonnement →
              </Link>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent">
                <input
                  type="checkbox"
                  checked={mergedConfig.proOffersMenuVisible}
                  onChange={(e) => {
                    const nextVal = e.target.checked;
                    setConfigEdit((prev) => ({ ...prev, proOffersMenuVisible: nextVal }));
                    saveConfigMutation.mutate({ ...configEdit, proOffersMenuVisible: nextVal });
                  }}
                  className="size-4 accent-primary"
                />
                <span>{mergedConfig.proOffersMenuVisible ? 'Affiché' : 'Masqué'}</span>
              </label>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Par Carte ou Crypto block */}
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <CreditCard className="size-4 text-primary" />
                  <span>Par Carte ou Crypto</span>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mergedConfig.cryptoGateEnabled}
                    onChange={(e) =>
                      setConfigEdit((prev) => ({ ...prev, cryptoGateEnabled: e.target.checked }))
                    }
                    className="size-4 accent-primary"
                  />
                  <span>Activé</span>
                </label>
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <KeyRound className="size-3.5 text-primary" />
                  <span>Identifiants de la passerelle</span>
                </div>

                <label className="block text-xs">
                  <span className="mb-1 flex items-center justify-between gap-2 font-medium text-foreground">
                    <span>Clé API (Par Carte ou Crypto)</span>
                    {secretsStatus?.apiKeyMask && (
                      <span className="font-mono text-[11px] text-emerald-400">
                        Actuelle : {secretsStatus.apiKeyMask}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={
                        secretsStatus?.apiKeyConfigured
                          ? 'Coller une nouvelle clé pour remplacer…'
                          : 'Coller votre clé API…'
                      }
                      className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      aria-label={showApiKey ? 'Masquer la clé' : 'Afficher la clé'}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
                    >
                      {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                </label>

                <label className="block text-xs">
                  <span className="mb-1 flex items-center justify-between gap-2 font-medium text-foreground">
                    <span>Secret Webhook (facultatif)</span>
                    {secretsStatus?.webhookMask && (
                      <span className="font-mono text-[11px] text-emerald-400">
                        Actuel : {secretsStatus.webhookMask}
                      </span>
                    )}
                  </span>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={webhookSecretInput}
                    onChange={(e) => setWebhookSecretInput(e.target.value)}
                    placeholder={
                      secretsStatus?.webhookConfigured
                        ? 'Coller un nouveau secret pour remplacer…'
                        : 'Secret de signature webhook (facultatif)'
                    }
                    className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={
                      saveSecretsMutation.isPending ||
                      (!apiKeyInput.trim() && !webhookSecretInput.trim())
                    }
                    onClick={() =>
                      saveSecretsMutation.mutate({
                        ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
                        ...(webhookSecretInput.trim()
                          ? { webhookSecret: webhookSecretInput.trim() }
                          : {}),
                      })
                    }
                    className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                  >
                    {saveSecretsMutation.isPending ? 'Enregistrement…' : 'Enregistrer la clé API'}
                  </button>
                  {secretsStatus?.apiKeyConfigured && (
                    <button
                      type="button"
                      disabled={saveSecretsMutation.isPending}
                      onClick={() =>
                        saveSecretsMutation.mutate({
                          clearApiKey: true,
                          clearWebhookSecret: true,
                        })
                      }
                      className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:text-destructive whitespace-nowrap"
                    >
                      Effacer la clé
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-foreground">
                  URL Webhook de retour automatique
                </span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground">
                    {webhookUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(webhookUrl);
                      toast.success('URL Webhook copiée');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent shrink-0"
                  >
                    <Copy className="size-3.5" />
                    <span>Copier</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Manual Payment block */}
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Wallet className="size-4 text-primary" />
                  <span>Paiement manuel</span>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mergedConfig.manualPaymentEnabled}
                    onChange={(e) =>
                      setConfigEdit((prev) => ({
                        ...prev,
                        manualPaymentEnabled: e.target.checked,
                      }))
                    }
                    className="size-4 accent-primary"
                  />
                  <span>Activé</span>
                </label>
              </div>

              <label className="block text-xs">
                <span className="mb-1 block font-medium text-foreground">Titre affiché</span>
                <input
                  value={mergedConfig.manualPaymentTitle}
                  onChange={(e) =>
                    setConfigEdit((prev) => ({ ...prev, manualPaymentTitle: e.target.value }))
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block font-medium text-foreground">
                  Instructions pour l’utilisateur
                </span>
                <textarea
                  rows={3}
                  value={mergedConfig.manualPaymentInstructions}
                  onChange={(e) =>
                    setConfigEdit((prev) => ({
                      ...prev,
                      manualPaymentInstructions: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <button
              type="button"
              disabled={saveConfigMutation.isPending}
              onClick={() => saveConfigMutation.mutate(configEdit)}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {saveConfigMutation.isPending
                ? 'Enregistrement…'
                : 'Enregistrer la configuration paiements'}
            </button>
          </div>
        </section>
      )}

      {/* 3. Orders & Manual Review Queue */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground tabular-nums">
              Commandes & Validation manuelle ({pendingCount} en attente)
            </h2>
            <p className="text-xs text-muted-foreground">
              Approuvez un paiement manuel pour activer immédiatement l’offre Pro sur le compte du membre.
            </p>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1">
            {(
              [
                ['all', 'Toutes'],
                ['pending', 'En attente'],
                ['paid', 'Validées'],
                ['rejected', 'Refusées'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setOrderFilter(k)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  orderFilter === k
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Aucune commande dans cette catégorie pour le moment.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="py-2.5 pr-4 font-medium">Date</th>
                  <th className="py-2.5 px-4 font-medium">Membre</th>
                  <th className="py-2.5 px-4 font-medium">Offre</th>
                  <th className="py-2.5 px-4 font-medium">Méthode</th>
                  <th className="py-2.5 px-4 font-medium">Référence</th>
                  <th className="py-2.5 px-4 font-medium text-right">Montant</th>
                  <th className="py-2.5 px-4 font-medium">Statut</th>
                  <th className="py-2.5 pl-4 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredOrders.map((ord: PaymentOrder) => (
                  <tr key={ord.id} className="hover:bg-accent/40">
                    <td className="py-3 pr-4 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {new Date(ord.createdAt).toLocaleString('fr-FR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-foreground">{ord.username}</p>
                      <p className="text-xs text-muted-foreground">{ord.userEmail}</p>
                    </td>
                    <td className="py-3 px-4 font-medium text-foreground">
                      {ord.planName}
                      <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                        ({ord.durationDays > 0 ? `${ord.durationDays}j` : '∞'})
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">
                      {ord.method === 'crypto_gate' ? 'Par Carte ou Crypto' : ord.manualChannel || 'Manuel'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-foreground">
                      <span>{ord.manualReference || ord.id}</span>
                      {ord.note && (
                        <p className="mt-0.5 font-sans text-[11px] text-muted-foreground">{ord.note}</p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-foreground tabular-nums">
                      {ord.amount.toFixed(2)} {ord.currency}
                    </td>
                    <td className="py-3 px-4 text-xs whitespace-nowrap">
                      {ord.status === 'paid' && <span className="text-emerald-400">Validée</span>}
                      {ord.status === 'pending' && <span className="text-amber-400">En attente</span>}
                      {ord.status === 'rejected' && <span className="text-rose-400">Refusée</span>}
                      {ord.status === 'expired' && (
                        <span className="text-muted-foreground">Expirée</span>
                      )}
                    </td>
                    <td className="py-3 pl-4 text-right whitespace-nowrap">
                      {ord.status === 'pending' && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={reviewMutation.isPending}
                            onClick={() =>
                              reviewMutation.mutate({ orderId: ord.id, action: 'approve' })
                            }
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30"
                          >
                            <CheckCircle2 className="size-3.5" />
                            <span>Valider Pro</span>
                          </button>
                          <button
                            type="button"
                            disabled={reviewMutation.isPending}
                            onClick={() =>
                              reviewMutation.mutate({ orderId: ord.id, action: 'reject' })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-destructive"
                          >
                            <XCircle className="size-3.5" />
                            <span>Refuser</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
