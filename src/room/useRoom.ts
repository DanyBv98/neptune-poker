import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { eligibleTracks, parseTicketLine } from '../lib/domain';
import { supabase } from '../lib/supabase';
import type { Estimates, Guess, Member, Round, Session, Ticket, TicketKind, Track, Vote, VoteMark } from '../lib/types';
import { errorText, isNetworkError, withRetry } from '../lib/util';
import { useTeam } from '../state/TeamContext';
import { useToast } from '../state/Toasts';

export interface Snapshot {
  session: Session;
  tickets: Ticket[];
  rounds: Round[];
  votes: Vote[];
  marks: VoteMark[];
  guesses: Guess[];
}

type PendingVote = { round_id: string; track: Track; value: string };
const PENDING_KEY = 'neptune-poker-pending-votes';

function loadPending(memberId: string): Record<string, PendingVote> {
  try {
    return JSON.parse(sessionStorage.getItem(`${PENDING_KEY}:${memberId}`) || '{}');
  } catch {
    return {};
  }
}
function savePending(memberId: string, p: Record<string, PendingVote>) {
  try {
    sessionStorage.setItem(`${PENDING_KEY}:${memberId}`, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function useRoom(sessionId: string) {
  const { team, members, me, status, onDbChange, pingSync, online } = useTeam();
  const toast = useToast();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const hasSnap = useRef(false);

  // ---------------------------------------------------------------- loading
  const load = useCallback(async () => {
    const my = ++seq.current;
    const [s, t, r, v, mk, g] = await Promise.all([
      withRetry(() => supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle()),
      withRetry(() => supabase.from('tickets').select('*').eq('session_id', sessionId).order('position').order('created_at')),
      withRetry(() => supabase.from('rounds').select('*').eq('session_id', sessionId).order('started_at')),
      withRetry(() => supabase.from('votes').select('id, round_id, member_id, track, value').eq('session_id', sessionId)),
      withRetry(() => supabase.from('vote_marks').select('round_id, member_id, track').eq('session_id', sessionId)),
      withRetry(() => supabase.from('guesses').select('round_id, member_id, track, value').eq('session_id', sessionId)),
    ]);
    if (my !== seq.current) return; // a newer load already started
    const err = s.error ?? t.error ?? r.error ?? v.error ?? mk.error ?? g.error;
    if (err) {
      if (!hasSnap.current) setError(errorText(err));
      return; // keep showing the last good state
    }
    if (!s.data) {
      setError('This session doesn’t exist or was deleted.');
      return;
    }
    hasSnap.current = true;
    setError(null);
    setSnap({
      session: s.data as Session,
      tickets: (t.data ?? []) as Ticket[],
      rounds: (r.data ?? []) as Round[],
      votes: (v.data ?? []) as Vote[],
      marks: (mk.data ?? []) as VoteMark[],
      guesses: ((g.data ?? []) as Guess[]).map((x) => ({ ...x, value: Number(x.value) })),
    });
  }, [sessionId]);

  useEffect(() => {
    hasSnap.current = false;
    setSnap(null);
    setError(null);
    void load();
    let timer: number | undefined;
    const off = onDbChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 120);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [load, onDbChange]);

  // ---------------------------------------------------------------- derived
  const tickets = snap?.tickets ?? [];
  const currentTicket = tickets.find((t) => t.id === snap?.session.current_ticket_id) ?? null;
  const rawRound = snap?.rounds.find((r) => r.id === snap.session.current_round_id) ?? null;
  const currentRound = rawRound && rawRound.status !== 'cancelled' && rawRound.ticket_id === currentTicket?.id ? rawRound : null;

  // optimistic votes: `${round}:${track}` → value
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, PendingVote>>(() => loadPending(me.id));

  const myVotes = useMemo(() => {
    const out: Partial<Record<Track, string>> = {};
    if (!currentRound) return out;
    for (const v of snap?.votes ?? []) if (v.round_id === currentRound.id && v.member_id === me.id) out[v.track] = v.value;
    for (const p of Object.values(pending)) if (p.round_id === currentRound.id) out[p.track] = p.value;
    for (const [k, val] of Object.entries(optimistic)) {
      const [rid, track] = k.split(':');
      if (rid === currentRound.id) out[track as Track] = val;
    }
    return out;
  }, [snap?.votes, optimistic, pending, currentRound, me.id]);

  // Drop optimistic entries the server has confirmed.
  useEffect(() => {
    if (!snap) return;
    setOptimistic((o) => {
      const next = { ...o };
      let changed = false;
      for (const k of Object.keys(next)) {
        const [rid, track] = k.split(':');
        const server = snap.votes.find((v) => v.round_id === rid && v.member_id === me.id && v.track === track);
        const round = snap.rounds.find((r) => r.id === rid);
        if ((server && server.value === next[k] && !pending[k]) || !round || round.status !== 'voting') {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : o;
    });
  }, [snap, me.id, pending]);

  const roundMarks = useMemo(() => {
    const set = new Set<string>();
    if (!currentRound) return set;
    snap?.marks.forEach((m) => m.round_id === currentRound.id && set.add(`${m.member_id}:${m.track}`));
    Object.keys(myVotes).forEach((t) => set.add(`${me.id}:${t}`));
    return set;
  }, [snap?.marks, currentRound, myVotes, me.id]);

  const roundVotes = useMemo(
    () => (currentRound ? (snap?.votes ?? []).filter((v) => v.round_id === currentRound.id) : []),
    [snap?.votes, currentRound],
  );
  const roundGuesses = useMemo(
    () => (currentRound ? (snap?.guesses ?? []).filter((g) => g.round_id === currentRound.id) : []),
    [snap?.guesses, currentRound],
  );

  // Presence only means something while the live connection is up; otherwise assume everyone is here.
  const inRoom = useCallback((m: Member) => status !== 'live' || Boolean(online.get(m.id)?.has(sessionId)), [online, sessionId, status]);
  const voters = useMemo(
    () => (currentRound ? members.filter((m) => eligibleTracks(m.roles, currentRound.tracks).length > 0) : []),
    [members, currentRound],
  );
  /** Votes still expected from people who are in the room. */
  const waitingOn = useMemo(() => {
    if (!currentRound) return [] as Member[];
    return voters.filter((m) => (inRoom(m) || m.id === me.id) && eligibleTracks(m.roles, currentRound.tracks).some((t) => !roundMarks.has(`${m.id}:${t}`)));
  }, [voters, currentRound, roundMarks, inRoom, me.id]);

  // ---------------------------------------------------------------- voting with offline queue
  const sendVote = useCallback(
    async (p: PendingVote) =>
      supabase
        .from('votes')
        .upsert(
          { team_id: team.id, session_id: sessionId, round_id: p.round_id, member_id: me.id, track: p.track, value: p.value },
          { onConflict: 'round_id,member_id,track' },
        ),
    [team.id, sessionId, me.id],
  );

  const setPendingBoth = useCallback(
    (fn: (p: Record<string, PendingVote>) => Record<string, PendingVote>) =>
      setPending((p) => {
        const next = fn(p);
        savePending(me.id, next);
        return next;
      }),
    [me.id],
  );

  const castVote = useCallback(
    async (track: Track, value: string) => {
      if (!currentRound || currentRound.status !== 'voting') return;
      const key = `${currentRound.id}:${track}`;
      const p = { round_id: currentRound.id, track, value };
      setOptimistic((o) => ({ ...o, [key]: value }));
      const { error } = await sendVote(p);
      if (!error) {
        setPendingBoth((x) => {
          const { [key]: _drop, ...rest } = x;
          return rest;
        });
        return;
      }
      if (isNetworkError(error)) {
        setPendingBoth((x) => ({ ...x, [key]: p }));
        toast('Vote saved on this device — it’ll be sent when you reconnect.', { tone: 'warn', icon: '📡' });
      } else {
        setOptimistic((o) => {
          const { [key]: _drop, ...rest } = o;
          return rest;
        });
        toast(errorText(error), { tone: 'bad' });
        void load();
      }
    },
    [currentRound, sendVote, setPendingBoth, toast, load],
  );

  // Flush queued votes whenever we're back online.
  const flushing = useRef(false);
  useEffect(() => {
    // Retry on every fresh snapshot unless we know we're offline (HTTP may work even when websockets don't).
    if (status === 'offline' || !snap || flushing.current) return;
    const entries = Object.entries(pending);
    if (!entries.length) return;
    flushing.current = true;
    void (async () => {
      for (const [key, p] of entries) {
        const round = snap.rounds.find((r) => r.id === p.round_id);
        if (!round || round.status !== 'voting') {
          setPendingBoth((x) => {
            const { [key]: _d, ...rest } = x;
            return rest;
          });
          if (round) toast('A vote you cast offline arrived after the round closed, so it wasn’t counted.', { tone: 'warn' });
          continue;
        }
        const { error } = await sendVote(p);
        if (!error || !isNetworkError(error)) {
          setPendingBoth((x) => {
            const { [key]: _d, ...rest } = x;
            return rest;
          });
          if (!error) toast('Offline vote sent', { tone: 'good', icon: '✅' });
        }
      }
      flushing.current = false;
    })();
  }, [status, snap, pending, sendVote, setPendingBoth, toast]);

  const guess = useCallback(
    async (track: Track, value: number) => {
      if (!currentRound) return;
      const { error } = await supabase
        .from('guesses')
        .upsert({ round_id: currentRound.id, member_id: me.id, track, value, team_id: team.id, session_id: sessionId }, { onConflict: 'round_id,member_id,track' });
      if (error) toast(errorText(error), { tone: 'bad' });
      else void load();
    },
    [currentRound, me.id, team.id, sessionId, toast, load],
  );

  // ---------------------------------------------------------------- facilitator actions
  const run = useCallback(
    async (p: PromiseLike<{ error: unknown; data?: unknown }>, okMsg?: string) => {
      const { error, data } = await p;
      if (error) {
        toast(errorText(error), { tone: 'bad' });
        return { ok: false as const, data: undefined };
      }
      if (okMsg) toast(okMsg, { tone: 'good' });
      await load();
      pingSync();
      return { ok: true as const, data };
    },
    [toast, load, pingSync],
  );

  const actions = useMemo(
    () => ({
      addTickets: async (text: string) => {
        const parsed = text.split('\n').map(parseTicketLine).filter((x): x is NonNullable<typeof x> => Boolean(x));
        if (!parsed.length) return false;
        const base = Math.max(0, ...tickets.map((t) => t.position)) + 1;
        const rows = parsed.map((p, i) => ({
          team_id: team.id,
          session_id: sessionId,
          title: p.title,
          url: p.url,
          kind: p.kind,
          qa_needed: p.qaNeeded,
          position: base + i,
        }));
        const res = await run(supabase.from('tickets').insert(rows), rows.length > 1 ? `Added ${rows.length} tickets` : undefined);
        // First ticket of an empty session becomes current automatically.
        if (res.ok && !snap?.session.current_ticket_id) {
          const { data } = await supabase.from('tickets').select('id').eq('session_id', sessionId).eq('status', 'pending').order('position').limit(1);
          if (data?.[0]) await run(supabase.from('sessions').update({ current_ticket_id: data[0].id, current_round_id: null }).eq('id', sessionId));
        }
        return res.ok;
      },
      updateTicket: (id: string, patch: Partial<Pick<Ticket, 'title' | 'url' | 'kind' | 'qa_needed' | 'status' | 'position'>>) =>
        run(supabase.from('tickets').update(patch).eq('id', id)),
      deleteTicket: (id: string) => run(supabase.from('tickets').delete().eq('id', id)),
      moveTicket: async (id: string, dir: -1 | 1) => {
        const idx = tickets.findIndex((t) => t.id === id);
        const other = tickets[idx + dir];
        if (idx < 0 || !other) return;
        const a = tickets[idx];
        const pa = a.position === other.position ? other.position + dir : other.position;
        await run(supabase.from('tickets').update({ position: pa }).eq('id', a.id));
        await run(supabase.from('tickets').update({ position: a.position }).eq('id', other.id));
      },
      selectTicket: async (id: string) => {
        if (currentRound?.status === 'voting') await supabase.rpc('cancel_round', { p_round: currentRound.id });
        const t = tickets.find((x) => x.id === id);
        // Show the latest revealed round of an already-estimated ticket.
        const last = snap?.rounds.filter((r) => r.ticket_id === id && r.status === 'revealed').pop();
        return run(
          supabase
            .from('sessions')
            .update({ current_ticket_id: id, current_round_id: t?.status === 'estimated' || t?.status === 'revealed' ? last?.id ?? null : null })
            .eq('id', sessionId),
        );
      },
      startRound: async (ticket: Ticket, scope: TicketKind, tracks: Track[], timer: number | null) => {
        if (scope !== ticket.kind) await supabase.from('tickets').update({ kind: scope }).eq('id', ticket.id);
        return run(supabase.rpc('start_round', { p_ticket: ticket.id, p_tracks: tracks, p_timer_seconds: timer }));
      },
      reveal: (roundId: string) => run(supabase.rpc('reveal_round', { p_round: roundId })),
      cancelRound: (roundId: string) => run(supabase.rpc('cancel_round', { p_round: roundId })),
      saveEstimate: (ticketId: string, est: Estimates, advance: boolean) =>
        run(supabase.rpc('save_estimate', { p_ticket: ticketId, p_estimates: est, p_advance: advance }), 'Estimate saved'),
      setSessionStatus: (s: 'active' | 'closed') =>
        run(
          supabase
            .from('sessions')
            .update({ status: s, closed_at: s === 'closed' ? new Date().toISOString() : null, ...(s === 'closed' ? { current_round_id: null } : {}) })
            .eq('id', sessionId),
          s === 'closed' ? 'Session closed and saved to history' : 'Session reopened',
        ),
      renameSession: (name: string) => run(supabase.from('sessions').update({ name }).eq('id', sessionId)),
    }),
    [run, tickets, team.id, sessionId, snap, currentRound],
  );

  return {
    snap,
    error,
    reload: load,
    tickets,
    currentTicket,
    currentRound,
    myVotes,
    pendingCount: Object.keys(pending).length,
    roundMarks,
    roundVotes,
    roundGuesses,
    voters,
    waitingOn,
    inRoom,
    castVote,
    guess,
    actions,
  };
}

export type RoomApi = ReturnType<typeof useRoom>;
