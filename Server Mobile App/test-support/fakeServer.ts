// A tiny stand-in for the BidManager API, used by jest through a mocked global
// fetch. Responses use the real shapes from Server UI/server/api_server.py so the
// screens exercise the same parsing they do against the live server.

const now = Date.now();
const nowS = Math.floor(now / 1000);

const routes: [RegExp, unknown][] = [
  [
    /^\/admin\/health$/,
    {
      status: 'serving',
      provider: 'custom-api',
      label: 'OCI VM',
      version: '1.0.13',
      revision: 'rev-42',
      region: 'ap-mumbai-1',
      service: 'bidmanager-api',
      uptimeSeconds: 7200,
      checks: [
        { name: 'API', state: 'ok', detail: 'responding' },
        { name: 'Database', state: 'ok', detail: 'postgres' },
        { name: 'Storage', state: 'error', detail: 'not writable' },
      ],
    },
  ],
  [
    /^\/admin\/metrics$/,
    {
      requests1h: 1200,
      p95: 120,
      p99: null,
      errorRate: 0.5,
      cpuPct: 31,
      memPct: null,
      jobsRunning: 1,
      jobsQueued: 0,
      jobsFailed: 1,
    },
  ],
  [/^\/admin\/config$/, { settings: { scheduler_paused: 'false', job_ttl_minutes: 45, dedupe_by_tender_id: true, scheduler_downtime_days: 'sun' } }],
  [
    /^\/admin\/jobs$/,
    {
      jobs: [
        { id: 'aaaa1111', status: 'running', action: 'fetch_tenders_selected', kind: 'fetch', tenderId: '', portal: 'Maharashtra', startedAt: now - 60_000, progress: 0, error: '', source: 'admin' },
        { id: 'bbbb2222', status: 'failed', action: 'download_single_tender', kind: 'download', tenderId: '2026_PWD_1', portal: 'Maharashtra', startedAt: now - 600_000, progress: 0, error: 'Captcha timed out', source: 'client' },
      ],
    },
  ],
  [
    /^\/admin\/captchas\/pending$/,
    {
      captchas: [
        { id: 'cap-1', jobId: 'aaaa1111', portal: 'Status 2026_PWD_1', image: '', reason: 'Manual captcha required', receivedAt: now - 10_000, expiresAt: now + 200_000 },
      ],
    },
  ],
  [/^\/admin\/captchas\/stats$/, { pending: 1, manualFallback: true }],
  [/^\/v1\/websites$/, [{ id: 1, name: 'Maharashtra', url: 'https://mahatenders.gov.in', status_url: '' }]],
  [/^\/v1\/websites\/1\/organizations$/, [{ id: 11, website_id: 1, name: 'Public Works Department', tender_count: 12, is_selected: false, last_scraped_at: nowS - 3600 }]],
  [
    /^\/v1\/websites\/1\/tenders/,
    [
      { id: 901, website_id: 1, tender_id: '2026_PWD_1', title: 'Road works', org_chain: 'PWD || Pune', closing_date: '18-Oct-2026 11:00 AM', status: 'AOC', download_status: 'not_downloaded', last_scraped_at: nowS - 7200 },
    ],
  ],
  [
    // Must come before the generic custom-jobs rule below.
    /^\/admin\/custom-jobs\/2\/scope$/,
    {
      organizations: [{ id: 11, name: 'Public Works Department' }],
      tenders: [],
      all_organizations: false,
    },
  ],
  [
    /^\/admin\/custom-jobs/,
    {
      jobs: [
        { id: 2, owner_name: 'Raksh', name: 'PWD sweep', website_id: 1, job_type: 'scrape', org_ids: [11], tender_ids: [], all_organizations: false, download_mode: 'auto', schedule_enabled: true, schedule_mode: 'interval', interval_minutes: 360, scheduled_for_at: 0, next_run_at: nowS + 3600, last_run_at: nowS - 3600, created_by: 'admin', run_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], created_at: nowS - 86400 * 3 },
      ],
    },
  ],
  [/^\/admin\/bookmark-scrape\/suppressed$/, { items: [] }],
  [
    /^\/admin\/users$/,
    {
      items: [
        { id: 1, email: 'anil@example.com', display_name: 'Anil', status: 'active', created_at: nowS - 86400, last_login_at: nowS - 600, last_seen_at: nowS - 60, activity_count: 5, password: 'secret', account_type: 'organisation', org: { id: 1, name: 'Rakshit Infra', role: 'member' }, permissions: { active: true, archived: false, bookmarks: true, projects: true, portal_search: true } },
        { id: 2, email: 'solo@example.com', display_name: '', status: 'active', created_at: nowS - 86400, last_login_at: null, last_seen_at: null, activity_count: 0, password: null, account_type: 'individual', org: null, permissions: { active: true, archived: true, bookmarks: true, projects: true } },
      ],
    },
  ],
  [/^\/admin\/orgs$/, { items: [{ id: 1, name: 'Rakshit Infra', join_code: 'K7PQ2MXA', created_at: nowS - 86400 * 5, member_count: 2, pending_requests: 1 }] }],
  [
    /^\/admin\/orgs\/1$/,
    {
      id: 1, name: 'Rakshit Infra', join_code: 'K7PQ2MXA', status: 'active', created_at: nowS - 86400 * 5, created_by: 9, synced_at: nowS - 300,
      members: [
        { user_id: 9, role: 'admin', joined_at: nowS - 86400 * 5, email: 'boss@example.com', display_name: 'Boss', status: 'active', last_seen_at: nowS - 120, permissions: { active: true, archived: true, bookmarks: true, projects: true } },
        { user_id: 1, role: 'member', joined_at: nowS - 86400, email: 'anil@example.com', display_name: 'Anil', status: 'active', last_seen_at: nowS - 60, permissions: { active: true, archived: false, bookmarks: true, projects: true, portal_search: true } },
      ],
      pending_requests: [{ id: 7, user_id: 2, status: 'pending', note: 'Please add me', created_at: nowS - 3600, email: 'solo@example.com', display_name: '' }],
    },
  ],
  [
    /^\/admin\/users\/1$/,
    {
      id: 1, email: 'anil@example.com', display_name: 'Anil', status: 'active', created_at: nowS - 86400, last_login_at: nowS - 600, last_seen_at: nowS - 60, activity_count: 1, password: null,
      account_type: 'organisation', org: { id: 1, name: 'Rakshit Infra', role: 'member' }, permissions: { active: true, archived: false, bookmarks: true, projects: true, portal_search: true },
      recent_activity: [{ route: 'GET /client/tenders', tender_id: null, created_at: nowS - 60 }],
      sync: {
        synced_at: 0,
        counts: {},
        bookmarks: [{ id: 901, tender_id: '2026_PWD_1', title: 'Road works', org_chain: 'PWD || Pune', website_name: 'Maharashtra' }],
        bookmarked_orgs: ['PWD'],
        projects: [],
        templates: [],
      },
    },
  ],
  [/^\/admin\/logs\/live/, { entries: [{ seq: 1, ts: nowS, text: 'Job queued for worker' }, { seq: 2, ts: nowS, text: 'ERROR portal timeout' }], next_seq: 2 }],
];

export async function fakeFetch(url: string): Promise<Response> {
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/__bm_proxy/, '');
  const found = routes.find(([re]) => re.test(path.split('?')[0]) || re.test(path));
  const body = found ? JSON.stringify(found[1]) : JSON.stringify({ detail: `No fake for ${path}` });
  return {
    ok: !!found,
    status: found ? 200 : 404,
    statusText: found ? 'OK' : 'Not Found',
    text: async () => body,
  } as Response;
}
