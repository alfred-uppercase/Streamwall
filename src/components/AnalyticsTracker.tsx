import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getStoredToken, useAuth } from '../lib/client';
import { useSiteConfig } from '../lib/siteConfig';

const VISITOR_STORAGE_KEY = 'tapenaka_vid';
const SESSION_STORAGE_KEY = 'tapenaka_sid';
const SESSION_LAST_ACTIVE_KEY = 'tapenaka_sid_ts';
const SESSION_IDLE_MS = 30 * 60_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

function getOrCreateVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing) return existing;
    const next = randomId('v');
    localStorage.setItem(VISITOR_STORAGE_KEY, next);
    return next;
  } catch {
    return randomId('v');
  }
}

function getOrCreateSessionId(): string {
  const now = Date.now();
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    const lastTs = Number(sessionStorage.getItem(SESSION_LAST_ACTIVE_KEY) || '0');
    if (existing && now - lastTs <= SESSION_IDLE_MS) {
      sessionStorage.setItem(SESSION_LAST_ACTIVE_KEY, String(now));
      return existing;
    }
    const next = randomId('s');
    sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    sessionStorage.setItem(SESSION_LAST_ACTIVE_KEY, String(now));
    return next;
  } catch {
    return randomId('s');
  }
}

function resolveRouteTitle(pathname: string, siteName: string): string {
  if (document.title && document.title !== 'Tapenaka — StreamWall') {
    return document.title;
  }
  if (pathname === '/') return `Accueil — ${siteName}`;
  if (pathname.startsWith('/catalogue')) return `Catalogue — ${siteName}`;
  if (pathname.startsWith('/suggestion')) return `Suggestion — ${siteName}`;
  if (pathname.startsWith('/abonnement')) return `Devenir Pro — ${siteName}`;
  if (pathname.startsWith('/favoris')) return `Ma liste — ${siteName}`;
  if (pathname.startsWith('/profil')) return `Mon profil — ${siteName}`;
  if (pathname.startsWith('/admin')) return `Administration — ${siteName}`;
  if (pathname.startsWith('/auth')) return `Connexion — ${siteName}`;
  if (pathname.startsWith('/reset-password')) return `Réinitialisation — ${siteName}`;

  const heading = document.querySelector('main h1')?.textContent?.trim();
  if (heading && heading.length > 1 && heading !== 'Chargement…') {
    return `${heading.slice(0, 90)} — ${siteName}`;
  }
  return document.title || siteName;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function getTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function AnalyticsTracker() {
  const location = useLocation();
  const { user } = useAuth();
  const { siteName } = useSiteConfig();
  const lastCollectedKeyRef = useRef<string>('');
  const lastBeatAtRef = useRef<number>(0);

  // Page-view analytics collector on route changes
  useEffect(() => {
    const visitorId = getOrCreateVisitorId();
    const sessionId = getOrCreateSessionId();
    const cleanPath = location.pathname || '/';
    const collectKey = `${sessionId}:${cleanPath}`;
    if (lastCollectedKeyRef.current === collectKey) return;

    const sendCollect = () => {
      lastCollectedKeyRef.current = collectKey;
      lastBeatAtRef.current = Date.now();
      const title = resolveRouteTitle(cleanPath, siteName);
      const screenResolution =
        typeof window !== 'undefined' && window.screen
          ? `${window.screen.width}×${window.screen.height}`
          : undefined;

      void fetch('/api/analytics/collect', {
        method: 'POST',
        headers: buildHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          visitorId,
          sessionId,
          path: cleanPath,
          title,
          screenResolution,
          timezone: getTimezone(),
        }),
        keepalive: true,
      }).catch(() => {});
    };

    const isDetailRoute = /^\/(film|serie|anime|pinoy)\//.test(cleanPath);
    const delayTimer = window.setTimeout(sendCollect, isDetailRoute ? 350 : 60);

    return () => {
      window.clearTimeout(delayTimer);
    };
  }, [location.pathname, siteName]);

  // Lightweight in-memory live presence heartbeat (only while tab is visible, zero DB writes on server)
  useEffect(() => {
    const sendHeartbeat = (force = false) => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      const now = Date.now();
      if (!force && now - lastBeatAtRef.current < 25_000) {
        return;
      }
      lastBeatAtRef.current = now;
      const sessionId = getOrCreateSessionId();
      const cleanPath = location.pathname || '/';
      const title = resolveRouteTitle(cleanPath, siteName);

      void fetch('/api/presence/heartbeat', {
        method: 'POST',
        headers: buildHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          sessionId,
          path: cleanPath,
          title,
          timezone: getTimezone(),
        }),
        keepalive: true,
      }).catch(() => {});
    };

    // Sync member/guest identity whenever auth user changes
    const syncTimer = window.setTimeout(() => sendHeartbeat(true), 250);
    const interval = window.setInterval(() => sendHeartbeat(false), HEARTBEAT_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearTimeout(syncTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [location.pathname, siteName, user?.id]);

  return null;
}
