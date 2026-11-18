import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Crown,
  Megaphone,
  Search,
  Send,
  UserCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AdminNotificationTarget, AdminUserSummary } from '../shared/types';
import { api } from '../lib/client';
import { ProCrownBadge, UserAvatar } from './UserAvatar';

const TARGET_LABELS: Record<AdminNotificationTarget, string> = {
  all: 'Tous les utilisateurs',
  pro: 'Utilisateurs Pro',
  free: 'Utilisateurs Gratuit',
  user: 'Utilisateur(s) spécifique(s)',
};

export function AdminNotificationsTab({
  users,
  preselectedUserIds,
}: {
  users: AdminUserSummary[];
  preselectedUserIds?: string[];
}) {
  const queryClient = useQueryClient();

  const [target, setTarget] = useState<AdminNotificationTarget>(
    preselectedUserIds && preselectedUserIds.length > 0 ? 'user' : 'all'
  );
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(preselectedUserIds ?? []);
  const [userSearch, setUserSearch] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('/');

  useEffect(() => {
    if (preselectedUserIds && preselectedUserIds.length > 0) {
      setTarget('user');
      setSelectedUserIds((prev) => [...new Set([...prev, ...preselectedUserIds])]);
    }
  }, [preselectedUserIds]);

  const historyQuery = useQuery({
    queryKey: ['admin-notifications-history'],
    queryFn: () => api.adminNotificationHistory(),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api.adminSendNotification({
        target,
        userIds: target === 'user' ? selectedUserIds : undefined,
        title: title.trim(),
        message: message.trim(),
        link: link.trim() || '/',
      }),
    onSuccess: (res) => {
      setTitle('');
      setMessage('');
      void queryClient.invalidateQueries({ queryKey: ['admin-notifications-history'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(
        `Notification envoyée à ${res.sentCount} destinataire${res.sentCount > 1 ? 's' : ''}.`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Échec de l'envoi");
    },
  });

  const proCount = useMemo(() => users.filter((u) => u.isPro).length, [users]);
  const freeCount = useMemo(() => users.filter((u) => !u.isPro).length, [users]);

  const filteredCandidates = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const recipientCountPreview =
    target === 'all'
      ? users.length
      : target === 'pro'
        ? proCount
        : target === 'free'
          ? freeCount
          : selectedUserIds.length;

  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const broadcasts = historyQuery.data?.broadcasts ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Compose Admin Notification */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-5 lg:col-span-2">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
            <Megaphone className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Envoyer une notification
            </h2>
            <p className="text-xs text-muted-foreground">
              Ciblez tous vos membres, uniquement les comptes Pro, uniquement les comptes Gratuits ou des utilisateurs précis.
            </p>
          </div>
        </div>

        {/* Target Audience Selector */}
        <div>
          <p className="mb-2.5 text-xs font-medium text-muted-foreground">Destinataires</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(
              [
                {
                  id: 'all',
                  label: 'Tous les utilisateurs',
                  count: `${users.length} membre${users.length > 1 ? 's' : ''}`,
                  Icon: Users,
                },
                {
                  id: 'pro',
                  label: 'Utilisateurs Pro',
                  count: `${proCount} membre${proCount > 1 ? 's' : ''} Pro`,
                  Icon: Crown,
                },
                {
                  id: 'free',
                  label: 'Utilisateurs Gratuit',
                  count: `${freeCount} membre${freeCount > 1 ? 's' : ''} Basic`,
                  Icon: UserRound,
                },
                {
                  id: 'user',
                  label: 'Utilisateur(s) spécifique(s)',
                  count: `${selectedUserIds.length} sélectionné${selectedUserIds.length > 1 ? 's' : ''}`,
                  Icon: UserCheck,
                },
              ] as const
            ).map((opt) => {
              const active = target === opt.id;
              const Icon = opt.Icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTarget(opt.id)}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3.5 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      className={`size-4 shrink-0 ${
                        opt.id === 'pro'
                          ? 'text-amber-400'
                          : active
                            ? 'text-primary'
                            : 'text-muted-foreground'
                      }`}
                    />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">{opt.count}</p>
                    </div>
                  </div>
                  {active && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Specific User Picker */}
        {target === 'user' && (
          <div className="rounded-lg border border-border bg-background/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Filtrer par pseudo ou email…"
                  className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-8 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>
              {selectedUserIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedUserIds([])}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                  <span>Tout désélectionner</span>
                </button>
              )}
            </div>

            {selectedUserIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedUserIds.map((uid) => {
                  const found = users.find((u) => u.id === uid);
                  return (
                    <button
                      key={uid}
                      type="button"
                      onClick={() => toggleUser(uid)}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-primary/20"
                    >
                      <span>{found?.username || found?.email || uid.slice(0, 8)}</span>
                      <X className="size-3" />
                    </button>
                  );
                })}
              </div>
            )}

            <div className="max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background">
              {filteredCandidates.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  Aucun utilisateur trouvé.
                </p>
              ) : (
                filteredCandidates.slice(0, 80).map((u) => {
                  const checked = selectedUserIds.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs transition-colors hover:bg-accent/50 ${
                        checked ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleUser(u.id)}
                          className="size-3.5 accent-primary"
                        />
                        <UserAvatar
                          avatar={u.avatar}
                          seed={u.id}
                          username={u.username}
                          isPro={u.isPro}
                          size="xs"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-semibold text-foreground">
                              {u.username || 'Sans pseudo'}
                            </span>
                            {u.isPro && <ProCrownBadge />}
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {u.isPro ? 'Pro' : 'Gratuit'}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Message Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMutation.mutate();
          }}
          className="space-y-4"
        >
          <label className="block text-xs">
            <span className="mb-1.5 block font-medium text-foreground">Titre de la notification</span>
            <input
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. Nouveaux épisodes ajoutés / Offre Pro disponible"
              className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </label>

          <label className="block text-xs">
            <span className="mb-1.5 block font-medium text-foreground">Message</span>
            <textarea
              required
              rows={3}
              maxLength={400}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Rédigez le message affiché dans la cloche de notifications des membres…"
              className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1.5 block font-medium text-foreground">
                Lien au clic (optionnel)
              </span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="/"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </label>

            <div className="flex flex-wrap items-end gap-1.5">
              {[
                { label: 'Accueil', to: '/' },
                { label: 'Catalogue', to: '/catalogue' },
                { label: 'Devenir Pro', to: '/abonnement' },
                { label: 'Profil', to: '/profil' },
              ].map((preset) => (
                <button
                  key={preset.to}
                  type="button"
                  onClick={() => setLink(preset.to)}
                  className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    link === preset.to
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={
                sendMutation.isPending ||
                !title.trim() ||
                !message.trim() ||
                recipientCountPreview === 0
              }
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="size-4" />
              <span>
                {sendMutation.isPending
                  ? 'Envoi en cours…'
                  : `Envoyer la notification (${recipientCountPreview} destinataire${
                      recipientCountPreview > 1 ? 's' : ''
                    })`}
              </span>
            </button>
          </div>
        </form>
      </section>

      {/* Sent Broadcast History */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-foreground">
            Historique des envois
          </h3>
          <p className="text-xs text-muted-foreground">
            Dernières notifications diffusées depuis la console.
          </p>
        </div>

        {broadcasts.length === 0 ? (
          <p className="rounded-lg border border-border bg-background/50 p-5 text-center text-xs text-muted-foreground">
            Aucune notification envoyée pour le moment.
          </p>
        ) : (
          <ul className="max-h-[34rem] space-y-2.5 overflow-y-auto pr-1">
            {broadcasts.map((b) => (
              <li
                key={b.id}
                className="rounded-lg border border-border bg-background p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-primary">
                    {TARGET_LABELS[b.target]} ({b.recipientCount})
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(b.createdAt).toLocaleString('fr-FR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                <p className="text-xs font-semibold text-foreground">{b.title}</p>
                <p className="text-xs leading-snug text-muted-foreground">{b.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
