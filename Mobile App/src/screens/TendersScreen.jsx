import React, { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { SiteScope } from '../components/tender/SiteScope.jsx';
import { SegmentedControl } from '../components/common/SegmentedControl.jsx';
import { TenderFilterBar } from '../components/tender/TenderFilterBar.jsx';
import { TenderFilterSheet } from '../components/tender/TenderFilterSheet.jsx';
import { TenderList } from '../components/tender/TenderList.jsx';
import { OrganizationList } from '../components/tender/OrganizationList.jsx';
import { useTenders } from '../hooks/useTenders.js';
import { useOrganizations } from '../hooks/useOrganizations.js';
import { useBookmarkToggle } from '../hooks/useBookmarks.js';
import { timeRemaining } from '../lib/format.js';
import { customFilterPass } from '../components/tender/CustomFilterMenu.jsx';

export function TendersScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const { isBookmarked } = useBookmarkToggle();

  const filters = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
  const view = filters.view === 'orgs' ? 'orgs' : 'tenders';
  const customFilters = filters.custom ? filters.custom.split(',').filter(Boolean) : [];
  const bookmarkedOnly = filters.bookmarked_only === '1';
  const closingSoon = filters.closing5 === '1';
  const orgBookmarkedOnly = filters.org_bookmarked === '1';

  const apiFilters = useMemo(() => {
    const { view: _v, custom: _c, bookmarked_only: _b, closing5: _c5, org_bookmarked: _o, ...rest } = filters;
    return rest;
  }, [filters]);

  const tendersQuery = useTenders(apiFilters);
  const orgsQuery = useOrganizations({ website_id: apiFilters.website_id, q: apiFilters.q });

  const onChange = useCallback((patch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([key, value]) => {
        if (value) next.set(key, value); else next.delete(key);
      });
      return next;
    });
  }, [setSearchParams]);

  const filterFn = useCallback((t) => {
    if (bookmarkedOnly && !isBookmarked(t.id)) return false;
    if (closingSoon) {
      const { totalDays, expired } = timeRemaining(t.closing_date);
      if (expired || totalDays == null || totalDays > 5) return false;
    }
    for (const key of customFilters) if (!customFilterPass(t, key)) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkedOnly, closingSoon, customFilters.join(',')]);

  return (
    <div>
      <ScreenHeader title="Tenders" />
      <SiteScope websiteId={apiFilters.website_id} onChange={(id) => onChange({ website_id: id })} />
      <div className="px-4 pb-1">
        <SegmentedControl
          value={view}
          onChange={(v) => onChange({ view: v === 'tenders' ? '' : v })}
          options={[{ value: 'orgs', label: 'Organisations' }, { value: 'tenders', label: 'Tenders' }]}
        />
      </div>
      {view === 'tenders' && (
        <>
          <TenderFilterBar
            q={filters.q}
            onSearch={(q) => onChange({ q })}
            bookmarkedOnly={bookmarkedOnly}
            onToggleBookmarked={(v) => onChange({ bookmarked_only: v ? '1' : '' })}
            closingSoon={closingSoon}
            onToggleClosingSoon={(v) => onChange({ closing5: v ? '1' : '' })}
            customFilters={customFilters}
            onAddCustom={(key) => onChange({ custom: [...customFilters, key].join(',') })}
            onRemoveCustom={(key) => onChange({ custom: customFilters.filter((k) => k !== key).join(',') })}
            rows={rows}
            onOpenAdvanced={() => setSheetOpen(true)}
          />
          <TenderList query={tendersQuery} filterFn={filterFn} onRowsChange={setRows} />
          <TenderFilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} filters={filters} onApply={onChange} />
        </>
      )}
      {view === 'orgs' && (
        <OrganizationList
          query={orgsQuery}
          bookmarkedOnly={orgBookmarkedOnly}
          onToggleBookmarked={(v) => onChange({ org_bookmarked: v ? '1' : '' })}
        />
      )}
    </div>
  );
}
