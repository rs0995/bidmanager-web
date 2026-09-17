/* ════════════════════════════════════════════════════════════════════════════
   UX IMPROVEMENTS — VISUAL PREVIEW  (standalone, non-wired)
   ────────────────────────────────────────────────────────────────────────────
   Drop-in preview that showcases proposed UI/UX changes for the Bid Manager
   client. It is intentionally self-contained:

     • Only depends on React + lucide-react (already project deps).
     • Ships its own copy of the design tokens + a few utility classes in an
       injected <style> tag, so it renders correctly even if globals.css
       isn't loaded.
     • Uses mock data only. No api / react-query / store imports.

   HOW TO VIEW
     Option A — temporary route swap in src/main.jsx:
        import Preview from './UxImprovementsPreview.jsx';
        ...render(<Preview />)
     Option B — render it behind a dev-only flag next to <App/>.

   Each mock screen has amber "① why" call-outs pointing at the specific
   change and the reasoning. Toggle them with the "Annotations" switch.
   ════════════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useMemo, createContext, useContext, useCallback } from 'react';
import {
  LayoutDashboard, Globe, FolderOpen, FileText, Server, Settings, Bell, Sun, Moon,
  Search, Plus, RefreshCw, Wifi, WifiOff, Star, ExternalLink, X, Filter,
  ChevronRight, ChevronDown, CircleAlert, Clock, CheckCircle2, ArrowRight, SlidersHorizontal,
  Bookmark, Building2, IndianRupee, CalendarClock, Info, Rows3, Check, TriangleAlert,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
   0.  TOKENS + UTILITY CLASSES  (mirrors globals.css so the preview is portable)
   ═══════════════════════════════════════════════════════════════════════════ */
const PREVIEW_CSS = `
:root, .pv-dark {
  --bg:#0c0e14; --surface-0:#11141c; --surface-1:#181c28; --surface-2:#222838;
  --surface-3:#2c3448; --border:#252d40; --text:#e4e8f1; --text-muted:#6b7a96;
  --accent:#5b8af5; --accent-bg:rgba(91,138,245,.12); --accent-hover:#7aa3ff;
  --row-selected-bg:rgba(91,138,245,.08); --danger:#ef5350; --danger-bg:rgba(239,83,80,.12);
  --ok:#34d399; --warn:#fbbf24;
}
.pv-light {
  --bg:#f5f6fa; --surface-0:#fff; --surface-1:#f0f2f7; --surface-2:#e6e9f0;
  --surface-3:#d8dce6; --border:#dfe2ea; --text:#1a1f2e; --text-muted:#6b7a96;
  --accent:#3b6ce7; --accent-bg:rgba(59,108,231,.08); --accent-hover:#2b5cd4;
  --row-selected-bg:rgba(59,108,231,.06); --danger:#dc2626; --danger-bg:rgba(220,38,38,.08);
  --ok:#059669; --warn:#d97706;
}
.pv-root * { box-sizing:border-box; }
.pv-root { font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
  background:var(--bg); color:var(--text); height:100vh; display:flex; flex-direction:column; }
.pv-card { background:var(--surface-0); border:1px solid var(--border); border-radius:12px; }
.pv-btn { display:inline-flex; align-items:center; gap:6px; min-height:32px; padding:6px 12px;
  border-radius:9px; font-size:13px; font-weight:500; cursor:pointer; transition:all .12s;
  border:1px solid transparent; white-space:nowrap; }
.pv-btn-primary { background:var(--accent); color:#fff; }
.pv-btn-primary:hover { background:var(--accent-hover); }
.pv-btn-secondary { background:var(--surface-2); color:var(--text); border-color:var(--border); }
.pv-btn-secondary:hover { background:var(--surface-3); }
.pv-btn-ghost { background:transparent; color:var(--text-muted); }
.pv-btn-ghost:hover { background:var(--surface-1); color:var(--text); }
.pv-input { background:var(--surface-1); border:1px solid var(--border); border-radius:8px;
  padding:0 10px; height:34px; color:var(--text); font-size:13px; outline:none; transition:border-color .15s; }
.pv-input:focus { border-color:var(--accent); }
.pv-chip { display:inline-flex; align-items:center; gap:5px; padding:4px 9px; border-radius:999px;
  font-size:12px; font-weight:500; border:1px solid var(--border); background:var(--surface-1);
  color:var(--text-muted); cursor:pointer; transition:all .12s; }
.pv-chip:hover { color:var(--text); border-color:var(--accent); }
.pv-chip-on { background:var(--accent-bg); color:var(--accent); border-color:var(--accent); }
.pv-th { padding:8px 12px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase;
  letter-spacing:.04em; color:var(--text-muted); border-bottom:1px solid var(--border); white-space:nowrap; }
.pv-td { padding:11px 12px; font-size:13px; border-bottom:1px solid var(--border); vertical-align:middle; }
.pv-row:hover { background:var(--surface-1); }
.pv-scroll::-webkit-scrollbar { width:8px; height:8px; }
.pv-scroll::-webkit-scrollbar-thumb { background:var(--surface-3); border-radius:4px; }
@keyframes pv-shimmer { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
.pv-skeleton { background:linear-gradient(90deg,var(--surface-1) 25%,var(--surface-2) 37%,var(--surface-1) 63%);
  background-size:800px 100%; animation:pv-shimmer 1.4s infinite linear; border-radius:6px; }
@keyframes pv-slide-in { from{transform:translateX(120%);opacity:0} to{transform:translateX(0);opacity:1} }
.pv-toast { animation:pv-slide-in .22s cubic-bezier(.2,.8,.2,1); }
@keyframes pv-fade { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
.pv-pop { animation:pv-fade .12s ease-out; }
.pv-anno { position:relative; }
.pv-anno-dot { position:absolute; z-index:20; display:inline-flex; align-items:center; gap:6px;
  background:var(--warn); color:#1a1400; font-size:11px; font-weight:700; padding:3px 8px 3px 6px;
  border-radius:999px; box-shadow:0 2px 8px rgba(0,0,0,.35); cursor:help; }
.pv-anno-num { width:16px; height:16px; border-radius:50%; background:rgba(0,0,0,.25);
  display:inline-flex; align-items:center; justify-content:center; font-size:10px; }
`;

