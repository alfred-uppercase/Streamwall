import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSiteConfig } from '../lib/siteConfig';

const VISITOR_STORAGE_KEY = 'tapenaka_vid';
const SESSION_STORAGE_KEY = 'tapenaka_sid';
const SESSION_LAST_ACTIVE_KEY = 'tapenaka_sid_ts';
const SESSION_IDLE_MS = 30 * 60_000;

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

export function AnalyticsTracker() {
  const location = useLocation();
  const { siteName } = useSiteConfig();
  const lastCollectedKeyRef = useRef<string>('');

  useEffect(() => {
    const visitorId = getOrCreateVisitorId();
    const sessionId = getOrCreateSessionId();
    const cleanPath = location.pathname || '/';
    const collectKey = `${sessionId}:${cleanPath}`;
    if (lastCollectedKeyRef.current === collectKey) return;

    const sendCollect = () => {
      lastCollectedKeyRef.current = collectKey;
      const title = resolveRouteTitle(cleanPath, siteName);
      const screenResolution =
        typeof window !== 'undefined' && window.screen
          ? `${window.screen.width}×${window.screen.height}`
          : undefined;
      let timezone: string | undefined;
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        timezone = undefined;
      }

      void fetch('/api/analytics/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId,
          sessionId,
          path: cleanPath,
          title,
          screenResolution,
          timezone,
        }),
        keepalive: true,
      }).catch(() => {});
    };

    // Wait briefly on content detail routes so the item heading is rendered
    const isDetailRoute = /^\/(film|serie|anime)\//.test(cleanPath);
    const delayTimer = window.setTimeout(sendCollect, isDetailRoute ? 350 : 60);

    return () => {
      window.clearTimeout(delayTimer);
    };
  }, [location.pathname, siteName]);

  return null;
}
