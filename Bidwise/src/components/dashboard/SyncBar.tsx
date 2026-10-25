import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useToast } from '../feedback/Toast';
import { SYNC_STALE_MS, syncTime, useActions } from '../../data/actions';

/**
 * Full-width update bar: runs the same Sync tenders action as More. As BM Pro: "Up to
 * date" with the exact last sync time, turning into a "Sync tenders" prompt after 30
 * minutes without one.
 */
export function SyncBar() {
  const t = useTheme();
  const toast = useToast();
  const { sync, syncing, lastSyncAt } = useActions();
  // Re-check staleness every minute while the card is on screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const stale = lastSyncAt === null || now - lastSyncAt > SYNC_STALE_MS;
  const status = lastSyncAt
    ? `Last synced ${syncTime(lastSyncAt)}`
    : 'Never synced yet';

  const run = () => {
    sync()
      .then(() => toast.show('Up to date'))
      .catch(e => toast.show(`Sync failed: ${(e as Error).message}`));
  };

  const tint = stale
    ? {
        backgroundColor: t.isGlass ? t.glass.fill : t.colors.accentWash,
        borderWidth: 1,
        borderColor: `${t.colors.accent}55`,
      }
    : {
        backgroundColor: t.isGlass ? t.glass.fill : t.colors.surface,
        borderWidth: 1,
        borderColor: t.isGlass ? t.glass.border : t.colors.hair,
      };

  return (
    <Card elevation="md" style={[styles.card, tint]}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text
            style={[
              styles.title,
              { color: stale ? t.colors.accentInk : t.colors.ink },
            ]}
          >
            {stale ? 'Sync tenders' : 'Up to date'}
          </Text>
          <Text style={[styles.sub, { color: t.colors.muted }]}>{status}</Text>
        </View>
        <Button
          label="Sync now"
          size="sm"
          loading={syncing}
          icon={<RefreshCw size={15} color={t.colors.onAccent} />}
          onPress={run}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  text: { flex: 1 },
  title: { fontFamily: fonts.bold, fontSize: 15 },
  sub: { fontFamily: fonts.regular, fontSize: 12.5, marginTop: 3 },
});
