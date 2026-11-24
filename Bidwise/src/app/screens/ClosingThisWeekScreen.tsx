import React, { useMemo, useState } from 'react';
import { TenderListPage } from '../../components/tender/TenderListPage';
import { useBookmarks } from '../../fixtures/bookmarks';
import { useTenderSource } from '../../data/tenderSource';
import { parseCrores } from '../../lib/format';
import { closingThisWeek } from '../../lib/tenderFilters';

type Sort = 'closing' | 'value';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'closing', label: 'Closing soonest' },
  { key: 'value', label: 'Highest value' },
];

/**
 * The Dashboard's "Closing this week" (as BM Pro's own page, not the Tenders tab with a
 * filter): bookmarked tenders still open and closing within 7 days -- the same list the
 * tile counts -- soonest first, with search and sort.
 */
export function ClosingThisWeekScreen() {
  const { isBookmarked } = useBookmarks();
  const { tenders, loading } = useTenderSource().usePipeline();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('closing');

  const all = useMemo(
    () => closingThisWeek(tenders, isBookmarked),
    [tenders, isBookmarked],
  );
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = all.filter(
      x =>
        !needle ||
        `${x.title} ${x.short} ${x.org} ${x.refId ?? x.id}`
          .toLowerCase()
          .includes(needle),
    );
    // `all` is already soonest first.
    return sort === 'value'
      ? [...rows].sort((a, b) => parseCrores(b.value) - parseCrores(a.value))
      : rows;
  }, [all, search, sort]);

  return (
    <TenderListPage
      title="Closing this week"
      sub={`${all.length} bookmarked tender${all.length === 1 ? '' : 's'}`}
      tenders={shown}
      loading={loading && tenders.length === 0}
      emptyText={
        all.length
          ? 'No tenders match your search.'
          : 'Nothing closing this week. Bookmarked tenders closing within 7 days show up here.'
      }
      search={search}
      onSearch={setSearch}
      sort={sort}
      sorts={SORTS}
      onSort={setSort}
    />
  );
}
