// Response shapes from Server UI/server/api_server.py, after the same light
// normalisation the desktop Server UI applies in createApi().
//
// Units: fields ending in `_at` (snake_case) are epoch SECONDS; the camelCase
// admin fields startedAt / receivedAt / expiresAt are epoch MILLISECONDS.

export type CheckState = 'ok' | 'error' | string;

export type Health = {
  status: string;
  provider: string;
  label: string;
  version: string;
  revision: string;
  region: string;
  service: string;
  uptimeSeconds: number;
  checks: { name: string; state: CheckState; detail: string }[];
};

export type Metrics = {
  requests1h: number;
  p95: number | null;
  p99: number | null;
  errorRate: number;
  cpuPct: number | null;
  memPct: number | null;
  jobsRunning: number;
  jobsQueued: number;
  jobsFailed: number;
};

export type Settings = Record<string, boolean | number | string>;

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type Job = {
  id: string;
  status: JobStatus | string;
  action: string;
  kind: string;
  tenderId: string;
  portal: string;
  startedAt: number | null;
  progress: number;
  error: string;
  source: string;
};

export type JobStart = { job_id: string; status: string };

export type Captcha = {
  id: string;
  jobId: string;
  portal: string;
  image: string;
  reason: string;
  receivedAt: number;
  expiresAt: number;
};

export type CaptchaStats = { pending: number; manualFallback: boolean };

export type Website = { id: number; name: string; url: string; status_url: string };

export type Organization = {
  id: number;
  website_id: number;
  name: string;
  tender_count: number;
  last_scraped_at: number | null;
};

export type Tender = {
  id: number;
  website_id: number;
  tender_id: string | null;
  title: string | null;
  org_chain: string | null;
  /** Raw portal string, not ISO. */
  closing_date: string | null;
  status: string | null;
  download_status: string;
  last_scraped_at: number | null;
};

export type ScheduleMode = 'manual' | 'once' | 'interval';

export type SavedJob = {
  id: number;
  owner_name: string;
  name: string;
  website_id: number;
  job_type: 'scrape' | 'download';
  org_ids: number[];
  tender_ids: number[];
  all_organizations: boolean;
  download_mode: string;
  schedule_enabled: boolean;
  schedule_mode: ScheduleMode;
  interval_minutes: number;
  scheduled_for_at: number;
  next_run_at: number;
  last_run_at: number | null;
  created_by: 'user' | 'admin';
  run_days: string[];
  /** epoch seconds */
  created_at: number;
};

export type SavedJobScope = {
  organizations: { id: number; name: string }[];
  tenders: {
    id: number;
    tender_id: string;
    title: string;
    org_chain: string;
    closing_date: string;
  }[];
  all_organizations: boolean;
};

export type SavedJobInput = {
  owner_name: string;
  name: string;
  website_id: number;
  job_type: 'scrape' | 'download';
  org_ids: number[];
  tender_ids: number[];
  all_organizations: boolean;
  download_mode: 'auto' | 'full' | 'update';
  schedule_enabled: boolean;
  schedule_mode: ScheduleMode;
  interval_minutes: number;
  scheduled_for_at: number;
  run_days?: string[];
};

export type SuppressedSite = {
  website_id: number;
  website_name: string;
  suppressed_at: number;
};

/** The sections an account can be given; CAPTCHA answering is always on. */
export type Section = 'active' | 'archived' | 'bookmarks' | 'projects' | 'portal_search';
export type Permissions = Record<Section, boolean>;
export type OrgRole = 'admin' | 'member';

export type ClientUser = {
  id: number;
  email: string;
  display_name: string;
  status: 'active' | 'suspended' | string;
  created_at: number | null;
  last_login_at: number | null;
  last_seen_at: number | null;
  activity_count: number;
  password: string | null;
  /** Added with organisations (2026-10-23); absent on an older server. */
  account_type?: 'individual' | 'organisation';
  org?: { id: number; name: string; role: OrgRole } | null;
  permissions?: Permissions;
};

export type OrgSummary = {
  id: number;
  name: string;
  join_code: string;
  created_at: number;
  member_count: number;
  pending_requests: number;
};

export type OrgMember = {
  user_id: number;
  role: OrgRole;
  joined_at: number;
  email: string;
  display_name: string;
  status: string;
  last_seen_at: number | null;
  permissions: Permissions;
};

export type JoinRequest = {
  id: number;
  user_id: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  note: string | null;
  created_at: number;
  email: string;
  display_name: string;
};

export type OrgDetail = {
  id: number;
  name: string;
  join_code: string;
  status: 'active' | 'dissolved';
  created_at: number;
  created_by: number | null;
  members: OrgMember[];
  pending_requests: JoinRequest[];
  synced_at?: number;
};

export type UserDetail = ClientUser & {
  recent_activity: { route: string; tender_id: number | null; created_at: number }[];
  sync: {
    synced_at: number;
    counts: Record<string, number | boolean>;
    bookmarks: {
      id: number;
      tender_id: string;
      title: string;
      org_chain: string;
      website_name: string;
    }[];
    bookmarked_orgs: string[];
    projects: { id: unknown; title: string; status: string; client_name: string }[];
    templates: {
      id: unknown;
      organization: string;
      template_name: string;
      description: string;
    }[];
  };
};

export type LogLevel = 'info' | 'warn' | 'error';

export type LogLine = {
  seq: number;
  /** epoch ms */
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
};

export type LogsPage = {
  entries: { seq: number; ts: number; text: string }[];
  next_seq: number;
};
