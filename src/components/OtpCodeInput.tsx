import React, { useEffect, useRef } from 'react';

interface OtpCodeInputProps {
  digits: string[];
  onChange: (next: string[]) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}

export function OtpCodeInput({
  digits,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
  ariaLabel = 'Code de vérification à 6 chiffres',
}: OtpCodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) {
      const t = window.setTimeout(() => refs.current[0]?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [autoFocus]);

  function handleChange(index: number, rawValue: string) {
    const digitsOnly = rawValue.replace(/\D/g, '');
    if (digitsOnly.length > 1) {
      const next = [...digits];
      for (let i = 0; i < 6 && index + i < 6; i++) {
        next[index + i] = digitsOnly[i] ?? '';
      }
      onChange(next);
      const nextFocus = Math.min(5, index + digitsOnly.length);
      refs.current[nextFocus]?.focus();
      const joined = next.join('');
      if (joined.length === 6 && !disabled && onComplete) {
        onComplete(joined);
      }
      return;
    }

    const next = [...digits];
    next[index] = digitsOnly;
    onChange(next);
    if (digitsOnly && index < 5) {
      refs.current[index + 1]?.focus();
    }
    const joined = next.join('');
    if (joined.length === 6 && !disabled && onComplete) {
      onComplete(joined);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      onChange(next);
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    onChange(next);
    refs.current[Math.min(5, pasted.length - 1)]?.focus();
    if (pasted.length === 6 && !disabled && onComplete) {
      onComplete(pasted);
    }
  }

  return (
    <div className="flex justify-center gap-2" aria-label={ariaLabel}>
      {digits.map((digit, idx) => (
        <input
          key={idx}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={idx === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          value={digit}
          disabled={disabled}
          aria-label={`Chiffre ${idx + 1} sur 6`}
          onChange={(e) => handleChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={handlePaste}
          className="h-11 w-10 rounded-lg border border-input bg-background text-center font-mono text-lg font-bold text-foreground tabular-nums focus:border-primary focus:ring-2 focus:ring-primary/25 focus:outline-none disabled:opacity-50 sm:h-12 sm:w-11 sm:text-xl"
        />
      ))}
    </div>
  );
}
