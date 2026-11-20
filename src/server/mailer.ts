import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { readModuleSnapshot, writeModuleSnapshot } from './persistentDb.ts';
import type {
  AdminSmtpSettings,
  AdminSmtpStatus,
  EmailProvider,
  EmailTemplateConfig,
  EmailTemplateKey,
  MailLogEntry,
} from '../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const MAIL_FILE = path.join(DATA_DIR, 'tapenaka-mail.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'tapenaka-mail-templates.json');
const LOGS_FILE = path.join(DATA_DIR, 'tapenaka-mail-logs.json');

interface StoredMailConfig {
  provider: EmailProvider;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  resendApiKey: string;
  brevoApiKey: string;
  fromName: string;
  fromEmail: string;
  requireSignupConfirmation: boolean;
}

let resolveSiteNameFn: () => Promise<string> = async () => 'StreamWall';

export function setMailSiteNameResolver(fn: () => Promise<string>): void {
  resolveSiteNameFn = fn;
}

async function getActiveSiteName(): Promise<string> {
  try {
    const name = (await resolveSiteNameFn()).trim();
    return name || 'StreamWall';
  } catch {
    return 'StreamWall';
  }
}

function defaultMailConfig(): StoredMailConfig {
  const envResend = (process.env.RESEND_API_KEY || '').trim();
  const envBrevo = (process.env.BREVO_API_KEY || '').trim();
  const envSmtp = (process.env.SMTP_HOST || '').trim();
  const provider: EmailProvider = envResend ? 'resend' : envBrevo ? 'brevo' : 'smtp';
  return {
    provider,
    enabled: Boolean(envSmtp || envResend || envBrevo),
    host: envSmtp,
    port: Math.max(1, Math.min(65535, Number(process.env.SMTP_PORT) || 587)),
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    user: (process.env.SMTP_USER || '').trim(),
    pass: (process.env.SMTP_PASS || '').trim(),
    resendApiKey: envResend,
    brevoApiKey: envBrevo,
    fromName: (process.env.SMTP_FROM_NAME || 'StreamWall').trim(),
    fromEmail: (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '').trim(),
    requireSignupConfirmation: true,
  };
}

function normalizeProvider(val: unknown, fallback: EmailProvider): EmailProvider {
  if (val === 'smtp' || val === 'resend' || val === 'brevo') return val;
  return fallback;
}

function loadMailConfig(): StoredMailConfig {
  const parsed = readModuleSnapshot<Partial<StoredMailConfig>>('mail_config', MAIL_FILE);
  if (parsed) {
    const base = defaultMailConfig();
    return {
      provider: normalizeProvider(parsed.provider, base.provider),
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
      host: typeof parsed.host === 'string' ? parsed.host : base.host,
      port:
        typeof parsed.port === 'number' && parsed.port > 0 && parsed.port <= 65535
          ? parsed.port
          : base.port,
      secure: typeof parsed.secure === 'boolean' ? parsed.secure : base.secure,
      user: typeof parsed.user === 'string' ? parsed.user : base.user,
      pass: typeof parsed.pass === 'string' ? parsed.pass : base.pass,
      resendApiKey: typeof parsed.resendApiKey === 'string' ? parsed.resendApiKey : base.resendApiKey,
      brevoApiKey: typeof parsed.brevoApiKey === 'string' ? parsed.brevoApiKey : base.brevoApiKey,
      fromName: typeof parsed.fromName === 'string' && parsed.fromName ? parsed.fromName : base.fromName,
      fromEmail: typeof parsed.fromEmail === 'string' ? parsed.fromEmail : base.fromEmail,
      requireSignupConfirmation: Boolean(parsed.requireSignupConfirmation),
    };
  }
  return defaultMailConfig();
}

function saveMailConfig(cfg: StoredMailConfig): void {
  writeModuleSnapshot('mail_config', cfg);
}

let mailConfig: StoredMailConfig = loadMailConfig();

// ───────────────────────────────────────────────────────────────────────────
// EDITABLE EMAIL TEMPLATES
// ───────────────────────────────────────────────────────────────────────────
export const EMAIL_TEMPLATE_KEYS: EmailTemplateKey[] = [
  'signup_welcome',
  'signup_verify',
  'email_change',
  'password_change',
  'subscription_activated',
  'subscription_expired',
  'password_reset',
];

