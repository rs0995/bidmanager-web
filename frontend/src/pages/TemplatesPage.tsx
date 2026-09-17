import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Edit3, FileText, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { api, type Template, type TemplateItem } from '../lib/api';
import { EmptyState, Spinner, Badge } from '../components/ui/shared';
import { cn } from '../lib/utils';

type TemplateForm = {
  template_no: string;
  organization: string;
  template_name: string;
  description: string;
  notes: string;
};

const emptyForm = (): TemplateForm => ({ template_no: '', organization: '', template_name: '', description: '', notes: '' });

export default function TemplatesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm());
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [newItem, setNewItem] = useState({ req_file_name: '', description: '', subfolder: 'Ready Docs' });

  const { data: templates, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.listTemplates(),
  });

  const { data: items } = useQuery({
    queryKey: ['template-items', expandedId],
    queryFn: () => api.listTemplateItems(expandedId as number),
    enabled: expandedId !== null,
  });

  const createTemplate = useMutation({
    mutationFn: (d: TemplateForm) => api.createTemplate({
      template_no: d.template_no ? Number(d.template_no) : undefined,
      organization: d.organization,
      template_name: d.template_name,
      description: d.description || undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); resetForm(); },
  });

  const updateTemplate = useMutation({
    mutationFn: ({ id, d }: { id: number; d: TemplateForm }) => api.updateTemplate(id, {
      template_no: d.template_no ? Number(d.template_no) : undefined,
      organization: d.organization,
      template_name: d.template_name,
      description: d.description || undefined,
      notes: d.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); resetForm(); },
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: number) => api.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setConfirmDel(null); setExpandedId(null); },
  });

  const createItem = useMutation({
    mutationFn: () => api.createTemplateItem(expandedId as number, newItem),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['template-items', expandedId] });
      setNewItem({ req_file_name: '', description: '', subfolder: 'Ready Docs' });
    },
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: number) => api.deleteTemplateItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['template-items', expandedId] }),
  });

  const resetForm = () => { setForm(emptyForm()); setShowForm(false); setEditId(null); };

  const openEdit = (t: Template) => {
    setForm({
      template_no: String(t.template_no ?? ''),
      organization: t.organization,
      template_name: t.template_name,
      description: t.description || '',
      notes: t.notes || '',
    });
    setEditId(t.id);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.template_name.trim() || !form.organization.trim()) return;
    if (editId !== null) updateTemplate.mutate({ id: editId, d: form });
    else createTemplate.mutate(form);
  };

  const uf = (k: keyof TemplateForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  const filtered = (templates || []).filter(t =>
    !search ||
    t.template_name.toLowerCase().includes(search.toLowerCase()) ||
    t.organization.toLowerCase().includes(search.toLowerCase()) ||
    (t.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const groupedByOrg = filtered.reduce<Record<string, Template[]>>((acc, t) => {
    const org = t.organization || 'Uncategorized';
    if (!acc[org]) acc[org] = [];
    acc[org].push(t);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[var(--text)]">Checklist Templates</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Manage document checklists for bid submissions</p>
          </div>
          <button onClick={() => { resetForm(); setShowForm(v => !v); }} className="btn-primary text-sm gap-1.5">
            <Plus size={14} /> New Template
          </button>
        </div>
        <div className="mt-3 relative max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="input-field h-9 w-full !pl-10 text-sm"
          />
        </div>
      </div>

      {showForm && (
        <div className="border-b border-[var(--border)] bg-[var(--surface-1)] px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text)]">{editId ? 'Edit Template' : 'New Template'}</h3>
            <button onClick={resetForm} className="text-[var(--text-muted)]"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">No.</label>
              <input value={form.template_no} onChange={e => uf('template_no', e.target.value)} placeholder="1" className="input-field h-9 w-full text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Organization *</label>
              <input value={form.organization} onChange={e => uf('organization', e.target.value)} placeholder="PWD Maharashtra" className="input-field h-9 w-full text-sm" />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Template Name *</label>
              <input value={form.template_name} onChange={e => uf('template_name', e.target.value)} placeholder="Template name" className="input-field h-9 w-full text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Description</label>
              <input value={form.description} onChange={e => uf('description', e.target.value)} className="input-field h-9 w-full text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Notes</label>
              <input value={form.notes} onChange={e => uf('notes', e.target.value)} className="input-field h-9 w-full text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={resetForm} className="btn-ghost text-sm">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!form.template_name.trim() || !form.organization.trim()}
              className="btn-primary gap-1.5 text-sm"
            >
              <Save size={14} />{editId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {confirmDel !== null && (
        <div className="flex items-center justify-between border-b border-rose-500/30 bg-rose-500/10 px-6 py-3">
          <p className="text-sm text-rose-400">Delete this template and all its items?</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDel(null)} className="btn-ghost text-xs">Cancel</button>
            <button onClick={() => deleteTemplate.mutate(confirmDel)} className="btn-danger gap-1 text-xs">
              <Trash2 size={12} />Delete
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size={24} className="text-[var(--accent)]" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description="Create checklist templates to standardize your bid preparation workflow"
            action={<button onClick={() => setShowForm(true)} className="btn-primary text-sm gap-1.5"><Plus size={14} /> New Template</button>}
          />
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedByOrg).map(([org, items_list]) => (
              <div key={org}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{org}</h3>
                <div className="space-y-2">
                  {items_list.map(t => (
                    <div key={t.id} className="card border border-[var(--border)] overflow-hidden">
                      <div
                        className="flex cursor-pointer items-center gap-3 p-4 hover:bg-[var(--surface-1)]"
                        onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                      >
                        {expandedId === t.id ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-[var(--text)]">{t.template_name}</p>
                            {t.template_no && <Badge variant="muted">#{t.template_no}</Badge>}
                          </div>
                          {t.description && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{t.description}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openEdit(t)} className="btn-ghost gap-1 text-xs"><Edit3 size={12} />Edit</button>
                          <button onClick={() => setConfirmDel(t.id)} className="btn-ghost gap-1 text-xs text-rose-400 hover:text-rose-300"><Trash2 size={12} />Delete</button>
                        </div>
                      </div>

                      {expandedId === t.id && (
                        <div className="border-t border-[var(--border)] bg-[var(--surface-1)] p-4">
                          <div className="mb-3 flex items-center gap-2">
                            <input
                              value={newItem.req_file_name}
                              onChange={e => setNewItem(v => ({ ...v, req_file_name: e.target.value }))}
                              placeholder="Document name"
                              className="input-field h-8 flex-1 text-xs"
                            />
                            <input
                              value={newItem.description}
                              onChange={e => setNewItem(v => ({ ...v, description: e.target.value }))}
                              placeholder="Description"
                              className="input-field h-8 flex-1 text-xs"
                            />
                            <input
                              value={newItem.subfolder}
                              onChange={e => setNewItem(v => ({ ...v, subfolder: e.target.value }))}
                              placeholder="Folder"
                              className="input-field h-8 w-32 text-xs"
                            />
                            <button
                              disabled={!newItem.req_file_name.trim() || createItem.isPending}
                              onClick={() => createItem.mutate()}
                              className="btn-primary gap-1 text-xs shrink-0"
                            >
                              <Plus size={12} />Add
                            </button>
                          </div>
                          <TemplateItemsList templateId={t.id} onDelete={(itemId) => deleteItem.mutate(itemId)} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateItemsList({ templateId, onDelete }: { templateId: number; onDelete: (id: number) => void }) {
  const { data: items, isLoading } = useQuery({
    queryKey: ['template-items', templateId],
    queryFn: () => api.listTemplateItems(templateId),
  });

  if (isLoading) return <div className="flex justify-center py-4"><Spinner size={16} className="text-[var(--accent)]" /></div>;
  if (!items?.length) return <p className="text-xs text-[var(--text-muted)]">No items. Add the first document above.</p>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="w-10">#</th>
          <th>Document Name</th>
          <th>Description</th>
          <th className="w-32">Folder</th>
          <th className="w-16 text-center">Del</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={item.id}>
            <td className="text-[var(--text-muted)]">{i + 1}</td>
            <td className="text-sm">{item.req_file_name || '-'}</td>
            <td className="text-xs">{item.description || '-'}</td>
            <td className="text-xs">{item.subfolder || 'Ready Docs'}</td>
            <td className="text-center">
              <button onClick={() => onDelete(item.id)} className="text-rose-400 hover:text-rose-300">
                <Trash2 size={13} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
