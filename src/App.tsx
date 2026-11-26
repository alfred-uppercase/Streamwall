import React, { Suspense, lazy, useEffect } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { api, AuthProvider, useAuth } from './lib/client';
import { isMenuLinkVisibleForUser } from './lib/menuIcons';
import { SiteConfigProvider, useSiteConfig } from './lib/siteConfig';
import { ThemeProvider, useTheme } from './lib/theme';
import { Navbar } from './components/Navbar';
import { HomePage } from './pages/HomePage';
import { AnalyticsTracker } from './components/AnalyticsTracker';
import { OfflineIndicator } from './components/PWAInstallButton';
import { PopupManager } from './components/PopupManager';
import { WebPushAutoPrompt } from './components/WebPushAutoPrompt';
import { AppErrorBoundary } from './components/ErrorBoundary';
import type { MenuLinkConfig } from './shared/types';

const CataloguePage = lazy(() =>
  import('./pages/CataloguePage').then((m) => ({ default: m.CataloguePage }))
);
const DetailPage = lazy(() =>
  import('./pages/DetailPage').then((m) => ({ default: m.DetailPage }))
);
const SuggestionPage = lazy(() =>
  import('./pages/SuggestionPage').then((m) => ({ default: m.SuggestionPage }))
);
const RequestsPage = lazy(() =>
  import('./pages/RequestsPage').then((m) => ({ default: m.RequestsPage }))
);
const FavoritesPage = lazy(() =>
  import('./pages/FavoritesPage').then((m) => ({ default: m.FavoritesPage }))
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage }))
);
const AdminPage = lazy(() =>
  import('./pages/AdminPage').then((m) => ({ default: m.AdminPage }))
);
const PricingPage = lazy(() =>
  import('./pages/PricingPage').then((m) => ({ default: m.PricingPage }))
);
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage }))
);
const AuthPage = lazy(() =>
  import('./pages/AuthPage').then((m) => ({ default: m.AuthPage }))
);
const ResetPasswordPage = lazy(() =>
  import('./pages/AuthPage').then((m) => ({ default: m.ResetPasswordPage }))
);
const PinoyCataloguePage = lazy(() =>
  import('./pages/PinoyCataloguePage').then((m) => ({ default: m.PinoyCataloguePage }))
);
const PinoyDetailPage = lazy(() =>
  import('./pages/PinoyDetailPage').then((m) => ({ default: m.PinoyDetailPage }))
);
const CustomCataloguePage = lazy(() =>
  import('./pages/CustomCataloguePage').then((m) => ({ default: m.CustomCataloguePage }))
);
const CustomDetailPage = lazy(() =>
  import('./pages/CustomDetailPage').then((m) => ({ default: m.CustomDetailPage }))
);
const LinkProtectPage = lazy(() =>
  import('./pages/LinkProtectPage').then((m) => ({ default: m.LinkProtectPage }))
);

function RouteLoadingFallback() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6" aria-busy="true">
      <div className="space-y-4">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-card border border-border" />
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 sm:gap-5">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="aspect-[2/3] animate-pulse rounded-lg bg-card border border-border" />
          ))}
        </div>
      </div>
    </main>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchIntervalInBackground: false,
    },
  },
});

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RequireMember({ children }: { children: React.ReactNode }) {
  const { isMember, loading } = useAuth();
  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 text-center text-sm text-muted-foreground">
        Chargement de votre session…
      </main>
    );
  }
  if (!isMember) {
    return <Navigate to="/auth" replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) {
    return null;
  }
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

const FALLBACK_FOOTER_LINKS: MenuLinkConfig[] = [
  { id: 'f_cat', label: 'Catalogue', path: '/catalogue', icon: 'layout-grid', exact: false, enabled: true, desktop: true, mobile: true, footer: true, order: 30, authRule: 'all' },
  { id: 'f_pinoy', label: 'Pinoy', path: '/pinoy', icon: 'film', exact: false, enabled: true, desktop: true, mobile: true, footer: true, order: 40, authRule: 'all' },
  { id: 'f_sug', label: 'Suggestion', path: '/suggestion', icon: 'sparkles', exact: false, enabled: true, desktop: true, mobile: true, footer: true, order: 50, authRule: 'all' },
  { id: 'f_req', label: 'Demandes', path: '/demandes', icon: 'message-square', exact: false, enabled: true, desktop: false, mobile: false, footer: true, order: 60, authRule: 'all' },
  { id: 'f_pro', label: 'Devenir Pro', path: '/abonnement', icon: 'crown', exact: false, enabled: true, desktop: true, mobile: false, footer: true, order: 70, authRule: 'pro_offers' },
  { id: 'f_priv', label: 'Confidentialité', path: '/confidentialite', icon: 'lock', exact: false, enabled: true, desktop: false, mobile: false, footer: true, order: 80, authRule: 'all' },
  { id: 'f_acc', label: 'Espace membre', path: '/profil', icon: 'user', exact: false, enabled: true, desktop: false, mobile: true, footer: true, order: 100, authRule: 'all', isAccount: true },
];

