import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AdminBroadcastRecord,
  AdminNotificationTarget,
  AdminOverview,
  AdminPaymentSecretsStatus,
  AdminSmtpSettings,
  AdminSmtpStatus,
  ApiHealthReport,
  BillingConfig,
  BillingCycle,
  CatalogueFilters,
  CataloguePage,
  CommentRecord,
  DetailResponse,
  EmailTemplateConfig,
  EmailTemplateKey,
  FriendRecord,
  HomePayload,
  Item,
  MailLogEntry,
  NotificationRecord,
  PaymentOrder,
  PlanTier,
  PlayerTemplates,
  SiteConfig,
  SubscriptionPlan,
  UserProfile,
  UserSubscription,
  UserThemePreference,
  WatchEventRecord,
  WatchProgress,
} from '../shared/types';
import type {
  AnalyticsDashboardPayload,
  AnalyticsPeriodKey,
  RealtimePayload,
} from '../shared/analyticsTypes';

const STORAGE_TOKEN_KEY = 'tapenaka_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(STORAGE_TOKEN_KEY, token);
    else localStorage.removeItem(STORAGE_TOKEN_KEY);
  } catch {
    // Ignore storage errors
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let message = `Erreur (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson?.error) message = errJson.error;
    } catch {
      // Keep fallback message
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export interface MemberPayload {
  profile: UserProfile;
  favorites: Item[];
  progress: WatchProgress[];
  history: WatchEventRecord[];
  friends: FriendRecord[];
}

export const api = {
  me: () => apiRequest<{ user: UserProfile | null; backend?: 'supabase' | 'local' }>('/api/auth/me'),
  login: (email: string, password: string) =>
    apiRequest<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  demoLogin: (role: 'admin' | 'member') =>
    apiRequest<{ token: string; user: UserProfile }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),
  signup: (username: string, email: string, password: string) =>
    apiRequest<{
      token: string;
      user: UserProfile | null;
      requiresCode?: boolean;
      requiresConfirmation?: boolean;
      email?: string;
      expiresInMinutes?: number;
      message?: string;
    }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),
  checkUsername: (username: string) =>
    apiRequest<{ available: boolean; error?: string }>(
      `/api/auth/check-username?username=${encodeURIComponent(username)}`
    ),
  verifySignupCode: (email: string, code: string) =>
    apiRequest<{ token: string; user: UserProfile }>('/api/auth/signup/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  resendSignupCode: (email: string) =>
    apiRequest<{ ok: boolean; message: string }>('/api/auth/signup/resend-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  verifyEmail: (token: string) =>
    apiRequest<{ token: string; user: UserProfile }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  logout: () =>
    apiRequest<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),
  forgotPassword: (email: string) =>
    apiRequest<{ message: string; resetPath: string | null }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (password: string, token?: string | null) =>
    apiRequest<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ password, token: token ?? '' }),
    }),
  home: () => apiRequest<HomePayload>('/api/home'),
  catalogue: (filters: CatalogueFilters) => {
    const p = new URLSearchParams({
      q: filters.q,
      type: filters.type,
      genre: filters.genre,
      year: filters.year,
      lang: filters.lang,
      sort: filters.sort,
      page: String(filters.page),
    });
    return apiRequest<CataloguePage>(`/api/catalogue?${p.toString()}`);
  },
  genres: () => apiRequest<{ genres: string[] }>('/api/catalogue/genres'),
  suggestions: (type: string, genre: string) => {
    const p = new URLSearchParams({ type, genre });
    return apiRequest<{ upstreamStatus: 'live' | 'fallback'; spotlight: Item | null; items: Item[] }>(
      `/api/suggestions?${p.toString()}`
    );
  },
  details: (type: string, id: string) =>
    apiRequest<DetailResponse>(`/api/details/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),
  openPlayer: (payload: { item: Item; tmdb: string | null; season: number; episode: number }) =>
    apiRequest<{ url: string; member: boolean; season: number; episode: number }>(
      '/api/player/open',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  member: () => apiRequest<MemberPayload>('/api/member'),
  toggleFavorite: (item: Item) =>
    apiRequest<{ saved: boolean; favorites: Item[] }>('/api/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify({ item }),
    }),
  removeProgress: (type: string, id: string) =>
    apiRequest<{ ok: boolean }>(
      `/api/progress/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  clearHistory: () => apiRequest<{ ok: boolean }>('/api/history', { method: 'DELETE' }),
  updateProfile: (username: string, avatar?: string | null) =>
    apiRequest<{ profile: UserProfile }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ username, avatar }),
    }),
  updateEmail: (email: string) =>
    apiRequest<{ profile: UserProfile; message: string; requiresConfirmation?: boolean }>(
      '/api/profile/email',
      {
        method: 'PUT',
        body: JSON.stringify({ email }),
      }
    ),
  updateTheme: (theme: UserThemePreference | null) =>
    apiRequest<{ theme: UserThemePreference | null }>('/api/profile/theme', {
      method: 'PUT',
      body: JSON.stringify(theme),
    }),
  notifications: () =>
    apiRequest<{ notifications: NotificationRecord[]; unreadCount: number }>('/api/notifications'),
  markNotificationRead: (id: string) =>
    apiRequest<{ notifications: NotificationRecord[]; unreadCount: number }>(
      `/api/notifications/${encodeURIComponent(id)}/read`,
      { method: 'POST' }
    ),
  markAllNotificationsRead: () =>
    apiRequest<{ notifications: NotificationRecord[]; unreadCount: number }>(
      '/api/notifications/read-all',
      { method: 'POST' }
    ),
  clearNotifications: (readOnly = false) =>
    apiRequest<{ notifications: NotificationRecord[]; unreadCount: number }>(
      `/api/notifications${readOnly ? '?readOnly=1' : ''}`,
      { method: 'DELETE' }
    ),
  rateItem: (itemType: string, itemId: string, score: number) =>
    apiRequest<{ average: number; count: number; myScore: number }>('/api/ratings', {
      method: 'POST',
      body: JSON.stringify({ itemType, itemId, score }),
    }),
  comments: (type: string, id: string) =>
    apiRequest<{ comments: CommentRecord[] }>(
      `/api/comments/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
    ),
  addComment: (payload: {
    itemType: string;
    itemId: string;
    itemTitle?: string;
    body: string;
    parentId: string | null;
  }) =>
    apiRequest<{ comment: CommentRecord }>('/api/comments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteComment: (commentId: string) =>
    apiRequest<{ ok: boolean }>(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    }),
  searchMembers: (q: string) =>
    apiRequest<{ members: { id: string; username: string; avatar: string | null; isPro?: boolean }[] }>(
      `/api/members/search?q=${encodeURIComponent(q)}`
    ),
  addFriend: (friendId: string) =>
    apiRequest<{ ok: boolean }>('/api/friends', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    }),
  removeFriend: (friendId: string) =>
    apiRequest<{ ok: boolean }>(`/api/friends/${encodeURIComponent(friendId)}`, {
      method: 'DELETE',
    }),
  heartbeat: (page: string, item: Item | null) =>
    apiRequest<{ ok: boolean }>('/api/presence/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ page, item }),
    }),
  adminOverview: () => apiRequest<AdminOverview>('/api/admin/overview'),
  adminUserHistory: (userId: string) =>
    apiRequest<{ history: WatchEventRecord[] }>(
      `/api/admin/users/${encodeURIComponent(userId)}/history`
    ),
  adminSetUserRole: (userId: string, role: 'admin' | 'member') =>
    apiRequest<{ ok: boolean; role: 'admin' | 'member' }>(
      `/api/admin/users/${encodeURIComponent(userId)}/role`,
      {
        method: 'POST',
        body: JSON.stringify({ role }),
      }
    ),
  adminBanUser: (userId: string, banned: boolean, reason?: string) =>
    apiRequest<{ ok: boolean; banned: boolean; bannedAt: string | null; banReason: string | null }>(
      `/api/admin/users/${encodeURIComponent(userId)}/ban`,
      {
        method: 'POST',
        body: JSON.stringify({ banned, reason }),
      }
    ),
  adminRevokeUserPro: (userId: string) =>
    apiRequest<{ ok: boolean; subscription: UserSubscription }>(
      `/api/admin/users/${encodeURIComponent(userId)}/revoke-pro`,
      { method: 'POST' }
    ),
  adminDeleteUser: (userId: string) =>
    apiRequest<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  siteConfig: () => apiRequest<SiteConfig>('/api/site/config'),
  adminSettings: () =>
    apiRequest<{
      origin: string;
      embedProvider: string;
      players: PlayerTemplates;
      tmdbApiKey: string;
      smtp: AdminSmtpStatus;
      site: SiteConfig;
      supabaseServiceRoleConfigured?: boolean;
    }>('/api/admin/settings'),
  adminSaveSiteConfig: (payload: {
    siteName: string;
    faviconUrl?: string;
    faviconUploadDataUrl?: string | null;
  }) =>
    apiRequest<{ site: SiteConfig }>('/api/admin/settings/site', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  adminNotificationHistory: () =>
    apiRequest<{ broadcasts: AdminBroadcastRecord[] }>('/api/admin/notifications'),
  adminSendNotification: (payload: {
    target: AdminNotificationTarget;
    userIds?: string[];
    title: string;
    message: string;
    link?: string;
  }) =>
    apiRequest<{ ok: boolean; sentCount: number; broadcast: AdminBroadcastRecord }>(
      '/api/admin/notifications',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  adminSaveOrigin: (origin: string) =>
    apiRequest<{ origin: string }>('/api/admin/settings/origin', {
      method: 'PUT',
      body: JSON.stringify({ origin }),
    }),
  adminSaveEmbedProvider: (embedProvider: string) =>
    apiRequest<{ embedProvider: string }>('/api/admin/settings/embed-provider', {
      method: 'PUT',
      body: JSON.stringify({ embedProvider }),
    }),
  adminSaveSmtp: (payload: Partial<AdminSmtpSettings>) =>
    apiRequest<{ smtp: AdminSmtpStatus }>('/api/admin/settings/smtp', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  adminTestSmtp: (to: string) =>
    apiRequest<{ ok: boolean; message: string }>('/api/admin/settings/smtp/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
  adminEmailTemplates: () =>
    apiRequest<{ templates: EmailTemplateConfig[] }>('/api/admin/mail/templates'),
  adminSaveEmailTemplate: (
    key: EmailTemplateKey,
    patch: Partial<Pick<EmailTemplateConfig, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'enabled'>>
  ) =>
    apiRequest<{ template: EmailTemplateConfig }>(
      `/api/admin/mail/templates/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      }
    ),
  adminResetEmailTemplate: (key: EmailTemplateKey) =>
    apiRequest<{ template: EmailTemplateConfig }>(
      `/api/admin/mail/templates/${encodeURIComponent(key)}/reset`,
      { method: 'POST' }
    ),
  adminTestEmailTemplate: (key: EmailTemplateKey, to: string) =>
    apiRequest<{ ok: boolean; message: string }>(
      `/api/admin/mail/templates/${encodeURIComponent(key)}/test`,
      {
        method: 'POST',
        body: JSON.stringify({ to }),
      }
    ),
  adminMailLogs: (params?: { status?: string; q?: string }) => {
    const p = new URLSearchParams();
    if (params?.status) p.set('status', params.status);
    if (params?.q) p.set('q', params.q);
    const qs = p.toString();
    return apiRequest<{ logs: MailLogEntry[] }>(`/api/admin/mail/logs${qs ? `?${qs}` : ''}`);
  },
  adminClearMailLogs: () =>
    apiRequest<{ ok: boolean }>('/api/admin/mail/logs', { method: 'DELETE' }),
  adminSaveTmdbKey: (tmdbApiKey: string) =>
    apiRequest<{ tmdbApiKey: string }>('/api/admin/settings/tmdb', {
      method: 'PUT',
      body: JSON.stringify({ tmdbApiKey }),
    }),
  adminSavePlayers: (players: PlayerTemplates) =>
    apiRequest<{ players: PlayerTemplates }>('/api/admin/settings/players', {
      method: 'PUT',
      body: JSON.stringify(players),
    }),
  adminHealthCheck: (origin?: string) =>
    apiRequest<ApiHealthReport>('/api/admin/health-check', {
      method: 'POST',
      body: JSON.stringify({ origin }),
    }),
  adminAnalytics: (params: { period: AnalyticsPeriodKey; start?: string; end?: string }) => {
    const p = new URLSearchParams({ period: params.period });
    if (params.start) p.set('start', params.start);
    if (params.end) p.set('end', params.end);
    return apiRequest<AnalyticsDashboardPayload>(`/api/admin/analytics?${p.toString()}`);
  },
  adminAnalyticsRealtime: () => apiRequest<RealtimePayload>('/api/admin/analytics/realtime'),

  // Billing & Subscriptions
  billingPlans: () =>
    apiRequest<{ plans: SubscriptionPlan[]; config: BillingConfig }>('/api/billing/plans'),
  billingMe: () =>
    apiRequest<{ subscription: UserSubscription; orders: PaymentOrder[] }>('/api/billing/me'),
  checkoutCryptoGate: (planId: string) =>
    apiRequest<{ order: PaymentOrder }>('/api/billing/checkout/crypto-gate', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    }),
  checkoutManual: (payload: {
    planId: string;
    manualChannel: string;
    manualReference: string;
    note?: string;
  }) =>
    apiRequest<{ order: PaymentOrder }>('/api/billing/checkout/manual', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminBilling: () =>
    apiRequest<{
      plans: SubscriptionPlan[];
      config: BillingConfig;
      orders: PaymentOrder[];
      secrets: AdminPaymentSecretsStatus;
    }>('/api/admin/billing'),
  adminSavePaymentSecrets: (payload: {
    apiKey?: string;
    webhookSecret?: string;
    clearApiKey?: boolean;
    clearWebhookSecret?: boolean;
  }) =>
    apiRequest<{ secrets: AdminPaymentSecretsStatus; config: BillingConfig }>(
      '/api/admin/billing/secrets',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  adminSavePlan: (plan: {
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
    features: string[];
    players: { film: string; serie: string };
  }) =>
    apiRequest<{ plan: SubscriptionPlan }>('/api/admin/billing/plans', {
      method: 'POST',
      body: JSON.stringify(plan),
    }),
  adminDeletePlan: (planId: string) =>
    apiRequest<{ ok: boolean }>(`/api/admin/billing/plans/${encodeURIComponent(planId)}`, {
      method: 'DELETE',
    }),
  adminSaveBillingConfig: (config: Partial<BillingConfig>) =>
    apiRequest<{ config: BillingConfig }>('/api/admin/billing/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  adminReviewOrder: (orderId: string, action: 'approve' | 'reject') =>
    apiRequest<{ order: PaymentOrder; subscription: UserSubscription | null }>(
      `/api/admin/billing/orders/${encodeURIComponent(orderId)}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ action }),
      }
    ),
  adminAssignUserSubscription: (
    userId: string,
    payload: { planId: string; durationDays?: number; autoRenew?: boolean }
  ) =>
    apiRequest<{ subscription: UserSubscription }>(
      `/api/admin/users/${encodeURIComponent(userId)}/subscription`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
};

interface AuthContextValue {
  user: UserProfile | null;
  backend: 'supabase' | 'local';
  loading: boolean;
  isMember: boolean;
  isAdmin: boolean;
  isPro: boolean;
  watchingItem: Item | null;
  setWatchingItem: (item: Item | null) => void;
  setSession: (token: string, user: UserProfile) => void;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [backend, setBackend] = useState<'supabase' | 'local'>('local');
  const [loading, setLoading] = useState(true);
  const [watchingItem, setWatchingItem] = useState<Item | null>(null);
  const queryClient = useQueryClient();
  const location = useLocation();
  const watchingRef = useRef<Item | null>(null);
  watchingRef.current = watchingItem;

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.me();
      setUser(res.user);
      if (res.backend) setBackend(res.backend);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  // Clear watching state on route change
  useEffect(() => {
    setWatchingItem(null);
  }, [location.pathname]);

  // Heartbeat every 30s and on route/watching changes when signed in
  useEffect(() => {
    if (!user) return;
    void api.heartbeat(location.pathname, watchingItem).catch(() => {});
    const timer = window.setInterval(() => {
      void api.heartbeat(location.pathname, watchingRef.current).catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [user, location.pathname, watchingItem]);

  const setSession = useCallback(
    (token: string, nextUser: UserProfile) => {
      setStoredToken(token);
      setUser(nextUser);
      void queryClient.invalidateQueries();
    },
    [queryClient]
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network error on logout
    }
    setStoredToken(null);
    setUser(null);
    setWatchingItem(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      backend,
      loading,
      isMember: Boolean(user),
      isAdmin: user?.role === 'admin',
      isPro: Boolean(user?.isPro),
      watchingItem,
      setWatchingItem,
      setSession,
      refreshUser,
      signOut,
    }),
    [user, backend, loading, watchingItem, setSession, refreshUser, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