function buildDefaultTemplates(): Record<EmailTemplateKey, EmailTemplateConfig> {
  const now = new Date().toISOString();
  return {
    signup_welcome: {
      key: 'signup_welcome',
      label: 'Mail d’inscription (Bienvenue)',
      description: 'Envoyé automatiquement après l’inscription (ou après confirmation du compte).',
      subject: 'Bienvenue sur {{site_name}}, {{username}} !',
      heading: 'Bienvenue sur {{site_name}} !',
      body: `Bonjour {{username}},

Votre compte membre ({{email}}) est maintenant actif sur {{site_name}}.
Vous pouvez dès maintenant enregistrer vos favoris, reprendre vos lectures et participer aux commentaires.`,
      ctaLabel: 'Accéder à {{site_name}}',
      enabled: true,
      variables: ['username', 'email', 'site_name', 'app_url'],
      updatedAt: now,
    },
    signup_verify: {
      key: 'signup_verify',
      label: 'Mail d’inscription (Code à 6 chiffres)',
      description: 'Envoyé avec le code à 6 chiffres pour confirmer l’inscription.',
      subject: 'Votre code de confirmation {{site_name}} : {{code}}',
      heading: 'Confirmez votre adresse email',
      body: `Bonjour {{username}},

Merci pour votre inscription sur {{site_name}} avec l’adresse {{email}}.
Saisissez ce code de vérification à 6 chiffres (valable 15 minutes) pour activer votre compte :`,
      ctaLabel: '',
      enabled: true,
      variables: ['code', 'username', 'email', 'site_name'],
      updatedAt: now,
    },
    email_change: {
      key: 'email_change',
      label: 'Changement d’adresse email (Code à 6 chiffres)',
      description: 'Envoyé vers la nouvelle adresse email avec un code à 6 chiffres pour valider le changement.',
      subject: 'Code changement d’email {{site_name}} : {{code}}',
      heading: 'Confirmez votre nouvelle adresse email',
      body: `Bonjour {{username}},

Vous avez demandé à remplacer votre adresse email ({{old_email}}) par {{email}} sur {{site_name}}.
Saisissez ce code de vérification à 6 chiffres (valable 15 minutes) pour confirmer la modification :`,
      ctaLabel: '',
      enabled: true,
      variables: ['code', 'username', 'email', 'old_email', 'site_name'],
      updatedAt: now,
    },
    password_change: {
      key: 'password_change',
      label: 'Changement de mot de passe (Code à 6 chiffres)',
      description: 'Envoyé avec un code à 6 chiffres lorsqu’un membre modifie son mot de passe depuis son tableau de bord.',
      subject: 'Code changement de mot de passe {{site_name}} : {{code}}',
      heading: 'Confirmez votre changement de mot de passe',
      body: `Bonjour {{username}},

Vous avez demandé à modifier le mot de passe de votre compte {{site_name}} ({{email}}).
Saisissez ce code de vérification à 6 chiffres (valable 15 minutes) pour valider votre nouveau mot de passe :`,
      ctaLabel: '',
      enabled: true,
      variables: ['code', 'username', 'email', 'site_name'],
      updatedAt: now,
    },
    subscription_activated: {
      key: 'subscription_activated',
      label: 'Souscription à une offre',
      description: 'Envoyé lorsqu’une offre Pro est activée (paiement auto, manuel ou attribution admin).',
      subject: 'Votre offre {{plan_name}} est activée — {{site_name}}',
      heading: 'Offre {{plan_name}} activée !',
      body: `Bonjour {{username}},

Félicitations ! Votre abonnement {{plan_name}} est maintenant actif sur {{site_name}}.
Validité : {{expires_at}}.

Profitez dès maintenant du lecteur Pro, de votre couronne dorée et de tous les avantages de votre offre.`,
      ctaLabel: 'Profiter de mon accès Pro',
      enabled: true,
      variables: ['username', 'email', 'plan_name', 'expires_at', 'site_name', 'app_url'],
      updatedAt: now,
    },
    subscription_expired: {
      key: 'subscription_expired',
      label: 'Offre expirée',
      description: 'Envoyé automatiquement lorsque la durée de l’offre Pro arrive à expiration.',
      subject: 'Votre offre {{plan_name}} a expiré — {{site_name}}',
      heading: 'Votre offre {{plan_name}} est arrivée à expiration',
      body: `Bonjour {{username}},

Votre abonnement {{plan_name}} a expiré le {{expired_at}}. Votre compte est repassé automatiquement sur l’offre Basic (Gratuit).
Vous pouvez renouveler votre accès Pro à tout moment en un clic.`,
      ctaLabel: 'Renouveler mon offre Pro',
      enabled: true,
      variables: ['username', 'email', 'plan_name', 'expired_at', 'renew_url', 'site_name'],
      updatedAt: now,
    },
    password_reset: {
      key: 'password_reset',
      label: 'Mot de passe oublié (Code à 6 chiffres)',
      description: 'Envoyé avec un code à 6 chiffres lors d’une demande de réinitialisation de mot de passe.',
      subject: 'Code de réinitialisation {{site_name}} : {{code}}',
      heading: 'Réinitialisation du mot de passe',
      body: `Bonjour {{username}},

Vous avez demandé à réinitialiser le mot de passe de votre compte {{site_name}} ({{email}}).
Saisissez ce code de vérification à 6 chiffres (valable 15 minutes) pour choisir un nouveau mot de passe :`,
      ctaLabel: '',
      enabled: true,
      variables: ['code', 'username', 'email', 'site_name'],
      updatedAt: now,
    },
  };
}

