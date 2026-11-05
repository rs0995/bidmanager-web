import React, { useEffect, useState } from 'react';
import { StatusBar, View } from 'react-native';
import {
  EdgeInsets,
  SafeAreaInsetsContext,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { ToastProvider } from './src/components/ui';
import { ActionsProvider } from './src/data/actions';
import { BidPackProvider } from './src/data/bidPack';
import { DocsProvider } from './src/data/docs';
import { TenderSourceProvider } from './src/data/tenderSource';
import { AlertsProvider } from './src/fixtures/alerts';
import { BookmarksProvider } from './src/fixtures/bookmarks';
import { CaptchaProvider } from './src/fixtures/captcha';
import { NotifySettingsProvider } from './src/fixtures/notifySettings';
import { ProjectsProvider } from './src/fixtures/projects';
import { SessionProvider } from './src/fixtures/session';
import { bootstrapLive } from './src/lib/bootstrap';
import {
  createQueryClient,
  queryClient as liveQueryClient,
} from './src/lib/queryClient';
import { LiveProviders } from './src/live/LiveProviders';
import { LockGate } from './src/live/LockGate';
import { ThemeProvider, useTheme } from './src/theme';
import { useThemeContext } from './src/theme/ThemeProvider';

export type AppMode = 'live' | 'demo';

function ThemedStatusBar() {
  const t = useTheme();
  return (
    <StatusBar
      barStyle={t.scheme === 'dark' ? 'light-content' : 'dark-content'}
    />
  );
}

/** Live mode: wait for device storage and the keychain before the first screen. */
function BootGate({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  // Also wait for the saved theme, so the first screen doesn't draw in the defaults
  // and then repaint.
  const { loaded } = useThemeContext();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    bootstrapLive()
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  if (!ready || !loaded)
    return <View style={{ flex: 1, backgroundColor: t.colors.bg }} />;
  return <>{children}</>;
}

function DemoData({
  signedIn,
  children,
}: {
  signedIn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider initialSignedIn={signedIn}>
      <BookmarksProvider>
        <ProjectsProvider>
          <AlertsProvider>
            <CaptchaProvider>
              <NotifySettingsProvider>{children}</NotifySettingsProvider>
            </CaptchaProvider>
          </AlertsProvider>
        </ProjectsProvider>
      </BookmarksProvider>
    </SessionProvider>
  );
}

function LiveData({ children }: { children: React.ReactNode }) {
  return (
    <BootGate>
      <LiveProviders>{children}</LiveProviders>
    </BootGate>
  );
}

type Props = {
  /**
   * `live` (the phone) talks to the server. `demo` runs on the sample data: the browser
   * preview (the server doesn't accept browser requests) and tests.
   */
  mode?: AppMode;
  /** Browser preview only: fixed safe-area insets for a tall iPhone. */
  insetsOverride?: EdgeInsets;
  /** Browser preview only: device chrome (clock, battery, home indicator). */
  overlay?: React.ReactNode;
  /** Demo mode: start signed in. */
  signedIn?: boolean;
};

export default function App({
  mode = 'live',
  insetsOverride,
  overlay,
  signedIn,
}: Props) {
  // One client per app instance; demo mode gets its own so tests never share caches.
  const [client] = useState(() =>
    mode === 'live' ? liveQueryClient : createQueryClient(),
  );
  const tree = (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ThemedStatusBar />
        <ToastProvider>
          <TenderSourceProvider mode={mode}>
            <DocsProvider mode={mode}>
              <BidPackProvider mode={mode}>
              {mode === 'live' ? (
                <LiveData>
                  <ActionsProvider mode="live">
                    <LockGate>
                      <RootNavigator />
                    </LockGate>
                  </ActionsProvider>
                </LiveData>
              ) : (
                <DemoData signedIn={signedIn}>
                  <ActionsProvider mode="demo">
                    <RootNavigator />
                  </ActionsProvider>
                </DemoData>
              )}
              </BidPackProvider>
            </DocsProvider>
          </TenderSourceProvider>
        </ToastProvider>
        {overlay}
      </ThemeProvider>
    </QueryClientProvider>
  );

  return (
    <SafeAreaProvider>
      {insetsOverride ? (
        <SafeAreaInsetsContext.Provider value={insetsOverride}>
          {tree}
        </SafeAreaInsetsContext.Provider>
      ) : (
        tree
      )}
    </SafeAreaProvider>
  );
}
