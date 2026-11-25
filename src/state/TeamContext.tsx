import type { RealtimeChannel } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onHeartbeat, supabase } from '../lib/supabase';
import type { ConnStatus, FunEvent, Member, PresenceInfo, Team } from '../lib/types';
import { withRetry } from '../lib/util';
import { useAuth } from './AuthContext';

type DbListener = (table: string) => void;
type FunListener = (e: FunEvent) => void;

interface TeamCtx {
  team: Team;
  members: Member[];
  me: Member;
  isOwner: boolean;
  isFacilitator: boolean;
  status: ConnStatus;
  /** member_id → rooms (session ids) they currently have open; '' = team page */
  online: Map<string, Set<string>>;
  memberById: (id: string) => Member | undefined;
  refreshTeam: () => Promise<void>;
  onDbChange: (fn: DbListener) => () => void;
  onFun: (fn: FunListener) => () => void;
  sendFun: (e: FunEvent) => void;
  /** Tell everyone to refetch (covers events realtime can't filter, like deletes). */
  pingSync: (table?: string) => void;
  setRoom: (sessionId: string | null) => void;
}

const Ctx = createContext<TeamCtx | null>(null);

/**
 * Remove a channel even when the server can't acknowledge (we're offline):
 * supabase.channel() reuses channels with the same topic, so a half-dead one
 * must be forgotten before we create a fresh one.
 */