function loadTemplates(): Record<EmailTemplateKey, EmailTemplateConfig> {
  const defaults = buildDefaultTemplates();
  let migrated = false;
  const parsed = readModuleSnapshot<
    Partial<Record<EmailTemplateKey, Partial<EmailTemplateConfig>>>
  >('mail_templates', TEMPLATES_FILE);
  if (parsed) {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const custom = parsed?.[key];
      if (!custom) continue;

      if (key === 'password_reset' && typeof custom.body === 'string' && !custom.body.includes('{{code}}') && (custom.ctaLabel === 'Choisir un nouveau mot de passe' || custom.body.includes('Cliquez sur le bouton'))) {
        migrated = true;
        continue;
      }
      if (key === 'email_change' && typeof custom.body === 'string' && !custom.body.includes('{{code}}') && custom.ctaLabel === 'Ouvrir mon profil') {
        migrated = true;
        continue;
      }

      defaults[key] = {
        ...defaults[key],
        subject: typeof custom.subject === 'string' && custom.subject.trim() ? custom.subject : defaults[key].subject,
        heading: typeof custom.heading === 'string' && custom.heading.trim() ? custom.heading : defaults[key].heading,
        body: typeof custom.body === 'string' && custom.body.trim() ? custom.body : defaults[key].body,
        ctaLabel: typeof custom.ctaLabel === 'string' ? custom.ctaLabel : defaults[key].ctaLabel,
        enabled: typeof custom.enabled === 'boolean' ? custom.enabled : defaults[key].enabled,
        updatedAt: typeof custom.updatedAt === 'string' ? custom.updatedAt : defaults[key].updatedAt,
      };
    }
    if (migrated) saveTemplates(defaults);
  }
  return defaults;
}

function saveTemplates(map: Record<EmailTemplateKey, EmailTemplateConfig>): void {
  writeModuleSnapshot('mail_templates', map);
}

let emailTemplates: Record<EmailTemplateKey, EmailTemplateConfig> = loadTemplates();

export function listEmailTemplates(): EmailTemplateConfig[] {
  return EMAIL_TEMPLATE_KEYS.map((k) => emailTemplates[k]);
}

export function getEmailTemplate(key: EmailTemplateKey): EmailTemplateConfig {
  return emailTemplates[key];
}

export function updateEmailTemplate(
  key: EmailTemplateKey,
  patch: Partial<Pick<EmailTemplateConfig, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'enabled'>>
): EmailTemplateConfig | null {
  const current = emailTemplates[key];
  if (!current) return null;
  const updated: EmailTemplateConfig = {
    ...current,
    subject:
      typeof patch.subject === 'string' && patch.subject.trim()
        ? patch.subject.trim().slice(0, 180)
        : current.subject,
    heading:
      typeof patch.heading === 'string' && patch.heading.trim()
        ? patch.heading.trim().slice(0, 180)
        : current.heading,
    body:
      typeof patch.body === 'string' && patch.body.trim()
        ? patch.body.trim().slice(0, 4000)
        : current.body,
    ctaLabel:
      typeof patch.ctaLabel === 'string'
        ? patch.ctaLabel.trim().slice(0, 80)
        : current.ctaLabel,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    updatedAt: new Date().toISOString(),
  };
  emailTemplates[key] = updated;
  saveTemplates(emailTemplates);
  return updated;
}

