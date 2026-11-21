import React from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';

export interface CaptchaChallengeProps {
  svgDataUri: string | null;
  loading: boolean;
  answer: string;
  onAnswerChange: (val: string) => void;
  onRefresh: () => void;
  honeypot: string;
  onHoneypotChange: (val: string) => void;
  disabled?: boolean;
}

export function CaptchaChallenge({
  svgDataUri,
  loading,
  answer,
  onAnswerChange,
  onRefresh,
  honeypot,
  onHoneypotChange,
  disabled = false,
}: CaptchaChallengeProps) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/60 p-3">
      {/* Honeypot anti-bot invisible (masqué visuellement et hors navigation clavier) */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-9999px',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        <label>
          Site web
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => onHoneypotChange(e.target.value)}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-primary" />
          <span>Code de sécurité (CAPTCHA)</span>
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || disabled}
          aria-label="Actualiser le code CAPTCHA"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
          <span>Changer</span>
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex h-[68px] w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-slate-950 sm:w-[200px]">
          {svgDataUri ? (
            <img
              src={svgDataUri}
              alt="Code de sécurité à recopier"
              className="h-full w-full select-none object-contain"
              draggable={false}
            />
          ) : (
            <span className="text-xs text-muted-foreground">Chargement…</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            type="text"
            required
            minLength={4}
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="Code (5 car.)"
            aria-label="Recopiez le code de sécurité affiché dans l'image"
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-center font-mono text-sm font-bold tracking-[0.22em] uppercase text-foreground placeholder:tracking-normal placeholder:font-sans placeholder:font-normal placeholder:normal-case focus:border-primary focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            3 tentatives max. avant blocage temporaire.
          </p>
        </div>
      </div>
    </div>
  );
}
