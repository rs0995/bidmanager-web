import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useToast } from '../feedback/Toast';

/**
 * Full-width update bar. Phase 1: a timed stand-in for the real update; Phase 2E wires
 * `syncNow`.
 */
export function SyncBar({
  initialStatus = 'Last synced 4 min ago',
}: {
  initialStatus?: string;
}) {
  const t = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const run = () => {
    setBusy(true);
    timer.current = setTimeout(() => {
      setBusy(false);
      setStatus('Synced just now · 3 new tenders');
      toast.show('Up to date — 3 new tenders');
    }, 900);
  };

  const tint = {
    backgroundColor: t.isGlass ? t.glass.fill : t.colors.accentWash,
    borderWidth: 1,
    borderColor: `${t.colors.accent}55`,
  };

  return (
    <Card elevation="md" style={[styles.card, tint]}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[styles.title, { color: t.colors.accentInk }]}>
            Sync tenders
          </Text>
          <Text style={[styles.sub, { color: t.colors.muted }]}>{status}</Text>
        </View>
        <Button
          label="Sync now"
          size="sm"
          loading={busy}
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