const cn = (...a) => a.filter(Boolean).join(' ');

/* ═══════════════════════════════════════════════════════════════════════════
   1.  TOAST SYSTEM   (replaces alert() / window.confirm across the app)
   ═══════════════════════════════════════════════════════════════════════════ */
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((p) => [...p, { id, ...t }]);
    if (!t.sticky) setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), t.duration || 3200);
  }, []);
  const dismiss = useCallback((id) => setToasts((p) => p.filter((x) => x.id !== id)), []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 200, display: 'flex', flexDirection: 'column', gap: 8, width: 340 }}>
        {toasts.map((t) => {
          const Icon = t.type === 'error' ? TriangleAlert : t.type === 'info' ? Info : CheckCircle2;
          const color = t.type === 'error' ? 'var(--danger)' : t.type === 'info' ? 'var(--accent)' : 'var(--ok)';
          return (
            <div key={t.id} className="pv-toast pv-card" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start', boxShadow: '0 8px 30px rgba(0,0,0,.4)' }}>
              <Icon size={18} style={{ color, flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t.title}</p>
                {t.body && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{t.body}</p>}
                {t.action && (
                  <button className="pv-btn pv-btn-ghost" style={{ padding: '2px 0', marginTop: 6, color: 'var(--accent)' }}
                    onClick={() => { t.action.onClick?.(); dismiss(t.id); }}>
                    {t.action.label} <ArrowRight size={13} />
                  </button>
                )}
              </div>
              <button className="pv-btn pv-btn-ghost" style={{ minHeight: 0, padding: 2 }} onClick={() => dismiss(t.id)}><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   2.  ANNOTATION CALL-OUT
   ═══════════════════════════════════════════════════════════════════════════ */
const AnnoCtx = createContext(true);

function Anno({ n, text, top = -10, left = 8, right }) {
  const show = useContext(AnnoCtx);
  const [open, setOpen] = useState(false);
  if (!show) return null;
  const pos = right != null ? { right, top } : { left, top };
  return (
    <span className="pv-anno-dot" style={pos} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="pv-anno-num">{n}</span>
      {open && (
        <span className="pv-pop pv-card" style={{ position: 'absolute', top: 22, left: 0, width: 260, padding: 10, fontSize: 11.5, fontWeight: 500, color: 'var(--text)', lineHeight: 1.45, boxShadow: '0 8px 30px rgba(0,0,0,.5)' }}>
          {text}
        </span>
      )}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   3.  MOCK DATA
   ═══════════════════════════════════════════════════════════════════════════ */
const MOCK_TENDERS = [
  { id: 1, tid: '2026_PWD_884412_1', title: 'Construction of RCC box culvert on SH-27 near Beed', org: 'PWD Maharashtra › Beed Circle', value: 42500000, emd: 425000, closing: 18, cat: 'Works', loc: 'Beed, MH', bookmarked: true },
  { id: 2, tid: '2026_NHAI_771290_3', title: 'Periodic renewal & strengthening of NH-548 km 12–30', org: 'NHAI › Regional Office Mumbai', value: 128000000, emd: 1280000, closing: 40, cat: 'Works', loc: 'Raigad, MH', bookmarked: false },
  { id: 3, tid: '2026_ZP_640021_7', title: 'Supply and installation of solar street lights (312 nos)', org: 'Zilla Parishad › Pune', value: 8900000, emd: 89000, closing: 2, cat: 'Supply', loc: 'Pune, MH', bookmarked: true },
  { id: 4, tid: '2026_MJP_559830_2', title: 'O&M of water treatment plant 24 MLD for 3 years', org: 'Maharashtra Jeevan Pradhikaran › Nashik', value: 61000000, emd: 610000, closing: 6, cat: 'Services', loc: 'Nashik, MH', bookmarked: false },
  { id: 5, tid: '2026_CIDCO_330014_9', title: 'Development of 2.4 km internal roads with stormwater drains', org: 'CIDCO › Navi Mumbai', value: 95500000, emd: 955000, closing: 25, cat: 'Works', loc: 'Navi Mumbai, MH', bookmarked: false },
];
const fmtINR = (n) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${n.toLocaleString('en-IN')}`;
const urgency = (d) => d <= 3 ? { label: 'Critical', color: 'var(--danger)' } : d <= 7 ? { label: 'Soon', color: 'var(--warn)' } : { label: 'Comfortable', color: 'var(--text-muted)' };

const MOCK_PROJECTS = [
  { id: 1, tid: '2026_PWD_884412_1', title: 'RCC box culvert SH-27 Beed', client: 'PWD Maharashtra', value: 42500000, deadline: 4, stage: 'Preparing', done: 7, total: 12 },
  { id: 2, tid: '2026_MJP_559830_2', title: 'WTP O&M 24 MLD Nashik', client: 'MJP Nashik', value: 61000000, deadline: 1, stage: 'Preparing', done: 11, total: 12 },
  { id: 3, tid: '2026_NH_120044_5', title: 'NH-548 renewal km 12–30', client: 'NHAI Mumbai', value: 128000000, deadline: 12, stage: 'Identified', done: 1, total: 10 },
];
const STAGES = ['Identified', 'Preparing', 'Submitted', 'Won', 'Lost'];

/* ═══════════════════════════════════════════════════════════════════════════
   4.  NEW APP HEADER  —  global search, quick actions, live connection
   ═══════════════════════════════════════════════════════════════════════════ */
function AppHeader({ page, theme, onTheme, online, lastSync }) {
  const { push } = useToast();
  return (
    <header style={{ height: 52, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', position: 'relative', zIndex: 30 }}>
      <div className="pv-anno" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--accent)' }}>BID MANAGER</span>
        <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{page}</span>
        <Anno n={1} right={-4} text="Header now shows where you are (breadcrumb) instead of a static 'Tender & Bid Manager' label." />
      </div>

      <div style={{ flex: 1 }} />

      {/* Quick actions — Sync only. Replaces the separate Refresh buttons that
          exist today on Dashboard and Tenders with one shared header action;
          no header "New Project" button on any tab. */}
      <button className="pv-btn pv-btn-secondary pv-anno" onClick={() => push({ title: 'Sync started', body: 'Reading tenders from server…', type: 'info' })}>
        <RefreshCw size={14} /> Sync
        <Anno n={3} top={38} left={-4} text="One Sync action in the header, reachable from every screen, replacing the separate Refresh buttons duplicated today on Dashboard and Tenders." />
      </button>

      {/* Live connection status */}
      <div className="pv-anno" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: online ? 'rgba(52,211,153,.12)' : 'var(--danger-bg)', border: `1px solid ${online ? 'rgba(52,211,153,.4)' : 'var(--danger)'}` }}>
        {online ? <Wifi size={13} style={{ color: 'var(--ok)' }} /> : <WifiOff size={13} style={{ color: 'var(--danger)' }} />}
        <span style={{ fontSize: 11.5, fontWeight: 600, color: online ? 'var(--ok)' : 'var(--danger)' }}>{online ? `Synced ${lastSync}` : 'Offline'}</span>
        <Anno n={4} top={38} right={-4} text="Connection + last-sync age is always visible. Today you only discover a stale/offline backend by opening Settings → Connection." />
      </div>

      <button className="pv-btn pv-btn-ghost" style={{ minHeight: 0, padding: 6 }}><Bell size={16} /></button>
      <button className="pv-btn pv-btn-ghost" style={{ minHeight: 0, padding: 6 }} onClick={onTheme}>
        {theme === 'pv-dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   6.  SIDEBAR  (unchanged structurally — shown for context)
   ═══════════════════════════════════════════════════════════════════════════ */
function Sidebar({ active, onNavigate }) {
  const items = [
    ['Dashboard', LayoutDashboard], ['Online Tenders', Globe], ['Projects', FolderOpen],
    ['Templates', FileText], ['Files', Server], ['Settings', Settings],
  ];
  return (
    <div style={{ width: 210, borderRight: '1px solid var(--border)', background: 'var(--surface-0)', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map(([label, Icon]) => (
        <button key={label} onClick={() => onNavigate(label)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, fontSize: 13, cursor: 'pointer', border: 'none', textAlign: 'left',
            background: active === label ? 'var(--accent-bg)' : 'transparent',
            color: active === label ? 'var(--accent)' : 'var(--text-muted)', fontWeight: active === label ? 600 : 400 }}>
          <Icon size={17} /> {label}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   7.  DASHBOARD  —  "Needs attention" + clickable stats with deltas
   ═══════════════════════════════════════════════════════════════════════════ */
function DashboardMock({ onNavigate }) {
  const stats = [
    { label: 'Active Tenders', value: 128, delta: +12, icon: Globe },
    { label: 'Active Projects', value: 9, delta: +2, icon: FolderOpen },
    { label: 'Bookmarked', value: 14, delta: -3, icon: Bookmark },
    { label: 'Closing < 7 days', value: 6, delta: +4, icon: Clock, alert: true },
  ];
  // Pipeline Value = total value of tenders "under preparation" (i.e. already
  // turned into a project) — not every project ever created, so a Won/Lost
  // bid stops counting once it leaves preparation. Mirrors the real app's
  // dashboardStats() once it's filtered to active projects only.
  const underPreparation = MOCK_PROJECTS.filter((p) => p.stage !== 'Won' && p.stage !== 'Lost');
  const pipelineValue = underPreparation.reduce((sum, p) => sum + p.value, 0);
  const avgBidValue = underPreparation.length ? pipelineValue / underPreparation.length : 0;
  const attention = [
    { icon: CircleAlert, color: 'var(--danger)', text: '2 bookmarked tenders close in under 48 h and have no project yet', cta: 'Review', to: 'Online Tenders' },
    { icon: Clock, color: 'var(--warn)', text: '“WTP O&M 24 MLD Nashik” — 11 of 12 checklist items done, deadline tomorrow', cta: 'Open project', to: 'Projects' },
    { icon: WifiOff, color: 'var(--text-muted)', text: 'Tender data last synced 3 days ago', cta: 'Sync now', to: null },
  ];
  return (
    <div className="pv-scroll" style={{ padding: 24, overflow: 'auto', height: '100%' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>Dashboard</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 20px' }}>Overview of your tender pipeline</p>

      {/* Needs attention */}
      <div className="pv-card pv-anno" style={{ padding: 18, marginBottom: 20, borderColor: 'var(--warn)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <TriangleAlert size={16} style={{ color: 'var(--warn)' }} />
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Needs attention</h3>
        </div>
        <Anno n={5} top={-10} left={16} text="New section that surfaces time-sensitive items the user would otherwise have to hunt for: near-deadline tenders with no project, nearly-complete bids, stale sync. Each row is a one-click jump." />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {attention.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--surface-1)', borderRadius: 9 }}>
              <a.icon size={16} style={{ color: a.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13 }}>{a.text}</span>
              <button className="pv-btn pv-btn-secondary" style={{ minHeight: 28 }} onClick={() => a.to && onNavigate(a.to)}>{a.cta} <ArrowRight size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Stat cards — clickable, with deltas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {stats.map((s, i) => (
          <button key={i} onClick={() => onNavigate('Online Tenders')} className="pv-card pv-anno"
            style={{ padding: 16, textAlign: 'left', cursor: 'pointer', border: s.alert ? '1px solid var(--warn)' : '1px solid var(--border)', background: 'var(--surface-0)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <s.icon size={18} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: s.delta >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                {s.delta >= 0 ? '▲' : '▼'} {Math.abs(s.delta)}
              </span>
            </div>
            <p style={{ fontSize: 26, fontWeight: 700, margin: '10px 0 0' }}>{s.value}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{s.label}</p>
            {i === 0 && <Anno n={6} top={-10} left={12} text="Stat cards are clickable (→ pre-filtered list) and show a 7-day delta so a number in isolation becomes a trend." />}
          </button>
        ))}
      </div>

      {/* Pipeline value (left) + deadlines grouped by urgency (right) —
          Website Coverage is intentionally not represented here; it's
          disabled on the real dashboard. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="pv-card pv-anno" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <IndianRupee size={14} style={{ color: 'var(--accent)' }} />
              <h3 style={{ fontSize: 12, fontWeight: 700, margin: 0, color: 'var(--text-muted)' }}>Pipeline Value</h3>
            </div>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{fmtINR(pipelineValue)}</p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{underPreparation.length} bids under preparation</p>
            <Anno n={13} top={-10} left={12} text="Redefined to only count tenders that have actually been turned into a project (“under preparation”) instead of every project ever created, and shrunk — a second, complementary card sits directly below it instead of one tall card." />
          </div>
          <div className="pv-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <IndianRupee size={14} style={{ color: 'var(--text-muted)' }} />
              <h3 style={{ fontSize: 12, fontWeight: 700, margin: 0, color: 'var(--text-muted)' }}>Average Bid Value</h3>
            </div>
            <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{fmtINR(avgBidValue)}</p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>per bid under preparation</p>
          </div>
        </div>

        <div className="pv-card pv-anno" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px' }}>Upcoming deadlines</h3>
          <Anno n={7} top={-10} left={16} text="Deadlines are grouped and colour-banded by urgency (Critical ≤3d / Soon ≤7d / Comfortable) with a bar, instead of a flat list where the urgent ones don't stand out." />
          {['Critical', 'Soon', 'Comfortable'].map((band) => {
            const rows = MOCK_TENDERS.filter((t) => urgency(t.closing).label === band);
            if (!rows.length) return null;
            const c = rows[0] && urgency(rows[0].closing).color;
            return (
              <div key={band} style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: c, margin: '0 0 6px' }}>{band}</p>
                {rows.map((t) => (
                  <div key={t.id} className="pv-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 6px', borderRadius: 7, cursor: 'pointer' }} onClick={() => onNavigate('Online Tenders')}>
                    <div style={{ width: 3, alignSelf: 'stretch', background: c, borderRadius: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, fontFamily: 'ui-monospace,monospace', color: 'var(--accent)', margin: 0 }}>{t.tid}</p>
                      <p style={{ fontSize: 13, margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</p>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: c }}>{t.closing}d left</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   8.  TENDERS  —  filter bar, streamlined columns, urgency rail,
                   bulk actions, row → detail drawer, skeletons
   ═══════════════════════════════════════════════════════════════════════════ */
function TendersMock() {
  const { push } = useToast();
  const [loading, setLoading] = useState(false);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [closingFilter, setClosingFilter] = useState('any'); // any | 7 | 3
  const [minValue, setMinValue] = useState('any'); // any | 1cr | 5cr
  const [selected, setSelected] = useState([]);
  const [drawer, setDrawer] = useState(null);

  const rows = useMemo(() => MOCK_TENDERS.filter((t) => {
    if (bookmarkedOnly && !t.bookmarked) return false;
    if (closingFilter === '7' && t.closing > 7) return false;
    if (closingFilter === '3' && t.closing > 3) return false;
    if (minValue === '1cr' && t.value < 1e7) return false;
    if (minValue === '5cr' && t.value < 5e7) return false;
    return true;
  }), [bookmarkedOnly, closingFilter, minValue]);

  const allSel = selected.length === rows.length && rows.length > 0;
  const activeFilters = [bookmarkedOnly && 'Bookmarked', closingFilter !== 'any' && `Closing ≤ ${closingFilter}d`, minValue !== 'any' && `≥ ${minValue === '1cr' ? '₹1 Cr' : '₹5 Cr'}`].filter(Boolean);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header + filter bar */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Online Tenders</h1>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-2)', borderRadius: 999, padding: '2px 8px' }}>{rows.length}</span>
          <div style={{ flex: 1 }} />
          <button className="pv-btn pv-btn-ghost" onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1400); push({ title: 'Refreshed', type: 'info' }); }}><RefreshCw size={13} /> Refresh</button>
          <button className="pv-btn pv-btn-ghost"><Rows3 size={13} /> Columns</button>
        </div>

        <div className="pv-anno" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
            <input className="pv-input" style={{ width: '100%', paddingLeft: 30 }} placeholder="Search title, org, ID…" />
          </div>
          <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <button className={cn('pv-chip', bookmarkedOnly && 'pv-chip-on')} onClick={() => setBookmarkedOnly((v) => !v)}><Star size={12} /> Bookmarked</button>
          {[['any', 'Any time'], ['7', 'Closing ≤ 7d'], ['3', 'Closing ≤ 3d']].map(([v, l]) => (
            <button key={v} className={cn('pv-chip', closingFilter === v && 'pv-chip-on')} onClick={() => setClosingFilter(v)}>{l}</button>
          ))}
          {[['any', 'Any value'], ['1cr', '≥ ₹1 Cr'], ['5cr', '≥ ₹5 Cr']].map(([v, l]) => (
            <button key={v} className={cn('pv-chip', minValue === v && 'pv-chip-on')} onClick={() => setMinValue(v)}><IndianRupee size={11} /> {l}</button>
          ))}
          <Anno n={8} top={-30} left={0} text="A real filter bar: bookmark, closing-window and value chips (extendable to category / location / status). Replaces the single free-text box that forced users to scan 15 columns manually." />
        </div>

        {activeFilters.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            <Filter size={12} /> {activeFilters.join(' · ')}
            <button className="pv-btn pv-btn-ghost" style={{ minHeight: 0, padding: '2px 6px', fontSize: 12 }}
              onClick={() => { setBookmarkedOnly(false); setClosingFilter('any'); setMinValue('any'); }}>Clear all</button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.length > 0 && (
        <div className="pv-pop" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px', background: 'var(--accent-bg)', borderBottom: '1px solid var(--accent)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}>{selected.length} selected</span>
          <button className="pv-btn pv-btn-secondary" style={{ minHeight: 28 }} onClick={() => { push({ title: `${selected.length} tenders bookmarked` }); setSelected([]); }}><Star size={12} /> Bookmark</button>
          <button className="pv-btn pv-btn-secondary" style={{ minHeight: 28 }} onClick={() => { push({ title: `${selected.length} projects created`, action: { label: 'View projects' } }); setSelected([]); }}><Plus size={12} /> Add to projects</button>
          <button className="pv-btn pv-btn-ghost" style={{ minHeight: 28 }} onClick={() => setSelected([])}>Cancel</button>
        </div>
      )}

      {/* Table */}
      <div className="pv-scroll" style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-0)', zIndex: 5 }}>
            <tr>
              <th className="pv-th" style={{ width: 36 }}>
                <input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? [] : rows.map((r) => r.id))} />
              </th>
              <th className="pv-th">Tender</th>
              <th className="pv-th">Organisation</th>
              <th className="pv-th" style={{ textAlign: 'right' }}>Value</th>
              <th className="pv-th">Closing</th>
              <th className="pv-th" style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? [...Array(5)].map((_, i) => (
              <tr key={i}><td className="pv-td" colSpan={6}><div className="pv-skeleton" style={{ height: 34 }} /></td></tr>
            )) : rows.map((t) => {
              const u = urgency(t.closing);
              const sel = selected.includes(t.id);
              return (
                <tr key={t.id} className="pv-row" style={{ cursor: 'pointer', background: sel ? 'var(--row-selected-bg)' : undefined }} onClick={() => setDrawer(t)}>
                  <td className="pv-td" style={{ borderLeft: `3px solid ${u.color}` }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel} onChange={() => setSelected((p) => sel ? p.filter((x) => x !== t.id) : [...p, t.id])} />
                  </td>
                  <td className="pv-td">
                    <p style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, color: 'var(--accent)', margin: 0 }}>{t.tid}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 13, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.bookmarked && <Star size={11} fill="var(--warn)" color="var(--warn)" style={{ marginRight: 4, verticalAlign: -1 }} />}
                      {t.title}
                    </p>
                  </td>
                  <td className="pv-td" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t.org}</td>
                  <td className="pv-td" style={{ textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontSize: 12.5 }}>{fmtINR(t.value)}</td>
                  <td className="pv-td">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: u.color }}>
                      <Clock size={12} /> {t.closing}d
                    </span>
                  </td>
                  <td className="pv-td" onClick={(e) => e.stopPropagation()}>
                    <button className="pv-btn pv-btn-ghost" style={{ minHeight: 0, padding: 5 }} title="Add to project"><Plus size={14} /></button>
                    <button className="pv-btn pv-btn-ghost" style={{ minHeight: 0, padding: 5 }} title="Open source"><ExternalLink size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="pv-anno" style={{ padding: '10px 20px', fontSize: 11.5, color: 'var(--text-muted)' }}>
          Showing {rows.length} of {MOCK_TENDERS.length}
          <Anno n={9} top={-4} left={140} text="Default view = 5 meaningful columns (was 15 at a fixed 2600px, so every session started with a horizontal scroll). Full detail lives in the row drawer →. Column picker + saved views cover power users." />
          <Anno n={10} top={-4} left={360} text="Left rail on every row is colour-coded by deadline urgency, so 'closing in 2 days' is visible at a glance while scanning. Skeleton rows replace the lone centred spinner on load." />
        </div>
      </div>

      {/* Row detail drawer */}
      {drawer && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 90 }} onClick={() => setDrawer(null)} />
          <aside className="pv-pop" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, background: 'var(--bg)', borderLeft: '1px solid var(--border)', zIndex: 100, boxShadow: '-8px 0 40px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface-0)' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Tender detail</span>
              <button className="pv-btn pv-btn-ghost" style={{ minHeight: 0, padding: 4 }} onClick={() => setDrawer(null)}><X size={16} /></button>
            </div>
            <div className="pv-scroll" style={{ padding: 18, overflow: 'auto', flex: 1 }}>
              <p style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: 'var(--accent)', margin: 0 }}>{drawer.tid}</p>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: '6px 0 16px', lineHeight: 1.35 }}>{drawer.title}</h2>
              {[['Organisation', drawer.org], ['Category', drawer.cat], ['Location', drawer.loc], ['Tender value', fmtINR(drawer.value)], ['EMD', fmtINR(drawer.emd)], ['Closing in', `${drawer.closing} days`]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}</span><span style={{ fontWeight: 500, textAlign: 'right', maxWidth: 260 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 14, borderTop: '1px solid var(--border)', background: 'var(--surface-0)' }}>
              <button className="pv-btn pv-btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { push({ title: 'Project created', action: { label: 'Open workspace' } }); setDrawer(null); }}><Plus size={14} /> Add to projects</button>
              <button className="pv-btn pv-btn-secondary"><Star size={14} /></button>
              <button className="pv-btn pv-btn-secondary"><ExternalLink size={14} /></button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   9.  PROJECTS  —  checklist progress + pipeline stage
   ═══════════════════════════════════════════════════════════════════════════ */
function Ring({ done, total, size = 40 }) {
  const pct = total ? done / total : 0;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const col = pct === 1 ? 'var(--ok)' : pct >= 0.6 ? 'var(--accent)' : 'var(--warn)';
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text)">{done}/{total}</text>
    </svg>
  );
}

function ProjectsMock() {
  const [view, setView] = useState('cards'); // cards | board
  return (
    <div className="pv-scroll" style={{ padding: 24, overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Projects</h1>
        <div style={{ flex: 1 }} />
        <div className="pv-anno" style={{ display: 'inline-flex', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
          {['cards', 'board'].map((v) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', textTransform: 'capitalize', background: view === v ? 'var(--surface-0)' : 'transparent', color: view === v ? 'var(--text)' : 'var(--text-muted)' }}>{v}</button>
          ))}
          <Anno n={11} top={-30} right={0} text="Adds a Kanban board view over the existing pipeline stage, so 'what's where' is visible without opening each project. Table/cards stay for detail work." />
        </div>
      </div>

      {view === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
          {MOCK_PROJECTS.map((p) => {
            const u = urgency(p.deadline);
            return (
              <div key={p.id} className="pv-card pv-anno" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Ring done={p.done} total={p.total} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, color: 'var(--accent)', margin: 0 }}>{p.tid}</p>
                    <p style={{ fontSize: 13.5, fontWeight: 600, margin: '3px 0 0', lineHeight: 1.35 }}>{p.title}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  <Building2 size={12} /> {p.client}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{p.stage}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: u.color }}><Clock size={12} /> {p.deadline}d left</span>
                </div>
                {p.id === 1 && <Anno n={12} top={-10} left={12} text="Every card carries a checklist completion ring + pipeline stage chip + deadline urgency. Today the card shows fields but not 'how done is this bid'." />}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length},minmax(180px,1fr))`, gap: 12 }}>
          {STAGES.map((stage) => (
            <div key={stage} style={{ background: 'var(--surface-1)', borderRadius: 10, padding: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', margin: '0 0 8px' }}>{stage}</p>
              {MOCK_PROJECTS.filter((p) => p.stage === stage).map((p) => (
                <div key={p.id} className="pv-card" style={{ padding: 10, marginBottom: 8 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 600, margin: 0 }}>{p.title}</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.done}/{p.total} done</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: urgency(p.deadline).color }}>{p.deadline}d</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   10.  OVERVIEW TAB  —  written summary of every change
   ═══════════════════════════════════════════════════════════════════════════ */
const CHANGES = [
  ['Global command palette (⌘K)', 'Header search box opens a palette to jump to any tender / project / page or run an action. Today search is per-page and the top bar is an empty label.'],
  ['Breadcrumb header', 'Header shows BID MANAGER › <current page> instead of a static product name.'],
  ['Always-on connection status', 'Online / offline + last-sync age pill in the header. Currently only discoverable via Settings → Connection.'],
  ['Header quick actions', 'Sync and New Project reachable from every screen.'],
  ['Toasts replace alert()', 'Non-blocking toasts with an optional follow-up action ("Open workspace"), instead of ~10 blocking window.alert / confirm calls.'],
  ['Dashboard "Needs attention"', 'Surfaces near-deadline tenders with no project, nearly-complete bids, and stale sync — each a one-click jump.'],
  ['Clickable stat cards + deltas', 'Cards navigate to a pre-filtered list and show a 7-day change so a number becomes a trend.'],
  ['Urgency-banded deadlines', 'Deadlines grouped Critical ≤3d / Soon ≤7d / Comfortable with a colour rail.'],
  ['Tenders filter bar', 'Bookmark / closing-window / value chips + active-filter summary, replacing the single free-text box over 15 columns.'],
  ['Streamlined tender table', '5 meaningful columns by default (was 15 at a fixed ~2600px → forced horizontal scroll). Column picker + saved views for power users.'],
  ['Row detail drawer', 'Clicking a row opens a drawer with all fields + actions, instead of only highlighting it.'],
  ['Deadline urgency rail', 'Colour-coded left border on each row; skeleton loaders instead of a lone spinner.'],
  ['Bulk actions', 'Multi-select → bulk bookmark / add-to-project / export.'],
  ['Projects: progress ring + stage', 'Each card shows checklist completion and pipeline stage; optional Kanban board view.'],
  ['Accessibility pass', 'Focus-visible rings, aria labels on icon-only buttons, keyboard nav for palette and drawers, ESC to close overlays.'],
];

function OverviewTab() {
  return (
    <div className="pv-scroll" style={{ padding: 28, overflow: 'auto', height: '100%', maxWidth: 860 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Proposed UI/UX improvements</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 22px', lineHeight: 1.6 }}>
        Preview only — nothing here is wired to the API or store. Switch tabs above to see each change in context;
        hover the amber ① markers for the rationale. Toggle the theme and annotations from the top-right.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {CHANGES.map(([title, body], i) => (
          <div key={i} className="pv-card" style={{ padding: 14, display: 'flex', gap: 12 }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
            <div>
              <p style={{ fontSize: 13.5, fontWeight: 600, margin: 0 }}>{title}</p>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '3px 0 0', lineHeight: 1.5 }}>{body}</p>
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 24, lineHeight: 1.6 }}>
        Low-risk / high-value order to implement: toasts → header (search + status + actions) → command palette →
        tenders filter bar &amp; drawer → dashboard "Needs attention" → projects progress ring → Kanban view.
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   11.  PREVIEW SHELL
   ═══════════════════════════════════════════════════════════════════════════ */
const TABS = ['Overview', 'Dashboard', 'Online Tenders', 'Projects'];

export default function UxImprovementsPreview() {
  const [theme, setTheme] = useState('pv-dark');
  const [anno, setAnno] = useState(true);
  const [tab, setTab] = useState('Overview');

  return (
    <ToastProvider>
      <AnnoCtx.Provider value={anno}>
        <style>{PREVIEW_CSS}</style>
        <div className={cn('pv-root', theme)}>
          {/* preview control strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 16px', background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
            <span style={{ fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-muted)' }}>UX PREVIEW</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: tab === t ? 'var(--accent)' : 'transparent', color: tab === t ? '#fff' : 'var(--text-muted)' }}>{t}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={anno} onChange={(e) => setAnno(e.target.checked)} /> Annotations
            </label>
            <button className="pv-btn pv-btn-ghost" style={{ minHeight: 0, padding: '4px 8px' }} onClick={() => setTheme((t) => t === 'pv-dark' ? 'pv-light' : 'pv-dark')}>
              {theme === 'pv-dark' ? <Sun size={13} /> : <Moon size={13} />} {theme === 'pv-dark' ? 'Light' : 'Dark'}
            </button>
          </div>

          <AppHeader page={tab === 'Overview' ? 'Overview' : tab} theme={theme}
            onTheme={() => setTheme((t) => t === 'pv-dark' ? 'pv-light' : 'pv-dark')}
            online lastSync="2m ago" />

          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <Sidebar active={tab} onNavigate={(p) => TABS.includes(p) && setTab(p)} />
            <main style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)' }}>
              {tab === 'Overview' && <OverviewTab />}
              {tab === 'Dashboard' && <DashboardMock onNavigate={(p) => TABS.includes(p) && setTab(p)} />}
              {tab === 'Online Tenders' && <TendersMock />}
              {tab === 'Projects' && <ProjectsMock />}
            </main>
          </div>
        </div>
      </AnnoCtx.Provider>
    </ToastProvider>
  );
}
