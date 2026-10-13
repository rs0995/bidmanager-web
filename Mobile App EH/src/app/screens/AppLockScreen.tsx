import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Fingerprint } from 'lucide-react-native';
import { Button, Screen } from '../../components/ui';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/**
 * The lock screen. Phase 1: "Unlock" just closes it. Phase 2G asks for Face ID and shows
 * this on launch and when the app returns from the background.
 */
export function AppLockScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Screen scroll={false} noTopInset>
      <View style={styles.center}>
        <View style={[styles.badge, { backgroundColor: t.colors.accentWash }]}>
          <Fingerprint size={40} color={t.colors.accentInk} />
        </View>
        <Text style={[styles.title, { color: t.colors.ink }]}>
          BidManager is locked
        </Text>
        <Text style={[styles.sub, { color: t.colors.muted }]}>
          Unlock with Face ID to continue.
        </Text>
        <View style={styles.action}>
          <Button
            block
            label="Unlock"
            icon={<Fingerprint size={17} color={t.colors.onAccent} />}
            onPress={() => navigation.goBack()}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  title: { fontFamily: fonts.extrabold, fontSize: 20, letterSpacing: -0.3 },
  sub: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 6 },
  action: { alignSelf: 'stretch', marginTop: 28 },
});
