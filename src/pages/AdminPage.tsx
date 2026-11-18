import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bell,
  CheckCircle2,
  CreditCard,
  Database,
  Eye,
  EyeOff,
  Globe,
  Mail,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fillTemplate,
  isFullUrlTemplate,
  PLAYER_KEYS,
} from '../shared/types';
import type {
  AdminSmtpSettings,
  ApiHealthReport,
  EmailProvider,
  PlayerKey,
  PlayerTemplates,
} from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle, useSiteConfig } from '../lib/siteConfig';
import { AdminAnalyticsTab } from '../components/AdminAnalyticsTab';
import { AdminBillingTab } from '../components/AdminBillingTab';
import { AdminUsersTab } from '../components/AdminUsersTab';
import { AdminNotificationsTab } from '../components/AdminNotificationsTab';
import { ProCrownBadge } from '../components/UserAvatar';

const PLAYER_FIELDS: { key: PlayerKey; label: string; hint: string }[] = [
  {
    key: 'player_guest_film',
    label: 'Film — Visiteurs non connectés (invités)',
    hint: '/film/{id} ou https://serveur.com/film/{id}',
  },
  {
    key: 'player_guest_serie',
    label: 'Série / Anime — Visiteurs non connectés (invités)',
    hint: '/tvs/{id}/{s}/{e} ou https://serveur.com/tvs/{id}/{s}/{e}',
  },
];

type AdminTab =
  | 'analytics'
  | 'offers'
  | 'users'
  | 'notifications'
  | 'api'
  | 'players'
  | 'comments';

const VALID_TABS: AdminTab[] = [
  'analytics',
  'offers',
  'users',
  'notifications',
  'api',
  'players',
  'comments',
];

const TAB_TITLE_MAP: Record<AdminTab, string> = {
  analytics: 'Administration · Statistiques',
  offers: 'Administration · Offres & Paiements',
  users: 'Administration · Utilisateurs',
  notifications: 'Administration · Notifications',
  api: 'Administration · Configuration & API',
  players: 'Administration · Lecteurs',
  comments: 'Administration · Modération',
};

