import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  History,
  Mail,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AdminSmtpSettings,
  AdminSmtpStatus,
  EmailProvider,
  EmailTemplateConfig,
  EmailTemplateKey,
} from '../shared/types';
import { api, useAuth } from '../lib/client';
import { useSiteConfig } from '../lib/siteConfig';

type EmailSubTab = 'gateway' | 'templates' | 'logs';

const TEMPLATE_LABELS: Record<string, string> = {
  test: 'Email de test',
  custom: 'Personnalisé',
  signup_welcome: 'Inscription (Bienvenue)',
  signup_verify: 'Inscription (Code à 6 chiffres)',
  email_change: 'Changement d’email (Code à 6 chiffres)',
  password_change: 'Changement mot de passe (Code à 6 chiffres)',
  subscription_activated: 'Souscription offre Pro',
  subscription_expired: 'Offre expirée',
  password_reset: 'Mot de passe oublié (Code à 6 chiffres)',
};

function renderPreviewText(raw: string, siteName: string): string {
  const sample: Record<string, string> = {
    code: '482915',
    username: 'Rindra',
    email: 'rindra@exemple.com',
    old_email: 'ancien@exemple.com',
    site_name: siteName,
    app_url: 'https://votresite.com',
    plan_name: 'Pro Mensuel',
    expires_at: `jusqu’au ${new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('fr-FR')}`,
    expired_at: new Date().toLocaleDateString('fr-FR'),
    renew_url: 'https://votresite.com/abonnement',
  };
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => sample[k] ?? `{{${k}}}`);
}

