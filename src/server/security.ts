import crypto from 'node:crypto';
import type express from 'express';
import { TimedLruCache } from './cacheUtils.ts';
import { recordErrorLog } from './errorLogger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// EPHEMERAL SIGNING KEY (ENV OR SECURE BOOT-TIME RANDOM — NEVER HARDCODED)
// ─────────────────────────────────────────────────────────────────────────────
const RUNTIME_HMAC_SECRET =
  process.env.SECURITY_HMAC_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60_000;
const LOGIN_LOCKOUT_MS = 15 * 60_000;
const CAPTCHA_TTL_MS = 5 * 60_000;

// Bounded maps to prevent memory exhaustion under floods
const usedCaptchaJtis = new TimedLruCache<true>(10_000);
const testCaptchaPlaintext = new TimedLruCache<string>(2_000);
const loginFailureByEmail = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
const loginFailureByIpEmail = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const MAX_RATE_BUCKETS = 25_000;
const MAX_LOCK_ENTRIES = 10_000;

function pruneMapIfNeeded<T extends { resetAt?: number; lockedUntil?: number; firstAt?: number }>(
  map: Map<string, T>,
  maxEntries: number,
  now: number
): void {
  if (map.size < maxEntries) return;
  for (const [k, v] of map.entries()) {
    if (
      (typeof v.resetAt === 'number' && v.resetAt <= now) ||
      (typeof v.lockedUntil === 'number' &&
        v.lockedUntil <= now &&
        typeof v.firstAt === 'number' &&
        now - v.firstAt > LOGIN_ATTEMPT_WINDOW_MS)
    ) {
      map.delete(k);
    }
    if (map.size < maxEntries * 0.8) break;
  }
  while (map.size >= maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  if (Array.isArray(fwd) && fwd[0]) {
    return String(fwd[0]).split(',')[0]?.trim().slice(0, 64) || 'unknown';
  }
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

export function isLoopbackIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  return (
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === '::ffff:127.0.0.1' ||
    clean === 'localhost'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCAPING, SANITIZATION & ANTI-INJECTION / ANTI-XSS HELPERS
// ─────────────────────────────────────────────────────────────────────────────
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripDangerousText(input: unknown, maxLen = 2000): string {
  return String(input ?? '')
    .replace(/\0/g, '')
    // Strip zero-width / bidirectional spoofing control characters
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '')
    // Remove full <script>...</script> and <style>...</style> blocks first
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Strip remaining dangerous HTML tags while preserving normal text
    .replace(/<\s*\/?\s*(script|iframe|object|embed|svg|style|link|meta|form|base)[^>]*>/gi, '')
    .replace(/\b(on\w+|javascript|vbscript|data:text\/html)\s*[:=]/gi, '')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeSafeUrl(
  raw: unknown,
  options: { allowRelative?: boolean; allowDataImage?: boolean; maxLen?: number } = {}
): string | null {
  const { allowRelative = true, allowDataImage = false, maxLen = 500 } = options;
  const val = String(raw ?? '').replace(/[\0\r\n\t]/g, '').trim();
  if (!val) return null;

  if (allowRelative && /^\/(?!\/)[^\s"'<>\\]*$/i.test(val)) {
    return val.slice(0, maxLen);
  }

  if (allowDataImage && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(val)) {
    return val.slice(0, maxLen);
  }

  try {
    const parsed = new URL(val);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString().slice(0, maxLen);
    }
  } catch {
    return null;
  }

  return null;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sanitizeJsonPayload(value: unknown, depth = 0): { clean: unknown; blocked: boolean } {
  if (depth > 12) {
    return { clean: null, blocked: true };
  }
  if (typeof value === 'string') {
    return { clean: value.replace(/\0/g, ''), blocked: false };
  }
  if (value === null || typeof value !== 'object') {
    return { clean: value, blocked: false };
  }
  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    for (const item of value) {
      const res = sanitizeJsonPayload(item, depth + 1);
      if (res.blocked) return { clean: null, blocked: true };
      arr.push(res.clean);
    }
    return { clean: arr, blocked: false };
  }

  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    const res = sanitizeJsonPayload(v, depth + 1);
    if (res.blocked) return { clean: null, blocked: true };
    out[k] = res.clean;
  }
  return { clean: out, blocked: false };
}

const SQLI_PATTERNS: RegExp[] = [
  /\bunion\s+(?:all\s+)?select\b/i,
  /['"`]\s*(?:or|and)\s+['"`]?\d+['"`]?\s*=\s*['"`]?\d+/i,
  /['"`]\s*(?:or|and)\s+['"`]?[a-z_]+['"`]?\s*=\s*['"`]?[a-z_]+/i,
  /;\s*(?:drop|truncate|alter|delete|insert|update|exec|execute|create|replace)\s+/i,
  /\b(?:sleep|benchmark|pg_sleep|waitfor\s+delay)\s*\(/i,
  /\b(?:information_schema|sqlite_master|sqlite_temp_master|pg_catalog)\b/i,
  /\/\*![0-9]*|\*\/--/i,
];

const XSS_PROBE_PATTERNS: RegExp[] = [
  /<\s*script\b/i,
  /\bjavascript\s*:/i,
  /\bvbscript\s*:/i,
  /\bon(?:error|load|mouseover|focus|click)\s*=/i,
  /<\s*(?:iframe|object|embed|svg)\b[^>]*>/i,
];

export function hasSqlInjectionProbe(value: string): boolean {
  if (!value || value.length < 4) return false;
  return SQLI_PATTERNS.some((re) => re.test(value));
}

export function hasXssProbe(value: string): boolean {
  if (!value || value.length < 5) return false;
  return XSS_PROBE_PATTERNS.some((re) => re.test(value));
}

export function hasPathTraversalProbe(value: string): boolean {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value) || /%2e%2e/i.test(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTI-BOT & ANTI-SCRAPE USER-AGENT + HONEYPOT CHECKS
// ─────────────────────────────────────────────────────────────────────────────
const KNOWN_SCRAPER_UA_REGEX =
  /\b(sqlmap|nikto|nmap|masscan|zgrab|gobuster|dirbuster|wpscan|nuclei|nessus|openvas|acunetix|netsparker|scrapy|python-requests|python-urllib|aiohttp|httpx|go-http-client|curl\/|wget\/|libwww-perl|httrack|webcopier|phantomjs|headlesschrome|puppeteer|playwright|selenium|bytespider|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|ccbot|gptbot|claudebot|anthropic-ai|ia_archiver)\b/i;

export function isSuspiciousBotUserAgent(ua: string): boolean {
  if (!ua) return false;
  return KNOWN_SCRAPER_UA_REGEX.test(ua);
}

export function isHoneypotTriggered(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const obj = body as Record<string, unknown>;
  const fields = [obj.website, obj.hp_field, obj.company_url, obj.fax];
  return fields.some((f) => typeof f === 'string' && f.trim().length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDING WINDOW RATE LIMITER (ANTI-DDOS / ANTI-SCRAPE)
// ─────────────────────────────────────────────────────────────────────────────
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function consumeRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  pruneMapIfNeeded(rateBuckets, MAX_RATE_BUCKETS, now);

  const existing = rateBuckets.get(bucketKey);
  if (!existing || now >= existing.resetAt) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function resetRateLimitsForTest(): void {
  rateBuckets.clear();
  loginFailureByEmail.clear();
  loginFailureByIpEmail.clear();
  usedCaptchaJtis.clear();
  testCaptchaPlaintext.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3-ATTEMPT LOGIN BRUTE-FORCE PROTECTION
// ─────────────────────────────────────────────────────────────────────────────
export interface LoginLockoutState {
  locked: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
}

function getLockKeys(email: string, ip: string) {
  const normEmail = email.trim().toLowerCase();
  const normIp = ip.trim().toLowerCase() || 'unknown';
  return {
    emailKey: `e:${normEmail}`,
    ipEmailKey: `ie:${normIp}:${normEmail}`,
  };
}

export function checkLoginLockout(email: string, ip: string): LoginLockoutState {
  const now = Date.now();
  const { emailKey, ipEmailKey } = getLockKeys(email, ip);

  for (const [map, key] of [
    [loginFailureByEmail, emailKey] as const,
    [loginFailureByIpEmail, ipEmailKey] as const,
  ]) {
    const rec = map.get(key);
    if (!rec) continue;
    if (rec.lockedUntil > now) {
      return {
        locked: true,
        remainingAttempts: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((rec.lockedUntil - now) / 1000)),
      };
    }
    if (rec.lockedUntil > 0 && rec.lockedUntil <= now) {
      map.delete(key);
    } else if (now - rec.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
      map.delete(key);
    }
  }

  const emailRec = loginFailureByEmail.get(emailKey);
  const ipEmailRec = loginFailureByIpEmail.get(ipEmailKey);
  const highestCount = Math.max(emailRec?.count ?? 0, ipEmailRec?.count ?? 0);
  return {
    locked: false,
    remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - highestCount),
    retryAfterSeconds: 0,
  };
}

export function recordLoginFailure(email: string, ip: string): LoginLockoutState {
  const now = Date.now();
  const { emailKey, ipEmailKey } = getLockKeys(email, ip);
  pruneMapIfNeeded(loginFailureByEmail, MAX_LOCK_ENTRIES, now);
  pruneMapIfNeeded(loginFailureByIpEmail, MAX_LOCK_ENTRIES, now);

  let highestCount = 0;
  let lockedUntilMax = 0;

  for (const [map, key] of [
    [loginFailureByEmail, emailKey] as const,
    [loginFailureByIpEmail, ipEmailKey] as const,
  ]) {
    const cur = map.get(key);
    if (!cur || now - cur.firstAt > LOGIN_ATTEMPT_WINDOW_MS || (cur.lockedUntil > 0 && cur.lockedUntil <= now)) {
      const next = { count: 1, firstAt: now, lockedUntil: 0 };
      map.set(key, next);
      highestCount = Math.max(highestCount, 1);
    } else {
      cur.count += 1;
      if (cur.count >= MAX_LOGIN_ATTEMPTS) {
        cur.lockedUntil = now + LOGIN_LOCKOUT_MS;
        lockedUntilMax = Math.max(lockedUntilMax, cur.lockedUntil);
      }
      highestCount = Math.max(highestCount, cur.count);
    }
  }

  if (lockedUntilMax > now) {
    return {
      locked: true,
      remainingAttempts: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((lockedUntilMax - now) / 1000)),
    };
  }

  return {
    locked: false,
    remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - highestCount),
    retryAfterSeconds: 0,
  };
}

export function clearLoginFailures(email: string, ip: string): void {
  const { emailKey, ipEmailKey } = getLockKeys(email, ip);
  loginFailureByEmail.delete(emailKey);
  loginFailureByIpEmail.delete(ipEmailKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-HOSTED CRYPTOGRAPHIC SVG CAPTCHA
// ─────────────────────────────────────────────────────────────────────────────
const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function signCaptchaPayload(encodedPayload: string): string {
  return crypto.createHmac('sha256', RUNTIME_HMAC_SECRET).update(encodedPayload).digest('base64url');
}

function hashAnswer(jti: string, answer: string): string {
  return crypto
    .createHmac('sha256', RUNTIME_HMAC_SECRET)
    .update(`${jti}:${answer.trim().toUpperCase()}`)
    .digest('hex');
}

function hashIpBinding(ip: string): string {
  return crypto.createHmac('sha256', RUNTIME_HMAC_SECRET).update(ip).digest('hex').slice(0, 16);
}

function renderCaptchaSvg(code: string): string {
  const width = 220;
  const height = 68;
  const palette = ['#f5b938', '#fbbf24', '#f8fafc', '#e2e8f0', '#fcd34d'];

  const lines: string[] = [];
  for (let i = 0; i < 6; i++) {
    const x1 = crypto.randomInt(0, 45);
    const y1 = crypto.randomInt(8, height - 8);
    const cx = crypto.randomInt(60, 160);
    const cy = crypto.randomInt(4, height - 4);
    const x2 = crypto.randomInt(width - 45, width);
    const y2 = crypto.randomInt(8, height - 8);
    const stroke = i % 2 === 0 ? 'rgba(245,185,56,0.28)' : 'rgba(148,163,184,0.24)';
    lines.push(
      `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${1 + (i % 2) * 0.6}"/>`
    );
  }

  const dots: string[] = [];
  for (let i = 0; i < 28; i++) {
    const x = crypto.randomInt(4, width - 4);
    const y = crypto.randomInt(4, height - 4);
    const r = (crypto.randomInt(10, 22) / 10).toFixed(1);
    const opacity = (crypto.randomInt(15, 45) / 100).toFixed(2);
    dots.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(245,185,56,${opacity})"/>`);
  }

  const chars = code.split('').map((ch, idx) => {
    const baseX = 28 + idx * 37 + crypto.randomInt(-3, 4);
    const baseY = 44 + crypto.randomInt(-6, 7);
    const rotate = crypto.randomInt(-20, 21);
    const fontSize = crypto.randomInt(26, 32);
    const fill = palette[(idx + crypto.randomInt(0, palette.length)) % palette.length];
    return `<text x="${baseX}" y="${baseY}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="${fontSize}" font-weight="800" fill="${fill}" transform="rotate(${rotate} ${baseX} ${baseY})" letter-spacing="1">${escapeHtml(ch)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Code de sécurité">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="10" fill="url(#bg)" stroke="rgba(255,255,255,0.12)"/>
  <g stroke="rgba(255,255,255,0.05)" stroke-width="1">
    <line x1="0" y1="22" x2="${width}" y2="22"/>
    <line x1="0" y1="46" x2="${width}" y2="46"/>
    <line x1="55" y1="0" x2="55" y2="${height}"/>
    <line x1="110" y1="0" x2="110" y2="${height}"/>
    <line x1="165" y1="0" x2="165" y2="${height}"/>
  </g>
  ${lines.join('')}
  ${dots.join('')}
  ${chars.join('')}
</svg>`;
}

export interface CaptchaChallengeResponse {
  captchaToken: string;
  svgDataUri: string;
  expiresInSeconds: number;
}

export function createCaptchaChallenge(ip = 'unknown'): CaptchaChallengeResponse {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CAPTCHA_ALPHABET[crypto.randomInt(0, CAPTCHA_ALPHABET.length)];
  }

  const jti = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  const payload = {
    jti,
    h: hashAnswer(jti, code),
    ip: hashIpBinding(ip),
    iat: now,
    exp: now + CAPTCHA_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = signCaptchaPayload(encoded);
  const captchaToken = `${encoded}.${sig}`;

  if (process.env.TAPENAKA_SILENT_LOGS === '1' || process.env.NODE_ENV === 'test') {
    testCaptchaPlaintext.set(captchaToken, code, CAPTCHA_TTL_MS);
  }

  const svg = renderCaptchaSvg(code);
  const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  return {
    captchaToken,
    svgDataUri,
    expiresInSeconds: Math.floor(CAPTCHA_TTL_MS / 1000),
  };
}

export function peekCaptchaAnswerForTest(captchaToken: string): string | null {
  if (process.env.TAPENAKA_SILENT_LOGS !== '1' && process.env.NODE_ENV !== 'test') {
    return null;
  }
  return testCaptchaPlaintext.get(captchaToken);
}

export function verifyCaptchaChallenge(params: {
  captchaToken: unknown;
  captchaAnswer: unknown;
  ip?: string;
  minSolveMs?: number;
}): { ok: boolean; error?: string } {
  const token = typeof params.captchaToken === 'string' ? params.captchaToken.trim() : '';
  const answer = typeof params.captchaAnswer === 'string' ? params.captchaAnswer.trim().toUpperCase() : '';
  const minSolveMs =
    params.minSolveMs ??
    (process.env.TAPENAKA_SILENT_LOGS === '1' || process.env.NODE_ENV === 'test' ? 0 : 350);

  if (!token || !answer) {
    return { ok: false, error: 'Veuillez recopier le code de sécurité (CAPTCHA).' };
  }

  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx >= token.length - 1) {
    return { ok: false, error: 'CAPTCHA invalide. Actualisez le code et réessayez.' };
  }

  const encoded = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  const expectedSig = signCaptchaPayload(encoded);

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, error: 'Signature du CAPTCHA invalide. Actualisez le code.' };
  }

  let parsed: { jti?: string; h?: string; ip?: string; iat?: number; exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'CAPTCHA corrompu. Actualisez le code.' };
  }

  const now = Date.now();
  if (!parsed.jti || !parsed.h || !parsed.exp || parsed.exp <= now) {
    return { ok: false, error: 'CAPTCHA expiré. Veuillez saisir le nouveau code.' };
  }

  if (parsed.iat && minSolveMs > 0 && now - parsed.iat < minSolveMs) {
    return { ok: false, error: 'Validation trop rapide détectée. Veuillez réessayer.' };
  }

  if (params.ip && parsed.ip && parsed.ip !== hashIpBinding(params.ip)) {
    return { ok: false, error: 'Session CAPTCHA invalide pour cette adresse IP. Actualisez le code.' };
  }

  // Single-use replay check: consume JTI once signature/expiry validated
  if (usedCaptchaJtis.get(parsed.jti)) {
    return { ok: false, error: 'Ce CAPTCHA a déjà été utilisé. Veuillez saisir le nouveau code.' };
  }
  usedCaptchaJtis.set(parsed.jti, true, CAPTCHA_TTL_MS);

  const actualHash = Buffer.from(hashAnswer(parsed.jti, answer), 'utf8');
  const expectedHash = Buffer.from(parsed.h, 'utf8');
  if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(actualHash, expectedHash)) {
    return { ok: false, error: 'Code CAPTCHA incorrect. Un nouveau code a été généré.' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS SECURITY MIDDLEWARES
// ─────────────────────────────────────────────────────────────────────────────
export function isSecureRequest(req: express.Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  return proto === 'https' || proto.startsWith('https,');
}

export function getSessionCookieOptions(
  req: express.Request,
  overrides?: express.CookieOptions
): express.CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: 35 * 86_400_000,
    ...overrides,
  };
}

export function securityHeadersMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-XSS-Protection', '0');

  if (isSecureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Keep AI Studio preview iframe compatible while strictly locking down /api JSON responses
  if (req.path.startsWith('/api/') && !req.path.startsWith('/api/public/watch/')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
  }

  next();
}

export function payloadSanitizerMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    const resBody = sanitizeJsonPayload(req.body);
    if (resBody.blocked) {
      res.status(400).json({ error: 'Structure de requête invalide ou trop profonde.' });
      return;
    }
    req.body = resBody.clean;
  }

  if (req.query && typeof req.query === 'object') {
    for (const [key, val] of Object.entries(req.query)) {
      if (DANGEROUS_KEYS.has(key)) {
        delete (req.query as Record<string, unknown>)[key];
        continue;
      }
      if (typeof val === 'string') {
        const cleaned = val.replace(/\0/g, '');
        if (hasSqlInjectionProbe(cleaned) || hasXssProbe(cleaned) || hasPathTraversalProbe(cleaned)) {
          recordErrorLog({
            level: 'warn',
            source: 'security',
            message: `Tentative d'injection bloquée sur query "${key}"`,
            route: req.originalUrl,
            method: req.method,
            statusCode: 403,
            userAgent: String(req.headers['user-agent'] ?? ''),
          });
          res.status(403).json({ error: 'Requête bloquée par le pare-feu applicatif.' });
          return;
        }
        (req.query as Record<string, unknown>)[key] = cleaned;
      }
    }
  }

  next();
}

export function csrfOriginCheckMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  const fullPath = `${req.baseUrl}${req.path}`;
  if (fullPath === '/api/webhooks/crypto-gate') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (!host) {
    next();
    return;
  }
  try {
    const parsedOrigin = new URL(String(origin));
    if (parsedOrigin.host.toLowerCase() !== host) {
      res.status(403).json({ error: 'Origine cross-site non autorisée.' });
      return;
    }
  } catch {
    res.status(403).json({ error: 'En-tête Origin invalide.' });
    return;
  }
  next();
}

