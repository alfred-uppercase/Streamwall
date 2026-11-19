import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PopupAudience,
  PopupConfig,
  PopupContentMode,
  PopupDeviceTarget,
  PopupFrequency,
  PopupPageScope,
  PopupTriggerType,
} from '../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const POPUPS_FILE = path.join(DATA_DIR, 'tapenaka-popups.json');
const POPUP_ASSETS_DIR = path.join(DATA_DIR, 'popup-assets');

interface PopupsDatabase {
  popups: PopupConfig[];
}

const VALID_MODES: PopupContentMode[] = ['text', 'image'];
const VALID_TRIGGERS: PopupTriggerType[] = [
  'after_delay',
  'on_scroll',
  'on_exit_intent',
  'after_page_views',
  'on_player_open',
  'immediate',
];
const VALID_PAGE_SCOPES: PopupPageScope[] = [
  'all',
  'home',
  'catalogue',
  'detail',
  'pricing',
  'custom',
];
const VALID_AUDIENCES: PopupAudience[] = [
  'all',
  'guests',
  'free',
  'guests_and_free',
  'pro',
];
const VALID_DEVICES: PopupDeviceTarget[] = ['all', 'desktop', 'mobile'];
const VALID_FREQUENCIES: PopupFrequency[] = [
  'once_per_week',
  'once_per_day',
  'once_per_session',
  'custom_days',
  'once_ever',
];

