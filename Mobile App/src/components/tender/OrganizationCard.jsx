import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Bookmark } from 'lucide-react';
import { useOrgBookmarkToggle } from '../../hooks/useBookmarks.js';
import { recordOrgIds } from '../../lib/store.js';
import { formatDateTimeIST } from '../../lib/format.js';

// showWebsite: the Tenders tab's Organisations sub-tab is already scoped to
// one portal via SiteScope, so the website name there is redundant — the
// Bookmarks screen mixes portals by design, so it opts back in.
export function OrganizationCard({ org, showWebsite = false }) {
  const navigate = useNavigate();
  const { isOrgBookmarked, toggle } = useOrgBookmarkToggle();
  const bookmarked = isOrgBookmarked(org.name);
  // No longer found on the site's own organisation-list page — the card
  // still renders (a bookmark on it isn't silently lost) but is inert.
  const unavailable = org.is_available === false;

  const handleBookmark = (e) => {
    e.stopPropagation();
    recordOrgIds([org]); // so bookmarkedOrgIds can be filled on the next sync push
    toggle(org.name);
  };

  const openOrg = () => {
    if (unavailable) return;
    navigate(`/tenders/org/${encodeURIComponent(org.name)}?website_id=${org.website_id}&org_id=${org.id}&last_scraped_at=${org.last_scraped_at || 0}`);
  };

  return (
    // A <div role="button">, not a <button> — the bookmark toggle below is
    // itself an interactive <button> (and nested <button>s are invalid HTML
    // and behave unreliably on mobile touch).
    <div
      className={`ocard ${unavailable ? 'cursor-default' : 'cursor-pointer'}`}
      style={unavailable ? { opacity: 0.5 } : undefined}
      role="button"
      tabIndex={unavailable ? -1 : 0}
      aria-disabled={unavailable}
      onClick={openOrg}
      onKeyDown={(e) => { if (!unavailable && (e.key === 'Enter' || e.key === ' ')) openOrg(); }}
    >
      <div className="min-w-0">
        <h4 className="m-0 truncate">
          {org.name}
          {unavailable && <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>(unavailable)</span>}
        </h4>
        <div className="ometa">
          {showWebsite && <span>{org.website_name}</span>}
          {org.last_scraped_at ? <span>Last updated {formatDateTimeIST(org.last_scraped_at * 1000)}</span> : null}
        </div>
      </div>
      <div className="oright">
        <span className="ocount">{org.tender_count}</span>
        <button onClick={handleBookmark} aria-label="Toggle organisation bookmark" className={bookmarked ? 'star on' : 'star'}>
          <Bookmark size={17} fill={bookmarked ? 'currentColor' : 'none'} />
        </button>
        {!unavailable && <ChevronRight className="oarr" size={16} />}
      </div>
    </div>
  );
}
