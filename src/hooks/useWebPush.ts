import { useCallback, useEffect, useState } from 'react';
import { api, useAuth } from '../lib/client';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function serializeSubscription(sub: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  };
}

export function useWebPush() {
  const { user } = useAuth();
  const [supported, setSupported] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const syncState = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const ua = window.navigator.userAgent.toLowerCase();
    const isIOS =
      /iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && 'ontouchend' in document);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    setIosNeedsInstall(isIOS && !isStandalone);

    const hasApis =
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(hasApis);
    if (!hasApis) return;

    setPermission(Notification.permission);

    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        setIsSubscribed(true);
        setEndpoint(existing.endpoint);
        const serialized = serializeSubscription(existing);
        if (serialized) {
          void api.pushSubscribe(serialized).catch(() => undefined);
        }
      } else {
        setIsSubscribed(false);
        setEndpoint(null);
      }
    } catch {
      setIsSubscribed(false);
      setEndpoint(null);
    }
  }, [user?.id]);

  useEffect(() => {
    void syncState();
  }, [syncState]);

  const subscribe = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    if (!supported) {
      return {
        ok: false,
        reason: iosNeedsInstall
          ? 'Sur iPhone/iPad, installez d’abord l’application sur l’écran d’accueil pour activer le Push.'
          : 'Votre navigateur ne prend pas en charge les notifications Push Web.',
      };
    }

    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        return {
          ok: false,
          reason:
            perm === 'denied'
              ? 'Les notifications sont bloquées dans les réglages de votre navigateur.'
              : 'Autorisation de notification refusée.',
        };
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await api.pushVapidKey();
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const serialized = serializeSubscription(sub);
      if (!serialized) {
        return { ok: false, reason: 'Clés d’abonnement Push incomplètes.' };
      }

      await api.pushSubscribe(serialized);
      setIsSubscribed(true);
      setEndpoint(serialized.endpoint);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'Activation Push impossible.',
      };
    } finally {
      setLoading(false);
    }
  }, [supported, iosNeedsInstall]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const ep = sub.endpoint;
        await sub.unsubscribe().catch(() => undefined);
        await api.pushUnsubscribe(ep).catch(() => undefined);
      }
      setIsSubscribed(false);
      setEndpoint(null);
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, [supported]);

  const sendTest = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setTesting(true);
    try {
      const res = await api.pushTest(endpoint);
      if (!res.ok) {
        return { ok: false, error: 'Le serveur push du navigateur a refusé la notification.' };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Échec du test Push.',
      };
    } finally {
      setTesting(false);
    }
  }, [endpoint]);

  return {
    supported,
    iosNeedsInstall,
    permission,
    isSubscribed,
    endpoint,
    loading,
    testing,
    subscribe,
    unsubscribe,
    sendTest,
    refresh: syncState,
  };
}
