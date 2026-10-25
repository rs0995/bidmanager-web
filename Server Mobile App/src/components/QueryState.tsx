import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AlertTriangle, KeyRound } from 'lucide-react-native';
import type { RootStackParamList } from '../app/navigation/types';
import { useSession } from '../state/session';
import { useTheme } from '../theme';
import { Button, Card, Txt } from './ui';

type Props = {
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** What is being loaded, e.g. "jobs". */
  what: string;
};

/**
 * Loading / error block shown in place of a screen's content until its first
 * response arrives. Renders nothing once data is in.
 */
export function QueryState({ loading, error, onRetry, what }: Props) {
  const t = useTheme();
  const { adminKey } = useSession();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Queries don't run without a key, so say so instead of loading forever.
  if (!adminKey) {
    return (
      <Card>
        <View style={styles.loading}>
          <KeyRound size={22} color={t.colors.ink3} />
          <Txt color="ink2" style={styles.loadingText}>
            Enter the admin key to load {what}.
          </Txt>
          <Button label="Connect" size="sm" variant="primary" onPress={() => nav.navigate('Connect')} />
        </View>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <View
          style={[
            styles.error,
            { backgroundColor: t.colors.warnSoft, borderColor: t.colors.warnLine },
          ]}
        >
          <AlertTriangle size={14} color={t.colors.warn} />
          <Txt variant="small" color="warn" style={styles.flex}>
            {error.message || `Could not load ${what}`}
          </Txt>
        </View>
        <Button label="Try again" size="sm" onPress={onRetry} />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <View style={styles.loading}>
          <ActivityIndicator color={t.colors.ink3} />
          <Txt color="ink2" style={styles.loadingText}>
            Loading {what}…
          </Txt>
        </View>
      </Card>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  loadingText: { fontSize: 13 },
});
