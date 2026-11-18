import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import type { AdminSmtpSettings, AdminSmtpStatus, EmailProvider } from '../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const MAIL_FILE = path.join(DATA_DIR, 'tapenaka-mail.json');

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
    requireSignupConfirmation: false,
  };
}

function normalizeProvider(val: unknown, fallback: EmailProvider): EmailProvider {
  if (val === 'smtp' || val === 'resend' || val === 'brevo') return val;
  return fallback;
}

function loadMailConfig(): StoredMailConfig {
  try {
    if (fs.existsSync(MAIL_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf-8')) as Partial<StoredMailConfig>;
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
  } catch {
    // Fallback to env defaults
  }
  return defaultMailConfig();
}

function saveMailConfig(cfg: StoredMailConfig): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MAIL_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch {
    // Ignore write failures
  }
}

let mailConfig: StoredMailConfig = loadMailConfig();

function maskSecret(val: string): string {
  const s = val.trim();
  if (!s) return '';
  if (s.length <= 6) return '••••••';
  return `${s.slice(0, 3)}••••••${s.slice(-3)}`;
}

export function isSmtpReady(): boolean {
  if (!mailConfig.enabled) return false;
  if (mailConfig.provider === 'resend') {
    return Boolean(mailConfig.resendApiKey.trim() && mailConfig.fromEmail.trim());
  }
  if (mailConfig.provider === 'brevo') {
    return Boolean(mailConfig.brevoApiKey.trim() && mailConfig.fromEmail.trim());
  }
  return Boolean(mailConfig.host.trim() && (mailConfig.fromEmail.trim() || mailConfig.user.trim()));
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
    }
  }
  if (typeof patch.secure === 'boolean') {
    mailConfig.secure = patch.secure;
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
}): Promise<{ ok: boolean; error?: string }> {
  const fromAddr = mailConfig.fromEmail.trim();
  const senderName = (mailConfig.fromName || 'StreamWall').replace(/[<>"]/g, '');
  if (!mailConfig.resendApiKey.trim() || !fromAddr) {
    return { ok: false, error: 'Clé API Resend ou email d’expéditeur manquant.' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mailConfig.resendApiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${senderName} <${fromAddr}>`,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: json.message || json.error || `Resend HTTP ${res.status}`,
    };
  }
  return { ok: true };
}

async function sendViaBrevo(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const fromAddr = mailConfig.fromEmail.trim();
  const senderName = (mailConfig.fromName || 'StreamWall').trim();
  if (!mailConfig.brevoApiKey.trim() || !fromAddr) {
    return { ok: false, error: 'Clé API Brevo ou email d’expéditeur manquant.' };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': mailConfig.brevoApiKey.trim(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: senderName, email: fromAddr },
      to: [{ email: params.to }],
      subject: params.subject,
      htmlContent: params.html,
      textContent: params.text,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: json.message || json.code || `Brevo HTTP ${res.status}`,
    };
  }
  return { ok: true };
}

export async function sendMail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpReady()) {
    return {
      ok: false,
      error: 'Service email (SMTP / Resend / Brevo) non configuré ou désactivé dans l’administration.',
    };
  }

  try {
    if (mailConfig.provider === 'resend') {
      return await sendViaResend(params);
    }
    if (mailConfig.provider === 'brevo') {
      return await sendViaBrevo(params);
    }

    const transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.secure,
      ...(mailConfig.user
        ? {
            auth: {
              user: mailConfig.user,
              pass: mailConfig.pass,
            },
          }
        : {}),
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 15_000,
    });

    const fromAddr = mailConfig.fromEmail || mailConfig.user;
    const senderName = (mailConfig.fromName || 'StreamWall').replace(/"/g, '');
    await transporter.sendMail({
      from: `"${senderName}" <${fromAddr}>`,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erreur lors de l’envoi de l’email.',
    };
  }
}

function wrapEmailHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background:#0f121a;color:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:540px;margin:0 auto;background:#171c28;border:1px solid #283044;border-radius:12px;padding:28px;">
    <p style="margin:0 0 18px;font-size:20px;font-weight:700;color:#ffffff;">Stream<span style="color:#e6a82e;">Wall</span></p>
    <h1 style="margin:0 0 14px;font-size:18px;color:#ffffff;">${title}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #283044;margin:24px 0 16px;" />
    <p style="margin:0;font-size:12px;color:#9ca3af;">Cet email a été envoyé automatiquement par StreamWall.</p>
  </div>
</body>
</html>`;
}

export async function sendSignupVerificationEmail(params: {
  to: string;
  username: string;
  verifyUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const safeName = params.username.replace(/[<>&"]/g, '');
  const html = wrapEmailHtml(
    'Confirmez votre inscription',
    `<p style="font-size:14px;line-height:1.6;color:#d1d5db;">Bonjour <strong>${safeName}</strong>,</p>
     <p style="font-size:14px;line-height:1.6;color:#d1d5db;">Cliquez sur le bouton ci-dessous pour activer votre compte StreamWall :</p>
     <p style="margin:22px 0;">
       <a href="${params.verifyUrl}" style="display:inline-block;background:#e6a82e;color:#0f172a;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">Confirmer mon adresse email</a>
     </p>
     <p style="font-size:12px;color:#9ca3af;word-break:break-all;">Si le bouton ne s’ouvre pas, copiez ce lien :<br/>${params.verifyUrl}</p>`
  );
  return sendMail({
    to: params.to,
    subject: 'Confirmez votre inscription sur StreamWall',
    text: `Bonjour ${params.username}, confirmez votre compte StreamWall ici : ${params.verifyUrl}`,
    html,
  });
}

export async function sendWelcomeEmail(params: {
  to: string;
  username: string;
  appUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const safeName = params.username.replace(/[<>&"]/g, '');
  const html = wrapEmailHtml(
    'Bienvenue sur StreamWall !',
    `<p style="font-size:14px;line-height:1.6;color:#d1d5db;">Bonjour <strong>${safeName}</strong>,</p>
     <p style="font-size:14px;line-height:1.6;color:#d1d5db;">Votre compte membre est maintenant actif. Retrouvez vos favoris, votre historique des 5 dernières lectures et vos commentaires en ligne.</p>
     ${
       params.appUrl
         ? `<p style="margin:20px 0;"><a href="${params.appUrl}" style="display:inline-block;background:#e6a82e;color:#0f172a;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">Accéder à StreamWall</a></p>`
         : ''
     }`
  );
  return sendMail({
    to: params.to,
    subject: 'Bienvenue sur StreamWall',
    text: `Bienvenue ${params.username} sur StreamWall ! ${params.appUrl}`,
    html,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const html = wrapEmailHtml(
    'Réinitialisation du mot de passe',
    `<p style="font-size:14px;line-height:1.6;color:#d1d5db;">Vous avez demandé à réinitialiser votre mot de passe StreamWall.</p>
     <p style="margin:22px 0;">
       <a href="${params.resetUrl}" style="display:inline-block;background:#e6a82e;color:#0f172a;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">Choisir un nouveau mot de passe</a>
     </p>
     <p style="font-size:12px;color:#9ca3af;word-break:break-all;">Lien valide 30 minutes : ${params.resetUrl}</p>`
  );
  return sendMail({
    to: params.to,
    subject: 'Réinitialisez votre mot de passe StreamWall',
    text: `Réinitialisez votre mot de passe StreamWall via ce lien (valide 30 min) : ${params.resetUrl}`,
    html,
  });
}

export async function sendEmailChangeNotice(params: {
  to: string;
  username: string;
}): Promise<{ ok: boolean; error?: string }> {
  const safeName = params.username.replace(/[<>&"]/g, '');
  const html = wrapEmailHtml(
    'Adresse email mise à jour',
    `<p style="font-size:14px;line-height:1.6;color:#d1d5db;">Bonjour <strong>${safeName}</strong>,</p>
     <p style="font-size:14px;line-height:1.6;color:#d1d5db;">Votre nouvelle adresse email (<strong>${params.to}</strong>) est maintenant associée à votre compte StreamWall.</p>`
  );
  return sendMail({
    to: params.to,
    subject: 'Adresse email mise à jour — StreamWall',
    text: `Bonjour ${params.username}, votre adresse email StreamWall a été mise à jour vers ${params.to}.`,
    html,
  });
}

export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const providerLabel =
    mailConfig.provider === 'resend'
      ? 'Resend API'
      : mailConfig.provider === 'brevo'
        ? 'Brevo API'
        : 'SMTP';
  const html = wrapEmailHtml(
    `Test ${providerLabel} réussi`,
    `<p style="font-size:14px;line-height:1.6;color:#d1d5db;">Cet email confirme que la passerelle <strong>${providerLabel}</strong> configurée dans l’administration StreamWall fonctionne correctement.</p>`
  );
  return sendMail({
    to,
    subject: `Test ${providerLabel} — StreamWall`,
    text: `Test de configuration ${providerLabel} StreamWall réussi.`,
    html,
  });
}
