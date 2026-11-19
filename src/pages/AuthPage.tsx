import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  MailCheck,
  RefreshCw,
  Shield,
  UserRound,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle, useSiteConfig } from '../lib/siteConfig';

export function AuthPage() {
  const { isMember, backend, setSession } = useAuth();
  const { siteName } = useSiteConfig();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    message?: string;
  }>({ checking: false, available: null });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetPath, setResetPath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState(false);

  // 6-digit verification code state
  const [pendingCodeEmail, setPendingCodeEmail] = useState<string | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useDocumentTitle(
    pendingCodeEmail
      ? 'Vérification par code'
      : mode === 'signup'
        ? 'Inscription'
        : mode === 'forgot'
          ? 'Mot de passe oublié'
          : 'Connexion'
  );

  // Legacy token link verification fallback
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
        toast.success(`Email confirmé ! Bienvenue sur ${siteName}, ${res.user.username}.`);
        navigate('/', { replace: true });
      })
      .catch((err) => {
        if (!active) return;
        setStatusError(true);
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
  }, [searchParams, setSearchParams, setSession, navigate, siteName]);

  useEffect(() => {
    if (isMember) {
      navigate('/', { replace: true });
    }
  }, [isMember, navigate]);

  // Live pseudo uniqueness check in signup mode
  useEffect(() => {
    if (mode !== 'signup' || pendingCodeEmail) {
      setUsernameStatus({ checking: false, available: null });
      return;
    }
    const clean = username.trim();
    if (!clean) {
      setUsernameStatus({ checking: false, available: null });
      return;
    }
    if (clean.length < 3) {
      setUsernameStatus({
        checking: false,
        available: false,
        message: '3 caractères minimum',
      });
      return;
    }
    let active = true;
    setUsernameStatus({ checking: true, available: null });
    const timer = window.setTimeout(() => {
      api
        .checkUsername(clean)
        .then((res) => {
          if (!active) return;
          setUsernameStatus({
            checking: false,
            available: res.available,
            message: res.available ? 'Pseudo disponible' : res.error || 'Ce pseudo est déjà pris',
          });
        })
        .catch(() => {
          if (!active) return;
          setUsernameStatus({ checking: false, available: null });
        });
    }, 320);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [username, mode, pendingCodeEmail]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  // Focus first OTP box when entering code verification step
  useEffect(() => {
    if (pendingCodeEmail) {
      window.setTimeout(() => otpRefs.current[0]?.focus(), 50);
    }
  }, [pendingCodeEmail]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatusMessage('');
    setStatusError(false);
    setResetPath(null);
    try {
      if (mode === 'forgot') {
        const res = await api.forgotPassword(email);
        setStatusMessage(res.message);
        if (res.resetPath) setResetPath(res.resetPath);
      } else if (mode === 'signup') {
        if (usernameStatus.available === false) {
          setStatusError(true);
          setStatusMessage(usernameStatus.message || 'Veuillez choisir un autre pseudo.');
          setBusy(false);
          return;
        }
        const res = await api.signup(username, email, password);
        if (res.requiresCode) {
          setPendingCodeEmail(res.email || email.trim().toLowerCase());
          setOtpDigits(['', '', '', '', '', '']);
          setResendCooldown(20);
          setStatusError(false);
          setStatusMessage(
            res.message || `Un code à 6 chiffres a été envoyé à ${res.email || email}.`
          );
          toast.success('Code de confirmation envoyé par email');
        } else if (res.requiresConfirmation || !res.user) {
          setStatusMessage(
            res.message || 'Consultez votre boîte mail pour confirmer votre inscription.'
          );
        } else {
          setSession(res.token, res.user);
          toast.success(`Bienvenue sur ${siteName}, ${res.user.username} !`);
          navigate('/', { replace: true });
        }
      } else {
        const res = await api.login(email, password);
        setSession(res.token, res.user);
        toast.success(`Bon retour, ${res.user.username} !`);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setStatusError(true);
      setStatusMessage(err instanceof Error ? err.message : 'Opération impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function submitOtpCode(codeToVerify: string) {
    if (!pendingCodeEmail || codeToVerify.length !== 6) return;
    setBusy(true);
    setStatusMessage('');
    setStatusError(false);
    try {
      const res = await api.verifySignupCode(pendingCodeEmail, codeToVerify);
      setSession(res.token, res.user);
      toast.success(`Compte vérifié ! Bienvenue sur ${siteName}, ${res.user.username}.`);
      navigate('/', { replace: true });
    } catch (err) {
      setStatusError(true);
      setStatusMessage(err instanceof Error ? err.message : 'Code invalide ou expiré.');
    } finally {
      setBusy(false);
    }
  }

  function handleOtpChange(index: number, rawValue: string) {
    const digitsOnly = rawValue.replace(/\D/g, '');
    if (digitsOnly.length > 1) {
      // User pasted multiple digits into an input
      const next = [...otpDigits];
      for (let i = 0; i < 6 && index + i < 6; i++) {
        next[index + i] = digitsOnly[i] ?? '';
      }
      setOtpDigits(next);
      const nextFocus = Math.min(5, index + digitsOnly.length);
      otpRefs.current[nextFocus]?.focus();
      const joined = next.join('');
      if (joined.length === 6 && !busy) {
        void submitOtpCode(joined);
      }
      return;
    }

    const next = [...otpDigits];
    next[index] = digitsOnly;
    setOtpDigits(next);
    if (digitsOnly && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
    const joined = next.join('');
    if (joined.length === 6 && !busy) {
      void submitOtpCode(joined);
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      e.preventDefault();
      const next = [...otpDigits];
      next[index - 1] = '';
      setOtpDigits(next);
      otpRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      otpRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault();
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    setOtpDigits(next);
    otpRefs.current[Math.min(5, pasted.length - 1)]?.focus();
    if (pasted.length === 6 && !busy) {
      void submitOtpCode(pasted);
    }
  }

  async function handleResendCode() {
    if (!pendingCodeEmail || resendCooldown > 0 || busy) return;
    setBusy(true);
    setStatusMessage('');
    setStatusError(false);
    try {
      const res = await api.resendSignupCode(pendingCodeEmail);
      setOtpDigits(['', '', '', '', '', '']);
      setResendCooldown(20);
      setStatusMessage(res.message);
      toast.success('Nouveau code envoyé par email');
      otpRefs.current[0]?.focus();
    } catch (err) {
      setStatusError(true);
      setStatusMessage(err instanceof Error ? err.message : 'Renvoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickDemo(role: 'admin' | 'member') {
    setBusy(true);
    setStatusMessage('');
    setStatusError(false);
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
      setStatusError(true);
      setStatusMessage(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  const fullCode = otpDigits.join('');

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <div className="mb-6 text-center">
          <Link to="/" className="font-display text-3xl font-bold text-foreground">
            {siteName === 'StreamWall' ? (
              <>
                Stream<span className="text-primary">Wall</span>
              </>
            ) : (
              siteName
            )}
          </Link>
          <h1 className="mt-3 font-display text-xl font-semibold text-foreground">
            {pendingCodeEmail
              ? 'Vérification à 6 chiffres'
              : mode === 'login'
                ? 'Connexion à votre espace'
                : mode === 'signup'
                  ? 'Créer un compte membre'
                  : 'Récupérer votre mot de passe'}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {pendingCodeEmail
              ? `Saisissez le code à 6 chiffres envoyé à ${pendingCodeEmail}`
              : 'Lecteur sans publicité, reprise des épisodes, favoris privés et réseau d’amis.'}
          </p>
        </div>

        {pendingCodeEmail ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitOtpCode(fullCode);
            }}
            className="space-y-5"
          >
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-xs text-muted-foreground">
              <MailCheck className="size-4 shrink-0 text-primary" />
              <span>Code valable 15 minutes · Pensez à vérifier vos spams</span>
            </div>

            <div className="flex justify-center gap-2" aria-label="Code de vérification à 6 chiffres">
              {otpDigits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => {
                    otpRefs.current[idx] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                  maxLength={6}
                  value={digit}
                  disabled={busy}
                  aria-label={`Chiffre ${idx + 1} sur 6`}
                  onChange={(e) => handleOtpChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                  onPaste={handleOtpPaste}
                  className="h-12 w-11 rounded-lg border border-input bg-background text-center font-mono text-xl font-bold text-foreground tabular-nums focus:border-primary focus:ring-2 focus:ring-primary/25 focus:outline-none disabled:opacity-50 sm:h-13 sm:w-12"
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={busy || fullCode.length !== 6}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Vérification en cours…' : 'Valider le code et activer mon compte'}
            </button>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <button
                type="button"
                disabled={busy || resendCooldown > 0}
                onClick={() => void handleResendCode()}
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline disabled:opacity-50"
              >
                <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
                <span>
                  {resendCooldown > 0
                    ? `Renvoyer le code (${resendCooldown}s)`
                    : 'Renvoyer un nouveau code'}
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPendingCodeEmail(null);
                  setOtpDigits(['', '', '', '', '', '']);
                  setStatusMessage('');
                  setStatusError(false);
                }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                <span>Modifier mes infos</span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <label className="block text-sm font-medium text-foreground">
                <span className="flex items-center justify-between gap-2">
                  <span>Pseudo unique</span>
                  {usernameStatus.checking ? (
                    <span className="text-[11px] font-normal text-muted-foreground">
                      Vérification…
                    </span>
                  ) : usernameStatus.available === true ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="size-3" />
                      <span>{usernameStatus.message}</span>
                    </span>
                  ) : usernameStatus.available === false ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
                      <XCircle className="size-3" />
                      <span>{usernameStatus.message}</span>
                    </span>
                  ) : null}
                </span>
                <input
                  required
                  minLength={3}
                  maxLength={30}
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
                placeholder="mail@mail.fr"
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
              disabled={busy || (mode === 'signup' && usernameStatus.available === false)}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? 'Patientez…'
                : mode === 'login'
                  ? 'Se connecter'
                  : mode === 'signup'
                    ? 'Recevoir le code de confirmation'
                    : 'Générer le lien de récupération'}
            </button>
          </form>
        )}

        {statusMessage && (
          <div
            role="status"
            className={`mt-4 rounded-lg border p-3 text-xs ${
              statusError
                ? 'border-destructive/40 bg-destructive/10 text-foreground'
                : 'border-border bg-background text-foreground'
            }`}
          >
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
        {!pendingCodeEmail && mode !== 'forgot' && backend !== 'supabase' && (
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

        {!pendingCodeEmail && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signup' ? 'login' : 'signup');
                setStatusMessage('');
                setStatusError(false);
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
                setStatusError(false);
                setResetPath(null);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              {mode === 'forgot' ? 'Retour à la connexion' : 'Mot de passe oublié ?'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export function ResetPasswordPage() {
  useDocumentTitle('Nouveau mot de passe');
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
