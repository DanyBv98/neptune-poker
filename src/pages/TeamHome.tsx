import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Avatar, CopyField, Modal, RoleBadges } from '../components/ui';
import { DECKS, sumEstimates, THEMES } from '../lib/domain';
import { inviteLink, loginLink, supabase } from '../lib/supabase';
import type { DeckId, Member, Session, ThemeId, Ticket } from '../lib/types';
import { errorText, relTime, setBaseTitle } from '../lib/util';
import { useTeam } from '../state/TeamContext';
import { useToast } from '../state/Toasts';

interface SessionRow extends Session {
  tickets: Pick<Ticket, 'id' | 'status' | 'estimates'>[];
}

export function TeamHome() {
  const { team, members, me, isFacilitator, isOwner, online, onDbChange, setRoom, pingSync } = useTeam();
  const toast = useToast();
  const nav = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [newName, setNewName] = useState('');
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRoom(null);
    setBaseTitle(`${team.name} · planning poker`);
  }, [setRoom, team.name]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*, tickets(id, status, estimates)')
      .eq('team_id', team.id)
      .order('created_at', { ascending: false })
      .limit(60);
    if (data) setSessions(data as SessionRow[]);
  }, [team.id]);
  useEffect(() => {
    void load();
    let t: number | undefined;
    const off = onDbChange((table) => {
      if (['*', 'sessions', 'tickets'].includes(table)) {
        window.clearTimeout(t);
        t = window.setTimeout(() => void load(), 200);
      }
    });
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [load, onDbChange]);

  const createSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const name = newName.trim() || `Refinement ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    const { data, error } = await supabase.from('sessions').insert({ team_id: team.id, name }).select().single();
    setBusy(false);
    if (error) return toast(errorText(error), { tone: 'bad' });
    pingSync('sessions');
    nav(`/t/${team.id}/s/${data.id}`);
  };

  const active = sessions?.filter((s) => s.status === 'active') ?? [];
  const closed = sessions?.filter((s) => s.status === 'closed') ?? [];
  const inRoom = (sid: string) => members.filter((m) => online.get(m.id)?.has(sid));

  return (
    <Shell>
      <div className="team-grid">
        <section className="panel">
          <div className="panel-head">
            <h1>Refinement sessions</h1>
            {isOwner && (
              <button className="btn btn-quiet" onClick={() => setSettings(true)}>
                Team settings
              </button>
            )}
          </div>
          {isFacilitator && (
            <form className="row new-session" onSubmit={createSession}>
              <input placeholder="Session name, e.g. Sprint 42 refinement" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
              <button className="btn btn-primary" disabled={busy}>
                Start a session
              </button>
            </form>
          )}
          {sessions === null ? (
            <p className="hint">Loading sessions…</p>
          ) : active.length === 0 ? (
            <p className="empty">{isFacilitator ? 'No session running. Start one above, then add tickets.' : 'No session running yet. You’ll see it here as soon as your manager starts one.'}</p>
          ) : (
            <ul className="session-list">
              {active.map((s) => {
                const people = inRoom(s.id);
                const done = s.tickets.filter((t) => t.status === 'estimated').length;
                return (
                  <li key={s.id}>
                    <Link to={`/t/${team.id}/s/${s.id}`} className="session-card live">
                      <span className="session-main">
                        <strong>{s.name}</strong>
                        <small>
                          {done} of {s.tickets.length} tickets estimated, started {relTime(s.created_at)}
                        </small>
                      </span>
                      <span className="session-people" aria-label={`${people.length} people in the room`}>
                        {people.slice(0, 6).map((p) => (
                          <span key={p.id} title={p.display_name}>
                            {p.avatar}
                          </span>
                        ))}
                        {people.length > 6 && <small>+{people.length - 6}</small>}
                      </span>
                      <span className="btn btn-primary as-span">Join</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <h2 className="section-title">History</h2>
          {closed.length === 0 ? (
            <p className="empty">Closed sessions and their estimates are kept here.</p>
          ) : (
            <ul className="session-list">
              {closed.map((s) => {
                const est = s.tickets.filter((t) => t.status === 'estimated');
                const total = est.reduce((a, t) => a + (sumEstimates(t.estimates, team.deck) ?? 0), 0);
                return (
                  <li key={s.id}>
                    <Link to={`/t/${team.id}/s/${s.id}`} className="session-card">
                      <span className="session-main">
                        <strong>{s.name}</strong>
                        <small>
                          {new Date(s.created_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, {est.length} estimated
                          {team.deck !== 'tshirt' && total ? `, ${total} points` : ''}
                        </small>
                      </span>
                      <span className="btn btn-quiet as-span">View</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="panel">
          <h2>Crew</h2>
          {isFacilitator && (
            <div className="invite">
              <p className="hint">Share this invite link. People pick a name and roles; no account needed.</p>
              <CopyField value={inviteLink(team.invite_code)} label="Invite link" />
              {isOwner && <RegenerateInvite />}
            </div>
          )}
          <ul className="member-list">
            {members.map((m) => (
              <MemberRow key={m.id} m={m} isMe={m.id === me.id} online={online.has(m.id)} />
            ))}
          </ul>
        </aside>
      </div>
      {settings && <TeamSettings onClose={() => setSettings(false)} />}
    </Shell>
  );
}

function RegenerateInvite() {
  const { team, refreshTeam } = useTeam();
  const toast = useToast();
  return (
    <button
      className="btn btn-link"
      onClick={async () => {
        if (!window.confirm('Replace the invite link? The current one stops working. People who already joined are not affected.')) return;
        const { error } = await supabase.rpc('regenerate_invite', { p_team: team.id });
        if (error) return toast(errorText(error), { tone: 'bad' });
        await refreshTeam();
        toast('New invite link ready', { tone: 'good' });
      }}
    >
      Replace invite link
    </button>
  );
}

function MemberRow({ m, isMe, online }: { m: Member; isMe: boolean; online: boolean }) {
  const { isFacilitator, isOwner, refreshTeam, pingSync } = useTeam();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const copyLogin = async () => {
    const { data } = await supabase.from('member_tokens').select('token').eq('member_id', m.id).maybeSingle();
    if (!data) return toast('No login link found for this person.', { tone: 'warn' });
    await navigator.clipboard?.writeText(loginLink(data.token)).catch(() => {});
    toast(`Copied ${m.display_name}’s login link. Send it only to them.`, { tone: 'good', icon: '🔑' });
  };
  const toggleCohost = async () => {
    const { error } = await supabase.rpc('set_facilitator', { p_member: m.id, p_value: !m.is_facilitator });
    if (error) return toast(errorText(error), { tone: 'bad' });
    await refreshTeam();
    pingSync('members');
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${m.display_name} from the team? Their past votes are removed too.`)) return;
    const { error } = await supabase.from('members').delete().eq('id', m.id);
    if (error) return toast(errorText(error), { tone: 'bad' });
    await refreshTeam();
    pingSync('members');
  };

  return (
    <li className={`member-row ${online ? 'online' : ''}`}>
      <Avatar emoji={m.avatar} />
      <span className="member-main">
        <strong>
          {m.display_name}
          {isMe && <small> (you)</small>}
        </strong>
        <span className="badges">
          <RoleBadges roles={m.roles} />
          {m.is_owner && <span className="role-badge role-host">manager</span>}
          {!m.is_owner && m.is_facilitator && <span className="role-badge role-host">co-host</span>}
          {!m.user_id && <span className="role-badge role-none" title="Not logged in on any browser">signed out</span>}
        </span>
      </span>
      <span className="presence-dot" aria-label={online ? 'online' : 'offline'} />
      {isFacilitator && !m.is_owner && !isMe && (
        <div className="menu-wrap">
          <button className="icon-btn" aria-label={`Options for ${m.display_name}`} onClick={() => setOpen((o) => !o)}>
            ⋯
          </button>
          {open && (
            <div className="menu" onMouseLeave={() => setOpen(false)}>
              <button onClick={copyLogin}>Copy their login link</button>
              {isOwner && <button onClick={toggleCohost}>{m.is_facilitator ? 'Remove co-host' : 'Make co-host'}</button>}
              <button className="danger" onClick={remove}>
                Remove from team
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function TeamSettings({ onClose }: { onClose: () => void }) {
  const { team, refreshTeam, pingSync } = useTeam();
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [deck, setDeck] = useState<DeckId>(team.deck);
  const [theme, setTheme] = useState<ThemeId>(team.theme);
  const save = async () => {
    const { error } = await supabase.from('teams').update({ name: name.trim(), deck, theme }).eq('id', team.id);
    if (error) return toast(errorText(error), { tone: 'bad' });
    await refreshTeam();
    pingSync('teams');
    toast('Team settings saved', { tone: 'good' });
    onClose();
  };
  return (
    <Modal title="Team settings" onClose={onClose}>
      <div className="form-grid">
        <label className="field">
          <span>Team name</span>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Cards</span>
          <select value={deck} onChange={(e) => setDeck(e.target.value as DeckId)}>
            {(Object.keys(DECKS) as DeckId[]).map((d) => (
              <option key={d} value={d}>
                {DECKS[d].label}: {DECKS[d].cards.join(' ')}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Planet</span>
          <div className="theme-picker">
            {(Object.keys(THEMES) as ThemeId[]).map((t) => (
              <button type="button" key={t} data-theme-swatch={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>
                <span className="swatch" />
                <strong>{THEMES[t].label}</strong>
                <small>{THEMES[t].blurb}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            Save settings
          </button>
        </div>
      </div>
    </Modal>
  );
}
