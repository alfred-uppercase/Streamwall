import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CreditCard,
  Crown,
  Database,
  Eye,
  EyeOff,
  Mail,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fillTemplate,
  isFullUrlTemplate,
  PLAYER_KEYS,
  TYPE_LABELS,
} from '../shared/types';
import type {
  AdminSmtpSettings,
  ApiHealthReport,
  Item,
  PlayerKey,
  PlayerTemplates,
} from '../shared/types';
import { api, useAuth } from '../lib/client';
import { AdminAnalyticsTab } from '../components/AdminAnalyticsTab';
import { AdminBillingTab } from '../components/AdminBillingTab';
import { ProCrownBadge, UserAvatar } from '../components/UserAvatar';

const PLAYER_FIELDS: { key: PlayerKey; label: string; hint: string }[] = [
  {
    key: 'player_member_film',
    label: 'Film — Membres (sans publicité)',
    hint: '/film/{id} ou https://serveur.com/film/{id}',
  },
  {
    key: 'player_member_serie',
    label: 'Série / Anime — Membres',
    hint: '/tvs/{id}/{s}/{e} ou https://serveur.com/tv/{id}/{s}/{e}',
  },
  {
    key: 'player_guest_film',
    label: 'Film — Invités (avec publicité)',
    hint: '/movie/{tmdb} ou https://serveur.com/embed/{tmdb}',
  },
  {
    key: 'player_guest_serie',
    label: 'Série / Anime — Invités (avec publicité)',
    hint: '/tv/{tmdb}/{s}/{e} ou https://serveur.com/embed/tv/{tmdb}/{s}/{e}',
  },
];

