import { useEffect, useState } from 'react';

const ERROR_TEXT: Record<string, string> = {
  invalid_invite: 'This invite link isn’t valid any more. Ask your team manager for a new one.',
  invalid_token: 'This login link isn’t valid any more. Ask your team manager to send you a new one.',
  owner_must_sign_in: 'This profile belongs to the team manager. Sign in with the manager account instead.',
  signed_in_as_owner: 'This browser is signed in as the team manager. Open the link in a private window to log in as someone else.',
  manager_account_required: 'Creating a team needs a manager account. Sign in with email first.',
  forbidden: 'Only the team manager or a co-host can do that.',
  session_closed: 'This session is closed. Reopen it to keep estimating.',
  no_tracks: 'Pick at least one estimate to vote on.',
  not_authenticated: 'Your session expired. Reload the page to continue.',
};

export function errorText(err: unknown): string {
  if (!err) return 'Something went wrong.';
  const e = err as { message?: string; code?: string };
  const msg = e.message ?? String(err);
  for (const k of Object.keys(ERROR_TEXT)) if (msg.includes(k)) return ERROR_TEXT[k];
  if (e.code === '42501' || msg.includes('row-level security')) return 'That change isn’t allowed right now — the round may have just closed.';
  if (isNetworkError(err)) return 'Couldn’t reach the server. Check your connection; we’ll keep retrying.';
  if (msg.includes('Anonymous sign-ins are disabled'))
    return 'Guest sign-in is turned off for this Supabase project. The admin needs to enable Anonymous sign-ins.';
  return msg;
}

export function isNetworkError(err: unknown) {
  const e = err as { message?: string; code?: string } | null;
  if (!e) return false;
  const msg = e.message ?? '';
  return (
    (!e.code && /fetch|network|load failed|timeout|offline/i.test(msg)) ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  );
}

/** Retry a Supabase call a few times on network errors. Returns the last result. */
export async function withRetry<T extends { error: unknown }>(fn: () => PromiseLike<T>, tries = 3): Promise<T> {
  let res = await fn();
  for (let i = 1; i < tries && res.error && isNetworkError(res.error); i++) {
    await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    res = await fn();
  }
  return res;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function relTime(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

// ---------------------------------------------------------------- local prefs
type Prefs = { sound: boolean; effects: boolean; autoReveal: boolean };
const PREF_KEY = 'neptune-poker-prefs';
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  try {
    return { sound: true, effects: true, autoReveal: true, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
  } catch {
    return { sound: true, effects: true, autoReveal: true };
  }
}
export function setPrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...getPrefs(), ...p }));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}
export function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [prefs, set] = useState(getPrefs);
  useEffect(() => {
    const l = () => set(getPrefs());
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return [prefs, setPrefs];
}

// ---------------------------------------------------------------- sounds (synthesised, no assets)
let ctx: AudioContext | null = null;
function audio() {
  if (!getPrefs().sound) return null;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}
function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}
export const sfx = {
  pop: () => tone(520 + Math.random() * 300, 0.12, 'sine', 0.07, 1200),
  poke: () => tone(300, 0.25, 'triangle', 0.1, 120),
  hit: () => tone(180, 0.18, 'square', 0.05, 60),
  ding: () => {
    tone(880, 0.35, 'sine', 0.06);
    setTimeout(() => tone(1320, 0.4, 'sine', 0.05), 120);
  },
  reveal: () => {
    tone(440, 0.2, 'triangle', 0.06, 660);
    setTimeout(() => tone(660, 0.3, 'triangle', 0.05, 990), 140);
  },
};

// ---------------------------------------------------------------- tab title attention
let baseTitle = typeof document !== 'undefined' ? document.title : '';
let flashTimer: number | undefined;
export function setBaseTitle(t: string) {
  baseTitle = t;
  if (!flashTimer) document.title = t;
}
export function flashTitle(msg: string) {
  if (typeof document === 'undefined' || !document.hidden) return;
  window.clearInterval(flashTimer);
  let on = true;
  flashTimer = window.setInterval(() => {
    document.title = on ? msg : baseTitle;
    on = !on;
  }, 1000);
  const stop = () => {
    if (!document.hidden) {
      window.clearInterval(flashTimer);
      flashTimer = undefined;
      document.title = baseTitle;
      document.removeEventListener('visibilitychange', stop);
    }
  };
  document.addEventListener('visibilitychange', stop);
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
