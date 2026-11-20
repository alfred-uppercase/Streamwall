import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  CreditCard,
  Database,
  Eye,
  EyeOff,
  FileText,
  Globe,
  KeyRound,
  Lock,
  MessageSquare,
  MonitorSmartphone,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { PrivacyIconKey, PrivacyPageConfig } from '../shared/types';
import { api } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';

export function PrivacyIcon({
  icon,
  className = 'size-5',
}: {
  icon: PrivacyIconKey;
  className?: string;
}) {
  switch (icon) {
    case 'lock':
      return <Lock className={className} />;
    case 'key':
      return <KeyRound className={className} />;
    case 'shield':
      return <Shield className={className} />;
    case 'users':
      return <Users className={className} />;
    case 'message':
      return <MessageSquare className={className} />;
    case 'eye':
      return <Eye className={className} />;
    case 'devices':
      return <MonitorSmartphone className={className} />;
    case 'database':
      return <Database className={className} />;
    case 'card':
      return <CreditCard className={className} />;
    case 'alert':
      return <ShieldAlert className={className} />;
    case 'eye-off':
      return <EyeOff className={className} />;
    case 'shield-check':
      return <ShieldCheck className={className} />;
    case 'globe':
      return <Globe className={className} />;
    case 'file-text':
      return <FileText className={className} />;
    default:
      return <Shield className={className} />;
  }
}

export function PrivacyPage() {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const privacyQuery = useQuery({
    queryKey: ['privacy-page'],
    queryFn: () => api.privacy(),
    staleTime: 60_000,
  });

  const config: PrivacyPageConfig | undefined = privacyQuery.data?.privacy;
  useDocumentTitle(config?.title || 'Confidentialité & Sécurité');

  function toggleDetails(key: string) {
    setExpandedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      {privacyQuery.isLoading && !config ? (
        <div className="space-y-12">
          <div className="space-y-3">
            <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
          </div>
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="space-y-5">
              <div className="h-6 w-64 animate-pulse rounded bg-muted" />
              <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
                {Array.from({ length: 3 }).map((__, col) => (
                  <div key={col} className="space-y-2.5">
                    <div className="h-5 w-44 animate-pulse rounded bg-muted" />
                    <div className="h-20 w-full animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-12 sm:space-y-14">
          <header className="max-w-3xl border-b border-border/70 pb-6">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {config?.title || 'Confidentialité & Sécurité'}
            </h1>
            {config?.subtitle && (
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {config.subtitle}
              </p>
            )}
          </header>

          {(config?.sections ?? []).map((section) => (
            <section key={section.id} className="space-y-6">
              <h2 className="font-display text-xl font-bold tracking-tight text-primary sm:text-2xl">
                {section.title}
              </h2>

              <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-3">
                {section.items.map((item) => {
                  const key = `${section.id}:${item.id}`;
                  const isOpen = Boolean(expandedItems[key]);
                  const hasTech = Boolean(item.technicalDetails && item.technicalDetails.trim());
                  return (
                    <article key={key} className="flex items-start gap-3.5">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-primary"
                      >
                        <PrivacyIcon icon={item.icon} className="size-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold leading-snug text-foreground sm:text-[15px]">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
                          {item.description}
                        </p>

                        {hasTech && (
                          <div className="mt-3">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => toggleDetails(key)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-foreground transition-colors hover:text-primary"
                            >
                              <span>Détails techniques</span>
                              <ChevronDown
                                className={`size-3.5 transition-transform duration-150 ${
                                  isOpen ? 'rotate-180 text-primary' : 'text-muted-foreground'
                                }`}
                              />
                            </button>

                            {isOpen && (
                              <p className="mt-2 border-t border-border/70 pt-2 text-xs leading-relaxed text-muted-foreground">
                                {item.technicalDetails}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
