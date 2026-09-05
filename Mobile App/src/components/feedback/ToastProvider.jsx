import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, TriangleAlert, Info, X } from 'lucide-react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, ...t }]);
    if (!t.sticky) {
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.duration || 3200);
    }
  }, []);
  const dismiss = useCallback((id) => setToasts((prev) => prev.filter((x) => x.id !== id)), []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed left-0 right-0 z-[200] flex flex-col gap-2 px-4 pb-safe" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        {toasts.map((t) => {
          const Icon = t.type === 'error' ? TriangleAlert : t.type === 'info' ? Info : CheckCircle2;
          const color = t.type === 'error' ? 'var(--danger)' : t.type === 'info' ? 'var(--accent)' : 'var(--ok)';
          return (
            <div key={t.id} className="toast-in card flex items-start gap-3 p-3 shadow-lg">
              <Icon size={18} style={{ color, flexShrink: 0, marginTop: 1 }} />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-semibold">{t.title}</p>
                {t.body && <p className="m-0 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{t.body}</p>}
                {t.action && (
                  <button
                    className="mt-1.5 text-xs font-semibold"
                    style={{ color: 'var(--accent)' }}
                    onClick={() => { t.action.onClick?.(); dismiss(t.id); }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button className="btn-ghost" style={{ minHeight: 0, padding: 4 }} onClick={() => dismiss(t.id)}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
