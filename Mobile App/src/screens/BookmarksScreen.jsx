import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Building2, Globe } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { SegmentedControl } from '../components/common/SegmentedControl.jsx';
import { TenderCard } from '../components/tender/TenderCard.jsx';
import { OrganizationCard } from '../components/tender/OrganizationCard.jsx';
import { SkeletonList } from '../components/feedback/Skeleton.jsx';
import { EmptyState } from '../components/feedback/EmptyState.jsx';
import { ErrorState } from '../components/feedback/ErrorState.jsx';
import { useBookmarkedTenders, useOrgBookmarkToggle } from '../hooks/useBookmarks.js';
import { useOrganizations } from '../hooks/useOrganizations.js';

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search">
      <Search size={15} style={{ color: 'var(--text-muted)' }} />
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function BookmarksScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Same URL-param-wins/localStorage-fallback pattern as TendersScreen's
  // `view` (bm.tendersLastView) — survives both a back-navigation (the URL's
  // ?view= is restored from history) and a full remount.
  const view = searchParams.get('view') === 'tenders'
    ? 'tenders'
    : (searchParams.get('view') ? 'orgs' : (localStorage.getItem('bm.bookmarksLastView') === 'tenders' ? 'tenders' : 'orgs'));
  const setView = (v) => {
    localStorage.setItem('bm.bookmarksLastView', v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('view', v);
      return next;
    });
  };
  const [tenderSearch, setTenderSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');

  const { tenders, isLoading: tendersLoading } = useBookmarkedTenders();
  const { isOrgBookmarked } = useOrgBookmarkToggle();
  const orgsQuery = useOrganizations({});

  const filteredTenders = useMemo(() => {
    let rows = tenders;
    if (tenderSearch.trim()) {
      const q = tenderSearch.trim().toLowerCase();
      rows = rows.filter((t) => (
        t.title?.toLowerCase().includes(q)
        || t.tender_id?.toLowerCase().includes(q)
        || t.organization?.toLowerCase().includes(q)
      ));
    }
    return rows;
  }, [tenders, tenderSearch]);

  const filteredOrgs = useMemo(() => {
    let rows = (orgsQuery.data || []).filter((org) => isOrgBookmarked(org.name));
    if (orgSearch.trim()) {
      const q = orgSearch.trim().toLowerCase();
      rows = rows.filter((org) => org.name.toLowerCase().includes(q));
    }
    // A bookmarked org no longer found on its site stays visible (greyed
    // out in OrganizationCard) rather than silently vanishing, but sinks to
    // the end of the list.
    return [...rows].sort((a, b) => (a.is_available === false ? 1 : 0) - (b.is_available === false ? 1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgsQuery.data, orgSearch]);

  return (
    <div>
      <ScreenHeader title="Bookmarks" back />
      <div className="px-4 pt-3 pb-1">
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[{ value: 'orgs', label: 'Organisations' }, { value: 'tenders', label: 'Tenders' }]}
        />
      </div>

      {view === 'tenders' && (
        <div>
          <div className="px-4 pt-2 pb-1">
            <SearchBox value={tenderSearch} onChange={setTenderSearch} placeholder="Search bookmarked tenders" />
          </div>
          {tendersLoading && <SkeletonList />}
          {!tendersLoading && filteredTenders.length === 0 && (
            <EmptyState
              icon={Globe}
              title={tenderSearch ? 'No tenders match your search' : 'No bookmarked tenders'}
              body={tenderSearch ? 'Try a different search.' : 'Bookmark a tender to see it here.'}
            />
          )}
          {!tendersLoading && filteredTenders.length > 0 && (
            <div className="flex flex-col gap-3 p-4 pt-2">
              {filteredTenders.map((t) => <TenderCard key={t.id} tender={t} />)}
            </div>
          )}
        </div>
      )}

      {view === 'orgs' && (
        <div>
          <div className="px-4 pt-2 pb-1">
            <SearchBox value={orgSearch} onChange={setOrgSearch} placeholder="Search bookmarked organisations" />
          </div>
          {orgsQuery.isLoading && <SkeletonList />}
          {orgsQuery.isError && <ErrorState message={orgsQuery.error?.message} onRetry={orgsQuery.refetch} />}
          {!orgsQuery.isLoading && !orgsQuery.isError && filteredOrgs.length === 0 && (
            <EmptyState
              icon={Building2}
              title={orgSearch ? 'No organisations match your search' : 'No bookmarked organisations'}
              body={orgSearch ? 'Try a different search.' : 'Bookmark an organisation to see it here.'}
            />
          )}
          {!orgsQuery.isLoading && !orgsQuery.isError && filteredOrgs.length > 0 && (
            <div className="flex flex-col gap-2 p-4 pt-2">
              {filteredOrgs.map((org) => <OrganizationCard key={org.id} org={org} showWebsite />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
