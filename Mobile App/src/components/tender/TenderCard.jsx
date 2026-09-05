import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { fmtINR, timeRemaining, urgency } from '../../lib/format.js';
import { useBookmarkToggle } from '../../hooks/useBookmarks.js';

// Matches the reference artifact's .tcard: top row = mono id + closing chip,
// title, meta line (site · value · location), org line, star top-right.
export function TenderCard({ tender }) {
  const navigate = useNavigate();
  const { isBookmarked, toggle } = useBookmarkToggle();
  const { totalDays, label, expired } = timeRemaining(tender.closing_date);
  const u = urgency(totalDays);
  const bookmarked = isBookmarked(tender.id);

  return (
    <button
      className="card flex flex-col gap-1.5 p-3.5 text-left w-full active:opacity-80"
      onClick={() => navigate(`/tenders/${tender.id}`)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px]" style={{ color: 'var(--accent)' }}>{tender.tender_id}</span>
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: expired ? 'var(--surface-2)' : `color-mix(in srgb, ${u.color} 16%, transparent)`, color: expired ? 'var(--text-muted)' : u.color }}
          >
            {expired ? 'Closed' : label}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); toggle(tender.id); }}
            aria-label="Toggle bookmark"
          >
            <Star size={17} fill={bookmarked ? 'var(--warn)' : 'none'} color={bookmarked ? 'var(--warn)' : 'var(--text-muted)'} />
          </button>
        </div>
      </div>
      <h4 className="m-0 text-sm font-semibold leading-snug line-clamp-2">{tender.title}</h4>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>{tender.website_name}</span>
        <span><b style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtINR(tender.tender_value)}</b></span>
        <span>{tender.location}</span>
      </div>
      {tender.organization && (
        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{tender.organization}</div>
      )}
    </button>
  );
}
