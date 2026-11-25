import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Globe,
  Monitor,
  Plus,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MenuAuthRule, MenuIconKey, MenuLinkConfig } from '../shared/types';
import { api } from '../lib/client';
import {
  getMenuIcon,
  MENU_AUTH_RULE_LABELS,
  MENU_ICON_OPTIONS,
} from '../lib/menuIcons';

function isValidMenuTarget(raw: string): boolean {
  const val = raw.trim();
  if (!val) return false;
  if (/^\/[a-zA-Z0-9/_-]*$/.test(val)) return true;
  if (/^https?:\/\//i.test(val) && !/[\s\r\n\0]/.test(val)) {
    try {
      const parsed = new URL(val);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }
  return false;
}

export function AdminNavigationTab() {
  const queryClient = useQueryClient();
  const navQuery = useQuery({
    queryKey: ['admin-navigation'],
    queryFn: () => api.adminNavigation(),
  });

  const [items, setItems] = useState<MenuLinkConfig[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newIcon, setNewIcon] = useState<MenuIconKey>('film');
  const [newAuthRule, setNewAuthRule] = useState<MenuAuthRule>('all');
  const [newDesktop, setNewDesktop] = useState(true);
  const [newMobile, setNewMobile] = useState(true);
  const [newFooter, setNewFooter] = useState(false);

  useEffect(() => {
    if (navQuery.data?.items) {
      setItems([...navQuery.data.items].sort((a, b) => a.order - b.order));
    }
  }, [navQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (nextItems: MenuLinkConfig[]) =>
      api.adminSaveNavigation({ items: nextItems }),
    onSuccess: (res) => {
      setItems([...res.items].sort((a, b) => a.order - b.order));
      void queryClient.invalidateQueries({ queryKey: ['admin-navigation'] });
      void queryClient.invalidateQueries({ queryKey: ['site-navigation'] });
      toast.success('Menus enregistrés (ordinateur, mobile & pied de page)');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Erreur d’enregistrement'),
  });

  const resetMutation = useMutation({
    mutationFn: () => api.adminResetNavigation(),
    onSuccess: (res) => {
      setItems([...res.items].sort((a, b) => a.order - b.order));
      void queryClient.invalidateQueries({ queryKey: ['admin-navigation'] });
      void queryClient.invalidateQueries({ queryKey: ['site-navigation'] });
      toast.success('Menus réinitialisés par défaut');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Réinitialisation impossible'),
  });

  function updateItem(id: string, patch: Partial<MenuLinkConfig>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function moveItem(index: number, direction: -1 | 1) {
    setItems((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy.map((it, idx) => ({ ...it, order: (idx + 1) * 10 }));
    });
  }

  function removeItem(id: string) {
    setItems((prev) =>
      prev
        .filter((it) => it.id !== id)
        .map((it, idx) => ({ ...it, order: (idx + 1) * 10 }))
    );
  }

  function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    const path = newPath.trim();
    if (!label || !isValidMenuTarget(path)) {
      toast.error(
        'Indiquez un libellé et une URL valide : chemin interne (/c/drama) ou lien externe (https://t.me/...).'
      );
      return;
    }
    const id = `nav_${Date.now().toString(36)}`;
    const maxOrder = items.reduce((m, it) => Math.max(m, it.order), 0);
    setItems((prev) => [
      ...prev,
      {
        id,
        label,
        path,
        icon: newIcon,
        exact: path === '/',
        enabled: true,
        desktop: newDesktop,
        mobile: newMobile,
        footer: newFooter,
        order: maxOrder + 10,
        authRule: newAuthRule,
      },
    ]);
    setNewLabel('');
    setNewPath('');
  }

  function applyTelegramFooterPreset() {
    setNewLabel('Telegram');
    setNewPath('https://t.me/');
    setNewIcon('send');
    setNewAuthRule('all');
    setNewDesktop(false);
    setNewMobile(false);
    setNewFooter(true);
  }

  const desktopCount = items.filter((i) => i.enabled && i.desktop).length;
  const mobileCount = items.filter((i) => i.enabled && i.mobile).length;
  const footerCount = items.filter((i) => i.enabled && i.footer).length;

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Gestion des menus & du pied de page (Footer)
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Configurez l’ordre, les icônes, les permissions d’affichage et les liens internes ou externes ({desktopCount} PC · {mobileCount}/8 mobile · {footerCount} footer).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" />
              <span>Réinitialiser par défaut</span>
            </button>
            <button
              type="button"
              disabled={saveMutation.isPending || items.length === 0}
              onClick={() => saveMutation.mutate(items)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Save className="size-3.5" />
              <span>{saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer les menus'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Live Preview Strips */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Monitor className="size-4 text-primary" />
            <span>Aperçu barre ordinateur</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-background px-4 py-2.5 text-xs">
            {items
              .filter((i) => i.enabled && i.desktop)
              .map((i) => (
                <span key={i.id} className="font-medium text-foreground/90">
                  {i.label}
                </span>
              ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Smartphone className="size-4 text-primary" />
            <span>Aperçu dock mobile (max 8)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            {items
              .filter((i) => i.enabled && i.mobile)
              .slice(0, 8)
              .map((i) => {
                const Icon = getMenuIcon(i.icon);
                return (
                  <span
                    key={i.id}
                    className="inline-flex flex-col items-center gap-1 rounded-lg bg-card px-2.5 py-1.5 text-[10px] font-medium text-foreground"
                  >
                    <Icon className="size-4 text-primary" />
                    <span>{i.label}</span>
                  </span>
                );
              })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Globe className="size-4 text-primary" />
            <span>Aperçu pied de page (Footer)</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-4 py-2.5 text-xs">
            {items
              .filter((i) => i.enabled && i.footer)
              .map((i) => {
                const isExternal = /^https?:\/\//i.test(i.path);
                return (
                  <span
                    key={i.id}
                    className="inline-flex items-center gap-1 font-medium text-foreground/90"
                  >
                    <span>{i.label}</span>
                    {isExternal && <ExternalLink className="size-3 text-primary" />}
                  </span>
                );
              })}
          </div>
        </div>
      </section>

      {/* Add new custom menu or footer link */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-semibold text-foreground">
              Ajouter un lien personnalisé (Menu ou Footer)
            </h3>
            <p className="text-xs text-muted-foreground">
              Accepte un chemin interne (<code className="font-mono">/c/drama</code>) ou une URL externe (<code className="font-mono">https://t.me/...</code>) pour le pied de page.
            </p>
          </div>
          <button
            type="button"
            onClick={applyTelegramFooterPreset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/60 hover:bg-accent"
          >
            <Send className="size-3.5 text-primary" />
            <span>Prérégler : Lien Telegram (Footer)</span>
          </button>
        </div>

        <form onSubmit={handleAddLink} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">Libellé</span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              maxLength={36}
              placeholder="Ex : Telegram, Drama…"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </label>

          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">Chemin ou URL externe</span>
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              maxLength={400}
              placeholder="/c/drama ou https://t.me/..."
              className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </label>

          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">Icône</span>
            <select
              value={newIcon}
              onChange={(e) => setNewIcon(e.target.value as MenuIconKey)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              {MENU_ICON_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            <span className="mb-1 block font-medium text-muted-foreground">Visibilité</span>
            <select
              value={newAuthRule}
              onChange={(e) => setNewAuthRule(e.target.value as MenuAuthRule)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              {Object.entries(MENU_AUTH_RULE_LABELS).map(([k, lbl]) => (
                <option key={k} value={k}>
                  {lbl}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-3 pb-1.5 text-xs text-foreground">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newDesktop}
                onChange={(e) => setNewDesktop(e.target.checked)}
                className="accent-primary"
              />
              <span>PC</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newMobile}
                onChange={(e) => setNewMobile(e.target.checked)}
                className="accent-primary"
              />
              <span>Mobile</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newFooter}
                onChange={(e) => setNewFooter(e.target.checked)}
                className="accent-primary"
              />
              <span>Footer</span>
            </label>
          </div>

          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="size-3.5" />
            <span>Ajouter</span>
          </button>
        </form>
      </section>

      {/* Editable Links List */}
      <section className="space-y-3">
        {items.map((item, idx) => {
          const Icon = getMenuIcon(item.icon);
          return (
            <div
              key={item.id}
              className={`rounded-xl border bg-card p-4 transition-colors ${
                item.enabled ? 'border-border' : 'border-border/50 opacity-65'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{item.label}</span>
                      {item.systemKey && (
                        <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border border-border">
                          Système
                        </span>
                      )}
                      {item.customModuleSlug && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          API : {item.customModuleSlug}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">{item.path}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveItem(idx, -1)}
                    aria-label="Monter"
                    className="rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === items.length - 1}
                    onClick={() => moveItem(idx, 1)}
                    aria-label="Descendre"
                    className="rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  {!item.systemKey && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      aria-label="Supprimer le lien"
                      className="rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-center pt-3 border-t border-border/60">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Libellé</span>
                  <input
                    value={item.label}
                    maxLength={36}
                    onChange={(e) => updateItem(item.id, { label: e.target.value })}
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Chemin / URL</span>
                  <input
                    value={item.path}
                    maxLength={400}
                    disabled={Boolean(item.isAccount)}
                    onChange={(e) => updateItem(item.id, { path: e.target.value })}
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Icône</span>
                  <select
                    value={item.icon}
                    onChange={(e) =>
                      updateItem(item.id, { icon: e.target.value as MenuIconKey })
                    }
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {MENU_ICON_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Règle d’accès</span>
                  <select
                    value={item.authRule}
                    onChange={(e) =>
                      updateItem(item.id, { authRule: e.target.value as MenuAuthRule })
                    }
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {Object.entries(MENU_AUTH_RULE_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex flex-wrap items-center gap-3 text-xs text-foreground pt-3 sm:pt-0">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) => updateItem(item.id, { enabled: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>Actif</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.desktop}
                      onChange={(e) => updateItem(item.id, { desktop: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>PC</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.mobile}
                      onChange={(e) => updateItem(item.id, { mobile: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>Mobile</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.footer}
                      onChange={(e) => updateItem(item.id, { footer: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>Footer</span>
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
