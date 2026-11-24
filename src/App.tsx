import React, { useEffect } from 'react';
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
import { api, AuthProvider, useAuth } from './lib/client';
import { isMenuLinkVisibleForUser } from './lib/menuIcons';
import { SiteConfigProvider, useSiteConfig } from './lib/siteConfig';
import { ThemeProvider, useTheme } from './lib/theme';
import { Navbar } from './components/Navbar';
import { HomePage } from './pages/HomePage';
import { CataloguePage } from './pages/CataloguePage';
import { DetailPage } from './pages/DetailPage';
import { SuggestionPage } from './pages/SuggestionPage';
import { RequestsPage } from './pages/RequestsPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminPage } from './pages/AdminPage';
import { PricingPage } from './pages/PricingPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { AuthPage, ResetPasswordPage } from './pages/AuthPage';
import { PinoyCataloguePage } from './pages/PinoyCataloguePage';
import { PinoyDetailPage } from './pages/PinoyDetailPage';
import { CustomCataloguePage } from './pages/CustomCataloguePage';
import { CustomDetailPage } from './pages/CustomDetailPage';
import { AnalyticsTracker } from './components/AnalyticsTracker';
import { OfflineIndicator } from './components/PWAInstallButton';
import { PopupManager } from './components/PopupManager';
import { WebPushAutoPrompt } from './components/WebPushAutoPrompt';
import { AppErrorBoundary } from './components/ErrorBoundary';
import type { MenuLinkConfig } from './shared/types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
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
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/catalogue" element={<CataloguePage />} />
          <Route path="/pinoy" element={<PinoyCataloguePage />} />
          <Route path="/pinoy/:slug" element={<PinoyDetailPage />} />
          <Route path="/c/:slug" element={<CustomCataloguePage />} />
          <Route path="/c/:slug/:itemKey" element={<CustomDetailPage />} />
          <Route path="/suggestion" element={<SuggestionPage />} />
          <Route path="/demandes" element={<RequestsPage />} />
          <Route path="/abonnement" element={<PricingPage />} />
          <Route path="/confidentialite" element={<PrivacyPage />} />
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
