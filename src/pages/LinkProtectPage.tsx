import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Download,
  ExternalLink,
  FileDown,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api, useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import type { ProtectedLinkChallenge } from '../shared/types';

function safeRedirectUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function LinkProtectPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { isMember, loading: authLoading } = useAuth();
  useDocumentTitle('Vérification de lien protégé');

  const [humanChecked, setHumanChecked] = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [challengeOverride, setChallengeOverride] = useState<ProtectedLinkChallenge | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockedUrl, setUnlockedUrl] = useState<string | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);

  const inspectQuery = useQuery({
    queryKey: ['linprotect-inspect', token, isMember],
    queryFn: () => api.inspectProtectedLink(token),
    enabled: Boolean(token) && !authLoading,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (inspectQuery.data?.challenge) {
      setChallengeOverride(inspectQuery.data.challenge);
      setUnlockError(null);
      setCaptchaAnswer('');
    }
  }, [inspectQuery.data?.challenge]);

  const unlockMutation = useMutation({
    mutationFn: async () => {
      const activeChallenge = challengeOverride ?? inspectQuery.data?.challenge;
      if (!activeChallenge) {
        throw new Error('Code de sécurité indisponible. Actualisez la page.');
      }
      return api.unlockProtectedLink({
        token,
        captchaToken: activeChallenge.captchaToken,
        captchaAnswer: captchaAnswer.trim(),
        humanChecked,
      });
    },
    onSuccess: (res) => {
      const safe = safeRedirectUrl(res.url);
      if (!safe) {
        setUnlockError('Lien de destination invalide.');
        return;
      }
      setUnlockError(null);
      setUnlockedUrl(safe);
      setRedirectCountdown(2);
    },
    onError: (err: Error & { challenge?: ProtectedLinkChallenge }) => {
      setUnlockError(err.message || 'Vérification refusée. Veuillez réessayer.');
      setCaptchaAnswer('');
      if (err.challenge) {
        setChallengeOverride(err.challenge);
      } else {
        void inspectQuery.refetch();
      }
    },
  });

  useEffect(() => {
    if (!unlockedUrl || redirectCountdown === null) return;
    if (redirectCountdown <= 0) {
      window.location.assign(unlockedUrl);
      return;
    }
    const timer = window.setTimeout(() => {
      setRedirectCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [unlockedUrl, redirectCountdown]);

  const activeChallenge = challengeOverride ?? inspectQuery.data?.challenge ?? null;
  const inspectErr = inspectQuery.error as (Error & { status?: number }) | null;
  const isAuthOrProBlocked =
    Boolean(inspectErr) && (inspectErr?.status === 401 || inspectErr?.status === 403);

  return (
    <main className="mx-auto flex min-h-[75vh] max-w-xl items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Security Shield Header */}
        <div className="border-b border-border bg-background/70 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <ShieldCheck className="size-6" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-sm font-semibold uppercase tracking-wider text-primary">
                LinProtect · Passerelle sécurisée
              </h1>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {authLoading || inspectQuery.isPending ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="size-7 animate-spin text-primary" />
              <p>Vérification du lien chiffré en cours…</p>
            </div>
          ) : isAuthOrProBlocked ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <Lock className="mt-0.5 size-5 shrink-0 text-amber-400" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">Accès verrouillé</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {inspectErr?.message ||
                      'Le téléchargement direct est réservé aux membres Pro et aux administrateurs.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {!isMember && (
                  <Link
                    to="/auth"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-accent"
                  >
                    <span>Se connecter</span>
                  </Link>
                )}
                <Link
                  to="/abonnement"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Crown className="size-3.5" />
                  <span>Passer Pro</span>
                </Link>
              </div>
            </div>
          ) : inspectErr || !inspectQuery.data ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">Lien invalide ou expiré</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {inspectErr?.message ||
                      'Ce lien protégé ne peut pas être vérifié. Retournez sur la fiche du film.'}
                  </p>
                </div>
              </div>
              <Link
                to="/"
                className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent"
              >
                Retour à l’accueil
              </Link>
            </div>
          ) : unlockedUrl ? (
            <div className="space-y-5 text-center py-2">
              <div className="mx-auto grid size-14 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="size-7" />
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-lg font-bold text-foreground">
                  Vérification réussie !
                </h2>
                <p className="text-sm text-muted-foreground">
                  {inspectQuery.data.filename}
                  {inspectQuery.data.quality ? ` · ${inspectQuery.data.quality}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {redirectCountdown && redirectCountdown > 0
                    ? `Redirection sécurisée vers votre fichier…`
                    : `Si le téléchargement ne démarre pas automatiquement, utilisez le bouton ci-dessous.`}
                </p>
              </div>

              <a
                href={unlockedUrl}
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Download className="size-4" />
                <span>Accéder au téléchargement</span>
                <ExternalLink className="size-3.5 opacity-80" />
              </a>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!humanChecked || !captchaAnswer.trim() || unlockMutation.isPending) return;
                unlockMutation.mutate();
              }}
              className="space-y-5"
            >
              {/* File Summary (filename & quality only — URL stays hidden) */}
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background/70 px-4 py-3.5">
                <FileDown className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {inspectQuery.data.filename}
                  </p>
                  {inspectQuery.data.quality && (
                    <p className="text-xs text-muted-foreground">
                      Qualité : {inspectQuery.data.quality}
                    </p>
                  )}
                </div>
              </div>

              {/* Cloudflare-style Human Verification Box */}
              <label
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3.5 transition-colors ${
                  humanChecked
                    ? 'border-emerald-500/45 bg-emerald-500/10'
                    : 'border-border bg-background hover:border-primary/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={humanChecked}
                    onChange={(e) => setHumanChecked(e.target.checked)}
                    className="size-4.5 rounded border-input accent-primary cursor-pointer"
                  />
                  <span className="text-sm font-medium text-foreground">
                    Je confirme que je suis un humain
                  </span>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <ShieldCheck
                    className={`size-4 ${humanChecked ? 'text-emerald-400' : 'text-muted-foreground'}`}
                  />
                  <span>{humanChecked ? 'Validé' : 'Contrôle'}</span>
                </span>
              </label>

              {/* SVG CAPTCHA Box */}
              {activeChallenge && (
                <div className="space-y-2.5 rounded-xl border border-border bg-background/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      Code de sécurité anti-bot
                    </span>
                    <button
                      type="button"
                      disabled={inspectQuery.isFetching}
                      onClick={() => {
                        setUnlockError(null);
                        setCaptchaAnswer('');
                        void inspectQuery.refetch();
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`size-3.5 ${inspectQuery.isFetching ? 'animate-spin' : ''}`}
                      />
                      <span>Actualiser</span>
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <img
                      src={activeChallenge.svgDataUri}
                      alt="Code CAPTCHA de sécurité"
                      className="h-16 w-[210px] shrink-0 rounded-lg border border-border bg-slate-950 object-contain"
                    />
                    <input
                      type="text"
                      value={captchaAnswer}
                      onChange={(e) => setCaptchaAnswer(e.target.value.toUpperCase())}
                      placeholder="Recopiez le code"
                      maxLength={8}
                      autoComplete="off"
                      spellCheck={false}
                      className="h-12 w-full rounded-lg border border-input bg-background px-3.5 font-mono text-base font-bold tracking-widest uppercase text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {unlockError && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs font-medium text-destructive">
                  {unlockError}
                </p>
              )}

              <button
                type="submit"
                disabled={!humanChecked || captchaAnswer.trim().length < 3 || unlockMutation.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {unlockMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Vérification…</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" />
                    <span>Déverrouiller et continuer</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
