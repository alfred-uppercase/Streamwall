import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Clock,
  Crown,
  Heart,
  Home,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { NotificationRecord } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useSiteConfig } from '../lib/siteConfig';
import { UserAvatar } from './UserAvatar';
import { PWAInstallButton } from './PWAInstallButton';

function renderNotificationIcon(kind: NotificationRecord['kind']) {
  switch (kind) {
    case 'pro_activated':
      return <Crown className="size-4 fill-amber-400 text-amber-400" />;
    case 'pro_expiring_soon':
      return <Clock className="size-4 text-amber-400" />;
    case 'pro_expired':
      return <AlertTriangle className="size-4 text-rose-400" />;
    case 'admin_announcement':
      return <Megaphone className="size-4 text-primary" />;
    default:
      return <MessageSquare className="size-4 text-primary" />;
  }
}

export function Navbar() {
  const { user, isMember, isAdmin, isPro } = useAuth();
  const { siteName } = useSiteConfig();
  const isFetching = useIsFetching();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [notifOpen, setNotifOpen] = useState(false);
  const notifContainerRef = useRef<HTMLDivElement>(null);

  const billingPlansQuery = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api.billingPlans(),
    staleTime: 30_000,
  });

  const notificationsQuery = useQuery({
    queryKey: ['notifications', user?.id ?? 'guest'],
    queryFn: () => api.notifications(),
    enabled: isMember,
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: (res) => {
      queryClient.setQueryData(['notifications', user?.id ?? 'guest'], res);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: (res) => {
      queryClient.setQueryData(['notifications', user?.id ?? 'guest'], res);
    },
  });

  const clearNotifMutation = useMutation({
    mutationFn: () => api.clearNotifications(false),
    onSuccess: (res) => {
      queryClient.setQueryData(['notifications', user?.id ?? 'guest'], res);
    },
  });

  useEffect(() => {
    setNotifOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (notifContainerRef.current && !notifContainerRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [notifOpen]);

  const hasActiveProPlan = (billingPlansQuery.data?.plans ?? []).some(
    (p) => p.tier === 'pro' && p.active
  );
  const showProMenu =
    Boolean(billingPlansQuery.data?.config?.proOffersMenuVisible) && hasActiveProPlan;

  const notifications = notificationsQuery.data?.notifications ?? [];
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  const desktopNavItems = [
    { to: '/catalogue', label: 'Catalogue', icon: LayoutGrid, exact: false },
    { to: '/suggestion', label: 'Suggestion', icon: Sparkles, exact: false },
    ...(isMember ? [{ to: '/favoris', label: 'Ma liste', icon: Heart, exact: false }] : []),
    ...(showProMenu ? [{ to: '/abonnement', label: 'Devenir Pro', icon: Crown, exact: false }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: Shield, exact: false }] : []),
  ];

  const mobileDockItems = [
    { to: '/', label: 'Accueil', icon: Home, exact: true },
    { to: '/catalogue', label: 'Catalogue', icon: LayoutGrid, exact: false },
    { to: '/favoris', label: 'Favoris', icon: Heart, exact: false },
    { to: '/suggestion', label: 'Suggestion', icon: Sparkles, exact: false },
    {
      to: isMember ? '/profil' : '/auth',
      label: 'Mon compte',
      icon: UserRound,
      exact: false,
      isAccount: true,
    },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
          {/* Zone 1: Brand wordmark (links to Accueil "/") */}
          <Link
            to="/"
            className="font-display text-xl font-bold tracking-tight text-foreground whitespace-nowrap shrink-0 sm:text-2xl"
          >
            {siteName === 'StreamWall' ? (
              <>
                Stream<span className="text-primary">Wall</span>
              </>
            ) : (
              siteName
            )}
          </Link>

          {/* Zone 2: Desktop Navigation Links */}
          <nav
            aria-label="Navigation principale"
            className="hidden md:flex items-center gap-7 text-sm font-medium"
          >
            {desktopNavItems.map((item) => {
              const isItemActive = item.exact
                ? location.pathname === item.to
                : location.pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.exact}
                  className={() =>
                    `whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 ${
                      isItemActive
                        ? 'border-primary text-foreground font-semibold'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          {/* Zone 3: Right Icons — PWA Install, Notifications (members), Loupe (Catalogue) & User Icon */}
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            {isMember && (
              <div ref={notifContainerRef} className="relative">
                <button
                  type="button"
                  aria-label="Notifications"
                  aria-expanded={notifOpen}
                  title="Notifications"
                  onClick={() => setNotifOpen((prev) => !prev)}
                  className="relative inline-flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-primary"
                >
                  <Bell className="size-4.5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 grid min-w-5 h-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground tabular-nums">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div
                    role="dialog"
                    aria-label="Centre de notifications"
                    className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl sm:absolute sm:inset-auto sm:right-0 sm:top-12 sm:w-96"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                      <div>
                        <h2 className="font-display text-sm font-semibold text-foreground">
                          Notifications
                        </h2>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {unreadCount > 0
                            ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}`
                            : 'Toutes lues'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={() => markAllReadMutation.mutate()}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent whitespace-nowrap"
                          >
                            <CheckCheck className="size-3.5" />
                            <span>Tout lire</span>
                          </button>
                        )}
                        {notifications.length > 0 && (
                          <button
                            type="button"
                            aria-label="Effacer les notifications"
                            onClick={() => clearNotifMutation.mutate()}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-destructive whitespace-nowrap"
                          >
                            <Trash2 className="size-3.5" />
                            <span>Effacer</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                        Aucune notification pour le moment. Vous serez alerté des réponses à vos commentaires, mentions et changements d’offre Pro.
                      </div>
                    ) : (
                      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                        {notifications.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              onClick={() => {
                                if (!n.read) markReadMutation.mutate(n.id);
                                setNotifOpen(false);
                                navigate(n.link || '/');
                              }}
                              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/70 ${
                                !n.read ? 'bg-primary/5' : ''
                              }`}
                            >
                              <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background">
                                {renderNotificationIcon(n.kind)}
                              </div>
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-xs font-semibold text-foreground">
                                    {n.title}
                                  </p>
                                  {!n.read && (
                                    <span
                                      aria-label="Non lu"
                                      className="size-2 shrink-0 rounded-full bg-primary"
                                    />
                                  )}
                                </div>
                                <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                                  {n.message}
                                </p>
                                <p className="text-[10px] text-muted-foreground/80 tabular-nums">
                                  {new Date(n.createdAt).toLocaleString('fr-FR', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}
                                </p>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <Link
              to="/catalogue"
              aria-label="Rechercher dans le catalogue"
              title="Rechercher dans le catalogue"
              className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-primary"
            >
              <Search className="size-4.5" />
            </Link>

            <div className="hidden md:flex items-center">
              {!isMember ? (
                <Link
                  to="/auth"
                  aria-label="Se connecter"
                  title="Se connecter"
                  className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-primary"
                >
                  <UserRound className="size-4.5" />
                </Link>
              ) : (
                <Link
                  to="/profil"
                  aria-label={user?.username || 'Mon compte'}
                  title={user?.username || 'Mon compte'}
                  className="inline-flex size-10 items-center justify-center rounded-full transition-transform hover:scale-105"
                >
                  <UserAvatar
                    avatar={user?.avatar}
                    seed={user?.id}
                    username={user?.username}
                    isPro={isPro}
                    size="sm"
                  />
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Top loading indicator matching original StreamWall PageLoadingIndicator */}
        {isFetching > 0 && (
          <div
            role="progressbar"
            aria-label="Chargement des données"
            className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden"
          >
            <div className="progress-bar h-full bg-primary" />
          </div>
        )}
      </header>

      {/* Mobile Floating Bottom Navigation Dock (modern mobile app style) */}
      <nav
        aria-label="Navigation mobile"
        className="fixed bottom-3 inset-x-3 z-40 mx-auto max-w-md rounded-2xl border border-border/90 bg-card/92 px-1.5 py-1.5 shadow-2xl backdrop-blur-md md:hidden"
      >
        <ul className="grid grid-cols-5 items-center gap-0.5">
          {mobileDockItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.isAccount
              ? location.pathname === '/profil' || location.pathname === '/auth'
              : item.exact
                ? location.pathname === item.to
                : location.pathname.startsWith(item.to);

            return (
              <li key={item.label}>
                <Link
                  to={item.to}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-[10px] font-medium tracking-tight transition-colors ${
                    isActive
                      ? 'bg-primary/12 text-primary font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {item.isAccount && isMember ? (
                    <UserAvatar
                      avatar={user?.avatar}
                      seed={user?.id}
                      username={user?.username}
                      isPro={isPro}
                      size="xs"
                    />
                  ) : (
                    <Icon className="size-5 shrink-0" />
                  )}
                  <span className="truncate max-w-full leading-none">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
