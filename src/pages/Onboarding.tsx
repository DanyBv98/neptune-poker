import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Planet } from '../components/Planet';
import { Shell, useTheme } from '../components/Shell';
import { AvatarPicker, CopyField, RolePicker, Spinner } from '../components/ui';
import { DECKS, THEMES } from '../lib/domain';
import { loginLink, supabase } from '../lib/supabase';
import type { DeckId, Role, ThemeId } from '../lib/types';
import { errorText } from '../lib/util';
import { useAuth } from '../state/AuthContext';

// ------------------------------------------------------------------ create team (managers)
export function CreateTeam() {
  const { user, isGuest, ready } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('Team Neptune');
  const [you, setYou] = useState('');
  const [avatar, setAvatar] = useState('🔱');
  const [roles, setRoles] = useState<Role[]>([]);
  const [deck, setDeck] = useState<DeckId>('fibonacci');
  const [theme, setTheme] = useState<ThemeId>('neptune');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useTheme(theme);

  if (ready && (!user || isGuest)) return <Navigate to="/manager" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('create_team', {
      p_name: name.trim(),
      p_display_name: you.trim(),
      p_roles: roles,
      p_avatar: avatar,
      p_deck: deck,
      p_theme: theme,
    });
    setBusy(false);
    if (error) return setErr(errorText(error));
    nav(`/t/${data}`);
  };

  return (
    <Shell>
      <section className="panel narrow">
        <h1>Create a team</h1>
        <form onSubmit={submit} className="form-grid">
          <label className="field">
            <span>Team name</span>
            <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Your name</span>
            <input required maxLength={40} value={you} onChange={(e) => setYou(e.target.value)} placeholder="How teammates see you" />
          </label>
          <div className="field">
            <span>Avatar</span>
            <AvatarPicker value={avatar} onChange={setAvatar} />
          </div>
          <div className="field">
            <span>Do you vote too?</span>
            <RolePicker value={roles} onChange={setRoles} />
          </div>
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
          {err && <p className="error">{err}</p>}
          <button className="btn btn-primary" disabled={busy || !name.trim() || !you.trim()}>
            {busy ? 'Creating…' : 'Create team'}
          </button>
        </form>
      </section>
    </Shell>
  );
}

// ------------------------------------------------------------------ join with invite link
export function JoinTeam() {
  const { code = '' } = useParams();
  const { user, ensureSession } = useAuth();
  const nav = useNavigate();
  const [preview, setPreview] = useState<{ team_id: string; name: string; theme: ThemeId } | null | undefined>(undefined);
  const [already, setAlready] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🐙');
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ teamId: string; token: string } | null>(null);
  const joining = useRef(false);
  useTheme(preview?.theme);

  useEffect(() => {
    void supabase.rpc('team_preview', { p_invite_code: code }).then(({ data, error }) => {
      if (error) return setErr(errorText(error));
      setPreview((data as any[])?.[0] ?? null);
    });
  }, [code]);

  useEffect(() => {
    if (!user || !preview || joining.current) return;
    void supabase
      .from('members')
      .select('id')
      .eq('team_id', preview.team_id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => !joining.current && setAlready(Boolean(data)));
  }, [user, preview]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    joining.current = true;
    try {
      await ensureSession();
      const { data, error } = await supabase.rpc('join_team', {
        p_invite_code: code,
        p_display_name: name.trim(),
        p_roles: roles,
        p_avatar: avatar,
      });
      if (error) throw error;
      const res = data as { team_id: string; member_id: string; existing: boolean };
      if (res.existing) return nav(`/t/${res.team_id}`);
      const { data: tok } = await supabase.from('member_tokens').select('token').eq('member_id', res.member_id).single();
      setDone({ teamId: res.team_id, token: tok?.token ?? '' });
    } catch (e2) {
      joining.current = false;
      setErr(errorText(e2));
    } finally {
      setBusy(false);
    }
  };

  if (preview === undefined && !err) return <Shell><Spinner label="Looking up your team" /></Shell>;
  if (!preview)
    return (
      <Shell>
        <section className="panel narrow">
          <h1>This invite link doesn’t work</h1>
          <p className="lede small">{err || 'It may have been replaced. Ask your team manager for the current invite link.'}</p>
          <Link className="btn btn-quiet" to="/">Go to the start page</Link>
        </section>
      </Shell>
    );
  if (already && !done) return <Navigate to={`/t/${preview.team_id}`} replace />;

  if (done)
    return (
      <Shell>
        <section className="panel narrow center">
          <Planet size={120} />
          <h1>You’re in {preview.name}</h1>
          <p className="lede small">
            This is your personal login link. Bookmark it or save it in your password manager: it brings you back as {name.trim()} from any
            browser or device.
          </p>
          <CopyField value={loginLink(done.token)} label="Personal login link" />
          <p className="hint">You can find it again any time under your profile.</p>
          <button className="btn btn-primary" onClick={() => nav(`/t/${done.teamId}`)}>
            Go to the team
          </button>
        </section>
      </Shell>
    );

  return (
    <Shell>
      <section className="panel narrow">
        <h1>Join {preview.name}</h1>
        <form onSubmit={submit} className="form-grid">
          <label className="field">
            <span>Your name</span>
            <input required autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="How teammates see you" />
          </label>
          <div className="field">
            <span>Avatar</span>
            <AvatarPicker value={avatar} onChange={setAvatar} />
          </div>
          <div className="field">
            <span>What do you work on?</span>
            <RolePicker value={roles} onChange={setRoles} />
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Joining…' : `Join ${preview.name}`}
          </button>
        </form>
      </section>
    </Shell>
  );
}

