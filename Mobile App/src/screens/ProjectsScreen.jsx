import React, { useState, useMemo } from 'react';
import { FolderOpen } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { SegmentedControl } from '../components/common/SegmentedControl.jsx';
import { ProjectCard } from '../components/project/ProjectCard.jsx';
import { EmptyState } from '../components/feedback/EmptyState.jsx';
import { useProjects } from '../lib/projects.js';

export function ProjectsScreen() {
  const [seg, setSeg] = useState('active');
  const projects = useProjects();

  const rows = useMemo(
    () => projects.filter((p) => (seg === 'active' ? p.status !== 'Archived' : p.status === 'Archived')),
    [projects, seg],
  );
  const activeCount = projects.filter((p) => p.status !== 'Archived').length;
  const archivedCount = projects.length - activeCount;

  return (
    <div>
      <ScreenHeader title="Projects" />
      <div className="p-4">
        <p className="m-0 mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Track bids in preparation — add checklist items &amp; attach documents. Stored on this device, synced to your account.
        </p>
        <SegmentedControl
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'active', label: `Active · ${activeCount}` },
            { value: 'archived', label: `Archived · ${archivedCount}` },
          ]}
        />
        <div className="flex flex-col gap-3 mt-3">
          {rows.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={seg === 'active' ? 'No active projects yet' : 'No archived projects'}
              body={seg === 'active' ? 'Open a tender and tap "Add to Projects" to start one.' : undefined}
            />
          ) : rows.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      </div>
    </div>
  );
}
