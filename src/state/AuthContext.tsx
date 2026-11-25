import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

interface AuthCtx {
  ready: boolean;
  session: Session | null;
  user: User | null;
  /** true for guest (anonymous) sessions, false for manager accounts */
  isGuest: boolean;
  /** Make sure this browser has a session; creates a guest session if needed. */
  ensureSession: () => Promise<User>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
      // Clean the ?code= left by email confirmation / magic links.
      if (window.location.search.includes('code=')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    // After the laptop wakes up, make sure the token is fresh before anything else runs.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void supabase.auth.getSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const ensureSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user;
    const { data: anon, error } = await supabase.auth.signInAnonymously();
    if (error || !anon.user) throw error ?? new Error('Could not start a guest session');
    return anon.user;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      isGuest: Boolean(session?.user?.is_anonymous),
      ensureSession,
      signOut,
    }),
    [ready, session, ensureSession, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
