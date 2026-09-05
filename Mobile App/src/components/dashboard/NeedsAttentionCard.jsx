import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TriangleAlert, CircleAlert, ArrowRight } from 'lucide-react';
import { timeRemaining, urgency } from '../../lib/format.js';
import { useBookmarkedTenders } from '../../hooks/useBookmarks.js';

export function NeedsAttentionCard() {
  const navigate = useNavigate();
  const { tenders } = useBookmarkedTenders();

  const urgent = tenders.filter((t) => {
    const { totalDays, expired } = timeRemaining(t.closing_date);
    return !expired && urgency(totalDays).label === 'Critical' && !t.has_documents;
  });

  if (urgent.length === 0) return null;

  return (
    <div className="card p-4 mb-4" style={{ borderColor: 'var(--warn)' }}>
      <div className="flex items-center gap-2 mb-3">
        <TriangleAlert size={16} style={{ color: 'var(--warn)' }} />
        <h3 className="m-0 text-sm font-bold">Needs attention</h3>
      </div>
      <div className="flex flex-col gap-2">
        {urgent.slice(0, 3).map((t) => (
          <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: 'var(--surface-1)' }}>
            <CircleAlert size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
            <span className="flex-1 text-sm line-clamp-2">{t.title} closes soon with no documents yet</span>
            <button className="btn-ghost" style={{ minHeight: 0, padding: 4 }} onClick={() => navigate(`/tenders/${t.id}`)}>
              <ArrowRight size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
