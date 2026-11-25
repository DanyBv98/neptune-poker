import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ThemeId } from '../lib/types';
import { useOptionalTeam } from '../state/TeamContext';
import { Brand } from './Planet';
import { ProfileModal } from './ProfileModal';
import { Avatar, ConnectionBanner, ConnectionPill } from './ui';

export function useTheme(theme: ThemeId | undefined) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme ?? 'neptune';
  }, [theme]);
}

/** Page frame: header with brand, connection state and profile. */
export function Shell({ children, crumbs, wide }: { children: ReactNode; crumbs?: ReactNode; wide?: boolean }) {
  const team = useOptionalTeam();
  const [profile, setProfile] = useState(false);
  useTheme(team?.team.theme);
  return (
    <div className="shell">
      <header className="topbar">
        <Link to={team ? `/t/${team.team.id}` : '/'} className="topbar-brand" aria-label="Home">
          <Brand name={team?.team.name} />
        </Link>
        {crumbs && <nav className="crumbs">{crumbs}</nav>}
        <div className="topbar-right">
          {team && <ConnectionPill status={team.status} />}
          {team && (
            <button className="me-btn" onClick={() => setProfile(true)} aria-label="Your profile">
              <Avatar emoji={team.me.avatar} size="sm" />
              <span className="me-name">{team.me.display_name}</span>
            </button>
          )}
        </div>
      </header>
      {team && <ConnectionBanner status={team.status} />}
      <main className={wide ? 'main main-wide' : 'main'}>{children}</main>
      {profile && <ProfileModal onClose={() => setProfile(false)} />}
    </div>
  );
}
