import React, { createContext, useContext, useMemo, useState } from 'react';

// Phase 1 only: in-memory sign-in state and account. Replaced by lib/auth.ts
// (token in the keychain, /client/auth/*) in Phase 2.

export type Account = {
  name: string;
  initials: string;
  email: string;
  role: string;
  workspace: string;
};

export const sampleAccount: Account = {
  name: 'R. Shah',
  initials: 'RS',
  email: 'info@rakshitinfra.com',
  role: 'Workspace administrator',
  workspace: 'Rakshit Infra',
};

export type SignUpInput = {
  name: string;
  email: string;
  password: string;
  accountType: 'individual' | 'organisation';
  /** Required for an organisation: it is created with this account as its admin. */
  orgName?: string;
};

export type SessionCtx = {
  signedIn: boolean;
  account: Account;
  /** Rejects with a readable message (wrong password, offline...). */
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  /** Creates the account and signs in; rejects with the server's message. */
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => void;
};

export const SessionContext = createContext<SessionCtx>({
  signedIn: false,
  account: sampleAccount,
  signIn: async () => {},
  signUp: async () => {},
  signOut: () => {},
});

export function SessionProvider({
  children,
  initialSignedIn = false,
}: {
  children: React.ReactNode;
  initialSignedIn?: boolean;
}) {
  const [signedIn, setSignedIn] = useState(initialSignedIn);
  const value = useMemo<SessionCtx>(
    () => ({
      signedIn,
      account: sampleAccount,
      signIn: async () => setSignedIn(true),
      signUp: async () => setSignedIn(true),
      signOut: () => setSignedIn(false),
    }),
    [signedIn],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
