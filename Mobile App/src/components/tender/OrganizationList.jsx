import React, { useMemo } from 'react';
import { Bookmark } from 'lucide-react';
import { OrganizationCard } from './OrganizationCard.jsx';
import { SkeletonList } from '../feedback/Skeleton.jsx';
import { EmptyState } from '../feedback/EmptyState.jsx';
import { ErrorState } from '../feedback/ErrorState.jsx';
import { Chip } from '../common/Chip.jsx';
import { useOrgBookmarkToggle } from '../../hooks/useBookmarks.js';
import { Building2 } from 'lucide-react';

export function OrganizationList({ query, bookmarkedOnly, onToggleBookmarked }) {
  const { data, isLoading, isError, error, refetch } = query;
  const { isOrgBookmarked } = useOrgBookmarkToggle();

  const items = useMemo(() => {
    const all = data ? data.pages.flatMap((p) => p.items) : [];
    return bookmarkedOnly ? all.filter((org) => isOrgBookmarked(org.name)) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, bookmarkedOnly]);

  return (
    <div>
      <div className="flex gap-2 px-4 pt-3 pb-1">
        <Chip active={bookmarkedOnly} onClick={() => onToggleBookmarked(!bookmarkedOnly)}>
          <Bookmark size={12} /> Bookmarked
        </Chip>
      </div>
      {isLoading && <SkeletonList />}
      {isError && <ErrorState message={error?.message} onRetry={refetch} />}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={Building2}
          title={bookmarkedOnly ? 'No bookmarked organisations' : 'No organizations found'}
          body={bookmarkedOnly ? 'Bookmark an organisation to see it here.' : 'Try a different portal scope or search.'}
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
