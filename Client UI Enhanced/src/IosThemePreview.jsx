/* ════════════════════════════════════════════════════════════════════════════
   iOS THEME — EMPTY VISUAL PREVIEW   (standalone, non-wired)
   ────────────────────────────────────────────────────────────────────────────
   Shows the Client UI re-skinned with the BidManager Mobile App's theme
   (the light "iOS" look from the phone screenshot): warm-neutral surfaces,
   pure-white cards with a soft shadow, larger corner radii, DM Sans, pill
   chips / segmented controls, 44-class touch-sized controls scaled for
   desktop.

   WHAT IS AND ISN'T CHANGED
     • Theme only — colours, radii, shadows, typography, control shapes.
     • Every screen keeps the EXISTING Client UI layout and, crucially, the
       existing BUTTON PLACEMENT (e.g. "Sync Now" top-right on Dashboard and
       Online Tenders, "New Template" top-right on Templates, the Files
       toolbar order, Settings connection badge top-right, the sidebar item
       order, the header Download / Bell / Theme cluster).
     • Nothing here is wired to the API, store or react-query. Mock data only,
       kept deliberately thin so this reads as an "empty" shell.

   HOW TO VIEW
     Dev server → open  http://localhost:3000/?preview=ios
     (src/main.jsx swaps in this component when that query flag is present.)

   Palette is sampled from the Mobile App screenshots (warm-paper ground,
   white cards, near-black text, INDIGO accent — no blue).  Toggle light/dark
   from the preview strip; the screenshot look is the light default.
   ════════════════════════════════════════════════════════════════════════════ */

import React, { useState } from 'react';
import {
  LayoutDashboard, Globe, Building2, Star, FolderOpen, FileText, Server, Settings,
  Bell, Download, Sun, Moon, PanelLeftClose, PanelLeft, Wifi, RefreshCw, Search, X,
  Clock, Filter, FileDown, SlidersHorizontal, Plus, IndianRupee, Activity, Calendar,
  Bookmark, FolderCog, AlertTriangle, ArrowUp, Trash2, Columns3, List, LayoutGrid,
  CheckSquare, ArchiveRestore,
} from 'lucide-react';

const cn = (...a) => a.filter(Boolean).join(' ');

/* ═══════════════════════════════════════════════════════════════════════════
   0.  THEME TOKENS + CLASSES   (ported from Mobile App/src/globals.css)
   ═══════════════════════════════════════════════════════════════════════════ */
