import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Server, Sliders, Layers, Folder, Terminal, Database, Activity, Clock, HardDrive,
  Globe, Key, Search, X, Check, AlertTriangle, RefreshCw, Play, Pause, Trash2,
  Download, Upload, Plus, RotateCcw, Loader2, ChevronRight, ChevronDown, ArrowLeft,
  Copy, ExternalLink, Filter, ShieldCheck, Zap, FileText,
  Eye, Bell, SkipForward, Timer, Send, Users, Ban
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   BidManager Control — operator console for the Cloud Run backend.

   Wired to a real backend via `createApi(base, adminKey)` below — every method
   still matches the endpoint noted in its original // WIRE: comment.
   ──────────────────────────────────────────────────────────────────────────── */

const c = {
  paper: '#E9EDF1', card: '#FFFFFF', rule: '#C6D0DA', ruleSoft: '#DFE6EC',
  ink: '#15202A', ink60: '#5A6874', ink40: '#8794A0',
  indigo: '#23408E', indigoSoft: '#E4E9F6',
  stamp: '#B23227', stampSoft: '#F7E4E1',
  seal: '#1C7355', sealSoft: '#E0F0EA',
  amber: '#8A5A0E', amberSoft: '#F6EAD5',
  console: '#111A22', consoleRule: '#233240', consoleInk: '#C4D2DE',
};

const mono = "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace";
const sans = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";
const cond = "'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif";

/* ═══════════════════════════ MOCK API ═══════════════════════════════════════
   Replace each method body with a real fetch. Signatures should stay stable
   so no component needs to change during wiring.
   ═════════════════════════════════════════════════════════════════════════ */

// OCI Ampere VM (migrated off Google Cloud Run 2026-08-28). Matches BIDMANAGER_DOMAIN
// in deploy/oci/.env. IP-pinned sslip.io hostname until a real domain is put in front.
const PRODUCTION_API_BASE = 'https://161.118.170.233.sslip.io';
const LEGACY_PRODUCTION_API_BASE = 'https://bidmanager-api-3xk2.a.run.app';
const LEGACY_PRODUCTION_API_BASES = [
  LEGACY_PRODUCTION_API_BASE,
  'https://bidmanager-server-426342323597.asia-south1.run.app',
  'https://bidmanager-backend-zz2boi3jzq-el.a.run.app',
  // Retired Google Cloud Run production URLs — kept here so saved operator profiles
  // auto-repoint to PRODUCTION_API_BASE (see the migration at ~line 2433).
  'https://bidmanager-backend-426342323597.asia-south1.run.app',
];
const PRODUCTION_STORAGE_ROOT = 'gdrive://1h3dDknN6sVsv-T-6e3kFqnEc2Sooa9sS';
const DESKTOP_LOCAL_API_BASE = typeof window !== 'undefined'
  ? String(window.bidmanagerDesktop?.localApiBase || '').replace(/\/+$/, '')
  : '';
const LOCAL_API_BASE = DESKTOP_LOCAL_API_BASE || 'http://127.0.0.1:8090';

const ENVS = {
  prod:    { label: 'Production', base: PRODUCTION_API_BASE, region: 'asia-south1', desc: 'The live Cloud Run service — real client apps hit this.' },
  staging: { label: 'Staging',    base: 'https://bidmanager-api-stg.a.run.app',  region: 'asia-south1', desc: 'A separate Cloud Run service for testing changes before they reach production.' },
  local:   { label: 'Local',      base: 'http://127.0.0.1:8090',                 region: 'localhost',   desc: 'A FastAPI server running on this machine — for development.' },
};
ENVS.local.base = LOCAL_API_BASE;

const DEFAULT_CONFIG = {
  schedule_enabled: true,
  scrape_interval_minutes: 180,
  portal_mahatenders: true,
  portal_etenders: true,
  portal_eprocure: false,
  max_concurrent_sessions: 2,
  page_load_timeout_s: 45,
  retry_attempts: 3,
  retry_backoff_s: 20,
  headless: true,
  rotate_user_agent: true,
  proxy_pool: 'residential',
  captcha_ai_provider: 'manual',
  captcha_ai_model: '',
  captcha_ai_api_key: '',
  captcha_ai_api_key_set: false,
  captcha_ai_endpoint: '',
  captcha_max_attempts: 4,
  captcha_confidence_min: 0.72,
  captcha_manual_fallback: true,
  captcha_handover_after_attempts: 2,
  captcha_manual_wait_s: 180,
  captcha_alert_channel: 'desktop',
  captcha_on_no_answer: 'requeue',
  auto_download_documents: true,
  max_file_size_mb: 80,
  allowed_extensions: 'pdf, zip, rar, xls, xlsx, doc, docx',
  gcs_bucket: '',
  storage_prefix: 'tenders/',
  signed_url_ttl_min: 15,
  dedupe_by_tender_id: true,
  job_ttl_minutes: 45,
  max_queue_depth: 25,
  poll_interval_ms: 1200,
  read_only_mode: false,
  require_admin_key: true,
  archive_daily_enabled: true,
  archive_daily_hour: 20,
  scheduler_downtime_from: '',
  scheduler_downtime_to: '',
};

const LOG_SOURCES = ['api', 'scraper', 'worker', 'storage', 'db'];
const LOG_FILTERS_KEY = 'bidmanager.admin.log-filters.v1';
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

function loadLogFilters() {
  const defaults = { levels: ['info', 'warn', 'error'], source: 'all', q: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_FILTERS_KEY) || 'null');
    if (!saved || !Array.isArray(saved.levels)) return defaults;
    return {
      levels: saved.levels.filter((level) => LOG_LEVELS.includes(level)),
      source: saved.source === 'all' || LOG_SOURCES.includes(saved.source) ? saved.source : 'all',
      q: typeof saved.q === 'string' ? saved.q : '',
    };
  } catch {
    return defaults;
  }
}
/* ─────────────────────────── REAL API ────────────────────────────────────
   Fetch wrapper + per-connection API client. Every method below keeps the
   same name/argument shape the panels already call — only the body changed
   from a mock delay to a real request against the admin backend.
   ───────────────────────────────────────────────────────────────────────── */

async function apiFetch(base, path, { method = 'GET', adminKey, body } = {}) {
  const url = `${String(base || '').replace(/\/+$/, '')}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(adminKey ? { 'x-admin-key': adminKey } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Request timed out: ${path}`);
    throw new Error(`Could not reach backend: ${err?.message || err}`);
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) {
    const message = (data && (data.detail || data.message)) || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data;
}

function createApi(base, adminKey) {
  return {
    // WIRE: GET /admin/captchas/pending (polling — the backend tracks a single
    // pending captcha at a time, so this always returns 0 or 1 items)
    async captchaQueue() {
      const raw = await apiFetch(base, '/admin/captchas/pending', { adminKey });
      return (raw.captchas || []).filter(Boolean).map((cap) => ({
        id: cap.id,
        jobId: cap.jobId || '—',
        tenderId: cap.tenderId || '—',
        portal: cap.portal || '—',
        image: cap.image,
        // The backend doesn't track per-captcha AI attempt history on this
        // endpoint — shown as zero/placeholder rather than invented.
        aiAttempts: 0,
        aiGuess: '—',
        aiConfidence: 0,
        reason: cap.reason || 'Manual captcha required',
        receivedAt: cap.receivedAt,
        expiresAt: cap.expiresAt,
      }));
    },
    // WIRE: POST /admin/captchas/{id}/answer  { answer }
    async answerCaptcha(id, answer) {
      return apiFetch(base, `/admin/captchas/${encodeURIComponent(id)}/answer`, {
        method: 'POST', adminKey, body: { answer },
      });
    },
    // WIRE: POST /admin/captchas/{id}/refresh — known limitation: there's no
    // hook into the paused scraper session to trigger a real portal reload,
    // so the backend re-serves the same cached image.
    async refreshCaptcha(id) {
      return apiFetch(base, `/admin/captchas/${encodeURIComponent(id)}/refresh`, {
        method: 'POST', adminKey,
      });
    },
    // WIRE: POST /admin/captchas/{id}/skip  { action: 'requeue' | 'abandon' }
    async skipCaptcha(id, action) {
      return apiFetch(base, `/admin/captchas/${encodeURIComponent(id)}/skip`, {
        method: 'POST', adminKey, body: { action },
      });
    },
    // WIRE: GET /admin/captchas/stats
    async captchaStats() {
      const raw = await apiFetch(base, '/admin/captchas/stats', { adminKey });
      // The backend doesn't keep a rolling solve-rate ledger — surfaced as
      // zero rather than fabricated history.
      return {
        autoSolved: 0,
        handedOver: raw.pending ?? 0,
        solvedByYou: 0,
        timedOut: 0,
        avgResponseS: 0,
        autoRate: 0,
      };
    },

    // WIRE: GET /admin/health
    async health() {
      const raw = await apiFetch(base, '/admin/health', { adminKey });
      return {
        status: raw.status || 'unknown',
        revision: raw.revision || '—',
        image: raw.service || '—',
        region: raw.region || '—',
        instances: raw.instances ?? 1,
        minInstances: raw.minInstances ?? 1,
        maxInstances: raw.maxInstances ?? 1,
        // Cloud Run's per-instance CPU/memory allocation isn't exposed
        // through env vars — would need the Cloud Run Admin API + extra IAM.
        cpu: '—',
        memory: '—',
        uptimeSeconds: raw.uptimeSeconds ?? 0,
        lastDeploy: raw.lastDeploy || new Date().toISOString(),
        checks: raw.checks || [],
        providers: raw.providers || null,
        cloudPushConfigured: !!raw.cloudPushConfigured,
      };
    },
    // WIRE: POST /admin/push-to-cloud — pushes all locally-scraped tenders + files
    // (not yet pushed) into the shared Postgres DB and Drive folder.
    async pushToCloud() {
      return apiFetch(base, '/admin/push-to-cloud', { method: 'POST', adminKey });
    },
    // WIRE: GET /admin/metrics
    async metrics() {
      const raw = await apiFetch(base, '/admin/metrics', { adminKey });
      return {
        requests1h: raw.requests1h ?? 0,
        errorRate: raw.errorRate ?? 0,
        p95: raw.p95 ?? 0,
        p99: raw.p99 ?? 0,
        cpuPct: raw.cpuPct ?? 0,
        memPct: raw.memPct ?? 0,
      };
    },
    // WIRE: GET /admin/config   ·   PUT /admin/config
    async getConfig() {
      const raw = await apiFetch(base, '/admin/config', { adminKey });
      return raw.settings;
    },
    async putConfig(next) {
      const raw = await apiFetch(base, '/admin/config', {
        method: 'PUT', adminKey, body: { settings: next },
      });
      return raw.settings;
    },

    // WIRE: GET /admin/jobs
    async jobs() {
      const raw = await apiFetch(base, '/admin/jobs', { adminKey });
      return (raw.jobs || []).map((j) => ({
        id: j.id,
        tenderId: j.tenderId || '',
        portal: j.portal || '',
        kind: j.kind || '',
        status: j.status === 'completed' ? 'done' : j.status,
        progress: j.progress ?? 0,
        startedAt: j.startedAt || null,
        error: j.error || '',
      }));
    },
    // WIRE: POST /admin/jobs/{id}/cancel · POST /admin/jobs/{id}/retry · POST /admin/jobs/purge
    async jobAction(id, kind) {
      if (!id) return apiFetch(base, '/admin/jobs/purge', { method: 'POST', adminKey });
      return apiFetch(base, `/admin/jobs/${encodeURIComponent(id)}/${kind}`, { method: 'POST', adminKey });
    },
    async websites() {
      return apiFetch(base, '/v1/websites', { adminKey });
    },
    async createWebsite(name, url, statusUrl) {
      return apiFetch(base, '/v1/websites', {
        method: 'POST', adminKey, body: { name, url, status_url: statusUrl || '' },
      });
    },
    async startScrape(websiteId, refreshOrganizations = true) {
      return apiFetch(base, '/admin/jobs/scrape', {
        method: 'POST', adminKey,
        body: { website_id: Number(websiteId), refresh_organizations: refreshOrganizations },
      });
    },
    async organizations(websiteId, search = '') {
      const qs = search ? `?search=${encodeURIComponent(search)}` : '';
      return apiFetch(base, `/v1/websites/${Number(websiteId)}/organizations${qs}`, { adminKey });
    },
    async tenders(websiteId, search = '') {
      const params = new URLSearchParams({ archived: 'false', limit: '1000', sort: 'closing_date', order: 'asc' });
      if (search) params.set('search', search);
      return apiFetch(base, `/v1/websites/${Number(websiteId)}/tenders?${params.toString()}`, { adminKey });
    },
    async scrapeOrganizations(websiteId, orgIds, all = false) {
      if (all) {
        return apiFetch(base, `/v1/websites/${Number(websiteId)}/tenders/fetch-all`, {
          method: 'POST', adminKey,
        });
      }
      return apiFetch(base, `/v1/websites/${Number(websiteId)}/tenders/fetch-selected`, {
        method: 'POST', adminKey, body: { org_ids: orgIds, download_after: false },
      });
    },
    async refreshTenders(websiteId, tenderIds) {
      return apiFetch(base, `/v1/websites/${Number(websiteId)}/tenders/refresh-batch`, {
        method: 'POST', adminKey,
        body: { tender_ids: tenderIds },
      });
    },
    async downloadTenders(websiteId, tenderIds, all = false, mode = 'auto') {
      return apiFetch(base, `/v1/websites/${Number(websiteId)}/tenders/download-batch`, {
        method: 'POST', adminKey,
        body: { tender_ids: tenderIds, all_tenders: all, mode },
      });
    },
    async savedCustomJobs(owner) {
      const raw = await apiFetch(base, `/admin/custom-jobs?owner=${encodeURIComponent(owner)}`, { adminKey });
      return raw.jobs || [];
    },
    async saveCustomJob(definition, id = null) {
      return apiFetch(base, id ? `/admin/custom-jobs/${Number(id)}` : '/admin/custom-jobs', {
        method: id ? 'PUT' : 'POST', adminKey, body: definition,
      });
    },
    async runSavedCustomJob(id, owner) {
      return apiFetch(base, `/admin/custom-jobs/${Number(id)}/run?owner=${encodeURIComponent(owner)}`, {
        method: 'POST', adminKey,
      });
    },
    async deleteSavedCustomJob(id, owner) {
      return apiFetch(base, `/admin/custom-jobs/${Number(id)}?owner=${encodeURIComponent(owner)}`, {
        method: 'DELETE', adminKey,
      });
    },

    // WIRE: GET /admin/users — every account that has ever signed in from the client app
    async clientUsers() {
      const raw = await apiFetch(base, '/admin/users', { adminKey });
      return raw.items || [];
    },
    // WIRE: GET /admin/users/{id} — includes recent client_activity_log rows
    async clientUserDetail(id) {
      return apiFetch(base, `/admin/users/${Number(id)}`, { adminKey });
    },
    // WIRE: POST /admin/users/{id}/suspend — revokes all of that user's tokens immediately
    async suspendClientUser(id) {
      return apiFetch(base, `/admin/users/${Number(id)}/suspend`, { method: 'POST', adminKey });
    },
    // WIRE: POST /admin/users/{id}/reactivate
    async reactivateClientUser(id) {
      return apiFetch(base, `/admin/users/${Number(id)}/reactivate`, { method: 'POST', adminKey });
    },

    // WIRE: GET /admin/storage?prefix=
    async storage(prefix) {
      const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
      const raw = await apiFetch(base, `/admin/storage${qs}`, { adminKey });
      return {
        folders: (raw.folders || []).map((f) => ({ name: f.name, items: f.items, size: f.sizeBytes })),
        files: (raw.files || []).map((f) => ({ name: f.name, size: f.sizeBytes, modified: f.modified })),
      };
    },
    // WIRE: GET /admin/storage/usage
    async storageUsage() {
      const raw = await apiFetch(base, '/admin/storage/usage', { adminKey });
      return {
        used: raw.usedBytes ?? 0,
        quota: raw.quotaBytes ?? null,
        objects: raw.objects ?? 0,
        lifecycleDays: null,
        provider: raw.provider || '',
        label: raw.label || '',
        root: raw.root || '',
      };
    },
    // WIRE: DELETE /admin/storage · POST /admin/storage/folder · POST /admin/storage/signed-url
    async storageAction(action, payload = {}) {
      if (action === 'folder') {
        return apiFetch(base, '/admin/storage/folder', { method: 'POST', adminKey, body: payload });
      }
      if (action === 'delete') {
        return apiFetch(base, '/admin/storage', { method: 'DELETE', adminKey, body: payload });
      }
      if (action === 'signed-url') {
        return apiFetch(base, '/admin/storage/signed-url', { method: 'POST', adminKey, body: payload });
      }
      throw new Error(`Unknown storage action: ${action}`);
    },

    // WIRE: GET /admin/db/stats
    async dbStats() {
      const raw = await apiFetch(base, '/admin/db/stats', { adminKey });
      return {
        engine: raw.engine === 'postgres' ? 'PostgreSQL' : 'SQLite',
        host: raw.host || '—',
        sizeBytes: raw.sizeBytes ?? 0,
        // This codebase opens a connection per request rather than keeping a
        // pool, so there's no real pool to report — shown as zero, not faked.
        pool: { active: 0, idle: 0, max: 0 },
        migration: '—',
        tables: (raw.tables || []).map((t) => ({ name: t.name, rows: t.rows, size: t.sizeBytes })),
        backups: (raw.backups || []).map((b) => ({ id: b.id, at: b.at, size: b.sizeBytes, kind: b.kind })),
      };
    },
    // WIRE: POST /admin/db/backup · POST /admin/db/vacuum
    async dbAction(kind) {
      if (kind === 'backup') return apiFetch(base, '/admin/db/backup', { method: 'POST', adminKey });
      if (kind === 'vacuum') return apiFetch(base, '/admin/db/vacuum', { method: 'POST', adminKey });
      throw new Error(`Unknown db action: ${kind}`);
    },

    // WIRE: POST /admin/server/{restart|drain|pause-scheduler}
    async serverAction(kind) {
      return apiFetch(base, `/admin/server/${kind}`, { method: 'POST', adminKey });
    },
  };
}