export function AdminEmailsTab({
  smtpStatus,
  supabaseServiceRoleConfigured,
}: {
  smtpStatus: AdminSmtpStatus | undefined;
  supabaseServiceRoleConfigured?: boolean;
}) {
  const { user: currentUser, backend } = useAuth();
  const { siteName } = useSiteConfig();
  const queryClient = useQueryClient();

  const [subTab, setSubTab] = useState<EmailSubTab>('gateway');

  // Gateway form state
  const [smtpEdit, setSmtpEdit] = useState<Partial<AdminSmtpSettings>>({});
  const [smtpPassInput, setSmtpPassInput] = useState('');
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [resendKeyInput, setResendKeyInput] = useState('');
  const [showResendKey, setShowResendKey] = useState(false);
  const [brevoKeyInput, setBrevoKeyInput] = useState('');
  const [showBrevoKey, setShowBrevoKey] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');

  useEffect(() => {
    if (currentUser?.email && !testEmailTo) {
      setTestEmailTo(currentUser.email);
    }
  }, [currentUser?.email, testEmailTo]);

  const mergedSmtp: AdminSmtpStatus | null = smtpStatus ? { ...smtpStatus, ...smtpEdit } : null;

  const buildSmtpPayload = (): Partial<AdminSmtpSettings> => {
    if (!mergedSmtp) return {};
    return {
      ...smtpEdit,
      provider: mergedSmtp.provider || 'smtp',
      enabled: mergedSmtp.enabled,
      host: mergedSmtp.host,
      port: Number(mergedSmtp.port) || 587,
      secure: mergedSmtp.secure,
      user: mergedSmtp.user,
      fromName: mergedSmtp.fromName,
      fromEmail: mergedSmtp.fromEmail,
      requireSignupConfirmation: mergedSmtp.requireSignupConfirmation,
      ...(smtpPassInput.trim() ? { pass: smtpPassInput.trim() } : {}),
      ...(resendKeyInput.trim() ? { resendApiKey: resendKeyInput.trim() } : {}),
      ...(brevoKeyInput.trim() ? { brevoApiKey: brevoKeyInput.trim() } : {}),
    };
  };

  const saveSmtpMutation = useMutation({
    mutationFn: (payload: Partial<AdminSmtpSettings>) => api.adminSaveSmtp(payload),
    onSuccess: () => {
      setSmtpEdit({});
      setSmtpPassInput('');
      setResendKeyInput('');
      setBrevoKeyInput('');
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Configuration email enregistrée');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enregistrement impossible'),
  });

  const testSmtpMutation = useMutation({
    mutationFn: async (to: string) => {
      // Save pending changes first so test ALWAYS uses what is currently visible in the form
      if (mergedSmtp) {
        await api.adminSaveSmtp(buildSmtpPayload());
        setSmtpEdit({});
        setSmtpPassInput('');
        setResendKeyInput('');
        setBrevoKeyInput('');
        void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      }
      return api.adminTestSmtp(to);
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-mail-logs'] });
      toast.success(res.message);
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-mail-logs'] });
      toast.error(err instanceof Error ? err.message : 'Échec du test email');
    },
  });

  // Templates Query & State
  const templatesQuery = useQuery({
    queryKey: ['admin-mail-templates'],
    queryFn: () => api.adminEmailTemplates(),
    enabled: subTab === 'templates',
  });

  const [selectedKey, setSelectedKey] = useState<EmailTemplateKey>('signup_welcome');
  const [tplDraft, setTplDraft] = useState<{
    subject: string;
    heading: string;
    body: string;
    ctaLabel: string;
    enabled: boolean;
  } | null>(null);

  const selectedTemplate: EmailTemplateConfig | undefined = useMemo(
    () => templatesQuery.data?.templates.find((t) => t.key === selectedKey) ?? templatesQuery.data?.templates[0],
    [templatesQuery.data?.templates, selectedKey]
  );

  useEffect(() => {
    if (selectedTemplate) {
      setTplDraft({
        subject: selectedTemplate.subject,
        heading: selectedTemplate.heading,
        body: selectedTemplate.body,
        ctaLabel: selectedTemplate.ctaLabel,
        enabled: selectedTemplate.enabled,
      });
    }
  }, [selectedTemplate]);

  const saveTemplateMutation = useMutation({
    mutationFn: ({
      key,
      patch,
    }: {
      key: EmailTemplateKey;
      patch: Partial<Pick<EmailTemplateConfig, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'enabled'>>;
    }) => api.adminSaveEmailTemplate(key, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-mail-templates'] });
      toast.success('Template email enregistré');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enregistrement impossible'),
  });

  const resetTemplateMutation = useMutation({
    mutationFn: (key: EmailTemplateKey) => api.adminResetEmailTemplate(key),
    onSuccess: (res) => {
      setTplDraft({
        subject: res.template.subject,
        heading: res.template.heading,
        body: res.template.body,
        ctaLabel: res.template.ctaLabel,
        enabled: res.template.enabled,
      });
      void queryClient.invalidateQueries({ queryKey: ['admin-mail-templates'] });
      toast.success('Template réinitialisé par défaut');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Réinitialisation impossible'),
  });

  const testTemplateMutation = useMutation({
    mutationFn: async ({ key, to }: { key: EmailTemplateKey; to: string }) => {
      if (tplDraft) {
        await api.adminSaveEmailTemplate(key, tplDraft);
        void queryClient.invalidateQueries({ queryKey: ['admin-mail-templates'] });
      }
      return api.adminTestEmailTemplate(key, to);
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-mail-logs'] });
      toast.success(res.message);
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-mail-logs'] });
      toast.error(err instanceof Error ? err.message : 'Échec de l’envoi');
    },
  });

  // Mail Logs Query & Filters
  const [logStatusFilter, setLogStatusFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [confirmClearLogs, setConfirmClearLogs] = useState(false);

  const logsQuery = useQuery({
    queryKey: ['admin-mail-logs', logStatusFilter, logSearch],
    queryFn: () => api.adminMailLogs({ status: logStatusFilter, q: logSearch }),
    enabled: subTab === 'logs',
    refetchInterval: subTab === 'logs' ? 10_000 : false,
  });

  const clearLogsMutation = useMutation({
    mutationFn: () => api.adminClearMailLogs(),
    onSuccess: () => {
      setConfirmClearLogs(false);
      void queryClient.invalidateQueries({ queryKey: ['admin-mail-logs'] });
      toast.success('Journaux email vidés');
    },
  });

  const applySmtpPreset = (preset: 'brevo' | 'gmail' | 'resend') => {
    if (preset === 'brevo') {
      setSmtpEdit((prev) => ({
        ...prev,
        provider: 'smtp',
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
      }));
    } else if (preset === 'gmail') {
      setSmtpEdit((prev) => ({
        ...prev,
        provider: 'smtp',
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
      }));
    } else {
      setSmtpEdit((prev) => ({
        ...prev,
        provider: 'smtp',
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        user: 'resend',
      }));
    }
  };

  const logs = logsQuery.data?.logs ?? [];

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {(
          [
            { id: 'gateway', label: 'Passerelle (SMTP / Resend / Brevo)', icon: Mail },
            { id: 'templates', label: 'Templates des emails', icon: FileText },
            { id: 'logs', label: 'Logs des emails', icon: History },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* SUBTAB 1: GATEWAY */}
      {subTab === 'gateway' && mergedSmtp && (
        <section className="rounded-xl border border-border bg-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
                <Mail className="size-5" />
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Configuration Email (SMTP / Resend / Brevo)
                </h2>
                <p className="text-xs text-muted-foreground">
                  Utilisé pour les emails d’inscription, de changement d’adresse, d’offres Pro et de réinitialisation.
                </p>
              </div>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground">
              <input
                type="checkbox"
                checked={mergedSmtp.enabled}
                onChange={(e) =>
                  setSmtpEdit((prev) => ({ ...prev, enabled: e.target.checked }))
                }
                className="size-4 accent-primary"
              />
              <span>Activer l’envoi d’emails</span>
            </label>
          </div>

          {mergedSmtp.enabled &&
          mergedSmtp.fromEmail?.includes('@') &&
          ((mergedSmtp.provider === 'resend' &&
            (smtpStatus?.resendApiKeyConfigured || resendKeyInput.trim().length > 0)) ||
            (mergedSmtp.provider === 'brevo' &&
              (smtpStatus?.brevoApiKeyConfigured || brevoKeyInput.trim().length > 0)) ||
            ((mergedSmtp.provider || 'smtp') === 'smtp' && Boolean(mergedSmtp.host?.trim()))) ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-foreground">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
              <span>
                Passerelle active : les nouveaux comptes recevront un{' '}
                <strong>code de vérification à 6 chiffres</strong> par email avant activation.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div>
                <p className="font-semibold">Passerelle email inactive ou incomplète</p>
                <p className="mt-0.5 text-muted-foreground">
                  Pour envoyer le code de vérification à 6 chiffres lors de l’inscription, activez l’envoi d’emails, renseignez votre clé API (Resend / Brevo) ou serveur SMTP ainsi que l’email d’expéditeur, puis enregistrez.
                </p>
              </div>
            </div>
          )}

          {backend === 'supabase' && !supabaseServiceRoleConfigured && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3.5 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <div>
                <p className="font-semibold">Mode Supabase détecté sans clé Service Role</p>
                <p className="mt-0.5 text-muted-foreground">
                  Sans <code className="font-mono text-primary">SUPABASE_SERVICE_ROLE_KEY</code> dans les Secrets, Supabase génère ses propres liens de confirmation et envoie l’email de bienvenue via votre passerelle. Ajoutez cette clé pour que les codes de validation soient gérés directement via Resend/Brevo/SMTP.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'smtp', label: 'SMTP classique' },
                  { id: 'resend', label: 'Resend API' },
                  { id: 'brevo', label: 'Brevo API (v3)' },
                ] as { id: EmailProvider; label: string }[]
              ).map((opt) => {
                const active = (mergedSmtp.provider || 'smtp') === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSmtpEdit((prev) => ({ ...prev, provider: opt.id }))}
                    className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {(mergedSmtp.provider || 'smtp') === 'smtp' && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Pré-remplir :</span>
                <button
                  type="button"
                  onClick={() => applySmtpPreset('brevo')}
                  className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-accent"
                >
                  Brevo SMTP
                </button>
                <button
                  type="button"
                  onClick={() => applySmtpPreset('gmail')}
                  className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-accent"
                >
                  Gmail
                </button>
                <button
                  type="button"
                  onClick={() => applySmtpPreset('resend')}
                  className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-accent"
                >
                  Resend SMTP
                </button>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveSmtpMutation.mutate(buildSmtpPayload());
            }}
            className="space-y-4"
          >
            {(mergedSmtp.provider || 'smtp') === 'smtp' && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block text-xs sm:col-span-2">
                    <span className="mb-1 block font-medium text-foreground">Serveur SMTP (Host)</span>
                    <input
                      value={mergedSmtp.host}
                      onChange={(e) => setSmtpEdit((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="smtp-relay.brevo.com ou smtp.gmail.com"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Port SMTP</span>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={mergedSmtp.port}
                      onChange={(e) => {
                        const port = Number(e.target.value) || 587;
                        setSmtpEdit((prev) => ({
                          ...prev,
                          port,
                          secure: port === 465 ? true : port === 587 || port === 25 || port === 2525 ? false : prev.secure,
                        }));
                      }}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground tabular-nums focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-foreground">Utilisateur / Login SMTP</span>
                    <input
                      value={mergedSmtp.user}
                      onChange={(e) => setSmtpEdit((prev) => ({ ...prev, user: e.target.value }))}
                      placeholder="contact@votredomaine.com"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 flex items-center justify-between gap-2 font-medium text-foreground">
                      <span>Mot de passe / Clé SMTP</span>
                      {smtpStatus?.passMask && (
                        <span className="font-mono text-[11px] text-emerald-400">
                          Actuel : {smtpStatus.passMask}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type={showSmtpPass ? 'text' : 'password'}
                        value={smtpPassInput}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSmtpPassInput(v);
                          if (v.trim() && smtpEdit.enabled === undefined && !smtpStatus?.enabled) {
                            setSmtpEdit((prev) => ({ ...prev, enabled: true }));
                          }
                        }}
                        placeholder={
                          smtpStatus?.passConfigured
                            ? 'Laisser vide pour conserver le mot de passe actuel'
                            : 'Mot de passe ou clé SMTP (ex. xsmtpsib-...)'
                        }
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPass((v) => !v)}
                        aria-label={showSmtpPass ? 'Masquer' : 'Afficher'}
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                      >
                        {showSmtpPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Port <strong>587</strong> = STARTTLS (SSL/TLS direct désactivé) · Port <strong>465</strong> = SSL/TLS direct activé. Remarque : certains hébergeurs cloud bloquent les ports SMTP sortants (25/465/587) — dans ce cas utilisez Resend API ou Brevo API via HTTPS.
                </p>
              </>
            )}

            {mergedSmtp.provider === 'resend' && (
              <div className="space-y-2 rounded-lg border border-border bg-background/50 p-4">
                <label className="block text-xs">
                  <span className="mb-1 flex items-center justify-between gap-2 font-medium text-foreground">
                    <span>Clé API Resend</span>
                    {smtpStatus?.resendApiKeyMask && (
                      <span className="font-mono text-[11px] text-emerald-400">
                        Actuelle : {smtpStatus.resendApiKeyMask}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type={showResendKey ? 'text' : 'password'}
                      value={resendKeyInput}
                      onChange={(e) => {
                        const v = e.target.value;
                        setResendKeyInput(v);
                        if (v.trim() && smtpEdit.enabled === undefined && !smtpStatus?.enabled) {
                          setSmtpEdit((prev) => ({ ...prev, enabled: true }));
                        }
                      }}
                      placeholder={
                        smtpStatus?.resendApiKeyConfigured
                          ? 'Laisser vide pour conserver la clé Resend actuelle'
                          : 're_xxxxxxxxxxxxxxxxxxxxxxxxx'
                      }
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResendKey((v) => !v)}
                      aria-label={showResendKey ? 'Masquer' : 'Afficher'}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                    >
                      {showResendKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Envoi via <code className="font-mono text-primary">api.resend.com</code>. Important : avec <code className="font-mono text-primary">onboarding@resend.dev</code>, Resend n’autorise l’envoi qu’à l’adresse email de votre compte Resend. Vérifiez votre domaine sur Resend pour envoyer à tous vos membres.
                </p>
              </div>
            )}

            {mergedSmtp.provider === 'brevo' && (
              <div className="space-y-2 rounded-lg border border-border bg-background/50 p-4">
                <label className="block text-xs">
                  <span className="mb-1 flex items-center justify-between gap-2 font-medium text-foreground">
                    <span>Clé API Brevo (v3)</span>
                    {smtpStatus?.brevoApiKeyMask && (
                      <span className="font-mono text-[11px] text-emerald-400">
                        Actuelle : {smtpStatus.brevoApiKeyMask}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type={showBrevoKey ? 'text' : 'password'}
                      value={brevoKeyInput}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBrevoKeyInput(v);
                        if (v.trim() && smtpEdit.enabled === undefined && !smtpStatus?.enabled) {
                          setSmtpEdit((prev) => ({ ...prev, enabled: true }));
                        }
                      }}
                      placeholder={
                        smtpStatus?.brevoApiKeyConfigured
                          ? 'Laisser vide pour conserver la clé Brevo actuelle'
                          : 'xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxx'
                      }
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBrevoKey((v) => !v)}
                      aria-label={showBrevoKey ? 'Masquer' : 'Afficher'}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
                    >
                      {showBrevoKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Utilisez une clé API v3 commençant par <code className="font-mono text-primary">xkeysib-…</code> (pas la clé SMTP <code className="font-mono">xsmtpsib-…</code>). L’adresse d’expéditeur ci-dessous doit être validée dans Brevo (Expéditeurs & IP).
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-foreground">Nom d’expéditeur</span>
                <input
                  value={mergedSmtp.fromName}
                  onChange={(e) =>
                    setSmtpEdit((prev) => ({ ...prev, fromName: e.target.value }))
                  }
                  placeholder={siteName}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block font-medium text-foreground">Email d’expéditeur</span>
                <input
                  type="email"
                  required={mergedSmtp.enabled}
                  value={mergedSmtp.fromEmail}
                  onChange={(e) =>
                    setSmtpEdit((prev) => ({ ...prev, fromEmail: e.target.value }))
                  }
                  placeholder="noreply@votredomaine.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-1">
              {(mergedSmtp.provider || 'smtp') === 'smtp' && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={mergedSmtp.secure}
                    onChange={(e) =>
                      setSmtpEdit((prev) => ({ ...prev, secure: e.target.checked }))
                    }
                    className="size-4 accent-primary"
                  />
                  <span>Connexion chiffrée SSL/TLS directe (port 465)</span>
                </label>
              )}

              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={mergedSmtp.requireSignupConfirmation}
                  onChange={(e) =>
                    setSmtpEdit((prev) => ({
                      ...prev,
                      requireSignupConfirmation: e.target.checked,
                    }))
                  }
                  className="size-4 accent-primary"
                />
                <span>Exiger la confirmation par email lors de l’inscription</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
              <button
                type="submit"
                disabled={saveSmtpMutation.isPending}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {saveSmtpMutation.isPending ? 'Enregistrement…' : 'Enregistrer la configuration'}
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="email"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  placeholder="Email de test…"
                  className="w-56 rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  disabled={testSmtpMutation.isPending || !testEmailTo.includes('@')}
                  onClick={() => testSmtpMutation.mutate(testEmailTo.trim())}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Send className="size-3.5 text-primary" />
                  <span>{testSmtpMutation.isPending ? 'Envoi…' : 'Enregistrer & Tester'}</span>
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* SUBTAB 2: EDITABLE EMAIL TEMPLATES */}
      {subTab === 'templates' && (
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="mb-5 border-b border-border pb-4">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Templates des emails transactionnels
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Personnalisez le sujet, le titre, le contenu et le bouton de chaque email envoyé automatiquement aux membres.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Template selector list */}
            <aside className="space-y-1.5 lg:col-span-4">
              {(templatesQuery.data?.templates ?? []).map((tpl) => {
                const active = tpl.key === (selectedTemplate?.key ?? selectedKey);
                return (
                  <button
                    key={tpl.key}
                    type="button"
                    onClick={() => setSelectedKey(tpl.key)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? 'border-primary bg-accent'
                        : 'border-border bg-background hover:bg-accent/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">{tpl.label}</span>
                      <span
                        className={`text-[11px] font-medium ${
                          tpl.enabled ? 'text-emerald-400' : 'text-muted-foreground'
                        }`}
                      >
                        {tpl.enabled ? 'Actif' : 'Désactivé'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {tpl.description}
                    </p>
                  </button>
                );
              })}
            </aside>

            {/* Editor & Live Preview */}
            <div className="space-y-5 lg:col-span-8">
              {selectedTemplate && tplDraft ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display text-lg font-semibold text-foreground">
                        {selectedTemplate.label}
                      </h3>
                      <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
                    </div>

                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground">
                      <input
                        type="checkbox"
                        checked={tplDraft.enabled}
                        onChange={(e) =>
                          setTplDraft((prev) =>
                            prev ? { ...prev, enabled: e.target.checked } : prev
                          )
                        }
                        className="size-4 accent-primary"
                      />
                      <span>Envoi actif</span>
                    </label>
                  </div>

                  {/* Variables bar */}
                  <div className="rounded-lg border border-border bg-background/60 p-3">
                    <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                      Variables disponibles (cliquez pour insérer dans le corps du mail) :
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTemplate.variables.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            setTplDraft((prev) =>
                              prev ? { ...prev, body: `${prev.body} {{${v}}}` } : prev
                            )
                          }
                          className="rounded border border-border bg-card px-2 py-1 font-mono text-[11px] text-primary hover:bg-accent"
                        >
                          {`{{${v}}}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveTemplateMutation.mutate({
                        key: selectedTemplate.key,
                        patch: tplDraft,
                      });
                    }}
                    className="space-y-4"
                  >
                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-foreground">Sujet de l’email</span>
                      <input
                        required
                        value={tplDraft.subject}
                        onChange={(e) =>
                          setTplDraft((prev) =>
                            prev ? { ...prev, subject: e.target.value } : prev
                          )
                        }
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                      />
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-xs">
                        <span className="mb-1 block font-medium text-foreground">Titre principal dans le mail</span>
                        <input
                          required
                          value={tplDraft.heading}
                          onChange={(e) =>
                            setTplDraft((prev) =>
                              prev ? { ...prev, heading: e.target.value } : prev
                            )
                          }
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                        />
                      </label>

                      <label className="block text-xs">
                        <span className="mb-1 block font-medium text-foreground">Texte du bouton (optionnel)</span>
                        <input
                          value={tplDraft.ctaLabel}
                          onChange={(e) =>
                            setTplDraft((prev) =>
                              prev ? { ...prev, ctaLabel: e.target.value } : prev
                            )
                          }
                          placeholder="Laisser vide pour masquer le bouton"
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                        />
                      </label>
                    </div>

                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-foreground">Contenu du message</span>
                      <textarea
                        required
                        rows={6}
                        value={tplDraft.body}
                        onChange={(e) =>
                          setTplDraft((prev) =>
                            prev ? { ...prev, body: e.target.value } : prev
                          )
                        }
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground focus:border-primary focus:outline-none"
                      />
                    </label>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={saveTemplateMutation.isPending}
                          className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          {saveTemplateMutation.isPending ? 'Enregistrement…' : 'Enregistrer le template'}
                        </button>

                        <button
                          type="button"
                          disabled={resetTemplateMutation.isPending}
                          onClick={() => resetTemplateMutation.mutate(selectedTemplate.key)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          <RotateCcw className="size-3.5" />
                          <span>Réinitialiser</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="email"
                          value={testEmailTo}
                          onChange={(e) => setTestEmailTo(e.target.value)}
                          placeholder="Email de test…"
                          className="w-48 rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={testTemplateMutation.isPending || !testEmailTo.includes('@')}
                          onClick={() =>
                            testTemplateMutation.mutate({
                              key: selectedTemplate.key,
                              to: testEmailTo.trim(),
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50 whitespace-nowrap"
                        >
                          <Send className="size-3.5 text-primary" />
                          <span>Tester ce template</span>
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Live Preview */}
                  <div className="rounded-xl border border-border bg-[#0f121a] p-5 text-gray-100">
                    <p className="mb-3 text-[11px] font-medium text-gray-400">
                      Aperçu du rendu · Sujet :{' '}
                      <span className="text-gray-200">
                        {renderPreviewText(tplDraft.subject, siteName)}
                      </span>
                    </p>
                    <div className="mx-auto max-w-lg rounded-xl border border-[#283044] bg-[#171c28] p-6">
                      <p className="text-lg font-bold text-white">{siteName}</p>
                      <h4 className="mt-3 text-base font-semibold text-white">
                        {renderPreviewText(tplDraft.heading, siteName)}
                      </h4>
                      <div className="mt-3 space-y-2.5 text-xs leading-relaxed text-gray-300 whitespace-pre-line">
                        {renderPreviewText(tplDraft.body, siteName)}
                      </div>
                      {['signup_verify', 'email_change', 'password_change', 'password_reset'].includes(
                        selectedTemplate.key
                      ) &&
                        !tplDraft.body.includes('{{code}}') && (
                          <div className="my-4 rounded-lg border border-gray-700 bg-[#090b10] p-4 text-center">
                            <div className="text-[10px] tracking-widest uppercase text-gray-400">
                              Code de vérification
                            </div>
                            <div className="mt-1 font-mono text-2xl font-bold tracking-[0.4em] text-[#e6a82e]">
                              482915
                            </div>
                            <div className="mt-1 text-[10px] text-gray-400">
                              Valable pendant 15 minutes
                            </div>
                          </div>
                        )}
                      {tplDraft.ctaLabel.trim() &&
                        !['signup_verify', 'email_change', 'password_change', 'password_reset'].includes(
                          selectedTemplate.key
                        ) && (
                        <div className="mt-5">
                          <span className="inline-block rounded-lg bg-[#e6a82e] px-4 py-2 text-xs font-bold text-[#0f172a]">
                            {renderPreviewText(tplDraft.ctaLabel, siteName)}
                          </span>
                        </div>
                      )}
                      <hr className="my-5 border-[#283044]" />
                      <p className="text-[11px] text-gray-400">
                        Cet email a été envoyé automatiquement par {siteName}.
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Chargement des templates…</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* SUBTAB 3: MAIL LOGS */}
      {subTab === 'logs' && (
        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground tabular-nums">
                Journaux d’envoi des emails ({logs.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                Historique complet des envois (inscription, changement d’email, offres Pro, tests) avec statut réel et message d’erreur détaillé.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin-mail-logs'] })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <RefreshCw className={`size-3.5 ${logsQuery.isFetching ? 'animate-spin' : ''}`} />
                <span>Actualiser</span>
              </button>

              {confirmClearLogs ? (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={clearLogsMutation.isPending}
                    onClick={() => clearLogsMutation.mutate()}
                    className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Confirmer la suppression
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearLogs(false)}
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={logs.length === 0}
                  onClick={() => setConfirmClearLogs(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                  <span>Vider les logs</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="search"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="Filtrer par destinataire, sujet ou erreur…"
              className="h-9 min-w-56 flex-1 rounded-lg border border-input bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <select
              aria-label="Filtrer par statut d'envoi"
              value={logStatusFilter}
              onChange={(e) => setLogStatusFilter(e.target.value as 'all' | 'sent' | 'failed')}
              className="h-9 rounded-lg border border-input bg-background px-3 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="all">Tous les statuts</option>
              <option value="sent">Envoyés uniquement</option>
              <option value="failed">Échoués uniquement</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-background/70 text-muted-foreground">
                <tr>
                  <th className="py-2.5 pr-3 pl-4 font-medium">Date</th>
                  <th className="py-2.5 px-3 font-medium">Destinataire</th>
                  <th className="py-2.5 px-3 font-medium">Type / Sujet</th>
                  <th className="py-2.5 px-3 font-medium">Passerelle</th>
                  <th className="py-2.5 px-3 font-medium">Statut</th>
                  <th className="py-2.5 pr-4 pl-3 text-right font-medium">Latence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      Aucun email enregistré pour le moment.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="align-top hover:bg-accent/30">
                      <td className="py-3 pr-3 pl-4 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-medium text-foreground">{log.to}</p>
                        <p className="text-[11px] text-muted-foreground">De : {log.from}</p>
                      </td>
                      <td className="py-3 px-3 max-w-sm">
                        <p className="font-medium text-foreground truncate">{log.subject}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {TEMPLATE_LABELS[log.templateKey] ?? log.templateKey}
                          {log.providerMessageId ? ` · ID: ${log.providerMessageId}` : ''}
                        </p>
                        {log.error && (
                          <p className="mt-1 rounded bg-destructive/10 px-2 py-1 font-mono text-[11px] text-destructive break-words">
                            {log.error}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-3 uppercase font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        {log.provider}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {log.status === 'sent' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                            <CheckCircle2 className="size-3.5" />
                            <span>Envoyé</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                            <XCircle className="size-3.5" />
                            <span>Échoué</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 pl-3 text-right font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                        {log.latencyMs} ms
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
