import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { ProgressRing } from '../common/ProgressRing.jsx';
import { fmtINR, timeRemaining, urgency } from '../../lib/format.js';
import { getChecklist } from '../../lib/projects.js';

export function ProjectCard({ project }) {
  const navigate = useNavigate();
  const items = getChecklist(project.id);
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total ? done / total : 0;
  const { totalDays, label, expired } = timeRemaining(project.deadline);
  const u = urgency(totalDays);

  return (
    <button className="card p-3.5 flex items-center gap-3 text-left w-full" onClick={() => navigate(`/projects/${project.id}`)}>
      <ProgressRing pct={pct} size={44} />
      <div className="min-w-0 flex-1">
        <h4 className="m-0 text-sm font-semibold leading-snug line-clamp-2">{project.title}</h4>
        <p className="m-0 mt-1 text-xs truncate" style={{ color: 'var(--text-muted)' }}>{project.client} · {fmtINR(project.project_value)}</p>
        <p className="m-0 mt-0.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{done}/{total} docs ready</p>
      </div>
      <span
        className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0"
        style={{ background: expired ? 'var(--surface-2)' : `color-mix(in srgb, ${u.color} 16%, transparent)`, color: expired ? 'var(--text-muted)' : u.color }}
      >
        <Clock size={11} /> {expired ? 'Closed' : label}
      </span>
    </button>
  );
}
