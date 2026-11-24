import React, { useMemo, useState } from 'react';
import { Bookmark, Search, Building2 } from 'lucide-react';
import { OrganizationCard } from './OrganizationCard.jsx';
import { SkeletonList } from '../feedback/Skeleton.jsx';
import { EmptyState } from '../feedback/EmptyState.jsx';
import { ErrorState } from '../feedback/ErrorState.jsx';
import { useOrgBookmarkToggle } from '../../hooks/useBookmarks.js';

export function OrganizationList({ query, bookmarkedOnly, onToggleBookmarked }) {
  const { data, isLoading, isError, error, refetch } = query;
  const { isOrgBookmarked } = useOrgBookmarkToggle();
  const [search, setSearch] = useState('');

  const items = useMemo(() => {
    let all = data || [];
    if (bookmarkedOnly) {
      // A bookmark on an org no longer found on its site shouldn't just
      // vanish — keep it (greyed out in OrganizationCard), sunk to the end.
      all = all.filter((org) => isOrgBookmarked(org.name));
    } else {
      all = all.filter((org) => org.is_available !== false);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      all = all.filter((org) => org.name.toLowerCase().includes(q));
    }
    if (bookmarkedOnly) {
      all = [...all].sort((a, b) => (a.is_available === false ? 1 : 0) - (b.is_available === false ? 1 : 0));
    }
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, bookmarkedOnly, search]);

  return (
    <div>
      <div
        className="sticky px-4 pt-3 pb-2"
        style={{ top: 52, zIndex: 20, background: 'var(--bg)' }}
      >
        <div className="search">
          <Search size={15} style={{ color: 'var(--text-muted)' }} />
          <input
            placeholder="Search organisations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filters" style={{ marginBottom: 0 }}>
          <button className={bookmarkedOnly ? 'fbtn on' : 'fbtn'} onClick={() => onToggleBookmarked(!bookmarkedOnly)}>
            <Bookmark size={12} /> Bookmarked
          </button>
        </div>
      </div>
      {isLoading && <SkeletonList />}
      {isError && <ErrorState message={error?.message} onRetry={refetch} />}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={Building2}
          title={search ? 'No organisations match your search' : bookmarkedOnly ? 'No bookmarked organisations' : 'No organizations found'}
          body={search ? 'Try a different search.' : bookmarkedOnly ? 'Bookmark an organisation to see it here.' : 'Try a different portal scope.'}
        />
      )}
      {!isLoading && !isError && items.length > 0 && (
        <div className="flex flex-col gap-2 p-4 pt-2">
          {items.map((org) => <OrganizationCard key={org.id} org={org} />)}
        </div>
      )}
    </div>
  );
}
