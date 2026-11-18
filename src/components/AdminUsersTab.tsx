import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crown,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  UserX,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { TYPE_LABELS } from '../shared/types';
import type {
  AdminOverview,
  AdminUserSummary,
  Item,
  SubscriptionPlan,
  UserProfile,
} from '../shared/types';
import { api } from '../lib/client';
import { ProCrownBadge, UserAvatar } from './UserAvatar';

type SortKey = 'default' | 'username' | 'online' | 'isPro' | 'plays' | 'createdAt';
type SortDir = 'asc' | 'desc';

function ItemRow({ item, extra }: { item: Item; extra?: string }) {
  return (
    <Link
      to={`/${item.item_type}/${item.id}`}
      className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent"
    >
      {item.poster && (
        <img
          src={item.poster}
          alt=""
          referrerPolicy="no-referrer"
          className="h-12 w-8 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.titre}</p>
        <p className="text-xs text-muted-foreground">
          {TYPE_LABELS[item.item_type] ?? item.item_type}
          {item.annee ? ` · ${item.annee}` : ''}
        </p>
      </div>
      {extra && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{extra}</span>}
    </Link>
  );
}

function buildPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
}

export function AdminUsersTab({
  data,
  isError,
  error,
  availablePlans,
  currentUser,
  onRefreshUser,
  onNotifyUser,
}: {
  data: AdminOverview | undefined;
  isError: boolean;
  error: unknown;
  availablePlans: SubscriptionPlan[];
  currentUser: UserProfile | null;
  onRefreshUser: () => Promise<void>;
  onNotifyUser: (userId: string) => void;
}) {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'pro' | 'free'>('all');
  const [presenceFilter, setPresenceFilter] = useState<'all' | 'online' | 'offline' | 'banned'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'member'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [assignPlanId, setAssignPlanId] = useState('pro');
  const [assignDays, setAssignDays] = useState('30');
  const [banModalUser, setBanModalUser] = useState<AdminUserSummary | null>(null);
  const [banReasonInput, setBanReasonInput] = useState('');
  const [deleteModalUser, setDeleteModalUser] = useState<AdminUserSummary | null>(null);

  const users = useMemo(() => data?.users ?? [], [data?.users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users.filter((u) => {
      if (q) {
        const match =
          u.username.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.id.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (tierFilter === 'pro' && !u.isPro) return false;
      if (tierFilter === 'free' && u.isPro) return false;
      if (presenceFilter === 'online' && !u.online) return false;
      if (presenceFilter === 'offline' && u.online) return false;
      if (presenceFilter === 'banned' && !u.banned) return false;
      if (roleFilter === 'admin' && !u.isAdmin) return false;
      if (roleFilter === 'member' && u.isAdmin) return false;
      return true;
    });

    if (sortKey === 'default') return list;

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'username':
          return a.username.localeCompare(b.username, 'fr') * dir;
        case 'online':
          return (Number(a.online) - Number(b.online)) * dir;
        case 'isPro':
          return (Number(Boolean(a.isPro)) - Number(Boolean(b.isPro))) * dir;
        case 'plays':
          return (a.plays - b.plays) * dir;
        case 'createdAt':
          return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
        default:
          return 0;
      }
    });
  }, [users, search, tierFilter, presenceFilter, roleFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [search, tierFilter, presenceFilter, roleFilter, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedUsers = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, safePage, pageSize]);

  useEffect(() => {
    if (!selectedUserId && users.length > 0) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUserId]);

  const selectedUser: AdminUserSummary | null =
    users.find((u) => u.id === selectedUserId) ?? null;

  const historyQuery = useQuery({
    queryKey: ['admin-history', selectedUserId],
    queryFn: () => api.adminUserHistory(selectedUserId!),
    enabled: Boolean(selectedUserId),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' }) =>
      api.adminSetUserRole(userId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      toast.success('Rôle utilisateur mis à jour');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action refusée'),
  });

  const assignSubMutation = useMutation({
    mutationFn: ({
      userId,
      planId,
      durationDays,
    }: {
      userId: string;
      planId: string;
      durationDays?: number;
    }) => api.adminAssignUserSubscription(userId, { planId, durationDays }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      void onRefreshUser();
      toast.success(
        res.subscription.tier === 'pro'
          ? `Statut Pro activé (${res.subscription.planName})`
          : 'Compte repassé en offre Basic (Gratuit)'
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Attribution impossible'),
  });

  const revokeProMutation = useMutation({
    mutationFn: (userId: string) => api.adminRevokeUserPro(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      void onRefreshUser();
      toast.success('Statut Pro retiré — compte repassé en Basic');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Révocation impossible'),
  });

  const banMutation = useMutation({
    mutationFn: ({
      userId,
      banned,
      reason,
    }: {
      userId: string;
      banned: boolean;
      reason?: string;
    }) => api.adminBanUser(userId, banned, reason),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      void onRefreshUser();
      setBanModalUser(null);
      setBanReasonInput('');
      toast.success(vars.banned ? 'Utilisateur banni' : 'Utilisateur débanni');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Modération impossible'),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => api.adminDeleteUser(userId),
    onSuccess: (_res, deletedId) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
      void onRefreshUser();
      if (selectedUserId === deletedId) {
        setSelectedUserId(null);
      }
      setDeleteModalUser(null);
      toast.success('Utilisateur supprimé définitivement');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Suppression impossible'),
  });

  const toggleSort = (key: Exclude<SortKey, 'default'>) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'username' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (key: Exclude<SortKey, 'default'>) => {
    if (sortKey !== key) return <ArrowUpDown className="size-3 opacity-50" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="size-3 text-primary" />
    ) : (
      <ArrowDown className="size-3 text-primary" />
    );
  };

  const hasFilters =
    Boolean(search.trim()) ||
    tierFilter !== 'all' ||
    presenceFilter !== 'all' ||
    roleFilter !== 'all';

  const watchingNow = users.filter((u) => u.online && u.currentItem).length;
  const rangeStart = filteredUsers.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(filteredUsers.length, safePage * pageSize);

  return (
    <div className="space-y-6">
      {isError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold">Erreur de chargement des utilisateurs Supabase</p>
            <p className="mt-0.5 text-muted-foreground">
              {error instanceof Error
                ? error.message
                : 'Vérifiez vos secrets Supabase et les droits RLS.'}
            </p>
          </div>
        </div>
      )}

      {data?.warning && (
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/40 bg-card p-4 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-muted-foreground">{data.warning}</p>
        </div>
      )}

      {/* Dynamic Users Table Section */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground tabular-nums">
              Utilisateurs ({filteredUsers.length}
              {hasFilters ? ` / ${users.length}` : ''}) · {watchingNow} en lecture
            </h2>
            <p className="text-xs text-muted-foreground">
              Cliquez sur un membre pour gérer son rôle, son abonnement Pro et consulter son historique.
            </p>
          </div>

          {data?.source && (
            <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
              Source :{' '}
              {data.source === 'supabase_auth'
                ? 'Supabase Auth'
                : data.source === 'supabase_rpc'
                  ? 'Supabase RPC'
                  : data.source === 'supabase_profiles'
                    ? 'Supabase Profiles'
                    : 'Local'}
            </span>
          )}
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher pseudo, email ou ID…"
              className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          <select
            aria-label="Filtrer par abonnement"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as 'all' | 'pro' | 'free')}
            className="h-9 rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="all">Tous les abonnements</option>
            <option value="pro">Pro uniquement</option>
            <option value="free">Gratuit (Basic)</option>
          </select>

          <select
            aria-label="Filtrer par statut"
            value={presenceFilter}
            onChange={(e) =>
              setPresenceFilter(e.target.value as 'all' | 'online' | 'offline' | 'banned')
            }
            className="h-9 rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="all">Tous les statuts</option>
            <option value="online">En ligne uniquement</option>
            <option value="offline">Hors ligne</option>
            <option value="banned">Bannis uniquement</option>
          </select>

          <select
            aria-label="Filtrer par rôle"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | 'admin' | 'member')}
            className="h-9 rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="all">Tous les rôles</option>
            <option value="admin">Admins</option>
            <option value="member">Membres</option>
          </select>

          <select
            aria-label="Nombre d'utilisateurs par page"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) || 20)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none"
          >
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setTierFilter('all');
                setPresenceFilter('all');
                setRoleFilter('all');
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap"
            >
              <RotateCcw className="size-3.5" />
              <span>Réinitialiser</span>
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-background/70 text-xs text-muted-foreground">
              <tr>
                <th className="py-2.5 pr-3 pl-4 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('username')}
                    className="inline-flex items-center gap-1.5 hover:text-foreground"
                  >
                    <span>Utilisateur</span>
                    {renderSortIcon('username')}
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('online')}
                    className="inline-flex items-center gap-1.5 hover:text-foreground"
                  >
                    <span>Statut</span>
                    {renderSortIcon('online')}
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('isPro')}
                    className="inline-flex items-center gap-1.5 hover:text-foreground"
                  >
                    <span>Offre</span>
                    {renderSortIcon('isPro')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('plays')}
                    className="inline-flex items-center gap-1.5 hover:text-foreground"
                  >
                    <span>Lectures</span>
                    {renderSortIcon('plays')}
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('createdAt')}
                    className="inline-flex items-center gap-1.5 hover:text-foreground"
                  >
                    <span>Inscription</span>
                    {renderSortIcon('createdAt')}
                  </button>
                </th>
                <th className="py-2.5 pr-4 pl-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Aucun utilisateur ne correspond à ces filtres.
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((u) => {
                  const isSelected = selectedUserId === u.id;
                  return (
                    <tr
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-accent/80' : 'hover:bg-accent/40'
                      }`}
                    >
                      <td className="py-3 pr-3 pl-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar
                            avatar={u.avatar}
                            seed={u.id}
                            username={u.username}
                            isPro={u.isPro}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-foreground">
                                {u.username || 'Sans pseudo'}
                              </span>
                              {u.isPro && <ProCrownBadge />}
                              {u.isAdmin && (
                                <span className="text-[11px] font-semibold text-primary">· Admin</span>
                              )}
                              {u.banned && (
                                <span className="text-[11px] font-semibold text-destructive">· Banni</span>
                              )}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-xs tabular-nums">
                        {u.banned ? (
                          <span
                            title={u.banReason || 'Compte suspendu'}
                            className="inline-flex items-center gap-1 font-semibold text-destructive"
                          >
                            <Ban className="size-3.5" />
                            <span>Banni</span>
                          </span>
                        ) : u.online ? (
                          <span className="font-semibold text-emerald-400">
                            {u.currentItem ? `En lecture : ${u.currentItem.titre}` : 'En ligne'}
                          </span>
                        ) : u.lastSeen ? (
                          <span className="text-muted-foreground">
                            Vu {new Date(u.lastSeen).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Hors ligne</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-xs whitespace-nowrap">
                        {u.isPro ? (
                          <div>
                            <span className="font-semibold text-amber-400">
                              {u.subscription?.planName || 'Pro'}
                            </span>
                            {u.subscription?.expiresAt && (
                              <p className="text-[11px] text-muted-foreground tabular-nums">
                                Exp. {new Date(u.subscription.expiresAt).toLocaleDateString('fr-FR')}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Gratuit (Basic)</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right font-mono text-xs text-foreground tabular-nums">
                        {u.plays}
                      </td>

                      <td className="py-3 px-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString('fr-FR')}
                      </td>

                      <td
                        className="py-3 pr-4 pl-3 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedUserId(u.id)}
                            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background text-foreground hover:bg-accent'
                            }`}
                          >
                            {isSelected ? 'Sélectionné' : 'Gérer'}
                          </button>
                          <button
                            type="button"
                            title={`Envoyer une notification à ${u.username || u.email}`}
                            aria-label={`Notifier ${u.username || u.email}`}
                            onClick={() => onNotifyUser(u.id)}
                            className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-primary"
                          >
                            <Bell className="size-3.5" />
                          </button>
                          {u.isPro && (
                            <button
                              type="button"
                              title="Retirer le statut Pro (passer Basic)"
                              aria-label={`Retirer le statut Pro de ${u.username || u.email}`}
                              disabled={revokeProMutation.isPending}
                              onClick={() => revokeProMutation.mutate(u.id)}
                              className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-amber-400 hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                            >
                              <UserX className="size-3.5" />
                            </button>
                          )}
                          {u.id !== currentUser?.id && (
                            <>
                              <button
                                type="button"
                                title={u.banned ? 'Débannir ce membre' : 'Bannir ce membre'}
                                aria-label={
                                  u.banned
                                    ? `Débannir ${u.username || u.email}`
                                    : `Bannir ${u.username || u.email}`
                                }
                                disabled={banMutation.isPending}
                                onClick={() => {
                                  if (u.banned) {
                                    banMutation.mutate({ userId: u.id, banned: false });
                                  } else {
                                    setBanReasonInput('');
                                    setBanModalUser(u);
                                  }
                                }}
                                className={`inline-flex size-7 items-center justify-center rounded-md border bg-background transition-colors disabled:opacity-50 ${
                                  u.banned
                                    ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                                    : 'border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-400'
                                }`}
                              >
                                {u.banned ? (
                                  <CheckCircle2 className="size-3.5" />
                                ) : (
                                  <Ban className="size-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                title="Supprimer définitivement cet utilisateur"
                                aria-label={`Supprimer ${u.username || u.email}`}
                                disabled={deleteUserMutation.isPending}
                                onClick={() => setDeleteModalUser(u)}
                                className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">
          <p className="tabular-nums">
            Affichage de <strong className="text-foreground">{rangeStart}</strong>–
            <strong className="text-foreground">{rangeEnd}</strong> sur{' '}
            <strong className="text-foreground">{filteredUsers.length}</strong> utilisateur
            {filteredUsers.length > 1 ? 's' : ''}
          </p>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
              <span>Précédent</span>
            </button>

            {buildPageNumbers(safePage, totalPages).map((item, idx) =>
              item === 'ellipsis' ? (
                <span key={`el-${idx}`} className="px-1.5 text-muted-foreground">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPage(item)}
                  className={`min-w-8 rounded-md border px-2 py-1.5 text-xs font-medium tabular-nums transition-colors ${
                    item === safePage
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:bg-accent'
                  }`}
                >
                  {item}
                </button>
              )
            )}

            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40"
            >
              <span>Suivant</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Selected User Management Card */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-6">
        {!selectedUser ? (
          <p className="text-sm text-muted-foreground">
            Sélectionnez un utilisateur dans le tableau ci-dessus pour consulter son activité et gérer son statut Pro.
          </p>
        ) : (
          <div>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <UserAvatar
                  avatar={selectedUser.avatar}
                  seed={selectedUser.id}
                  username={selectedUser.username}
                  isPro={selectedUser.isPro}
                  size="md"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-xl font-semibold text-foreground">
                      {selectedUser.username || selectedUser.email}
                    </h3>
                    {selectedUser.isPro && <ProCrownBadge />}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {selectedUser.email} · {selectedUser.online ? 'Actuellement en ligne' : 'Hors ligne'} · Inscrit le{' '}
                    {new Date(selectedUser.createdAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
              </div>

                <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNotifyUser(selectedUser.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent whitespace-nowrap shrink-0"
                >
                  <Bell className="size-3.5 text-primary" />
                  <span>Notifier ce membre</span>
                </button>

                {selectedUser.isPro && (
                  <button
                    type="button"
                    disabled={revokeProMutation.isPending}
                    onClick={() => revokeProMutation.mutate(selectedUser.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-amber-400 hover:border-destructive/40 hover:text-destructive disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <UserX className="size-3.5" />
                    <span>Retirer Pro</span>
                  </button>
                )}

                {selectedUser.id !== currentUser?.id && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        roleMutation.mutate({
                          userId: selectedUser.id,
                          role: selectedUser.isAdmin ? 'member' : 'admin',
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent whitespace-nowrap shrink-0"
                    >
                      <Shield className="size-3.5 text-primary" />
                      <span>
                        {selectedUser.isAdmin ? 'Rétrograder Membre' : 'Promouvoir Admin'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={banMutation.isPending}
                      onClick={() => {
                        if (selectedUser.banned) {
                          banMutation.mutate({ userId: selectedUser.id, banned: false });
                        } else {
                          setBanReasonInput('');
                          setBanModalUser(selectedUser);
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-50 ${
                        selectedUser.banned
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                          : 'border-border bg-background text-amber-400 hover:border-amber-500/40'
                      }`}
                    >
                      {selectedUser.banned ? (
                        <>
                          <CheckCircle2 className="size-3.5" />
                          <span>Débannir</span>
                        </>
                      ) : (
                        <>
                          <Ban className="size-3.5" />
                          <span>Bannir</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={deleteUserMutation.isPending}
                      onClick={() => setDeleteModalUser(selectedUser)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="size-3.5" />
                      <span>Supprimer</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {selectedUser.banned && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs">
                <div className="flex items-start gap-2.5">
                  <Ban className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div>
                    <p className="font-semibold text-foreground">
                      Ce compte est actuellement banni
                      {selectedUser.bannedAt
                        ? ` (depuis le ${new Date(selectedUser.bannedAt).toLocaleDateString('fr-FR')})`
                        : ''}
                    </p>
                    {selectedUser.banReason && (
                      <p className="mt-0.5 text-muted-foreground">
                        Motif : {selectedUser.banReason}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={banMutation.isPending}
                  onClick={() => banMutation.mutate({ userId: selectedUser.id, banned: false })}
                  className="rounded-lg border border-emerald-500/40 bg-background px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10"
                >
                  Débannir maintenant
                </button>
              </div>
            )}

            {/* Manual Pro / Basic Assignment Block */}
            <div className="mb-6 border-b border-border pb-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Crown
                    className={`size-4 ${
                      selectedUser.isPro
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground'
                    }`}
                  />
                  <h4 className="text-sm font-semibold text-foreground">
                    Statut Abonnement :{' '}
                    {selectedUser.isPro
                      ? `${selectedUser.subscription?.planName || 'Pro'}`
                      : 'Basic (Gratuit)'}
                  </h4>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {selectedUser.isPro
                    ? selectedUser.subscription?.expiresAt
                      ? `Expire le ${new Date(selectedUser.subscription.expiresAt).toLocaleDateString('fr-FR')}`
                      : 'Durée illimitée'
                    : 'Rétrogradation auto à expiration'}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Offre</span>
                  <select
                    value={assignPlanId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setAssignPlanId(nextId);
                      const found = availablePlans.find((p) => p.id === nextId);
                      if (found) setAssignDays(String(found.durationDays));
                    }}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(availablePlans.length > 0
                      ? availablePlans
                      : [
                          { id: 'pro', name: 'Pro Mensuel' },
                          { id: 'pro_yearly', name: 'Pro Annuel' },
                          { id: 'free', name: 'Gratuit (Basic)' },
                        ]
                    ).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">
                    Durée (jours, 0 = ∞)
                  </span>
                  <input
                    type="number"
                    min={0}
                    disabled={assignPlanId === 'free'}
                    value={assignDays}
                    onChange={(e) => setAssignDays(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground tabular-nums focus:border-primary focus:outline-none disabled:opacity-50"
                  />
                </label>

                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    disabled={assignSubMutation.isPending}
                    onClick={() =>
                      assignSubMutation.mutate({
                        userId: selectedUser.id,
                        planId: assignPlanId,
                        durationDays: Math.max(0, Number(assignDays) || 0),
                      })
                    }
                    className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                  >
                    Appliquer
                  </button>
                  {selectedUser.isPro && (
                    <button
                      type="button"
                      disabled={revokeProMutation.isPending}
                      onClick={() => revokeProMutation.mutate(selectedUser.id)}
                      className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-medium text-muted-foreground hover:border-destructive/40 hover:text-destructive whitespace-nowrap disabled:opacity-50"
                    >
                      Retirer Pro
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                  En cours de lecture
                </h4>
                {selectedUser.online && selectedUser.currentItem ? (
                  <ItemRow item={selectedUser.currentItem} extra="En direct" />
                ) : (
                  <p className="text-sm text-muted-foreground">Aucune lecture active.</p>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                  Historique de visionnage
                </h4>
                {historyQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Chargement…</p>
                ) : historyQuery.data?.history.length ? (
                  <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                    {historyQuery.data.history.map((h) => (
                      <ItemRow
                        key={h.id}
                        item={h.item}
                        extra={new Date(h.viewedAt).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Aucun visionnage enregistré.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* In-app Modal: Ban User */}
      {banModalUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!banMutation.isPending) setBanModalUser(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-400">
                  <Ban className="size-4" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Bannir cet utilisateur
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {banModalUser.username || banModalUser.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Fermer"
                onClick={() => setBanModalUser(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              L’utilisateur ne pourra plus se connecter ni accéder à son compte tant qu’il restera banni.
            </p>

            <label className="block text-xs">
              <span className="mb-1.5 block font-medium text-foreground">
                Motif du bannissement (optionnel)
              </span>
              <input
                value={banReasonInput}
                onChange={(e) => setBanReasonInput(e.target.value)}
                maxLength={200}
                placeholder="Ex : Non-respect des conditions d’utilisation"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={banMutation.isPending}
                onClick={() => setBanModalUser(null)}
                className="rounded-lg border border-border bg-background px-4 py-2 text-xs font-medium text-foreground hover:bg-accent"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={banMutation.isPending}
                onClick={() =>
                  banMutation.mutate({
                    userId: banModalUser.id,
                    banned: true,
                    reason: banReasonInput.trim(),
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <Ban className="size-3.5" />
                <span>{banMutation.isPending ? 'Bannissement…' : 'Confirmer le bannissement'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-app Modal: Delete User */}
      {deleteModalUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!deleteUserMutation.isPending) setDeleteModalUser(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-destructive/40 bg-card p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-lg border border-destructive/40 bg-destructive/10 text-destructive">
                  <Trash2 className="size-4" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Supprimer définitivement
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {deleteModalUser.username || deleteModalUser.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Fermer"
                onClick={() => setDeleteModalUser(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Cette action est irréversible : le compte, les favoris, l’historique, les notifications et l’abonnement associé à{' '}
              <strong className="text-foreground">{deleteModalUser.email}</strong> seront supprimés.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleteUserMutation.isPending}
                onClick={() => setDeleteModalUser(null)}
                className="rounded-lg border border-border bg-background px-4 py-2 text-xs font-medium text-foreground hover:bg-accent"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={deleteUserMutation.isPending}
                onClick={() => deleteUserMutation.mutate(deleteModalUser.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                <span>
                  {deleteUserMutation.isPending ? 'Suppression…' : 'Supprimer définitivement'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
