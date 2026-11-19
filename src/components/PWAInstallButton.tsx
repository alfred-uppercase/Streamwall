import React, { useState } from 'react';
import { Download, PlusSquare, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { useSiteConfig } from '../lib/siteConfig';

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const { siteName } = useSiteConfig();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        aria-label={`Installer ${siteName}`}
        title={`Installer ${siteName} sur votre appareil`}
        className={
          compact
            ? 'inline-flex h-10 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 whitespace-nowrap shrink-0'
            : 'inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0'
        }
      >
        <Download className="size-4 shrink-0" />
        <span className={compact ? 'hidden sm:inline' : ''}>Installer l’app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label={`Installer ${siteName} sur iOS`}
          title={`Ajouter ${siteName} à l’écran d’accueil`}
          className={
            compact
              ? 'inline-flex h-10 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 whitespace-nowrap shrink-0'
              : 'inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-3.5 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 whitespace-nowrap shrink-0'
          }
        >
          <Smartphone className="size-4 shrink-0" />
          <span className={compact ? 'hidden sm:inline' : ''}>Installer</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Installer ${siteName} sur iPhone ou iPad`}
              className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                    <Smartphone className="size-4" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Installer {siteName}
                  </h3>
                </div>
                <button
                  type="button"
                  aria-label="Fermer"
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              <ol className="space-y-3 text-xs leading-relaxed text-muted-foreground">
                <li className="flex items-start gap-2.5">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 font-semibold text-primary">
                    1
                  </span>
                  <span>
                    Appuyez sur le bouton <strong className="text-foreground">Partager</strong>{' '}
                    <Share className="inline size-3.5 text-primary align-text-bottom" /> dans la barre de Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 font-semibold text-primary">
                    2
                  </span>
                  <span>
                    Faites défiler et touchez{' '}
                    <strong className="text-foreground">Sur l’écran d’accueil</strong>{' '}
                    <PlusSquare className="inline size-3.5 text-primary align-text-bottom" />.
                  </span>
                </li>
              </ol>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                Compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-24 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-card/95 px-3 py-2 text-xs font-medium text-amber-300 shadow-xl backdrop-blur md:bottom-4"
    >
      <WifiOff className="size-3.5 shrink-0 text-amber-400" />
      <span>Mode hors ligne — Données en cache</span>
    </div>
  );
}