const IOS_CSS = `
/* Palette sampled from the BidManager Mobile App screenshots:
   warm-paper ground, white cards, near-black text, INDIGO accent (no blue),
   warm-toned semantic colours. */
.ios.ios-light {
  --bg:#f3f1ec; --surface-0:#ffffff; --surface-1:#ece9e2; --surface-2:#e3e0d7;
  --surface-3:#d5d1c6; --border:#e6e2d9; --text:#1f1e1c; --text-muted:#8a867c;
  --accent:#4f46e5; --accent-bg:#ebe9fb; --accent-hover:#4338ca;
  --row-selected-bg:rgba(79,70,229,.06); --danger:#c0392b; --danger-bg:rgba(192,57,43,.10);
  --ok:#3f9b6d; --ok-bg:#dcefe4; --warn:#9a6b1f; --warn-bg:#f2e3ce; --star:#e0a13c;
  --shadow-card:0 1px 2px rgba(30,27,23,.04), 0 1px 3px rgba(30,27,23,.07);
}
.ios, .ios.ios-dark {
  --bg:#17161a; --surface-0:#201f24; --surface-1:#2a2930; --surface-2:#343139;
  --surface-3:#403c46; --border:#302e36; --text:#ececed; --text-muted:#9a97a2;
  --accent:#8b83f5; --accent-bg:rgba(139,131,245,.16); --accent-hover:#a29bf8;
  --row-selected-bg:rgba(139,131,245,.10); --danger:#f0776a; --danger-bg:rgba(240,119,106,.14);
  --ok:#5cc593; --ok-bg:rgba(92,197,147,.14); --warn:#e0b165; --warn-bg:rgba(224,177,101,.14); --star:#e0b165;
  --shadow-card:0 1px 2px rgba(0,0,0,.30), 0 1px 3px rgba(0,0,0,.38);
}
.ios * { box-sizing:border-box; }
.ios {
  font-family:'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  background:var(--bg); color:var(--text); height:100vh; display:flex; flex-direction:column;
  -webkit-font-smoothing:antialiased;
}
.ios h1, .ios h2, .ios h3, .ios p { margin:0; }
.ios .mono { font-family:'JetBrains Mono', ui-monospace, monospace; }

/* Card — bigger radius + soft shadow, the defining iOS move */
.ios-card { background:var(--surface-0); border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow-card); }

/* Buttons — 11px radius, 600 weight, generous hit area */
.ios-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:36px;
  padding:0 15px; border-radius:11px; font-size:13px; font-weight:600; cursor:pointer;
  border:1px solid transparent; white-space:nowrap; transition:background .12s, opacity .12s, border-color .12s; }
.ios-btn-sm { min-height:30px; padding:0 11px; font-size:12px; border-radius:9px; }
.ios-btn-primary { background:var(--accent); color:#fff; }
.ios-btn-primary:hover { background:var(--accent-hover); }
.ios-btn-secondary { background:var(--surface-2); color:var(--text); border-color:var(--border); }
.ios-btn-secondary:hover { background:var(--surface-3); }
.ios-btn-ghost { background:transparent; color:var(--text-muted); }
.ios-btn-ghost:hover { background:var(--surface-1); color:var(--text); }
.ios-btn-ghost.on { background:var(--accent-bg); color:var(--accent); }
.ios-btn-danger { background:var(--danger-bg); color:var(--danger); }
.ios-btn:disabled { opacity:.4; cursor:not-allowed; }

/* Inputs */
.ios-input { width:100%; background:var(--surface-1); border:1px solid var(--border); border-radius:10px;
  padding:0 12px; height:36px; color:var(--text); font-size:13px; outline:none; transition:border-color .15s; }
.ios-input:focus { border-color:var(--accent); }
.ios-input::placeholder { color:var(--text-muted); }
.ios select.ios-input { appearance:none; padding-right:26px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%236b7a96' viewBox='0 0 24 24'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat; background-position:right 8px center; }

/* Chip / pill */
.ios-chip { display:inline-flex; align-items:center; gap:5px; padding:6px 11px; border-radius:999px;
  font-size:12px; font-weight:500; border:1px solid var(--border); background:var(--surface-1);
  color:var(--text-muted); cursor:pointer; transition:all .12s; }
.ios-chip:hover { color:var(--text); }
.ios-chip.on { background:var(--accent-bg); color:var(--accent); border-color:var(--accent); }

/* Segmented control */
.ios-seg { display:inline-flex; background:var(--surface-1); border:1px solid var(--border); border-radius:10px; padding:3px; gap:2px; }
.ios-seg-item { display:inline-flex; align-items:center; gap:5px; padding:6px 12px; font-size:12px; font-weight:600;
  border-radius:8px; color:var(--text-muted); border:none; background:transparent; cursor:pointer; transition:all .12s; }
.ios-seg-item.on { background:var(--surface-0); color:var(--text); box-shadow:0 1px 2px rgba(16,24,40,.12); }

/* Badge */
.ios-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px;
  font-size:11px; font-weight:600; }
.ios-badge-success { background:var(--ok-bg); color:var(--ok); }
.ios-badge-danger { background:var(--danger-bg); color:var(--danger); }
.ios-badge-warning { background:var(--warn-bg); color:var(--warn); }
.ios-badge-muted { background:var(--surface-2); color:var(--text-muted); }

/* Table */
.ios-table { width:100%; border-collapse:separate; border-spacing:0; }
.ios-table th { padding:9px 14px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:var(--text-muted); border-bottom:1px solid var(--border); white-space:nowrap; background:var(--surface-0); }
.ios-table td { padding:12px 14px; font-size:13px; border-bottom:1px solid var(--border); vertical-align:middle; }
.ios-table tbody tr:hover { background:var(--surface-1); }

/* Nav item */
.ios-nav { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:11px; font-size:13px;
  width:100%; text-align:left; border:none; cursor:pointer; background:transparent; color:var(--text-muted); transition:all .12s; }
.ios-nav:hover { background:var(--surface-1); color:var(--text); }
.ios-nav.on { background:var(--accent-bg); color:var(--accent); font-weight:600; }

.ios-scroll::-webkit-scrollbar { width:8px; height:8px; }
.ios-scroll::-webkit-scrollbar-thumb { background:var(--surface-3); border-radius:4px; }
.ios-dot { width:8px; height:8px; border-radius:999px; flex-shrink:0; }
`;

