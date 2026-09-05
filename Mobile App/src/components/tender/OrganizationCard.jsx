import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Bookmark } from 'lucide-react';
import { useOrgBookmarkToggle } from '../../hooks/useBookmarks.js';
import { useToast } from '../feedback/ToastProvider.jsx';

export function OrganizationCard({ org }) {
  const navigate = useNavigate();
  const { isOrgBookmarked, toggle } = useOrgBookmarkToggle();
  const toast = useToast();
  const bookmarked = isOrgBookmarked(org.name);

  const handleBookmark = (e) => {
    e.stopPropagation();
    const nowOn = toggle(org.name);
    if (nowOn) {
      toast?.push({
        title: 'Organisation bookmarked',
        body: 'This also keeps its tenders updated automatically (a recurring background check every few hours).',
      });
    }
  };

  return (
    <button
      className="card p-3 flex items-center justify-between gap-3 text-left w-full"
      onClick={() => navigate(`/tenders/org/${encodeURIComponent(org.name)}?website_id=${org.website_id}`)}
    >
      <div className="min-w-0">
        <p className="m-0 text-sm font-medium truncate">{org.name}</p>
        <div className="flex gap-2 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>{org.website_name}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="font-mono text-sm font-semibold">{org.tender_count}</span>
        <button onClick={handleBookmark} aria-label="Toggle organisation bookmark">
          <Bookmark size={17} fill={bookmarked ? 'var(--warn)' : 'none'} color={bookmarked ? 'var(--warn)' : 'var(--text-muted)'} />
        </button>
        <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
      </div>
    </button>
  );
}
