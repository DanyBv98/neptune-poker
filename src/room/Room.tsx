import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Modal, Spinner } from '../components/ui';
import { cleanTitle, eligibleTracks, trackStats } from '../lib/domain';
import { inviteLink } from '../lib/supabase';
import { copyText, flashTitle, setBaseTitle, sfx, usePrefs } from '../lib/util';
import { useTeam } from '../state/TeamContext';
import { useToast } from '../state/Toasts';
import { FunLayer, FunZone, type FeedItem } from './Fun';
import { SessionSummary } from './History';
import { FinalEstimate, Results, StartPanel, TicketHeader, VotePanel, VotingControls } from './Panels';
import { Orbit, useCountdown } from './Stage';
import { TicketQueue } from './TicketQueue';
import { useRoom } from './useRoom';

export function Room() {
  const { sessionId = '' } = useParams();
  const { team, me, isFacilitator, setRoom, members, status } = useTeam();
  const api = useRoom(sessionId);
  const { snap, error, currentTicket, currentRound, waitingOn, actions, roundMarks, voters } = api;
  const [view, setView] = useState<'table' | 'summary'>('table');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [celebrate, setCelebrate] = useState(0);
  const [prefs, setPrefs] = usePrefs();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feedSeq = useRef(0);
  const toast = useToast();
  const nav = useNavigate();

  const copyInvite = async () => {
    if (await copyText(inviteLink(team.invite_code))) toast('Invite link copied. Anyone with it can join the team.', { tone: 'good', icon: '📋' });
  };

  useEffect(() => {
    setRoom(sessionId);
    return () => setRoom(null);
  }, [sessionId, setRoom]);
  useEffect(() => {
    if (snap) setBaseTitle(`${snap.session.name} · ${team.name}`);
  }, [snap?.session.name, team.name]);

  const pushFeed = useCallback((text: string) => {
    setFeed((f) => [{ id: ++feedSeq.current, text, at: Date.now() }, ...f].slice(0, 30));
  }, []);

  // React to round transitions: sounds, tab title, confetti on consensus.
  const prev = useRef<{ id: string | null; status: string | null } | null>(null);
  useEffect(() => {
    if (!snap) return;
    const id = currentRound?.id ?? null;
    const st = currentRound?.status ?? null;
    const p = prev.current;
    prev.current = { id, status: st };
    if (!p) return; // first load: don't announce what was already going on
    if (id && st === 'voting' && p.id !== id) {
      const mine = eligibleTracks(me.roles, currentRound!.tracks).length > 0;
      pushFeed(`🗳️ Voting started on ${cleanTitle(currentTicket?.title ?? 'a ticket')}`);
      if (mine) {
        sfx.ding();
        flashTitle('🗳️ Your vote is needed');
      }
    }
    if (id && st === 'revealed' && p.id === id && p.status === 'voting') {
      sfx.reveal();
      const stats = currentRound!.tracks.map((t) => trackStats(t, api.roundVotes, team.deck));
      if (stats.some((s) => s.consensus)) {
        setCelebrate((c) => c + 1);
        pushFeed('🔱 Consensus!');
      }
    }
  }, [currentRound?.id, currentRound?.status, snap, api.roundVotes, me.roles, currentTicket?.title, pushFeed, team.deck, currentRound]);

  // Facilitator automation: reveal when everyone present has voted, or when the timer runs out.
  const secs = useCountdown(currentRound?.status === 'voting' ? currentRound.timer_ends_at : null);
  const revealing = useRef<string | null>(null);
  useEffect(() => {
    if (!isFacilitator || !currentRound || currentRound.status !== 'voting' || revealing.current === currentRound.id) return;
    // Presence is only trustworthy while live, so auto-reveal waits for a healthy connection.
    const allIn = prefs.autoReveal && status === 'live' && roundMarks.size > 0 && waitingOn.length === 0 && voters.length > 0;
    const timeUp = secs === 0;
    if (!allIn && !timeUp) return;
    const roundId = currentRound.id;
    const t = window.setTimeout(() => {
      revealing.current = roundId;
      void actions.reveal(roundId);
    }, timeUp ? 0 : 1200);
    return () => window.clearTimeout(t);
  }, [isFacilitator, currentRound, roundMarks.size, waitingOn.length, voters.length, secs, prefs.autoReveal, actions, status]);

  if (error && !snap)
    return (
      <Shell>
        <section className="panel narrow">
          <h1>Couldn’t open this session</h1>
          <p className="lede small">{error}</p>
          <Link to={`/t/${team.id}`} className="btn btn-quiet">
            Back to {team.name}
          </Link>
        </section>
      </Shell>
    );
  if (!snap) return <Shell><Spinner label="Entering the room" /></Shell>;

  const closed = snap.session.status === 'closed';
  const deleteDialog = confirmDelete && (
    <DeleteSessionDialog
      name={snap.session.name}
      tickets={snap.tickets.length}
      estimated={snap.tickets.filter((t) => t.status === 'estimated').length}
      onClose={() => setConfirmDelete(false)}
      onConfirm={async () => {
        if (!(await actions.deleteSession())) return;
        toast('Session deleted', { tone: 'good' });
        nav(`/t/${team.id}`);
      }}
    />
  );
  const deleteButton = isFacilitator && (
    <button className="btn btn-danger btn-small" onClick={() => setConfirmDelete(true)}>
      Delete session
    </button>
  );
  const crumbs = (
    <>
      <Link to={`/t/${team.id}`}>Sessions</Link>
      <span aria-hidden="true">/</span>
      <span>{snap.session.name}</span>
    </>
  );

  if (closed)
    return (
      <Shell crumbs={crumbs}>
        <div className="closed-head">
          <p className="notice">This session is closed. Its estimates are saved below.</p>
          {isFacilitator && (
            <button className="btn btn-quiet" onClick={() => void actions.setSessionStatus('active')}>
              Reopen session
            </button>
          )}
          {deleteButton}
        </div>
        <SessionSummary snap={snap} />
        {deleteDialog}
      </Shell>
    );

  const voting = currentRound?.status === 'voting';
  const revealed = currentRound?.status === 'revealed';
  const iVote = currentRound ? eligibleTracks(me.roles, currentRound.tracks).length > 0 : false;

  return (
    <Shell crumbs={crumbs} wide>
      <div className="room-bar">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
            Table
          </button>
          <button role="tab" aria-selected={view === 'summary'} className={view === 'summary' ? 'on' : ''} onClick={() => setView('summary')}>
            Summary
          </button>
        </div>
        {api.pendingCount > 0 && <span className="pending-note">{api.pendingCount} vote waiting to send</span>}
        {isFacilitator && (
          <div className="room-bar-right">
            <label className="check" title="Reveal as soon as everyone in the room has voted">
              <input type="checkbox" checked={prefs.autoReveal} onChange={(e) => setPrefs({ autoReveal: e.target.checked })} /> Auto-reveal
            </label>
            <button className="btn btn-quiet btn-small" onClick={copyInvite} title="Copy the team invite link to share with people who haven’t joined yet">
              🔗 Copy invite link
            </button>
            <button
              className="btn btn-quiet btn-small"
              onClick={() => {
                if (window.confirm('Close this session? It moves to history; you can reopen it later.')) void actions.setSessionStatus('closed');
              }}
            >
              Close session
            </button>
            {deleteButton}
          </div>
        )}
      </div>

      {view === 'summary' ? (
        <SessionSummary snap={snap} />
      ) : (
        <div className="room">
          <TicketQueue api={api} closed={closed} />

          <section className="stage" aria-label="Voting table">
            {currentTicket ? (
              <TicketHeader ticket={currentTicket} roundNo={currentRound?.round_no} />
            ) : (
              <div className="ticket-header empty-head">
                <h2>{isFacilitator ? (api.tickets.length ? 'Pick a ticket from the list to start' : 'Add tickets to get going') : 'Waiting for the next ticket'}</h2>
              </div>
            )}

            <Orbit api={api} sessionId={sessionId} />

            {voting && <VotePanel api={api} />}
            {voting && <VotingControls api={api} />}
            {voting && !iVote && !isFacilitator && waitingOn.length > 0 && (
              <p className="hint center">Waiting on {waitingOn.map((w) => w.display_name).join(', ')}</p>
            )}
            {revealed && <Results api={api} />}

            {currentTicket && !voting && !revealed && (
              <>
                {currentTicket.status === 'estimated' && <FinalEstimate ticket={currentTicket} />}
                {isFacilitator ? (
                  <StartPanel api={api} ticket={currentTicket} again={currentTicket.status === 'estimated'} />
                ) : (
                  <p className="hint center">The facilitator will start the vote in a moment.</p>
                )}
              </>
            )}
            {members.length === 1 && isFacilitator && (
              <p className="hint center">
                You’re alone here.{' '}
                <button className="btn btn-link" onClick={copyInvite}>
                  Copy the invite link
                </button>{' '}
                to bring your crew.
              </p>
            )}
          </section>

          <FunZone feed={feed} />
        </div>
      )}
      <FunLayer pushFeed={pushFeed} celebrate={celebrate} />
      {deleteDialog}
    </Shell>
  );
}

function DeleteSessionDialog({
  name,
  tickets,
  estimated,
  onClose,
  onConfirm,
}: {
  name: string;
  tickets: number;
  estimated: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Delete this session?" onClose={onClose}>
      <div className="form-grid">
        <p>
          <strong>{name}</strong> will be deleted for everyone, together with its {tickets} {tickets === 1 ? 'ticket' : 'tickets'}
          {estimated > 0 && ` (${estimated} estimated)`}, every round and every vote. This can’t be undone.
        </p>
        <p className="hint">To keep the estimates in history, close the session instead.</p>
        <div className="modal-actions">
          <button className="btn btn-quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
          >
            {busy ? 'Deleting…' : 'Delete session'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
