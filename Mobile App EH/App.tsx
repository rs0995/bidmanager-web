import React from 'react';
import { StatusBar } from 'react-native';
import {
  EdgeInsets,
  SafeAreaInsetsContext,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { ToastProvider } from './src/components/ui';
import { AlertsProvider } from './src/fixtures/alerts';
import { BookmarksProvider } from './src/fixtures/bookmarks';
import { ProjectsProvider } from './src/fixtures/projects';
import { ThemeProvider, useTheme } from './src/theme';

const queryClient = new QueryClient();

function ThemedStatusBar() {
  const t = useTheme();
  return (
    <StatusBar
      barStyle={t.scheme === 'dark' ? 'light-content' : 'dark-content'}
    />
  );
}

type Props = {
  /** Browser preview only: fixed safe-area insets for a tall iPhone. */
  insetsOverride?: EdgeInsets;
  /** Browser preview only: device chrome (clock, battery, home indicator). */
  overlay?: React.ReactNode;
};

export default function App({ insetsOverride, overlay }: Props) {
  const tree = (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ThemedStatusBar />
        <ToastProvider>
          <BookmarksProvider>
            <ProjectsProvider>
              <AlertsProvider>
                <RootNavigator />
              </AlertsProvider>
            </ProjectsProvider>
          </BookmarksProvider>
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
