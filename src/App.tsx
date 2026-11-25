import { HashRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { isConfigured } from './lib/supabase';
import { Home } from './pages/Home';
import { ManagerAuth } from './pages/ManagerAuth';
import { CreateTeam, JoinTeam, LoginWithLink } from './pages/Onboarding';
import { TeamHome } from './pages/TeamHome';
import { Room } from './room/Room';
import { AuthProvider, useAuth } from './state/AuthContext';
import { TeamProvider, type LoadState } from './state/TeamContext';
import { ToastProvider } from './state/Toasts';

function TeamRoutes() {
  const { teamId = '' } = useParams();
  const { ready, user } = useAuth();
  if (!ready) return <Shell><Spinner /></Shell>;
  if (!user) return <NotMember />;
  return (
    <TeamProvider teamId={teamId} fallback={(s) => <TeamFallback state={s} />}>
      <Routes>
        <Route index element={<TeamHome />} />
        <Route path="s/:sessionId" element={<Room />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </TeamProvider>
  );
}

function TeamFallback({ state }: { state: LoadState }) {
  if (state.kind === 'loading') return <Shell><Spinner label="Loading your team" /></Shell>;
  if (state.kind === 'error')
    return (
      <Shell>
        <section className="panel narrow">
          <h1>Couldn’t load the team</h1>
          <p className="lede small">{state.message}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </Shell>
    );
  return <NotMember />;
}

function NotMember() {
  return (
    <Shell>
      <section className="panel narrow">
        <h1>You’re not in this team on this browser</h1>
        <p className="lede small">
          Open your personal login link to continue as yourself, or use the team’s invite link to join. Managers can{' '}
          <Link to="/manager">sign in here</Link>.
        </p>
        <Link to="/" className="btn btn-quiet">
          Paste a link
        </Link>
      </section>
    </Shell>
  );
}

function NotConfigured() {
  return (
    <div className="shell">
      <main className="main">
        <section className="panel narrow">
          <h1>Connect Supabase to start</h1>
          <p className="lede small">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in a <code>.env</code> file (see <code>.env.example</code>), run{' '}
            <code>supabase/schema.sql</code> in your project, then rebuild. The README has the full checklist.
          </p>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  if (!isConfigured) return <NotConfigured />;
  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/manager" element={<ManagerAuth />} />
            <Route path="/new" element={<CreateTeam />} />
            <Route path="/join/:code" element={<JoinTeam />} />
            <Route path="/login/:token" element={<LoginWithLink />} />
            <Route path="/t/:teamId/*" element={<TeamRoutes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