export function resetEmailTemplate(key: EmailTemplateKey): EmailTemplateConfig | null {
  const defaults = buildDefaultTemplates();
  if (!defaults[key]) return null;
  emailTemplates[key] = defaults[key];
  saveTemplates(emailTemplates);
  return emailTemplates[key];
}

// ───────────────────────────────────────────────────────────────────────────
// MAIL SEND LOGS
// ───────────────────────────────────────────────────────────────────────────
function loadMailLogs(): MailLogEntry[] {
  const parsed = readModuleSnapshot<MailLogEntry[]>('mail_logs', LOGS_FILE);
  return Array.isArray(parsed) ? parsed : [];
}

function saveMailLogs(logs: MailLogEntry[]): void {
  writeModuleSnapshot('mail_logs', logs);
}

let mailLogs: MailLogEntry[] = loadMailLogs();

function recordMailLog(entry: Omit<MailLogEntry, 'id' | 'createdAt'>): MailLogEntry {
  const record: MailLogEntry = {
    id: `mlog_${crypto.randomBytes(6).toString('hex')}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };
  mailLogs.unshift(record);
  if (mailLogs.length > 500) {
    mailLogs = mailLogs.slice(0, 500);
  }
  saveMailLogs(mailLogs);
  return record;
}

export function listMailLogs(filters?: { status?: string; q?: string }): MailLogEntry[] {
  const q = (filters?.q || '').trim().toLowerCase();
  const st = filters?.status || 'all';
  return mailLogs.filter((log) => {
    if (st === 'sent' && log.status !== 'sent') return false;
    if (st === 'failed' && log.status !== 'failed') return false;
    if (q) {
      const hay = `${log.to} ${log.subject} ${log.provider} ${log.templateKey} ${log.error || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function clearMailLogs(): void {
  mailLogs = [];
  saveMailLogs(mailLogs);
}

// ───────────────────────────────────────────────────────────────────────────
// SMTP / RESEND / BREVO CONFIG & SENDING
// ───────────────────────────────────────────────────────────────────────────
function maskSecret(val: string): string {
  const s = val.trim();
  if (!s) return '';
  if (s.length <= 6) return '••••••';
  return `${s.slice(0, 3)}••••••${s.slice(-3)}`;
}

function resolveSenderEmail(): string {
  const explicit = mailConfig.fromEmail.trim();
  if (explicit) return explicit;
  if (mailConfig.provider === 'smtp' && mailConfig.user.includes('@')) {
    return mailConfig.user.trim();
  }
  return '';
}

export function isSmtpReady(): boolean {
  if (!mailConfig.enabled) return false;
  const sender = resolveSenderEmail();
  if (!sender || !sender.includes('@')) return false;
  if (mailConfig.provider === 'resend') {
    return Boolean(mailConfig.resendApiKey.trim());
  }
  if (mailConfig.provider === 'brevo') {
    return Boolean(mailConfig.brevoApiKey.trim());
  }
  return Boolean(mailConfig.host.trim());
}

export function shouldRequireSignupConfirmation(): boolean {
  return isSmtpReady() && Boolean(mailConfig.requireSignupConfirmation);
}

export function getAdminSmtpStatus(): AdminSmtpStatus {
  return {
    provider: mailConfig.provider,
    enabled: mailConfig.enabled,
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    user: mailConfig.user,
    passConfigured: Boolean(mailConfig.pass),
    passMask: maskSecret(mailConfig.pass),
    resendApiKeyConfigured: Boolean(mailConfig.resendApiKey),
    resendApiKeyMask: maskSecret(mailConfig.resendApiKey),
    brevoApiKeyConfigured: Boolean(mailConfig.brevoApiKey),
    brevoApiKeyMask: maskSecret(mailConfig.brevoApiKey),
    fromName: mailConfig.fromName || 'StreamWall',
    fromEmail: mailConfig.fromEmail,
    requireSignupConfirmation: mailConfig.requireSignupConfirmation,
  };
}

export function updateAdminSmtpConfig(patch: Partial<AdminSmtpSettings>): AdminSmtpStatus {
  if (patch.provider !== undefined) {
    mailConfig.provider = normalizeProvider(patch.provider, mailConfig.provider);
  }
  if (typeof patch.enabled === 'boolean') {
    mailConfig.enabled = patch.enabled;
  }
  if (typeof patch.host === 'string') {
    mailConfig.host = patch.host.trim().slice(0, 200);
  }
  if (patch.port !== undefined) {
    const p = Number(patch.port);
    if (Number.isFinite(p) && p >= 1 && p <= 65535) {
      mailConfig.port = Math.round(p);
      if (mailConfig.port === 465) mailConfig.secure = true;
      else if (mailConfig.port === 587 || mailConfig.port === 25 || mailConfig.port === 2525) {
        mailConfig.secure = false;
      }
    }
  }
  if (typeof patch.secure === 'boolean') {
    if (mailConfig.port === 465) mailConfig.secure = true;
    else if (mailConfig.port === 587) mailConfig.secure = false;
    else mailConfig.secure = patch.secure;
  }
  if (typeof patch.user === 'string') {
    mailConfig.user = patch.user.trim().slice(0, 200);
  }
  if (patch.clearPass) {
    mailConfig.pass = '';
  } else if (typeof patch.pass === 'string' && patch.pass.trim()) {
    mailConfig.pass = patch.pass.trim().slice(0, 256);
  }
  if (patch.clearResendApiKey) {
    mailConfig.resendApiKey = '';
  } else if (typeof patch.resendApiKey === 'string' && patch.resendApiKey.trim()) {
    mailConfig.resendApiKey = patch.resendApiKey.trim().slice(0, 256);
  }
  if (patch.clearBrevoApiKey) {
    mailConfig.brevoApiKey = '';
  } else if (typeof patch.brevoApiKey === 'string' && patch.brevoApiKey.trim()) {
    mailConfig.brevoApiKey = patch.brevoApiKey.trim().slice(0, 256);
  }
  if (typeof patch.fromName === 'string') {
    mailConfig.fromName = patch.fromName.trim().slice(0, 80) || 'StreamWall';
  }
  if (typeof patch.fromEmail === 'string') {
    mailConfig.fromEmail = patch.fromEmail.trim().slice(0, 200);
  }
  if (typeof patch.requireSignupConfirmation === 'boolean') {
    mailConfig.requireSignupConfirmation = patch.requireSignupConfirmation;
  }

  saveMailConfig(mailConfig);
  return getAdminSmtpStatus();
}

async function sendViaResend(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromAddr: string;
  senderName: string;
}): Promise<{ ok: boolean; error?: string; messageId?: string | null }> {
  const apiKey = mailConfig.resendApiKey.trim();
  if (!apiKey || !params.fromAddr) {
    return { ok: false, error: 'Clé API Resend ou email d’expéditeur manquant.' };
  }
  const cleanName = params.senderName.replace(/[<>"]/g, '');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${cleanName} <${params.fromAddr}>`,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text || params.subject,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const rawText = await res.text().catch(() => '');
  let json: { id?: string; message?: string; error?: string } = {};
  try {
    json = JSON.parse(rawText) as typeof json;
  } catch {
    // Non-JSON response
  }
  if (!res.ok) {
    return {
      ok: false,
      error: json.message || json.error || rawText.slice(0, 240) || `Resend HTTP ${res.status}`,
    };
  }
  return { ok: true, messageId: json.id ?? null };
}

async function sendViaBrevo(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromAddr: string;
  senderName: string;
}): Promise<{ ok: boolean; error?: string; messageId?: string | null }> {
  const apiKey = mailConfig.brevoApiKey.trim();
  if (!apiKey || !params.fromAddr) {
    return { ok: false, error: 'Clé API Brevo ou email d’expéditeur manquant.' };
  }
  if (apiKey.startsWith('xsmtpsib-')) {
    return {
      ok: false,
      error:
        'Vous avez saisi une clé SMTP Brevo (xsmtpsib-…). Pour Brevo API v3, utilisez une clé API v3 (xkeysib-…), ou utilisez cette clé dans « SMTP classique » avec smtp-relay.brevo.com (port 587).',
    };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: params.senderName || 'StreamWall', email: params.fromAddr },
      to: [{ email: params.to }],
      subject: params.subject,
      htmlContent: params.html,
      textContent: params.text || params.subject,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const rawText = await res.text().catch(() => '');
  let json: { messageId?: string; message?: string; code?: string } = {};
  try {
    json = JSON.parse(rawText) as typeof json;
  } catch {
    // Non-JSON response
  }
  if (!res.ok) {
    const msg = [json.code, json.message].filter(Boolean).join(' : ') || rawText.slice(0, 240);
    return {
      ok: false,
      error: msg || `Brevo HTTP ${res.status}`,
    };
  }
  return { ok: true, messageId: json.messageId ?? null };
}

async function sendViaSmtp(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromAddr: string;
  senderName: string;
}): Promise<{ ok: boolean; error?: string; messageId?: string | null }> {
  if (!mailConfig.host.trim()) {
    return { ok: false, error: 'Serveur SMTP (host) manquant.' };
  }
  if (!params.fromAddr || !params.fromAddr.includes('@')) {
    return { ok: false, error: 'Adresse email d’expéditeur invalide ou manquante.' };
  }

  const port = mailConfig.port || 587;
  const useSecure = port === 465 ? true : port === 587 || port === 25 || port === 2525 ? false : mailConfig.secure;

  const transporter = nodemailer.createTransport({
    host: mailConfig.host.trim(),
    port,
    secure: useSecure,
    requireTLS: !useSecure && port === 587,
    ...(mailConfig.user
      ? {
          auth: {
            user: mailConfig.user.trim(),
            pass: mailConfig.pass,
          },
        }
      : {}),
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: false,
    },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 15_000,
  });

  const cleanName = params.senderName.replace(/"/g, '');
  const info = await transporter.sendMail({
    from: `"${cleanName}" <${params.fromAddr}>`,
    to: params.to,
    subject: params.subject,
    text: params.text || params.subject,
    html: params.html,
  });

  return { ok: true, messageId: info.messageId ?? null };
}

export async function sendMail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  templateKey?: EmailTemplateKey | 'test' | 'custom';
}): Promise<{ ok: boolean; error?: string }> {
  const started = Date.now();
  const templateKey = params.templateKey ?? 'custom';
  const fromAddr = resolveSenderEmail();
  const senderName = mailConfig.fromName || (await getActiveSiteName());

  if (!isSmtpReady()) {
    const errMsg = !mailConfig.enabled
      ? 'L’envoi d’emails est désactivé dans la configuration.'
      : !fromAddr || !fromAddr.includes('@')
        ? 'Adresse email d’expéditeur manquante ou invalide.'
        : 'Service email (SMTP / Resend / Brevo) incomplet dans l’administration.';

    if (mailConfig.enabled || templateKey === 'test') {
      recordMailLog({
        to: params.to,
        from: fromAddr || 'non configuré',
        provider: mailConfig.provider,
        templateKey,
        subject: params.subject,
        status: 'failed',
        error: errMsg,
        providerMessageId: null,
        latencyMs: Date.now() - started,
      });
    }
    return { ok: false, error: errMsg };
  }

  let outcome: { ok: boolean; error?: string; messageId?: string | null };
  try {
    if (mailConfig.provider === 'resend') {
      outcome = await sendViaResend({ ...params, fromAddr, senderName });
    } else if (mailConfig.provider === 'brevo') {
      outcome = await sendViaBrevo({ ...params, fromAddr, senderName });
    } else {
      outcome = await sendViaSmtp({ ...params, fromAddr, senderName });
    }
  } catch (err) {
    const e = err as Error & { code?: string; responseCode?: number; response?: string };
    const extra = [e.code, e.responseCode ? `SMTP ${e.responseCode}` : '', e.response]
      .filter(Boolean)
      .join(' · ');
    outcome = {
      ok: false,
      error: extra ? `${e.message} (${extra})` : e.message || 'Erreur lors de l’envoi de l’email.',
    };
  }

  recordMailLog({
    to: params.to,
    from: fromAddr,
    provider: mailConfig.provider,
    templateKey,
    subject: params.subject,
    status: outcome.ok ? 'sent' : 'failed',
    error: outcome.ok ? null : outcome.error || 'Erreur inconnue',
    providerMessageId: outcome.messageId ?? null,
    latencyMs: Date.now() - started,
  });

  return { ok: outcome.ok, error: outcome.error };
}

