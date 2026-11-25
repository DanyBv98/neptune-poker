import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginLink, supabase } from '../lib/supabase';
import type { Role } from '../lib/types';
import { errorText, usePrefs } from '../lib/util';
import { useAuth } from '../state/AuthContext';
import { useTeam } from '../state/TeamContext';
import { useToast } from '../state/Toasts';
import { AvatarPicker, CopyField, Modal, RolePicker } from './ui';

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { me, team, refreshTeam, pingSync } = useTeam();
  const { isGuest, signOut } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [name, setName] = useState(me.display_name);
  const [avatar, setAvatar] = useState(me.avatar);
  const [roles, setRoles] = useState<Role[]>(me.roles);
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = usePrefs();

  useEffect(() => {
    void supabase
      .from('member_tokens')
      .select('token')
      .eq('member_id', me.id)
      .maybeSingle()
      .then(({ data }) => setToken(data?.token ?? null));
  }, [me.id]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('members').update({ display_name: name.trim(), avatar, roles }).eq('id', me.id);
    setSaving(false);
    if (error) return toast(errorText(error), { tone: 'bad' });
    await refreshTeam();
    pingSync('members');
    toast('Profile saved', { tone: 'good' });
    onClose();
  };

  const newLink = async () => {
    const { data, error } = await supabase.rpc('regenerate_member_token', { p_member: me.id });
    if (error) return toast(errorText(error), { tone: 'bad' });
    setToken(data as string);
    toast('New login link created. The old one no longer works.', { tone: 'good' });
  };

  return (
    <Modal title="Your profile" onClose={onClose} wide>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Avatar</span>
          <AvatarPicker value={avatar} onChange={setAvatar} />
        </div>
        <div className="field">
          <span>Roles in {team.name}</span>
          <RolePicker value={roles} onChange={setRoles} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>

        {!me.is_owner && (
          <div className="field">
            <span>Your personal login link</span>
            <p className="hint">Open it in any browser to continue as {me.display_name}. Keep it private — anyone with it can vote as you.</p>
            {token ? <CopyField value={loginLink(token)} label="Personal login link" /> : <p className="hint">Loading…</p>}
            <button className="btn btn-link" onClick={newLink}>
              Replace with a new link
            </button>
          </div>
        )}

        <div className="field">
          <span>On this device</span>
          <label className="check">
            <input type="checkbox" checked={prefs.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} /> Sounds
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.effects} onChange={(e) => setPrefs({ effects: e.target.checked })} /> Show throws, pokes and reactions
          </label>
        </div>

        <div className="field danger-zone">
          {isGuest ? (
            <>
              <p className="hint">Leaving this browser forgets you here. You can come back with your personal login link.</p>
              <button
                className="btn btn-quiet"
                onClick={async () => {
                  if (!window.confirm('Forget this browser? Make sure you saved your personal login link.')) return;
                  await signOut();
                  nav('/');
                }}
              >
                Forget this browser
              </button>
            </>
          ) : (
            <button
              className="btn btn-quiet"
              onClick={async () => {
                await signOut();
                nav('/');
              }}
            >
              Sign out of the manager account
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
