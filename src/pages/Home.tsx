import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Planet } from '../components/Planet';
import { Shell } from '../components/Shell';
import { Avatar } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/AuthContext';

interface MyTeam {
  member_id: string;
  team_id: string;
  display_name: string;
  avatar: string;
  is_owner: boolean;
  teams: { name: string; theme: string } | null;
}

export function Home() {
  const { user, isGuest, ready } = useAuth();
  const nav = useNavigate();
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    if (!user) {
      setTeams([]);
      return;
    }
    void supabase
      .from('members')
      .select('member_id:id, team_id, display_name, avatar, is_owner, teams(name, theme)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTeams((data as unknown as MyTeam[]) ?? []));
  }, [user]);

  const openLink = (e: React.FormEvent) => {
    e.preventDefault();
    const m = link.match(/#\/(join|login)\/([A-Za-z0-9]+)/) ?? link.trim().match(/^()([a-f0-9]{12})$/i);
    if (!m) return setLinkError('That doesn’t look like an invite or login link. Paste the whole link you were sent.');
    nav(`/${m[1] || 'join'}/${m[2]}`);
  };

  return (
    <Shell>
      <section className="hero">
        <div className="hero-copy">
          <h1>Planning poker for Team Neptune</h1>
          <p className="lede">
            Frontend, backend and QA each estimate the part they’ll build. Tickets tagged <code>[FE]</code>, <code>[BE]</code> or{' '}
            <code>[QA]</code> go to the right people automatically.
          </p>
          <form className="link-form" onSubmit={openLink}>
            <label htmlFor="link">Got a link from your team?</label>
            <div className="row">
              <input
                id="link"
                placeholder="Paste your invite or login link"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setLinkError('');
                }}
              />
              <button className="btn btn-primary" disabled={!link.trim()}>
                Open
              </button>
            </div>
            {linkError && <p className="error">{linkError}</p>}
          </form>
          <p className="manager-line">
            Running refinement?{' '}
            {user && !isGuest ? (
              <Link to="/new">Create a team</Link>
            ) : (
              <Link to="/manager">Sign in as team manager</Link>
            )}
          </p>
        </div>
        <div className="hero-planet" aria-hidden="true">
          <Planet size={340} spin />
        </div>
      </section>

      {ready && teams && teams.length > 0 && (
        <section className="panel my-teams">
          <h2>Your teams</h2>
          <ul className="team-list">
            {teams.map((t) => (
              <li key={t.member_id}>
                <Link to={`/t/${t.team_id}`} className="team-link">
                  <Avatar emoji={t.avatar} />
                  <span>
                    <strong>{t.teams?.name ?? 'Team'}</strong>
                    <small>
                      as {t.display_name}
                      {t.is_owner ? ', manager' : ''}
                    </small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {user && !isGuest && (
            <Link to="/new" className="btn btn-quiet">
              Create another team
            </Link>
          )}
        </section>
      )}
    </Shell>
  );
}
