import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark } from 'lucide-react';

export function BookmarksStatCard({ orgCount, tenderCount, to }) {
  const navigate = useNavigate();
  return (
    <button className="tile" onClick={() => to && navigate(to, { state: { fromCard: true } })}>
      <span className="tile-icon warn">
        <Bookmark size={17} />
      </span>
      {/* A single grid (not two independently-sized rows) so each label
          lines up directly under its own value — grid auto-placement skips
          the divider's spanned cell in row 2, so no empty filler cell needed. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1px auto', columnGap: 8, rowGap: 2 }}>
        <span className="n" style={{ gridColumn: 1, gridRow: 1 }}>{orgCount}</span>
        <span style={{ gridColumn: 2, gridRow: '1 / span 2', background: 'var(--border)' }} />
        <span className="n" style={{ gridColumn: 3, gridRow: 1 }}>{tenderCount}</span>
        <span className="l" style={{ gridColumn: 1, gridRow: 2 }}>Orgs</span>
        <span className="l" style={{ gridColumn: 3, gridRow: 2 }}>Tenders</span>
      </div>
    </button>
  );
}
