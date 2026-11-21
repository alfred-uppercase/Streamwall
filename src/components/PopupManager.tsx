import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, X } from 'lucide-react';
import type { PopupConfig } from '../shared/types';
import { api, useAuth } from '../lib/client';

export const POPUP_STORAGE_KEY = 'tapenaka_popup_seen_v1';
export const POPUP_SESSION_KEY = 'tapenaka_popup_session_v1';
const POPUP_PAGEVIEWS_KEY = 'tapenaka_popup_pageviews_v1';

interface SeenHistoryMap {
  [popupId: string]: number; // last shown epoch ms
}

function readSeenMap(): SeenHistoryMap {
  try {
    const raw = localStorage.getItem(POPUP_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' ? (parsed as SeenHistoryMap) : {};
  } catch {
    return {};
  }
}

function markSeenPopup(popupId: string): void {
  try {
    const map = readSeenMap();
    map[popupId] = Date.now();
    localStorage.setItem(POPUP_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage error
  }
  try {
    const raw = sessionStorage.getItem(POPUP_SESSION_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(popupId)) {
      list.push(popupId);
      sessionStorage.setItem(POPUP_SESSION_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignore storage error
  }
}

function isWithinFrequencyCooldown(popup: PopupConfig): boolean {
  if (popup.frequency === 'once_per_session') {
    try {
      const raw = sessionStorage.getItem(POPUP_SESSION_KEY);
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      return list.includes(popup.id);
    } catch {
      return false;
    }
  }

  const map = readSeenMap();
  const lastMs = map[popup.id];
  if (!lastMs || !Number.isFinite(lastMs)) return false;

  if (popup.frequency === 'once_ever') return true;

  const days =
    popup.frequency === 'once_per_day'
      ? 1
      : popup.frequency === 'custom_days'
        ? Math.max(1, popup.customIntervalDays || 7)
        : 7; // default once_per_week = 7 jours
  return Date.now() - lastMs < days * 86_400_000;
}

function incrementSessionPageViews(): number {
  try {
    const current = Number(sessionStorage.getItem(POPUP_PAGEVIEWS_KEY) || '0') || 0;
    const next = current + 1;
    sessionStorage.setItem(POPUP_PAGEVIEWS_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

function matchesPageRules(popup: PopupConfig, pathname: string): boolean {
  const excludes = popup.excludePaths
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const ex of excludes) {
    if (pathname.startsWith(ex)) return false;
  }

  switch (popup.pageScope) {
    case 'home':
      return pathname === '/';
    case 'catalogue':
      return pathname.startsWith('/catalogue') || pathname.startsWith('/suggestion');
    case 'detail':
      return /^\/(film|serie|anime)\//.test(pathname);
    case 'pricing':
      return pathname.startsWith('/abonnement');
    case 'custom': {
      const allowed = popup.customPaths
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (allowed.length === 0) return false;
      return allowed.some((prefix) =>
        prefix === '/' ? pathname === '/' : pathname.startsWith(prefix)
      );
    }
    case 'all':
    default:
      return !pathname.startsWith('/admin');
  }
}

function matchesAudience(
  popup: PopupConfig,
  isMember: boolean,
  isPro: boolean
): boolean {
  switch (popup.audience) {
    case 'guests':
      return !isMember;
    case 'free':
      return isMember && !isPro;
    case 'guests_and_free':
      return !isPro;
    case 'pro':
      return isMember && isPro;
    case 'all':
    default:
      return true;
  }
}

function matchesDevice(popup: PopupConfig): boolean {
  if (popup.deviceTarget === 'all') return true;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return popup.deviceTarget === 'mobile' ? isMobile : !isMobile;
}

export function PopupManager() {
  const { isMember, isPro, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [activePopup, setActivePopup] = useState<PopupConfig | null>(null);
  const [pageViewsCount, setPageViewsCount] = useState<number>(1);
  const activePopupRef = useRef<PopupConfig | null>(null);
  activePopupRef.current = activePopup;

  const popupsQuery = useQuery({
    queryKey: ['active-popups'],
    queryFn: () => api.activePopups(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  useEffect(() => {
    setPageViewsCount(incrementSessionPageViews());
    setActivePopup(null);
  }, [location.pathname]);

  const candidates = useMemo(() => {
    const all = popupsQuery.data?.popups ?? [];
    if (loading) return [];
    const nowMs = Date.now();
    return all.filter((p) => {
      if (!p.enabled) return false;
      if (p.startAt && nowMs < new Date(p.startAt).getTime()) return false;
      if (p.endAt && nowMs > new Date(p.endAt).getTime()) return false;
      if (!matchesPageRules(p, location.pathname)) return false;
      if (!matchesAudience(p, isMember, isPro)) return false;
      if (!matchesDevice(p)) return false;
      if (isWithinFrequencyCooldown(p)) return false;
      return true;
    });
  }, [popupsQuery.data?.popups, loading, location.pathname, isMember, isPro]);

  const triggerDisplay = useCallback((popup: PopupConfig) => {
    if (activePopupRef.current) return;
    if (isWithinFrequencyCooldown(popup)) return;
    markSeenPopup(popup.id);
    setActivePopup(popup);
    void api.trackPopupEvent(popup.id, 'impression').catch(() => {});
  }, []);

  // Auto-close timer
  useEffect(() => {
    if (!activePopup || !activePopup.autoCloseSeconds || activePopup.autoCloseSeconds <= 0) {
      return;
    }
    const t = window.setTimeout(() => {
      setActivePopup(null);
    }, activePopup.autoCloseSeconds * 1000);
    return () => window.clearTimeout(t);
  }, [activePopup]);

  // Escape key closes open popup
  useEffect(() => {
    if (!activePopup) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setActivePopup(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePopup]);

  // Trigger listeners for eligible popups
  useEffect(() => {
    if (activePopup || candidates.length === 0) return;

    const timers: number[] = [];
    const cleanups: (() => void)[] = [];

    // Immediate & page-views triggers (evaluated in priority order)
    for (const p of candidates) {
      if (p.triggerType === 'immediate') {
        const t = window.setTimeout(() => triggerDisplay(p), 250);
        timers.push(t);
        break;
      }
      if (p.triggerType === 'after_page_views' && pageViewsCount >= p.minPageViews) {
        const t = window.setTimeout(() => triggerDisplay(p), 400);
        timers.push(t);
        break;
      }
    }

    // Delayed triggers
    for (const p of candidates) {
      if (p.triggerType === 'after_delay') {
        const ms = Math.max(0, p.delaySeconds) * 1000;
        const t = window.setTimeout(() => triggerDisplay(p), ms);
        timers.push(t);
      }
    }

    // Scroll triggers
    const scrollCandidates = candidates.filter((p) => p.triggerType === 'on_scroll');
    if (scrollCandidates.length > 0) {
      const onScroll = () => {
        const doc = document.documentElement;
        const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
        const pct = (window.scrollY / maxScroll) * 100;
        for (const p of scrollCandidates) {
          if (pct >= p.scrollPercent) {
            triggerDisplay(p);
            break;
          }
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      cleanups.push(() => window.removeEventListener('scroll', onScroll));
    }

    // Exit-intent triggers
    const exitCandidates = candidates.filter((p) => p.triggerType === 'on_exit_intent');
    if (exitCandidates.length > 0) {
      const onMouseLeave = (e: MouseEvent) => {
        if (e.clientY <= 4) {
          triggerDisplay(exitCandidates[0]);
        }
      };
      document.addEventListener('mouseleave', onMouseLeave);
      cleanups.push(() => document.removeEventListener('mouseleave', onMouseLeave));
    }

    // Player open triggers
    const playerCandidates = candidates.filter((p) => p.triggerType === 'on_player_open');
    if (playerCandidates.length > 0) {
      const onPlayerOpen = () => {
        const p = playerCandidates[0];
        const ms = Math.max(0, p.delaySeconds) * 1000;
        if (ms <= 0) {
          triggerDisplay(p);
        } else {
          const t = window.setTimeout(() => triggerDisplay(p), ms);
          timers.push(t);
        }
      };
      window.addEventListener('tapenaka:player-opened', onPlayerOpen);
      cleanups.push(() => window.removeEventListener('tapenaka:player-opened', onPlayerOpen));
    }

    return () => {
      for (const t of timers) window.clearTimeout(t);
      for (const fn of cleanups) fn();
    };
  }, [activePopup, candidates, pageViewsCount, triggerDisplay]);

  if (!activePopup) return null;

  const sanitizeClientUrl = (raw: string): string | null => {
    const val = String(raw ?? '').trim();
    if (!val) return null;
    if (/^\/(?!\/)/.test(val)) return val;
    if (/^https?:\/\//i.test(val)) return val;
    return null;
  };

  const handleLinkNavigation = (url: string, newTab: boolean) => {
    void api.trackPopupEvent(activePopup.id, 'click').catch(() => {});
    setActivePopup(null);
    const safeUrl = sanitizeClientUrl(url);
    if (!safeUrl) return;
    if (newTab || /^https?:\/\//i.test(safeUrl)) {
      window.open(safeUrl, newTab ? '_blank' : '_self', 'noopener,noreferrer');
    } else {
      navigate(safeUrl);
    }
  };

  const safeImageLink = sanitizeClientUrl(activePopup.imageLink);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={activePopup.mode === 'image' ? activePopup.imageAlt || activePopup.name : activePopup.title || activePopup.name}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={() => {
        if (activePopup.closeOnBackdrop) setActivePopup(null);
      }}
    >
      {activePopup.mode === 'image' ? (
        /* Image mode: strictly borderless, no background/padding/card/text — ONLY photo + optional link */
        <div
          className="relative inline-block max-w-[92vw] max-h-[85vh] bg-transparent border-0 p-0 shadow-none"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setActivePopup(null)}
            className="absolute -top-3 -right-3 z-10 grid size-8 place-items-center rounded-full bg-black/80 text-white transition-colors hover:bg-black"
          >
            <X className="size-4" />
          </button>

          {safeImageLink ? (
            <a
              href={safeImageLink}
              target={activePopup.imageNewTab ? '_blank' : undefined}
              rel={activePopup.imageNewTab ? 'noopener noreferrer' : undefined}
              onClick={(e) => {
                e.preventDefault();
                handleLinkNavigation(safeImageLink, activePopup.imageNewTab);
              }}
              className="block border-0 p-0"
            >
              <img
                src={activePopup.imageUrl}
                alt={activePopup.imageAlt || activePopup.name}
                referrerPolicy="no-referrer"
                className="block max-h-[85vh] max-w-[92vw] object-contain border-0"
              />
            </a>
          ) : (
            <img
              src={activePopup.imageUrl}
              alt={activePopup.imageAlt || activePopup.name}
              referrerPolicy="no-referrer"
              className="block max-h-[85vh] max-w-[92vw] object-contain border-0"
            />
          )}
        </div>
      ) : (
        /* Text + Button mode */
        <div
          className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setActivePopup(null)}
            className="absolute top-3.5 right-3.5 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>

          {activePopup.title && (
            <h3 className="pr-8 font-display text-xl font-bold text-foreground">
              {activePopup.title}
            </h3>
          )}

          {activePopup.bodyText && (
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
              {activePopup.bodyText}
            </p>
          )}

          {activePopup.buttonLabel && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() =>
                  handleLinkNavigation(activePopup.buttonUrl || '/', activePopup.buttonNewTab)
                }
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <span>{activePopup.buttonLabel}</span>
                {activePopup.buttonNewTab && <ExternalLink className="size-3.5" />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