// ───────────────────────────────────────────────────────────────────────────
// TEMPLATE RENDERING & TRANSACTIONAL HELPERS
// ───────────────────────────────────────────────────────────────────────────
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function interpolateTemplate(
  raw: string,
  vars: Record<string, string>,
  options?: { htmlEscapeValues?: boolean }
): string {
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const val = vars[key] ?? '';
    return options?.htmlEscapeValues ? escapeHtml(val) : val;
  });
}

function formatBodyParagraphs(interpolatedText: string): string {
  const blocks = interpolatedText
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map(
      (b) =>
        `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#d1d5db;">${escapeHtml(b).replace(/\n/g, '<br/>')}</p>`
    )
    .join('');
}

function wrapEmailHtml(siteName: string, title: string, bodyHtml: string): string {
  const safeSite = escapeHtml(siteName || 'StreamWall');
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background:#0f121a;color:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:540px;margin:0 auto;background:#171c28;border:1px solid #283044;border-radius:12px;padding:28px;">
    <p style="margin:0 0 18px;font-size:20px;font-weight:700;color:#ffffff;">${safeSite}</p>
    <h1 style="margin:0 0 14px;font-size:18px;color:#ffffff;">${escapeHtml(title)}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #283044;margin:24px 0 16px;" />
    <p style="margin:0;font-size:12px;color:#9ca3af;">Cet email a été envoyé automatiquement par ${safeSite}.</p>
  </div>
</body>
</html>`;
}

async function renderTemplateContent(
  key: EmailTemplateKey,
  vars: Record<string, string>,
  ctaUrl?: string,
  extraFooterHtml?: string
): Promise<{ enabled: boolean; subject: string; html: string; text: string }> {
  const tpl = getEmailTemplate(key);
  const siteName = vars.site_name || (await getActiveSiteName());
  const allVars: Record<string, string> = {
    ...vars,
    site_name: siteName,
  };

  const subject = interpolateTemplate(tpl.subject, allVars);
  const heading = interpolateTemplate(tpl.heading, allVars);
  const bodyPlain = interpolateTemplate(tpl.body, allVars);
  const ctaLabel = interpolateTemplate(tpl.ctaLabel, allVars);

  let bodyHtml = formatBodyParagraphs(bodyPlain);
  let text = `${heading}\n\n${bodyPlain}`;

  if (ctaUrl && ctaLabel) {
    const safeUrl = escapeHtml(ctaUrl);
    bodyHtml += `<p style="margin:22px 0;">
      <a href="${safeUrl}" style="display:inline-block;background:#e6a82e;color:#0f172a;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">${escapeHtml(ctaLabel)}</a>
    </p>`;
    text += `\n\n${ctaLabel} : ${ctaUrl}`;
  }

  if (extraFooterHtml) {
    bodyHtml += extraFooterHtml;
  }

  return {
    enabled: tpl.enabled,
    subject,
    html: wrapEmailHtml(siteName, heading, bodyHtml),
    text,
  };
}

function buildCodeBoxHtml(code: string): string {
  return `<div style="margin:20px 0;padding:18px;border-radius:10px;background:#090b10;border:1px solid #374151;text-align:center;">
        <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">Code de vérification</div>
        <div style="font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#e6a82e;">${escapeHtml(code)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:8px;">Valable pendant 15 minutes</div>
      </div>`;
}

async function sendCodeVerificationEmail(params: {
  templateKey: EmailTemplateKey;
  to: string;
  code: string;
  vars: Record<string, string>;
}): Promise<{ ok: boolean; error?: string }> {
  const code = String(params.code).trim();
  const tpl = getEmailTemplate(params.templateKey);
  const extraHtml = !tpl.body.includes('{{code}}') ? buildCodeBoxHtml(code) : undefined;
  const rendered = await renderTemplateContent(
    params.templateKey,
    {
      ...params.vars,
      code,
      email: params.to,
    },
    undefined,
    extraHtml
  );
  if (!rendered.enabled) return { ok: true };
  const textWithCode = rendered.text.includes(code)
    ? rendered.text
    : `${rendered.text}\n\nCode de vérification : ${code} (valable 15 minutes)`;
  return sendMail({
    to: params.to,
    subject: rendered.subject,
    text: textWithCode,
    html: rendered.html,
    templateKey: params.templateKey,
  });
}

export async function sendSignupVerificationEmail(params: {
  to: string;
  username: string;
  code?: string;
  verifyUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const code = params.code ? String(params.code).trim() : '';
  return sendCodeVerificationEmail({
    templateKey: 'signup_verify',
    to: params.to,
    code,
    vars: {
      username: params.username,
      verify_url: params.verifyUrl || '',
    },
  });
}

export async function sendWelcomeEmail(params: {
  to: string;
  username: string;
  appUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const rendered = await renderTemplateContent(
    'signup_welcome',
    {
      username: params.username,
      email: params.to,
      app_url: params.appUrl,
    },
    params.appUrl || undefined
  );
  if (!rendered.enabled) return { ok: true };
  return sendMail({
    to: params.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateKey: 'signup_welcome',
  });
}

export async function sendEmailChangeVerificationEmail(params: {
  to: string;
  username: string;
  oldEmail?: string;
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  return sendCodeVerificationEmail({
    templateKey: 'email_change',
    to: params.to,
    code: params.code,
    vars: {
      username: params.username,
      old_email: params.oldEmail || '',
    },
  });
}

export async function sendPasswordChangeVerificationEmail(params: {
  to: string;
  username: string;
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  return sendCodeVerificationEmail({
    templateKey: 'password_change',
    to: params.to,
    code: params.code,
    vars: {
      username: params.username,
    },
  });
}

export async function sendSubscriptionActivatedEmail(params: {
  to: string;
  username: string;
  planName: string;
  expiresAt: string | null;
  appUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const expiresLabel = params.expiresAt
    ? `jusqu’au ${new Date(params.expiresAt).toLocaleDateString('fr-FR')}`
    : 'Durée illimitée';
  const rendered = await renderTemplateContent(
    'subscription_activated',
    {
      username: params.username,
      email: params.to,
      plan_name: params.planName,
      expires_at: expiresLabel,
      app_url: params.appUrl || '',
    },
    params.appUrl || undefined
  );
  if (!rendered.enabled) return { ok: true };
  return sendMail({
    to: params.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateKey: 'subscription_activated',
  });
}

export async function sendSubscriptionExpiredEmail(params: {
  to: string;
  username: string;
  planName: string;
  expiredAt: string;
  renewUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const expiredLabel = new Date(params.expiredAt).toLocaleDateString('fr-FR');
  const rendered = await renderTemplateContent(
    'subscription_expired',
    {
      username: params.username,
      email: params.to,
      plan_name: params.planName,
      expired_at: expiredLabel,
      renew_url: params.renewUrl || '',
    },
    params.renewUrl || undefined
  );
  if (!rendered.enabled) return { ok: true };
  return sendMail({
    to: params.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateKey: 'subscription_expired',
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  username?: string;
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  return sendCodeVerificationEmail({
    templateKey: 'password_reset',
    to: params.to,
    code: params.code,
    vars: {
      username: params.username || params.to.split('@')[0] || 'Membre',
    },
  });
}

export async function sendTemplateTestEmail(params: {
  to: string;
  templateKey: EmailTemplateKey;
  appUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = (params.appUrl || 'https://exemple.com').replace(/\/+$/, '');
  const codeTemplates: EmailTemplateKey[] = [
    'signup_verify',
    'email_change',
    'password_change',
    'password_reset',
  ];
  const sampleCode = '482915';
  const sampleVars: Record<string, string> = {
    code: sampleCode,
    username: 'TestMembre',
    email: params.to,
    old_email: 'ancien@exemple.com',
    app_url: baseUrl,
    plan_name: 'Pro Mensuel',
    expires_at: `jusqu’au ${new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('fr-FR')}`,
    expired_at: new Date().toLocaleDateString('fr-FR'),
    renew_url: `${baseUrl}/abonnement`,
  };
  const isCodeTpl = codeTemplates.includes(params.templateKey);
  const tpl = getEmailTemplate(params.templateKey);
  const extraHtml = isCodeTpl && !tpl.body.includes('{{code}}') ? buildCodeBoxHtml(sampleCode) : undefined;
  const rendered = await renderTemplateContent(
    params.templateKey,
    sampleVars,
    isCodeTpl ? undefined : baseUrl,
    extraHtml
  );
  return sendMail({
    to: params.to,
    subject: `[TEST] ${rendered.subject}`,
    text: rendered.text,
    html: rendered.html,
    templateKey: params.templateKey,
  });
}

export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const siteName = await getActiveSiteName();
  const providerLabel =
    mailConfig.provider === 'resend'
      ? 'Resend API'
      : mailConfig.provider === 'brevo'
        ? 'Brevo API'
        : 'SMTP';
  const html = wrapEmailHtml(
    siteName,
    `Test ${providerLabel} réussi`,
    `<p style="font-size:14px;line-height:1.6;color:#d1d5db;">Cet email confirme que la passerelle <strong>${providerLabel}</strong> configurée dans l’administration ${escapeHtml(siteName)} fonctionne correctement.</p>`
  );
  return sendMail({
    to,
    subject: `Test ${providerLabel} — ${siteName}`,
    text: `Test de configuration ${providerLabel} ${siteName} réussi.`,
    html,
    templateKey: 'test',
  });
}
