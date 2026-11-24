import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Film,
  Flag,
  Sparkles,
  ThumbsUp,
  Trash2,
  Tv,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  BrokenReportRecord,
  BrokenReportStatus,
  ContentRequestRecord,
  ContentRequestStatus,
} from '../shared/types';
import { getContentDetailPath, getContentTypeLabel, TYPE_LABELS } from '../shared/types';
import { api } from '../lib/client';

function ReportRow({
  report,
  onSave,
  onDelete,
  saving,
}: {
  report: BrokenReportRecord;
  onSave: (status: BrokenReportStatus, adminNote: string) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [status, setStatus] = useState<BrokenReportStatus>(report.status);
  const [adminNote, setAdminNote] = useState(report.adminNote);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={getContentDetailPath(report.itemType, report.itemId)}
              className="inline-flex items-center gap-1.5 font-display text-base font-semibold text-foreground hover:text-primary"
            >
              <span>{report.itemTitle}</span>
              <ExternalLink className="size-3.5 text-primary" />
            </Link>
            <span className="text-xs font-medium text-primary">
              {getContentTypeLabel(report.itemType)}
              {report.season && report.episode
                ? ` · S${report.season}·É${report.episode}`
                : ''}
            </span>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Motif : <strong className="text-foreground">{report.reason}</strong> · Signalé par{' '}
            <span className="text-foreground font-medium">{report.username}</span> le{' '}
            {new Date(report.createdAt).toLocaleString('fr-FR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </p>
          {report.comment && (
            <p className="rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-foreground/90">
              {report.comment}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onDelete}
          aria-label="Supprimer ce signalement"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          <span>Supprimer</span>
        </button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-[180px_1fr_auto] items-center pt-1">
        <select
          aria-label="Statut du signalement"
          value={status}
          onChange={(e) => setStatus(e.target.value as BrokenReportStatus)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
        >
          <option value="pending">En attente</option>
          <option value="resolved">Corrigé / Résolu</option>
          <option value="rejected">Rejeté / Faux positif</option>
        </select>

        <input
          type="text"
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          placeholder="Note de résolution (envoyée au membre si résolu)…"
          maxLength={300}
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
        />

        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(status, adminNote)}
          className="h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          Mettre à jour
        </button>
      </div>
    </div>
  );
}

function RequestRow({
  request,
  onSave,
  onDelete,
  saving,
}: {
  request: ContentRequestRecord;
  onSave: (status: ContentRequestStatus, adminNote: string, resolvedItemUrl: string) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [status, setStatus] = useState<ContentRequestStatus>(request.status);
  const [adminNote, setAdminNote] = useState(request.adminNote);
  const [resolvedUrl, setResolvedUrl] = useState(request.resolvedItemUrl || '');

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="h-18 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
            {request.tmdbPosterUrl ? (
              <img
                src={request.tmdbPosterUrl}
                alt={request.title}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-muted-foreground">
                {request.mediaType === 'film' ? (
                  <Film className="size-5" />
                ) : (
                  <Tv className="size-5" />
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-semibold text-foreground">
                {request.title}
              </h3>
              <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
                <ThumbsUp className="size-3" />
                <span>{request.votes}</span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {TYPE_LABELS[request.mediaType]}
              {request.year ? ` · ${request.year}` : ''}
              {request.tmdbId ? ` · TMDB #${request.tmdbId}` : ' · Saisie manuelle'} · Par{' '}
              <span className="text-foreground font-medium">{request.username}</span> ·{' '}
              {new Date(request.createdAt).toLocaleString('fr-FR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </p>
            {request.note && (
              <p className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs text-foreground/90">
                {request.note}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onDelete}
          aria-label="Supprimer cette demande"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          <span>Supprimer</span>
        </button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-[170px_1fr_1fr_auto] items-center pt-1">
        <select
          aria-label="Statut de la demande"
          value={status}
          onChange={(e) => setStatus(e.target.value as ContentRequestStatus)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
        >
          <option value="pending">En attente</option>
          <option value="in_progress">En cours d’ajout</option>
          <option value="added">Ajouté au catalogue</option>
          <option value="rejected">Non disponible</option>
        </select>

        <input
          type="text"
          value={resolvedUrl}
          onChange={(e) => setResolvedUrl(e.target.value)}
          placeholder="Lien fiche ajoutée (ex: /film/24417)"
          maxLength={200}
          className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
        />

        <input
          type="text"
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          placeholder="Message pour le demandeur…"
          maxLength={300}
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
        />

        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(status, adminNote, resolvedUrl)}
          className="h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
}

export function AdminRequestsTab() {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<'reports' | 'requests'>('reports');

  const query = useQuery({
    queryKey: ['admin-requests'],
    queryFn: () => api.adminRequests(),
  });

  const updateReportMutation = useMutation({
    mutationFn: ({
      id,
      status,
      adminNote,
    }: {
      id: string;
      status: BrokenReportStatus;
      adminNote: string;
    }) => api.adminUpdateReport(id, { status, adminNote }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-requests'] });
      toast.success('Signalement mis à jour');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Erreur'),
  });

  const deleteReportMutation = useMutation({
    mutationFn: (id: string) => api.adminDeleteReport(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-requests'] });
      toast.success('Signalement supprimé');
    },
  });

  const updateRequestMutation = useMutation({
    mutationFn: ({
      id,
      status,
      adminNote,
      resolvedItemUrl,
    }: {
      id: string;
      status: ContentRequestStatus;
      adminNote: string;
      resolvedItemUrl: string;
    }) =>
      api.adminUpdateRequest(id, {
        status,
        adminNote,
        resolvedItemUrl: resolvedItemUrl.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['content-requests'] });
      toast.success('Demande mise à jour');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Erreur'),
  });

  const deleteRequestMutation = useMutation({
    mutationFn: (id: string) => api.adminDeleteRequest(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['content-requests'] });
      toast.success('Demande supprimée');
    },
  });

  const reports = query.data?.brokenReports ?? [];
  const requests = query.data?.contentRequests ?? [];
  const counts = query.data?.counts ?? { pendingReports: 0, pendingRequests: 0, totalPending: 0 };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Flag className="size-4 text-amber-400" />
            <span>Signalements en attente</span>
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold text-foreground tabular-nums">
            {counts.pendingReports}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-4 text-primary" />
            <span>Demandes en attente</span>
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold text-foreground tabular-nums">
            {counts.pendingRequests}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <span>Signalements traités</span>
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold text-foreground tabular-nums">
            {reports.filter((r) => r.status === 'resolved').length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-4 text-emerald-400" />
            <span>Titres ajoutés</span>
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold text-foreground tabular-nums">
            {requests.filter((r) => r.status === 'added').length}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setSubTab('reports')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            subTab === 'reports'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <Flag className="size-4" />
          <span>Signalements lecteurs ({reports.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('requests')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            subTab === 'requests'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="size-4" />
          <span>Demandes de titres ({requests.length})</span>
        </button>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : subTab === 'reports' ? (
        reports.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Aucun signalement de lecteur reçu pour le moment.
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                saving={updateReportMutation.isPending}
                onSave={(status, adminNote) =>
                  updateReportMutation.mutate({ id: report.id, status, adminNote })
                }
                onDelete={() => deleteReportMutation.mutate(report.id)}
              />
            ))}
          </div>
        )
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Aucune demande de titre manquant pour le moment.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <RequestRow
              key={req.id}
              request={req}
              saving={updateRequestMutation.isPending}
              onSave={(status, adminNote, resolvedItemUrl) =>
                updateRequestMutation.mutate({
                  id: req.id,
                  status,
                  adminNote,
                  resolvedItemUrl,
                })
              }
              onDelete={() => deleteRequestMutation.mutate(req.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