async function dropChannel(ch: RealtimeChannel) {
  try {
    await Promise.race([supabase.removeChannel(ch), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    /* ignore */
  }
  try {
    ch.teardown();
  } catch {
    /* ignore */
  }
  const rt = supabase.realtime as unknown as { getChannels?: () => RealtimeChannel[]; _remove?: (c: RealtimeChannel) => void; channels?: RealtimeChannel[] };
  if (rt.getChannels?.().includes(ch)) {
    if (typeof rt._remove === 'function') rt._remove(ch);
    else if (Array.isArray(rt.channels)) rt.channels = rt.channels.filter((c) => c !== ch);
  }
}

const TABLES = ['teams', 'members', 'sessions', 'tickets', 'rounds', 'votes', 'vote_marks', 'guesses'];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-member'; teamName?: string }
  | { kind: 'ready'; team: Team; members: Member[] };

export function TeamProvider({ teamId, children, fallback }: { teamId: string; children: ReactNode; fallback: (s: LoadState) => ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [online, setOnline] = useState<Map<string, Set<string>>>(new Map());
  const dbListeners = useRef(new Set<DbListener>());
  const funListeners = useRef(new Set<FunListener>());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roomRef = useRef<string | null>(null);
  const statusRef = useRef<ConnStatus>('connecting');
  statusRef.current = status;

  const load = useCallback(async () => {
    if (!user) return;
    const [t, m] = await Promise.all([
      withRetry(() => supabase.from('teams').select('*').eq('id', teamId).maybeSingle()),
      withRetry(() => supabase.from('members').select('*').eq('team_id', teamId).order('created_at')),
    ]);
    if (t.error || m.error) {
      // Keep showing stale data during outages rather than blanking the screen.
      setState((s) => (s.kind === 'ready' ? s : { kind: 'error', message: (t.error ?? m.error)!.message }));
      return;
    }
    const members = (m.data ?? []) as Member[];
    if (!t.data || !members.some((x) => x.user_id === user.id)) {
      setState({ kind: 'not-member' });
      return;
    }
    setState({ kind: 'ready', team: t.data as Team, members });
  }, [teamId, user]);

  useEffect(() => {
    setState({ kind: 'loading' });
    void load();
  }, [load]);

  const me = state.kind === 'ready' ? state.members.find((x) => x.user_id === user?.id) : undefined;
  const meId = me?.id;

  // --- debounced team refetch on member/team changes
  const teamTimer = useRef<number>();
  const emitDb = useCallback(
    (table: string) => {
      if (table === '*' || table === 'members' || table === 'teams') {
        window.clearTimeout(teamTimer.current);
        teamTimer.current = window.setTimeout(() => void load(), 150);
      }
      dbListeners.current.forEach((fn) => fn(table));
    },
    [load],
  );
  const emitDbRef = useRef(emitDb);
  emitDbRef.current = emitDb;

  const recentFun = useRef(new Map<string, number[]>());
  const emitFun = useCallback((e: FunEvent) => {
    // Flood guard: at most 12 effects per sender per 5 s.
    const now = Date.now();
    const list = (recentFun.current.get(e.from) ?? []).filter((t) => now - t < 5000);
    if (list.length >= 12) return;
    list.push(now);
    recentFun.current.set(e.from, list);
    funListeners.current.forEach((fn) => fn(e));
  }, []);

  // --- realtime channel with reconnect, backoff, resync and watchdogs
  useEffect(() => {
    if (!meId) return;
    let disposed = false;
    let gen = 0;
    let attempt = 0;
    let retryTimer: number | undefined;
    let current: RealtimeChannel | null = null;

    const presencePayload = (): PresenceInfo => ({ member_id: meId, room: roomRef.current });

    const connect = async () => {
      if (disposed) return;
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      const my = ++gen;
      if (current) {
        const old = current;
        current = null;
        channelRef.current = null;
        await dropChannel(old);
        if (disposed || my !== gen) return;
      }
      setStatus(attempt === 0 && statusRef.current === 'connecting' ? 'connecting' : navigator.onLine ? 'reconnecting' : 'offline');

      const ch = supabase.channel(`team:${teamId}`, {
        config: { presence: { key: meId }, broadcast: { self: false } },
      });
      for (const table of TABLES) {
        ch.on(
          'postgres_changes' as any,
          { event: '*', schema: 'public', table, filter: table === 'teams' ? `id=eq.${teamId}` : `team_id=eq.${teamId}` },
          () => emitDbRef.current(table),
        );
      }
      ch.on('presence', { event: 'sync' }, () => {
        const map = new Map<string, Set<string>>();
        const st = ch.presenceState<PresenceInfo>();
        for (const [key, metas] of Object.entries(st)) {
          const rooms = new Set<string>();
          metas.forEach((m) => rooms.add(m.room ?? ''));
          map.set(key, rooms);
        }
        setOnline(map);
      });
      ch.on('broadcast', { event: 'fun' }, ({ payload }) => emitFun(payload as FunEvent));
      ch.on('broadcast', { event: 'sync' }, ({ payload }) => emitDbRef.current((payload as { table?: string })?.table ?? '*'));

      ch.subscribe((st) => {
        if (disposed || my !== gen) return;
        if (st === 'SUBSCRIBED') {
          attempt = 0;
          setStatus('live');
          void ch.track(presencePayload());
          // Anything could have happened while we were away: refetch everything.
          emitDbRef.current('*');
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          scheduleRetry();
        }
      });
      current = ch;
      channelRef.current = ch;
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      setStatus(navigator.onLine ? 'reconnecting' : 'offline');
      if (!navigator.onLine) return; // the 'online' event will reconnect us
      const delay = Math.min(15000, 800 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      attempt++;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, delay);
    };

    const onOnline = () => {
      attempt = 0;
      void connect();
    };
    const onOffline = () => setStatus('offline');
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      emitDbRef.current('*');
      if (statusRef.current !== 'live') onOnline();
    };

    // Socket-level heartbeat tells us early when the websocket died.
    const offHb = onHeartbeat((s) => {
      if (s === 'timeout' || s === 'disconnected' || s === 'error') {
        if (statusRef.current === 'live') setStatus(navigator.onLine ? 'reconnecting' : 'offline');
      }
    });

    // Watchdog: detect sleep/wake (timer gaps) and stuck channels; poll over HTTP while offline.
    let last = Date.now();
    const watchdog = window.setInterval(() => {
      const now = Date.now();
      const slept = now - last > 20000;
      last = now;
      if (slept) {
        attempt = 0;
        void connect();
        return;
      }
      const chState = current?.state;
      if (statusRef.current !== 'live' || (chState && chState !== 'joined' && chState !== 'joining')) {
        emitDbRef.current('*');
        if (!retryTimer && navigator.onLine && chState !== 'joining') void connect();
      }
    }, 8000);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    void connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(watchdog);
      offHb();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      if (current) void dropChannel(current);
      channelRef.current = null;
    };
  }, [teamId, meId, emitFun]);

  const send = useCallback((event: string, payload: unknown) => {
    const ch = channelRef.current;
    if (!ch || statusRef.current !== 'live') return;
    void ch.send({ type: 'broadcast', event, payload });
  }, []);

  const sendFun = useCallback(
    (e: FunEvent) => {
      emitFun(e); // local echo
      send('fun', e);
    },
    [emitFun, send],
  );
  const pingSync = useCallback((table?: string) => send('sync', { table: table ?? '*' }), [send]);

  const setRoom = useCallback((sessionId: string | null) => {
    roomRef.current = sessionId;
    const ch = channelRef.current;
    if (ch && meId && statusRef.current === 'live') void ch.track({ member_id: meId, room: sessionId });
  }, [meId]);

  const onDbChange = useCallback((fn: DbListener) => {
    dbListeners.current.add(fn);
    return () => {
      dbListeners.current.delete(fn);
    };
  }, []);
  const onFun = useCallback((fn: FunListener) => {
    funListeners.current.add(fn);
    return () => {
      funListeners.current.delete(fn);
    };
  }, []);

  const value = useMemo<TeamCtx | null>(() => {
    if (state.kind !== 'ready' || !me) return null;
    const isOwner = state.team.owner_id === user?.id;
    return {
      team: state.team,
      members: state.members,
      me,
      isOwner,
      isFacilitator: isOwner || me.is_owner || me.is_facilitator,
      status,
      online,
      memberById: (id) => state.members.find((m) => m.id === id),
      refreshTeam: load,
      onDbChange,
      onFun,
      sendFun,
      pingSync,
      setRoom,
    };
  }, [state, me, user?.id, status, online, load, onDbChange, onFun, sendFun, pingSync, setRoom]);

  if (!value) return <>{fallback(state)}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTeam() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTeam outside TeamProvider');
  return v;
}
export function useOptionalTeam() {
  return useContext(Ctx);
}
export type { LoadState };
