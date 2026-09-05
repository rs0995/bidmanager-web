import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { timeRemaining, urgency } from '../../lib/format.js';
import { useBookmarkedTenders } from '../../hooks/useBookmarks.js';
import { EmptyState } from '../feedback/EmptyState.jsx';

const BANDS = ['Critical', 'Soon', 'Comfortable'];

export function DeadlineGroups() {
  const navigate = useNavigate();
  const { tenders, isLoading } = useBookmarkedTenders();

  if (isLoading) return null;
  if (tenders.length === 0) {
    return <EmptyState icon={Clock} title="No upcoming deadlines" body="Bookmark a tender to track its closing date here." />;
  }

  const withUrgency = tenders
    .map((t) => ({ t, r: timeRemaining(t.closing_date) }))
    .filter(({ r }) => !r.expired);

  return (
    <div className="card p-4">
      <h3 className="m-0 mb-3 text-sm font-bold">Upcoming deadlines</h3>
      {BANDS.map((band) => {
        const rows = withUrgency.filter(({ r }) => urgency(r.totalDays).label === band);
        if (rows.length === 0) return null;
        const color = urgency(rows[0].r.totalDays).color;
        return (
          <div key={band} className="mb-3 last:mb-0">
            <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{band}</p>
            {rows.map(({ t, r }) => (
              <div key={t.id} className="flex items-center gap-3 py-2 cursor-pointer" onClick={() => navigate(`/tenders/${t.id}`)}>
                <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 font-mono text-[10px]" style={{ color: 'var(--accent)' }}>{t.tender_id}</p>
                  <p className="m-0 text-sm truncate">{t.title}</p>
                </div>
                <span className="text-xs font-semibold flex-shrink-0" style={{ color }}>{r.label}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