function AppShell() {
  const { siteName } = useSiteConfig();
  const { isMember, isPro, isAdmin } = useAuth();
  const billingPlansQuery = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api.billingPlans(),
    staleTime: 30_000,
  });
  const navQuery = useQuery({
    queryKey: ['site-navigation'],
    queryFn: () => api.siteNavigation(),
    staleTime: 30_000,
  });
  const hasActiveProPlan = (billingPlansQuery.data?.plans ?? []).some(
    (p) => p.tier === 'pro' && p.active
  );
  const showProMenu =
    Boolean(billingPlansQuery.data?.config?.proOffersMenuVisible) && hasActiveProPlan;

  const footerItems = [...(navQuery.data?.items ?? FALLBACK_FOOTER_LINKS)]
    .sort((a, b) => a.order - b.order)
    .filter(
      (item) =>
        item.footer &&
        isMenuLinkVisibleForUser(item, { isMember, isPro, isAdmin, showProMenu })
    );

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-background text-foreground pb-24 md:pb-0">
      <ScrollToTop />
      <AnalyticsTracker />
      <OfflineIndicator />
      <WebPushAutoPrompt />
      <PopupManager />
      <Navbar />
      <div className="flex-1">
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/catalogue" element={<CataloguePage />} />
            <Route path="/pinoy" element={<PinoyCataloguePage />} />
            <Route path="/pinoy/:slug" element={<PinoyDetailPage />} />
            <Route path="/c/:slug" element={<CustomCataloguePage />} />
            <Route path="/c/:slug/:itemKey" element={<CustomDetailPage />} />
            <Route path="/suggestion" element={<SuggestionPage />} />
            <Route path="/communaute" element={<Navigate to="/" replace />} />
            <Route path="/demandes" element={<RequestsPage />} />
            <Route path="/abonnement" element={<PricingPage />} />
            <Route path="/confidentialite" element={<PrivacyPage />} />
            <Route path="/linprotect/:token" element={<LinkProtectPage />} />
            <Route path="/:type/:id" element={<DetailPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/favoris"
              element={
                <RequireMember>
                  <FavoritesPage />
                </RequireMember>
              }
            />
            <Route
              path="/profil"
              element={
                <RequireMember>
                  <ProfilePage />
                </RequireMember>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminPage />
                </RequireAdmin>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>

      <footer className="mt-16 border-t border-border bg-background/80">
        <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p>
              {siteName} · Projet Tapenaka — Catalogue de films, séries et animes en streaming.
            </p>
            <div className="flex flex-wrap items-center gap-5">
              {footerItems.map((item) => {
                const targetPath = item.isAccount ? (isMember ? '/profil' : '/auth') : item.path;
                const displayLabel =
                  item.isAccount && !isMember ? 'Espace membre' : item.label;
                const isExternal = /^https?:\/\//i.test(targetPath);
                if (isExternal) {
                  return (
                    <a
                      key={item.id}
                      href={targetPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground whitespace-nowrap"
                    >
                      <span>{displayLabel}</span>
                      <ExternalLink className="size-3 opacity-75" />
                    </a>
                  );
                }
                return (
                  <Link
                    key={item.id}
                    to={targetPath}
                    className="hover:text-foreground whitespace-nowrap"
                  >
                    {displayLabel}
                  </Link>
                );
              })}
            </div>
          </div>

          <p className="border-t border-border/60 pt-4 text-[11px] leading-relaxed text-muted-foreground/85">
            Streamwall n&apos;héberge aucun fichier, mais propose des liens vers des services tiers.
            Les questions juridiques doivent être traités avec les hébergeurs et les fournisseurs de
            fichiers. Streamwall  n&apos;est pas responsable des fichiers multimédias diffusés par
            les fournisseurs de vidéos.
          </p>
        </div>
      </footer>
    </div>
  );
}

function AppWithTheme() {
  const { theme } = useTheme();
  return (
    <>
      <AppShell />
      <Toaster theme={theme.mode} position="bottom-right" richColors />
    </>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <SiteConfigProvider>
              <ThemeProvider>
                <AppWithTheme />
              </ThemeProvider>
            </SiteConfigProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