function ItemRow({ item, extra }: { item: Item; extra?: string }) {
  return (
    <Link
      to={`/${item.item_type}/${item.id}`}
      className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent"
    >
      {item.poster && (
        <img
          src={item.poster}
          alt=""
          referrerPolicy="no-referrer"
          className="h-12 w-8 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.titre}</p>
        <p className="text-xs text-muted-foreground">
          {TYPE_LABELS[item.item_type] ?? item.item_type}
          {item.annee ? ` · ${item.annee}` : ''}
        </p>
      </div>
      {extra && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{extra}</span>}
    </Link>
  );
}

type AdminTab = 'analytics' | 'offers' | 'users' | 'stats' | 'api' | 'players' | 'comments';
const VALID_TABS: AdminTab[] = [
  'analytics',
  'offers',
  'users',
  'stats',
  'api',
  'players',
  'comments',
];

export function AdminPage() {
  const { user: currentUser, backend, isAdmin, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab') as AdminTab | null;
  const tab: AdminTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'users';
  const setTab = (next: AdminTab) => {
    setSearchParams({ tab: next }, { replace: true });
  };

  const [period, setPeriod] = useState<'top7' | 'top30'>('top7');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [assignPlanId, setAssignPlanId] = useState('pro');
  const [assignDays, setAssignDays] = useState('30');

  const overviewQuery = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api.adminOverview(),
    enabled: isAdmin,
    refetchInterval: 15_000,
  });

  const billingQuery = useQuery({
    queryKey: ['admin-billing'],
    queryFn: () => api.adminBilling(),
    enabled: isAdmin,
  });

  const historyQuery = useQuery({
    queryKey: ['admin-history', selectedUserId],
    queryFn: () => api.adminUserHistory(selectedUserId!),
    enabled: Boolean(isAdmin && selectedUserId),
  });

  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.adminSettings(),
    enabled: isAdmin,
  });

  const [originInput, setOriginInput] = useState('');
  const [embedProviderInput, setEmbedProviderInput] = useState('');
  const [tmdbKeyInput, setTmdbKeyInput] = useState('');
  const [healthReport, setHealthReport] = useState<ApiHealthReport | null>(null);
  const [playerEdits, setPlayerEdits] = useState<Partial<PlayerTemplates>>({});
  const [smtpEdit, setSmtpEdit] = useState<Partial<AdminSmtpSettings>>({});
  const [smtpPassInput, setSmtpPassInput] = useState('');
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');

  useEffect(() => {
    if (settingsQuery.data?.origin && !originInput) {
      setOriginInput(settingsQuery.data.origin);
    }
  }, [settingsQuery.data?.origin, originInput]);

  useEffect(() => {
    if (settingsQuery.data?.embedProvider && !embedProviderInput) {
      setEmbedProviderInput(settingsQuery.data.embedProvider);
    }
  }, [settingsQuery.data?.embedProvider, embedProviderInput]);

  useEffect(() => {
    if (settingsQuery.data?.tmdbApiKey && !tmdbKeyInput) {
      setTmdbKeyInput(settingsQuery.data.tmdbApiKey);
    }
  }, [settingsQuery.data?.tmdbApiKey, tmdbKeyInput]);

  useEffect(() => {
    if (currentUser?.email && !testEmailTo) {
      setTestEmailTo(currentUser.email);
    }
  }, [currentUser?.email, testEmailTo]);

  useEffect(() => {
    if (!selectedUserId && overviewQuery.data?.users.length) {
      setSelectedUserId(overviewQuery.data.users[0].id);
    }
  }, [overviewQuery.data?.users, selectedUserId]);

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' }) =>
      api.adminSetUserRole(userId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      toast.success('Rôle utilisateur mis à jour');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action refusée'),
  });

  const assignSubMutation = useMutation({
    mutationFn: ({
      userId,
      planId,
      durationDays,
    }: {
      userId: string;
      planId: string;
      durationDays?: number;
    }) => api.adminAssignUserSubscription(userId, { planId, durationDays }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      void refreshUser();
      toast.success(
        res.subscription.tier === 'pro'
          ? `Statut Pro activé (${res.subscription.planName})`
          : 'Compte repassé en offre Basic (Gratuit)'
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Attribution impossible'),
  });

  const saveOriginMutation = useMutation({
    mutationFn: (origin: string) => api.adminSaveOrigin(origin),
    onSuccess: (res) => {
      setOriginInput(res.origin);
      void queryClient.invalidateQueries();
      toast.success("Domaine de l'API enregistré");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Domaine invalide'),
  });

  const saveEmbedProviderMutation = useMutation({
    mutationFn: (embedProvider: string) => api.adminSaveEmbedProvider(embedProvider),
    onSuccess: (res) => {
      setEmbedProviderInput(res.embedProvider);
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Embed provider enregistré');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'URL Embed provider invalide'),
  });

  const saveSmtpMutation = useMutation({
    mutationFn: (payload: Partial<AdminSmtpSettings>) => api.adminSaveSmtp(payload),
    onSuccess: () => {
      setSmtpEdit({});
      setSmtpPassInput('');
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Configuration SMTP enregistrée');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enregistrement SMTP impossible'),
  });

  const testSmtpMutation = useMutation({
    mutationFn: (to: string) => api.adminTestSmtp(to),
    onSuccess: (res) => toast.success(res.message),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Échec du test SMTP'),
  });

  const saveTmdbMutation = useMutation({
    mutationFn: (key: string) => api.adminSaveTmdbKey(key),
    onSuccess: (res) => {
      setTmdbKeyInput(res.tmdbApiKey);
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['details'] });
      toast.success('Clé API TMDB enregistrée');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Clé API TMDB invalide'),
  });

  const healthMutation = useMutation({
    mutationFn: (origin?: string) => api.adminHealthCheck(origin),
    onSuccess: (report) => setHealthReport(report),
    onError: () => toast.error('Échec du diagnostic distant'),
  });

  const savePlayersMutation = useMutation({
    mutationFn: (players: PlayerTemplates) => api.adminSavePlayers(players),
    onSuccess: () => {
      setPlayerEdits({});
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Modèles des lecteurs enregistrés');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Modèle invalide'),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => api.deleteComment(commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      toast.success('Commentaire supprimé');
    },
  });

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
        <h1 className="font-display text-3xl font-bold text-foreground">Accès réservé</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette console et l’onglet Statistiques sont accessibles uniquement aux administrateurs StreamWall.
        </p>
        {currentUser && (
          <p className="mt-2 mb-6 text-xs text-muted-foreground">
            Compte connecté : <span className="font-medium text-foreground">{currentUser.email}</span> (rôle détecté : membre). Vérifiez que cet utilisateur possède bien le rôle <code className="font-mono text-primary">admin</code> dans votre table <code className="font-mono text-primary">user_roles</code> Supabase.
          </p>
        )}
        <Link
          to="/"
          className="mt-4 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Retour à l’accueil
        </Link>
      </main>
    );
  }

  const data = overviewQuery.data;
  const availablePlans = billingQuery.data?.plans ?? [];
  const onlineUsers = data?.users.filter((u) => u.online) ?? [];
  const watchingNow = onlineUsers.filter((u) => u.currentItem);
  const totalWeekPlays = (data?.top7 ?? []).reduce((sum, r) => sum + r.plays, 0);
  const selectedUser = data?.users.find((u) => u.id === selectedUserId) ?? null;

  const mergedPlayers: PlayerTemplates | null = settingsQuery.data
    ? { ...settingsQuery.data.players, ...playerEdits }
    : null;
  const mergedSmtp = settingsQuery.data?.smtp
    ? { ...settingsQuery.data.smtp, ...smtpEdit }
    : null;
  const embedBase = (
    embedProviderInput ||
    settingsQuery.data?.embedProvider ||
    'https://streamwall.behoririka.mg'
  ).replace(/\/+$/, '');

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
            Console d’administration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Statistiques Web Analytics, offres & paiements (Par Carte ou Crypto), membres Supabase, lecteurs et domaine API.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <Database className="size-3.5 text-primary" />
          <span>
            Base :{' '}
            <strong className="font-medium text-foreground">
              {backend === 'supabase' ? 'Supabase en ligne' : 'Stockage local'}
            </strong>
          </span>
        </div>
      </div>

      {/* 4-column KPI Strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Membres inscrits', value: data?.users.length ?? 0 },
          { label: 'Membres Pro actifs', value: (data?.users ?? []).filter((u) => u.isPro).length },
          { label: 'En ligne (90s)', value: onlineUsers.length },
          { label: 'Lectures cumulées (7j)', value: totalWeekPlays },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
            <p className="mt-2 font-display text-3xl font-bold text-foreground tabular-nums">
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Section Tabs */}
      <div
        role="tablist"
        aria-label="Onglets d'administration"
        className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit"
      >
        {(
          [
            ['analytics', 'Statistiques', BarChart3],
            ['offers', 'Offres & Paiements', CreditCard],
            ['users', 'Utilisateurs', Users],
            ['stats', 'Les plus regardés', null],
            ['api', 'État & Domaine API', null],
            ['players', 'Lecteurs', null],
            ['comments', 'Modération', null],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              tab === key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {Icon && <Icon className="size-4" />}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* TAB: WEB ANALYTICS & STATISTIQUES */}
      {tab === 'analytics' && <AdminAnalyticsTab />}

      {/* TAB: OFFERS & PAYMENTS */}
      {tab === 'offers' && <AdminBillingTab />}

      {/* TAB 1: USERS */}
      {tab === 'users' && (
        <div className="space-y-4">
          {overviewQuery.isError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold">Erreur de chargement des utilisateurs Supabase</p>
                <p className="mt-0.5 text-muted-foreground">
                  {overviewQuery.error instanceof Error
                    ? overviewQuery.error.message
                    : 'Vérifiez vos secrets Supabase et les droits RLS.'}
                </p>
              </div>
            </div>
          )}

          {data?.warning && (
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/40 bg-card p-4 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="text-muted-foreground">{data.warning}</p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Comptes & Présence ({watchingNow.length} en lecture)
                </h2>
                {data?.source && (
                  <span className="text-xs text-muted-foreground">
                    {data.source === 'supabase_auth'
                      ? 'Supabase Auth'
                      : data.source === 'supabase_rpc'
                        ? 'Supabase RPC'
                        : data.source === 'supabase_profiles'
                          ? 'Supabase Profiles'
                          : 'Local'}
                  </span>
                )}
              </div>
              <ul className="divide-y divide-border">
                {(data?.users ?? []).map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedUserId(u.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
                        selectedUserId === u.id ? 'bg-accent' : 'hover:bg-accent/60'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <UserAvatar
                          avatar={u.avatar}
                          seed={u.id}
                          username={u.username}
                          isPro={u.isPro}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {u.username || 'Sans pseudo'}
                            </p>
                            {u.isPro && <ProCrownBadge />}
                            {u.isAdmin && (
                              <span className="text-xs font-medium text-primary">· Admin</span>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right text-xs tabular-nums">
                        <p className={u.online ? 'font-semibold text-emerald-400' : 'text-muted-foreground'}>
                          {u.online
                            ? u.currentItem
                              ? `En lecture : ${u.currentItem.titre}`
                              : 'En ligne'
                            : u.lastSeen
                              ? `Vu ${new Date(u.lastSeen).toLocaleTimeString('fr-FR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}`
                              : 'Hors ligne'}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">{u.plays} lecture(s)</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 space-y-6">
              {!selectedUser ? (
                <p className="text-sm text-muted-foreground">
                  Sélectionnez un utilisateur pour consulter son activité et gérer son statut Pro.
                </p>
              ) : (
                <div>
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        avatar={selectedUser.avatar}
                        seed={selectedUser.id}
                        username={selectedUser.username}
                        isPro={selectedUser.isPro}
                        size="md"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="font-display text-xl font-semibold text-foreground">
                            {selectedUser.username || selectedUser.email}
                          </h2>
                          {selectedUser.isPro && <ProCrownBadge />}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {selectedUser.online ? 'Actuellement en ligne' : 'Hors ligne'} · Inscrit le{' '}
                          {new Date(selectedUser.createdAt).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                    </div>

                    {selectedUser.id !== currentUser?.id && (
                      <button
                        type="button"
                        onClick={() =>
                          roleMutation.mutate({
                            userId: selectedUser.id,
                            role: selectedUser.isAdmin ? 'member' : 'admin',
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent whitespace-nowrap shrink-0"
                      >
                        <Shield className="size-3.5 text-primary" />
                        <span>
                          {selectedUser.isAdmin ? 'Rétrograder Membre' : 'Promouvoir Admin'}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Manual Pro / Basic Assignment Block */}
                  <div className="mb-6 border-b border-border pb-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Crown
                          className={`size-4 ${
                            selectedUser.isPro
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-muted-foreground'
                          }`}
                        />
                        <h3 className="text-sm font-semibold text-foreground">
                          Statut Abonnement :{' '}
                          {selectedUser.isPro
                            ? `${selectedUser.subscription?.planName || 'Pro'}`
                            : 'Basic (Gratuit)'}
                        </h3>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {selectedUser.isPro
                          ? selectedUser.subscription?.expiresAt
                            ? `Expire le ${new Date(selectedUser.subscription.expiresAt).toLocaleDateString('fr-FR')}`
                            : 'Durée illimitée'
                          : 'Rétrogradation auto à expiration'}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="block text-xs">
                        <span className="mb-1 block text-muted-foreground">Offre</span>
                        <select
                          value={assignPlanId}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            setAssignPlanId(nextId);
                            const found = availablePlans.find((p) => p.id === nextId);
                            if (found) setAssignDays(String(found.durationDays));
                          }}
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          {(availablePlans.length > 0
                            ? availablePlans
                            : [
                                { id: 'pro', name: 'Pro Mensuel' },
                                { id: 'pro_yearly', name: 'Pro Annuel' },
                                { id: 'free', name: 'Gratuit (Basic)' },
                              ]
                          ).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs">
                        <span className="mb-1 block text-muted-foreground">
                          Durée (jours, 0 = ∞)
                        </span>
                        <input
                          type="number"
                          min={0}
                          disabled={assignPlanId === 'free'}
                          value={assignDays}
                          onChange={(e) => setAssignDays(e.target.value)}
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none disabled:opacity-50"
                        />
                      </label>

                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          disabled={assignSubMutation.isPending}
                          onClick={() =>
                            assignSubMutation.mutate({
                              userId: selectedUser.id,
                              planId: assignPlanId,
                              durationDays: Math.max(0, Number(assignDays) || 0),
                            })
                          }
                          className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                        >
                          Appliquer
                        </button>
                        {selectedUser.isPro && (
                          <button
                            type="button"
                            disabled={assignSubMutation.isPending}
                            onClick={() =>
                              assignSubMutation.mutate({
                                userId: selectedUser.id,
                                planId: 'free',
                                durationDays: 0,
                              })
                            }
                            className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-medium text-muted-foreground hover:text-destructive whitespace-nowrap"
                          >
                            Passer Basic
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    En cours de lecture
                  </h3>
                  {selectedUser.online && selectedUser.currentItem ? (
                    <ItemRow item={selectedUser.currentItem} extra="En direct" />
                  ) : (
                    <p className="mb-4 text-sm text-muted-foreground">Aucune lecture active.</p>
                  )}

                  <h3 className="mt-6 mb-2 text-xs font-semibold text-muted-foreground">
                    Historique de visionnage
                  </h3>
                  {historyQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Chargement…</p>
                  ) : historyQuery.data?.history.length ? (
                    <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
                      {historyQuery.data.history.map((h) => (
                        <ItemRow
                          key={h.id}
                          item={h.item}
                          extra={new Date(h.viewedAt).toLocaleString('fr-FR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Aucun visionnage enregistré.</p>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: STATS */}
      {tab === 'stats' && (
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Titres les plus regardés
            </h2>
            <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1">
              <button
                type="button"
                onClick={() => setPeriod('top7')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  period === 'top7'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                7 derniers jours
              </button>
              <button
                type="button"
                onClick={() => setPeriod('top30')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  period === 'top30'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                30 derniers jours
              </button>
            </div>
          </div>

          {data?.[period].length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {data[period].map((entry, idx) => (
                <ItemRow
                  key={`${entry.item.item_type}:${entry.item.id}-${idx}`}
                  item={entry.item}
                  extra={`#${idx + 1} · ${entry.viewers} spectateur(s) · ${entry.plays} lecture(s)`}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucun visionnage sur cette période.
            </p>
          )}
        </section>
      )}

      {/* TAB 3: API ORIGIN & LIVE HEALTH DIAGNOSTIC */}
      {tab === 'api' && (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-1 font-display text-xl font-semibold text-foreground">
              Domaine source de l’API
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Domaine interrogé côté serveur pour le catalogue, les fiches détails et le proxy vidéo. En cas d’erreur 522 distante, le cache de secours prend automatiquement le relais.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveOriginMutation.mutate(originInput.trim());
              }}
              className="flex flex-wrap gap-3"
            >
              <input
                type="url"
                required
                value={originInput}
                onChange={(e) => setOriginInput(e.target.value)}
                placeholder="https://streamwall.behoririka.mg"
                className="min-w-64 flex-1 rounded-lg border border-input bg-background px-3.5 py-2.5 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={saveOriginMutation.isPending}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {saveOriginMutation.isPending ? 'Enregistrement…' : 'Enregistrer le domaine'}
              </button>
              <button
                type="button"
                disabled={healthMutation.isPending}
                onClick={() => healthMutation.mutate(originInput.trim())}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`size-4 ${healthMutation.isPending ? 'animate-spin' : ''}`} />
                <span>Tester la connectivité</span>
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-1 font-display text-xl font-semibold text-foreground">
              Embed provider (Modifiable)
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Domaine de base utilisé pour charger les lecteurs embed. Les endpoints comme{' '}
              <code className="font-mono text-primary">/tvs/658/1/1</code> (séries) et{' '}
              <code className="font-mono text-primary">/film/54552</code> (films) s’ajoutent directement à ce domaine.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveEmbedProviderMutation.mutate(embedProviderInput.trim());
              }}
              className="flex flex-wrap gap-3"
            >
              <input
                type="url"
                required
                value={embedProviderInput}
                onChange={(e) => setEmbedProviderInput(e.target.value)}
                placeholder="https://streamwall.behoririka.mg/"
                className="min-w-64 flex-1 rounded-lg border border-input bg-background px-3.5 py-2.5 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={saveEmbedProviderMutation.isPending}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {saveEmbedProviderMutation.isPending ? 'Enregistrement…' : 'Enregistrer Embed provider'}
              </button>
            </form>
            <p className="mt-2.5 font-mono text-xs text-muted-foreground">
              Aperçu série : {embedBase}/tvs/658/1/1 · Aperçu film : {embedBase}/film/54552
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-1 font-display text-xl font-semibold text-foreground">
              Clé API TheMovieDB (TMDB)
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Utilisée côté serveur pour récupérer automatiquement la note TMDB, les saisons, les photos, les titres et descriptions des épisodes.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveTmdbMutation.mutate(tmdbKeyInput.trim());
              }}
              className="flex flex-wrap gap-3"
            >
              <input
                type="text"
                value={tmdbKeyInput}
                onChange={(e) => setTmdbKeyInput(e.target.value)}
                placeholder="cba03e8974108acd7a3b1442dccc6712"
                className="min-w-64 flex-1 rounded-lg border border-input bg-background px-3.5 py-2.5 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={saveTmdbMutation.isPending}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {saveTmdbMutation.isPending ? 'Enregistrement…' : 'Enregistrer la clé TMDB'}
              </button>
            </form>
          </section>

          {/* SMTP / Email Configuration */}
          {mergedSmtp && (
            <section className="rounded-xl border border-border bg-card p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
                    <Mail className="size-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      Configuration Email (SMTP)
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Permet d’envoyer réellement les emails d’inscription, de confirmation, de bienvenue et de réinitialisation de mot de passe.
                    </p>
                  </div>
                </div>

                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={mergedSmtp.enabled}
                    onChange={(e) =>
                      setSmtpEdit((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    className="size-4 accent-primary"
                  />
                  <span>Activer l’envoi d’emails SMTP</span>
                </label>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSmtpMutation.mutate({
                    ...smtpEdit,
                    enabled: mergedSmtp.enabled,
                    host: mergedSmtp.host,
                    port: Number(mergedSmtp.port) || 587,
                    secure: mergedSmtp.secure,
                    user: mergedSmtp.user,
                    fromName: mergedSmtp.fromName,
                    fromEmail: mergedSmtp.fromEmail,
                    requireSignupConfirmation: mergedSmtp.requireSignupConfirmation,
                    ...(smtpPassInput.trim() ? { pass: smtpPassInput.trim() } : {}),
                  });
                }}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block text-xs sm:col-span-2">
                    <span className="mb-1 block font-medium text-foreground">Serveur SMTP (Host)</span>
                    <input
                      value={mergedSmtp.host}
                      onChange={(e) => setSmtpEdit((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="smtp.gmail.com ou smtp-relay.brevo.com"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Port SMTP</span>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={mergedSmtp.port}
                      onChange={(e) =>
                        setSmtpEdit((prev) => ({
                          ...prev,
                          port: Number(e.target.value) || 587,
                          secure: Number(e.target.value) === 465 ? true : prev.secure,
                        }))
                      }
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Utilisateur SMTP</span>
                    <input
                      value={mergedSmtp.user}
                      onChange={(e) => setSmtpEdit((prev) => ({ ...prev, user: e.target.value }))}
                      placeholder="contact@votredomaine.com"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 flex items-center justify-between gap-2 font-medium text-foreground">
                      <span>Mot de passe / Clé SMTP</span>
                      {settingsQuery.data?.smtp?.passMask && (
                        <span className="font-mono text-[11px] text-emerald-400">
                          Actuel : {settingsQuery.data.smtp.passMask}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type={showSmtpPass ? 'text' : 'password'}
                        value={smtpPassInput}
                        onChange={(e) => setSmtpPassInput(e.target.value)}
                        placeholder={
                          settingsQuery.data?.smtp?.passConfigured
                            ? 'Laisser vide pour conserver le mot de passe actuel'
                            : 'Mot de passe ou clé d’application SMTP'
                        }
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPass((v) => !v)}
                        aria-label={showSmtpPass ? 'Masquer' : 'Afficher'}
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                      >
                        {showSmtpPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Nom d’expéditeur</span>
                    <input
                      value={mergedSmtp.fromName}
                      onChange={(e) =>
                        setSmtpEdit((prev) => ({ ...prev, fromName: e.target.value }))
                      }
                      placeholder="StreamWall"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Email d’expéditeur</span>
                    <input
                      type="email"
                      value={mergedSmtp.fromEmail}
                      onChange={(e) =>
                        setSmtpEdit((prev) => ({ ...prev, fromEmail: e.target.value }))
                      }
                      placeholder="noreply@votredomaine.com"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-6 pt-1">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={mergedSmtp.secure}
                      onChange={(e) =>
                        setSmtpEdit((prev) => ({ ...prev, secure: e.target.checked }))
                      }
                      className="size-4 accent-primary"
                    />
                    <span>Connexion chiffrée SSL/TLS directe (port 465)</span>
                  </label>

                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={mergedSmtp.requireSignupConfirmation}
                      onChange={(e) =>
                        setSmtpEdit((prev) => ({
                          ...prev,
                          requireSignupConfirmation: e.target.checked,
                        }))
                      }
                      className="size-4 accent-primary"
                    />
                    <span>Exiger la confirmation par email lors de l’inscription</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
                  <button
                    type="submit"
                    disabled={saveSmtpMutation.isPending}
                    className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                  >
                    {saveSmtpMutation.isPending ? 'Enregistrement…' : 'Enregistrer la configuration SMTP'}
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="email"
                      value={testEmailTo}
                      onChange={(e) => setTestEmailTo(e.target.value)}
                      placeholder="Email de test…"
                      className="w-56 rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={testSmtpMutation.isPending || !testEmailTo.includes('@')}
                      onClick={() => testSmtpMutation.mutate(testEmailTo.trim())}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <Send className="size-3.5 text-primary" />
                      <span>{testSmtpMutation.isPending ? 'Envoi…' : 'Tester l’envoi'}</span>
                    </button>
                  </div>
                </div>
              </form>
            </section>
          )}

          <section className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Activity className="size-5 text-primary" />
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Diagnostic en direct des points d’accès
                </h3>
              </div>
              {healthReport && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Vérifié à {new Date(healthReport.checkedAt).toLocaleTimeString('fr-FR')}
                </span>
              )}
            </div>

            {!healthReport ? (
              <p className="text-sm text-muted-foreground">
                Cliquez sur « Tester la connectivité » pour mesurer la disponibilité et la latence réelle des 4 endpoints du serveur amont.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2.5 pr-4 font-medium">Service</th>
                      <th className="py-2.5 px-4 font-medium">Chemin</th>
                      <th className="py-2.5 px-4 font-medium">État</th>
                      <th className="py-2.5 pl-4 text-right font-medium">Latence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {healthReport.endpoints.map((ep) => (
                      <tr key={ep.endpoint}>
                        <td className="py-3 pr-4 font-medium text-foreground">{ep.name}</td>
                        <td className="py-3 px-4 font-mono text-xs text-muted-foreground">
                          {ep.endpoint}
                        </td>
                        <td className="py-3 px-4">
                          {ep.ok ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                              <CheckCircle2 className="size-4" />
                              <span>HTTP {ep.status} · Opérationnel</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
                              <XCircle className="size-4" />
                              <span>{ep.detail}</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 pl-4 text-right font-mono text-xs text-foreground tabular-nums">
                          {ep.latencyMs} ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 4: PLAYER TEMPLATES */}
      {tab === 'players' && mergedPlayers && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-1 font-display text-xl font-semibold text-foreground">
            Modèles d’URL des lecteurs par défaut
          </h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Accepte un chemin relatif (ex. <code className="font-mono text-primary">/film/{'{id}'}</code>) ou un lien complet si vous changez de serveur (ex. <code className="font-mono text-primary">https://autre-serveur.com/embed/{'{tmdb}'}</code>). Variables :{' '}
            <code className="font-mono text-primary">{'{id}'}</code>,{' '}
            <code className="font-mono text-primary">{'{tmdb}'}</code>,{' '}
            <code className="font-mono text-primary">{'{s}'}</code>,{' '}
            <code className="font-mono text-primary">{'{e}'}</code>.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const payload = {} as PlayerTemplates;
              for (const k of PLAYER_KEYS) payload[k] = mergedPlayers[k];
              savePlayersMutation.mutate(payload);
            }}
            className="grid gap-5 md:grid-cols-2"
          >
            {PLAYER_FIELDS.map((field) => {
              const val = mergedPlayers[field.key];
              const sample = fillTemplate(val, { id: '24044', tmdb: '1541560', s: 1, e: 2 });
              const previewText = !sample
                ? 'Modèle invalide'
                : isFullUrlTemplate(sample)
                  ? `Lien direct : ${sample}`
                  : `Aperçu Embed : ${embedBase}/${sample}`;
              return (
                <label key={field.key} className="block text-sm">
                  <span className="mb-1.5 block font-medium text-foreground">{field.label}</span>
                  <input
                    value={val}
                    onChange={(e) =>
                      setPlayerEdits((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={field.hint}
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                  <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                    {previewText}
                  </span>
                </label>
              );
            })}

            <div className="md:col-span-2 pt-2">
              <button
                type="submit"
                disabled={savePlayersMutation.isPending}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {savePlayersMutation.isPending ? 'Enregistrement…' : 'Enregistrer les modèles'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* TAB 5: COMMENT MODERATION */}
      {tab === 'comments' && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 font-display text-xl font-semibold text-foreground">
            Derniers commentaires publiés
          </h2>
          {data?.recentComments.length ? (
            <ul className="divide-y divide-border">
              {data.recentComments.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-start justify-between gap-4 py-3.5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">@{c.username}</span>
                      {c.isPro && <ProCrownBadge />}
                      <span>·</span>
                      <Link
                        to={`/${c.itemType}/${c.itemId}`}
                        className="text-primary hover:underline"
                      >
                        {c.itemTitle || `${c.itemType} #${c.itemId}`}
                      </Link>
                      <span>·</span>
                      <span className="tabular-nums">
                        {new Date(c.createdAt).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90">{c.body}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteCommentMutation.mutate(c.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="size-3.5" />
                    <span>Supprimer</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun commentaire à modérer.</p>
          )}
        </section>
      )}
    </main>
  );
}