export function antiBotAndRateLimitMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const path = `${req.baseUrl}${req.path}`;
  if (path === '/api/health') {
    next();
    return;
  }

  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] ?? '');

  const isScrapeSensitive =
    path === '/api/catalogue' ||
    path.startsWith('/api/details/') ||
    path === '/api/suggestions' ||
    path === '/api/tmdb/search' ||
    path === '/api/home';

  const isAuthEndpoint =
    path === '/api/auth/login' ||
    path === '/api/auth/signup' ||
    path === '/api/auth/forgot-password' ||
    path.startsWith('/api/auth/signup/') ||
    path.startsWith('/api/auth/reset-password') ||
    path === '/api/auth/verify-email' ||
    path === '/api/auth/demo-login';

  // Block known scraper/scanner user-agents on sensitive endpoints and auth routes
  if (isSuspiciousBotUserAgent(ua) && (isScrapeSensitive || isAuthEndpoint || path.startsWith('/api/'))) {
    recordErrorLog({
      level: 'warn',
      source: 'security',
      message: `Bot/scraper bloqué (${ua.slice(0, 80)})`,
      route: req.originalUrl,
      method: req.method,
      statusCode: 403,
      userAgent: ua,
    });
    res.status(403).json({ error: 'Accès automatisé refusé par la protection anti-bot.' });
    return;
  }

  // On remote (non-loopback) scrape-sensitive routes, require a non-empty User-Agent
  if (!isLoopbackIp(ip) && isScrapeSensitive && ua.trim().length < 8) {
    res.status(403).json({ error: 'Client non autorisé.' });
    return;
  }

  // Block SQLi / traversal probes directly on URL path
  const decodedPath = (() => {
    try {
      return decodeURIComponent(req.originalUrl);
    } catch {
      return req.originalUrl;
    }
  })();
  if (hasPathTraversalProbe(decodedPath) || hasSqlInjectionProbe(decodedPath)) {
    recordErrorLog({
      level: 'warn',
      source: 'security',
      message: 'Sonde d’injection/traversal bloquée dans l’URL',
      route: req.originalUrl,
      method: req.method,
      statusCode: 403,
      userAgent: ua,
    });
    res.status(403).json({ error: 'Requête bloquée par la sécurité serveur.' });
    return;
  }

  // Global DDoS sliding window per IP
  const globalLimit = consumeRateLimit(`global:${ip}`, 240, 60_000);
  res.setHeader('X-RateLimit-Limit', String(globalLimit.limit));
  res.setHeader('X-RateLimit-Remaining', String(globalLimit.remaining));
  if (!globalLimit.allowed) {
    res.setHeader('Retry-After', String(globalLimit.retryAfterSeconds));
    res.status(429).json({
      error: `Trop de requêtes détectées. Patientez ${globalLimit.retryAfterSeconds}s avant de réessayer.`,
    });
    return;
  }

  // Scrape-sensitive burst + minute throttling
  if (isScrapeSensitive && !isLoopbackIp(ip)) {
    const burst = consumeRateLimit(`scrape10s:${ip}`, 18, 10_000);
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSeconds));
      res.status(429).json({
        error: 'Activité de navigation trop rapide. Ralentissez vos requêtes.',
      });
      return;
    }
    const min = consumeRateLimit(`scrape60s:${ip}`, 60, 60_000);
    if (!min.allowed) {
      res.setHeader('Retry-After', String(min.retryAfterSeconds));
      res.status(429).json({
        error: 'Limite anti-scraping atteinte. Réessayez dans quelques instants.',
      });
      return;
    }
  }

  // Auth rate limit (applies everywhere; generous enough for local tests)
  if (isAuthEndpoint) {
    const authRate = consumeRateLimit(`auth60s:${ip}`, 30, 60_000);
    if (!authRate.allowed) {
      res.setHeader('Retry-After', String(authRate.retryAfterSeconds));
      res.status(429).json({
        error: `Trop de requêtes d'authentification. Réessayez dans ${authRate.retryAfterSeconds}s.`,
      });
      return;
    }
  }

  // Captcha generation rate limit
  if (path === '/api/auth/captcha') {
    const captchaRate = consumeRateLimit(`captcha60s:${ip}`, 60, 60_000);
    if (!captchaRate.allowed) {
      res.setHeader('Retry-After', String(captchaRate.retryAfterSeconds));
      res.status(429).json({
        error: 'Trop de demandes de CAPTCHA. Patientez quelques secondes.',
      });
      return;
    }
  }

  next();
}