export function AdminPage() {
  const { user: currentUser, backend, isAdmin, refreshUser } = useAuth();
  const { siteName } = useSiteConfig();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const faviconFileInputRef = useRef<HTMLInputElement>(null);

  const rawTab = searchParams.get('tab') as AdminTab | null;
  const tab: AdminTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'users';
  const setTab = (next: AdminTab) => {
    setSearchParams({ tab: next }, { replace: true });
  };

  useDocumentTitle(isAdmin ? TAB_TITLE_MAP[tab] : 'Accès réservé');

  const [preselectedNotifyUserIds, setPreselectedNotifyUserIds] = useState<string[]>([]);

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

  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.adminSettings(),
    enabled: isAdmin,
  });

  const [siteNameInput, setSiteNameInput] = useState('');
  const [faviconUrlInput, setFaviconUrlInput] = useState('');
  const [faviconUploadDataUrl, setFaviconUploadDataUrl] = useState<string | null>(null);

  const [originInput, setOriginInput] = useState('');
  const [embedProviderInput, setEmbedProviderInput] = useState('');
  const [tmdbKeyInput, setTmdbKeyInput] = useState('');
  const [healthReport, setHealthReport] = useState<ApiHealthReport | null>(null);
  const [playerEdits, setPlayerEdits] = useState<Partial<PlayerTemplates>>({});
  const [smtpEdit, setSmtpEdit] = useState<Partial<AdminSmtpSettings>>({});
  const [smtpPassInput, setSmtpPassInput] = useState('');
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [resendKeyInput, setResendKeyInput] = useState('');
  const [showResendKey, setShowResendKey] = useState(false);
  const [brevoKeyInput, setBrevoKeyInput] = useState('');
  const [showBrevoKey, setShowBrevoKey] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');

  useEffect(() => {
    if (settingsQuery.data?.site) {
      if (!siteNameInput) setSiteNameInput(settingsQuery.data.site.siteName);
      if (!faviconUrlInput) setFaviconUrlInput(settingsQuery.data.site.faviconUrl);
    }
  }, [settingsQuery.data?.site, siteNameInput, faviconUrlInput]);

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

  const saveSiteConfigMutation = useMutation({
    mutationFn: (payload: {
      siteName: string;
      faviconUrl?: string;
      faviconUploadDataUrl?: string | null;
    }) => api.adminSaveSiteConfig(payload),
    onSuccess: (res) => {
      setSiteNameInput(res.site.siteName);
      setFaviconUrlInput(res.site.faviconUrl);
      setFaviconUploadDataUrl(null);
      if (faviconFileInputRef.current) faviconFileInputRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['site-config'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Nom du site et favicon enregistrés');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enregistrement impossible'),
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
      setResendKeyInput('');
      setBrevoKeyInput('');
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Configuration email enregistrée');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enregistrement impossible'),
  });

  const testSmtpMutation = useMutation({
    mutationFn: (to: string) => api.adminTestSmtp(to),
    onSuccess: (res) => toast.success(res.message),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Échec du test email'),
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
      void queryClient.invalidateQueries({ queryKey: ['admin-billing'] });
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

  function handleFaviconFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      toast.error('Le fichier favicon doit faire moins de 1,5 Mo.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFaviconUploadDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
        <h1 className="font-display text-3xl font-bold text-foreground">Accès réservé</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette console est accessible uniquement aux administrateurs {siteName}.
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
  const totalWeekPlays = (data?.top7 ?? []).reduce((sum, r) => sum + r.plays, 0);

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
  const previewFaviconSrc = faviconUploadDataUrl || faviconUrlInput || '/favicon.ico';

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
            Console d’administration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Statistiques, offres & paiements (Par Carte ou Crypto), utilisateurs, notifications, configuration du site et lecteurs.
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
            ['notifications', 'Notifications', Bell],
            ['api', 'Configuration & API', Globe],
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

      {/* TAB: DYNAMIC USERS TABLE */}
      {tab === 'users' && (
        <AdminUsersTab
          data={data}
          isError={overviewQuery.isError}
          error={overviewQuery.error}
          availablePlans={availablePlans}
          currentUser={currentUser}
          onRefreshUser={refreshUser}
          onNotifyUser={(userId) => {
            setPreselectedNotifyUserIds([userId]);
            setTab('notifications');
          }}
        />
      )}

      {/* TAB: ADMIN NOTIFICATIONS */}
      {tab === 'notifications' && (
        <AdminNotificationsTab
          users={data?.users ?? []}
          preselectedUserIds={preselectedNotifyUserIds}
        />
      )}

      {/* TAB: SITE CONFIG, API ORIGIN & EMAIL */}
      {tab === 'api' && (
        <div className="space-y-6">
          {/* Site Name & Favicon Configuration */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background overflow-hidden">
                  <img
                    src={previewFaviconSrc}
                    alt="Aperçu favicon"
                    className="size-6 object-contain"
                  />
                </div>
                <div>
                  <h2 className="font-display text-xl font-semibold text-foreground">
                    Configuration du site (Nom & Favicon)
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Personnalisez le nom affiché dans l’en-tête, les titres d’onglets navigateur et l’icône (favicon).
                  </p>
                </div>
              </div>

              {/* Live Browser Tab Preview */}
              <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                <img
                  src={previewFaviconSrc}
                  alt=""
                  className="size-4 shrink-0 object-contain"
                />
                <span className="max-w-48 truncate font-medium text-foreground">
                  Accueil — {siteNameInput.trim() || siteName}
                </span>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveSiteConfigMutation.mutate({
                  siteName: siteNameInput.trim(),
                  faviconUrl: faviconUrlInput.trim(),
                  faviconUploadDataUrl,
                });
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">Nom du site</span>
                  <input
                    required
                    maxLength={60}
                    value={siteNameInput}
                    onChange={(e) => setSiteNameInput(e.target.value)}
                    placeholder="StreamWall"
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1.5 block font-medium text-foreground">
                    URL du Favicon (ou importez un fichier ci-dessous)
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      value={faviconUrlInput}
                      onChange={(e) => {
                        setFaviconUrlInput(e.target.value);
                        setFaviconUploadDataUrl(null);
                      }}
                      placeholder="/favicon.ico ou https://..."
                      className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      title="Réinitialiser par défaut (/favicon.ico)"
                      onClick={() => {
                        setFaviconUrlInput('/favicon.ico');
                        setFaviconUploadDataUrl(null);
                        if (faviconFileInputRef.current) faviconFileInputRef.current.value = '';
                      }}
                      className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <RotateCcw className="size-3.5" />
                      <span>Défaut</span>
                    </button>
                  </div>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-background/60 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={faviconFileInputRef}
                    type="file"
                    accept=".ico,.png,.svg,.jpg,.jpeg,.webp,image/x-icon,image/png,image/svg+xml,image/jpeg,image/webp"
                    onChange={handleFaviconFileChange}
                    className="hidden"
                    id="admin-favicon-upload"
                  />
                  <label
                    htmlFor="admin-favicon-upload"
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
                  >
                    <Upload className="size-3.5 text-primary" />
                    <span>Importer un fichier favicon (.ico, .png, .svg)</span>
                  </label>
                  {faviconUploadDataUrl && (
                    <span className="text-xs font-medium text-emerald-400">
                      Nouveau fichier prêt à être enregistré
                    </span>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={saveSiteConfigMutation.isPending || !siteNameInput.trim()}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {saveSiteConfigMutation.isPending ? 'Enregistrement…' : 'Enregistrer la configuration du site'}
                </button>
              </div>
            </form>
          </section>

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
              Embed provider
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

          {/* Email Configuration: SMTP / Resend API / Brevo API */}
          {mergedSmtp && (
            <section className="rounded-xl border border-border bg-card p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
                    <Mail className="size-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      Configuration Email (SMTP / Resend / Brevo)
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Choisissez entre un serveur SMTP classique ou l’API directe Resend / Brevo pour les emails d’inscription, de confirmation et de réinitialisation.
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
                  <span>Activer l’envoi d’emails</span>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'smtp', label: 'SMTP classique' },
                    { id: 'resend', label: 'Resend API' },
                    { id: 'brevo', label: 'Brevo API' },
                  ] as { id: EmailProvider; label: string }[]
                ).map((opt) => {
                  const active = (mergedSmtp.provider || 'smtp') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSmtpEdit((prev) => ({ ...prev, provider: opt.id }))}
                      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSmtpMutation.mutate({
                    ...smtpEdit,
                    provider: mergedSmtp.provider || 'smtp',
                    enabled: mergedSmtp.enabled,
                    host: mergedSmtp.host,
                    port: Number(mergedSmtp.port) || 587,
                    secure: mergedSmtp.secure,
                    user: mergedSmtp.user,
                    fromName: mergedSmtp.fromName,
                    fromEmail: mergedSmtp.fromEmail,
                    requireSignupConfirmation: mergedSmtp.requireSignupConfirmation,
                    ...(smtpPassInput.trim() ? { pass: smtpPassInput.trim() } : {}),
                    ...(resendKeyInput.trim() ? { resendApiKey: resendKeyInput.trim() } : {}),
                    ...(brevoKeyInput.trim() ? { brevoApiKey: brevoKeyInput.trim() } : {}),
                  });
                }}
                className="space-y-4"
              >
                {(mergedSmtp.provider || 'smtp') === 'smtp' && (
                  <>
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
                  </>
                )}

                {mergedSmtp.provider === 'resend' && (
                  <div className="space-y-2 rounded-lg border border-border bg-background/50 p-4">
                    <label className="block text-xs">
                      <span className="mb-1 flex items-center justify-between gap-2 font-medium text-foreground">
                        <span>Clé API Resend</span>
                        {settingsQuery.data?.smtp?.resendApiKeyMask && (
                          <span className="font-mono text-[11px] text-emerald-400">
                            Actuelle : {settingsQuery.data.smtp.resendApiKeyMask}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type={showResendKey ? 'text' : 'password'}
                          value={resendKeyInput}
                          onChange={(e) => setResendKeyInput(e.target.value)}
                          placeholder={
                            settingsQuery.data?.smtp?.resendApiKeyConfigured
                              ? 'Laisser vide pour conserver la clé Resend actuelle'
                              : 're_xxxxxxxxxxxxxxxxxxxxxxxxx'
                          }
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowResendKey((v) => !v)}
                          aria-label={showResendKey ? 'Masquer' : 'Afficher'}
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                        >
                          {showResendKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      Envoi via <code className="font-mono text-primary">api.resend.com</code>. Indiquez ci-dessous un email d’expéditeur vérifié sur Resend (ou <code className="font-mono text-primary">onboarding@resend.dev</code> pour tester).
                    </p>
                  </div>
                )}

                {mergedSmtp.provider === 'brevo' && (
                  <div className="space-y-2 rounded-lg border border-border bg-background/50 p-4">
                    <label className="block text-xs">
                      <span className="mb-1 flex items-center justify-between gap-2 font-medium text-foreground">
                        <span>Clé API Brevo (v3)</span>
                        {settingsQuery.data?.smtp?.brevoApiKeyMask && (
                          <span className="font-mono text-[11px] text-emerald-400">
                            Actuelle : {settingsQuery.data.smtp.brevoApiKeyMask}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type={showBrevoKey ? 'text' : 'password'}
                          value={brevoKeyInput}
                          onChange={(e) => setBrevoKeyInput(e.target.value)}
                          placeholder={
                            settingsQuery.data?.smtp?.brevoApiKeyConfigured
                              ? 'Laisser vide pour conserver la clé Brevo actuelle'
                              : 'xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxx'
                          }
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBrevoKey((v) => !v)}
                          aria-label={showBrevoKey ? 'Masquer' : 'Afficher'}
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                        >
                          {showBrevoKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      Envoi via <code className="font-mono text-primary">api.brevo.com/v3/smtp/email</code>. Indiquez ci-dessous une adresse d’expéditeur validée dans votre compte Brevo.
                    </p>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Nom d’expéditeur</span>
                    <input
                      value={mergedSmtp.fromName}
                      onChange={(e) =>
                        setSmtpEdit((prev) => ({ ...prev, fromName: e.target.value }))
                      }
                      placeholder={siteName}
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
                  {(mergedSmtp.provider || 'smtp') === 'smtp' && (
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
                  )}

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
                    {saveSmtpMutation.isPending ? 'Enregistrement…' : 'Enregistrer la configuration email'}
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
                Cliquez sur « Tester la connectivité » pour mesurer la disponibilité et la latence réelle des endpoints du serveur amont.
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

      {/* TAB: GUEST PLAYER TEMPLATES */}
      {tab === 'players' && mergedPlayers && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-1 font-display text-xl font-semibold text-foreground">
            Lecteur par défaut (Visiteurs invités)
          </h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Configurez ici uniquement les lecteurs utilisés pour les visiteurs non connectés. Les lecteurs des membres connectés (offres Gratuit et Pro) se configurent directement dans{' '}
            <button
              type="button"
              onClick={() => setTab('offers')}
              className="font-medium text-primary hover:underline"
            >
              Offres & Paiements
            </button>
            . Variables :{' '}
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

      {/* TAB: COMMENT MODERATION */}
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
