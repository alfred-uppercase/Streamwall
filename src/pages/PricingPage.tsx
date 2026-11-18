import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BillingCycle, PaymentOrder, SubscriptionPlan } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { ProCrownBadge, UserAvatar } from '../components/UserAvatar';

const CYCLE_LABELS: Record<BillingCycle, string> = {
  none: 'Accès libre',
  monthly: 'Par mois',
  quarterly: 'Par trimestre',
  yearly: 'Par an',
  lifetime: 'Accès illimité',
  custom: 'Durée personnalisée',
};

function formatPrice(amount: number, currency: string): string {
  if (amount <= 0) return 'Gratuit';
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || 'EUR'}`;
  }
}

function renderOrderStatus(order: PaymentOrder) {
  switch (order.status) {
    case 'paid':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          <span>Payée & activée</span>
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
          <XCircle className="size-3.5" />
          <span>Refusée</span>
        </span>
      );
    case 'expired':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Clock className="size-3.5" />
          <span>Expirée</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
          <Clock className="size-3.5" />
          <span>En attente</span>
        </span>
      );
  }
}

export function PricingPage() {
  const { user, isMember, isPro, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const plansQuery = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api.billingPlans(),
  });

  const meBillingQuery = useQuery({
    queryKey: ['billing-me', user?.id ?? 'guest'],
    queryFn: () => api.billingMe(),
    enabled: isMember,
    refetchInterval: (query) => {
      const list = query.state.data?.orders ?? [];
      return list.some((o) => o.status === 'pending' && o.method === 'crypto_gate') ? 4000 : false;
    },
  });

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [paymentTab, setPaymentTab] = useState<'crypto_gate' | 'manual'>('crypto_gate');
  const [cryptoOrder, setCryptoOrder] = useState<PaymentOrder | null>(null);

  const [manualChannel, setManualChannel] = useState('MVola / Mobile Money');
  const [manualReference, setManualReference] = useState('');
  const [manualNote, setManualNote] = useState('');

  const plans = plansQuery.data?.plans ?? [];
  const config = plansQuery.data?.config;
  const subscription = meBillingQuery.data?.subscription ?? user?.subscription;
  const orders = meBillingQuery.data?.orders ?? [];

  const returnStatus = searchParams.get('status');

  useEffect(() => {
    if (!config) return;
    if (!config.cryptoGateEnabled && config.manualPaymentEnabled) {
      setPaymentTab('manual');
    } else if (config.cryptoGateEnabled && !config.cryptoGateConfigured && config.manualPaymentEnabled) {
      setPaymentTab('manual');
    }
  }, [config]);

  useEffect(() => {
    if (!selectedPlanId && plans.length > 0) {
      const defaultPro = plans.find((p) => p.tier === 'pro');
      if (defaultPro) setSelectedPlanId(defaultPro.id);
    }
  }, [plans, selectedPlanId]);

  useEffect(() => {
    if (subscription?.tier === 'pro' && !isPro) {
      void refreshUser();
      toast.success('Paiement confirmé ! Votre compte est maintenant Pro.');
    }
  }, [subscription?.tier, isPro, refreshUser]);

  const openInNewTab = (url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const cryptoMutation = useMutation({
    mutationFn: (planId: string) => api.checkoutCryptoGate(planId),
    onSuccess: (res) => {
      setCryptoOrder(res.order);
      void queryClient.invalidateQueries({ queryKey: ['billing-me'] });
      if (res.order.checkoutUrl) {
        openInNewTab(res.order.checkoutUrl);
        toast.success('Page de paiement ouverte dans un nouvel onglet. Activation Pro automatique dès validation.');
      } else {
        toast.success('Lien de paiement Par Carte ou Crypto prêt.');
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Échec de création du paiement.');
    },
  });

  const manualMutation = useMutation({
    mutationFn: (payload: {
      planId: string;
      manualChannel: string;
      manualReference: string;
      note?: string;
    }) => api.checkoutManual(payload),
    onSuccess: () => {
      setManualReference('');
      setManualNote('');
      void queryClient.invalidateQueries({ queryKey: ['billing-me'] });
      toast.success('Paiement envoyé pour validation administrateur.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Envoi impossible.');
    },
  });

  const selectedPlan: SubscriptionPlan | null =
    plans.find((p) => p.id === selectedPlanId) ?? null;

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-6">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-medium text-primary">Abonnements StreamWall · Offres Gratuit & Pro</p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Passez en Pro sans publicité
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Comparez l’accès Gratuit et nos offres Pro : lecteur dédié configuré par offre, couronne dorée Pro sur votre avatar et renouvellement flexible par Carte, Crypto ou paiement manuel.
          </p>
        </div>

        {isMember && user && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <UserAvatar avatar={user.avatar} seed={user.id} username={user.username} isPro={isPro} size="md" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground">{user.username}</span>
                {isPro && <ProCrownBadge />}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {subscription?.tier === 'pro'
                  ? subscription.expiresAt
                    ? `${subscription.planName} · Expire le ${new Date(subscription.expiresAt).toLocaleDateString('fr-FR')}`
                    : `${subscription.planName} · Accès illimité`
                  : `Offre actuelle : ${subscription?.planName || 'Gratuit (Basic)'}`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Checkout return notice */}
      {returnStatus === 'success' && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <div className="flex items-center gap-2.5 text-emerald-300">
            <CheckCircle2 className="size-5 shrink-0" />
            <span>
              Paiement confirmé. Si votre statut Pro n’apparaît pas encore, actualisez la vérification.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshUser();
              void meBillingQuery.refetch();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent whitespace-nowrap shrink-0"
          >
            <RefreshCw className="size-3.5" />
            <span>Actualiser mon statut</span>
          </button>
        </div>
      )}

      {returnStatus === 'cancel' && (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
          <AlertTriangle className="size-5 shrink-0" />
          <span>Le paiement Par Carte ou Crypto a été annulé. Vous pouvez réessayer ou utiliser le paiement manuel.</span>
        </div>
      )}

      {/* Plans Grid */}
      {plansQuery.isLoading ? (
        <div className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-80 animate-pulse rounded-xl border border-border bg-card p-6" />
          ))}
        </div>
      ) : (
        <>
          {!plans.some((p) => p.tier === 'pro' && p.active) && (
            <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              Aucune offre Pro n’est actuellement disponible. Profitez de l’accès Gratuit en attendant l’ouverture des abonnements.
            </div>
          )}
          <div className="grid gap-6 md:grid-cols-3">
            {plans.map((plan) => {
              const isCurrentPlan = subscription?.planId === plan.id && (plan.tier === 'free' || isPro);
              const isSelected = selectedPlan?.id === plan.id;
              const isProPlan = plan.tier === 'pro';

              return (
                <section
                  key={plan.id}
                  className={`flex flex-col justify-between rounded-xl border p-6 transition-colors ${
                    isProPlan
                      ? isSelected
                        ? 'border-amber-400 bg-card'
                        : 'border-amber-400/35 bg-card'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          {isProPlan ? 'Offre Pro' : 'Offre de base'}
                          {plan.durationDays > 0 ? ` · ${plan.durationDays} jours` : ''}
                        </p>
                        <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold text-foreground">
                          {isProPlan && <Crown className="size-5 fill-amber-400 text-amber-400 shrink-0" />}
                          <span>{plan.name}</span>
                        </h2>
                      </div>
                      {isCurrentPlan && (
                        <span className="text-xs font-semibold text-emerald-400 whitespace-nowrap">
                          Actif
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground">{plan.description}</p>

                    <div className="border-y border-border py-4">
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-3xl font-bold text-foreground tabular-nums">
                          {formatPrice(plan.price, plan.currency)}
                        </span>
                        {plan.price > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {CYCLE_LABELS[plan.billingCycle] || ''}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Lecteur configuré :{' '}
                        <span className="font-medium text-foreground">
                          {isProPlan ? 'Lecteur Pro dédié' : 'Lecteur standard'}
                        </span>
                        {plan.autoRenew && isProPlan ? ' · Renouvellement actif' : ''}
                      </p>
                    </div>

                    <ul className="space-y-2.5 text-sm text-foreground/90">
                      {plan.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2.5">
                          <Check
                            className={`mt-0.5 size-4 shrink-0 ${
                              isProPlan ? 'text-amber-400' : 'text-primary'
                            }`}
                          />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6 pt-2">
                    {!isProPlan ? (
                      <div className="rounded-lg border border-border bg-background px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">
                        {isCurrentPlan ? 'Votre offre de base actuelle' : 'Incluse automatiquement sans Pro'}
                      </div>
                    ) : !isMember ? (
                      <Link
                        to="/auth"
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap"
                      >
                        <span>Se connecter pour activer Pro</span>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPlanId(plan.id);
                          setCryptoOrder(null);
                        }}
                        className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 whitespace-nowrap ${
                          isSelected
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-primary text-primary-foreground'
                        }`}
                      >
                        <Crown className="size-4" />
                        <span>
                          {isCurrentPlan
                            ? 'Prolonger cette offre Pro'
                            : isSelected
                              ? 'Offre sélectionnée'
                              : 'Choisir cette offre Pro'}
                        </span>
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* Checkout Drawer / Panel for Signed-In Member */}
      {isMember && selectedPlan && selectedPlan.tier === 'pro' && config && (
        <section className="rounded-xl border border-border bg-card p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="font-display text-xl font-bold text-foreground">
                Finaliser l’abonnement : {selectedPlan.name}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                Montant : <strong className="text-foreground">{formatPrice(selectedPlan.price, selectedPlan.currency)}</strong> ·{' '}
                {selectedPlan.durationDays > 0
                  ? `Validité ${selectedPlan.durationDays} jours (retour automatique en Basic après expiration)`
                  : 'Validité illimitée'}
              </p>
            </div>

            <div
              role="tablist"
              aria-label="Moyen de paiement"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1"
            >
              {config.cryptoGateEnabled && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={paymentTab === 'crypto_gate'}
                  onClick={() => setPaymentTab('crypto_gate')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    paymentTab === 'crypto_gate'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <CreditCard className="size-3.5" />
                  <span>Par Carte ou Crypto</span>
                </button>
              )}
              {config.manualPaymentEnabled && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={paymentTab === 'manual'}
                  onClick={() => setPaymentTab('manual')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    paymentTab === 'manual'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Wallet className="size-3.5" />
                  <span>Paiement manuel</span>
                </button>
              )}
            </div>
          </div>

          {!config.cryptoGateEnabled && !config.manualPaymentEnabled ? (
            <p className="text-sm text-muted-foreground">
              Aucun moyen de paiement en ligne n’est activé actuellement. Contactez un administrateur pour activer votre accès Pro manuellement.
            </p>
          ) : paymentTab === 'crypto_gate' && config.cryptoGateEnabled ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-4">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-foreground">
                    Paiement automatisé Par Carte ou Crypto
                  </p>
                  <p className="text-muted-foreground">
                    Dès génération, la page sécurisée s’ouvre dans un nouvel onglet. Dès confirmation du paiement, votre statut Pro et votre lecteur dédié sont activés automatiquement sans intervention d’un administrateur.
                  </p>
                </div>
              </div>

              {!config.cryptoGateConfigured && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Le paiement automatisé Par Carte ou Crypto est momentanément indisponible. Utilisez l’onglet « Paiement manuel » en attendant.
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={cryptoMutation.isPending || !config.cryptoGateConfigured}
                  onClick={() => cryptoMutation.mutate(selectedPlan.id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <CreditCard className="size-4" />
                  <span>
                    {cryptoMutation.isPending
                      ? 'Génération du lien…'
                      : `Payer ${formatPrice(selectedPlan.price, selectedPlan.currency)} (Par Carte ou Crypto)`}
                  </span>
                </button>

                {cryptoOrder?.checkoutUrl && (
                  <a
                    href={cryptoOrder.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-400/15 px-4 py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-400/25 whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="size-4" />
                    <span>Ouvrir la page de paiement</span>
                  </a>
                )}
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                manualMutation.mutate({
                  planId: selectedPlan.id,
                  manualChannel: manualChannel.trim(),
                  manualReference: manualReference.trim(),
                  note: manualNote.trim() || undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="rounded-lg border border-border bg-background p-4 space-y-1.5">
                <p className="text-sm font-semibold text-foreground">{config.manualPaymentTitle}</p>
                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                  {config.manualPaymentInstructions}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-foreground">Canal utilisé</span>
                  <input
                    required
                    maxLength={60}
                    value={manualChannel}
                    onChange={(e) => setManualChannel(e.target.value)}
                    placeholder="MVola, Orange Money, Virement…"
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-foreground">
                    Référence de transaction
                  </span>
                  <input
                    required
                    maxLength={120}
                    value={manualReference}
                    onChange={(e) => setManualReference(e.target.value)}
                    placeholder="Ex: TXN-88492014"
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-foreground">
                  Note complémentaire (facultatif)
                </span>
                <input
                  maxLength={300}
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="Nom de l'expéditeur ou heure du transfert…"
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>

              <button
                type="submit"
                disabled={manualMutation.isPending || !manualReference.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                <Wallet className="size-4" />
                <span>
                  {manualMutation.isPending ? 'Envoi en cours…' : 'Soumettre mon paiement manuel'}
                </span>
              </button>
            </form>
          )}
        </section>
      )}

      {/* Order History for signed-in user */}
      {isMember && (
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Historique de mes paiements
            </h2>
            <button
              type="button"
              onClick={() => {
                void refreshUser();
                void meBillingQuery.refetch();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`size-3.5 ${meBillingQuery.isFetching ? 'animate-spin' : ''}`} />
              <span>Actualiser</span>
            </button>
          </div>

          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune demande de paiement enregistrée sur votre compte.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2.5 pr-4 font-medium">Date</th>
                    <th className="py-2.5 px-4 font-medium">Offre</th>
                    <th className="py-2.5 px-4 font-medium">Moyen</th>
                    <th className="py-2.5 px-4 font-medium">Référence / Lien</th>
                    <th className="py-2.5 px-4 font-medium text-right">Montant</th>
                    <th className="py-2.5 pl-4 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((ord) => (
                    <tr key={ord.id}>
                      <td className="py-3 pr-4 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {new Date(ord.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="py-3 px-4 font-medium text-foreground">{ord.planName}</td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {ord.method === 'crypto_gate' ? 'Par Carte ou Crypto' : ord.manualChannel || 'Manuel'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-muted-foreground">
                        {ord.manualReference || (
                          ord.checkoutUrl && ord.status === 'pending' ? (
                            <a
                              href={ord.checkoutUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              <span>Lien de paiement</span>
                              <ExternalLink className="size-3" />
                            </a>
                          ) : (
                            ord.id
                          )
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-foreground tabular-nums">
                        {formatPrice(ord.amount, ord.currency)}
                      </td>
                      <td className="py-3 pl-4 whitespace-nowrap">{renderOrderStatus(ord)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
