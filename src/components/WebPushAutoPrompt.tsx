import { useEffect, useRef } from 'react';
import { useWebPush } from '../hooks/useWebPush';

const AUTO_PROMPT_SESSION_KEY = 'tapenaka_push_autoprompt_v1';

export function WebPushAutoPrompt() {
  const { supported, iosNeedsInstall, permission, isSubscribed, subscribe } = useWebPush();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!supported || iosNeedsInstall) return;

    // Already granted on this browser: ensure push subscription is registered silently
    if (permission === 'granted' && !isSubscribed) {
      void subscribe();
      return;
    }

    if (permission !== 'default' || attemptedRef.current) return;

    try {
      if (sessionStorage.getItem(AUTO_PROMPT_SESSION_KEY) === '1') {
        return;
      }
      sessionStorage.setItem(AUTO_PROMPT_SESSION_KEY, '1');
    } catch {
      // Ignore storage errors
    }

    attemptedRef.current = true;

    let fallbackAttached = false;
    let cancelled = false;

    const triggerPrompt = async () => {
      if (cancelled || Notification.permission !== 'default') return;
      const res = await subscribe();
      // Some browsers reject Notification.requestPermission() without an active user gesture;
      // fall back to prompting on the very first interaction if permission stayed 'default'.
      if (!cancelled && !res.ok && Notification.permission === 'default' && !fallbackAttached) {
        fallbackAttached = true;
        const onFirstGesture = () => {
          window.removeEventListener('pointerdown', onFirstGesture);
          window.removeEventListener('keydown', onFirstGesture);
          if (!cancelled && Notification.permission === 'default') {
            void subscribe();
          }
        };
        window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
        window.addEventListener('keydown', onFirstGesture, { once: true });
      }
    };

    const timer = window.setTimeout(() => {
      void triggerPrompt();
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [supported, iosNeedsInstall, permission, isSubscribed, subscribe]);

  return null;
}