/* ═══════════════════════════════════════════════════════════════════════════
   1.  THIN MOCK DATA  (kept minimal — this is an empty shell)
   ═══════════════════════════════════════════════════════════════════════════ */
const fmtCr = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(1)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${n.toLocaleString('en-IN')}`);

const STATS = [
  { label: 'Active Tenders', value: 148, icon: Globe, dot: '#4f46e5' },
  { label: 'Active Projects', value: 6, icon: FolderOpen, dot: '#3f9b6d' },
  { label: 'Bookmarked', value: 4, icon: Bookmark, dot: '#c98a2e' },
  { label: 'Closing < 7 Days', value: 3, icon: Clock, dot: '#c0392b' },
  { label: 'Archived', value: 21, icon: AlertTriangle, dot: '#c0392b' },
];

const DEADLINES = [
  { band: 'Critical', color: 'var(--danger)', rows: [
    { tid: '2026_PWD_884412_1', title: 'Widening & strengthening of Panvel–Uran road', left: '2d 4h' },
    { tid: '2026_ZP_640021_7', title: 'Supply and installation of solar street lights (312 nos)', left: '2d 19h' },
  ]},
  { band: 'Soon', color: 'var(--warn)', rows: [
    { tid: '2026_MJP_559830_2', title: 'O&M of water treatment plant 24 MLD for 3 years', left: '6d' },
  ]},
];

const TENDER_COLS = ['Sr. No.', 'Bookmark', 'Tender ID / Work Desc', 'Title', 'Value', 'EMD', 'Org Chain', 'Closing Date', 'Time Left', 'Actions'];
const TENDER_ROWS = [
  { sr: 1, tid: '2026_PWD_884412_1', title: 'Widening & strengthening of Panvel–Uran road', value: 42500000, emd: 425000, org: 'PWD Maharashtra › Beed', closing: '18 Sep 2026', left: '2d 4h', bm: true },
  { sr: 2, tid: '2026_NHAI_771290_3', title: 'Periodic renewal & strengthening of NH-548 km 12–30', value: 128000000, emd: 1280000, org: 'NHAI › RO Mumbai', closing: '02 Oct 2026', left: '16d', bm: false },
  { sr: 3, tid: '2026_MJP_559830_2', title: 'O&M of water treatment plant 24 MLD for 3 years', value: 61000000, emd: 610000, org: 'MJP › Nashik', closing: '20 Sep 2026', left: '6d', bm: true },
];

const PROJECT_COLS = ['#', 'Tender ID', 'Name of Work', 'Client', 'Value', 'Deadline', 'Time Left', 'Status'];
const PROJECT_ROWS = [
  { sr: 1, tid: '2026_PWD_884412_1', title: 'RCC box culvert SH-27 Beed', client: 'PWD Maharashtra', value: 42500000, deadline: '14 Sep 2026', left: '4d', status: 'Active' },
  { sr: 2, tid: '2026_MJP_559830_2', title: 'WTP O&M 24 MLD Nashik', client: 'MJP Nashik', value: 61000000, deadline: '20 Sep 2026', left: '10d', status: 'Active' },
];

/* ═══════════════════════════════════════════════════════════════════════════
   2.  SHELL  —  header + sidebar  (button placement mirrors src/App.jsx)
   ═══════════════════════════════════════════════════════════════════════════ */
function Header({ theme, onTheme }) {
  return (
    <header style={{ height: 44, display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', flexShrink: 0, position: 'relative', zIndex: 30 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>Tender &amp; Bid Manager</span>
      <div style={{ flex: 1 }} />
      <span className="ios-badge ios-badge-success" style={{ marginRight: 8 }}><Wifi size={10} /> Synced 4 min ago</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button className="ios-btn ios-btn-ghost" style={{ minHeight: 0, padding: 7, position: 'relative' }} title="Downloads">
          <Download size={16} />
        </button>
        <button className="ios-btn ios-btn-ghost" style={{ minHeight: 0, padding: 7, position: 'relative' }} title="Notifications">
          <Bell size={16} />
          <span style={{ position: 'absolute', top: -1, right: -1, minWidth: 15, height: 15, background: 'var(--danger)', color: '#fff', fontSize: 9, fontWeight: 700, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>2</span>
        </button>
        <button className="ios-btn ios-btn-ghost" style={{ minHeight: 0, padding: 7 }} onClick={onTheme} title="Toggle theme">
          {theme === 'ios-dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}

const MAIN_NAV = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['tenders', 'Online Tenders', Globe],
  ['organizations', 'Organizations', Building2],
  ['bookmarks', 'Bookmarks', Star],
  ['projects', 'Projects', FolderOpen],
  ['templates', 'Templates', FileText],
];
const BOTTOM_NAV = [
  ['archived_projects', 'Archived Projects', FolderOpen],
  ['files', 'Files', Server],
  ['settings', 'Settings', Settings],
];

function Sidebar({ page, onNav, collapsed, onToggle }) {
  const Item = ([key, label, Icon]) => (
    <button key={key} className={cn('ios-nav', page === key && 'on')} onClick={() => onNav(key)} title={collapsed ? label : undefined}>
      <Icon size={18} style={{ flexShrink: 0 }} />
      {!collapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>}
    </button>
  );
  return (
    <div style={{ width: collapsed ? 56 : 210, borderRight: '1px solid var(--border)', background: 'var(--surface-0)', display: 'flex', flexDirection: 'column', flexShrink: 0, transition: 'width .2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 44, borderBottom: '1px solid var(--border)' }}>
        {!collapsed && <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--accent)' }}>BID MANAGER</span>}
        <button onClick={onToggle} style={{ marginLeft: collapsed ? 'auto' : 0, marginRight: collapsed ? 'auto' : 0, padding: 4, borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 6px', overflow: 'hidden' }}>
        {MAIN_NAV.map(Item)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 6px 8px' }}>
        {BOTTOM_NAV.map(Item)}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   3.  SCREENS  —  same layout & button placement as src/App.jsx, re-skinned
   ═══════════════════════════════════════════════════════════════════════════ */
function SectionHead({ title, subtitle, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Dashboard() {
  return (
    <div className="ios-scroll" style={{ padding: 24, overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHead title="Dashboard" subtitle="Overview of your tender pipeline">
        {/* button placement: Sync Now — top right (unchanged) */}
        <button className="ios-btn ios-btn-secondary"><RefreshCw size={14} /> Sync Now</button>
      </SectionHead>

      {/* Needs attention */}
      <div className="ios-card" style={{ padding: 16, borderColor: 'rgba(217,119,6,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <AlertTriangle size={16} style={{ color: 'var(--warn)' }} />
          <h3 style={{ fontSize: 13, fontWeight: 700 }}>Needs attention</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            'Bookmarked tender "Panvel–Uran road" closes in 2d and has no project yet',
            'Tender data last synced 4 minutes ago',
          ].map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--surface-1)', borderRadius: 11 }}>
              <span style={{ flex: 1, fontSize: 13 }}>{t}</span>
              <button className="ios-btn ios-btn-secondary ios-btn-sm">{i === 0 ? 'Review' : 'Sync now'}</button>
            </div>
          ))}
        </div>
      </div>

      {/* Stat cards — 5 across (unchanged) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16 }}>
        {STATS.map((s) => (
          <button key={s.label} className="ios-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-0)' }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <s.icon size={20} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <p style={{ fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="ios-dot" style={{ background: s.dot }} />{s.value}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Pipeline + Website Coverage | Upcoming Deadlines */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ios-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <IndianRupee size={13} style={{ color: 'var(--accent)' }} />
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>Pipeline Value</h3>
            </div>
            <p style={{ fontSize: 22, fontWeight: 700 }}>{fmtCr(1524000000)}</p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>across selected tenders</p>
          </div>
          <div className="ios-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Activity size={15} style={{ color: 'var(--accent)' }} />
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>Website Coverage</h3>
            </div>
            <p style={{ borderRadius: 11, background: 'var(--surface-1)', padding: '16px 12px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              No website data yet. Sync to load tender data.
            </p>
          </div>
        </div>

        <div className="ios-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Calendar size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontSize: 13, fontWeight: 700 }}>Upcoming Deadlines</h3>
          </div>
          {DEADLINES.map((g) => (
            <div key={g.band} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: g.color, marginBottom: 6 }}>{g.band}</p>
              {g.rows.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
                  <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: g.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{d.tid}</p>
                    <p style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</p>
                  </div>
                  <span className="ios-badge ios-badge-warning">{d.left}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Bookmarked | Bids under preparation */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[
          { icon: Bookmark, color: 'var(--warn)', title: 'Bookmarked Tenders', badge: 'ios-badge-warning', n: 4, empty: 'No bookmarked tenders' },
          { icon: FolderCog, color: 'var(--ok)', title: 'Bids Under Preparation', badge: 'ios-badge-success', n: 6, empty: 'No bids under preparation' },
        ].map((c) => (
          <div key={c.title} className="ios-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <c.icon size={16} style={{ color: c.color }} />
                <h3 style={{ fontSize: 13, fontWeight: 700 }}>{c.title}</h3>
              </div>
              <span className={cn('ios-badge', c.badge)}>{c.n}</span>
            </div>
            <p style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>{c.empty}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListToolbar({ title, count, right, children }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h1>
          {count != null && <span className="ios-badge ios-badge-muted" style={{ fontSize: 12 }}>{count}</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function SearchBox({ placeholder }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 180, maxWidth: 340 }}>
      <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--text-muted)' }} />
      <input className="ios-input" style={{ paddingLeft: 32 }} placeholder={placeholder} />
    </div>
  );
}

function Tenders() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ListToolbar
        title="Online Tenders"
        count={148}
        right={<button className="ios-btn ios-btn-secondary"><RefreshCw size={14} /> Sync Now</button>}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <SearchBox placeholder="Search..." />
          <select className="ios-input" style={{ width: 'auto', maxWidth: 190, height: 32 }}><option>All websites</option></select>
          <button className="ios-btn ios-btn-ghost ios-btn-sm"><Star size={13} /> Bookmarked</button>
          <button className="ios-btn ios-btn-ghost ios-btn-sm"><Clock size={13} /> Closing ≤7d</button>
          <button className="ios-btn ios-btn-ghost ios-btn-sm"><Filter size={13} /> Filters</button>
          <div style={{ flex: 1 }} />
          <button className="ios-btn ios-btn-ghost ios-btn-sm"><SlidersHorizontal size={13} /> Columns</button>
          <button className="ios-btn ios-btn-ghost ios-btn-sm"><FileDown size={13} /> Export CSV</button>
        </div>
        <div style={{ display: 'flex', gap: 4, borderTop: '1px solid var(--border)', margin: '2px -24px -16px', padding: '0 24px' }}>
          {['Active Tenders', 'Archived'].map((t, i) => (
            <button key={t} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderBottom: `2px solid ${i === 0 ? 'var(--accent)' : 'transparent'}`, background: 'transparent', color: i === 0 ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer' }}>{t}</button>
          ))}
        </div>
      </ListToolbar>

      <div className="ios-scroll" style={{ flex: 1, overflow: 'auto' }}>
        <table className="ios-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            <tr>{TENDER_COLS.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {TENDER_ROWS.map((r) => (
              <tr key={r.sr} style={{ cursor: 'pointer' }}>
                <td style={{ color: 'var(--text-muted)' }}>{r.sr}</td>
                <td><Star size={14} fill={r.bm ? 'var(--star)' : 'none'} color={r.bm ? 'var(--star)' : 'var(--text-muted)'} /></td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.tid}</td>
                <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</td>
                <td className="mono">{fmtCr(r.value)}</td>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>{fmtCr(r.emd)}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.org}</td>
                <td style={{ fontSize: 12 }}>{r.closing}</td>
                <td><span className="ios-badge ios-badge-warning">{r.left}</span></td>
                <td>
                  <button className="ios-btn ios-btn-ghost" style={{ minHeight: 0, padding: 5 }}><Plus size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ padding: '10px 24px', fontSize: 11.5, color: 'var(--text-muted)' }}>Showing 3 of 148</p>
      </div>
    </div>
  );
}

function Organizations() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ListToolbar title="Organizations" count={0} right={<button className="ios-btn ios-btn-secondary"><RefreshCw size={14} /> Sync Now</button>}>
        <div style={{ display: 'flex', gap: 12 }}><SearchBox placeholder="Search organizations…" /></div>
      </ListToolbar>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <Building2 size={28} style={{ opacity: .5 }} />
          <p style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No organizations</p>
          <p style={{ fontSize: 12, marginTop: 2 }}>Sync to load organization data.</p>
        </div>
      </div>
    </div>
  );
}

function Bookmarks() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ListToolbar title="Bookmarks" count={4}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['Tenders', 'Organizations'].map((t, i) => (
            <button key={t} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderBottom: `2px solid ${i === 0 ? 'var(--accent)' : 'transparent'}`, background: 'transparent', color: i === 0 ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer' }}>{t}</button>
          ))}
        </div>
      </ListToolbar>
      <div className="ios-scroll" style={{ flex: 1, overflow: 'auto', padding: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
        {TENDER_ROWS.filter((r) => r.bm).map((r) => (
          <div key={r.sr} className="ios-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.tid}</p>
            <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{r.title}</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.org}</span>
              <span className="ios-badge ios-badge-warning">{r.left}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Projects({ archived }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700 }}>{archived ? 'Archived Projects' : 'Projects'}</h1>
            <span className="ios-badge ios-badge-muted" style={{ fontSize: 12 }}>{archived ? 21 : 2}</span>
          </div>
          {/* button placement: Open Folder + Restore Folders — top right (unchanged) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="ios-btn ios-btn-ghost ios-btn-sm"><FolderOpen size={13} /> Open Folder</button>
            {!archived && <button className="ios-btn ios-btn-ghost ios-btn-sm"><ArchiveRestore size={13} /> Restore Folders</button>}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <SearchBox placeholder={archived ? 'Search archived…' : 'Search projects…'} />
          <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div className="ios-seg">
            {[['table', List, 'Table'], ['cards', LayoutGrid, 'Cards']].map(([k, Icon, label], i) => (
              <button key={k} className={cn('ios-seg-item', i === 0 && 'on')}><Icon size={13} /> {label}</button>
            ))}
          </div>
          <button className="ios-btn ios-btn-ghost ios-btn-sm"><SlidersHorizontal size={13} /> Columns</button>
        </div>
      </div>
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total <b style={{ color: 'var(--text)' }}>{archived ? 21 : 2}</b></span>
        <span style={{ width: 1, height: 12, background: 'var(--border)' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}><span className="ios-dot" style={{ background: 'var(--ok)' }} /> Active <b style={{ color: 'var(--ok)' }}>{archived ? 0 : 2}</b></span>
        <span style={{ width: 1, height: 12, background: 'var(--border)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Portfolio <b className="mono" style={{ color: 'var(--text)' }}>{fmtCr(103500000)}</b></span>
      </div>
      <div className="ios-scroll" style={{ flex: 1, overflow: 'auto' }}>
        <table className="ios-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}><tr>{PROJECT_COLS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {(archived ? [] : PROJECT_ROWS).map((r) => (
              <tr key={r.sr} style={{ cursor: 'pointer' }}>
                <td style={{ color: 'var(--text-muted)' }}>{r.sr}</td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.tid}</td>
                <td style={{ fontWeight: 500 }}>{r.title}</td>
                <td style={{ color: 'var(--text-muted)' }}>{r.client}</td>
                <td className="mono">{fmtCr(r.value)}</td>
                <td style={{ fontSize: 12 }}>{r.deadline}</td>
                <td><span className="ios-badge ios-badge-warning">{r.left}</span></td>
                <td><span className="ios-badge ios-badge-success">{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {archived && <p style={{ padding: 40, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>No archived projects</p>}
      </div>
    </div>
  );
}

function Templates() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>Checklist Templates</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Manage document checklists for bid submissions</p>
          </div>
          {/* button placement: New Template — top right (unchanged) */}
          <button className="ios-btn ios-btn-primary"><Plus size={14} /> New Template</button>
        </div>
        <div style={{ marginTop: 12, position: 'relative', maxWidth: 340 }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--text-muted)' }} />
          <input className="ios-input" style={{ paddingLeft: 32 }} placeholder="Search templates..." />
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <FileText size={28} style={{ opacity: .5 }} />
          <p style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No templates yet</p>
          <p style={{ fontSize: 12, marginTop: 2 }}>Create your first checklist template.</p>
        </div>
      </div>
    </div>
  );
}

function Files() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', padding: '16px 24px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>Files</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Browse project storage</p>
        {/* button placement: Parent · Refresh · Delete Folder · Columns (unchanged order) */}
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <button className="ios-btn ios-btn-ghost ios-btn-sm" disabled><ArrowUp size={12} /> Parent</button>
          <button className="ios-btn ios-btn-ghost ios-btn-sm"><RefreshCw size={12} /> Refresh</button>
          <button className="ios-btn ios-btn-danger ios-btn-sm" disabled><Trash2 size={12} /> Delete Folder</button>
          <div style={{ marginLeft: 8 }}><button className="ios-btn ios-btn-ghost ios-btn-sm"><Columns3 size={12} /> Columns</button></div>
        </div>
      </div>
      <div className="ios-scroll" style={{ flex: 1, overflow: 'auto' }}>
        <table className="ios-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}><tr>{['Name', 'Type', 'Size', 'Modified'].map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>This folder is empty</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SETTINGS_TABS = ['Appearance', 'Workspace', 'Directories', 'Connection & Sync', 'Data & Cache'];

function SettingsScreen({ theme, onTheme }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }} className="ios-scroll">
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-0)', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>Settings</h1>
          {/* button placement: connection badge — top right (unchanged) */}
          <span className="ios-badge ios-badge-success"><Wifi size={10} /> Connected v2.4.0</span>
        </div>
      </div>
      <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '190px 1fr', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SETTINGS_TABS.map((t, i) => (
            <button key={t} className={cn('ios-nav', i === 0 && 'on')} style={{ fontSize: 13 }}>{t}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 620 }}>
          <div className="ios-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700 }}>Appearance</h3>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: 13 }}>Theme</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Light / Dark mode</p>
              </div>
              <button className="ios-btn ios-btn-secondary" onClick={onTheme}>
                {theme === 'ios-dark' ? <Sun size={14} /> : <Moon size={14} />} {theme === 'ios-dark' ? 'Dark' : 'Light'}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: 13 }}>Density</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Table row height</p>
              </div>
              <div className="ios-seg">
                {['Comfortable', 'Compact'].map((d, i) => <button key={d} className={cn('ios-seg-item', i === 0 && 'on')}>{d}</button>)}
              </div>
            </div>
          </div>
          <div className="ios-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700 }}>Connection &amp; Sync</h3>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Server URL</label>
              <input className="ios-input" defaultValue="https://api.bidmanager.example" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="ios-btn ios-btn-primary"><RefreshCw size={14} /> Sync Tenders</button>
              <button className="ios-btn ios-btn-secondary">Test connection</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   4.  PREVIEW SHELL
   ═══════════════════════════════════════════════════════════════════════════ */
export default function IosThemePreview() {
  const [theme, setTheme] = useState('ios-light');
  const [page, setPage] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const toggleTheme = () => setTheme((t) => (t === 'ios-light' ? 'ios-dark' : 'ios-light'));

  const screens = {
    dashboard: <Dashboard />,
    tenders: <Tenders />,
    organizations: <Organizations />,
    bookmarks: <Bookmarks />,
    projects: <Projects />,
    archived_projects: <Projects archived />,
    templates: <Templates />,
    files: <Files />,
    settings: <SettingsScreen theme={theme} onTheme={toggleTheme} />,
  };

  return (
    <>
      <style>{IOS_CSS}</style>
      <div className={cn('ios', theme)}>
        {/* preview control strip — not part of the app */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 16px', background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', fontSize: 12, flexShrink: 0 }}>
          <span style={{ fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-muted)' }}>iOS THEME PREVIEW</span>
          <span style={{ color: 'var(--text-muted)' }}>· empty shell, not wired · layout &amp; button placement unchanged</span>
          <div style={{ flex: 1 }} />
          <button className="ios-btn ios-btn-ghost ios-btn-sm" onClick={toggleTheme}>
            {theme === 'ios-dark' ? <Sun size={13} /> : <Moon size={13} />} {theme === 'ios-dark' ? 'Light' : 'Dark'}
          </button>
        </div>

        <Header theme={theme} onTheme={toggleTheme} />

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Sidebar page={page} onNav={setPage} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
          <main style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)' }}>
            {screens[page]}
          </main>
        </div>
      </div>
    </>
  );
}
