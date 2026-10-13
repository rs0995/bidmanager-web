import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Bell,
  Download,
  Fingerprint,
  Lock,
  Monitor,
  Moon,
  Palette,
  Sun,
  Trash2,
  User,
} from 'lucide-react-native';
import { SettingsRow } from '../../components/more/SettingsRow';
import {
  Button,
  Card,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Sheet,
  Toggle,
  useToast,
} from '../../components/ui';
import { useAccount } from '../../fixtures/account';
import { useAlerts } from '../../fixtures/alerts';
import { useDownloads } from '../../fixtures/downloads';
import {
  ACCENTS,
  fonts,
  ThemeMode,
  useTheme,
  useThemePrefs,
} from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/** Settings: account, appearance, deadline reminders, downloads, app lock, cache. */
export function MoreScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toast = useToast();
  const { user, appLock, setAppLock } = useAccount();
  const { remindersOn, setRemindersOn } = useAlerts();
  const { active } = useDownloads();
  const { prefs, setPrefs } = useThemePrefs();
  const [confirmClear, setConfirmClear] = useState(false);

  const toggleReminders = (on: boolean) => {
    setRemindersOn(on);
    toast.show(on ? 'Deadline reminders on' : 'Deadline reminders off');
  };
  const toggleLock = (on: boolean) => {
    setAppLock(on);
    toast.show(on ? 'App lock enabled' : 'App lock disabled');
  };

  return (
    <Screen tabBar>
      <ScreenHeader title="More" subtitle="Account, appearance and reminders" />

      <Text style={[styles.label, { color: t.colors.muted }]}>APPEARANCE</Text>
      <View style={styles.mode}>
        <SegmentedControl<ThemeMode>
          options={[
            { key: 'dark', label: 'Dark', icon: Moon },
            { key: 'light', label: 'Light', icon: Sun },
            { key: 'system', label: 'System', icon: Monitor },
          ]}
          value={prefs.mode}
          onChange={mode => setPrefs({ mode })}
        />
      </View>

      <Card padding={0} elevation="sm" style={styles.group}>
        <SettingsRow
          divider
          icon={User}
          label="Account"
          value={user?.name}
          onPress={() => navigation.navigate('Account')}
        />
        <SettingsRow
          divider
          icon={Palette}
          label="Colours & style"
          value={`${ACCENTS[prefs.accent].label} · ${
            prefs.style === 'glass' ? 'Glass' : 'Solid'
          }`}
          onPress={() => navigation.navigate('Appearance')}
        />
        <SettingsRow
          icon={Bell}
          label="Deadline reminders"
          sub="Notifications 72h, 24h and 3h before a tender closes"
          right={
            <Toggle
              value={remindersOn}
              onValueChange={toggleReminders}
              accessibilityLabel="Deadline reminders"
            />
          }
        />
      </Card>

      <Card padding={0} elevation="sm" style={styles.group}>
        <SettingsRow
          divider
          icon={Download}
          label="Downloads"
          value={active ? `${active} in progress` : undefined}
          onPress={() => navigation.navigate('Downloads')}
        />
        <SettingsRow
          divider
          icon={Fingerprint}
          label="App lock"
          sub="Ask for Face ID when the app opens"
          right={
            <Toggle
              value={appLock}
              onValueChange={toggleLock}
              accessibilityLabel="App lock"
            />
          }
        />
        {appLock ? (
          <SettingsRow
            divider
            icon={Lock}
            label="Lock now"
            onPress={() => navigation.navigate('AppLock')}
          />
        ) : null}
        <SettingsRow
          icon={Trash2}
          label="Clear local cache"
          onPress={() => setConfirmClear(true)}
        />
      </Card>

      <Text style={[styles.note, { color: t.colors.muted }]}>
        Bookmarks and projects sync to your account. Attached documents and app
        lock stay on this device only.
      </Text>

      <Sheet
        visible={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear local cache?"
      >
        <Text style={[styles.sheetText, { color: t.colors.muted }]}>
          Removes downloaded document info, alerts and other data cached on this
          device. Nothing is deleted from your account — bookmarks and projects
          are restored from the cloud right after.
        </Text>
        <View style={styles.sheetButtons}>
          <View style={styles.half}>
            <Button
              block
              variant="secondary"
              label="Cancel"
              onPress={() => setConfirmClear(false)}
            />
          </View>
          <View style={styles.half}>
            <Button
              block
              variant="danger"
              label="Clear cache"
              onPress={() => {
                setConfirmClear(false);
                toast.show('Cache cleared');
              }}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.bold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  mode: { marginBottom: 16 },
  group: { marginBottom: 12, overflow: 'hidden' },
  note: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    marginHorizontal: 4,
  },
  sheetText: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20 },
  sheetButtons: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});
