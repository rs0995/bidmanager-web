import React, { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { RefreshCw, Globe } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { TenderList } from '../components/tender/TenderList.jsx';
import { EmptyState } from '../components/feedback/EmptyState.jsx';
import { useTenders } from '../hooks/useTenders.js';
import { requestOrgTenders, useOrgRequestPending } from '../lib/orgRequests.js';
import { useToast } from '../components/feedback/ToastProvider.jsx';
import { scrapeCooldownMessage } from '../lib/format.js';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function OrganizationTendersScreen() {
  const { name } = useParams();
  const [searchParams] = useSearchParams();
  const orgName = decodeURIComponent(name);
  const websiteId = searchParams.get('website_id') || undefined;
  const orgId = searchParams.get('org_id') || undefined;
  // Set by AlertsScreen when opening a "new tenders under this org" alert
  // (?sort_by=published_date&sort_order=desc) — absent on the normal
  // tap-an-org-card path, where the backend's own default sort applies.
  const sortBy = searchParams.get('sort_by') || undefined;
  const sortOrder = searchParams.get('sort_order') || undefined;
  // Set by OrganizationCard when navigating here, so the 24h cooldown can be
  // computed without an extra fetch — org.last_scraped_at is epoch seconds.
  const lastScrapedAt = Number(searchParams.get('last_scraped_at')) || 0;
  const toast = useToast();

  const query = useTenders({ organization: orgName, website_id: websiteId, sort_by: sortBy, sort_order: sortOrder });
  const pending = useOrgRequestPending(orgId);
  const cooldownActive = lastScrapedAt > 0 && (Date.now() - lastScrapedAt * 1000) < COOLDOWN_MS;

  const handleRequest = useCallback(async () => {
    if (!orgId) return;
    if (cooldownActive) {
      toast?.push({ title: 'Update not due yet', body: scrapeCooldownMessage(lastScrapedAt), type: 'info' });
      return;
    }
    try {
      await requestOrgTenders({ id: Number(orgId), name: orgName });
      toast?.push({ title: 'Requested', body: 'Fetching tenders for this organisation — this can take a few minutes.' });
    } catch (e) {
      const message = e?.message || '';
      if (/already/i.test(message)) {
        toast?.push({ title: 'Already covered', body: 'This organisation already has a scrape job covering it.', type: 'info' });
      } else if (/less than 24 hours/i.test(message)) {
        // Backend enforces the same 24h cooldown as a backstop (e.g. a stale
        // deep link without a fresh last_scraped_at) — surface it the same
        // way as the client-side check above rather than a raw error.
        toast?.push({ title: 'Update not due yet', body: scrapeCooldownMessage(lastScrapedAt), type: 'info' });
      } else {
        toast?.push({ title: 'Could not request tenders', body: message, type: 'error' });
      }
    }
  }, [orgId, orgName, toast, cooldownActive, lastScrapedAt]);

  const headerRequestButton = orgId ? (
    <button
      style={{ padding: 6, opacity: pending ? 0.6 : 1 }}
      onClick={handleRequest}
      disabled={pending}
      aria-label={pending ? 'Requesting tenders…' : 'Request tenders'}
      title={pending ? 'Requesting…' : 'Request tenders'}
    >
      <RefreshCw size={18} className={pending ? 'animate-spin' : ''} style={{ color: 'var(--accent)' }} />
    </button>
  ) : null;

  return (
    <div>
      <ScreenHeader title={orgName} back actions={headerRequestButton} />
      <TenderList
        query={query}
        renderEmpty={() => (
          <EmptyState
            icon={Globe}
            title="No tenders yet"
            body="Nothing scraped for this organisation yet."
            action={orgId && (
              <button
                className="btn-secondary mt-2"
                onClick={handleRequest}
                disabled={pending}
              >
                {pending ? 'Requesting…' : 'Request tenders'}
              </button>
            )}
          />
        )}
      />
    </div>
  );
}
