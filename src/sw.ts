import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

interface SwManifestEntry {
  url: string;
  revision: string | null;
}

interface SwWindowClient {
  url: string;
  focused?: boolean;
  focus: () => Promise<SwWindowClient>;
  navigate?: (url: string) => Promise<SwWindowClient | null>;
}

interface SwExtendableEvent extends Event {
  waitUntil: (f: Promise<unknown>) => void;
}

interface SwPushEvent extends SwExtendableEvent {
  data: {
    json: () => unknown;
    text: () => string;
  } | null;
}

interface SwNotificationEvent extends SwExtendableEvent {
  notification: {
    close: () => void;
    data?: { url?: string };
  };
}

interface SwScope {
  __WB_MANIFEST?: Array<SwManifestEntry | string>;
  location: Location;
  registration: {
    showNotification: (
      title: string,
      options?: NotificationOptions & { renotify?: boolean; data?: Record<string, unknown> }
    ) => Promise<void>;
  };
  clients: {
    matchAll: (options?: { type?: 'window' | 'worker' | 'sharedworker' | 'all'; includeUncontrolled?: boolean }) => Promise<SwWindowClient[]>;
    openWindow: (url: string) => Promise<SwWindowClient | null>;
  };
  skipWaiting: () => Promise<void>;
  addEventListener: {
    (type: 'push', listener: (event: SwPushEvent) => void): void;
    (type: 'notificationclick', listener: (event: SwNotificationEvent) => void): void;
    (type: 'message', listener: (event: MessageEvent) => void): void;
  };
}

declare const self: SwScope;

self.skipWaiting();
clientsClaim();

const manifest = self.__WB_MANIFEST ?? [];
cleanupOutdatedCaches();
precacheAndRoute(manifest);

const hasPrecachedIndex = manifest.some((entry) => {
  const url = typeof entry === 'string' ? entry : entry.url;
  return url === 'index.html' || url === '/index.html';
});

if (hasPrecachedIndex) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL('/index.html'), {
      denylist: [/^\/api\//],
    })
  );
}

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

self.addEventListener('message', (event) => {
  if (event.data && (event.data as { type?: string }).type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  let title = 'StreamWall';
  let body = 'Nouvelle notification disponible.';
  let icon = '/pwa-192x192.png';
  let badge = '/favicon.png';
  let url = '/';
  let tag = 'streamwall-push';

  if (event.data) {
    try {
      const parsed = event.data.json() as {
        title?: string;
        body?: string;
        icon?: string;
        badge?: string;
        url?: string;
        tag?: string;
      };
      if (parsed && typeof parsed === 'object') {
        if (parsed.title) title = String(parsed.title);
        if (parsed.body) body = String(parsed.body);
        if (parsed.icon) icon = String(parsed.icon);
        if (parsed.badge) badge = String(parsed.badge);
        if (parsed.url) url = String(parsed.url);
        if (parsed.tag) tag = String(parsed.tag);
      }
    } catch {
      const fallback = event.data.text();
      if (fallback) body = fallback;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || '/';
  let targetUrl = new URL('/', self.location.origin).href;
  try {
    targetUrl = new URL(rawUrl, self.location.origin).href;
  } catch {
    targetUrl = new URL('/', self.location.origin).href;
  }

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin)) {
          if (client.navigate) {
            await client.navigate(targetUrl).catch(() => undefined);
          }
          await client.focus();
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })()
  );
});
