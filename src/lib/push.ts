import { supabase } from './supabase';

// VAPID public key — the browser needs this to subscribe. The private key
// lives only as an edge function secret and never reaches the client.
//
// This is exposed to the browser intentionally (VAPID public keys are
// public by design). If it's empty, push notifications are disabled and
// the UI falls back to in-page toasts + sound.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window;

export const pushConfigured = pushSupported && Boolean(VAPID_PUBLIC_KEY);

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr;
}

/**
 * Subscribe the current browser to push notifications for a given token.
 * Stores the subscription in the push_subscriptions table linked to the
 * token row. Returns true on success, false if push isn't supported or
 * permission was denied.
 */
export async function subscribeToPush(tokenId: string): Promise<boolean> {
  if (!pushSupported || !VAPID_PUBLIC_KEY) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;
  let sub: PushSubscription | null = null;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch {
    return false;
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await supabase
    .from('push_subscriptions')
    .insert({
      token_id: tokenId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });

  return !error;
}

/**
 * Trigger a push notification for a token by calling the send-push edge
 * function. The edge function looks up all push_subscriptions for the
 * token and sends the payload to each. Silent failure — the caller
 * doesn't need to know if push failed.
 */
export async function triggerPush(
  tokenId: string,
  payload: { title: string; body: string; tag?: string },
): Promise<void> {
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`;
  try {
    await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ token_id: tokenId, payload }),
    });
  } catch {
    // Silent — push is best-effort.
  }
}
