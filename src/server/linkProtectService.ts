import crypto from 'node:crypto';
import { readModuleSnapshot, writeModuleSnapshot } from './persistentDb.ts';

const LINK_PROTECT_MODULE_KEY = 'link_protect_secret';
const DEFAULT_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

interface SecretSnapshot {
  keyHex: string;
}

let cachedKeyBuffer: Buffer | null = null;

function getEncryptionKey(): Buffer {
  const envSecret =
    process.env.LINK_PROTECT_SECRET?.trim() ||
    process.env.SECURITY_HMAC_SECRET?.trim() ||
    '';

  if (envSecret) {
    return crypto.createHash('sha256').update(`linprotect:${envSecret}`).digest();
  }

  if (cachedKeyBuffer) return cachedKeyBuffer;

  const stored = readModuleSnapshot<SecretSnapshot>(LINK_PROTECT_MODULE_KEY);
  if (stored && typeof stored.keyHex === 'string' && /^[0-9a-f]{64}$/i.test(stored.keyHex)) {
    cachedKeyBuffer = Buffer.from(stored.keyHex, 'hex');
    return cachedKeyBuffer;
  }

  const generated = crypto.randomBytes(32);
  writeModuleSnapshot<SecretSnapshot>(LINK_PROTECT_MODULE_KEY, {
    keyHex: generated.toString('hex'),
  });
  cachedKeyBuffer = generated;
  return generated;
}

export function sanitizeExternalDownloadUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

interface ProtectedLinkPayload {
  u: string;
  f: string;
  q: string;
  fid: number;
  iat: number;
  exp: number;
}

export interface DecryptedProtectedLink {
  url: string;
  filename: string;
  quality: string;
  filmId: number;
  expiresAt: number;
}

export function encryptProtectedLink(params: {
  url: string;
  filename: string;
  quality: string;
  filmId: number;
  ttlMs?: number;
}): string | null {
  const safeUrl = sanitizeExternalDownloadUrl(params.url);
  if (!safeUrl) return null;

  const now = Date.now();
  const ttlMs = Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, params.ttlMs ?? DEFAULT_LINK_TTL_MS));
  const payload: ProtectedLinkPayload = {
    u: safeUrl,
    f: String(params.filename || 'Téléchargement').trim().slice(0, 140) || 'Téléchargement',
    q: String(params.quality || '').trim().slice(0, 48),
    fid: Number.isInteger(params.filmId) && params.filmId > 0 ? params.filmId : 0,
    iat: now,
    exp: now + ttlMs,
  };

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function decryptProtectedLink(
  rawToken: unknown
): { ok: true; data: DecryptedProtectedLink } | { ok: false; expired?: boolean; error: string } {
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!token || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, error: 'Lien protégé invalide ou mal formé.' };
  }

  let rawBuf: Buffer;
  try {
    rawBuf = Buffer.from(token, 'base64url');
  } catch {
    return { ok: false, error: 'Lien protégé illisible.' };
  }

  if (rawBuf.length < IV_LENGTH + AUTH_TAG_LENGTH + 2) {
    return { ok: false, error: 'Lien protégé incomplet ou corrompu.' };
  }

  const iv = rawBuf.subarray(0, IV_LENGTH);
  const tag = rawBuf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = rawBuf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  let decryptedJson: string;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    decryptedJson = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return { ok: false, error: 'Lien protégé invalide ou altéré.' };
  }

  let parsed: Partial<ProtectedLinkPayload>;
  try {
    parsed = JSON.parse(decryptedJson) as Partial<ProtectedLinkPayload>;
  } catch {
    return { ok: false, error: 'Contenu du lien protégé corrompu.' };
  }

  if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) {
    return {
      ok: false,
      expired: true,
      error: 'Ce lien protégé a expiré. Revenez sur la fiche du film pour en générer un nouveau.',
    };
  }

  const safeUrl = sanitizeExternalDownloadUrl(parsed.u);
  if (!safeUrl) {
    return { ok: false, error: 'Destination du lien protégé invalide.' };
  }

  return {
    ok: true,
    data: {
      url: safeUrl,
      filename:
        typeof parsed.f === 'string' && parsed.f.trim()
          ? parsed.f.trim().slice(0, 140)
          : 'Téléchargement',
      quality: typeof parsed.q === 'string' ? parsed.q.trim().slice(0, 48) : '',
      filmId: typeof parsed.fid === 'number' && parsed.fid > 0 ? parsed.fid : 0,
      expiresAt: parsed.exp,
    },
  };
}
