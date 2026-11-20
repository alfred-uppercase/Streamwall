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
import { AnalyticsTracker } from './components/AnalyticsTracker';
import { OfflineIndicator } from './components/PWAInstallButton';
import { PopupManager } from './components/PopupManager';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
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

function AppShell() {
  const { siteName } = useSiteConfig();
  const billingPlansQuery = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api.billingPlans(),
    staleTime: 30_000,
  });
  const hasActiveProPlan = (billingPlansQuery.data?.plans ?? []).some(
    (p) => p.tier === 'pro' && p.active
  );
  const showProMenu =
    Boolean(billingPlansQuery.data?.config?.proOffersMenuVisible) && hasActiveProPlan;

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-background text-foreground pb-24 md:pb-0">
      <ScrollToTop />
      <AnalyticsTracker />
      <OfflineIndicator />
      <PopupManager />
      <Navbar />
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/catalogue" element={<CataloguePage />} />
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
              <Link to="/catalogue" className="hover:text-foreground whitespace-nowrap">
                Catalogue
              </Link>
              <Link to="/suggestion" className="hover:text-foreground whitespace-nowrap">
                Suggestion
              </Link>
              <Link to="/demandes" className="hover:text-foreground whitespace-nowrap">
                Demandes
              </Link>
              {showProMenu && (
                <Link to="/abonnement" className="hover:text-foreground whitespace-nowrap">
                  Devenir Pro
                </Link>
              )}
              <Link to="/confidentialite" className="hover:text-foreground whitespace-nowrap">
                Confidentialité
              </Link>
              <Link to="/auth" className="hover:text-foreground whitespace-nowrap">
                Espace membre
              </Link>
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
  );
}
