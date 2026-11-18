import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import type { AdminSmtpSettings, AdminSmtpStatus } from '../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const MAIL_FILE = path.join(DATA_DIR, 'tapenaka-mail.json');

interface StoredSmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  requireSignupConfirmation: boolean;
}

function defaultSmtpConfig(): StoredSmtpConfig {
  return {
    enabled: Boolean(process.env.SMTP_HOST),
    host: (process.env.SMTP_HOST || '').trim(),
    port: Math.max(1, Math.min(65535, Number(process.env.SMTP_PORT) || 587)),
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    user: (process.env.SMTP_USER || '').trim(),
    pass: (process.env.SMTP_PASS || '').trim(),
    fromName: (process.env.SMTP_FROM_NAME || 'StreamWall').trim(),
    fromEmail: (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '').trim(),
    requireSignupConfirmation: false,
  };
}

function loadSmtpConfig(): StoredSmtpConfig {
  try {
    if (fs.existsSync(MAIL_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf-8')) as Partial<StoredSmtpConfig>;
      const base = defaultSmtpConfig();
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
        host: typeof parsed.host === 'string' ? parsed.host : base.host,
        port:
          typeof parsed.port === 'number' && parsed.port > 0 && parsed.port <= 65535
            ? parsed.port
            : base.port,
        secure: typeof parsed.secure === 'boolean' ? parsed.secure : base.secure,
        user: typeof parsed.user === 'string' ? parsed.user : base.user,
        pass: typeof parsed.pass === 'string' ? parsed.pass : base.pass,
        fromName: typeof parsed.fromName === 'string' && parsed.fromName ? parsed.fromName : base.fromName,
        fromEmail: typeof parsed.fromEmail === 'string' ? parsed.fromEmail : base.fromEmail,
        requireSignupConfirmation: Boolean(parsed.requireSignupConfirmation),
      };
    }
  } catch {
    // Fallback to env defaults
  }
  return defaultSmtpConfig();
}

function saveSmtpConfig(cfg: StoredSmtpConfig): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MAIL_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch {
    // Ignore write failures
  }
}

let smtpConfig: StoredSmtpConfig = loadSmtpConfig();

function maskSecret(val: string): string {
  const s = val.trim();
  if (!s) return '';
  if (s.length <= 6) return '••••••';
  return `${s.slice(0, 2)}••••••${s.slice(-2)}`;
}

export function isSmtpReady(): boolean {
  return Boolean(smtpConfig.enabled && smtpConfig.host.trim() && (smtpConfig.fromEmail.trim() || smtpConfig.user.trim()));
}

export function shouldRequireSignupConfirmation(): boolean {
  return isSmtpReady() && Boolean(smtpConfig.requireSignupConfirmation);
}

export function getAdminSmtpStatus(): AdminSmtpStatus {
  return {
    enabled: smtpConfig.enabled,
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    user: smtpConfig.user,
    passConfigured: Boolean(smtpConfig.pass),
    passMask: maskSecret(smtpConfig.pass),
    fromName: smtpConfig.fromName || 'StreamWall',
    fromEmail: smtpConfig.fromEmail,
    requireSignupConfirmation: smtpConfig.requireSignupConfirmation,
  };
}

export function updateAdminSmtpConfig(patch: Partial<AdminSmtpSettings>): AdminSmtpStatus {
  if (typeof patch.enabled === 'boolean') {
    smtpConfig.enabled = patch.enabled;
  }
  if (typeof patch.host === 'string') {
    smtpConfig.host = patch.host.trim().slice(0, 200);
  }
  if (patch.port !== undefined) {
    const p = Number(patch.port);
    if (Number.isFinite(p) && p >= 1 && p <= 65535) {
      smtpConfig.port = Math.round(p);
    }
  }
  if (typeof patch.secure === 'boolean') {
    smtpConfig.secure = patch.secure;
  }
  if (typeof patch.user === 'string') {
    smtpConfig.user = patch.user.trim().slice(0, 200);
  }
  if (patch.clearPass) {
    smtpConfig.pass = '';
  } else if (typeof patch.pass === 'string' && patch.pass.trim()) {
    smtpConfig.pass = patch.pass.trim().slice(0, 256);
  }
  if (typeof patch.fromName === 'string') {
    smtpConfig.fromName = patch.fromName.trim().slice(0, 80) || 'StreamWall';
  }
  if (typeof patch.fromEmail === 'string') {
    smtpConfig.fromEmail = patch.fromEmail.trim().slice(0, 200);
  }
  if (typeof patch.requireSignupConfirmation === 'boolean') {
    smtpConfig.requireSignupConfirmation = patch.requireSignupConfirmation;
  }

  saveSmtpConfig(smtpConfig);
  return getAdminSmtpStatus();
}

export async function sendMail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpReady()) {
    return { ok: false, error: 'Serveur SMTP non configuré ou désactivé dans l’administration.' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      ...(smtpConfig.user
        ? {
            auth: {
              user: smtpConfig.user,
              pass: smtpConfig.pass,
            },
          }
        : {}),
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 15_000,
    });

    const fromAddr = smtpConfig.fromEmail || smtpConfig.user;
    const senderName = (smtpConfig.fromName || 'StreamWall').replace(/"/g, '');
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
      error: err instanceof Error ? err.message : 'Erreur lors de l’envoi SMTP.',
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
  const html = wrapEmailHtml(
    'Test de configuration SMTP réussi',
    `<p style="font-size:14px;line-height:1.6;color:#d1d5db;">Cet email confirme que la passerelle d’envoi configurée dans l’administration StreamWall fonctionne correctement.</p>`
  );
  return sendMail({
    to,
    subject: 'Test SMTP — StreamWall',
    text: 'Test de configuration SMTP StreamWall réussi.',
    html,
  });
}
