import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { TenderCard } from './TenderCard.jsx';
import { SkeletonList } from '../feedback/Skeleton.jsx';
import { EmptyState } from '../feedback/EmptyState.jsx';
import { ErrorState } from '../feedback/ErrorState.jsx';
import { Globe } from 'lucide-react';

// filterFn applies further client-side narrowing (bookmarked-only, closing
// window, ad-hoc custom filters) over whatever pages have been fetched from
// the server so far — the backend has no endpoint for these specific facets,
// same approach the reference artifact takes over its fixed dataset.
export function TenderList({ query, filterFn, onRowsChange }) {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = query;
  const sentinelRef = useRef(null);

  const allRows = useMemo(() => (data ? data.pages.flatMap((p) => p.items) : []), [data]);
  const rows = useMemo(() => (filterFn ? allRows.filter(filterFn) : allRows), [allRows, filterFn]);

  useEffect(() => { onRowsChange?.(allRows); }, [allRows, onRowsChange]);

  const onIntersect = useCallback((entries) => {
    if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(onIntersect, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onIntersect]);

  if (isLoading) return <SkeletonList />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  if (rows.length === 0) {
    return <EmptyState icon={Globe} title="No tenders found" body="Try adjusting your search or filters." />;
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {rows.map((tender) => <TenderCard key={tender.id} tender={tender} />)}
      <div ref={sentinelRef} className="h-4" />
      {isFetchingNextPage && <SkeletonList count={2} />}
    </div>
  );
}
