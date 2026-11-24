import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Star, ExternalLink, Plus, DownloadCloud } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { DocumentRow } from '../components/tender/DocumentRow.jsx';
import { RequestDownloadPanel } from '../components/tender/RequestDownloadPanel.jsx';
import { SkeletonList } from '../components/feedback/Skeleton.jsx';
import { ErrorState } from '../components/feedback/ErrorState.jsx';
import { useTender } from '../hooks/useTender.js';
import { useTenderDocuments } from '../hooks/useTenderDocuments.js';
import { useBookmarkToggle } from '../hooks/useBookmarks.js';
import { fmtINR, formatDate, formatDateTimeIST, timeRemaining, urgency } from '../lib/format.js';
import { useToast } from '../components/feedback/ToastProvider.jsx';
import { createProjectFromTender } from '../lib/projects.js';
import { syncTenderDocuments, downloadAllForTender } from '../lib/documents.js';

export function TenderDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: tender, isLoading, isError, error, refetch } = useTender(id);
  const { data: docsPage } = useTenderDocuments(id);
  const { isBookmarked, toggle } = useBookmarkToggle();
  const toast = useToast();
  const [downloadingAll, setDownloadingAll] = useState(false);

  // Keep the local documents cache (and its has_documents-style state) in
  // step with whatever the live list returned.
  useEffect(() => {
    if (tender && docsPage?.items?.length) syncTenderDocuments(tender, docsPage.items);
  }, [tender, docsPage]);

  if (isLoading) return (<div><ScreenHeader title="Tender" back /><SkeletonList /></div>);
  if (isError || !tender) return (<div><ScreenHeader title="Tender" back /><ErrorState message={error?.message} onRetry={refetch} /></div>);

  const bookmarked = isBookmarked(tender.id);
  const documents = docsPage?.items || [];
  const { totalDays, label, expired } = timeRemaining(tender.closing_date);
  const u = urgency(totalDays);

  const handleToggle = () => {
    const nowOn = toggle(tender.id);
    if (nowOn) {
      toast?.push({
        title: 'Bookmarked',
        body: 'This also keeps its documents updated automatically (a recurring background check every few hours).',
      });
    }
  };

  const handleAddToProject = () => {
    const project = createProjectFromTender(tender);
    toast?.push({
      title: 'Project created',
      body: `"${project.title}" added with a Ready Docs checklist.`,
      action: { label: 'View project', onClick: () => navigate(`/projects/${project.id}`) },
    });
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const { ok, failed, total } = await downloadAllForTender(tender);
      if (!total) toast?.push({ title: 'Nothing to download', body: 'No downloadable files for this tender yet.', type: 'info' });
      else if (failed) toast?.push({ title: `Downloaded ${ok} of ${total}`, body: `${failed} failed.`, type: 'error' });
      else toast?.push({ title: `Downloaded ${ok} file${ok === 1 ? '' : 's'}` });
    } catch (e) {
      toast?.push({ title: 'Download failed', body: e?.message, type: 'error' });
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div>
      <ScreenHeader title="Tender detail" back />
      <div className="dhero">
        <p className="tid m-0">{tender.tender_id}</p>
        <h2>{tender.title}</h2>
        <div className="row">
          <span className={`chip ${expired ? 'plain' : u.key}`}>{expired ? 'Closed' : `Closes ${label}`}</span>
        </div>
      </div>
      <div className="p-4">
        <div className="kv">
          <div><p className="k m-0">Tender value</p><p className="v m-0">{fmtINR(tender.tender_value)}</p></div>
          <div><p className="k m-0">EMD</p><p className="v m-0">{fmtINR(tender.emd)}</p></div>
          <div><p className="k m-0">Category</p><p className="v m-0">{tender.category || '—'}</p></div>
          <div><p className="k m-0">Location</p><p className="v m-0">{tender.location || '—'}</p></div>
          <div><p className="k m-0">Published date</p><p className="v m-0">{formatDate(tender.published_date)}</p></div>
          <div><p className="k m-0">Bid opening date</p><p className="v m-0">{formatDate(tender.opening_date)}</p></div>
          <div className="full"><p className="k m-0">Closing</p><p className="v m-0">{formatDateTimeIST(tender.closing_date)}</p></div>
          {/* Raw value (not date-formatted): some portals append the meeting
              venue/address after the date, and there is no separate address
              field in the /client/* payload. */}
          <div className="full"><p className="k m-0">Pre-bid meeting</p><p className="v m-0">{tender.pre_bid_meeting_date || '—'}</p></div>
          <div className="full"><p className="k m-0">Organisation chain</p><p className="v m-0">{tender.organization || '—'}</p></div>
        </div>

        <div className="actions">
          <button className={`abtn wide${bookmarked ? ' primary' : ''}`} onClick={handleToggle}>
            <span className="ic"><Star size={15} /></span>{bookmarked ? 'Bookmarked' : 'Bookmark'}
          </button>
          <button className="abtn" onClick={handleAddToProject}>
            <span className="ic"><Plus size={15} /></span>Add to Projects
          </button>
          {tender.tender_url && (
            <a className="abtn" href={tender.tender_url} target="_blank" rel="noopener noreferrer">
              <span className="ic"><ExternalLink size={15} /></span>Open on portal
            </a>
          )}
        </div>

        <div className="cl-head">
          <span className="section-label" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Published documents{documents.length ? ` (${documents.length})` : ''}
          </span>
          {documents.length > 0 && (
            <button className="mini-btn" onClick={handleDownloadAll} disabled={downloadingAll}>
              <DownloadCloud size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
              {downloadingAll ? 'Downloading…' : 'Download all'}
            </button>
          )}
        </div>
        {documents.length > 0 ? (
          <div className="doclist">
            {documents.map((doc) => <DocumentRow key={doc.id} tenderId={tender.id} doc={doc} />)}
          </div>
        ) : (
          <RequestDownloadPanel tender={tender} />
        )}
      </div>
    </div>
  );
}
