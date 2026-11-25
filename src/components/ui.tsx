import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AVATARS, ROLE_INFO } from '../lib/domain';
import type { ConnStatus, Role, TicketKind } from '../lib/types';
import { KIND_LABEL } from '../lib/domain';
import { copyText } from '../lib/util';
import { useToast } from '../state/Toasts';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-x)')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function RolePicker({ value, onChange }: { value: Role[]; onChange: (r: Role[]) => void }) {
  const toggle = (r: Role) => {
    let next = value.includes(r) ? value.filter((x) => x !== r) : [...value, r];
    // Fullstack already covers FE and BE.
    if (r === 'FS' && next.includes('FS')) next = next.filter((x) => x !== 'FE' && x !== 'BE');
    if ((r === 'FE' || r === 'BE') && next.includes(r)) next = next.filter((x) => x !== 'FS');
    onChange(next);
  };
  return (
    <div className="role-picker" role="group" aria-label="Your roles">
      {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
        <button
          type="button"
          key={r}
          className={`role-option ${value.includes(r) ? 'on' : ''}`}
          aria-pressed={value.includes(r)}
          onClick={() => toggle(r)}
        >
          <span className={`role-dot role-${r}`}>{ROLE_INFO[r].short}</span>
          <span>
            <strong>{ROLE_INFO[r].label}</strong>
            <small>{ROLE_INFO[r].hint}</small>
          </span>
        </button>
      ))}
      <p className="hint">{value.length === 0 ? 'No role picked: you’ll watch and can still join the fun, but won’t vote.' : 'You can change this later from your profile.'}</p>
    </div>
  );
}

export function AvatarPicker({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="Avatar">
      {AVATARS.map((a) => (
        <button type="button" key={a} role="radio" aria-checked={value === a} className={value === a ? 'on' : ''} onClick={() => onChange(a)}>
          {a}
        </button>
      ))}
    </div>
  );
}

export function RoleBadges({ roles }: { roles: Role[] }) {
  if (!roles.length) return <span className="role-badge role-none">watching</span>;
  return (
    <>
      {roles.map((r) => (
        <span key={r} className={`role-badge role-${r}`} title={ROLE_INFO[r].label}>
          {r}
        </span>
      ))}
    </>
  );
}

export function KindChip({ kind, onClick, small }: { kind: TicketKind; onClick?: () => void; small?: boolean }) {
  const cls = `kind-chip kind-${kind} ${small ? 'small' : ''}`;
  const label = kind === 'UNSET' ? '?' : kind === 'QA' ? 'QA' : kind;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={`${KIND_LABEL[kind]} — click to change`}>
      {label}
    </button>
  ) : (
    <span className={cls} title={KIND_LABEL[kind]}>
      {label}
    </span>
  );
}

const STATUS_TEXT: Record<ConnStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};
export function ConnectionPill({ status }: { status: ConnStatus }) {
  return (
    <span className={`conn conn-${status}`} title={status === 'live' ? 'Connected — updates arrive instantly' : 'Updates may be delayed'}>
      <span className="conn-dot" />
      {STATUS_TEXT[status]}
    </span>
  );
}

/** Shows a banner only when the connection has been unhealthy for a few seconds. */
export function ConnectionBanner({ status }: { status: ConnStatus }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (status === 'live' || status === 'connecting') {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), 2500);
    return () => window.clearTimeout(t);
  }, [status]);
  if (!show) return null;
  return (
    <div className={`conn-banner conn-banner-${status}`} role="alert">
      {status === 'offline'
        ? 'You’re offline. Votes you cast are kept and sent as soon as you’re back.'
        : 'Lost the live connection — reconnecting. The page keeps refreshing in the meantime.'}
    </div>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <div className="copy-field">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn btn-quiet"
        onClick={async () => {
          if (await copyText(value)) toast('Copied', { tone: 'good', icon: '📋' });
        }}
      >
        Copy
      </button>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Avatar({ emoji, size = 'md' }: { emoji: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar-${size}`}>{emoji}</span>;
}
