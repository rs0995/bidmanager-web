import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { fmtINR, timeRemaining, urgency } from '../../lib/format.js';
import { useBookmarkToggle } from '../../hooks/useBookmarks.js';

// Matches the reference artifact's .tcard: top row = mono id + closing chip,
// title, value line, department/organisation line, star top-right.
export function TenderCard({ tender }) {
  const navigate = useNavigate();
  const { isBookmarked, toggle } = useBookmarkToggle();
  const { totalDays, label, expired } = timeRemaining(tender.closing_date);
  const u = urgency(totalDays);
  const bookmarked = isBookmarked(tender.id);

  return (
    // A <div role="button">, not a <button> — the bookmark star below is
    // itself an interactive <button> — nested <button>s are invalid HTML
    // and behave unreliably on mobile touch (React warns about it too).
    <div
      className="tcard"
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/tenders/${tender.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/tenders/${tender.id}`); }}
    >
      <div className="top">
        <span className="tid">{tender.tender_id}</span>
        <div className="flex items-center gap-2">
          <span className={`chip ${expired ? 'plain' : u.key}`} style={{ padding: '3px 9px' }}>
            {expired ? 'Closed' : label}
          </span>
          <button
            className={bookmarked ? 'star on' : 'star'}
            onClick={(e) => { e.stopPropagation(); toggle(tender.id); }}
            aria-label="Toggle bookmark"
          >
            <Star size={17} fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
      <h4 className="m-0 line-clamp-2">{tender.title}</h4>
      <div className="meta">
        <b>{fmtINR(tender.tender_value)}</b>
        {tender.organization && <span className="truncate">{tender.organization}</span>}
      </div>
    </div>
  );
}
