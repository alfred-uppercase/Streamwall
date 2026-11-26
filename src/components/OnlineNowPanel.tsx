import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Globe,
  MapPin,
  Monitor,
  RefreshCw,
  Search,
  Smartphone,
  Tablet,
  UserCheck,
  Users,
} from 'lucide-react';
import { api } from '../lib/client';
import type { DeviceKind, RealtimeVisitor } from '../shared/analyticsTypes';

interface OnlineNowPanelProps {
  id?: string;
  compact?: boolean;
  onNavigate?: () => void;
}

function deviceLabel(kind: DeviceKind): string {
  if (kind === 'mobile') return 'Mobile';
  if (kind === 'tablet') return 'Tablette';
  return 'Ordinateur';
}

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  if (kind === 'mobile') return <Smartphone className="size-3.5 text-muted-foreground shrink-0" />;
  if (kind === 'tablet') return <Tablet className="size-3.5 text-muted-foreground shrink-0" />;
  return <Monitor className="size-3.5 text-muted-foreground shrink-0" />;
}

function formatRelativeSeconds(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'À l’instant';
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 12) return 'À l’instant';
  if (diffSec < 60) return `il y a ${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  return `il y a ${min} min`;
}

function roleCaption(v: RealtimeVisitor): string {
  if (v.visitorType !== 'member') return 'Visiteur';
  const parts: string[] = [];
  if (v.userRole === 'admin') parts.push('Admin');
  else parts.push('Membre');
  if (v.isPro) parts.push('Pro');
  return parts.join(' · ');
}

export function OnlineNowPanel({ id, compact = false, onNavigate }: OnlineNowPanelProps) {
  const [typeFilter, setTypeFilter] = useState<'all' | 'member' | 'guest'>('all');
  const [search, setSearch] = useState('');

  const realtimeQuery = useQuery({
    queryKey: ['admin-realtime'],
    queryFn: () => api.adminRealtime(),
    refetchInterval: 15_000,
  });

  const data = realtimeQuery.data;
  const visitors = data?.visitors ?? [];

  const filteredVisitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visitors.filter((v) => {
      if (typeFilter === 'member' && v.visitorType !== 'member') return false;
      if (typeFilter === 'guest' && v.visitorType !== 'guest') return false;
      if (!q) return true;
      const haystack = [
        v.ip,
        v.city,
        v.region,
        v.countryName,
        v.username || '',
        v.currentPath,
        v.currentTitle,
        v.browser,
        v.os,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [visitors, typeFilter, search]);

  const activeCount = data?.activeCount ?? 0;
  const memberCount = data?.memberCount ?? 0;
  const guestCount = data?.guestCount ?? 0;

  return (
    <section
      id={id}
      className={compact ? 'space-y-4' : 'rounded-xl border border-border bg-card p-5 space-y-4'}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="font-display text-lg font-semibold text-foreground">
              En ligne maintenant
            </h3>
            <span className="font-display text-lg font-bold text-emerald-500 tabular-nums">
              {activeCount}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            <span className="font-medium text-foreground">{memberCount}</span> membre(s) connecté(s) ·{' '}
            <span className="font-medium text-foreground">{guestCount}</span> visiteur(s) invité(s) · Fenêtre active 5 min (en mémoire)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data?.checkedAt && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              MAJ {new Date(data.checkedAt).toLocaleTimeString('fr-FR')}
            </span>
          )}
          <button
            type="button"
            onClick={() => void realtimeQuery.refetch()}
            disabled={realtimeQuery.isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${realtimeQuery.isFetching ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1">
          {(
            [
              ['all', `Tous (${activeCount})`],
              ['member', `Membres (${memberCount})`],
              ['guest', `Visiteurs (${guestCount})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTypeFilter(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                typeFilter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer par IP, ville, pseudo ou page…"
            className="h-8 w-full rounded-lg border border-input bg-background pr-3 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Live Visitors & Members Table */}
      {realtimeQuery.isLoading && !data ? (
        <div className="rounded-lg border border-border bg-background p-8 text-center text-xs text-muted-foreground">
          Chargement des sessions actives…
        </div>
      ) : realtimeQuery.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
          Impossible de charger la liste en ligne pour le moment.
        </div>
      ) : filteredVisitors.length === 0 ? (
        <div className="rounded-lg border border-border bg-background p-8 text-center text-xs text-muted-foreground">
          {visitors.length === 0
            ? 'Aucun visiteur ni membre actif sur les 5 dernières minutes.'
            : 'Aucune session active ne correspond à ce filtre.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-card/60 text-muted-foreground">
              <tr>
                <th className="py-2.5 px-3 font-medium">Statut / Compte</th>
                <th className="py-2.5 px-3 font-medium">Adresse IP</th>
                <th className="py-2.5 px-3 font-medium">Ville & Pays</th>
                <th className="py-2.5 px-3 font-medium">Page consultée</th>
                <th className="py-2.5 px-3 font-medium">Appareil</th>
                <th className="py-2.5 px-3 text-right font-medium">Activité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {filteredVisitors.map((v) => {
                const isMember = v.visitorType === 'member';
                return (
                  <tr key={v.sessionId} className="hover:bg-accent/30 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-2 shrink-0 rounded-full ${
                            isMember ? 'bg-emerald-500' : 'bg-sky-500'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium text-foreground">
                            {isMember ? (
                              <UserCheck className="size-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <Users className="size-3.5 text-sky-500 shrink-0" />
                            )}
                            <span className="truncate">
                              {isMember ? v.username || 'Membre connecté' : 'Visiteur'}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{roleCaption(v)}</p>
                        </div>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 font-mono text-[11px] text-foreground whitespace-nowrap">
                      {v.ip || 'Inconnue'}
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 size-3.5 text-primary shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {v.city || v.countryName}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {v.countryName}
                            {v.geoSource && v.geoSource !== 'cdn' ? ' · ~fuseau' : ''}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 max-w-64">
                      {v.currentPath?.startsWith('/') ? (
                        <Link
                          to={v.currentPath}
                          onClick={onNavigate}
                          className="block truncate font-medium text-foreground hover:text-primary transition-colors"
                          title={v.currentTitle}
                        >
                          {v.currentTitle || v.currentPath}
                        </Link>
                      ) : (
                        <p className="truncate font-medium text-foreground">
                          {v.currentTitle || '/'}
                        </p>
                      )}
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {v.currentPath || '/'}
                      </p>
                    </td>

                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-foreground">
                        <DeviceIcon kind={v.deviceType} />
                        <span>{deviceLabel(v.deviceType)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {v.browser} · {v.os}
                      </p>
                    </td>

                    <td className="py-2.5 px-3 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                      {formatRelativeSeconds(v.lastActivityAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Precision / Geo transparency note */}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Globe className="size-3.5 shrink-0 text-primary" />
        <span>
          La ville exacte utilise les en-têtes GeoIP du proxy/CDN (Cloudflare, Vercel) s’ils sont actifs ; sinon elle est estimée via le fuseau horaire du navigateur (~fuseau).
        </span>
      </p>
    </section>
  );
}
