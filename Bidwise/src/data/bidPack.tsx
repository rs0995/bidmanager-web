import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { files } from '../platform';
import { bidPackApi } from '../lib/bidPack';
import type { BidAgentStatus, BidPack } from '../lib/bidPack';
import { demoBidAgentStatus, demoBidPack, demoBidPackLogs } from '../fixtures/bidPack';

// Bid packs for a tender: demo mode plays back a sample, live mode asks the server
// (POST to prepare, then polls while it runs) and opens files in QuickLook.

export type BidPackHandle = {
  pack: BidPack | null;
  loading: boolean;
  error: string | null;
  /** Starts (or restarts) preparation on the server. */
  prepare: () => Promise<void>;
  /** Downloads a generated file and opens it; resolves with a message to show, if any. */
  open: (name: string) => Promise<string | void>;
};

type Source = {
  useStatus: () => BidAgentStatus | undefined;
  useBidPack: (tenderId: string) => BidPackHandle;
};

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function useDemoBidPack(tenderId: string): BidPackHandle {
  const [pack, setPack] = useState<BidPack | null>(
    tenderId ? { ...demoBidPack } : null,
  );
  const busy = useRef(false);
  return {
    pack,
    loading: false,
    error: null,
    prepare: async () => {
      if (busy.current) return;
      busy.current = true;
      for (let i = 1; i <= demoBidPackLogs.length; i += 1) {
        setPack({ ...demoBidPack, status: 'running', logs: demoBidPackLogs.slice(0, i), result: null, files: [] });
        await wait(350);
      }
      setPack({ ...demoBidPack, updated_at: Date.now() / 1000 });
      busy.current = false;
    },
    open: async name => `“${name}” opens on the phone.`,
  };
}

const demoSource: Source = {
  useStatus: () => demoBidAgentStatus,
  useBidPack: useDemoBidPack,
};

function useLiveBidPack(tenderId: string): BidPackHandle {
  const qc = useQueryClient();
  const key = ['bidPack', tenderId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => bidPackApi.get(tenderId),
    enabled: Boolean(tenderId),
    refetchInterval: query =>
      (query.state.data as BidPack | undefined)?.status === 'running' ? 1500 : false,
  });
  return {
    pack: q.data ?? null,
    loading: q.isLoading,
    error: q.error ? (q.error as Error).message : null,
    prepare: async () => {
      const r = await bidPackApi.start(tenderId);
      qc.setQueryData(key, r);
    },
    open: async name => {
      const path = await bidPackApi.download(tenderId, name);
      await files.open(path);
    },
  };
}

function useLiveStatus() {
  return useQuery({
    queryKey: ['bidAgentStatus'],
    queryFn: bidPackApi.status,
    staleTime: 5 * 60 * 1000,
  }).data;
}

const liveSource: Source = {
  useStatus: useLiveStatus,
  useBidPack: useLiveBidPack,
};

const BidPackContext = createContext<Source | null>(null);

export function BidPackProvider({
  mode,
  children,
}: {
  mode: 'demo' | 'live';
  children: React.ReactNode;
}) {
  const value = useMemo(() => (mode === 'live' ? liveSource : demoSource), [mode]);
  return <BidPackContext.Provider value={value}>{children}</BidPackContext.Provider>;
}

export function useBidPackSource(): Source {
  const ctx = useContext(BidPackContext);
  if (!ctx) throw new Error('useBidPackSource must be used inside BidPackProvider');
  return ctx;
}
