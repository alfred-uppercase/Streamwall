import { getStoredToken } from './client';

const recentReportedKeys = new Map<string, number>();
const DEDUP_WINDOW_MS = 30_000;

function shouldThrottle(key: string): boolean {
  const now = Date.now();
  const prev = recentReportedKeys.get(key);
  if (prev && now - prev < DEDUP_WINDOW_MS) {
    return true;
  }
  recentReportedKeys.set(key, now);
  if (recentReportedKeys.size > 50) {
    const firstKey = recentReportedKeys.keys().next().value;
    if (firstKey) recentReportedKeys.delete(firstKey);
  }
  return false;
}

function isIgnoredBrowserNoise(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('resizeobserver loop') ||
    lower.includes('websocket') ||
    lower.includes('vite-hmr') ||
    lower.includes('script error.')
  );
}

export function reportClientError(input: {
  level?: 'warn' | 'error' | 'fatal';
  message: string;
  stack?: string | null;
  route?: string;
  context?: Record<string, unknown>;
}): void {
  if (typeof window === 'undefined') return;
  const message = String(input.message || '').trim();
  if (!message || isIgnoredBrowserNoise(message)) return;

  const route = input.route || `${window.location.pathname}${window.location.search}`;
  const dedupKey = `${input.level || 'error'}:${route}:${message.slice(0, 120)}`;
  if (shouldThrottle(dedupKey)) return;

  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const body = JSON.stringify({
    level: input.level || 'error',
    message: message.slice(0, 800),
    stack: input.stack ? String(input.stack).slice(0, 3500) : null,
    route: route.slice(0, 280),
    context: input.context ?? null,
  });

  void fetch('/api/client-errors', {
    method: 'POST',
    headers,
    body,
    keepalive: true,
  }).catch(() => undefined);
}

let listenersInstalled = false;

export function installGlobalErrorListeners(): void {
  if (typeof window === 'undefined' || listenersInstalled) return;
  listenersInstalled = true;

  window.addEventListener('error', (event) => {
    const message = event.error instanceof Error ? event.error.message : event.message;
    const stack = event.error instanceof Error ? event.error.stack : null;
    reportClientError({
      level: 'error',
      message: message || 'Erreur JavaScript non interceptée',
      stack: stack || (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null),
      context: { kind: 'window.error' },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : `Rejet de promesse non géré : ${String(reason)}`;
    const stack = reason instanceof Error ? reason.stack : null;
    reportClientError({
      level: 'error',
      message,
      stack,
      context: { kind: 'unhandledrejection' },
    });
  });
}
