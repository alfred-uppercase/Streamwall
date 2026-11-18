import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, KeyRound, Shield, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { api, useAuth } from '../lib/client';

export function AuthPage() {
  const { isMember, backend, setSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetPath, setResetPath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const verifyToken = searchParams.get('verify');
    if (!verifyToken) return;
    let active = true;
    setBusy(true);
    api
      .verifyEmail(verifyToken)
      .then((res) => {
        if (!active) return;
        setSession(res.token, res.user);
        toast.success(`Email confirmé ! Bienvenue sur StreamWall, ${res.user.username}.`);
        navigate('/', { replace: true });
      })
      .catch((err) => {
        if (!active) return;
        setStatusMessage(
          err instanceof Error ? err.message : 'Lien de confirmation invalide ou expiré.'
        );
        const cleaned = new URLSearchParams(searchParams);
        cleaned.delete('verify');
        setSearchParams(cleaned, { replace: true });
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [searchParams, setSearchParams, setSession, navigate]);

  useEffect(() => {
    if (isMember) {
      navigate('/', { replace: true });
    }
  }, [isMember, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatusMessage('');
    setResetPath(null);
    try {
      if (mode === 'forgot') {
        const res = await api.forgotPassword(email);
        setStatusMessage(res.message);
        if (res.resetPath) setResetPath(res.resetPath);
      } else if (mode === 'signup') {
        const res = await api.signup(username, email, password);
        if (res.requiresConfirmation || !res.user) {
          setStatusMessage(
            res.message || 'Consultez votre boîte mail pour confirmer votre inscription.'
          );
        } else {
          setSession(res.token, res.user);
          toast.success(`Bienvenue sur StreamWall, ${res.user.username} !`);
          navigate('/', { replace: true });
        }
      } else {
        const res = await api.login(email, password);
        setSession(res.token, res.user);
        toast.success(`Bon retour, ${res.user.username} !`);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Opération impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickDemo(role: 'admin' | 'member') {
    setBusy(true);
    setStatusMessage('');
    try {
      const res = await api.demoLogin(role);
      setSession(res.token, res.user);
      toast.success(
        role === 'admin'
          ? `Connecté en tant qu'administrateur (${res.user.username})`
          : `Connecté en tant que membre (${res.user.username})`
      );
      navigate('/', { replace: true });
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <div className="mb-6 text-center">
          <Link to="/" className="font-display text-3xl font-bold text-foreground">
            Stream<span className="text-primary">Wall</span>
          </Link>
          <h1 className="mt-3 font-display text-xl font-semibold text-foreground">
            {mode === 'login'
              ? 'Connexion à votre espace'
              : mode === 'signup'
                ? 'Créer un compte membre'
                : 'Récupérer votre mot de passe'}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Lecteur sans publicité, reprise des épisodes, favoris privés et réseau d’amis.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <label className="block text-sm font-medium text-foreground">
              Pseudo
              <input
                required
                maxLength={60}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex. rindra"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
          )}

          <label className="block text-sm font-medium text-foreground">
            Adresse email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alfred@tapenaka.mg"
              className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </label>

          {mode !== 'forgot' && (
            <label className="block text-sm font-medium text-foreground">
              Mot de passe
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? 'Patientez…'
              : mode === 'login'
                ? 'Se connecter'
                : mode === 'signup'
                  ? 'Créer mon compte'
                  : 'Générer le lien de récupération'}
          </button>
        </form>

        {statusMessage && (
          <div role="status" className="mt-4 rounded-lg border border-border bg-background p-3 text-xs text-foreground">
            <p>{statusMessage}</p>
            {resetPath && (
              <Link
                to={resetPath}
                className="mt-2 inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
              >
                <KeyRound className="size-3.5" />
                <span>Ouvrir le lien de réinitialisation maintenant</span>
                <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
        )}

        {/* Quick demo accounts shown only in local store mode */}
        {mode !== 'forgot' && backend !== 'supabase' && (
          <div className="mt-6 border-t border-border pt-5">
            <p className="mb-3 text-center text-xs text-muted-foreground">
              Accès rapide aux comptes préconfigurés
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleQuickDemo('admin')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent whitespace-nowrap shrink-0"
              >
                <Shield className="size-3.5 text-primary" />
                <span>Admin · alfred</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleQuickDemo('member')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent whitespace-nowrap shrink-0"
              >
                <UserRound className="size-3.5 text-primary" />
                <span>Membre · mamisoa</span>
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup');
              setStatusMessage('');
              setResetPath(null);
            }}
            className="font-medium text-primary hover:underline"
          >
            {mode === 'signup' ? 'J’ai déjà un compte' : 'Créer un compte'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'forgot' ? 'login' : 'forgot');
              setStatusMessage('');
              setResetPath(null);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            {mode === 'forgot' ? 'Retour à la connexion' : 'Mot de passe oublié ?'}
          </button>
        </div>
      </div>
    </main>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isMember } = useAuth();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canReset = Boolean(token || isMember);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(password, token);
      toast.success('Nouveau mot de passe enregistré !');
      navigate(isMember ? '/profil' : '/auth', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réinitialisation impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <h1 className="mb-3 font-display text-2xl font-bold text-foreground">
          Nouveau mot de passe
        </h1>
        {canReset ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm font-medium text-foreground">
              Choisissez un nouveau mot de passe (8 caractères min.)
              <input
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-2 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Générez d’abord un lien de récupération depuis la page de connexion.
            </p>
            <Link
              to="/auth"
              className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Aller à la connexion
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
