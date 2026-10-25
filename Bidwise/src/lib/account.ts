import { useSyncExternalStore } from 'react';
import type { AccountInfo, SectionPerms } from './api';
import { api } from './api';
import { isSignedIn, onSessionChange } from './auth';
import { readJSON, removeRaw, writeJSON } from './kv';

// The signed-in account: individual or organisation member (admin / member), and the
// sections it may use (Server UI/server/org_access.py). From the login / register
// response, refreshed from GET /client/me. Sections an organisation turned off are
// hidden in the app; the server leaves their data out too.

const ACCOUNT_KEY = 'bw.account';
export const ACCOUNT_KEYS = [ACCOUNT_KEY];

/** Every section on (an org admin). */
export const ALL_SECTIONS: SectionPerms = {
  active: true,
  archived: true,
  bookmarks: true,
  projects: true,
  portal_search: true,
};

/** The server's defaults: everything on except portal search, which is switched on per user. */
export const DEFAULT_SECTIONS: SectionPerms = {
  ...ALL_SECTIONS,
  portal_search: false,
};

/** Before the server says otherwise (demo mode, older servers): the defaults. */
export const DEFAULT_ACCOUNT: AccountInfo = {
  account_type: 'individual',
  org: null,
  permissions: DEFAULT_SECTIONS,
  pending_request: null,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

/** Only the fields the app uses, with missing sections at their defaults. */
function normalise(a: Partial<AccountInfo> | null | undefined): AccountInfo {
  if (!a) return DEFAULT_ACCOUNT;
  return {
    account_type:
      a.account_type === 'organisation' ? 'organisation' : 'individual',
    org: a.org ?? null,
    // A section the server leaves out takes its default (portal search: off).
    permissions: { ...DEFAULT_SECTIONS, ...(a.permissions ?? {}) },
    pending_request: a.pending_request ?? null,
  };
}

// Stored accounts from before a section existed get its default too.
let account: AccountInfo = normalise(readJSON(ACCOUNT_KEY, DEFAULT_ACCOUNT));

export const getAccount = () => account;

export function setAccount(a: Partial<AccountInfo> | null | undefined) {
  account = normalise(a);
  writeJSON(ACCOUNT_KEY, account);
  emit();
}

export function rehydrateAccount() {
  account = normalise(readJSON(ACCOUNT_KEY, DEFAULT_ACCOUNT));
  emit();
}

function clearAccount() {
  account = DEFAULT_ACCOUNT;
  removeRaw(ACCOUNT_KEY);
  emit();
}

// Signing out forgets the account (the next one may belong to an organisation).
onSessionChange(() => {
  if (!isSignedIn() && account !== DEFAULT_ACCOUNT) clearAccount();
});

/** Fetches the account from the server (launch, foreground, after an org change). */
export async function refreshAccount(): Promise<AccountInfo> {
  const me = await api.me();
  setAccount(me);
  return account;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const useAccount = () =>
  useSyncExternalStore(subscribe, getAccount, getAccount);

export type Access = SectionPerms & {
  isAdmin: boolean;
  account: AccountInfo;
};

/** Which sections to show, and whether this account administers its organisation. */
export function useAccess(): Access {
  const a = useAccount();
  return {
    ...a.permissions,
    isAdmin: a.org?.role === 'admin',
    account: a,
  };
}

/** "Individual", "Rakshit Infra · Admin", ... for the profile card. */
export function accountLabel(a: AccountInfo): string {
  if (!a.org) return 'Individual';
  return `${a.org.name} · ${a.org.role === 'admin' ? 'Admin' : 'Member'}`;
}
