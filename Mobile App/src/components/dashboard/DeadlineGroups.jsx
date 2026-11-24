import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { timeRemaining, urgency } from '../../lib/format.js';
import { useBookmarkedTenders } from '../../hooks/useBookmarks.js';
import { EmptyState } from '../feedback/EmptyState.jsx';

const BANDS = ['Critical', 'Soon', 'Comfortable'];
const CHIP_CLASS = { Critical: 'crit', Soon: 'soon', Comfortable: 'ok' };

export function DeadlineGroups() {
  const navigate = useNavigate();
  const { tenders, isLoading } = useBookmarkedTenders();

  if (isLoading) return null;
  if (tenders.length === 0) {
    return <EmptyState icon={Clock} title="No upcoming deadlines" body="Bookmark a tender to track its closing date here." />;
  }

  const withUrgency = tenders
    .map((t) => ({ t, r: timeRemaining(t.closing_date) }))
    .filter(({ r }) => !r.expired)
    .sort((a, b) => (a.r.totalDays ?? Infinity) - (b.r.totalDays ?? Infinity))
    .slice(0, 10);

  return (
    <div className="panel">
      <h3 className="m-0 mb-3 text-sm font-bold">Upcoming deadlines</h3>
      {BANDS.map((band) => {
        const rows = withUrgency.filter(({ r }) => urgency(r.totalDays).label === band);
        if (rows.length === 0) return null;
        const variant = CHIP_CLASS[band];
        return (
          <React.Fragment key={band}>
            <p className={`dband ${variant}`}>{band.toUpperCase()}</p>
            {rows.map(({ t, r }) => (
              <button key={t.id} className={`drow ${variant}`} onClick={() => navigate(`/tenders/${t.id}`)}>
                <div className="min-w-0">
                  <p className="who m-0">{t.tender_id}</p>
                  <p className="what m-0">{t.title}</p>
                </div>
                <span className={`dline ${variant}`}>{r.label}</span>
              </button>
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}
