import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  MailCheck,
  RefreshCw,
  Shield,
  UserRound,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle, useSiteConfig } from '../lib/siteConfig';
import { CaptchaChallenge } from '../components/CaptchaChallenge';
import { OtpCodeInput } from '../components/OtpCodeInput';

export function AuthPage() {
  const { isMember, backend, setSession } = useAuth();
  const { siteName } = useSiteConfig();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(() =>
    searchParams.get('mode') === 'signup' ? 'signup' : 'login'
  );
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    message?: string;
  }>({ checking: false, available: null });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState(false);

  // 6-digit verification code state (for signup AND forgot-password)
  const [pendingKind, setPendingKind] = useState<'signup' | 'forgot' | null>(null);
  const [pendingCodeEmail, setPendingCodeEmail] = useState<string | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  // Built-in SVG CAPTCHA + honeypot state
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState<string | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const refreshCaptcha = React.useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaAnswer('');
    try {
      const challenge = await api.captcha();
      setCaptchaToken(challenge.captchaToken);
      setCaptchaSvg(challenge.svgDataUri);
    } catch {
      setCaptchaSvg(null);
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!pendingCodeEmail) {
      void refreshCaptcha();
    }
  }, [mode, pendingCodeEmail, refreshCaptcha]);

  useDocumentTitle(
    pendingCodeEmail
      ? pendingKind === 'forgot'
        ? 'Réinitialisation par code'
        : 'Vérification par code'
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
          err instanceof Error ? err.message : 'Code ou jeton de confirmation invalide.'
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const securityPayload = {
      captchaToken,
      captchaAnswer: captchaAnswer.trim(),
      website: honeypot,
    };
    if (!securityPayload.captchaToken || securityPayload.captchaAnswer.length < 4) {
      setStatusError(true);
      setStatusMessage('Veuillez recopier le code de sécurité.');
      return;
    }

    setBusy(true);
    setStatusMessage('');
    setStatusError(false);
    try {
      if (mode === 'forgot') {
        const res = await api.forgotPassword(email.trim().toLowerCase(), securityPayload);
        if (res.requiresCode) {
          setPendingKind('forgot');
          setPendingCodeEmail(res.email || email.trim().toLowerCase());
          setOtpDigits(['', '', '', '', '', '']);
          setResetNewPassword('');
          setResetConfirmPassword('');
          setResendCooldown(20);
          setStatusError(false);
          setStatusMessage(
            res.message || `Un code à 6 chiffres a été envoyé à ${res.email || email}.`
          );
          toast.success('Code de réinitialisation envoyé par email');
        } else {
          setStatusMessage(res.message);
          void refreshCaptcha();
        }
      } else if (mode === 'signup') {
        if (usernameStatus.available === false) {
          setStatusError(true);
          setStatusMessage(usernameStatus.message || 'Veuillez choisir un autre pseudo.');
          setBusy(false);
          return;
        }
        const res = await api.signup(username, email, password, securityPayload);
        if (res.requiresCode) {
          setPendingKind('signup');
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
          void refreshCaptcha();
        } else {
          setSession(res.token, res.user);
          toast.success(`Bienvenue sur ${siteName}, ${res.user.username} !`);
          navigate('/', { replace: true });
        }
      } else {
        const res = await api.login(email, password, securityPayload);
        setSession(res.token, res.user);
        toast.success(`Bon retour, ${res.user.username} !`);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setStatusError(true);
      setStatusMessage(err instanceof Error ? err.message : 'Opération impossible.');
      void refreshCaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function submitSignupOtpCode(codeToVerify: string) {
    if (!pendingCodeEmail || pendingKind !== 'signup' || codeToVerify.length !== 6) return;
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

  async function submitForgotOtpReset(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingCodeEmail || pendingKind !== 'forgot') return;
    const code = otpDigits.join('');
    if (code.length !== 6) {
      setStatusError(true);
      setStatusMessage('Veuillez saisir le code complet à 6 chiffres.');
      return;
    }
    if (resetNewPassword.length < 8) {
      setStatusError(true);
      setStatusMessage('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setStatusError(true);
      setStatusMessage('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setBusy(true);
    setStatusMessage('');
    setStatusError(false);
    try {
      const res = await api.verifyForgotPasswordCode(pendingCodeEmail, code, resetNewPassword);
      toast.success(res.message);
      setEmail(pendingCodeEmail);
      setPassword('');
      setPendingKind(null);
      setPendingCodeEmail(null);
      setOtpDigits(['', '', '', '', '', '']);
      setResetNewPassword('');
      setResetConfirmPassword('');
      setMode('login');
      setStatusError(false);
      setStatusMessage('Mot de passe mis à jour. Connectez-vous avec votre nouveau mot de passe.');
    } catch (err) {
      setStatusError(true);
      setStatusMessage(err instanceof Error ? err.message : 'Code invalide ou expiré.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResendCode() {
    if (!pendingCodeEmail || resendCooldown > 0 || busy) return;
    setBusy(true);
    setStatusMessage('');
    setStatusError(false);
    try {
      const res =
        pendingKind === 'forgot'
          ? await api.resendForgotPasswordCode(pendingCodeEmail)
          : await api.resendSignupCode(pendingCodeEmail);
      setOtpDigits(['', '', '', '', '', '']);
      setResendCooldown(20);
      setStatusMessage(res.message);
      toast.success('Nouveau code à 6 chiffres envoyé par email');
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
              ? pendingKind === 'forgot'
                ? 'Réinitialisation par code'
                : 'Vérification à 6 chiffres'
              : mode === 'login'
                ? 'Connexion à votre espace'
                : mode === 'signup'
                  ? 'Créer un compte membre'
                  : 'Récupérer votre mot de passe'}
          </h1>
          {pendingCodeEmail && (
            <p className="mt-1 text-xs text-muted-foreground">
              {`Saisissez le code à 6 chiffres envoyé à ${pendingCodeEmail}`}
            </p>
          )}
        </div>

        {pendingCodeEmail && pendingKind === 'signup' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitSignupOtpCode(fullCode);
            }}
            className="space-y-5"
          >
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-xs text-muted-foreground">
              <MailCheck className="size-4 shrink-0 text-primary" />
              <span>Code valable 15 minutes · Pensez à vérifier vos spams</span>
            </div>

            <OtpCodeInput
              digits={otpDigits}
              onChange={setOtpDigits}
              onComplete={(joined) => void submitSignupOtpCode(joined)}
              disabled={busy}
            />

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
                  setPendingKind(null);
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
        ) : pendingCodeEmail && pendingKind === 'forgot' ? (
          <form onSubmit={submitForgotOtpReset} className="space-y-4">
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-xs text-muted-foreground">
              <MailCheck className="size-4 shrink-0 text-primary" />
              <span>Code valable 15 minutes · Pensez à vérifier vos spams</span>
            </div>

            <OtpCodeInput
              digits={otpDigits}
              onChange={setOtpDigits}
              disabled={busy}
            />

            <label className="block text-sm font-medium text-foreground">
              Nouveau mot de passe (8 caractères min.)
              <input
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>

            <label className="block text-sm font-medium text-foreground">
              Confirmer le mot de passe
              <input
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={busy || fullCode.length !== 6 || resetNewPassword.length < 8}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Réinitialisation…' : 'Valider le code et réinitialiser'}
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
                  setPendingKind(null);
                  setPendingCodeEmail(null);
                  setOtpDigits(['', '', '', '', '', '']);
                  setResetNewPassword('');
                  setResetConfirmPassword('');
                  setStatusMessage('');
                  setStatusError(false);
                }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                <span>Modifier l’email</span>
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

            <CaptchaChallenge
              svgDataUri={captchaSvg}
              loading={captchaLoading}
              answer={captchaAnswer}
              onAnswerChange={setCaptchaAnswer}
              onRefresh={() => void refreshCaptcha()}
              honeypot={honeypot}
              onHoneypotChange={setHoneypot}
              disabled={busy}
            />

            <button
              type="submit"
              disabled={
                busy ||
                captchaAnswer.trim().length < 4 ||
                (mode === 'signup' && usernameStatus.available === false)
              }
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? 'Patientez…'
                : mode === 'login'
                  ? 'Se connecter'
                  : mode === 'signup'
                    ? 'Recevoir le code de confirmation'
                    : 'Recevoir le code par email'}
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
  useDocumentTitle('Réinitialisation du mot de passe');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isMember } = useAuth();
  const token = searchParams.get('token');

  const [email, setEmail] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  if (isMember && !token) {
    return <Navigate to="/profil" replace />;
  }

  async function handleLegacyTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(password, token);
      toast.success('Nouveau mot de passe enregistré !');
      navigate('/auth', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réinitialisation impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.forgotPassword(email.trim().toLowerCase());
      setPendingEmail(res.email || email.trim().toLowerCase());
      setOtpDigits(['', '', '', '', '', '']);
      setResendCooldown(20);
      toast.success('Code à 6 chiffres envoyé par email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyReset(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingEmail) return;
    const code = otpDigits.join('');
    if (code.length !== 6) {
      setError('Veuillez saisir le code complet à 6 chiffres.');
      return;
    }
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.verifyForgotPasswordCode(pendingEmail, code, password);
      toast.success(res.message);
      navigate('/auth', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide ou expiré.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <h1 className="mb-3 font-display text-2xl font-bold text-foreground">
          Réinitialiser le mot de passe
        </h1>

        {token ? (
          <form onSubmit={handleLegacyTokenSubmit} className="space-y-4">
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
        ) : pendingEmail ? (
          <form onSubmit={handleVerifyReset} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Saisissez le code à 6 chiffres envoyé à <strong className="text-foreground">{pendingEmail}</strong>.
            </p>
            <OtpCodeInput digits={otpDigits} onChange={setOtpDigits} disabled={busy} />
            <label className="block text-sm font-medium text-foreground">
              Nouveau mot de passe (8 caractères min.)
              <input
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-foreground">
              Confirmer le mot de passe
              <input
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy || otpDigits.join('').length !== 6 || password.length < 8}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Validation…' : 'Valider le code et réinitialiser'}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                disabled={busy || resendCooldown > 0}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.resendForgotPasswordCode(pendingEmail);
                    setResendCooldown(20);
                    toast.success(r.message);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Renvoi impossible.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="font-medium text-primary hover:underline disabled:opacity-50"
              >
                {resendCooldown > 0 ? `Renvoyer (${resendCooldown}s)` : 'Renvoyer un code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingEmail(null);
                  setError('');
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                Changer d’email
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRequestCode} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Indiquez votre adresse email pour recevoir un code de réinitialisation à 6 chiffres.
            </p>
            <label className="block text-sm font-medium text-foreground">
              Adresse email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="mail@mail.fr"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Envoi…' : 'Recevoir le code par email'}
            </button>
            <Link to="/auth" className="block text-center text-xs text-muted-foreground hover:text-foreground">
              Retour à la connexion
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
