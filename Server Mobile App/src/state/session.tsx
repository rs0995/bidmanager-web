import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_ADMIN_KEY } from '../lib/adminKey.local';
import { Api, createApi } from '../lib/api';
import { ENVIRONMENTS, EnvKey } from '../lib/environments';
import { secureStorage } from '../platform';

// Connection state for the whole app: which server, the admin key, whether the
// server answers, and how many captchas are waiting. Mirrors the desktop header:
// health every 15 s, captcha queue every 8 s (react-query pauses both while the
// app is in the background — see focusManager in App.tsx).

export type ConnectionStatus = 'checking' | 'connected' | 'disconnected';

const PROFILE_KEY = 'bm.admin.profile.v1';
const ADMIN_KEY = 'adminKey';

type Profile = { env: EnvKey; bases: Record<EnvKey, string> };

const DEFAULT_PROFILE: Profile = {
  env: 'prod',
  bases: { prod: ENVIRONMENTS.prod.base, staging: ENVIRONMENTS.staging.base },
};

type Session = {
  /** false until the saved profile and key have been read. */
  ready: boolean;
  env: EnvKey;
  base: string;
  adminKey: string;
  api: Api;
  status: ConnectionStatus;
  /** Last connection error, shown on the Connect screen. */
  error: string;
  pendingCaptchas: number;
  connect: (env: EnvKey, base: string, adminKey: string) => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [adminKey, setAdminKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [raw, key] = await Promise.all([
        AsyncStorage.getItem(PROFILE_KEY).catch(() => null),
        secureStorage.get(ADMIN_KEY).catch(() => null),
      ]);
      if (cancelled) return;
      if (raw) {
        try {
          const saved = JSON.parse(raw) as Partial<Profile>;
          setProfile({
            env: saved.env === 'staging' ? 'staging' : 'prod',
            bases: { ...DEFAULT_PROFILE.bases, ...saved.bases },
          });
        } catch {
          // corrupt profile: keep defaults
        }
      }
      // Like the default URL: the local default key applies until one is saved.
      setAdminKey(key || DEFAULT_ADMIN_KEY);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const base = profile.bases[profile.env];
  const api = useMemo(() => createApi(base, adminKey), [base, adminKey]);
  const enabled = ready && !!adminKey;

  const health = useQuery({
    queryKey: [base, 'health'],
    queryFn: () => api.health(),
    enabled,
    refetchInterval: 15_000,
    retry: false,
  });

  const captchas = useQuery({
    queryKey: [base, 'captchas'],
    queryFn: () => api.captchas(),
    enabled: enabled && health.isSuccess,
    refetchInterval: 8_000,
  });

  const status: ConnectionStatus = !adminKey
    ? 'disconnected'
    : health.isError
    ? 'disconnected'
    : health.isSuccess
    ? 'connected'
    : 'checking';

  const connect = useCallback(
    async (env: EnvKey, nextBase: string, key: string) => {
      const next: Profile = {
        env,
        bases: { ...profile.bases, [env]: nextBase.replace(/\/+$/, '') },
      };
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      await secureStorage.set(ADMIN_KEY, key);
      // Drop everything cached for the previous server / key.
      queryClient.removeQueries();
      setProfile(next);
      setAdminKey(key);
    },
    [profile.bases, queryClient],
  );

  const value = useMemo<Session>(
    () => ({
      ready,
      env: profile.env,
      base,
      adminKey,
      api,
      status,
      error: health.error ? (health.error as Error).message : '',
      pendingCaptchas: captchas.data?.length ?? 0,
      connect,
    }),
    [ready, profile.env, base, adminKey, api, status, health.error, captchas.data, connect],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