// ------------------------------------------------------------------ personal login link
export function LoginWithLink() {
  const { token = '' } = useParams();
  const { ensureSession, user } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState<{ member_id: string; display_name: string; avatar: string; team_id: string; team_name: string; theme: ThemeId; is_owner: boolean } | null | undefined>();
  const [current, setCurrent] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const claiming = useRef(false);
  useTheme(info?.theme);

  useEffect(() => {
    void supabase.rpc('token_preview', { p_token: token }).then(({ data, error }) => {
      if (error) return setErr(errorText(error));
      setInfo((data as any[])?.[0] ?? null);
    });
  }, [token]);

  // Already this person in this browser? Skip straight in.
  useEffect(() => {
    if (!info || !user || claiming.current) return;
    void supabase
      .from('members')
      .select('id, display_name')
      .eq('team_id', info.team_id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (claiming.current) return;
        if (data?.id === info.member_id) nav(`/t/${info.team_id}`, { replace: true });
        else setCurrent(data?.display_name ?? null);
      });
  }, [info, user, nav]);

  const claim = async () => {
    setBusy(true);
    setErr('');
    claiming.current = true;
    try {
      await ensureSession();
      const { data, error } = await supabase.rpc('claim_member', { p_token: token });
      if (error) throw error;
      nav(`/t/${(data as { team_id: string }).team_id}`, { replace: true });
    } catch (e) {
      claiming.current = false;
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (info === undefined && !err) return <Shell><Spinner label="Checking your link" /></Shell>;
  return (
    <Shell>
      <section className="panel narrow center">
        {info ? (
          <>
            <span className="avatar avatar-lg">{info.avatar}</span>
            <h1>Continue as {info.display_name}</h1>
            <p className="lede small">in {info.team_name}</p>
            {info.is_owner ? (
              <p className="notice">This is the manager’s profile. <Link to="/manager">Sign in with the manager account</Link> instead.</p>
            ) : (
              <>
                {current && (
                  <p className="notice">
                    This browser is currently {current} in this team. Continuing switches it to {info.display_name}; {current} can come back with
                    their own login link.
                  </p>
                )}
                {err && <p className="error">{err}</p>}
                <button className="btn btn-primary" onClick={claim} disabled={busy}>
                  {busy ? 'Logging in…' : `Log in as ${info.display_name}`}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <h1>This login link doesn’t work</h1>
            <p className="lede small">{err || 'It may have been replaced by a newer one. Ask your team manager to copy your current link from the team page.'}</p>
            <Link className="btn btn-quiet" to="/">Go to the start page</Link>
          </>
        )}
      </section>
    </Shell>
  );
}
