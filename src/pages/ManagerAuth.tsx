import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { appBaseUrl, supabase } from '../lib/supabase';
import { errorText } from '../lib/util';
import { useAuth } from '../state/AuthContext';

export function ManagerAuth() {
  const { user, isGuest } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [guestTeams, setGuestTeams] = useState(0);

  // Once signed in (auth state arrives asynchronously): new managers go straight to team creation.
  useEffect(() => {
    if (!user || isGuest) return;
    void supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .then(({ count }) => nav(count ? '/' : '/new', { replace: true }));
  }, [user, isGuest, nav]);

  useEffect(() => {
    if (!user || !isGuest) return;
    void supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .then(({ count }) => setGuestTeams(count ?? 0));
  }, [user, isGuest]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: appBaseUrl() } });
    setBusy(false);
    if (res.error) return setMsg({ tone: 'bad', text: errorText(res.error) });
    if (mode === 'signup' && !res.data.session) {
      setMsg({ tone: 'good', text: `Check ${email} for a confirmation link, then come back and sign in.` });
      setMode('signin');
    }
  };

  const magic = async () => {
    if (!email) return setMsg({ tone: 'bad', text: 'Enter your email first.' });
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: appBaseUrl() } });
    setBusy(false);
    setMsg(error ? { tone: 'bad', text: errorText(error) } : { tone: 'good', text: `Sign-in link sent to ${email}.` });
  };

  return (
    <Shell>
      <section className="panel narrow">
        <h1>{mode === 'signin' ? 'Sign in as team manager' : 'Create a manager account'}</h1>
        <p className="lede small">Only the person who creates and runs the team needs an account. Everyone else joins with an invite link.</p>
        {isGuest && guestTeams > 0 && (
          <p className="notice">
            This browser is in {guestTeams} team{guestTeams > 1 ? 's' : ''} as a guest. Signing in switches it to your manager account — save your
            personal login links from your profile first so you can get back in.
          </p>
        )}
        <form onSubmit={submit} className="form-grid">
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {msg && <p className={msg.tone === 'bad' ? 'error' : 'success'}>{msg.text}</p>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="auth-alt">
          {mode === 'signin' ? (
            <>
              <button className="btn btn-link" onClick={() => setMode('signup')}>
                New here? Create a manager account
              </button>
              <button className="btn btn-link" onClick={magic} disabled={busy}>
                Forgot your password? Email me a sign-in link
              </button>
            </>
          ) : (
            <button className="btn btn-link" onClick={() => setMode('signin')}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </section>
    </Shell>
  );
}
