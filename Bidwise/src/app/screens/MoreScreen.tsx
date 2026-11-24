import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Archive,
  Bell,
  Building2,
  SearchCheck,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Fingerprint,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldQuestion,
  SunMoon,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react-native';
import {
  Button,
  Card,
  Field,
  PageTitle,
  Screen,
  Sheet,
  useToast,
} from '../../components/ui';
import { Spinning } from '../../components/ui/motion';
import {
  SettingsRow,
  SettingsSection,
} from '../../components/more/SettingsRow';
import { useCaptcha } from '../../fixtures/captcha';
import { useSession } from '../../fixtures/session';
import { relativeTime, useActions } from '../../data/actions';
import { useDocs } from '../../data/docs';
import { fonts, useTheme } from '../../theme';
import { accountLabel, useAccess } from '../../lib/account';
import { ThemeControls } from '../../components/more/ThemeControls';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'More'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Connection = 'idle' | 'checking' | 'reachable' | 'unreachable';

// Kept here too: other screens import it from More.
export { relativeTime };

export function MoreScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation<Nav>();
  const { account, signOut } = useSession();
  const { pending: captchaPending } = useCaptcha();
  const access = useAccess();
  const org = access.account.org;
  const orgState = org
    ? org.role === 'admin'
      ? 'Admin'
      : 'Member'
    : access.account.pending_request
    ? 'Request pending'
    : 'Individual';

  const actions = useActions();
  const { lastSyncAt, syncing } = actions;
  const [connection, setConnection] = useState<Connection>('idle');
  const [lockBusy, setLockBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const sync = () => {
    actions
      .sync()
      .then(() => toast.show('Synced'))
      .catch(e => toast.show(`Sync failed: ${(e as Error).message}`));
  };
  const checkConnection = () => {
    setConnection('checking');
    actions
      .checkConnection()
      .then(ok => setConnection(ok ? 'reachable' : 'unreachable'))
      .catch(() => setConnection('unreachable'));
  };
  const docs = useDocs();
  const dl = docs.useDownloads();
  const changePassword = () => {
    if (!pw.current || pw.next.length < 6) {
      toast.show('Enter your current password and a new one of 6+ characters');
      return;
    }
    setPwBusy(true);
    actions
      .changePassword(pw.current, pw.next)
      .then(() => {
        setPwOpen(false);
        setPw({ current: '', next: '' });
        toast.show('Password changed');
      })
      .catch(e =>
        toast.show(`Couldn’t change password: ${(e as Error).message}`),
      )
      .finally(() => setPwBusy(false));
  };
  // As in BM Pro: nothing reloads after clearing until the user taps Sync tenders.
  const clearCache = () => {
    setClearOpen(false);
    actions.clearCache();
    toast.show('Cache cleared — tap Sync tenders to reload');
  };

  const active = dl.active;
  const icon = (I: typeof Bell, color = t.colors.accent) => (
    <I size={17} color={color} />
  );
  const chevron = <ChevronRight size={17} color={t.colors.muted} />;
  const toggle = (
    value: boolean,
    onChange: (v: boolean) => void,
    label: string,
  ) => (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onChange}
      trackColor={{ true: t.colors.accent, false: t.colors.surfaceSunk }}
      thumbColor="#ffffff"
      ios_backgroundColor={t.colors.surfaceSunk}
    />
  );
  const connectionText: Record<Connection, string> = {
    idle: 'Tap to check',
    checking: 'Checking…',
    reachable: 'Reachable',
    unreachable: 'Unreachable',
  };

  return (
    <Screen tabBar>
      <PageTitle sub="Sync, connection & workspace">More</PageTitle>

      <View style={styles.accountTop}>
        <Card padding={16} radius="lg" elevation="sm">
          <View style={styles.profile}>
            <View style={[styles.avatar, { backgroundColor: t.colors.tint }]}>
              <Text style={[styles.avatarText, { color: t.colors.deep }]}>
                {account.initials}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text style={[styles.name, { color: t.colors.ink }]}>
                {account.name}
              </Text>
              <Text style={[styles.email, { color: t.colors.muted }]}>
                {account.email}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.accountType, { color: t.colors.accentInk }]}
              >
                {accountLabel(access.account)}
              </Text>
            </View>
          </View>
          <View style={styles.accountActions}>
            <View style={styles.flex}>
              <Button
                label="Change password"
                variant="secondary"
                size="sm"
                block
                icon={<KeyRound size={14} color={t.colors.ink} />}
                onPress={() => setPwOpen(true)}
              />
            </View>
            <View style={styles.flex}>
              <Button
                label="Sign out"
                variant="danger"
                size="sm"
                block
                icon={<LogOut size={14} color={t.colors.crit} />}
                onPress={signOut}
              />
            </View>
          </View>
        </Card>
      </View>

      <SettingsSection title="Sync & connection">
        <SettingsRow
          icon={<Spinning spinning={syncing}>{icon(RefreshCw)}</Spinning>}
          title="Sync tenders"
          value={syncing ? 'Syncing…' : relativeTime(lastSyncAt)}
          disabled={syncing}
          onPress={sync}
        />
        <SettingsRow
          icon={icon(connection === 'unreachable' ? WifiOff : Wifi)}
          title="Connection"
          value={connectionText[connection]}
          onPress={checkConnection}
        />
        <SettingsRow
          icon={icon(SunMoon)}
          title="Theme"
          below={<ThemeControls />}
        />
        {access.archived ? (
          <SettingsRow
            icon={icon(Archive)}
            title="Archive"
            sub="Closed tenders"
            right={chevron}
            onPress={() => navigation.navigate('Archive')}
          />
        ) : null}
        <SettingsRow
          icon={icon(Download)}
          title="Downloads"
          value={active ? `${active} in progress` : undefined}
          right={chevron}
          onPress={() => navigation.navigate('Downloads')}
          last
        />
      </SettingsSection>

      <SettingsSection title="Workspace">
        <SettingsRow
          icon={icon(Building2)}
          title="Organisation"
          sub={org ? org.name : 'Create or join one'}
          value={orgState}
          right={chevron}
          onPress={() => navigation.navigate('Organisation')}
        />
        {access.portal_search ? (
          <SettingsRow
            icon={icon(SearchCheck)}
            title="Search on portal"
            sub="Find a tender by ID on a NIC portal"
            right={chevron}
            onPress={() => navigation.navigate('PortalSearch')}
          />
        ) : null}
        <SettingsRow
          icon={icon(FileSpreadsheet)}
          title="Export tenders (CSV)"
          sub="Bookmarked, in projects, or by organisation"
          right={chevron}
          onPress={() => navigation.navigate('Export')}
        />
        <SettingsRow
          icon={icon(ShieldQuestion)}
          title="Captcha"
          sub={captchaPending ? 'One is waiting for you' : 'Nothing waiting'}
          right={
            <View style={styles.rowEnd}>
              {captchaPending ? (
                <View
                  accessibilityLabel="Captcha waiting"
                  style={[styles.dot, { backgroundColor: t.colors.crit }]}
                />
              ) : null}
              {chevron}
            </View>
          }
          onPress={() => navigation.navigate('Captcha')}
        />
        <SettingsRow
          icon={icon(Fingerprint)}
          title="App lock"
          sub="Face ID to open bidwise"
          right={toggle(
            actions.appLockEnabled,
            v => {
              if (lockBusy) return;
              setLockBusy(true);
              actions
                .setAppLock(v)
                .then(() =>
                  toast.show(v ? 'App lock enabled' : 'App lock disabled'),
                )
                .catch(e => toast.show((e as Error).message))
                .finally(() => setLockBusy(false));
            },
            'App lock',
          )}
        />
        <SettingsRow
          icon={icon(Bell)}
          title="Push notifications & Alerts"
          sub="New tenders, updates and closing reminders"
          right={chevron}
          onPress={() => navigation.navigate('NotificationSettings')}
          last
        />
      </SettingsSection>

      <SettingsSection title="Storage">
        <SettingsRow
          icon={icon(Trash2, t.colors.crit)}
          tone="danger"
          title="Clear local cache"
          right={chevron}
          onPress={() => setClearOpen(true)}
          last
        />
      </SettingsSection>

      <Text style={[styles.footnote, { color: t.colors.muted }]}>
        Bookmarks and projects sync to your account. Attached documents and app
        lock stay on this device only.
      </Text>
      <Text style={[styles.version, { color: t.colors.muted }]}>
        bidwise · v0.1
      </Text>

      <Sheet
        visible={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Change password"
      >
        <Field
          label="Current password"
          secureTextEntry
          value={pw.current}
          onChangeText={v => setPw(p => ({ ...p, current: v }))}
          textContentType="password"
        />
        <Field
          label="New password"
          secureTextEntry
          value={pw.next}
          onChangeText={v => setPw(p => ({ ...p, next: v }))}
          textContentType="newPassword"
        />
        <Button
          label="Save password"
          block
          loading={pwBusy}
          onPress={changePassword}
        />
      </Sheet>

      <Sheet
        visible={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear local cache?"
      >
        <Text style={[styles.sheetBody, { color: t.colors.inkSoft }]}>
          Removes bookmarks, projects, downloaded files, alerts, and the
          organisations and tenders fetched to this device. Nothing is deleted
          from your account. Nothing reloads or syncs until you tap Sync
          tenders.
        </Text>
        <View style={styles.sheetActions}>
          <View style={styles.flex}>
            <Button
              label="Cancel"
              variant="secondary"
              block
              onPress={() => setClearOpen(false)}
            />
          </View>
          <View style={styles.flex}>
            <Button
              label="Clear cache"
              variant="danger"
              block
              onPress={clearCache}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.bold, fontSize: 15 },
  name: {
    fontFamily: fonts.displaySemibold,
    fontSize: 17,
    letterSpacing: -0.4,
  },
  email: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  accountType: { fontFamily: fonts.semibold, fontSize: 11.5, marginTop: 4 },
  accountTop: { marginBottom: 2 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  accountActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  footnote: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 18,
    marginHorizontal: 4,
  },
  version: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    fontSize: 11,
    marginTop: 14,
  },
  sheetBody: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  sheetActions: { flexDirection: 'row', gap: 10 },
});
