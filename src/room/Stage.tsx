import { useEffect, useMemo, useRef, useState } from 'react';
import { Planet } from '../components/Planet';
import { eligibleTracks, fmt, trackStats, TRACK_LABEL } from '../lib/domain';
import type { Member, Track } from '../lib/types';
import { useTeam } from '../state/TeamContext';
import type { RoomApi } from './useRoom';

export const THROWABLES = [
  { item: '🐟', label: 'a fish' },
  { item: '🧊', label: 'an ice cube' },
  { item: '🔱', label: 'a trident' },
  { item: '🦑', label: 'a squid' },
  { item: '🐚', label: 'a shell' },
  { item: '🍩', label: 'a doughnut' },
];

export function useCountdown(endsAt: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000));
}

export function Orbit({ api, sessionId }: { api: RoomApi; sessionId: string }) {
  const { members, me, team } = useTeam();
  const { currentRound, roundMarks, roundVotes, voters, inRoom } = api;
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Who sits around the planet: everyone in the room, plus expected voters who aren't here (dimmed).
  const seats = useMemo(() => {
    const voterIds = new Set(voters.map((v) => v.id));
    return members
      .filter((m) => m.id === me.id || inRoom(m) || voterIds.has(m.id))
      .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id) || a.display_name.localeCompare(b.display_name));
  }, [members, me.id, inRoom, voters]);

  const revealed = currentRound?.status === 'revealed';
  const stats = useMemo(
    () => (revealed && currentRound ? currentRound.tracks.map((t) => trackStats(t, roundVotes, team.deck)) : []),
    [revealed, currentRound, roundVotes, team.deck],
  );
  const outliers = useMemo(() => {
    const s = new Map<string, 'low' | 'high'>();
    stats.forEach((st) => {
      st.low.forEach((v) => s.set(`${v.member_id}:${v.track}`, 'low'));
      st.high.forEach((v) => s.set(`${v.member_id}:${v.track}`, 'high'));
    });
    return s;
  }, [stats]);

  const totalExpected = currentRound
    ? voters.filter((m) => inRoom(m) || m.id === me.id).reduce((a, m) => a + eligibleTracks(m.roles, currentRound.tracks).length, 0)
    : 0;
  const totalIn = currentRound ? roundMarks.size : 0;
  const secs = useCountdown(currentRound?.status === 'voting' ? currentRound.timer_ends_at : null);

  const n = seats.length;
  return (
    <div className={`orbit ${n > 10 ? 'orbit-crowded' : ''}`} onClick={(e) => e.target === e.currentTarget && setMenuFor(null)}>
      <div className="orbit-ring" aria-hidden="true" />
      <div className="orbit-center">
        <Planet size={210} spin={currentRound?.status === 'voting'} />
        <div className="orbit-center-text" aria-live="polite">
          {!currentRound && <span className="center-small">Waiting for a vote</span>}
          {currentRound?.status === 'voting' && (
            <>
              <span className="center-big">
                {totalIn}
                <small>/{totalExpected}</small>
              </span>
              <span className="center-small">votes in</span>
              {secs !== null && <span className={`timer ${secs <= 10 ? 'timer-low' : ''}`}>{secs}s</span>}
            </>
          )}
          {revealed && (
            <span className="center-results">
              {stats.map((s) => (
                <span key={s.track} className={`center-track ${s.consensus ? 'consensus' : ''}`}>
                  <small>{TRACK_LABEL[s.track]}</small>
                  <strong>{s.votes.length ? fmt(s.avg) : '–'}</strong>
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      {seats.map((m, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
        const style = { left: `${50 + 43 * Math.cos(angle)}%`, top: `${50 + 41 * Math.sin(angle)}%` };
        return (
          <Seat
            key={m.id}
            m={m}
            style={style}
            isMe={m.id === me.id}
            present={m.id === me.id || inRoom(m)}
            tracks={currentRound ? eligibleTracks(m.roles, currentRound.tracks) : []}
            marks={roundMarks}
            votes={revealed ? roundVotes : []}
            outliers={outliers}
            menuOpen={menuFor === m.id}
            onToggleMenu={() => setMenuFor((x) => (x === m.id ? null : m.id))}
            canNudge={currentRound?.status === 'voting' && api.waitingOn.some((w) => w.id === m.id)}
            sessionId={sessionId}
          />
        );
      })}
    </div>
  );
}

function Seat({
  m,
  style,
  isMe,
  present,
  tracks,
  marks,
  votes,
  outliers,
  menuOpen,
  onToggleMenu,
  canNudge,
}: {
  m: Member;
  style: React.CSSProperties;
  isMe: boolean;
  present: boolean;
  tracks: Track[];
  marks: Set<string>;
  votes: { member_id: string; track: Track; value: string }[];
  outliers: Map<string, 'low' | 'high'>;
  menuOpen: boolean;
  onToggleMenu: () => void;
  canNudge: boolean;
  sessionId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className={`seat ${present ? '' : 'away'} ${isMe ? 'me' : ''}`} style={style} ref={ref}>
      <button className="seat-avatar" data-seat={m.id} onClick={onToggleMenu} aria-label={isMe ? 'Your seat: send a reaction' : `Fun with ${m.display_name}`} aria-expanded={menuOpen}>
        {m.avatar}
      </button>
      <span className="seat-name">{isMe ? 'You' : m.display_name}</span>
      {tracks.length > 0 && (
        <span className="seat-cards">
          {tracks.map((t) => {
            const v = votes.find((x) => x.member_id === m.id && x.track === t);
            const voted = marks.has(`${m.id}:${t}`);
            const out = outliers.get(`${m.id}:${t}`);
            return (
              <span
                key={t}
                className={`mini-card ${v ? 'shown' : voted ? 'down' : 'empty'} ${out ? `out-${out}` : ''}`}
                title={`${TRACK_LABEL[t]}: ${v ? v.value : voted ? 'voted' : 'not voted yet'}`}
              >
                <span className="mini-track">{t}</span>
                <span className="mini-val">{v ? v.value : voted ? '' : ''}</span>
              </span>
            );
          })}
        </span>
      )}
      {!present && <span className="seat-away">away</span>}
      {menuOpen && <SeatMenu m={m} isMe={isMe} canNudge={canNudge} onDone={onToggleMenu} />}
    </div>
  );
}

const QUICK_REACTIONS = ['👍', '🎉', '🤔', '😂', '🔥', '🫠', '☕', '🐙'];

function SeatMenu({ m, isMe, canNudge, onDone }: { m: Member; isMe: boolean; canNudge: boolean; onDone: () => void }) {
  const { me, sendFun, isFacilitator } = useTeam();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(`[data-seat="${m.id}"]`)) onDone();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [m.id, onDone]);

  if (isMe)
    return (
      <div className="seat-menu" ref={ref} role="menu">
        <p>Send a reaction</p>
        <div className="seat-menu-grid">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} role="menuitem" onClick={() => sendFun({ kind: 'react', from: me.id, emoji: e })}>
              {e}
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <div className="seat-menu" ref={ref} role="menu">
      <button
        className="seat-menu-wide"
        role="menuitem"
        onClick={() => {
          sendFun({ kind: 'poke', from: me.id, to: m.id, nudge: canNudge && isFacilitator });
          onDone();
        }}
      >
        👉 {canNudge && isFacilitator ? 'Nudge to vote' : `Poke ${m.display_name}`}
      </button>
      <p>Throw something</p>
      <div className="seat-menu-grid">
        {THROWABLES.map((t) => (
          <button key={t.item} role="menuitem" title={`Throw ${t.label}`} onClick={() => sendFun({ kind: 'throw', from: me.id, to: m.id, item: t.item })}>
            {t.item}
          </button>
        ))}
      </div>
    </div>
  );
}
