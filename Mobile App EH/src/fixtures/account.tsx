import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// Phase 1 only: an in-memory account and app-lock flag. Replaced by lib/auth.ts (tokens in
// the Keychain, 401/403 handling) in Phase 2B and lib/appLock.ts (Face ID) in Phase 2G.

export type User = { name: string; email: string };

type Ctx = {
  user: User | null;
  signIn: (email: string, name?: string) => void;
  signOut: () => void;
  appLock: boolean;
  setAppLock: (on: boolean) => void;
};

const AccountContext = createContext<Ctx>({
  user: null,
  signIn: () => {},
  signOut: () => {},
  appLock: false,
  setAppLock: () => {},
});

const seedUser: User = {
  name: 'Rakshit Infra',
  email: 'you@rakshitinfra.com',
};

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(seedUser);
  const [appLock, setAppLock] = useState(false);

  const signIn = useCallback((email: string, name?: string) => {
    setUser({ name: name?.trim() || seedUser.name, email: email.trim() });
  }, []);
  const signOut = useCallback(() => {
    setUser(null);
    setAppLock(false);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ user, signIn, signOut, appLock, setAppLock }),
    [user, signIn, signOut, appLock],
  );
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export const useAccount = () => useContext(AccountContext);
