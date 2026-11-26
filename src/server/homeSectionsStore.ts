import crypto from 'node:crypto';
import type { ContentItemType, HomeCustomSection, Item } from '../shared/types.ts';
import { readModuleSnapshot, writeModuleSnapshot } from './persistentDb.ts';

export const MAX_HOME_SECTIONS = 20;
export const MAX_ITEMS_PER_HOME_SECTION = 18;

const SNAPSHOT_KEY = 'home_sections';

function cleanText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').trim().slice(0, maxLen);
}

function sanitizePoster(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
      return null;
    } catch {
      return null;
    }
  }
  if (/^\/(?!\/)[a-zA-Z0-9/._-]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function isValidItemType(raw: unknown): raw is ContentItemType {
  if (typeof raw !== 'string') return false;
  if (raw === 'film' || raw === 'serie' || raw === 'anime' || raw === 'pinoy') return true;
  return /^custom:[a-z0-9-]+$/i.test(raw);
}

function sanitizeSectionItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = cleanText(
    typeof r.id === 'number' && Number.isFinite(r.id) ? String(r.id) : r.id,
    160
  );
  const titre = cleanText(r.titre, 200);
  if (!id || !titre || !isValidItemType(r.item_type)) return null;

  const anneeNum = r.annee !== undefined && r.annee !== null ? Number(r.annee) : NaN;
  const saisonVal =
    typeof r.saison === 'number' && Number.isFinite(r.saison)
      ? Math.trunc(r.saison)
      : typeof r.saison === 'string' && cleanText(r.saison, 24)
        ? cleanText(r.saison, 24)
        : null;

  return {
    id,
    titre,
    poster: sanitizePoster(r.poster),
    qualite: cleanText(r.qualite, 32) || null,
    langue: cleanText(r.langue, 32) || null,
    item_type: r.item_type,
    saison: saisonVal,
    genre: cleanText(r.genre, 120) || null,
    annee: Number.isFinite(anneeNum) && anneeNum > 1800 && anneeNum < 2200 ? Math.trunc(anneeNum) : null,
    tmdbId: cleanText(r.tmdbId, 40) || null,
  };
}

function normalizeSectionList(rawList: unknown): HomeCustomSection[] {
  if (!Array.isArray(rawList)) return [];
  const out: HomeCustomSection[] = [];
  const seenIds = new Set<string>();
  const now = new Date().toISOString();

  for (let i = 0; i < rawList.length && out.length < MAX_HOME_SECTIONS; i++) {
    const raw = rawList[i];
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const rawId = cleanText(r.id, 64).replace(/[^a-zA-Z0-9_-]/g, '');
    const id = rawId && !seenIds.has(rawId) ? rawId : `hs_${crypto.randomUUID().slice(0, 8)}`;
    seenIds.add(id);

    const title = cleanText(r.title, 120);
    if (!title) continue;

    const description = cleanText(r.description, 300);
    const enabled = r.enabled !== false;
    const orderNum = Number(r.order);
    const order = Number.isFinite(orderNum) ? Math.max(0, Math.min(9999, Math.trunc(orderNum))) : (i + 1) * 10;

    const rawItems = Array.isArray(r.items) ? r.items : [];
    const items: Item[] = [];
    const seenKeys = new Set<string>();
    for (const candidate of rawItems) {
      if (items.length >= MAX_ITEMS_PER_HOME_SECTION) break;
      const item = sanitizeSectionItem(candidate);
      if (!item) continue;
      const key = `${item.item_type}:${item.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      items.push(item);
    }

    out.push({
      id,
      title,
      description,
      enabled,
      order,
      items,
      createdAt: cleanText(r.createdAt, 40) || now,
      updatedAt: cleanText(r.updatedAt, 40) || now,
    });
  }

  return sortSections(out);
}

function sortSections(list: HomeCustomSection[]): HomeCustomSection[] {
  return [...list].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

let homeSectionsState: HomeCustomSection[] = normalizeSectionList(
  readModuleSnapshot<HomeCustomSection[]>(SNAPSHOT_KEY)
);

function persistSections(): void {
  writeModuleSnapshot(SNAPSHOT_KEY, homeSectionsState);
}

export function listHomeSections(includeDisabled = true): HomeCustomSection[] {
  const sorted = sortSections(homeSectionsState);
  if (includeDisabled) return sorted;
  return sorted.filter((s) => s.enabled);
}

export function getHomeSection(id: string): HomeCustomSection | null {
  const cleanId = cleanText(id, 64);
  return homeSectionsState.find((s) => s.id === cleanId) ?? null;
}

export function upsertHomeSection(
  payload: unknown
): { ok: true; section: HomeCustomSection } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Données de section invalides.' };
  }
  const r = payload as Record<string, unknown>;
  const title = cleanText(r.title, 120);
  if (title.length < 2) {
    return { ok: false, error: 'Le titre de la section doit contenir au moins 2 caractères.' };
  }

  const rawItems = Array.isArray(r.items) ? r.items : [];
  if (rawItems.length > MAX_ITEMS_PER_HOME_SECTION) {
    return {
      ok: false,
      error: `Maximum ${MAX_ITEMS_PER_HOME_SECTION} titres autorisés par section.`,
    };
  }

  const items: Item[] = [];
  const seenKeys = new Set<string>();
  for (const candidate of rawItems) {
    const item = sanitizeSectionItem(candidate);
    if (!item) {
      return { ok: false, error: 'Un des éléments sélectionnés est invalide.' };
    }
    const key = `${item.item_type}:${item.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    items.push(item);
  }

  if (items.length > MAX_ITEMS_PER_HOME_SECTION) {
    return {
      ok: false,
      error: `Maximum ${MAX_ITEMS_PER_HOME_SECTION} titres autorisés par section.`,
    };
  }

  const rawId = cleanText(r.id, 64).replace(/[^a-zA-Z0-9_-]/g, '');
  const existingIdx = rawId ? homeSectionsState.findIndex((s) => s.id === rawId) : -1;
  const existing = existingIdx >= 0 ? homeSectionsState[existingIdx] : null;

  if (!existing && homeSectionsState.length >= MAX_HOME_SECTIONS) {
    return {
      ok: false,
      error: `Maximum ${MAX_HOME_SECTIONS} sections personnalisées atteints.`,
    };
  }

  const now = new Date().toISOString();
  const nextOrderRaw = Number(r.order);
  const maxOrder = homeSectionsState.reduce((m, s) => Math.max(m, s.order), 0);
  const order = Number.isFinite(nextOrderRaw)
    ? Math.max(0, Math.min(9999, Math.trunc(nextOrderRaw)))
    : existing
      ? existing.order
      : maxOrder + 10;

  const section: HomeCustomSection = {
    id: existing ? existing.id : rawId || `hs_${crypto.randomUUID().slice(0, 8)}`,
    title,
    description: cleanText(r.description, 300),
    enabled: r.enabled !== false,
    order,
    items,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  if (existingIdx >= 0) {
    homeSectionsState[existingIdx] = section;
  } else {
    homeSectionsState.push(section);
  }
  homeSectionsState = sortSections(homeSectionsState);
  persistSections();
  return { ok: true, section };
}

export function deleteHomeSection(id: string): boolean {
  const cleanId = cleanText(id, 64);
  if (!cleanId) return false;
  const prevLen = homeSectionsState.length;
  homeSectionsState = homeSectionsState.filter((s) => s.id !== cleanId);
  if (homeSectionsState.length === prevLen) return false;
  persistSections();
  return true;
}
