import React from 'react';
import { AppState, Platform, StatusBar } from 'react-native';
import {
  EdgeInsets,
  SafeAreaInsetsContext,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { ToastProvider } from './src/components/ui';
import { SessionProvider } from './src/state/session';
import { ThemeProvider } from './src/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

// Pause every poll while the app is in the background (the browser preview
// already gets this from page visibility).
if (Platform.OS !== 'web') {
  focusManager.setEventListener(onFocus => {
    const sub = AppState.addEventListener('change', s => onFocus(s === 'active'));
    return () => sub.remove();
  });
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
        <StatusBar barStyle="dark-content" />
        <SessionProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </SessionProvider>
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
