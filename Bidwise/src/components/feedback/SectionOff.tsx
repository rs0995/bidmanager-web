import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Lock } from 'lucide-react-native';
import { Card, IconButton, Screen } from '../ui';
import { useAccess } from '../../lib/account';
import type { SectionPerms } from '../../lib/api';
import { fonts, useTheme } from '../../theme';

/**
 * Shown in place of a page whose section the organisation turned off while it was
 * open (the way in is already hidden).
 */
export function SectionOff() {
  const t = useTheme();
  const navigation = useNavigation();
  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <Card style={styles.card}>
        <Lock size={32} color={t.colors.muted} strokeWidth={1.6} />
        <Text style={[styles.title, { color: t.colors.ink }]}>
          Not available
        </Text>
        <Text style={[styles.body, { color: t.colors.muted }]}>
          Your organisation has turned this section off for your account.
        </Text>
      </Card>
    </Screen>
  );
}

/** The page, or SectionOff when the account may not use `section`. */
export function gated<P extends object>(
  section: keyof SectionPerms,
  Page: React.ComponentType<P>,
) {
  function Gated(props: P) {
    return useAccess()[section] ? <Page {...props} /> : <SectionOff />;
  }
  Gated.displayName = `Gated(${section})`;
  return Gated;
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  card: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  title: { fontFamily: fonts.semibold, fontSize: 15 },
  body: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
});
