import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

type HeartbeatListener = (status: string) => void;
const heartbeatListeners = new Set<HeartbeatListener>();

/** Subscribe to low-level socket heartbeats ('ok' | 'timeout' | 'disconnected' | 'error' …). */
export function onHeartbeat(fn: HeartbeatListener) {
  heartbeatListeners.add(fn);
  return () => heartbeatListeners.delete(fn);
}

export const supabase: SupabaseClient = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // PKCE puts ?code= in the query string, which doesn't collide with hash routes.
    flowType: 'pkce',
    storageKey: 'neptune-poker-auth',
  },
  realtime: {
    // A worker keeps heartbeats running while the tab is in the background,
    // so browsers throttling timers don't silently drop us.
    worker: true,
    heartbeatIntervalMs: 15000,
    heartbeatCallback: (status) => heartbeatListeners.forEach((fn) => fn(String(status))),
    reconnectAfterMs: (tries: number) => [500, 1000, 2000, 4000, 8000][tries - 1] ?? 10000,
    params: { eventsPerSecond: 20 },
  },
});

/** Base URL for share links (works under any sub-path, e.g. GitHub Pages). */
export function appBaseUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}
export const inviteLink = (code: string) => `${appBaseUrl()}#/join/${code}`;
export const loginLink = (token: string) => `${appBaseUrl()}#/login/${token}`;
