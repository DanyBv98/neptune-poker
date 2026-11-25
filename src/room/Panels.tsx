import { useEffect, useMemo, useState } from 'react';
import { KindChip } from '../components/ui';
import { cardNumber, DECKS, eligibleTracks, fmt, KIND_LABEL, sumEstimates, trackStats, TRACK_LABEL, tracksFor } from '../lib/domain';
import type { Estimates, Ticket, TicketKind, Track } from '../lib/types';
import { cleanTitle } from '../lib/domain';
import { useTeam } from '../state/TeamContext';
import type { RoomApi } from './useRoom';

// ------------------------------------------------------------------ ticket header
export function TicketHeader({ ticket, roundNo }: { ticket: Ticket; roundNo?: number }) {
  return (
    <div className="ticket-header">
      <KindChip kind={ticket.kind} />
      <h2>
        {ticket.url ? (
          <a href={ticket.url} target="_blank" rel="noreferrer">
            {cleanTitle(ticket.title)}
          </a>
        ) : (
          cleanTitle(ticket.title)
        )}
      </h2>
      {roundNo && roundNo > 1 && <span className="round-no">Round {roundNo}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ start a round (facilitator)
const TIMERS = [
  { v: 0, label: 'No timer' },
  { v: 30, label: '30 s' },
  { v: 60, label: '1 min' },
  { v: 120, label: '2 min' },
  { v: 180, label: '3 min' },
];

export function StartPanel({ api, ticket, again }: { api: RoomApi; ticket: Ticket; again?: boolean }) {
  const { members } = useTeam();
  const [scope, setScope] = useState<TicketKind>(ticket.kind === 'UNSET' ? 'FE' : ticket.kind);
  const [qa, setQa] = useState(ticket.kind === 'QA' ? true : ticket.qa_needed);
  const [timer, setTimer] = useState(() => Number(localStorage.getItem('np-timer') ?? 0));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setScope(ticket.kind === 'UNSET' ? 'FE' : ticket.kind);
    setQa(ticket.kind === 'QA' ? true : ticket.qa_needed);
  }, [ticket.id, ticket.kind, ticket.qa_needed]);

  const tracks = tracksFor(scope, qa);
  const byTrack = tracks.map((t) => ({ t, people: members.filter((m) => eligibleTracks(m.roles, [t]).length) }));
  const doubleVoters = scope === 'FS' ? members.filter((m) => m.roles.includes('FS')) : [];

  const start = async () => {
    setBusy(true);
    localStorage.setItem('np-timer', String(timer));
    await api.actions.startRound(ticket, scope, tracks, timer || null);
    setBusy(false);
  };

  return (
    <div className="start-panel">
      <div className="field">
        <span>Who builds it{ticket.kind === 'UNSET' && <em className="needs-pick"> — no tag in the name, pick one</em>}</span>
        <div className="segmented" role="radiogroup" aria-label="Development scope">
          {(['FE', 'BE', 'FS', 'QA'] as TicketKind[]).map((k) => (
            <button key={k} role="radio" aria-checked={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="start-row">
        <label className={`check ${scope === 'QA' ? 'disabled' : ''}`}>
          <input type="checkbox" checked={scope === 'QA' || qa} disabled={scope === 'QA'} onChange={(e) => setQa(e.target.checked)} /> QA needed
        </label>
        <label className="inline-select">
          Timer
          <select value={timer} onChange={(e) => setTimer(Number(e.target.value))}>
            {TIMERS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="track-preview">
        {byTrack.map(({ t, people }) => (
          <li key={t}>
            <strong>{TRACK_LABEL[t]} estimate</strong>
            <span>{people.length ? people.map((p) => p.display_name).join(', ') : 'nobody has this role yet'}</span>
          </li>
        ))}
        {doubleVoters.length > 0 && <li className="hint">Fullstack devs ({doubleVoters.map((d) => d.display_name).join(', ')}) vote twice: frontend and backend.</li>}
      </ul>
      <button className="btn btn-primary btn-big" onClick={start} disabled={busy}>
        {busy ? 'Starting…' : again ? 'Vote again' : 'Start voting'}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ my cards
export function VotePanel({ api }: { api: RoomApi }) {
  const { me, team } = useTeam();
  const { currentRound, myVotes, castVote } = api;
  if (!currentRound || currentRound.status !== 'voting') return null;
  const mine = eligibleTracks(me.roles, currentRound.tracks);
  const cards = DECKS[team.deck].cards;
  if (!mine.length) return <GuessPanel api={api} />;
  return (
    <div className="vote-panel">
      {mine.map((t) => (
        <div key={t} className="vote-track">
          <h3>
            Your {TRACK_LABEL[t].toLowerCase()} estimate
            {myVotes[t] && <span className="voted-note">voted {myVotes[t]} — tap another card to change</span>}
          </h3>
          <div className="deck" role="radiogroup" aria-label={`${TRACK_LABEL[t]} estimate`}>
            {cards.map((c) => (
              <button key={c} role="radio" aria-checked={myVotes[t] === c} className={`card ${myVotes[t] === c ? 'picked' : ''}`} onClick={() => void castVote(t, c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      ))}
      {mine.length === 2 && <p className="hint">You’re fullstack on a fullstack ticket, so you vote for both frontend and backend.</p>}
    </div>
  );
}

function GuessPanel({ api }: { api: RoomApi }) {
  const { me } = useTeam();
  const { currentRound, roundGuesses, guess } = api;
  const [vals, setVals] = useState<Record<string, string>>({});
  if (!currentRound) return null;
  return (
    <div className="vote-panel guess-panel">
      <h3>You’re not voting on this one</h3>
      <p className="hint">Predict the team’s average instead. Closest guess wins bragging rights at the reveal.</p>
      <div className="guess-row">
        {currentRound.tracks.map((t) => {
          const g = roundGuesses.find((x) => x.member_id === me.id && x.track === t);
          return (
            <form
              key={t}
              className="guess"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(vals[t]);
                if (Number.isFinite(n) && n >= 0) void guess(t, n);
              }}
            >
              <label>
                {TRACK_LABEL[t]} average
                <input type="number" min={0} step={0.5} inputMode="decimal" value={vals[t] ?? (g ? String(g.value) : '')} onChange={(e) => setVals({ ...vals, [t]: e.target.value })} />
              </label>
              <button className="btn btn-quiet">{g ? 'Update' : 'Guess'}</button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ facilitator controls while voting
export function VotingControls({ api }: { api: RoomApi }) {
  const { isFacilitator, me, sendFun } = useTeam();
  const { currentRound, waitingOn, actions } = api;
  if (!isFacilitator || !currentRound || currentRound.status !== 'voting') return null;
  const others = waitingOn.filter((w) => w.id !== me.id);
  return (
    <div className="controls">
      <button className="btn btn-primary" onClick={() => void actions.reveal(currentRound.id)}>
        Reveal cards
      </button>
      <button
        className="btn btn-quiet"
        disabled={!others.length}
        onClick={() => others.forEach((w) => sendFun({ kind: 'poke', from: me.id, to: w.id, nudge: true }))}
        title={others.map((w) => w.display_name).join(', ')}
      >
        {others.length ? `Nudge ${others.length} waiting` : 'Everyone’s voted'}
      </button>
      <button className="btn btn-link" onClick={() => void actions.cancelRound(currentRound.id)}>
        Cancel round
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ results + final estimate
export function Results({ api }: { api: RoomApi }) {
  const { team, isFacilitator, memberById } = useTeam();
  const { currentRound, currentTicket, roundVotes, roundGuesses, actions } = api;
  const stats = useMemo(
    () => (currentRound ? currentRound.tracks.map((t) => trackStats(t, roundVotes, team.deck)) : []),
    [currentRound, roundVotes, team.deck],
  );
  const [final, setFinal] = useState<Estimates>({});
  useEffect(() => {
    const init: Estimates = {};
    stats.forEach((s) => {
      const saved = currentTicket?.estimates?.[s.track];
      init[s.track] = saved ?? s.suggestion ?? undefined;
    });
    setFinal(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound?.id, currentTicket?.id, roundVotes.length]);

  if (!currentRound || currentRound.status !== 'revealed' || !currentTicket) return null;
  const name = (id: string) => memberById(id)?.display_name ?? 'someone';
  const total = sumEstimates(final, team.deck);
  const cards = DECKS[team.deck].cards.filter((c) => cardNumber(c) !== null || team.deck === 'tshirt');

  return (
    <div className="results">
      <div className="results-grid">
        {stats.map((s) => {
          const maxCount = Math.max(1, ...s.distribution.map((d) => d.count));
          const guesses = roundGuesses.filter((g) => g.track === s.track);
          const winner =
            s.avg !== null && guesses.length
              ? guesses.reduce((best, g) => (Math.abs(g.value - s.avg!) < Math.abs(best.value - s.avg!) ? g : best))
              : null;
          return (
            <section key={s.track} className={`result-card ${s.consensus ? 'consensus' : ''}`}>
              <header>
                <h3>{TRACK_LABEL[s.track]}</h3>
                {s.consensus && <span className="consensus-badge">Everyone agrees</span>}
              </header>
              {s.votes.length === 0 ? (
                <p className="hint">No votes.</p>
              ) : (
                <>
                  <div className="result-numbers">
                    <span>
                      <strong>{fmt(s.avg)}</strong>
                      <small>average</small>
                    </span>
                    <span>
                      <strong>{fmt(s.median)}</strong>
                      <small>median</small>
                    </span>
                    <span>
                      <strong>{s.votes.length}</strong>
                      <small>{s.votes.length === 1 ? 'vote' : 'votes'}</small>
                    </span>
                  </div>
                  <ul className="dist">
                    {s.distribution.map((d) => (
                      <li key={d.value}>
                        <span className="dist-val">{d.value}</span>
                        <span className="dist-bar">
                          <span style={{ width: `${(d.count / maxCount) * 100}%` }} />
                        </span>
                        <span className="dist-who">
                          {s.votes
                            .filter((v) => v.value === d.value)
                            .map((v) => memberById(v.member_id)?.avatar ?? '•')
                            .join(' ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {s.low.length > 0 && s.high.length > 0 && (
                    <p className="talk">
                      Hear from {s.low.map((v) => name(v.member_id)).join(' & ')} ({s.min}) and {s.high.map((v) => name(v.member_id)).join(' & ')} ({s.max}).
                    </p>
                  )}
                  {winner && (
                    <p className="guess-win">
                      🔮 Closest prediction: {name(winner.member_id)} guessed {fmt(winner.value)}
                    </p>
                  )}
                </>
              )}
              {isFacilitator && (
                <label className="final-pick">
                  Final
                  <select value={final[s.track] ?? ''} onChange={(e) => setFinal({ ...final, [s.track]: e.target.value || undefined })}>
                    <option value="">—</option>
                    {cards.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </section>
          );
        })}
      </div>
      {isFacilitator && (
        <div className="controls">
          <button className="btn btn-primary" onClick={() => void actions.saveEstimate(currentTicket.id, clean(final), true)}>
            Save{total !== null && stats.length > 1 ? ` ${total} points` : ''} and go to next ticket
          </button>
          <button className="btn btn-quiet" onClick={() => void actions.saveEstimate(currentTicket.id, clean(final), false)}>
            Save only
          </button>
          <ReVote api={api} />
        </div>
      )}
      {!isFacilitator && currentTicket.status === 'estimated' && <FinalEstimate ticket={currentTicket} />}
    </div>
  );
}

function ReVote({ api }: { api: RoomApi }) {
  const { currentRound, currentTicket, actions } = api;
  if (!currentRound || !currentTicket) return null;
  return (
    <button className="btn btn-link" onClick={() => void actions.startRound(currentTicket, currentTicket.kind, currentRound.tracks, null)}>
      Re-vote
    </button>
  );
}

const clean = (e: Estimates) => Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Estimates;

export function FinalEstimate({ ticket }: { ticket: Ticket }) {
  const { team } = useTeam();
  const entries = Object.entries(ticket.estimates ?? {}) as [Track, string][];
  if (!entries.length) return null;
  const total = sumEstimates(ticket.estimates, team.deck);
  return (
    <div className="final-estimate">
      <span>Estimated</span>
      {entries.map(([t, v]) => (
        <span key={t} className="est-chip">
          {t} <strong>{v}</strong>
        </span>
      ))}
      {total !== null && entries.length > 1 && (
        <span className="est-chip total">
          total <strong>{total}</strong>
        </span>
      )}
    </div>
  );
}