function sanitizePopupUrl(raw: unknown, allowEmpty = true): string {
  const val = String(raw ?? '').trim();
  if (!val) return allowEmpty ? '' : '/';
  if (/^(\/[^\s"'<>]*|https?:\/\/[^\s"'<>]+)$/i.test(val)) {
    return val.slice(0, 500);
  }
  return allowEmpty ? '' : '/';
}

function sanitizeIsoOrNull(raw: unknown): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizePopupRecord(raw: Partial<PopupConfig>): PopupConfig {
  const now = new Date().toISOString();
  const mode: PopupContentMode = VALID_MODES.includes(raw.mode as PopupContentMode)
    ? (raw.mode as PopupContentMode)
    : 'text';
  const triggerType: PopupTriggerType = VALID_TRIGGERS.includes(raw.triggerType as PopupTriggerType)
    ? (raw.triggerType as PopupTriggerType)
    : 'after_delay';
  const pageScope: PopupPageScope = VALID_PAGE_SCOPES.includes(raw.pageScope as PopupPageScope)
    ? (raw.pageScope as PopupPageScope)
    : 'all';
  const audience: PopupAudience = VALID_AUDIENCES.includes(raw.audience as PopupAudience)
    ? (raw.audience as PopupAudience)
    : 'all';
  const deviceTarget: PopupDeviceTarget = VALID_DEVICES.includes(raw.deviceTarget as PopupDeviceTarget)
    ? (raw.deviceTarget as PopupDeviceTarget)
    : 'all';
  const frequency: PopupFrequency = VALID_FREQUENCIES.includes(raw.frequency as PopupFrequency)
    ? (raw.frequency as PopupFrequency)
    : 'once_per_week';

  return {
    id: String(raw.id || `pop_${crypto.randomBytes(5).toString('hex')}`),
    name: String(raw.name || 'Popup sans titre').trim().slice(0, 80) || 'Popup sans titre',
    enabled: Boolean(raw.enabled),
    mode,
    title: String(raw.title ?? '').trim().slice(0, 120),
    bodyText: String(raw.bodyText ?? '').trim().slice(0, 800),
    buttonLabel: String(raw.buttonLabel ?? '').trim().slice(0, 60),
    buttonUrl: sanitizePopupUrl(raw.buttonUrl, true),
    buttonNewTab: Boolean(raw.buttonNewTab),
    imageUrl: sanitizePopupUrl(raw.imageUrl, true),
    imageAlt: String(raw.imageAlt ?? '').trim().slice(0, 140),
    imageLink: sanitizePopupUrl(raw.imageLink, true),
    imageNewTab: Boolean(raw.imageNewTab),
    triggerType,
    delaySeconds: Math.max(0, Math.min(600, Number(raw.delaySeconds ?? 10) || 0)),
    scrollPercent: Math.max(5, Math.min(100, Number(raw.scrollPercent ?? 40) || 40)),
    minPageViews: Math.max(1, Math.min(50, Math.round(Number(raw.minPageViews ?? 2) || 2))),
    pageScope,
    customPaths: String(raw.customPaths ?? '').trim().slice(0, 300),
    excludePaths: String(raw.excludePaths ?? '/admin, /auth, /reset-password').trim().slice(0, 300),
    audience,
    deviceTarget,
    frequency,
    customIntervalDays: Math.max(1, Math.min(365, Math.round(Number(raw.customIntervalDays ?? 7) || 7))),
    closeOnBackdrop: raw.closeOnBackdrop !== false,
    autoCloseSeconds: Math.max(0, Math.min(300, Number(raw.autoCloseSeconds ?? 0) || 0)),
    priority: Math.max(0, Math.min(999, Math.round(Number(raw.priority ?? 10) || 0))),
    startAt: sanitizeIsoOrNull(raw.startAt),
    endAt: sanitizeIsoOrNull(raw.endAt),
    impressions: Math.max(0, Number(raw.impressions ?? 0) || 0),
    clicks: Math.max(0, Number(raw.clicks ?? 0) || 0),
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

function loadPopupsDb(): PopupsDatabase {
  try {
    if (fs.existsSync(POPUPS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(POPUPS_FILE, 'utf-8')) as PopupsDatabase;
      if (parsed && Array.isArray(parsed.popups)) {
        return {
          popups: parsed.popups.map((p) => normalizePopupRecord(p)),
        };
      }
    }
  } catch {
    // Re-seed if corrupted
  }
  return { popups: [] };
}

function savePopupsDb(state: PopupsDatabase): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(POPUPS_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}

const popupsDb: PopupsDatabase = loadPopupsDb();

const ASSET_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export function savePopupImageDataUrl(
  dataUrl: string
): { url?: string; error?: string } {
  const m = dataUrl
    .trim()
    .match(/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) {
    return { error: 'Format d’image non supporté. Utilisez PNG, JPG, WEBP, GIF ou SVG.' };
  }
  const mimeSub = m[1].toLowerCase();
  const ext = mimeSub === 'svg+xml' ? 'svg' : mimeSub === 'jpeg' ? 'jpg' : mimeSub;
  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (buf.length === 0 || buf.length > 3_500_000) {
    return { error: 'L’image publicitaire doit faire moins de 3,5 Mo.' };
  }
  fs.mkdirSync(POPUP_ASSETS_DIR, { recursive: true });
  const filename = `popup_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(POPUP_ASSETS_DIR, filename), buf);
  return { url: `/api/popups/asset/${filename}` };
}

export function resolvePopupAssetFile(
  filename: string
): { filePath: string; contentType: string } | null {
  const safe = path.basename(String(filename || '').trim());
  if (!/^popup_[a-z0-9_.-]+\.(png|jpg|jpeg|webp|gif|svg)$/i.test(safe)) {
    return null;
  }
  const fullPath = path.join(POPUP_ASSETS_DIR, safe);
  if (!fs.existsSync(fullPath)) return null;
  const ext = path.extname(safe).slice(1).toLowerCase();
  const contentType = ASSET_MIME_BY_EXT[ext] || 'application/octet-stream';
  return { filePath: fullPath, contentType };
}

export function listAllPopups(): PopupConfig[] {
  return [...popupsDb.popups].sort(
    (a, b) => b.priority - a.priority || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function listActivePopups(nowMs = Date.now()): PopupConfig[] {
  return listAllPopups().filter((p) => {
    if (!p.enabled) return false;
    if (p.mode === 'image' && !p.imageUrl) return false;
    if (p.mode === 'text' && !p.title && !p.bodyText) return false;
    if (p.startAt) {
      const startMs = new Date(p.startAt).getTime();
      if (Number.isFinite(startMs) && nowMs < startMs) return false;
    }
    if (p.endAt) {
      const endMs = new Date(p.endAt).getTime();
      if (Number.isFinite(endMs) && nowMs > endMs) return false;
    }
    return true;
  });
}

export function upsertPopup(
  input: Partial<PopupConfig> & { imageUploadDataUrl?: string | null }
): { popup?: PopupConfig; error?: string } {
  let nextImageUrl = sanitizePopupUrl(input.imageUrl, true);
  if (typeof input.imageUploadDataUrl === 'string' && input.imageUploadDataUrl.trim()) {
    const saved = savePopupImageDataUrl(input.imageUploadDataUrl);
    if (saved.error || !saved.url) {
      return { error: saved.error || 'Importation image impossible.' };
    }
    nextImageUrl = saved.url;
  }

  const mode: PopupContentMode = input.mode === 'image' ? 'image' : 'text';
  if (mode === 'image' && !nextImageUrl) {
    return { error: 'Ajoutez une photo publicitaire (URL ou fichier importé).' };
  }
  if (mode === 'text') {
    const hasTitle = Boolean(String(input.title ?? '').trim());
    const hasBody = Boolean(String(input.bodyText ?? '').trim());
    if (!hasTitle && !hasBody) {
      return { error: 'Renseignez au moins un titre ou un texte pour ce popup.' };
    }
  }

  const cleanId = String(input.id || '').trim();
  const existingIdx = cleanId ? popupsDb.popups.findIndex((p) => p.id === cleanId) : -1;

  if (existingIdx >= 0) {
    const existing = popupsDb.popups[existingIdx];
    const updated = normalizePopupRecord({
      ...existing,
      ...input,
      id: existing.id,
      imageUrl: nextImageUrl,
      impressions: existing.impressions,
      clicks: existing.clicks,
      createdAt: existing.createdAt,
    });
    popupsDb.popups[existingIdx] = updated;
    savePopupsDb(popupsDb);
    return { popup: updated };
  }

  const created = normalizePopupRecord({
    ...input,
    id: `pop_${crypto.randomBytes(5).toString('hex')}`,
    imageUrl: nextImageUrl,
    impressions: 0,
    clicks: 0,
  });
  popupsDb.popups.unshift(created);
  savePopupsDb(popupsDb);
  return { popup: created };
}

export function deletePopup(popupId: string): boolean {
  const target = popupsDb.popups.find((p) => p.id === popupId);
  if (!target) return false;
  popupsDb.popups = popupsDb.popups.filter((p) => p.id !== popupId);
  savePopupsDb(popupsDb);

  if (target.imageUrl.startsWith('/api/popups/asset/')) {
    const filename = path.basename(target.imageUrl);
    const stillUsed = popupsDb.popups.some((p) => p.imageUrl.endsWith(`/${filename}`));
    if (!stillUsed) {
      const asset = resolvePopupAssetFile(filename);
      if (asset) {
        try {
          fs.unlinkSync(asset.filePath);
        } catch {
          // Non-fatal
        }
      }
    }
  }
  return true;
}

export function trackPopupEvent(
  popupId: string,
  event: 'impression' | 'click'
): boolean {
  const target = popupsDb.popups.find((p) => p.id === popupId);
  if (!target) return false;
  if (event === 'click') target.clicks += 1;
  else target.impressions += 1;
  savePopupsDb(popupsDb);
  return true;
}
