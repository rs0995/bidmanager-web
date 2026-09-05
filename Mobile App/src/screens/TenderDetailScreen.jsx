import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Star, ExternalLink, Plus } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { FieldRow } from '../components/tender/FieldRow.jsx';
import { DocumentRow } from '../components/tender/DocumentRow.jsx';
import { RequestDownloadPanel } from '../components/tender/RequestDownloadPanel.jsx';
import { SkeletonList } from '../components/feedback/Skeleton.jsx';
import { ErrorState } from '../components/feedback/ErrorState.jsx';
import { useTender } from '../hooks/useTender.js';
import { useTenderDocuments } from '../hooks/useTenderDocuments.js';
import { useBookmarkToggle } from '../hooks/useBookmarks.js';
import { fmtINR, formatDate, timeRemaining, urgency } from '../lib/format.js';
import { useToast } from '../components/feedback/ToastProvider.jsx';
import { createProjectFromTender } from '../lib/projects.js';

export function TenderDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: tender, isLoading, isError, error, refetch } = useTender(id);
  const { data: docsPage } = useTenderDocuments(id);
  const { isBookmarked, toggle } = useBookmarkToggle();
  const toast = useToast();

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

  return (
    <div>
      <ScreenHeader title="Tender detail" back />
      <div className="p-4">
        <p className="m-0 font-mono text-xs" style={{ color: 'var(--accent)' }}>{tender.tender_id}</p>
        <h2 className="m-0 mt-1.5 mb-2 text-lg font-bold leading-snug">{tender.title}</h2>
        <div className="flex gap-2 mb-4">
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: expired ? 'var(--surface-2)' : `color-mix(in srgb, ${u.color} 16%, transparent)`, color: expired ? 'var(--text-muted)' : u.color }}
          >
            {expired ? 'Closed' : `Closes ${label}`}
          </span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {tender.website_name}
          </span>
        </div>

        <div className="card p-3 mb-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <FieldRow label="Tender value" value={fmtINR(tender.tender_value)} />
          <FieldRow label="EMD" value={fmtINR(tender.emd)} />
          <FieldRow label="Category" value={tender.category} />
          <FieldRow label="Location" value={tender.location} />
          <FieldRow label="Published" value={formatDate(tender.published_date)} />
          <FieldRow label="Pre-bid meeting" value={formatDate(tender.pre_bid_meeting_date)} />
        </div>
        <div className="card p-3 mb-4">
          <FieldRow label="Closing" value={formatDate(tender.closing_date)} />
          <FieldRow label="Organisation chain" value={tender.organization} />
          <FieldRow label="Status" value={tender.status} />
        </div>

        <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button
            className="btn-primary justify-center"
            style={{ gridColumn: '1 / -1', background: bookmarked ? 'var(--warn)' : 'var(--accent)' }}
            onClick={handleToggle}
          >
            <Star size={15} /> {bookmarked ? 'Bookmarked' : 'Bookmark'}
          </button>
          <button className="btn-secondary justify-center" onClick={handleAddToProject}>
            <Plus size={15} /> Add to Projects
          </button>
          {tender.tender_url ? (
            <a className="btn-secondary justify-center" href={tender.tender_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} /> Open on portal
            </a>
          ) : <div />}
        </div>

        {tender.work_description && (
          <div className="card p-3 mb-4">
            <p className="m-0 mb-1.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Work description</p>
            <p className="m-0 text-sm whitespace-pre-wrap">{tender.work_description}</p>
          </div>
        )}

        <p className="m-0 mb-2 text-sm font-semibold">Published documents{documents.length ? ` (${documents.length})` : ''}</p>
        {documents.length > 0 ? (
          <div className="card p-3 mb-4">
            {documents.map((doc) => <DocumentRow key={doc.id} tenderId={tender.id} doc={doc} />)}
          </div>
        ) : (
          <div className="mb-4"><RequestDownloadPanel tenderId={tender.id} /></div>
        )}
      </div>
    </div>
  );
}
