import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ErrorLogLevel, ErrorLogRecord, ErrorLogSource } from '../shared/types';
import { api } from '../lib/client';

const SOURCE_LABELS: Record<ErrorLogSource, string> = {
  server: 'Serveur',
  client: 'Navigateur',
  api: 'API HTTP',
  upstream: 'Catalogue / TMDB',
  auth: 'Authentification',
  security: 'Sécurité / Anti-Bot',
  billing: 'Paiements',
  push: 'Push Web',
  mail: 'Emails',
};

function LevelBadge({ level }: { level: ErrorLogLevel }) {
  if (level === 'fatal') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-400">
        <AlertOctagon className="size-3" />
        Critique
      </span>
    );
  }
  if (level === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
        <AlertTriangle className="size-3" />
        Alerte
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-400">
      <AlertTriangle className="size-3" />
      Erreur
    </span>
  );
}

function formatDateTimeFr(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function AdminErrorsTab() {
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<string>('');
  const [source, setSource] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const logsQuery = useQuery({
    queryKey: ['admin-error-logs', level, source, search],
    queryFn: () =>
      api.adminErrorLogs({
        level: level || undefined,
        source: source || undefined,
        q: search.trim() || undefined,
      }),
    refetchInterval: 20_000,
  });

  const clearMutation = useMutation({
    mutationFn: () => api.adminClearErrorLogs(),
    onSuccess: (res) => {
      setConfirmClear(false);
      queryClient.invalidateQueries({ queryKey: ['admin-error-logs'] });
      toast.success(`${res.deleted} journal${res.deleted > 1 ? 'ux' : ''} supprimé${res.deleted > 1 ? 's' : ''}.`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Impossible de vider les journaux.');
    },
  });

  const counts = logsQuery.data?.counts ?? { total: 0, fatal: 0, error: 0, warn: 0 };
  const logs: ErrorLogRecord[] = logsQuery.data?.logs ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Total enregistré', value: counts.total },
          { label: 'Critiques', value: counts.fatal },
          { label: 'Erreurs', value: counts.error },
          { label: 'Alertes', value: counts.warn },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="mt-1.5 font-display text-2xl font-bold text-foreground tabular-nums">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">
              Journalisation des erreurs (Serveur & Navigateur)
            </h2>
            <p className="text-xs text-muted-foreground">
              Capture automatique des exceptions serveur, erreurs HTTP 5xx, échecs externes et erreurs JavaScript/React avec masquage des données sensibles.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => logsQuery.refetch()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent whitespace-nowrap"
            >
              <RefreshCw className={`size-3.5 ${logsQuery.isFetching ? 'animate-spin' : ''}`} />
              <span>Actualiser</span>
            </button>

            {confirmClear ? (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs">
                <span className="text-red-300">Tout vider ?</span>
                <button
                  type="button"
                  disabled={clearMutation.isPending}
                  onClick={() => clearMutation.mutate()}
                  className="rounded bg-red-600 px-2 py-0.5 font-semibold text-white hover:opacity-90"
                >
                  Confirmer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-1 text-muted-foreground hover:text-foreground"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={counts.total === 0}
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:border-red-500/40 hover:text-red-400 disabled:opacity-40 whitespace-nowrap"
              >
                <Trash2 className="size-3.5" />
                <span>Vider</span>
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par message, route ou pile…"
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          <select
            aria-label="Filtrer par niveau"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">Tous les niveaux</option>
            <option value="fatal">Critique</option>
            <option value="error">Erreur</option>
            <option value="warn">Alerte</option>
          </select>

          <select
            aria-label="Filtrer par source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">Toutes les sources</option>
            {(Object.keys(SOURCE_LABELS) as ErrorLogSource[]).map((key) => (
              <option key={key} value={key}>
                {SOURCE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        {/* Logs List */}
        {logsQuery.isLoading ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            Chargement des journaux…
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Aucune erreur enregistrée pour ces critères.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-background/50">
            {logs.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const hasDetails = Boolean(entry.stack || entry.context || entry.userAgent);
              return (
                <div key={entry.id} className="p-3.5 text-xs space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <LevelBadge level={entry.level} />
                      <span className="font-semibold text-foreground">
                        {SOURCE_LABELS[entry.source] || entry.source}
                      </span>
                      {entry.method && (
                        <span className="font-mono text-[11px] text-primary">{entry.method}</span>
                      )}
                      {entry.route && (
                        <span className="font-mono text-[11px] text-muted-foreground break-all">
                          {entry.route}
                        </span>
                      )}
                      {entry.statusCode !== null && (
                        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                          HTTP {entry.statusCode}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatDateTimeFr(entry.createdAt)}
                      </span>
                      {hasDetails && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent"
                        >
                          <span>Détails</span>
                          <ChevronDown
                            className={`size-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="font-medium text-foreground break-words">{entry.message}</p>

                  {isExpanded && hasDetails && (
                    <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-[11px]">
                      {entry.userId && (
                        <p className="text-muted-foreground">
                          Utilisateur : <span className="font-mono text-foreground">{entry.userId}</span>
                        </p>
                      )}
                      {entry.userAgent && (
                        <p className="text-muted-foreground break-all">
                          User-Agent : <span className="font-mono text-foreground">{entry.userAgent}</span>
                        </p>
                      )}
                      {entry.stack && (
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px] text-rose-300">
                          {entry.stack}
                        </pre>
                      )}
                      {entry.context && (
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px] text-muted-foreground">
                          {JSON.stringify(entry.context, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
