import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, FolderOpen, RefreshCw, Server, Trash2, ArrowUp, Columns3 } from 'lucide-react';
import { api } from '../lib/api';
import { EmptyState, Spinner } from '../components/ui/shared';
import { cn } from '../lib/utils';
import { useAppStore } from '../lib/store';

type StorageColumn = {
  key: string;
  label: string;
  width: number;
  fixed?: boolean;
};

const STORAGE_COLUMNS: StorageColumn[] = [
  { key: 'name', label: 'Name', width: 360 },
  { key: 'type', label: 'Type', width: 130 },
  { key: 'size', label: 'Size', width: 140 },
  { key: 'modified', label: 'Modified', width: 220 },
];

function formatBytes(bytes: number) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function ServerPage() {
  const qc = useQueryClient();
  const {
    serverStorageTable,
    setServerStorageHiddenColumns,
    setServerStorageColumnOrder,
    setServerStorageColumnWidth,
  } = useAppStore();

  const [relPath, setRelPath] = useState('');
  const [selectedRelPath, setSelectedRelPath] = useState('');
  const [days, setDays] = useState('30');
  const [showColsMenu, setShowColsMenu] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['server-storage', relPath],
    queryFn: () => api.listServerStorage(relPath),
  });

  const selectedItem = useMemo(() => {
    const items = data?.items || [];
    return items.find((x) => x.rel_path === selectedRelPath) || null;
  }, [data?.items, selectedRelPath]);

  const storageColOrder = useMemo(
    () => (serverStorageTable.columnOrder?.length ? serverStorageTable.columnOrder : STORAGE_COLUMNS.map((c) => c.key)),
    [serverStorageTable.columnOrder]
  );
  const storageHidden = useMemo(
    () => new Set(serverStorageTable.hiddenColumns || []),
    [serverStorageTable.hiddenColumns]
  );
  const orderedStorageCols = useMemo(() => {
    const byKey = new Map(STORAGE_COLUMNS.map((c) => [c.key, c]));
    return storageColOrder.map((k) => byKey.get(k)).filter(Boolean) as StorageColumn[];
  }, [storageColOrder]);
  const visibleStorageCols = orderedStorageCols.filter((c) => c.fixed || !storageHidden.has(c.key));
  const getStorageColWidth = (c: StorageColumn) => {
    const v = serverStorageTable.columnWidths?.[c.key];
    return Number.isFinite(v) && v > 0 ? v : c.width;
  };
  const toggleStorageCol = (key: string) => {
    const next = new Set(storageHidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setServerStorageHiddenColumns(Array.from(next));
  };
  const moveStorageCol = (from: number, to: number) => {
    if (from === to) return;
    const next = [...storageColOrder];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setServerStorageColumnOrder(next);
  };
  const startStorageColResize = (col: StorageColumn, startX: number) => {
    const startW = getStorageColWidth(col);
    const onMove = (evt: MouseEvent) => {
      const next = Math.max(90, startW + (evt.clientX - startX));
      setServerStorageColumnWidth(col.key, next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const deleteFolder = useMutation({
    mutationFn: (path: string) => api.deleteServerFolder(path),
    onSuccess: () => {
      setSelectedRelPath('');
      qc.invalidateQueries({ queryKey: ['server-storage', relPath] });
    },
  });

  const deleteOlder = useMutation({
    mutationFn: (payload: { days: number; relPath: string }) =>
      api.deleteOlderServerFiles(payload.days, payload.relPath),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['server-storage', relPath] });
      alert(`Deleted files: ${res.deleted_files}\nDeleted dirs: ${res.deleted_dirs}`);
    },
  });

  const goParent = () => {
    const parent = data?.parent_rel_path || '';
    setRelPath(parent);
    setSelectedRelPath('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-4">
        <h1 className="text-lg font-bold text-[var(--text)]">Server Control</h1>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">Server storage management</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={goParent} className="btn-ghost gap-1 text-xs" disabled={!data?.parent_rel_path}>
            <ArrowUp size={12} />
            Parent
          </button>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['server-storage', relPath] })} className="btn-ghost gap-1 text-xs">
            <RefreshCw size={12} className={cn(isFetching && 'animate-spin')} />
            Refresh
          </button>
          <button onClick={() => selectedItem?.is_dir && deleteFolder.mutate(selectedItem.rel_path)} className="btn-danger gap-1 text-xs" disabled={!selectedItem?.is_dir || deleteFolder.isPending}>
            <Trash2 size={12} />
            Delete Folder
          </button>
          <div className="ml-2 flex items-center gap-2">
            <input value={days} onChange={(e) => setDays(e.target.value)} className="input-field h-8 w-20 text-xs" placeholder="Days" />
            <button onClick={() => deleteOlder.mutate({ days: Math.max(1, Number(days || 30)), relPath })} className="btn-secondary gap-1 text-xs" disabled={deleteOlder.isPending}>
              <Trash2 size={12} />
              Delete Older Files
            </button>
          </div>
          <div className="relative ml-2">
            <button onClick={() => setShowColsMenu((v) => !v)} className="btn-ghost gap-1 text-xs">
              <Columns3 size={12} />
              Columns
            </button>
            {showColsMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColsMenu(false)} />
                <div className="card absolute right-0 top-8 z-50 max-h-72 w-60 overflow-auto border border-[var(--border)] p-2 shadow-xl">
                  <p className="mb-1 border-b border-[var(--border)] px-2 pb-1 text-xs text-[var(--text-muted)]">Drag to reorder, toggle columns</p>
                  {orderedStorageCols.map((c, i) => (
                    <div key={c.key} draggable onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => {
                      if (dragIdx !== null) {
                        const fromKey = orderedStorageCols[dragIdx]?.key;
                        const toKey = orderedStorageCols[i]?.key;
                        if (fromKey && toKey) {
                          const fi = storageColOrder.indexOf(fromKey);
                          const ti = storageColOrder.indexOf(toKey);
                          if (fi >= 0 && ti >= 0) moveStorageCol(fi, ti);
                        }
                      }
                      setDragIdx(null);
                    }} className={cn('flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--surface-1)]', dragIdx === i && 'opacity-50')}>
                      <span className="select-none cursor-grab text-[var(--text-muted)]">::</span>
                      <input type="checkbox" checked={!storageHidden.has(c.key)} onChange={() => toggleStorageCol(c.key)} className="accent-[var(--accent)]" />
                      <span className="flex-1">{c.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mt-2 text-xs text-[var(--text-muted)]">
          Root: <span className="font-mono">{data?.root_folder || '-'}</span>
          <br />
          Current: <span className="font-mono">{data?.current_rel_path || '/'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} className="text-[var(--accent)]" />
          </div>
        ) : (
          <>
            {!data?.items || data.items.length === 0 ? (
              <EmptyState icon={Server} title="No items" description="Storage folder is empty" />
            ) : (
              <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    {visibleStorageCols.map((c) => (
                      <th key={c.key} style={{ width: getStorageColWidth(c) }} className="relative">
                        <div className="flex items-center">{c.label}</div>
                        <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startStorageColResize(c, e.clientX); }} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.rel_path || item.name} onClick={() => setSelectedRelPath(item.rel_path)} onDoubleClick={() => {
                      if (item.is_dir) {
                        setRelPath(item.rel_path);
                        setSelectedRelPath('');
                      }
                    }} className={cn('cursor-pointer', selectedRelPath === item.rel_path && 'row-selected')}>
                      {visibleStorageCols.map((c) => {
                        if (c.key === 'name') return <td key={c.key} className="text-sm"><span className="inline-flex items-center gap-2">{item.is_dir ? <Folder size={14} /> : <FolderOpen size={14} />}{item.name}</span></td>;
                        if (c.key === 'type') return <td key={c.key} className="text-xs">{item.is_dir ? 'Folder' : 'File'}</td>;
                        if (c.key === 'size') return <td key={c.key} className="text-xs">{item.is_dir ? '-' : formatBytes(item.size_bytes)}</td>;
                        if (c.key === 'modified') return <td key={c.key} className="text-xs">{new Date(item.modified_at).toLocaleString()}</td>;
                        return <td key={c.key} className="text-xs" />;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
