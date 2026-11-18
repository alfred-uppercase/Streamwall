import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Crown, LogOut, Moon, Palette, RotateCcw, Search, Shield, Shuffle, Sun, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { THEME_PRESETS, useTheme } from '../lib/theme';
import {
  AVATAR_PRESETS,
  AvatarArtwork,
  getRandomAvatarId,
  ProCrownBadge,
  UserAvatar,
} from '../components/UserAvatar';

export function ProfilePage() {
  useDocumentTitle('Mon profil');
  const { user, isAdmin, isPro, refreshUser, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const memberQuery = useQuery({
    queryKey: ['member'],
    queryFn: () => api.member(),
  });

  const { theme, applyAndSaveTheme, resetTheme } = useTheme();
  const [customHex, setCustomHex] = useState(theme.accentHex);

  useEffect(() => {
    setCustomHex(theme.accentHex);
  }, [theme.accentHex]);

  const billingPlansQuery = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api.billingPlans(),
    staleTime: 30_000,
  });
  const hasActiveProPlan = (billingPlansQuery.data?.plans ?? []).some(
    (plan) => plan.tier === 'pro' && plan.active
  );
  const showOffersCard =
    hasActiveProPlan &&
    (isPro || isAdmin || Boolean(billingPlansQuery.data?.config?.proOffersMenuVisible));

  const [username, setUsername] = useState(user?.username ?? '');
  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [newEmail, setNewEmail] = useState(user?.email ?? '');
  const [savingEmail, setSavingEmail] = useState(false);

  useEffect(() => {
    if (user?.email) setNewEmail(user.email);
  }, [user?.email]);

  const [friendSearch, setFriendSearch] = useState('');
  const [searchResults, setSearchResults] = useState<
    { id: string; username: string; avatar: string | null; isPro?: boolean }[]
  >([]);

  useEffect(() => {
    if (memberQuery.data?.profile) {
      setUsername(memberQuery.data.profile.username);
      setAvatar(memberQuery.data.profile.avatar);
    }
  }, [memberQuery.data?.profile]);

  useEffect(() => {
    const q = friendSearch.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchMembers(q);
        setSearchResults(res.members.filter((m) => m.id !== user?.id));
      } catch {
        setSearchResults([]);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [friendSearch, user?.id]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.updateProfile(username.trim(), avatar);
      await refreshUser();
      await queryClient.invalidateQueries({ queryKey: ['member'] });
      toast.success('Profil et avatar enregistrés.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    setSavingPassword(true);
    try {
      await api.resetPassword(newPassword);
      setNewPassword('');
      toast.success('Mot de passe mis à jour.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la mise à jour.');
    } finally {
      setSavingPassword(false);
    }
  }

  async function updateEmail(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      toast.error('Veuillez saisir une adresse email valide.');
      return;
    }
    setSavingEmail(true);
    try {
      const res = await api.updateEmail(cleaned);
      await refreshUser();
      await queryClient.invalidateQueries({ queryKey: ['member'] });
      toast.success(res.message || 'Adresse email mise à jour.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Modification impossible.');
    } finally {
      setSavingEmail(false);
    }
  }

  const addFriendMutation = useMutation({
    mutationFn: (friendId: string) => api.addFriend(friendId),
    onSuccess: () => {
      setFriendSearch('');
      setSearchResults([]);
      void queryClient.invalidateQueries({ queryKey: ['member'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      toast.success('Ami ajouté');
    },
  });

  const removeFriendMutation = useMutation({
    mutationFn: (friendId: string) => api.removeFriend(friendId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      toast.success('Ami retiré');
    },
  });

  const friends = memberQuery.data?.friends ?? [];
  const friendIds = new Set(friends.map((f) => f.id));
  const subscription = memberQuery.data?.profile.subscription ?? user?.subscription;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <UserAvatar
            avatar={avatar}
            seed={user?.id}
            username={username || user?.username}
            isPro={isPro}
            size="lg"
          />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
                Mon profil
              </h1>
              {isPro && <ProCrownBadge />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {user?.email} · {isAdmin ? 'Compte Administrateur' : isPro ? 'Membre Pro' : 'Membre Basic'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {isAdmin && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent whitespace-nowrap shrink-0"
            >
              <Shield className="size-4 text-primary" />
              <span>Administration</span>
            </Link>
          )}
          <button
            type="button"
            onClick={async () => {
              await signOut();
              toast.success('Déconnecté');
              navigate('/auth', { replace: true });
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground whitespace-nowrap shrink-0"
          >
            <LogOut className="size-4" />
            <span>Se déconnecter</span>
          </button>
        </div>
      </div>

      {/* Subscription Status Banner */}
      {showOffersCard && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3.5">
            <div
              className={`grid size-11 shrink-0 place-items-center rounded-xl border ${
                isPro
                  ? 'border-amber-400/50 bg-amber-400/15 text-amber-300'
                  : 'border-border bg-background text-muted-foreground'
              }`}
            >
              <Crown className={`size-5 ${isPro ? 'fill-amber-400 text-amber-400' : ''}`} />
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-foreground">
                {isPro
                  ? `Abonnement ${subscription?.planName || 'Pro'} actif`
                  : 'Offre actuelle : Gratuit (Basic)'}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {isPro
                  ? subscription?.expiresAt
                    ? `Expire le ${new Date(subscription.expiresAt).toLocaleDateString('fr-FR')} · Couronne dorée et lecteur Pro activés`
                    : 'Accès Pro illimité · Couronne dorée et lecteur Pro activés'
                  : 'Passez en Pro pour débloquer le lecteur sans publicité et afficher la couronne Pro.'}
              </p>
            </div>
          </div>
          <Link
            to="/abonnement"
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 ${
              isPro
                ? 'border border-amber-400/50 bg-amber-400/15 text-amber-300'
                : 'bg-primary text-primary-foreground'
            }`}
          >
            <Crown className="size-4" />
            <span>{isPro ? 'Gérer / Renouveler' : 'Devenir Pro'}</span>
          </Link>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Identity & Random/Pickable Avatar */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 font-display text-xl font-semibold text-foreground">
            Identité & Avatar
          </h2>

          <form onSubmit={saveProfile} className="space-y-5">
            <div className="flex items-center gap-4">
              <UserAvatar
                avatar={avatar}
                seed={user?.id}
                username={username || user?.username}
                isPro={isPro}
                size="xl"
              />

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setAvatar(getRandomAvatarId(avatar))}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
                >
                  <Shuffle className="size-3.5 text-primary" />
                  <span>Avatar aléatoire</span>
                </button>
                <p className="text-xs text-muted-foreground">
                  {isPro
                    ? 'Votre couronne dorée Pro accompagne votre avatar.'
                    : 'Choisissez un avatar ci-dessous ou tirez-en un au hasard.'}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-2.5 text-xs text-muted-foreground">Collection d’avatars StreamWall</p>
              <div className="grid grid-cols-6 gap-2.5">
                {AVATAR_PRESETS.map((preset) => {
                  const selected = avatar === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.label}
                      aria-label={`Choisir l’avatar ${preset.label}`}
                      onClick={() => setAvatar(preset.id)}
                      className={`group relative aspect-square overflow-hidden rounded-full border-2 p-0.5 transition-transform hover:scale-105 ${
                        selected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent'
                      }`}
                    >
                      <AvatarArtwork preset={preset} className="size-full rounded-full" />
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block text-sm font-medium text-foreground">
              Pseudo public
              <input
                required
                maxLength={60}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {savingProfile ? 'Enregistrement…' : 'Enregistrer le profil'}
            </button>
          </form>
        </section>

        {/* Security & Email Change */}
        <section className="rounded-xl border border-border bg-card p-6 space-y-6">
          <div>
            <h2 className="mb-2 font-display text-xl font-semibold text-foreground">
              Adresse email & Sécurité
            </h2>
            <p className="text-sm text-muted-foreground">
              Modifiez votre adresse email ou votre mot de passe à tout moment pour sécuriser votre compte.
            </p>
          </div>

          <form onSubmit={updateEmail} className="space-y-3 border-b border-border pb-6">
            <label className="block text-sm font-medium text-foreground">
              Adresse email du compte
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="nom@exemple.com"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={savingEmail || !newEmail.trim() || newEmail.trim().toLowerCase() === (user?.email ?? '').toLowerCase()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {savingEmail ? 'Enregistrement…' : 'Modifier l’adresse email'}
            </button>
          </form>

          <form onSubmit={updatePassword} className="space-y-4">
            <label className="block text-sm font-medium text-foreground">
              Nouveau mot de passe (8 caractères min.)
              <input
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={savingPassword || newPassword.length < 8}
              className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {savingPassword ? 'Mise à jour…' : 'Mettre à jour le mot de passe'}
            </button>
          </form>
        </section>
      </div>

      {/* Theme Colors Customization */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
              <Palette className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">
                Couleurs & Thème
              </h2>
              <p className="text-xs text-muted-foreground">
                Personnalisez l’ambiance visuelle et la couleur d’accent de votre interface StreamWall.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Mode d’affichage"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1"
            >
              <button
                type="button"
                onClick={() => {
                  void applyAndSaveTheme({ ...theme, mode: 'dark' });
                  toast.success('Mode sombre activé.');
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  theme.mode === 'dark'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Moon className="size-3.5" />
                <span>Sombre</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void applyAndSaveTheme({ ...theme, mode: 'light' });
                  toast.success('Mode clair activé.');
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  theme.mode === 'light'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Sun className="size-3.5" />
                <span>Clair</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                void resetTheme();
                toast.success('Thème par défaut restauré.');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0"
            >
              <RotateCcw className="size-3.5" />
              <span>Réinitialiser</span>
            </button>
          </div>
        </div>

        {/* Preset Swatches */}
        <div>
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            Palettes prédéfinies
          </p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {THEME_PRESETS.map((preset) => {
              const active =
                theme.presetId === preset.id &&
                theme.accentHex.toLowerCase() === preset.accentHex.toLowerCase() &&
                theme.mode === preset.mode;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    void applyAndSaveTheme({
                      presetId: preset.id,
                      mode: preset.mode,
                      accentHex: preset.accentHex,
                    });
                    toast.success(`Thème « ${preset.label} » appliqué.`);
                  }}
                  className={`flex items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-primary bg-accent'
                      : 'border-border bg-background hover:bg-accent/50'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="size-5 shrink-0 rounded-full border border-white/20"
                      style={{ backgroundColor: preset.accentHex }}
                    />
                    <span className="truncate text-xs font-semibold text-foreground">
                      {preset.label}
                    </span>
                  </div>
                  {active && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Hex Picker */}
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border bg-background p-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-3 text-xs font-medium text-foreground">
              <span>Couleur d’accent personnalisée</span>
              <input
                type="color"
                aria-label="Choisir une couleur d’accent"
                value={/^#[0-9a-fA-F]{6}$/.test(customHex) ? customHex : theme.accentHex}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomHex(val);
                  void applyAndSaveTheme({
                    presetId: 'custom',
                    mode: theme.mode,
                    accentHex: val,
                  });
                }}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
              />
            </label>

            <input
              type="text"
              maxLength={7}
              aria-label="Code couleur hexadécimal"
              value={customHex}
              onChange={(e) => setCustomHex(e.target.value)}
              placeholder="#e6a82e"
              className="w-28 rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs text-foreground uppercase focus:border-primary focus:outline-none"
            />

            <button
              type="button"
              disabled={!/^#[0-9a-fA-F]{6}$/.test(customHex.trim())}
              onClick={() => {
                void applyAndSaveTheme({
                  presetId: 'custom',
                  mode: theme.mode,
                  accentHex: customHex.trim(),
                });
                toast.success('Couleur personnalisée enregistrée.');
              }}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Appliquer la couleur
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Le contraste des boutons s’adapte automatiquement à la couleur choisie.
          </p>
        </div>
      </section>

      {/* Friends Network */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground tabular-nums">
              Mes amis ({friends.length})
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Ajoutez des membres pour voir leurs découvertes récentes sur l’accueil et les identifier avec @.
            </p>
          </div>
        </div>

        {/* Search & Add Friend */}
        <div className="relative mb-6 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={friendSearch}
            onChange={(e) => setFriendSearch(e.target.value)}
            placeholder="Rechercher un pseudo (ex. mamisoa, tahina…)"
            className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          {searchResults.length > 0 && (
            <ul className="mt-1.5 divide-y divide-border overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
              {searchResults.map((candidate) => {
                const already = friendIds.has(candidate.id);
                return (
                  <li
                    key={candidate.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <UserAvatar
                        avatar={candidate.avatar}
                        seed={candidate.id}
                        username={candidate.username}
                        isPro={candidate.isPro}
                        size="xs"
                      />
                      <span className="font-medium text-foreground">@{candidate.username}</span>
                      {candidate.isPro && <ProCrownBadge />}
                    </div>
                    {already ? (
                      <span className="text-xs text-muted-foreground">Déjà ami</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addFriendMutation.mutate(candidate.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"
                      >
                        <UserPlus className="size-3.5" />
                        <span>Ajouter</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {friends.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
            {friends.map((friend) => (
              <li
                key={friend.id}
                className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar
                    avatar={friend.avatar}
                    seed={friend.id}
                    username={friend.username}
                    isPro={friend.isPro}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        @{friend.username}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {friend.online ? '· En ligne' : '· Hors ligne'}
                        </span>
                      </p>
                      {friend.isPro && <ProCrownBadge />}
                    </div>
                    {friend.currentItem ? (
                      <Link
                        to={`/${friend.currentItem.item_type}/${friend.currentItem.id}`}
                        className="truncate text-xs text-primary hover:underline"
                      >
                        Regarde actuellement : {friend.currentItem.titre}
                      </Link>
                    ) : friend.recentWatch ? (
                      <Link
                        to={`/${friend.recentWatch.item.item_type}/${friend.recentWatch.item.id}`}
                        className="truncate text-xs text-muted-foreground hover:text-foreground"
                      >
                        Dernier titre vu : {friend.recentWatch.item.titre}
                      </Link>
                    ) : (
                      <p className="text-xs text-muted-foreground">Aucune activité récente</p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeFriendMutation.mutate(friend.id)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3.5" />
                  <span>Retirer</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Vous n’avez pas encore ajouté d’amis. Recherchez un membre ci-dessus ou cliquez sur « Ajouter en ami » dans les commentaires.
          </p>
        )}
      </section>
    </main>
  );
}
