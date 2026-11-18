import React, { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SiteConfig } from '../shared/types';
import { api } from './client';

const DEFAULT_SITE_CONFIG: SiteConfig = {
  siteName: 'StreamWall',
  faviconUrl: '/favicon.ico',
};

const SiteConfigContext = createContext<SiteConfig>(DEFAULT_SITE_CONFIG);

function syncDocumentFavicon(faviconUrl: string): void {
  if (typeof document === 'undefined') return;
  const href = faviconUrl.trim() || '/favicon.ico';
  const rels = ['icon', 'shortcut icon'];
  for (const rel of rels) {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) {
      link.setAttribute('href', href);
    }
  }
}

export function SiteConfigProvider({ children }: { children: React.ReactNode }) {
  const siteQuery = useQuery({
    queryKey: ['site-config'],
    queryFn: () => api.siteConfig(),
    staleTime: 60_000,
  });

  const config = siteQuery.data ?? DEFAULT_SITE_CONFIG;

  useEffect(() => {
    syncDocumentFavicon(config.faviconUrl);
    const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.content = config.siteName;
    }
  }, [config.faviconUrl, config.siteName]);

  return (
    <SiteConfigContext.Provider value={config}>{children}</SiteConfigContext.Provider>
  );
}

export function useSiteConfig(): SiteConfig {
  return useContext(SiteConfigContext);
}

export function useDocumentTitle(pageTitle?: string | null): void {
  const { siteName } = useSiteConfig();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const cleanSite = (siteName || 'StreamWall').trim();
    const cleanPage = pageTitle?.trim();
    document.title = cleanPage ? `${cleanPage} — ${cleanSite}` : cleanSite;
  }, [pageTitle, siteName]);
}
