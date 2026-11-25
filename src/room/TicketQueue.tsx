import { useMemo, useState } from 'react';
import { KindChip } from '../components/ui';
import { cleanTitle, parseTicketLine, sumEstimates } from '../lib/domain';
import type { Ticket, TicketKind } from '../lib/types';
import { useTeam } from '../state/TeamContext';
import type { RoomApi } from './useRoom';

const KIND_CYCLE: TicketKind[] = ['FE', 'BE', 'FS', 'QA', 'UNSET'];

export function TicketQueue({ api, closed }: { api: RoomApi; closed: boolean }) {
  const { isFacilitator, team } = useTeam();
  const { tickets, currentTicket, actions } = api;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => text.split('\n').map(parseTicketLine).filter(Boolean), [text]);
  const canEdit = isFacilitator && !closed;

  const add = async () => {
    if (!preview.length) return;
    setBusy(true);
    if (await actions.addTickets(text)) setText('');
    setBusy(false);
  };

  const done = tickets.filter((t) => t.status === 'estimated');
  const points = done.reduce((a, t) => a + (sumEstimates(t.estimates, team.deck) ?? 0), 0);

  return (
    <section className="panel queue" aria-label="Tickets">
      <div className="panel-head">
        <h2>Tickets</h2>
        <span className="hint">
          {done.length}/{tickets.length}
          {team.deck !== 'tshirt' && points ? `, ${points} pts` : ''}
        </span>
      </div>
      {canEdit && (
        <div className="add-ticket">
          <textarea
            rows={2}
            autoComplete="off"
            value={text}
            placeholder="One ticket per line, e.g. [FE] Checkout button states"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void add();
              }
            }}
            aria-label="New tickets, one per line"
          />
          {preview.length > 0 && (
            <ul className="add-preview">
              {preview.slice(0, 6).map((p, i) => (
                <li key={i}>
                  <KindChip kind={p!.kind} small /> {cleanTitle(p!.title)}
                  {!p!.qaNeeded && <small> no QA</small>}
                </li>
              ))}
              {preview.length > 6 && <li className="hint">and {preview.length - 6} more</li>}
            </ul>
          )}
          <div className="add-actions">
            <span className="hint">Enter adds. Paste several lines to add several.</span>
            <button className="btn btn-primary btn-small" onClick={add} disabled={busy || !preview.length}>
              Add {preview.length > 1 ? preview.length : ''}
            </button>
          </div>
        </div>
      )}
      {tickets.length === 0 ? (
        <p className="empty">{canEdit ? 'Add the tickets you want to estimate. Tags like [FE], [BE], [QA] or [AQA] set who votes.' : 'No tickets yet.'}</p>
      ) : (
        <ol className="ticket-list">
          {tickets.map((t, i) => (
            <TicketItem key={t.id} t={t} first={i === 0} last={i === tickets.length - 1} current={t.id === currentTicket?.id} canEdit={canEdit} api={api} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TicketItem({ t, current, canEdit, api, first, last }: { t: Ticket; current: boolean; canEdit: boolean; api: RoomApi; first: boolean; last: boolean }) {
  const [menu, setMenu] = useState(false);
  const { actions } = api;
  const est = Object.entries(t.estimates ?? {});
  return (
    <li className={`ticket ${current ? 'current' : ''} status-${t.status}`}>
      <KindChip
        kind={t.kind}
        onClick={canEdit ? () => void actions.updateTicket(t.id, { kind: KIND_CYCLE[(KIND_CYCLE.indexOf(t.kind) + 1) % KIND_CYCLE.length] }) : undefined}
      />
      <button className="ticket-title" disabled={!canEdit} onClick={() => canEdit && void actions.selectTicket(t.id)} title={canEdit ? 'Make this the current ticket' : t.title}>
        <span>{cleanTitle(t.title)}</span>
        <small className="ticket-meta">
          {t.status === 'voting' && <span className="pulse">voting</span>}
          {t.status === 'revealed' && 'revealed'}
          {t.status === 'skipped' && 'skipped'}
          {!t.qa_needed && t.kind !== 'QA' && t.status === 'pending' && 'no QA'}
          {est.map(([k, v]) => (
            <span key={k} className="est-chip small">
              {k} <strong>{v}</strong>
            </span>
          ))}
        </small>
      </button>
      {t.url && (
        <a className="icon-btn" href={t.url} target="_blank" rel="noreferrer" aria-label="Open ticket">
          ↗
        </a>
      )}
      {canEdit && (
        <div className="menu-wrap">
          <button className="icon-btn" aria-label="Ticket options" onClick={() => setMenu((m) => !m)}>
            ⋯
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              {!first && <button onClick={() => void actions.moveTicket(t.id, -1)}>Move up</button>}
              {!last && <button onClick={() => void actions.moveTicket(t.id, 1)}>Move down</button>}
              <button onClick={() => void actions.updateTicket(t.id, { qa_needed: !t.qa_needed })}>{t.qa_needed ? 'Mark as no QA needed' : 'Mark as QA needed'}</button>
              <button
                onClick={() => {
                  const title = window.prompt('Ticket name', t.title);
                  if (title?.trim()) void actions.updateTicket(t.id, { title: title.trim() });
                }}
              >
                Rename
              </button>
              {t.status === 'skipped' ? (
                <button onClick={() => void actions.updateTicket(t.id, { status: 'pending' })}>Bring back</button>
              ) : (
                t.status === 'pending' && <button onClick={() => void actions.updateTicket(t.id, { status: 'skipped' })}>Skip</button>
              )}
              <button
                className="danger"
                onClick={() => {
                  if (window.confirm(`Delete “${cleanTitle(t.title)}” and its votes?`)) void actions.deleteTicket(t.id);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