/* ═══════════════════════════ PRIMITIVES ═════════════════════════════════ */

const fmtBytes = (n) => {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
};
const fmtDur = (ms) => {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};
const fmtTime = (d) =>
  d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
const toDateTimeLocal = (epochSeconds = (Date.now() / 1000) + 3600) => {
  const date = new Date(Number(epochSeconds) * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

function Mono({ children, style, className = '' }) {
  return <span className={className} style={{ fontFamily: mono, ...style }}>{children}</span>;
}

/* The signature device: a ruled register line with a dot leader.
   Used only for read-only vitals — never for editable fields. */
function RegisterRow({ label, value, tone }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.09em', color: c.ink60, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span className="flex-1 self-end mb-1" style={{ borderBottom: `1px dotted ${c.rule}` }} />
      <span style={{ fontFamily: mono, fontSize: 12.5, color: tone || c.ink, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

function Panel({ code, title, note, right, children }) {
  return (
    <section className="mb-6">
      <header className="flex items-end justify-between gap-4 pb-2 mb-3" style={{ borderBottom: `1px solid ${c.rule}` }}>
        <div className="flex items-baseline gap-3 min-w-0">
          <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.16em', color: c.indigo, border: `1px solid ${c.rule}`, padding: '2px 6px', background: c.card }}>
            {code}
          </span>
          <h2 style={{ fontFamily: cond, fontWeight: 700, fontSize: 21, letterSpacing: '-0.005em', color: c.ink }}>{title}</h2>
          {note && <span className="hidden sm:inline truncate" style={{ fontSize: 12.5, color: c.ink60 }}>{note}</span>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function Card({ children, pad = true, style }) {
  return (
    <div style={{ background: c.card, border: `1px solid ${c.rule}`, ...style }} className={pad ? 'p-3.5' : ''}>
      {children}
    </div>
  );
}

/* Compact ledger totals row — replaces a grid of separate stat cards with one
   ruled strip divided by hairlines, matching the register-row idiom used
   elsewhere instead of boxy dashboard tiles. */
function StatStrip({ items, note }) {
  return (
    <Card pad={false} style={{ marginBottom: 10 }}>
      <div className="flex flex-wrap items-stretch">
        {items.map(([label, value, color], i) => (
          <div key={label} className="flex-1 px-4 py-2" style={{ minWidth: 110, borderLeft: i > 0 ? `1px solid ${c.ruleSoft}` : 'none' }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.ink60 }}>{label}</div>
            <div style={{ fontFamily: mono, fontSize: 23, color, lineHeight: 1.25, marginTop: 2 }}>{value}</div>
          </div>
        ))}
        {note && (
          <div className="flex items-center px-4 py-2 ml-auto" style={{ borderLeft: `1px solid ${c.ruleSoft}` }}>
            <span style={{ fontSize: 11, color: c.ink40, whiteSpace: 'nowrap' }}>{note}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function SubHead({ children }) {
  return (
    <div style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: c.ink60 }} className="mb-3">
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = 'default', icon: Icon, disabled, busy, size = 'md', style }) {
  const v = {
    default: { bg: c.card, fg: c.ink, bd: c.rule },
    primary: { bg: c.indigo, fg: '#fff', bd: c.indigo },
    success: { bg: c.seal, fg: '#fff', bd: c.seal },
    danger:  { bg: c.card, fg: c.stamp, bd: '#E3B7B1' },
    ghost:   { bg: 'transparent', fg: c.ink60, bd: 'transparent' },
  }[variant];
  const p = size === 'sm' ? '4px 8px' : '7px 12px';
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center justify-center gap-1.5 transition-opacity disabled:opacity-45"
      style={{
        background: v.bg, color: v.fg, border: `1px solid ${v.bd}`, padding: p,
        fontFamily: sans, fontSize: size === 'sm' ? 11.5 : 12.5, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : Icon ? <Icon size={13} /> : null}
      {children}
    </button>
  );
}

function Pill({ state, children }) {
  const t = {
    ok:      { bg: c.sealSoft,  fg: c.seal,   bd: '#B7DCCC' },
    warn:    { bg: c.amberSoft, fg: c.amber,  bd: '#E4CFA4' },
    error:   { bg: c.stampSoft, fg: c.stamp,  bd: '#E3B7B1' },
    neutral: { bg: c.paper,     fg: c.ink60,  bd: c.rule },
    info:    { bg: c.indigoSoft,fg: c.indigo, bd: '#B9C6E6' },
  }[state] || { bg: c.paper, fg: c.ink60, bd: c.rule };
  return (
    <span style={{
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, fontFamily: mono,
      fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '2px 7px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex" style={{ border: `1px solid ${c.rule}` }}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} onClick={() => onChange(o.value)}
            style={{
              fontFamily: mono, fontSize: 11, letterSpacing: '0.04em', padding: '6px 11px',
              background: on ? c.indigo : c.card, color: on ? '#fff' : c.ink60,
              border: 'none', borderLeft: i > 0 ? `1px solid ${on ? c.indigo : c.rule}` : 'none',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="relative shrink-0 transition-colors disabled:opacity-40"
      style={{
        width: 38, height: 20, background: checked ? c.indigo : '#CDD6DE',
        border: `1px solid ${checked ? c.indigo : c.rule}`, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span className="absolute top-0.5 transition-all" style={{ left: checked ? 19 : 2, width: 15, height: 14, background: '#fff' }} />
    </button>
  );
}

/* Editable config field — deliberately NOT dot-leadered, to keep the
   read-only register visually distinct from things you can change. */
function Field({ label, hint, children, dirty }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2" style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5" style={{ fontSize: 13, color: c.ink, fontWeight: 500 }}>
          {label}
          {dirty && <span title="Unsaved" style={{ width: 5, height: 5, borderRadius: 9, background: c.amber, display: 'inline-block' }} />}
        </span>
        {hint && <span className="block mt-0.5" style={{ fontSize: 11.5, color: c.ink40, lineHeight: 1.4 }}>{hint}</span>}
      </span>
      <span className="shrink-0">{children}</span>
    </label>
  );
}

function NumIn({ value, onChange, suffix, w = 88, step = 1, min, max }) {
  return (
    <span className="inline-flex items-stretch" style={{ border: `1px solid ${c.rule}`, background: c.card }}>
      <input
        type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={{ width: w, fontFamily: mono, fontSize: 12.5, padding: '5px 8px', outline: 'none', color: c.ink, background: 'transparent', border: 'none', textAlign: 'right' }}
      />
      {suffix && <span className="flex items-center px-2" style={{ fontFamily: mono, fontSize: 10.5, color: c.ink40, background: c.paper, borderLeft: `1px solid ${c.rule}` }}>{suffix}</span>}
    </span>
  );
}

function TextIn({ value, onChange, w = 240, placeholder, type = 'text' }) {
  return (
    <input
      type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      style={{ width: w, fontFamily: mono, fontSize: 12.5, padding: '5px 8px', outline: 'none', color: c.ink, background: c.card, border: `1px solid ${c.rule}` }}
    />
  );
}

function Select({ value, onChange, options, w = 160 }) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      style={{ width: w, fontFamily: mono, fontSize: 12.5, padding: '5px 8px', color: c.ink, background: c.card, border: `1px solid ${c.rule}`, outline: 'none' }}
    >
      {options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  );
}

function Bar({ pct, tone = c.indigo, h = 4 }) {
  return (
    <div style={{ background: c.paper, height: h, border: `1px solid ${c.ruleSoft}`, width: '100%' }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: tone }} />
    </div>
  );
}

function Empty({ icon: Icon, title, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <Icon size={22} style={{ color: c.ink40 }} />
      <p className="mt-3" style={{ fontSize: 13, color: c.ink60 }}>{title}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ═══════════════════════════ PANELS ═════════════════════════════════════ */

function ServerPanel({ toast, base, adminKey }) {
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  const [h, setH] = useState(null);
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setH(await api.health());   // WIRE: GET /admin/health
      setM(await api.metrics());  // WIRE: GET /admin/metrics
    } catch (err) {
      toast(err.message || 'Could not reach the server');
    }
  }, [api, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(async () => { try { setM(await api.metrics()); } catch {} }, 15000);
    return () => clearInterval(t);
  }, [api]);

  const act = async (kind, label) => {
    setBusy(kind);
    try {
      await api.serverAction(kind); // WIRE: POST /admin/server/{kind}
      toast(label);
    } catch (err) {
      toast(err.message || `${kind} failed`);
    }
    setBusy(null);
    load();
  };

  if (!h) return <Panel code="SRV" title="Server"><Card><Empty icon={Loader2} title="Reading service status…" /></Card></Panel>;

  const stateTone = h.status === 'serving' ? 'ok' : 'error';

  return (
    <Panel
      code="SRV" title="Server" note="Cloud Run service"
      right={<Btn icon={RefreshCw} size="sm" onClick={load}>Refresh</Btn>}
    >
      {/* Vitals register — the ruled ledger line */}
      <Card style={{ marginBottom: 10 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex" style={{ width: 8, height: 8 }}>
              <span className="absolute inline-flex w-full h-full animate-ping" style={{ background: c.seal, opacity: 0.5, borderRadius: 9 }} />
              <span className="relative inline-flex" style={{ width: 8, height: 8, background: c.seal, borderRadius: 9 }} />
            </span>
            <span style={{ fontFamily: cond, fontWeight: 700, fontSize: 17, color: c.ink }}>Serving traffic</span>
            <Pill state={stateTone}>{h.status}</Pill>
          </div>
          <Mono style={{ fontSize: 11.5, color: c.ink60 }}>up {fmtDur(h.uptimeSeconds * 1000)}</Mono>
        </div>

        <div className="grid gap-x-10 md:grid-cols-2">
          <div>
            <RegisterRow label="Revision" value={h.revision} />
            <RegisterRow label="Image" value={h.image.split('/').pop()} />
            <RegisterRow label="Region" value={h.region} />
            <RegisterRow label="Last deploy" value={new Date(h.lastDeploy).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} />
          </div>
          <div>
            <RegisterRow label="Instances" value={`${h.instances} active · min ${h.minInstances} / max ${h.maxInstances}`} />
            <RegisterRow label="Allocation" value={`${h.cpu} · ${h.memory}`} />
            <RegisterRow label="Requests 1h" value={m ? m.requests1h.toLocaleString('en-IN') : '—'} />
            <RegisterRow label="Latency" value={m ? `p95 ${m.p95} ms · p99 ${m.p99} ms` : '—'} />
          </div>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <SubHead>Dependency checks</SubHead>
            <div className="grid gap-x-8 sm:grid-cols-2">
              {h.checks.map((k) => (
                <div key={k.name} className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
                  <span className="flex items-center gap-2" style={{ fontSize: 13, color: c.ink }}>
                    {k.state === 'ok' ? <Check size={13} style={{ color: c.seal }} /> : <AlertTriangle size={13} style={{ color: c.amber }} />}
                    {k.name}
                  </span>
                  <Mono style={{ fontSize: 11.5, color: c.ink60 }}>{k.detail}</Mono>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card>
          <SubHead>Resource load</SubHead>
          {m && (
            <div className="space-y-3.5">
              {[['CPU', m.cpuPct], ['Memory', m.memPct], ['Error rate', m.errorRate * 10]].map(([l, v], i) => (
                <div key={l}>
                  <div className="flex justify-between mb-1.5">
                    <span style={{ fontSize: 12, color: c.ink60 }}>{l}</span>
                    <Mono style={{ fontSize: 11.5, color: c.ink }}>{i === 2 ? `${m.errorRate}%` : `${v}%`}</Mono>
                  </div>
                  <Bar pct={v} tone={i === 2 ? (m.errorRate > 2 ? c.stamp : c.seal) : c.indigo} />
                </div>
              ))}
            </div>
          )}
          <div className="mt-5 pt-4 flex flex-wrap gap-2" style={{ borderTop: `1px solid ${c.ruleSoft}` }}>
            <Btn size="sm" icon={RotateCcw} busy={busy === 'restart'} onClick={() => act('restart', 'Service restarted')}>Restart</Btn>
            <Btn size="sm" icon={Pause} busy={busy === 'pause-scheduler'} onClick={() => act('pause-scheduler', 'Scheduler state changed')}>Pause scheduler</Btn>
            <Btn size="sm" variant="danger" icon={Zap} busy={busy === 'drain'} onClick={() => act('drain', 'Sessions drained')}>Drain sessions</Btn>
          </div>
        </Card>
      </div>
    </Panel>
  );
}

function ConfigPanel({ toast, env, base, adminKey, setBase, dbUrl, setDbUrl, storageUrl, setStorageUrl, localScope, setLocalScope }) {
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  // Connection recovery must remain usable even when the configured API is unreachable.
  const [saved, setSaved] = useState(() => ({ ...DEFAULT_CONFIG }));
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_CONFIG }));
  const [configError, setConfigError] = useState('');
  const [saving, setSaving] = useState(false);
  const [urlDraft, setUrlDraft] = useState(base || '');
  const [dbDraft, setDbDraft] = useState(dbUrl || '');
  const [storageDraft, setStorageDraft] = useState(storageUrl || '');
  const [testing, setTesting] = useState(false);
  const [pushingToCloud, setPushingToCloud] = useState(false);

  useEffect(() => {
    setUrlDraft(base || ''); setDbDraft(dbUrl || ''); setStorageDraft(storageUrl || '');
  }, [base, dbUrl, storageUrl, env]);

  useEffect(() => {
    api.getConfig().then((cfg) => {
      const merged = { ...DEFAULT_CONFIG, ...cfg };
      setSaved(merged); setDraft(merged); setConfigError('');
    }) // WIRE: GET /admin/config
      .catch((err) => {
        setConfigError(err.message || 'Could not load configuration');
        toast(err.message || 'Could not load configuration');
      });
  }, [api]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const isDirty = (k) => saved && draft && saved[k] !== draft[k];
  const dirtyKeys = useMemo(
    () => (saved && draft ? Object.keys(draft).filter((k) => saved[k] !== draft[k]) : []),
    [saved, draft]
  );
  const connDirty = urlDraft !== (base || '') || dbDraft !== (dbUrl || '') || storageDraft !== (storageUrl || '');

  const applyConnection = () => {
    setBase(urlDraft.trim()); setDbUrl(dbDraft.trim()); setStorageUrl(storageDraft.trim());
    toast('Connection settings updated');
  };

  const restoreLastWorking = () => {
    let restored = null;
    try {
      const all = JSON.parse(localStorage.getItem(CONNECTION_LAST_GOOD_KEY) || '{}');
      restored = all[env] || null;
    } catch {}
    if (!restored) return toast('No tested connection has been saved for this environment yet');
    const nextApi = String(restored.api || ENVS[env]?.base || '').trim();
    const nextStorage = String(restored.storage || storageDraft || '').trim();
    const nextDb = String(restored.db || dbDraft || '').trim();
    setUrlDraft(nextApi); setStorageDraft(nextStorage); setDbDraft(nextDb);
    setBase(nextApi); setStorageUrl(nextStorage); setDbUrl(nextDb);
    toast('Last tested connection restored');
  };

  // Local-only convenience: swap the three draft fields to a sensible preset without touching what's saved.
  const applyLocalPreset = (scope) => {
    setLocalScope(scope);
    if (scope === 'local') {
      setUrlDraft('http://127.0.0.1:8090');
      setDbDraft('postgresql://127.0.0.1:5432/bidmanager');
      setStorageDraft('~/BidManagerData/files');
    } else {
      setUrlDraft('http://127.0.0.1:8090');
      setDbDraft('postgresql://bm_app@10.42.0.5:5432/bidmanager');
      setStorageDraft(PRODUCTION_STORAGE_ROOT);
    }
  };

  const pushToCloud = async () => {
    setPushingToCloud(true);
    try {
      const job = await api.pushToCloud();
      toast(`Cloud push ${job.job_id || job.id || ''} queued`);
    } catch (err) { toast(err.message || 'Could not queue cloud push'); }
    setPushingToCloud(false);
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      // Calls the typed URL directly, not the active env's saved base.
      await createApi(urlDraft.trim(), adminKey).health(); // WIRE: GET {urlDraft}/admin/health
      let all = {};
      try { all = JSON.parse(localStorage.getItem(CONNECTION_LAST_GOOD_KEY) || '{}'); } catch {}
      all[env] = {
        api: urlDraft.trim(), db: dbDraft.trim(), storage: storageDraft.trim(),
        verifiedAt: new Date().toISOString(),
      };
      localStorage.setItem(CONNECTION_LAST_GOOD_KEY, JSON.stringify(all));
      toast('Reached the server — looks good');
    } catch {
      toast('Could not reach that URL');
    }
    setTesting(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.putConfig(draft); // WIRE: PUT /admin/config
      setSaved(next); setDraft(next);
      toast(`${dirtyKeys.length} setting${dirtyKeys.length === 1 ? '' : 's'} saved`);
    } catch (err) {
      toast(err.message || 'Could not save settings');
    }
    setSaving(false);
  };

  const group = (title, rows) => (
    <Card style={{ marginBottom: 10, breakInside: 'avoid' }}>
      <SubHead>{title}</SubHead>
      <div>{rows}</div>
    </Card>
  );

  return (
    <Panel
      code="CFG" title="Settings" note="Applied live — no redeploy"
      right={
        <div className="flex items-center gap-2">
          {dirtyKeys.length > 0 && <Btn size="sm" variant="ghost" onClick={() => setDraft(saved)}>Discard</Btn>}
          <Btn size="sm" variant="primary" icon={Check} disabled={dirtyKeys.length === 0} busy={saving} onClick={save}>
            {dirtyKeys.length ? `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}` : 'Saved'}
          </Btn>
        </div>
      }
    >
      {configError && (
        <div className="flex items-start gap-2 p-3 mb-4" style={{ background: c.amberSoft, border: '1px solid #E4CFA4' }}>
          <AlertTriangle size={14} style={{ color: c.amber, marginTop: 2, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: c.amber }}>
            Server settings could not be loaded ({configError}). Connection recovery below is still available.
          </span>
        </div>
      )}
      {draft.read_only_mode && (
        <div className="flex items-center gap-2 p-3 mb-4" style={{ background: c.amberSoft, border: `1px solid #E4CFA4` }}>
          <AlertTriangle size={14} style={{ color: c.amber }} />
          <span style={{ fontSize: 12.5, color: c.amber }}>Read-only mode is on. Scraping and writes are blocked until you turn it off.</span>
        </div>
      )}

      <Card style={{ marginBottom: 10 }}>
        <SubHead>Connection — {ENVS[env]?.label}</SubHead>
        <p style={{ fontSize: 12, color: c.ink60, lineHeight: 1.5, margin: '-4px 0 12px' }}>{ENVS[env]?.desc}</p>

        {env === 'local' && (
          <Field label="Preset" hint="Only the API has to run on this machine to develop against it — the database and documents can stay on the cloud instances everyone else uses. Either way, all three fields below stay editable.">
            <Segmented
              value={localScope}
              onChange={applyLocalPreset}
              options={[{ value: 'cloud', label: 'Server only' }, { value: 'local', label: 'Server + DB + files' }]}
            />
          </Field>
        )}

        {env === 'local' && (
          localScope === 'cloud' ? (
            <div className="py-2">
              <div className="flex items-start gap-2 p-2.5" style={{ background: c.indigoSoft, border: '1px solid #B9C6E6' }}>
                <ShieldCheck size={13} style={{ color: c.indigo, marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: c.indigo, lineHeight: 1.5 }}>
                  Pointed at the shared Postgres database and Cloud Storage bucket — tenders this local server scrapes are visible to everyone else immediately.
                </span>
              </div>
            </div>
          ) : (
            <div className="py-2">
              <div className="flex items-start gap-2 p-2.5" style={{ background: c.amberSoft, border: '1px solid #E4CFA4' }}>
                <AlertTriangle size={13} style={{ color: c.amber, marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: c.amber, lineHeight: 1.5 }}>
                  Pointed at a database and folder on this machine. Tenders scraped here won't reach the shared database, and nothing else can see this local storage — use Push to Cloud below to sync what's been scraped so far.
                </span>
              </div>
              <div className="pt-2">
                <Btn size="sm" variant="primary" icon={Upload} busy={pushingToCloud} onClick={pushToCloud}>Push to Cloud</Btn>
              </div>
            </div>
          )
        )}

        <Field label="Scraping server URL" hint="The Cloud Run service (or local FastAPI process) that this console and the desktop app send requests to.">
          <TextIn value={urlDraft} onChange={setUrlDraft} w={300} placeholder="https://your-service.a.run.app" />
        </Field>
        <Field label="Database URL" hint="Postgres connection string this server reads and writes tenders through.">
          <TextIn value={dbDraft} onChange={setDbDraft} w={300} placeholder="postgresql://user@host:5432/bidmanager" />
        </Field>
        <Field label="Storage / Drive URL" hint="Where downloaded tender documents live — a gs:// bucket, another cloud provider's bucket URL, or a local folder path.">
          <span className="flex items-center gap-2">
            <TextIn value={storageDraft} onChange={setStorageDraft} w={244} placeholder="gs://your-bucket" />
            {env === 'local' && localScope === 'local' && (
              // WIRE: window.bidmanagerDesktop.chooseFolder() via Electron preload
              <Btn size="sm" onClick={() => toast('Folder picker opens here')}>Browse</Btn>
            )}
          </span>
        </Field>

        <div className="flex items-center justify-end gap-2 pt-3">
          {connDirty && <span style={{ fontSize: 11.5, color: c.amber }}>Not applied yet</span>}
          <Btn size="sm" variant="ghost" icon={Clock} onClick={restoreLastWorking}>Restore last working</Btn>
          <Btn size="sm" icon={Activity} busy={testing} onClick={testConnection}>Test connection</Btn>
          <Btn size="sm" variant="primary" icon={Check} disabled={!connDirty} onClick={applyConnection}>Apply connection settings</Btn>
        </div>
      </Card>

      <div className="xl:columns-2 2xl:columns-3" style={{ columnGap: 16 }}>
          {group('Browser sessions', <>
            <Field label="Concurrent sessions" hint="Each session is one Chrome instance on the server" dirty={isDirty('max_concurrent_sessions')}>
              <NumIn value={draft.max_concurrent_sessions} onChange={(v) => set('max_concurrent_sessions', v)} min={1} />
            </Field>
            <Field label="Page load timeout" dirty={isDirty('page_load_timeout_s')}>
              <NumIn value={draft.page_load_timeout_s} onChange={(v) => set('page_load_timeout_s', v)} suffix="s" />
            </Field>
            <Field label="Retry attempts" dirty={isDirty('retry_attempts')}>
              <NumIn value={draft.retry_attempts} onChange={(v) => set('retry_attempts', v)} />
            </Field>
            <Field label="Backoff between retries" dirty={isDirty('retry_backoff_s')}>
              <NumIn value={draft.retry_backoff_s} onChange={(v) => set('retry_backoff_s', v)} suffix="s" />
            </Field>
            <Field label="Headless Chrome" dirty={isDirty('headless')}>
              <Toggle checked={draft.headless} onChange={(v) => set('headless', v)} />
            </Field>
            <Field label="Rotate user agent" dirty={isDirty('rotate_user_agent')}>
              <Toggle checked={draft.rotate_user_agent} onChange={(v) => set('rotate_user_agent', v)} />
            </Field>
            <Field label="Outbound IPs" hint="Portals block datacentre ranges — route through residential if fetches start failing" dirty={isDirty('proxy_pool')}>
              <Select value={draft.proxy_pool} onChange={(v) => set('proxy_pool', v)} w={150}
                options={[{ value: 'none', label: 'Direct' }, { value: 'datacenter', label: 'Datacentre' }, { value: 'residential', label: 'Residential' }]} />
            </Field>
          </>)}

          {group('Captcha solving', <>
            <Field label="AI provider" hint="Choose manual entry, a hosted AI provider, or any OpenAI-compatible vision API" dirty={isDirty('captcha_ai_provider')}>
              <Select value={draft.captcha_ai_provider} onChange={(v) => set('captcha_ai_provider', v)} w={190}
                options={[
                  { value: 'manual', label: 'Manual only' },
                  { value: 'gemini', label: 'Google Gemini' },
                  { value: 'openai', label: 'OpenAI / ChatGPT' },
                  { value: 'anthropic', label: 'Anthropic / Claude' },
                  { value: 'openai-compatible', label: 'Other compatible API' },
                ]} />
            </Field>
            {draft.captcha_ai_provider !== 'manual' && <>
              <Field label="Model ID" hint={draft.captcha_ai_provider === 'gemini' ? 'e.g. gemini-3.6-flash — the key + model are verified with a test call when you save' : 'Enter the exact vision-capable model identifier supplied by the provider'} dirty={isDirty('captcha_ai_model')}>
                <TextIn value={draft.captcha_ai_model || ''} onChange={(v) => set('captcha_ai_model', v)} w={240} placeholder={draft.captcha_ai_provider === 'gemini' ? 'gemini-3.6-flash' : 'Provider model ID'} />
              </Field>
              <Field label="API key" hint={draft.captcha_ai_api_key_set ? 'A key is already saved. Leave this blank to keep it unchanged.' : 'The key is stored server-side and is never returned to this browser.'} dirty={isDirty('captcha_ai_api_key')}>
                <TextIn value={draft.captcha_ai_api_key || ''} onChange={(v) => set('captcha_ai_api_key', v)} w={240} type="password" placeholder={draft.captcha_ai_api_key_set ? 'Saved - enter to replace' : 'Provider API key'} />
              </Field>
              <Field label="API endpoint" hint={draft.captcha_ai_provider === 'openai-compatible' ? 'Required: full chat-completions endpoint for the compatible provider' : 'Optional override; leave blank to use the provider default'} dirty={isDirty('captcha_ai_endpoint')}>
                <TextIn value={draft.captcha_ai_endpoint || ''} onChange={(v) => set('captcha_ai_endpoint', v)} w={300} placeholder="https://provider.example/v1/chat/completions" />
              </Field>
            </>}
            <Field label="Attempts per captcha" dirty={isDirty('captcha_max_attempts')}>
              <NumIn value={draft.captcha_max_attempts} onChange={(v) => set('captcha_max_attempts', v)} />
            </Field>
            <Field label="Minimum confidence" hint="Below this the answer is discarded and re-read" dirty={isDirty('captcha_confidence_min')}>
              <NumIn value={draft.captcha_confidence_min} onChange={(v) => set('captcha_confidence_min', v)} step={0.01} />
            </Field>
            <Field label="Ask me when the model fails" hint="Sends the image to the Captchas screen instead of failing the job" dirty={isDirty('captcha_manual_fallback')}>
              <Toggle checked={draft.captcha_manual_fallback} onChange={(v) => set('captcha_manual_fallback', v)} />
            </Field>
            <Field label="Hand over after" hint="Failed model reads before it comes to you" dirty={isDirty('captcha_handover_after_attempts')}>
              <NumIn value={draft.captcha_handover_after_attempts} onChange={(v) => set('captcha_handover_after_attempts', v)} suffix="tries" min={1} />
            </Field>
            <Field label="Hold the session for" hint="The browser sits open this long waiting for you — longer ties up a session slot" dirty={isDirty('captcha_manual_wait_s')}>
              <NumIn value={draft.captcha_manual_wait_s} onChange={(v) => set('captcha_manual_wait_s', v)} suffix="s" />
            </Field>
            <Field label="Alert me by" dirty={isDirty('captcha_alert_channel')}>
              <Select value={draft.captcha_alert_channel} onChange={(v) => set('captcha_alert_channel', v)} w={150}
                options={[{ value: 'desktop', label: 'Desktop alert' }, { value: 'sound', label: 'Sound only' }, { value: 'email', label: 'Email' }, { value: 'none', label: 'No alert' }]} />
            </Field>
            <Field label="If nobody answers" dirty={isDirty('captcha_on_no_answer')}>
              <Select value={draft.captcha_on_no_answer} onChange={(v) => set('captcha_on_no_answer', v)} w={150}
                options={[{ value: 'requeue', label: 'Try again later' }, { value: 'abandon', label: 'Fail the job' }]} />
            </Field>
          </>)}

          {group('Documents & storage', <>
            <Field label="Download documents automatically" dirty={isDirty('auto_download_documents')}>
              <Toggle checked={draft.auto_download_documents} onChange={(v) => set('auto_download_documents', v)} />
            </Field>
            <Field label="Maximum file size" dirty={isDirty('max_file_size_mb')}>
              <NumIn value={draft.max_file_size_mb} onChange={(v) => set('max_file_size_mb', v)} suffix="MB" />
            </Field>
            <Field label="Accepted extensions" dirty={isDirty('allowed_extensions')}>
              <TextIn value={draft.allowed_extensions} onChange={(v) => set('allowed_extensions', v)} w={230} />
            </Field>
            <Field label="Bucket" hint="The bucket name here should match the Storage / Drive URL set in Connection above" dirty={isDirty('gcs_bucket')}>
              <TextIn value={draft.gcs_bucket} onChange={(v) => set('gcs_bucket', v)} w={230} />
            </Field>
            <Field label="Path prefix" hint="Folder inside that bucket where tender documents are organised" dirty={isDirty('storage_prefix')}>
              <TextIn value={draft.storage_prefix} onChange={(v) => set('storage_prefix', v)} w={160} />
            </Field>
            <Field label="Download link lifetime" hint="How long a signed link stays valid after a client asks for it" dirty={isDirty('signed_url_ttl_min')}>
              <NumIn value={draft.signed_url_ttl_min} onChange={(v) => set('signed_url_ttl_min', v)} suffix="min" />
            </Field>
          </>)}

          {group('Job queue', <>
            <Field label="Skip tenders already in the queue" hint="Stops two sessions opening for the same tender ID" dirty={isDirty('dedupe_by_tender_id')}>
              <Toggle checked={draft.dedupe_by_tender_id} onChange={(v) => set('dedupe_by_tender_id', v)} />
            </Field>
            <Field label="Abandon a job after" dirty={isDirty('job_ttl_minutes')}>
              <NumIn value={draft.job_ttl_minutes} onChange={(v) => set('job_ttl_minutes', v)} suffix="min" />
            </Field>
            <Field label="Queue depth limit" dirty={isDirty('max_queue_depth')}>
              <NumIn value={draft.max_queue_depth} onChange={(v) => set('max_queue_depth', v)} />
            </Field>
            <Field label="Client poll interval" hint="How often the desktop app asks for job progress" dirty={isDirty('poll_interval_ms')}>
              <NumIn value={draft.poll_interval_ms} onChange={(v) => set('poll_interval_ms', v)} suffix="ms" step={100} />
            </Field>
            <Field label="Daily tender archive" hint="Archive tenders 24h+ past their closing date, once per day" dirty={isDirty('archive_daily_enabled')}>
              <Toggle checked={draft.archive_daily_enabled} onChange={(v) => set('archive_daily_enabled', v)} />
            </Field>
            <Field label="Archive run time" hint="Hour of day (IST, 0–23) to run the daily archive sweep" dirty={isDirty('archive_daily_hour')}>
              <NumIn value={draft.archive_daily_hour} onChange={(v) => set('archive_daily_hour', v)} min={0} max={23} suffix=":00 IST" />
            </Field>
            <Field label="Scheduler downtime — From" hint="IST. The only window in which automatic scraping is paused. Between From and To no jobs run; a job due in that window runs at the To time. Leave blank to run 24/7." dirty={isDirty('scheduler_downtime_from')}>
              <TextIn type="time" w={110} value={draft.scheduler_downtime_from} onChange={(v) => set('scheduler_downtime_from', v)} />
            </Field>
            <Field label="Scheduler downtime — To" dirty={isDirty('scheduler_downtime_to')}>
              <TextIn type="time" w={110} value={draft.scheduler_downtime_to} onChange={(v) => set('scheduler_downtime_to', v)} />
            </Field>
          </>)}

          {group('Access', <>
            <Field label="Read-only mode" hint="Serve data but refuse every write and scrape" dirty={isDirty('read_only_mode')}>
              <Toggle checked={draft.read_only_mode} onChange={(v) => set('read_only_mode', v)} />
            </Field>
            <Field label="Require admin key" hint="Protects this console and every /admin route" dirty={isDirty('require_admin_key')}>
              <Toggle checked={draft.require_admin_key} onChange={(v) => set('require_admin_key', v)} />
            </Field>
          </>)}
      </div>
      <Card style={{ position: 'sticky', bottom: 12, marginTop: 2, boxShadow: '0 6px 18px rgba(21,32,42,0.10)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span style={{ fontSize: 12.5, color: dirtyKeys.length ? c.amber : c.ink60 }}>
            {dirtyKeys.length ? `${dirtyKeys.length} unsaved setting change${dirtyKeys.length === 1 ? '' : 's'}` : 'All server settings are saved'}
          </span>
          <div className="flex items-center gap-2">
            {dirtyKeys.length > 0 && <Btn size="sm" variant="ghost" onClick={() => setDraft(saved)}>Discard</Btn>}
            <Btn size="sm" variant="primary" icon={Check} disabled={dirtyKeys.length === 0} busy={saving} onClick={save}>
              Save changes
            </Btn>
          </div>
        </div>
      </Card>
    </Panel>
  );
}

function JobsPanel({ toast, base, adminKey }) {
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  const [jobs, setJobs] = useState(null);
  const [loadError, setLoadError] = useState('');
  const loadingRef = useRef(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      setLoadError('');
      setJobs(await api.jobs());
    } catch (err) {
      const message = err.message || 'Could not load jobs';
      setLoadError(message);
      setJobs([]);
      toast(message);
    } finally {
      loadingRef.current = false;
    } // WIRE: GET /admin/jobs
  }, [api, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  const act = async (id, kind) => {
    try {
      await api.jobAction(id, kind); // WIRE: POST /admin/jobs/{id}/{kind}
      toast(kind === 'cancel' ? `Job ${id} cancelled` : `Job ${id} queued again`);
    } catch (err) {
      toast(err.message || 'Action failed');
    }
    load();
  };

  if (!jobs) return <Panel code="JOB" title="Jobs"><Card><Empty icon={Loader2} title="Loading queue…" /></Card></Panel>;

  const counts = jobs.reduce((a, j) => ({ ...a, [j.status]: (a[j.status] || 0) + 1 }), {});
  const shown = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);
  const tone = { running: 'info', queued: 'neutral', done: 'ok', failed: 'error' };

  return (
    <Panel
      code="JOB" title="Jobs" note="Scrape and download queue"
      right={
        <div className="flex items-center gap-2">
          <Btn size="sm" icon={Trash2} onClick={async () => {
            try { await api.jobAction(); toast('Finished jobs cleared'); load(); }
            catch (err) { toast(err.message || 'Could not clear jobs'); }
          }}>Clear finished</Btn>
          <Btn size="sm" icon={RefreshCw} onClick={load}>Refresh</Btn>
        </div>
      }
    >
      {loadError && (
        <Card style={{ marginBottom: 10 }}>
          <div className="flex items-center gap-2 p-3 mb-3" style={{ background: c.amberSoft, border: `1px solid #E4CFA4` }}>
            <AlertTriangle size={14} style={{ color: c.amber }} />
            <span style={{ fontSize: 12.5, color: c.amber }}>{loadError}</span>
          </div>
        </Card>
      )}
      <StatStrip items={[
        ['Running', String(counts.running || 0).padStart(2, '0'), c.indigo],
        ['Queued', String(counts.queued || 0).padStart(2, '0'), c.ink60],
        ['Finished', String(counts.done || 0).padStart(2, '0'), c.seal],
        ['Failed', String(counts.failed || 0).padStart(2, '0'), c.stamp],
      ]} />

      <div className="flex flex-wrap gap-1.5 mb-3">
        {['all', 'running', 'queued', 'done', 'failed'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px',
              background: filter === f ? c.ink : c.card, color: filter === f ? '#fff' : c.ink60,
              border: `1px solid ${filter === f ? c.ink : c.rule}`, cursor: 'pointer',
            }}>{f}</button>
        ))}
      </div>

      <Card pad={false}>
        {shown.length === 0 ? (
          <Empty icon={Layers} title="Nothing in this state right now." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: c.paper }}>
                  {['Job', 'Tender ID', 'Portal', 'Task', 'State', 'Progress', 'Elapsed', ''].map((th) => (
                    <th key={th} className="text-left px-3 py-2" style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.ink60, borderBottom: `1px solid ${c.rule}`, fontWeight: 500 }}>{th}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((j) => (
                  <tr key={j.id} style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
                    <td className="px-3 py-2"><Mono style={{ fontSize: 12, color: c.ink60 }}>{j.id}</Mono></td>
                    <td className="px-3 py-2">
                      <Mono style={{ fontSize: 12.5, color: c.ink }}>{j.tenderId}</Mono>
                      {j.error && <div style={{ fontSize: 11.5, color: c.stamp, marginTop: 2 }}>{j.error}</div>}
                    </td>
                    <td className="px-3 py-2" style={{ fontSize: 12.5, color: c.ink }}>{j.portal}</td>
                    <td className="px-3 py-2" style={{ fontSize: 12.5, color: c.ink60 }}>{j.kind}</td>
                    <td className="px-3 py-2"><Pill state={tone[j.status]}>{j.status}</Pill></td>
                    <td className="px-3 py-2" style={{ minWidth: 110 }}>
                      <div className="flex items-center gap-2">
                        <Bar pct={j.progress} tone={j.status === 'failed' ? c.stamp : j.status === 'done' ? c.seal : c.indigo} />
                        <Mono style={{ fontSize: 11, color: c.ink60 }}>{j.progress}%</Mono>
                      </div>
                    </td>
                    <td className="px-3 py-2"><Mono style={{ fontSize: 11.5, color: c.ink60 }}>{j.startedAt ? fmtDur(Date.now() - j.startedAt) : '—'}</Mono></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {j.status === 'running' || j.status === 'queued' ? (
                        <Btn size="sm" variant="danger" onClick={() => act(j.id, 'cancel')}>Cancel</Btn>
                      ) : j.status === 'failed' ? (
                        <Btn size="sm" icon={RotateCcw} onClick={() => act(j.id, 'retry')}>Retry</Btn>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Panel>
  );
}

function ScraperPanel({ toast, base, adminKey }) {
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  const [websites, setWebsites] = useState([]);
  const [websiteId, setWebsiteId] = useState('');
  const [organizations, setOrganizations] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [selectedOrgs, setSelectedOrgs] = useState(new Set());
  const [selectedTenders, setSelectedTenders] = useState(new Set());
  const [orgSearch, setOrgSearch] = useState('');
  const [tenderSearch, setTenderSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [starting, setStarting] = useState(false);
  const [repeatInterval, setRepeatInterval] = useState(3);
  const [repeatUnit, setRepeatUnit] = useState('hours');
  const [ownerName, setOwnerName] = useState(() => localStorage.getItem('bidmanager.admin.owner.v1') || 'default');
  const [savedJobs, setSavedJobs] = useState([]);
  const [jobName, setJobName] = useState('');
  const [jobType, setJobType] = useState('scrape');
  const [scrapeAllOrgs, setScrapeAllOrgs] = useState(false);
  // "select all" in the Organizations table is a live set: new orgs from a
  // refresh auto-join, vanished orgs auto-drop, until a row is unticked.
  const [allOrgsMode, setAllOrgsMode] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false);
  const [newWebsiteName, setNewWebsiteName] = useState('');
  const [newWebsiteUrl, setNewWebsiteUrl] = useState('');
  const [newWebsiteStatusUrl, setNewWebsiteStatusUrl] = useState('');
  const [editingJobId, setEditingJobId] = useState(null);
  const [editingJobOwner, setEditingJobOwner] = useState(null);
  const [selectedSavedJobId, setSelectedSavedJobId] = useState(null);
  const [savedJobScheduleMode, setSavedJobScheduleMode] = useState('manual');
  const [savedJobScheduleAt, setSavedJobScheduleAt] = useState(() => toDateTimeLocal());

  useEffect(() => {
    api.websites().then((rows) => {
      const next = Array.isArray(rows) ? rows : [];
      setWebsites(next);
      setWebsiteId((current) => current || String(next[0]?.id || ''));
    }).catch((err) => toast(err.message || 'Could not load websites'));
  }, [api, toast]);

  const loadDataFor = useCallback(async (wid) => {
    if (!wid) return { orgs: [], tenders: [] };
    setLoading(true);
    try {
      const [orgRows, tenderRows] = await Promise.all([
        api.organizations(wid), api.tenders(wid),
      ]);
      const orgs = Array.isArray(orgRows) ? orgRows : [];
      const tenderList = Array.isArray(tenderRows) ? tenderRows : [];
      setOrganizations(orgs);
      setTenders(tenderList);
      return { orgs, tenders: tenderList };
    } catch (err) {
      toast(err.message || 'Could not load organizations and tenders');
      return { orgs: [], tenders: [] };
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  const loadData = useCallback(() => loadDataFor(websiteId), [loadDataFor, websiteId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Keep the org selection consistent with the current list on every reload
  // (e.g. after a refresh scrape): drop ids whose row is gone, and when
  // "select all" is active re-add every current org id. Bails without a
  // setState when nothing changed so it can't loop.
  useEffect(() => {
    const orgIds = organizations.map((o) => o.id);
    const orgIdSet = new Set(orgIds);
    setSelectedOrgs((current) => {
      const next = new Set();
      current.forEach((id) => { if (orgIdSet.has(id)) next.add(id); });
      if (allOrgsMode) orgIds.forEach((id) => next.add(id));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [organizations, allOrgsMode]);

  const loadSavedJobs = useCallback(async () => {
    const owner = ownerName.trim();
    if (!owner) return setSavedJobs([]);
    try {
      const isAdmin = owner.toLowerCase() === 'admin';
      const lists = await Promise.all(
        isAdmin ? [api.savedCustomJobs(owner)] : [api.savedCustomJobs(owner), api.savedCustomJobs('admin')]
      );
      const merged = new Map();
      lists.flat().forEach((job) => merged.set(job.id, job));
      setSavedJobs(Array.from(merged.values()).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)));
    } catch (err) { toast(err.message || 'Could not load saved jobs'); }
  }, [api, ownerName, toast]);

  useEffect(() => {
    localStorage.setItem('bidmanager.admin.owner.v1', ownerName);
    loadSavedJobs();
  }, [ownerName, loadSavedJobs]);

  const changeWebsite = (nextWebsiteId) => {
    setWebsiteId(nextWebsiteId);
  };

  const addWebsite = async () => {
    const name = newWebsiteName.trim();
    const url = newWebsiteUrl.trim();
    if (!name || !url) return toast('Enter both a name and a tenders-by-organisation URL');
    setBusy('add-website');
    try {
      const created = await api.createWebsite(name, url, newWebsiteStatusUrl.trim());
      const rows = await api.websites();
      setWebsites(Array.isArray(rows) ? rows : []);
      setWebsiteId(String(created.id));
      setNewWebsiteName('');
      setNewWebsiteUrl('');
      setNewWebsiteStatusUrl('');
      setAddingWebsite(false);
      toast(`Website "${name}" added`);
    } catch (err) { toast(err.message || 'Could not add website'); }
    setBusy('');
  };

  const toggle = (setter, value) => setter((current) => {
    const next = new Set(current);
    next.has(value) ? next.delete(value) : next.add(value);
    return next;
  });

  const runPortalScraper = async () => {
    if (!websiteId) return;
    setStarting(true);
    try {
      const job = await api.startScrape(websiteId, true);
      toast(`Scrape job ${job.job_id || job.id || ''} queued`);
    } catch (err) { toast(err.message || 'Could not start scraper'); }
    setStarting(false);
  };

  const queueScrape = async () => {
    const currentOrgIds = organizations.filter((org) => selectedOrgs.has(org.id)).map((org) => org.id);
    if (currentOrgIds.length === 0) return;
    setBusy('scrape-selected');
    try {
      const job = await api.scrapeOrganizations(websiteId, currentOrgIds, false);
      toast(`Scrape job ${job.job_id || job.id || ''} queued`);
    } catch (err) { toast(err.message || 'Could not queue scrape'); }
    setBusy('');
  };

  const queueTenderRefresh = async () => {
    const currentTenderIds = tenders.filter((tender) => selectedTenders.has(tender.id)).map((tender) => tender.id);
    if (currentTenderIds.length === 0) return;
    setBusy('refresh-selected');
    try {
      const job = await api.refreshTenders(websiteId, currentTenderIds);
      toast(`Tender refresh ${job.job_id || job.id || ''} queued`);
    } catch (err) { toast(err.message || 'Could not queue tender refresh'); }
    setBusy('');
  };

  const queueDownload = async () => {
    const currentTenderIds = tenders.filter((tender) => selectedTenders.has(tender.id)).map((tender) => tender.id);
    if (currentTenderIds.length === 0) return;
    setBusy('download-selected');
    try {
      const job = await api.downloadTenders(websiteId, currentTenderIds, false, 'auto');
      toast(`Download job ${job.job_id || job.id || ''} queued`);
    } catch (err) { toast(err.message || 'Could not queue downloads'); }
    setBusy('');
  };

  const saveNamedJob = async () => {
    const owner = ownerName.trim();
    const name = jobName.trim();
    if (!owner || !name) return toast('Enter both user/owner and job name');
    if (jobType === 'scrape' && !scrapeAllOrgs && selectedOrgs.size === 0) return toast('Select at least one organization, or check "Entire website"');
    if (jobType === 'download' && selectedTenders.size === 0) return toast('Select at least one tender');
    const scheduledForAt = savedJobScheduleMode === 'manual' ? 0 : new Date(savedJobScheduleAt).getTime() / 1000;
    if (savedJobScheduleMode !== 'manual' && (!Number.isFinite(scheduledForAt) || scheduledForAt <= Date.now() / 1000)) {
      return toast('Choose a scheduled date and time in the future');
    }
    const intervalMinutes = (Number(repeatInterval) || 0) * ({ minutes: 1, hours: 60, days: 1440 }[repeatUnit] || 1);
    if (savedJobScheduleMode === 'interval' && intervalMinutes <= 0) return toast('Enter a positive repeat interval');
    setBusy('save-custom');
    try {
      const saved = await api.saveCustomJob({
        owner_name: editingJobId ? (editingJobOwner || owner) : owner, name, website_id: Number(websiteId), job_type: jobType,
        // When "Whole website" is on, a non-empty org_ids is the signal for
        // "refresh, then scrape every org" — only send it when live select-all
        // is active, otherwise the job stays refresh-only.
        org_ids: (jobType === 'scrape' && scrapeAllOrgs && !allOrgsMode) ? [] : [...selectedOrgs],
        tender_ids: [...selectedTenders],
        all_organizations: jobType === 'scrape' && scrapeAllOrgs,
        download_mode: 'auto', schedule_enabled: savedJobScheduleMode !== 'manual',
        schedule_mode: savedJobScheduleMode,
        interval_minutes: savedJobScheduleMode === 'interval' ? intervalMinutes : 0,
        scheduled_for_at: scheduledForAt,
      }, editingJobId);
      const savedId = Number(saved.id || editingJobId);
      toast(editingJobId ? 'Saved job updated' : 'Custom job saved');
      setEditingJobId(savedId);
      setSelectedSavedJobId(savedId);
      await loadSavedJobs();
    } catch (err) { toast(err.message || 'Could not save custom job'); }
    setBusy('');
  };

  const editSavedJob = async (job) => {
    setEditingJobId(job.id);
    setEditingJobOwner(job.owner_name);
    setSelectedSavedJobId(job.id);
    setJobName(job.name);
    setJobType(job.job_type === 'both' ? 'download' : (job.job_type || 'scrape'));
    setScrapeAllOrgs(Boolean(job.all_organizations));
    // all_organizations + a stored org list == "refresh, then scrape every org"
    // (live select-all). all_organizations alone == refresh only.
    const liveAllOrgs = Boolean(job.all_organizations) && (job.org_ids || []).length > 0;
    setAllOrgsMode(liveAllOrgs);
    setSavedJobScheduleMode(job.schedule_mode || (job.schedule_enabled ? 'interval' : 'manual'));
    setSavedJobScheduleAt(toDateTimeLocal(job.next_run_at || job.scheduled_for_at || undefined));
    const minutes = Number(job.interval_minutes) || 180;
    if (minutes % 1440 === 0) {
      setRepeatInterval(minutes / 1440);
      setRepeatUnit('days');
    } else if (minutes % 60 === 0) {
      setRepeatInterval(minutes / 60);
      setRepeatUnit('hours');
    } else {
      setRepeatInterval(minutes);
      setRepeatUnit('minutes');
    }
    // Load this job's website data first, then pre-check the rows it targets so
    // they can be unchecked to trim the job. Only ids with a visible row are
    // kept (all orgs load; tenders are the active set).
    const wid = String(job.website_id);
    setWebsiteId(wid);
    const { orgs, tenders: tenderRows } = await loadDataFor(wid);
    const orgRowIds = new Set(orgs.map((o) => o.id));
    const tenderRowIds = new Set(tenderRows.map((t) => t.id));
    setSelectedOrgs(liveAllOrgs ? new Set(orgs.map((o) => o.id)) : new Set((job.org_ids || []).filter((id) => orgRowIds.has(id))));
    setSelectedTenders(new Set((job.tender_ids || []).filter((id) => tenderRowIds.has(id))));
  };

  const runSavedJob = async (job) => {
    setBusy(`run-${job.id}`);
    try {
      const queued = await api.runSavedCustomJob(job.id, job.owner_name || ownerName.trim());
      toast(`Job ${queued.job_id || ''} queued`);
      await loadSavedJobs();
    } catch (err) { toast(err.message || 'Could not run saved job'); }
    setBusy('');
  };

  const deleteSavedJob = async (job) => {
    setBusy(`delete-${job.id}`);
    try {
      await api.deleteSavedCustomJob(job.id, job.owner_name || ownerName.trim());
      // Remaining jobs are auto-renumbered on the server, so any cached id
      // (edit target / selection) can now point at a different row — reset.
      setEditingJobId(null); setEditingJobOwner(null); setJobName(''); setSelectedSavedJobId(null); setAllOrgsMode(false);
      toast('Saved job deleted');
      await loadSavedJobs();
    } catch (err) { toast(err.message || 'Could not delete saved job'); }
    setBusy('');
  };

  const orgNeedle = orgSearch.trim().toLowerCase();
  const tenderNeedle = tenderSearch.trim().toLowerCase();
  const shownOrgs = organizations.filter((org) => !orgNeedle || String(org.name || '').toLowerCase().includes(orgNeedle));
  const shownTenders = tenders.filter((tender) => !tenderNeedle || [tender.tender_id, tender.title, tender.org_chain]
    .some((value) => String(value || '').toLowerCase().includes(tenderNeedle)));
  const currentSelectedOrgCount = organizations.filter((org) => selectedOrgs.has(org.id)).length;
  const currentSelectedTenderCount = tenders.filter((tender) => selectedTenders.has(tender.id)).length;
  const selectionReady = jobType === 'scrape' ? (scrapeAllOrgs || selectedOrgs.size > 0) : selectedTenders.size > 0;
  const repeatLabel = (minutes) => {
    const value = Number(minutes) || 0;
    if (value % 1440 === 0) return `${value / 1440} day${value === 1440 ? '' : 's'}`;
    if (value % 60 === 0) return `${value / 60} hour${value === 60 ? '' : 's'}`;
    return `${value} minute${value === 1 ? '' : 's'}`;
  };
  const savedJobScheduleLabel = (job) => {
    const mode = job.schedule_mode || (job.schedule_enabled ? 'interval' : 'manual');
    if (mode === 'once') {
      return job.schedule_enabled && job.next_run_at
        ? `once · ${new Date(job.next_run_at * 1000).toLocaleString()}`
        : 'once · completed';
    }
    if (mode === 'interval' && job.schedule_enabled) return `every ${repeatLabel(job.interval_minutes)}`;
    return 'run manually';
  };

  return (
    <Panel
      code="SCR" title="Scraper" note="Organizations, tenders and custom jobs"
      right={<Btn size="sm" icon={RefreshCw} busy={loading} disabled={!websiteId} onClick={loadData}>Refresh</Btn>}
    >
      <Card style={{ marginBottom: 10 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SubHead>Run scraper</SubHead>
            <div style={{ fontSize: 12, color: c.ink60 }}>Refresh the organization list for the selected portal.</div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={websiteId} onChange={changeWebsite} w={210} options={websites.map((website) => ({ value: String(website.id), label: website.name }))} />
            <Btn variant="primary" icon={Play} busy={starting} disabled={!websiteId} onClick={runPortalScraper}>Run</Btn>
            <Btn size="sm" variant="ghost" icon={Plus} onClick={() => setAddingWebsite((v) => !v)}>Add website</Btn>
          </div>
        </div>
        {addingWebsite && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${c.rule}` }}>
            <TextIn value={newWebsiteName} onChange={setNewWebsiteName} w={160} placeholder="Website name" />
            <TextIn value={newWebsiteUrl} onChange={setNewWebsiteUrl} w={320} placeholder="Tenders-by-organisation URL" />
            <TextIn value={newWebsiteStatusUrl} onChange={setNewWebsiteStatusUrl} w={260} placeholder="Status-check URL (optional)" />
            <Btn size="sm" variant="primary" busy={busy === 'add-website'} disabled={!newWebsiteName.trim() || !newWebsiteUrl.trim()} onClick={addWebsite}>Create</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setAddingWebsite(false)}>Cancel</Btn>
          </div>
        )}
      </Card>
      <Card pad={false} style={{ position: 'sticky', top: 52, zIndex: 5, marginBottom: 10, boxShadow: '0 6px 18px rgba(21,32,42,0.10)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" style={{ borderBottom: `1px solid ${c.rule}` }}>
          <div>
            <SubHead>Saved custom jobs</SubHead>
            <div style={{ fontSize: 12, color: c.ink60 }}>Save the current selection, run it manually, or schedule it for a specific time.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TextIn value={ownerName} onChange={setOwnerName} w={150} placeholder="User / owner" />
            <TextIn value={jobName} onChange={setJobName} w={190} placeholder="Custom job name" />
            <Select value={jobType} onChange={setJobType} w={120} options={[
              { value: 'scrape', label: 'Scrape' },
              { value: 'download', label: 'Download' },
            ]} />
            {jobType === 'scrape' && (
              <label className="flex items-center gap-1.5" style={{ fontSize: 12, color: c.ink60, cursor: 'pointer' }}
                title="Refreshes the whole website's organization list and per-org tender counts. Also tick 'select all' in the Organizations list and the job will refresh, then scrape every org.">
                <Toggle checked={scrapeAllOrgs} onChange={setScrapeAllOrgs} />
                {scrapeAllOrgs && allOrgsMode ? 'Whole website (refresh + scrape all)' : 'Whole website (refresh orgs)'}
              </label>
            )}
            <Select value={savedJobScheduleMode} onChange={setSavedJobScheduleMode} w={118} options={[
              { value: 'manual', label: 'Manual' },
              { value: 'once', label: 'Run once at' },
              { value: 'interval', label: 'Repeat' },
            ]} />
            {savedJobScheduleMode !== 'manual' && <TextIn type="datetime-local" value={savedJobScheduleAt} onChange={setSavedJobScheduleAt} w={178} />}
            {savedJobScheduleMode === 'interval' && <>
              <NumIn value={repeatInterval} onChange={setRepeatInterval} min={1} w={70} />
              <Select value={repeatUnit} onChange={setRepeatUnit} w={92} options={[
                { value: 'minutes', label: 'Minutes' },
                { value: 'hours', label: 'Hours' },
                { value: 'days', label: 'Days' },
              ]} />
            </>}
            <Btn size="sm" busy={busy === 'save-custom'} disabled={!jobName.trim() || !selectionReady} onClick={saveNamedJob}>{editingJobId ? 'Update' : 'Save'}</Btn>
            <Btn size="sm" variant="primary" icon={Play} busy={selectedSavedJobId && busy === `run-${selectedSavedJobId}`} disabled={!selectedSavedJobId} onClick={() => runSavedJob({ id: selectedSavedJobId })}>Run</Btn>
            {editingJobId && <Btn size="sm" variant="ghost" onClick={() => { setEditingJobId(null); setEditingJobOwner(null); setSelectedSavedJobId(null); setJobName(''); setScrapeAllOrgs(false); }}>Close edit</Btn>}
          </div>
        </div>
        {editingJobId && <div className="flex items-center px-3 py-2" style={{ background: c.paper }}><Pill state="info">editing #{editingJobId}</Pill></div>}
      </Card>

      <Card pad={false} style={{ marginBottom: 10 }}>
        {savedJobs.length === 0 ? <Empty icon={Clock} title="No jobs saved for this user." /> : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: c.paper }}>
                {['Name', 'Type', 'Scope', 'Schedule', 'Last / next run', ''].map((th) => <th key={th} className="text-left px-3 py-2" style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.ink60, borderBottom: `1px solid ${c.rule}`, fontWeight: 500 }}>{th}</th>)}
              </tr></thead>
              <tbody>{savedJobs.map((job) => <tr key={job.id} style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
                <td className="px-3 py-2"><span style={{ fontSize: 12.5, color: c.ink }}><Mono style={{ fontSize: 11, color: c.ink40 }}>#{job.id}</Mono> {job.name}</span></td>
                <td className="px-3 py-2"><Pill state={job.job_type === 'scrape' ? 'info' : 'ok'}>{job.job_type}</Pill></td>
                <td className="px-3 py-2" style={{ fontSize: 11.5, color: c.ink60 }}>{[
                  job.job_type !== 'download' ? (job.all_organizations ? (job.org_ids.length ? 'Whole website · refresh + scrape all' : 'Whole website · refresh orgs') : `${job.org_ids.length} organizations`) : '',
                  job.job_type !== 'scrape' ? `${job.tender_ids.length} tenders` : '',
                ].filter(Boolean).join(' Â· ')}</td>
                <td className="px-3 py-2"><Pill state={job.schedule_enabled ? 'info' : 'neutral'}><span style={{ display: 'inline-block', minWidth: 104, textAlign: 'center' }}>{savedJobScheduleLabel(job)}</span></Pill></td>
                <td className="px-3 py-2"><Mono style={{ fontSize: 10.5, color: c.ink60 }}>{job.last_run_at ? new Date(job.last_run_at * 1000).toLocaleString() : 'Never'}<br />{job.schedule_enabled && job.next_run_at ? `Next: ${new Date(job.next_run_at * 1000).toLocaleString()}` : ''}</Mono></td>
                <td className="px-3 py-2 text-right whitespace-nowrap"><div className="inline-flex gap-1.5"><Btn size="sm" onClick={() => editSavedJob(job)}>Edit</Btn><Btn size="sm" variant="primary" icon={Play} busy={busy === `run-${job.id}`} onClick={() => runSavedJob(job)}>Run once</Btn><Btn size="sm" variant="danger" icon={Trash2} busy={busy === `delete-${job.id}`} onClick={() => deleteSavedJob(job)}>Delete</Btn></div></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card pad={false} style={{ marginBottom: 10 }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" style={{ borderBottom: `1px solid ${c.rule}` }}>
          <div>
            <SubHead>Organizations</SubHead>
            <div style={{ fontSize: 12, color: c.ink60 }}>Select organizations to scrape.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TextIn value={orgSearch} onChange={setOrgSearch} w={220} placeholder="Search organizations" />
            <Btn size="sm" variant="primary" icon={Play} busy={busy === 'scrape-selected'} disabled={currentSelectedOrgCount === 0} onClick={queueScrape}>Run</Btn>
          </div>
        </div>
        <div className="overflow-auto" style={{ maxHeight: 310 }}>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}><tr style={{ background: c.paper }}>
              <th className="px-3 py-2 text-left" style={{ width: 36, borderBottom: `1px solid ${c.rule}` }}><input type="checkbox" aria-label="Select all organizations" checked={allOrgsMode || (organizations.length > 0 && organizations.every((org) => selectedOrgs.has(org.id)))} onChange={(e) => {
                if (e.target.checked) {
                  setAllOrgsMode(true);
                  setSelectedOrgs(new Set(organizations.map((org) => org.id)));
                } else {
                  setAllOrgsMode(false);
                  setSelectedOrgs((current) => { const next = new Set(current); organizations.forEach((org) => next.delete(org.id)); return next; });
                }
              }} style={{ accentColor: c.indigo }} /></th>
              {['Organization', 'Tenders', 'Last scrape'].map((th) => <th key={th} className="text-left px-3 py-2" style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.ink60, borderBottom: `1px solid ${c.rule}`, fontWeight: 500 }}>{th}</th>)}
            </tr></thead>
            <tbody>{shownOrgs.map((org) => <tr key={org.id} style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
              <td className="px-3 py-2"><input type="checkbox" checked={selectedOrgs.has(org.id)} onChange={() => {
                const next = new Set(selectedOrgs);
                next.has(org.id) ? next.delete(org.id) : next.add(org.id);
                setSelectedOrgs(next);
                if (!organizations.every((o) => next.has(o.id))) setAllOrgsMode(false);
              }} style={{ accentColor: c.indigo }} /></td>
              <td className="px-3 py-2" style={{ fontSize: 12.5, color: c.ink }}>{org.name}</td>
              <td className="px-3 py-2"><Mono style={{ fontSize: 11.5, color: c.ink60 }}>{org.tender_count ?? 0}</Mono></td>
              <td className="px-3 py-2"><Mono style={{ fontSize: 11.5, color: c.ink60 }}>{org.last_scraped_at ? new Date(org.last_scraped_at * 1000).toLocaleString() : '—'}</Mono></td>
            </tr>)}</tbody>
          </table>
          {!loading && shownOrgs.length === 0 && <Empty icon={Layers} title="No organizations match this search." />}
        </div>
      </Card>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" style={{ borderBottom: `1px solid ${c.rule}` }}>
          <div>
            <SubHead>Tenders</SubHead>
            <div style={{ fontSize: 12, color: c.ink60 }}>Download refreshes tender data first, then automatically chooses a full or update download.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TextIn value={tenderSearch} onChange={setTenderSearch} w={210} placeholder="Search tenders" />
            <Btn size="sm" variant="primary" icon={Play} busy={busy === 'refresh-selected'} disabled={currentSelectedTenderCount === 0} onClick={queueTenderRefresh}>Run</Btn>
            <Btn size="sm" variant="success" icon={Download} busy={busy === 'download-selected'} disabled={currentSelectedTenderCount === 0} onClick={queueDownload}>Download</Btn>
          </div>
        </div>
        <div className="overflow-auto" style={{ maxHeight: 360 }}>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}><tr style={{ background: c.paper }}>
              <th className="px-3 py-2 text-left" style={{ width: 36, borderBottom: `1px solid ${c.rule}` }}><input type="checkbox" aria-label="Select shown tenders" checked={shownTenders.length > 0 && shownTenders.every((tender) => selectedTenders.has(tender.id))} onChange={(e) => setSelectedTenders((current) => { const next = new Set(current); shownTenders.forEach((tender) => e.target.checked ? next.add(tender.id) : next.delete(tender.id)); return next; })} style={{ accentColor: c.indigo }} /></th>
              {['Tender ID', 'Organization / title', 'Last scrape', 'Schedule', 'Download'].map((th) => <th key={th} className="text-left px-3 py-2" style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.ink60, borderBottom: `1px solid ${c.rule}`, fontWeight: 500 }}>{th}</th>)}
            </tr></thead>
            <tbody>{shownTenders.map((tender) => <tr key={tender.id} style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
              <td className="px-3 py-2"><input type="checkbox" checked={selectedTenders.has(tender.id)} onChange={() => toggle(setSelectedTenders, tender.id)} style={{ accentColor: c.indigo }} /></td>
              <td className="px-3 py-2"><Mono style={{ fontSize: 11.5, color: c.ink }}>{tender.tender_id || '—'}</Mono></td>
              <td className="px-3 py-2" style={{ minWidth: 260 }}><div style={{ fontSize: 12, color: c.ink }}>{tender.org_chain || '—'}</div><div style={{ fontSize: 11.5, color: c.ink60, marginTop: 2 }}>{tender.title || '—'}</div></td>
              <td className="px-3 py-2"><Mono style={{ fontSize: 11, color: c.ink60 }}>{tender.last_scraped_at ? new Date(tender.last_scraped_at * 1000).toLocaleString() : '—'}</Mono></td>
              <td className="px-3 py-2"><Pill state={tender.scrape_enabled ? 'info' : 'neutral'}>{tender.scrape_enabled ? `${tender.scrape_interval_minutes} min` : 'off'}</Pill></td>
              <td className="px-3 py-2"><Pill state={tender.download_status === 'complete' ? 'ok' : tender.download_status === 'failed' ? 'error' : 'neutral'}>{tender.download_status || 'not downloaded'}</Pill></td>
            </tr>)}</tbody>
          </table>
          {!loading && shownTenders.length === 0 && <Empty icon={FileText} title="No tenders available. Scrape organizations first." />}
        </div>
      </Card>
    </Panel>
  );
}

function StoragePanel({ toast, env, base, adminKey, storageUrl, localScope }) {
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  const [prefix, setPrefix] = useState('');
  const [data, setData] = useState(null);
  const [usage, setUsage] = useState(null);
  const isLocalFiles = env === 'local' && localScope === 'local';
  const backendStorageProvider = usage?.provider || '';
  const usingDrive = backendStorageProvider === 'google-drive' || String(storageUrl || '').startsWith('gdrive://');
  const storageLabel = usage?.label || (usingDrive ? 'Google Drive' : isLocalFiles ? 'Local folder' : 'Cloud storage');
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState('');

  const reloadUsage = useCallback(() => {
    api.storageUsage().then(setUsage).catch((err) => toast(err.message || 'Could not load storage usage'));
  }, [api, toast]);
  const reloadListing = useCallback(() => {
    setData(null); setSel(new Set());
    api.storage(prefix).then(setData).catch((err) => toast(err.message || 'Could not list this folder'));
  }, [api, prefix, toast]);

  useEffect(() => { reloadUsage(); }, [reloadUsage]); // WIRE: GET /admin/storage/usage
  useEffect(() => { reloadListing(); }, [reloadListing]); // WIRE: GET /admin/storage?prefix=

  const crumbs = prefix ? prefix.replace(/\/$/, '').split('/') : [];
  const toggle = (name) => setSel((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const createFolder = async () => {
    const name = window.prompt('New folder name');
    if (!name) return;
    try {
      await api.storageAction('folder', { prefix, name }); // WIRE: POST /admin/storage/folder
      toast('Folder created');
      reloadListing();
    } catch (err) {
      toast(err.message || 'Could not create folder');
    }
  };

  const deleteSelected = async () => {
    if (!sel.size) return;
    try {
      await Promise.all(Array.from(sel).map((name) =>
        api.storageAction('delete', { path: `${prefix}${name}` }) // WIRE: DELETE /admin/storage
      ));
      toast(`${sel.size} items deleted`);
      setSel(new Set());
      reloadListing();
      reloadUsage();
    } catch (err) {
      toast(err.message || 'Delete failed');
    }
  };

  const getLinksForSelected = async () => {
    if (!sel.size) return;
    try {
      const results = await Promise.all(Array.from(sel).map((name) =>
        api.storageAction('signed-url', { path: `${prefix}${name}` }) // WIRE: POST /admin/storage/signed-url
      ));
      const urls = results.map((r) => r.url).filter(Boolean);
      if (urls.length) { try { await navigator.clipboard.writeText(urls.join('\n')); } catch {} }
      toast(`${sel.size} download links created`);
    } catch (err) {
      toast(err.message || 'Could not create links');
    }
  };

  const getLinkForFile = async (name) => {
    try {
      const r = await api.storageAction('signed-url', { path: `${prefix}${name}` }); // WIRE: POST /admin/storage/signed-url
      if (r.url) { try { await navigator.clipboard.writeText(r.url); } catch {} }
      toast('Download link copied');
    } catch (err) {
      toast(err.message || 'Could not create link');
    }
  };

  const filtered = useMemo(() => {
    if (!data) return null;
    const t = q.trim().toLowerCase();
    if (!t) return data;
    return { folders: data.folders.filter((f) => f.name.toLowerCase().includes(t)), files: data.files.filter((f) => f.name.toLowerCase().includes(t)) };
  }, [data, q]);

  return (
    <Panel
      code="FS" title="Files" note={`${storageLabel}${backendStorageProvider ? ` · ${backendStorageProvider}` : ''}`}
      right={
        <div className="flex items-center gap-2">
          <Btn size="sm" icon={Plus} onClick={createFolder}>New folder</Btn>
          <Btn size="sm" icon={Upload} onClick={() => toast('Upload started')}>Upload</Btn>
        </div>
      }
    >
      {isLocalFiles && (
        <div className="flex items-center gap-2 p-3 mb-4" style={{ background: c.amberSoft, border: `1px solid #E4CFA4` }}>
          <AlertTriangle size={14} style={{ color: c.amber }} />
          <span style={{ fontSize: 12.5, color: c.amber }}>
            Showing <Mono style={{ fontSize: 12 }}>{storageUrl}</Mono> on this machine — not the shared bucket. Switch back to "Server only" in Settings → Connection to browse the cloud bucket.
          </span>
        </div>
      )}
      {usage && (
        <Card style={{ marginBottom: 10 }}>
          <div className="grid gap-x-10 md:grid-cols-2">
            <div>
              <RegisterRow label="Provider" value={storageLabel} />
              <RegisterRow label="Storage" value={usage.root || storageUrl || 'Not configured'} />
              <RegisterRow label="Objects" value={usage.objects.toLocaleString('en-IN')} />
            </div>
            <div>
              <RegisterRow label="Stored" value={usage.quota ? `${fmtBytes(usage.used)} of ${fmtBytes(usage.quota)}` : fmtBytes(usage.used)} />
              <RegisterRow label="Deleted after" value={usage.lifecycleDays ? `${usage.lifecycleDays} days` : 'Not configured'} />
            </div>
          </div>
          {usage.quota ? <div className="mt-2"><Bar pct={(usage.used / usage.quota) * 100} h={5} /></div> : null}
        </Card>
      )}

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 p-3" style={{ borderBottom: `1px solid ${c.rule}`, background: c.paper }}>
          {prefix && (
            <button onClick={() => setPrefix(crumbs.slice(0, -1).join('/') + (crumbs.length > 1 ? '/' : ''))}
              className="flex items-center" style={{ color: c.ink60, cursor: 'pointer' }} aria-label="Up one level">
              <ArrowLeft size={14} />
            </button>
          )}
          <button onClick={() => setPrefix('')} style={{ fontFamily: mono, fontSize: 12, color: prefix ? c.indigo : c.ink, cursor: 'pointer' }}>{usingDrive ? 'drive' : 'storage'}</button>
          {crumbs.map((cb, i) => (
            <span key={i} className="flex items-center gap-2">
              <ChevronRight size={12} style={{ color: c.ink40 }} />
              <button onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/') + '/')}
                style={{ fontFamily: mono, fontSize: 12, color: i === crumbs.length - 1 ? c.ink : c.indigo, cursor: 'pointer' }}>{cb}</button>
            </span>
          ))}
          <span className="flex-1" />
          <span className="flex items-center gap-1.5 px-2" style={{ border: `1px solid ${c.rule}`, background: c.card }}>
            <Search size={12} style={{ color: c.ink40 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter"
              style={{ fontFamily: mono, fontSize: 12, padding: '4px 0', width: 120, border: 'none', outline: 'none', background: 'transparent', color: c.ink }} />
          </span>
        </div>

        {sel.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-2" style={{ background: c.indigoSoft, borderBottom: `1px solid ${c.rule}` }}>
            <Mono style={{ fontSize: 11.5, color: c.indigo }}>{sel.size} selected</Mono>
            <span className="flex-1" />
            <Btn size="sm" icon={Download} onClick={getLinksForSelected}>Get links</Btn>
            <Btn size="sm" variant="danger" icon={Trash2} onClick={deleteSelected}>Delete</Btn>
          </div>
        )}

        {!filtered ? (
          <Empty icon={Loader2} title="Reading bucket…" />
        ) : filtered.folders.length + filtered.files.length === 0 ? (
          <Empty icon={Folder} title={q ? 'No names match that filter.' : 'This folder is empty. Upload a file to fill it.'} />
        ) : (
          <div>
            {filtered.folders.map((f) => (
              <div key={f.name} className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
                <input type="checkbox" checked={sel.has(f.name)} onChange={() => toggle(f.name)} style={{ accentColor: c.indigo }} />
                <button onClick={() => setPrefix(prefix + f.name + '/')} className="flex items-center gap-2 min-w-0 flex-1 text-left" style={{ cursor: 'pointer' }}>
                  <Folder size={14} style={{ color: c.indigo, flexShrink: 0 }} />
                  <span className="truncate" style={{ fontFamily: mono, fontSize: 12.5, color: c.ink }}>{f.name}</span>
                </button>
                <Mono style={{ fontSize: 11.5, color: c.ink40 }}>{f.items != null ? `${f.items} items` : '—'}</Mono>
                <Mono style={{ fontSize: 11.5, color: c.ink60, width: 68, textAlign: 'right' }}>{fmtBytes(f.size)}</Mono>
              </div>
            ))}
            {filtered.files.map((f) => (
              <div key={f.name} className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
                <input type="checkbox" checked={sel.has(f.name)} onChange={() => toggle(f.name)} style={{ accentColor: c.indigo }} />
                <FileText size={14} style={{ color: c.ink40, flexShrink: 0 }} />
                <span className="truncate flex-1" style={{ fontFamily: mono, fontSize: 12.5, color: c.ink }}>{f.name}</span>
                <Mono className="hidden sm:inline" style={{ fontSize: 11.5, color: c.ink40 }}>
                  {new Date(f.modified).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                </Mono>
                <Mono style={{ fontSize: 11.5, color: c.ink60, width: 68, textAlign: 'right' }}>{fmtBytes(f.size)}</Mono>
                <button onClick={() => getLinkForFile(f.name)} style={{ color: c.ink40, cursor: 'pointer' }} aria-label={`Copy link for ${f.name}`}>
                  <ExternalLink size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Panel>
  );
}

let _logLineSeq = 0;
// Real log lines are plain strings — level/source aren't tagged upstream, so
// they're guessed from the message text (best-effort, not fabricated data).
function _classifyLogLine(raw) {
  // raw is either a plain string (older server) or { text, ts } where ts is
  // epoch seconds when the line was actually emitted.
  const text = String(raw && typeof raw === 'object' ? (raw.text ?? '') : raw);
  const tsSec = raw && typeof raw === 'object' ? raw.ts : null;
  const ts = Number.isFinite(tsSec) ? new Date(tsSec * 1000) : new Date();
  const lower = text.toLowerCase();
  const level = /error|exception|traceback/.test(lower) ? 'error' : /warn/.test(lower) ? 'warn' : 'info';
  let source = 'api';
  if (/captcha|session|portal|scraper|selenium|chrome/.test(lower)) source = 'scraper';
  else if (/upload|download|gcs|drive|storage|bucket/.test(lower)) source = 'storage';
  else if (/\bjob\b|queued|claimed|worker/.test(lower)) source = 'worker';
  else if (/\bsql\b|postgres|sqlite|upsert|database|\btable\b/.test(lower)) source = 'db';
  return { id: ++_logLineSeq, ts, level, source, message: text };
}

function LogsPanel({ base, adminKey }) {
  const savedFilters = useMemo(loadLogFilters, []);
  const [lines, setLines] = useState([]);
  const [levels, setLevels] = useState(() => new Set(savedFilters.levels));
  const [source, setSource] = useState(savedFilters.source);
  const [q, setQ] = useState(savedFilters.q);
  const [follow, setFollow] = useState(true);
  const boxRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(LOG_FILTERS_KEY, JSON.stringify({ levels: [...levels], source, q }));
    } catch {}
  }, [levels, source, q]);

  // WIRE: EventSource(`${base}/admin/logs/stream`), falling back to polling
  // GET /admin/logs/live if the stream can't be opened.
  useEffect(() => {
    if (!follow || !base) return undefined;
    let stopped = false;
    let es = null;
    let pollTimer = null;
    let sinceSeq = 0;

    const appendLine = (raw) => setLines((l) => [...l.slice(-400), _classifyLogLine(raw)]);

    const startPolling = () => {
      if (pollTimer || stopped) return;
      const tick = async () => {
        try {
          const payload = await apiFetch(base, `/admin/logs/live?since_seq=${sinceSeq}`, { adminKey });
          sinceSeq = payload.next_seq ?? sinceSeq;
          (payload.entries || payload.lines || []).forEach(appendLine);
        } catch {}
      };
      tick();
      pollTimer = setInterval(tick, 2000);
    };

    try {
      const url = `${base.replace(/\/+$/, '')}/admin/logs/stream${adminKey ? `?admin_key=${encodeURIComponent(adminKey)}` : ''}`;
      es = new EventSource(url);
      es.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          if (payload && payload.line != null) appendLine(payload.line);
        } catch {}
      };
      es.onerror = () => {
        if (es) { es.close(); es = null; }
        if (!stopped) startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      stopped = true;
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [follow, base, adminKey]);

  const shown = useMemo(() => lines.filter((l) =>
    levels.has(l.level) &&
    (source === 'all' || l.source === source) &&
    (!q.trim() || l.message.toLowerCase().includes(q.trim().toLowerCase()))
  ), [lines, levels, source, q]);

  useEffect(() => { if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [shown, follow]);

  const lvlColor = { debug: '#6E8496', info: '#7FB6E0', warn: '#E0B057', error: '#E27A6C' };
  const toggleLevel = (l) => setLevels((s) => { const n = new Set(s); n.has(l) ? n.delete(l) : n.add(l); return n; });

  return (
    <Panel
      code="LOG" title="Logs" note="Live from the running service"
      right={
        <div className="flex items-center gap-2">
          <Btn size="sm" icon={follow ? Pause : Play} onClick={() => setFollow(!follow)}>{follow ? 'Pause' : 'Follow'}</Btn>
          <Btn size="sm" icon={Download}>Export</Btn>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {LOG_LEVELS.map((l) => (
          <button key={l} onClick={() => toggleLevel(l)}
            style={{
              fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px',
              background: levels.has(l) ? c.ink : c.card, color: levels.has(l) ? '#fff' : c.ink40,
              border: `1px solid ${levels.has(l) ? c.ink : c.rule}`, cursor: 'pointer',
            }}>{l}</button>
        ))}
        <Select value={source} onChange={setSource} w={130} options={[{ value: 'all', label: 'all sources' }, ...LOG_SOURCES]} />
        <span className="flex items-center gap-1.5 px-2" style={{ border: `1px solid ${c.rule}`, background: c.card }}>
          <Filter size={12} style={{ color: c.ink40 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text"
            style={{ fontFamily: mono, fontSize: 12, padding: '5px 0', width: 150, border: 'none', outline: 'none', background: 'transparent', color: c.ink }} />
        </span>
        <span className="flex-1" />
        <Mono style={{ fontSize: 11.5, color: c.ink60 }}>{shown.length} of {lines.length} lines</Mono>
      </div>

      {/* The one inverted surface in the app: machine output on a machine ground */}
      <div ref={boxRef} className="overflow-auto bm-console"
        style={{ background: c.console, border: `1px solid ${c.consoleRule}`, height: 460, padding: '10px 0' }}>
        {shown.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span style={{ fontFamily: mono, fontSize: 12.5, color: '#5C6E7C' }}>Nothing matches these filters. Widen the level or clear the search.</span>
          </div>
        ) : shown.map((l) => (
          <div key={l.id} className="flex gap-3 px-3 py-0.5 bm-line" style={{ fontFamily: mono, fontSize: 12, lineHeight: 1.65 }}>
            <span style={{ color: '#556777', flexShrink: 0 }}>{fmtTime(l.ts)}</span>
            <span style={{ color: lvlColor[l.level], flexShrink: 0, width: 42, textTransform: 'uppercase', fontSize: 10.5, paddingTop: 2 }}>{l.level}</span>
            <span style={{ color: '#7C8FA0', flexShrink: 0, width: 58 }}>{l.source}</span>
            <span style={{ color: l.level === 'error' ? '#F0A79B' : c.consoleInk, wordBreak: 'break-word' }}>{l.message}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CaptchaPanel({ toast, captchas, setCaptchas, base, adminKey }) {
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(null);
  const [stats, setStats] = useState(null);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef(null);

  useEffect(() => { api.captchaStats().then(setStats).catch(() => {}); }, [api]); // WIRE: GET /admin/captchas/stats
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const active = captchas[0];

  // Drop challenges the scraper has already given up waiting on
  useEffect(() => {
    setCaptchas((q) => {
      const live = q.filter((x) => x.expiresAt > Date.now());
      return live.length === q.length ? q : live;
    });
  }, [now, setCaptchas]);

  useEffect(() => { setAnswer(''); inputRef.current?.focus(); }, [active?.id]);

  const send = async () => {
    if (!active || !answer.trim()) return;
    setBusy('send');
    try {
      await api.answerCaptcha(active.id, answer.trim()); // WIRE: POST /admin/captchas/{id}/answer
      setCaptchas((q) => q.filter((x) => x.id !== active.id));
      setAnswer('');
      toast(`Answer sent — ${active.jobId} resumed`);
    } catch (err) {
      toast(err.message || 'Could not send answer');
    }
    setBusy(null);
  };

  const refresh = async () => {
    if (!active) return;
    setBusy('refresh');
    try {
      const r = await api.refreshCaptcha(active.id); // WIRE: POST /admin/captchas/{id}/refresh
      setCaptchas((q) => q.map((x) => (x.id === active.id ? { ...x, image: r.image } : x)));
      setAnswer(''); inputRef.current?.focus();
    } catch (err) {
      toast(err.message || 'Could not refresh captcha');
    }
    setBusy(null);
  };

  const skip = async (action) => {
    if (!active) return;
    setBusy(action);
    try {
      await api.skipCaptcha(active.id, action); // WIRE: POST /admin/captchas/{id}/skip
      setCaptchas((q) => q.filter((x) => x.id !== active.id));
      toast(action === 'requeue' ? `${active.jobId} sent back to the queue` : `${active.jobId} abandoned`);
    } catch (err) {
      toast(err.message || 'Action failed');
    }
    setBusy(null);
  };

  const secsLeft = active ? Math.max(0, Math.round((active.expiresAt - now) / 1000)) : 0;
  const totalTtl = active ? Math.round((active.expiresAt - active.receivedAt) / 1000) : 1;
  const urgency = secsLeft < 30 ? c.stamp : secsLeft < 75 ? c.amber : c.seal;

  return (
    <Panel
      code="CAP" title="Captchas" note="Reads the model could not finish"
      right={
        <div className="flex items-center gap-2">
          <Pill state={captchas.length ? 'error' : 'ok'}>{captchas.length} waiting</Pill>
          <Btn size="sm" icon={RefreshCw} onClick={() => api.captchaQueue().then(setCaptchas).catch((err) => toast(err.message || 'Could not refresh'))}>Refresh</Btn>
        </div>
      }
    >
      {stats && (
        <StatStrip
          items={[
            ['Solved by model', stats.autoSolved, c.seal],
            ['Sent to you', stats.handedOver, c.indigo],
            ['You answered', stats.solvedByYou, c.ink],
            ['Ran out of time', stats.timedOut, stats.timedOut ? c.stamp : c.ink60],
          ]}
          note="last 24 hours"
        />
      )}

      {!active ? (
        <Card>
          <Empty icon={ShieldCheck} title="Nothing waiting. The model is clearing these on its own." />
          {stats && (
            <div className="pt-3 mx-auto" style={{ maxWidth: 380, borderTop: `1px solid ${c.ruleSoft}` }}>
              <RegisterRow label="Solved without you" value={`${stats.autoRate}%`} tone={c.seal} />
              <RegisterRow label="Your average reply" value={`${stats.avgResponseS}s`} />
            </div>
          )}
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {/* Active challenge */}
          <div className="lg:col-span-3">
            <Card>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Timer size={14} style={{ color: urgency }} />
                  <span style={{ fontFamily: cond, fontWeight: 700, fontSize: 17, color: c.ink }}>
                    {secsLeft}s left
                  </span>
                  <span style={{ fontSize: 12.5, color: c.ink60 }}>before the session gives up</span>
                </div>
                <Mono style={{ fontSize: 11.5, color: c.ink40 }}>{active.id}</Mono>
              </div>
              <Bar pct={(secsLeft / totalTtl) * 100} tone={urgency} h={5} />

              <div className="flex justify-center py-5">
                <img
                  src={active.image} alt="Captcha from the tender portal"
                  style={{ border: `1px solid ${c.rule}`, imageRendering: 'auto', width: 240, height: 84, background: '#fff' }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
                <input
                  ref={inputRef} value={answer} autoFocus
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                  placeholder="Type what you see"
                  aria-label="Captcha answer"
                  style={{
                    fontFamily: mono, fontSize: 20, letterSpacing: '0.22em', textAlign: 'center',
                    height: 51, padding: '0 12px', width: 240, border: `1px solid ${c.ink}`, background: c.card,
                    color: c.ink, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <Btn variant="primary" icon={Send} busy={busy === 'send'} disabled={!answer.trim()} onClick={send} style={{ height: 51, padding: '0 14px' }}>Send answer</Btn>
                <Btn icon={RefreshCw} busy={busy === 'refresh'} onClick={refresh} style={{ height: 51, padding: '0 14px' }}>New image</Btn>
              </div>

              <div className="flex items-center justify-center gap-2 pt-3" style={{ borderTop: `1px solid ${c.ruleSoft}` }}>
                <span style={{ fontSize: 11.5, color: c.ink40 }}>Press Enter to send · the next one loads straight after</span>
              </div>
            </Card>

            <Card style={{ marginTop: 14 }}>
              <SubHead>Why this reached you</SubHead>
              <div className="flex items-start gap-2 p-2.5 mb-2" style={{ background: c.amberSoft, border: `1px solid #E4CFA4` }}>
                <AlertTriangle size={13} style={{ color: c.amber, marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: c.amber }}>{active.reason}</span>
              </div>
              <div className="grid gap-x-10 md:grid-cols-2">
                <div>
                  <RegisterRow label="Tender" value={active.tenderId} />
                  <RegisterRow label="Portal" value={active.portal} />
                </div>
                <div>
                  <RegisterRow label="Job" value={active.jobId} />
                  <RegisterRow label="Model tried" value={`${active.aiAttempts}× · read “${active.aiGuess}” at ${(active.aiConfidence * 100).toFixed(0)}%`}
                    tone={active.aiConfidence < 0.5 ? c.stamp : c.ink} />
                </div>
              </div>
            </Card>
          </div>

          {/* Waiting behind it */}
          <div className="lg:col-span-2">
            <Card pad={false}>
              <div className="px-4 pt-4 pb-2"><SubHead>Waiting behind this</SubHead></div>
              {captchas.length === 1 ? (
                <div className="px-4 pb-5">
                  <span style={{ fontSize: 12.5, color: c.ink60 }}>Nothing else queued.</span>
                </div>
              ) : captchas.slice(1).map((x) => {
                const left = Math.max(0, Math.round((x.expiresAt - now) / 1000));
                return (
                  <div key={x.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: `1px solid ${c.ruleSoft}` }}>
                    <img src={x.image} alt="" style={{ width: 76, height: 27, border: `1px solid ${c.rule}`, objectFit: 'cover' }} />
                    <div className="min-w-0 flex-1">
                      <Mono style={{ fontSize: 12, color: c.ink, display: 'block' }} className="truncate">{x.tenderId}</Mono>
                      <span style={{ fontSize: 11, color: c.ink40 }}>{x.portal} · {x.jobId}</span>
                    </div>
                    <Mono style={{ fontSize: 11.5, color: left < 30 ? c.stamp : c.ink60 }}>{left}s</Mono>
                  </div>
                );
              })}
              <div className="p-4 flex flex-wrap gap-2" style={{ borderTop: `1px solid ${c.rule}`, background: c.paper }}>
                <Btn size="sm" icon={SkipForward} busy={busy === 'requeue'} onClick={() => skip('requeue')}>Skip for now</Btn>
                <Btn size="sm" variant="danger" icon={X} busy={busy === 'abandon'} onClick={() => skip('abandon')}>Abandon job</Btn>
              </div>
            </Card>
          </div>
        </div>
      )}
    </Panel>
  );
}

function UsersPanel({ toast, base, adminKey }) {
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState('');
  const loadingRef = useRef(false);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [revealed, setRevealed] = useState(() => new Set());
  const toggleReveal = (id) => setRevealed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      setLoadError('');
      setUsers(await api.clientUsers()); // WIRE: GET /admin/users
    } catch (err) {
      const message = err.message || 'Could not load users';
      setLoadError(message);
      setUsers([]);
      toast(message);
    } finally {
      loadingRef.current = false;
    }
  }, [api, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const act = async (id, kind) => {
    setBusyId(id);
    try {
      if (kind === 'suspend') await api.suspendClientUser(id); // WIRE: POST /admin/users/{id}/suspend
      else await api.reactivateClientUser(id); // WIRE: POST /admin/users/{id}/reactivate
      toast(kind === 'suspend' ? 'Account suspended' : 'Account reactivated');
      load();
    } catch (err) {
      toast(err.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  if (!users) return <Panel code="USR" title="Users"><Card><Empty icon={Loader2} title="Loading accounts…" /></Card></Panel>;

  const counts = users.reduce((a, u) => ({ ...a, [u.status]: (a[u.status] || 0) + 1 }), {});
  const shown = filter === 'all' ? users : users.filter((u) => u.status === filter);
  const fmt = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : '—');

  return (
    <Panel
      code="USR" title="Users" note="Every account signed in from the client app"
      right={<Btn size="sm" icon={RefreshCw} onClick={load}>Refresh</Btn>}
    >
      {loadError && (
        <Card style={{ marginBottom: 10 }}>
          <div className="flex items-center gap-2 p-3" style={{ background: c.amberSoft, border: `1px solid #E4CFA4` }}>
            <AlertTriangle size={14} style={{ color: c.amber }} />
            <span style={{ fontSize: 12.5, color: c.amber }}>{loadError}</span>
          </div>
        </Card>
      )}
      <StatStrip items={[
        ['Active', String(counts.active || 0).padStart(2, '0'), c.seal],
        ['Suspended', String(counts.suspended || 0).padStart(2, '0'), c.stamp],
        ['Total', String(users.length).padStart(2, '0'), c.ink60],
      ]} />

      <div className="flex flex-wrap gap-1.5 mb-3">
        {['all', 'active', 'suspended'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px',
              background: filter === f ? c.ink : c.card, color: filter === f ? '#fff' : c.ink60,
              border: `1px solid ${filter === f ? c.ink : c.rule}`, cursor: 'pointer',
            }}>{f}</button>
        ))}
      </div>

      <Card pad={false}>
        {shown.length === 0 ? (
          <Empty icon={Users} title="No accounts in this state." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: c.paper }}>
                  {['Email', 'Name', 'Password', 'Status', 'Created', 'Last seen', 'Activity', ''].map((th) => (
                    <th key={th} className="text-left px-3 py-2" style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.ink60, borderBottom: `1px solid ${c.rule}`, fontWeight: 500 }}>{th}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
                    <td className="px-3 py-2" style={{ fontSize: 12.5, color: c.ink }}>{u.email}</td>
                    <td className="px-3 py-2" style={{ fontSize: 12.5, color: c.ink60 }}>{u.display_name || '—'}</td>
                    <td className="px-3 py-2" style={{ fontSize: 12, color: c.ink60 }}>
                      {u.password == null ? (
                        <span style={{ color: c.ink40 }}>— not captured</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Mono style={{ fontSize: 12 }}>{revealed.has(u.id) ? u.password : '••••••••'}</Mono>
                          <button onClick={() => toggleReveal(u.id)} style={{ color: c.ink40, cursor: 'pointer' }} aria-label="Show or hide password"><Eye size={12} /></button>
                          <button onClick={async () => { try { await navigator.clipboard.writeText(u.password); toast('Password copied'); } catch {} }} style={{ color: c.ink40, cursor: 'pointer' }} aria-label="Copy password"><Copy size={12} /></button>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2"><Pill state={u.status === 'active' ? 'ok' : 'error'}>{u.status}</Pill></td>
                    <td className="px-3 py-2"><Mono style={{ fontSize: 11, color: c.ink60 }}>{fmt(u.created_at)}</Mono></td>
                    <td className="px-3 py-2"><Mono style={{ fontSize: 11, color: c.ink60 }}>{fmt(u.last_seen_at)}</Mono></td>
                    <td className="px-3 py-2"><Mono style={{ fontSize: 11.5, color: c.ink60 }}>{u.activity_count}</Mono></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {u.status === 'active' ? (
                        <Btn size="sm" variant="danger" icon={Ban} busy={busyId === u.id} onClick={() => act(u.id, 'suspend')}>Suspend</Btn>
                      ) : (
                        <Btn size="sm" icon={Check} busy={busyId === u.id} onClick={() => act(u.id, 'reactivate')}>Reactivate</Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Panel>
  );
}

function DbPanel({ toast, env, base, adminKey, dbUrl, localScope }) {
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const isLocalDb = env === 'local' && localScope === 'local';

  const load = useCallback(() => {
    api.dbStats().then(setD).catch((err) => toast(err.message || 'Could not read database stats')); // WIRE: GET /admin/db/stats
  }, [api, toast]);
  useEffect(() => { load(); }, [load]);

  const backup = async () => {
    setBusy(true);
    try {
      await api.dbAction('backup'); // WIRE: POST /admin/db/backup
      toast('Backup finished');
      load();
    } catch (err) {
      toast(err.message || 'Backup failed');
    }
    setBusy(false);
  };

  if (!d) return <Panel code="DB" title="Database"><Card><Empty icon={Loader2} title="Reading database…" /></Card></Panel>;

  const maxRows = Math.max(...d.tables.map((t) => t.rows));

  return (
    <Panel
      code="DB" title="Database" note={isLocalDb ? 'Local Postgres — not the shared one' : 'Managed Postgres'}
      right={<Btn size="sm" icon={HardDrive} busy={busy} onClick={backup}>Back up now</Btn>}
    >
      {isLocalDb && (
        <div className="flex items-center gap-2 p-3 mb-4" style={{ background: c.amberSoft, border: `1px solid #E4CFA4` }}>
          <AlertTriangle size={14} style={{ color: c.amber }} />
          <span style={{ fontSize: 12.5, color: c.amber }}>
            Showing <Mono style={{ fontSize: 12 }}>{dbUrl}</Mono> — the numbers below won't match Production. Switch back to "Server only" in Settings → Connection to see the shared database.
          </span>
        </div>
      )}
      <Card style={{ marginBottom: 10 }}>
        <div className="grid gap-x-10 md:grid-cols-2">
          <div>
            <RegisterRow label="Engine" value={d.engine} />
            <RegisterRow label="Instance" value={d.host} />
          </div>
          <div>
            <RegisterRow label="Size on disk" value={fmtBytes(d.sizeBytes)} />
            <RegisterRow label="Connections" value={`${d.pool.active} active · ${d.pool.idle} idle · max ${d.pool.max}`} />
          </div>
        </div>
        <div className="mt-3 pt-3 flex items-center gap-2" style={{ borderTop: `1px solid ${c.ruleSoft}` }}>
          <ShieldCheck size={13} style={{ color: c.seal }} />
          <span style={{ fontSize: 12.5, color: c.ink60 }}>Schema is up to date at</span>
          <Mono style={{ fontSize: 12, color: c.ink }}>{d.migration}</Mono>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <SubHead>Tables</SubHead>
            {d.tables.map((t) => (
              <div key={t.name} className="py-2" style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <Mono style={{ fontSize: 12.5, color: c.ink }}>{t.name}</Mono>
                  <span className="flex items-baseline gap-3">
                    <Mono style={{ fontSize: 12, color: c.ink }}>{t.rows.toLocaleString('en-IN')} rows</Mono>
                    <Mono style={{ fontSize: 11.5, color: c.ink40, width: 62, textAlign: 'right' }}>{fmtBytes(t.size)}</Mono>
                  </span>
                </div>
                <Bar pct={(t.rows / maxRows) * 100} tone={c.indigo} h={3} />
              </div>
            ))}
          </Card>
        </div>

        <Card>
          <SubHead>Recent backups</SubHead>
          {d.backups.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 py-2" style={{ borderBottom: `1px solid ${c.ruleSoft}` }}>
              <div className="min-w-0">
                <Mono style={{ fontSize: 12, color: c.ink, display: 'block' }}>
                  {new Date(b.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                </Mono>
                <span style={{ fontSize: 11, color: c.ink40 }}>{b.kind} · {fmtBytes(b.size)}</span>
              </div>
              <Btn size="sm" variant="ghost" onClick={() => toast(`Restore from ${b.id} — confirm in the next step`)}>Restore</Btn>
            </div>
          ))}
        </Card>
      </div>
    </Panel>
  );
}

/* ═══════════════════════════ SHELL ══════════════════════════════════════ */

const NAV = [
  { code: 'SRV', key: 'server',  label: 'Server',   icon: Server },
  { code: 'CFG', key: 'config',  label: 'Settings', icon: Sliders },
  { code: 'SCR', key: 'scraper', label: 'Scraper',  icon: Globe },
  { code: 'JOB', key: 'jobs',    label: 'Jobs',     icon: Layers },
  { code: 'CAP', key: 'captcha', label: 'Captchas', icon: Eye, badge: true },
  { code: 'USR', key: 'users',   label: 'Users',    icon: Users },
  { code: 'FS',  key: 'storage', label: 'Files',    icon: Folder },
  { code: 'LOG', key: 'logs',    label: 'Logs',     icon: Terminal },
  { code: 'DB',  key: 'db',      label: 'Database', icon: Database },
];

const CONNECTION_PROFILE_KEY = 'bidmanager.admin.profile.v1';
const CONNECTION_LAST_GOOD_KEY = 'bidmanager.admin.connection-last-good.v1';
function loadConnectionProfile() {
  try {
    const raw = localStorage.getItem(CONNECTION_PROFILE_KEY);
    const profile = raw ? JSON.parse(raw) : null;
    if (LEGACY_PRODUCTION_API_BASES.includes(profile?.bases?.prod)) {
      profile.bases.prod = PRODUCTION_API_BASE;
    }
    // Remove obsolete placeholder buckets from profiles saved by older UI builds.
    if (profile?.storageUrls?.prod === 'gs://rakshit-bidmanager-docs') {
      profile.storageUrls.prod = PRODUCTION_STORAGE_ROOT;
    }
    if (profile?.storageUrls?.staging === 'gs://rakshit-bidmanager-docs-stg') {
      profile.storageUrls.staging = '';
    }
    if (profile) localStorage.setItem(CONNECTION_PROFILE_KEY, JSON.stringify(profile));
    return profile;
  } catch {
    return null;
  }
}

export default function BidManagerControl() {
  const savedProfile = useMemo(loadConnectionProfile, []);
  const [tab, setTab] = useState('server');
  const [env, setEnv] = useState(savedProfile?.env || 'prod');
  // WIRE: persist all three of these (e.g. localStorage or Electron's config store) so they survive a restart
  const [bases, setBases] = useState(() => ({
    ...Object.fromEntries(Object.entries(ENVS).map(([k, v]) => [k, v.base])),
    ...(savedProfile?.bases || {}),
    ...(DESKTOP_LOCAL_API_BASE ? { local: DESKTOP_LOCAL_API_BASE } : {}),
  }));
  const setBase = useCallback((url) => setBases((b) => ({ ...b, [env]: url })), [env]);

  const [dbUrls, setDbUrls] = useState({
    prod: 'postgresql://bm_app@10.42.0.5:5432/bidmanager',
    staging: 'postgresql://bm_app@10.42.0.6:5432/bidmanager_staging',
    local: 'postgresql://127.0.0.1:5432/bidmanager',
    ...(savedProfile?.dbUrls || {}),
  });
  const setDbUrl = useCallback((url) => setDbUrls((d) => ({ ...d, [env]: url })), [env]);

  const [storageUrls, setStorageUrls] = useState({
    prod: PRODUCTION_STORAGE_ROOT,
    staging: '',
    local: '~/BidManagerData/files',
    ...(savedProfile?.storageUrls || {}),
  });
  const setStorageUrl = useCallback((url) => setStorageUrls((s) => ({ ...s, [env]: url })), [env]);

  const [keyVal, setKeyVal] = useState(savedProfile?.keyVal || '');
  const [showKey, setShowKey] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [connectionState, setConnectionState] = useState('checking');
  const [captchas, setCaptchas] = useState([]);
  // Local-only preset: which values the three fields above default to when env === 'local'.
  // 'cloud' = server runs here, DB + files stay on the shared cloud instances · 'local' = both also run on this machine
  const [localScope, setLocalScope] = useState(savedProfile?.localScope || 'cloud');

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const api = createApi(bases[env], keyVal);
    setConnectionState('checking');

    const checkConnection = async () => {
      try {
        const health = await api.health();
        if (!cancelled) setConnectionState(health.status === 'serving' ? 'connected' : 'disconnected');
      } catch {
        if (!cancelled) setConnectionState('disconnected');
      } finally {
        if (!cancelled) timer = setTimeout(checkConnection, 15000);
      }
    };

    checkConnection();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bases, env, keyVal]);
  // Persists the connection profile (env, base URLs, admin key) so it survives a restart.
  useEffect(() => {
    try {
      localStorage.setItem(CONNECTION_PROFILE_KEY, JSON.stringify({ env, bases, dbUrls, storageUrls, keyVal, localScope }));
    } catch {}
  }, [env, bases, dbUrls, storageUrls, keyVal, localScope]);
  // WIRE: swap for SSE — these expire in under three minutes, polling loses time.
  // No SSE endpoint exists for captchas yet, so this polls fairly often instead.
  useEffect(() => {
    let cancelled = false;
    const api = createApi(bases[env], keyVal);
    const poll = () => api.captchaQueue().then((q) => { if (!cancelled) setCaptchas(q); }).catch(() => {});
    poll();
    const t = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, [bases, env, keyVal]);
  const toast = useCallback((m) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 2600); }, []);

  const Body = { server: ServerPanel, config: ConfigPanel, scraper: ScraperPanel, jobs: JobsPanel, captcha: CaptchaPanel, users: UsersPanel, storage: StoragePanel, logs: LogsPanel, db: DbPanel }[tab];

  return (
    <div style={{ background: c.paper, minHeight: '100vh', fontFamily: sans, color: c.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible {
          outline: 2px solid ${c.indigo}; outline-offset: 1px;
        }
        input[type=number]::-webkit-outer-spin-button, input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        .bm-console::-webkit-scrollbar { width: 10px; }
        .bm-console::-webkit-scrollbar-track { background: ${c.console}; }
        .bm-console::-webkit-scrollbar-thumb { background: ${c.consoleRule}; }
        .bm-line { animation: bmIn 240ms ease-out; }
        @keyframes bmIn { from { opacity: 0; } to { opacity: 1; } }
        main table tbody tr > td { transition: background 120ms ease-out; }
        main table tbody tr:hover > td { background: ${c.paper}; }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
        }
      `}</style>

      {/* Masthead */}
      <header className="sticky top-0 z-20" style={{ background: c.card, borderBottom: `1px solid ${c.rule}` }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 mx-auto" style={{ maxWidth: 1400 }}>
          <div className="flex items-baseline gap-2.5">
            <span style={{ fontFamily: cond, fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', color: c.ink }}>BidManager</span>
            <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: c.indigo }}>Control</span>
          </div>

          <span className="hidden md:block" style={{ width: 1, height: 20, background: c.rule }} />

          <div className="flex items-center gap-2">
            <Select value={env} onChange={setEnv} w={132}
              options={Object.entries(ENVS).map(([k, v]) => ({ value: k, label: v.label }))} />
            <button onClick={() => setTab('config')} title="Change in Settings → Connection"
              className="hidden lg:inline-block truncate" style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}>
              <Mono style={{ fontSize: 11.5, color: c.ink40, maxWidth: 280 }}>{bases[env] || '— not set —'}</Mono>
            </button>
            <button onClick={() => toast('Endpoint copied')} style={{ color: c.ink40, cursor: 'pointer' }} aria-label="Copy endpoint"><Copy size={12} /></button>
          </div>

          <span className="flex-1" />

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2" style={{ border: `1px solid ${c.rule}`, background: c.paper }}>
              <Key size={12} style={{ color: c.ink40 }} />
              <input
                type={showKey ? 'text' : 'password'} value={keyVal} onChange={(e) => setKeyVal(e.target.value)}
                placeholder="Admin key" aria-label="Admin key"
                style={{ fontFamily: mono, fontSize: 11.5, padding: '5px 0', width: 118, border: 'none', outline: 'none', background: 'transparent', color: c.ink }} />
              <button onClick={() => setShowKey(!showKey)} style={{ color: c.ink40, fontFamily: mono, fontSize: 10, cursor: 'pointer' }}>
                {showKey ? 'hide' : 'show'}
              </button>
            </span>
            <Pill state={connectionState === 'connected' ? 'ok' : connectionState === 'disconnected' ? 'error' : 'neutral'}>
              {connectionState}
            </Pill>
            <Mono className="hidden sm:inline" style={{ fontSize: 11.5, color: c.ink60 }}>
              {clock.toLocaleTimeString('en-GB', { hour12: false })} IST
            </Mono>
          </div>
        </div>
        {captchas.length > 0 && tab !== 'captcha' && (
          <button onClick={() => setTab('captcha')}
            className="flex items-center gap-2 w-full px-4 py-2 text-left"
            style={{ background: c.stampSoft, borderTop: `1px solid #E3B7B1`, cursor: 'pointer' }}>
            <Bell size={13} style={{ color: c.stamp }} />
            <span style={{ fontSize: 12.5, color: c.stamp }}>
              {captchas.length} captcha{captchas.length === 1 ? '' : 's'} waiting on you — sessions are held open until you answer
            </span>
            <span className="flex-1" />
            <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: c.stamp, borderBottom: `1px solid ${c.stamp}` }}>Solve now</span>
          </button>
        )}
      </header>

      <div className="flex flex-col">
        {/* Register rail — always a horizontal top bar, not a responsive sidebar */}
        <nav className="shrink-0 flex overflow-x-auto"
          style={{ background: c.card, borderBottom: `1px solid ${c.rule}`, width: undefined, minWidth: 0 }}>
          <div className="flex">
            {NAV.map((n) => {
              const on = tab === n.key;
              return (
                <button key={n.key} onClick={() => setTab(n.key)}
                  className="flex items-center gap-2 px-3 py-2 whitespace-nowrap transition-colors"
                  style={{
                    background: on ? c.paper : 'transparent',
                    borderLeft: `2px solid ${on ? c.indigo : 'transparent'}`,
                    color: on ? c.ink : c.ink60, cursor: 'pointer', textAlign: 'left',
                  }}>
                  <n.icon size={14} style={{ color: on ? c.indigo : c.ink40 }} />
                  <span style={{ fontSize: 13, fontWeight: on ? 600 : 400 }}>{n.label}</span>
                  {n.badge && captchas.length > 0 && (
                    <span style={{
                      fontFamily: mono, fontSize: 10, color: '#fff', background: c.stamp,
                      padding: '1px 5px', lineHeight: 1.5,
                    }}>{captchas.length}</span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <main className="flex-1 min-w-0 w-full mx-auto p-4 md:p-5 xl:p-6" style={{ maxWidth: 1400 }}>
          <Body
            toast={toast} captchas={captchas} setCaptchas={setCaptchas}
            env={env} base={bases[env]} adminKey={keyVal} setBase={setBase}
            dbUrl={dbUrls[env]} setDbUrl={setDbUrl}
            storageUrl={storageUrls[env]} setStorageUrl={setStorageUrl}
            localScope={localScope} setLocalScope={setLocalScope}
          />
        </main>
      </div>

      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 z-30 flex items-center gap-2 px-3.5 py-2"
          style={{ transform: 'translateX(-50%)', background: c.ink, color: '#fff', border: `1px solid ${c.ink}` }}>
          <Check size={13} />
          <span style={{ fontSize: 12.5 }}>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}
