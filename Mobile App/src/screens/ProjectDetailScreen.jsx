import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, DownloadCloud, FolderOpen, Archive, ArchiveRestore } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { DocumentRow } from '../components/tender/DocumentRow.jsx';
import { RequestDownloadPanel } from '../components/tender/RequestDownloadPanel.jsx';
import { ChecklistItem } from '../components/project/ChecklistItem.jsx';
import { AddChecklistItemForm } from '../components/project/AddChecklistItemForm.jsx';
import { FilePreview } from '../components/project/FilePreview.jsx';
import { EmptyState } from '../components/feedback/EmptyState.jsx';
import { Sheet } from '../components/common/Sheet.jsx';
import { Button } from '../components/common/Button.jsx';
import { fmtINR, formatDate, timeRemaining, urgency } from '../lib/format.js';
import { useProject, useChecklist, folderNames, addChecklistItem, getAttachedFile, archiveProject, updateProject } from '../lib/projects.js';
import { useTenderDocuments } from '../hooks/useTenderDocuments.js';
import { syncTenderDocuments, downloadAllForTender } from '../lib/documents.js';
import { useToast } from '../components/feedback/ToastProvider.jsx';

export function ProjectDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const project = useProject(id);
  const checklist = useChecklist(id);
  const [showAdd, setShowAdd] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const toast = useToast();

  // A synthetic tender object carrying just the fields the document helpers
  // and RequestDownloadPanel read (id, tender_id, title) — ProjectDetailScreen
  // only has a Project row, not a full Tender.
  const sourceTender = project?.source_tender_db_id
    ? { id: project.source_tender_db_id, tender_id: project.source_tender_id, title: project.title }
    : null;
  const { data: docsPage } = useTenderDocuments(project?.source_tender_db_id);

  useEffect(() => {
    if (sourceTender && docsPage?.items?.length) syncTenderDocuments(sourceTender, docsPage.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTender?.id, docsPage]);

  // folders/grouped are computed unconditionally (hooks can't be called
  // conditionally) and just guard internally for a missing project, rather
  // than living after the `if (!project) return` below.
  const folders = project ? folderNames(project.id) : [];
  const grouped = useMemo(() => {
    if (!project) return [];
    const map = new Map(folders.map((f) => [f, []]));
    checklist.forEach((item) => {
      if (!map.has(item.subfolder)) map.set(item.subfolder, []);
      map.get(item.subfolder).push(item);
    });
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, checklist, folders.join(',')]);

  if (!project) {
    return (
      <div>
        <ScreenHeader title="Project" back />
        <EmptyState icon={FolderOpen} title="Project not found" />
      </div>
    );
  }

  const done = checklist.filter((i) => i.status === 'Completed').length;
  const total = checklist.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const { totalDays, label, expired } = timeRemaining(project.deadline);
  const u = urgency(totalDays);
  const documents = docsPage?.items || [];

  const handleDownloadAll = async () => {
    if (!sourceTender) return;
    setDownloadingAll(true);
    try {
      const { ok, failed, total } = await downloadAllForTender(sourceTender);
      if (!total) toast?.push({ title: 'Nothing to download', body: 'No downloadable files for this tender yet.', type: 'info' });
      else if (failed) toast?.push({ title: `Downloaded ${ok} of ${total}`, body: `${failed} failed.`, type: 'error' });
      else toast?.push({ title: `Downloaded ${ok} file${ok === 1 ? '' : 's'}` });
    } catch (e) {
      toast?.push({ title: 'Download failed', body: e?.message, type: 'error' });
    } finally {
      setDownloadingAll(false);
    }
  };

  const archived = project.status === 'Archived';
  const handleUnarchive = () => {
    updateProject(project.id, { status: 'Active' });
    toast?.push({ title: 'Project restored to Active' });
  };
  const handleArchive = () => {
    archiveProject(project.id);
    setConfirmArchive(false);
    toast?.push({ title: 'Project archived' });
    navigate('/projects');
  };

  const archiveButton = (
    <button
      style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer' }}
      onClick={() => (archived ? handleUnarchive() : setConfirmArchive(true))}
      aria-label={archived ? 'Restore project' : 'Archive project'}
      title={archived ? 'Restore project' : 'Archive project'}
    >
      {archived ? <ArchiveRestore size={18} style={{ color: 'var(--accent)' }} /> : <Archive size={18} style={{ color: 'var(--text-muted)' }} />}
    </button>
  );

  return (
    <div>
      <ScreenHeader title="Project" back actions={archiveButton} />
      <div className="dhero">
        <p className="tid m-0">{project.source_tender_id || `P-${project.id}`}</p>
        <h2>{project.title}</h2>
        <div className="progline">
          <div className="bar"><i style={{ width: `${pct}%` }} /></div>
          <span className="pct">{pct}%</span>
        </div>
        <div className="row">
          <span className={`chip ${expired ? 'plain' : u.key}`}>Due {expired ? 'past' : label}</span>
          {project.prebid && <span className="chip plain">Pre-bid {formatDate(project.prebid)}</span>}
        </div>
      </div>
      <div className="p-4">
        <div className="kv">
          <div className="full"><p className="k m-0">Source tender ID</p><p className="v m-0">{project.source_tender_id || '—'}</p></div>
          <div className="full"><p className="k m-0">Client</p><p className="v m-0">{project.client_name || '—'}</p></div>
          <div><p className="k m-0">Project value</p><p className="v m-0">{fmtINR(project.project_value)}</p></div>
          <div><p className="k m-0">EMD</p><p className="v m-0">{fmtINR(project.emd)}</p></div>
          <div><p className="k m-0">Pre-bid meeting</p><p className="v m-0">{project.prebid ? formatDate(project.prebid) : '—'}</p></div>
          <div><p className="k m-0">Deadline</p><p className="v m-0">{formatDate(project.deadline)}</p></div>
          <div><p className="k m-0">Status</p><p className="v m-0">{project.status}</p></div>
          <div><p className="k m-0">Documents ready</p><p className="v m-0">{done} / {total}</p></div>
        </div>
        {project.description && (
          <div className="panel" style={{ marginTop: 14 }}>
            <p className="m-0 mb-1.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Work description</p>
            <p className="m-0 text-sm whitespace-pre-wrap">{project.description}</p>
          </div>
        )}

        {sourceTender && (
          <>
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
              <div className="doclist" style={{ marginBottom: 16 }}>
                {documents.map((doc) => <DocumentRow key={doc.id} tenderId={sourceTender.id} doc={doc} />)}
              </div>
            ) : (
              <div className="mb-4"><RequestDownloadPanel tender={sourceTender} /></div>
            )}
          </>
        )}

        <div className="cl-head">
          <span className="section-label" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Document checklist
          </span>
          <button className="mini-btn" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={12} style={{ display: 'inline', verticalAlign: -2 }} /> Add item
          </button>
        </div>
        {showAdd && (
          <AddChecklistItemForm
            folders={folders}
            onCancel={() => setShowAdd(false)}
            onAdd={(data) => { addChecklistItem(project.id, data); setShowAdd(false); }}
          />
        )}

        {grouped.map(([folder, items]) => (
          <div key={folder} className="folder">
            <div className="fhead">
              🗂️ {folder} <span className="ct">{items.filter((i) => i.status === 'Completed').length}/{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className="cempty">No items in this section yet</p>
            ) : items.map((item) => (
              <ChecklistItem key={item.id} item={item} onPreview={() => setPreviewItem(item)} />
            ))}
          </div>
        ))}
      </div>

      {previewItem && (
        <FilePreview file={getAttachedFile(previewItem.id)} onClose={() => setPreviewItem(null)} />
      )}

      <Sheet
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="Archive this project?"
        footer={(
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmArchive(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={handleArchive}>Archive</Button>
          </>
        )}
      >
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          "{project.title}" will move to the Archived tab in Projects. You can restore it from there at any time.
        </p>
      </Sheet>
    </div>
  );
}
