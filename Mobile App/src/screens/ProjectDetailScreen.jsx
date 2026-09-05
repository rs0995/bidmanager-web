import React, { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { FieldRow } from '../components/tender/FieldRow.jsx';
import { ChecklistItem } from '../components/project/ChecklistItem.jsx';
import { AddChecklistItemForm } from '../components/project/AddChecklistItemForm.jsx';
import { FilePreview } from '../components/project/FilePreview.jsx';
import { fmtINR, formatDate, timeRemaining, urgency } from '../lib/format.js';
import { useProject, useChecklist, folderNames, addChecklistItem, getAttachedFile } from '../lib/projects.js';
import { EmptyState } from '../components/feedback/EmptyState.jsx';
import { FolderOpen } from 'lucide-react';

export function ProjectDetailScreen() {
  const { id } = useParams();
  const project = useProject(id);
  const checklist = useChecklist(id);
  const [showAdd, setShowAdd] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);

  if (!project) {
    return (
      <div>
        <ScreenHeader title="Project" back />
        <EmptyState icon={FolderOpen} title="Project not found" />
      </div>
    );
  }

  const done = checklist.filter((i) => i.done).length;
  const total = checklist.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const { totalDays, label, expired } = timeRemaining(project.deadline);
  const u = urgency(totalDays);
  const folders = folderNames(project.id);

  const grouped = useMemo(() => {
    const map = new Map(folders.map((f) => [f, []]));
    checklist.forEach((item) => {
      if (!map.has(item.folder)) map.set(item.folder, []);
      map.get(item.folder).push(item);
    });
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklist, folders.join(',')]);

  return (
    <div>
      <ScreenHeader title="Project" back />
      <div className="p-4">
        <p className="m-0 font-mono text-xs" style={{ color: 'var(--accent)' }}>{project.source_tender_id || `P-${project.id}`}</p>
        <h2 className="m-0 mt-1.5 mb-2 text-lg font-bold leading-snug">{project.title}</h2>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div className="h-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
          </div>
          <span className="font-mono text-sm font-bold">{pct}%</span>
        </div>
        <div className="flex gap-2 mb-4">
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: expired ? 'var(--surface-2)' : `color-mix(in srgb, ${u.color} 16%, transparent)`, color: expired ? 'var(--text-muted)' : u.color }}
          >
            Due {expired ? 'past' : label}
          </span>
          {project.prebid && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              Pre-bid {formatDate(project.prebid)}
            </span>
          )}
        </div>

        <div className="card p-3 mb-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <FieldRow label="Client" value={project.client} />
          <FieldRow label="Project value" value={fmtINR(project.project_value)} />
          <FieldRow label="EMD" value={fmtINR(project.emd)} />
          <FieldRow label="Deadline" value={formatDate(project.deadline)} />
          <FieldRow label="Status" value={project.status} />
          <FieldRow label="Documents ready" value={`${done} / ${total}`} />
        </div>
        {project.description && (
          <div className="card p-3 mb-4">
            <p className="m-0 mb-1.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Work description</p>
            <p className="m-0 text-sm whitespace-pre-wrap">{project.description}</p>
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <p className="m-0 text-sm font-semibold">Document checklist</p>
          <button className="text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }} onClick={() => setShowAdd((v) => !v)}>
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
          <div key={folder} className="mb-4">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              🗂️ {folder} <span style={{ fontWeight: 500 }}>{items.filter((i) => i.done).length}/{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className="m-0 text-xs italic" style={{ color: 'var(--text-muted)' }}>No items in this section yet</p>
            ) : items.map((item) => (
              <ChecklistItem key={item.id} item={item} onPreview={() => setPreviewItem(item)} />
            ))}
          </div>
        ))}
      </div>

      {previewItem && (
        <FilePreview file={getAttachedFile(previewItem.id)} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  );
}
