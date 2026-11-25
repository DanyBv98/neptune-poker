import { useState } from 'react';
import { KindChip } from '../components/ui';
import { cleanTitle, fmt, KIND_LABEL, sumEstimates, trackStats, TRACK_LABEL } from '../lib/domain';
import type { Track } from '../lib/types';
import { useTeam } from '../state/TeamContext';
import type { Snapshot } from './useRoom';

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function SessionSummary({ snap }: { snap: Snapshot }) {
  const { team, memberById } = useTeam();
  const [open, setOpen] = useState<string | null>(null);
  const rows = snap.tickets;
  const total = rows.reduce((a, t) => a + (sumEstimates(t.estimates, team.deck) ?? 0), 0);

  const exportCsv = () => {
    const head = ['Ticket', 'Link', 'Type', 'Status', 'Frontend', 'Backend', 'QA', 'Total', 'Rounds'];
    const lines = rows.map((t) => [
      t.title,
      t.url,
      KIND_LABEL[t.kind],
      t.status,
      t.estimates.FE,
      t.estimates.BE,
      t.estimates.QA,
      sumEstimates(t.estimates, team.deck),
      snap.rounds.filter((r) => r.ticket_id === t.id && r.status !== 'cancelled').length,
    ]);
    const csv = [head, ...lines].map((l) => l.map(csvCell).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${snap.session.name.replace(/[^\w-]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="panel summary">
      <div className="panel-head">
        <h2>Summary</h2>
        <button className="btn btn-quiet btn-small" onClick={exportCsv} disabled={!rows.length}>
          Download CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="empty">No tickets in this session.</p>
      ) : (
        <table className="summary-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>FE</th>
              <th>BE</th>
              <th>QA</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const rounds = snap.rounds.filter((r) => r.ticket_id === t.id && r.status === 'revealed');
              const isOpen = open === t.id;
              return (
                <FragmentRows key={t.id}>
                  <tr className={`status-${t.status}`}>
                    <td>
                      <button className="row-toggle" onClick={() => setOpen(isOpen ? null : t.id)} aria-expanded={isOpen} disabled={!rounds.length}>
                        <KindChip kind={t.kind} small /> {cleanTitle(t.title)}
                        {rounds.length > 0 && <small> {rounds.length} round{rounds.length > 1 ? 's' : ''}</small>}
                      </button>
                    </td>
                    <td>{t.estimates.FE ?? ''}</td>
                    <td>{t.estimates.BE ?? ''}</td>
                    <td>{t.estimates.QA ?? ''}</td>
                    <td>
                      <strong>{sumEstimates(t.estimates, team.deck) ?? (t.status === 'skipped' ? 'skipped' : '')}</strong>
                    </td>
                  </tr>
                  {isOpen &&
                    rounds.map((r) => (
                      <tr key={r.id} className="round-row">
                        <td colSpan={5}>
                          <strong>Round {r.round_no}</strong>
                          {r.tracks.map((track: Track) => {
                            const s = trackStats(track, snap.votes.filter((v) => v.round_id === r.id), team.deck);
                            return (
                              <span key={track} className="round-track">
                                {TRACK_LABEL[track]} avg {fmt(s.avg)}:{' '}
                                {s.votes.map((v) => `${memberById(v.member_id)?.display_name ?? 'former member'} ${v.value}`).join(', ') || 'no votes'}
                              </span>
                            );
                          })}
                        </td>
                      </tr>
                    ))}
                </FragmentRows>
              );
            })}
          </tbody>
          {team.deck !== 'tshirt' && (
            <tfoot>
              <tr>
                <td>Total</td>
                <td colSpan={3} />
                <td>
                  <strong>{total}</strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </section>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
