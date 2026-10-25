import React, { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Bell,
  BellOff,
  Building2,
  ChevronLeft,
  CircleCheck,
  Clock,
  FileText,
  RefreshCw,
} from 'lucide-react-native';
import {
  Card,
  IconButton,
  PageTitle,
  Screen,
  useToast,
} from '../../components/ui';
import { Spinning } from '../../components/ui/motion';
import {
  SettingsRow,
  SettingsSection,
} from '../../components/more/SettingsRow';
import {
  DAY_THRESHOLDS,
  useNotifySettings,
} from '../../fixtures/notifySettings';
import { relativeTime, useActions } from '../../data/actions';
import {
  getPushPermission,
  requestPushPermission,
} from '../../lib/pushRegistration';
import type { PushPermission } from '../../platform/push';
import { fonts, useTheme } from '../../theme';

const DAY_LABEL: Record<number, string> = {
  1: '1 day before',
  2: '2 days before',
  3: '3 days before',
  5: '5 days before',
};

export function NotificationSettingsScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const { settings, set, toggleDay } = useNotifySettings();
  const { sync, syncing, lastSyncAt } = useActions();
  const [permission, setPermission] = useState<PushPermission>('undetermined');

  const refresh = useCallback(() => {
    getPushPermission()
      .then(setPermission)
      .catch(() => {});
  }, []);
  // Re-read on open and when coming back from iOS Settings.
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const allow = () => {
    if (permission === 'denied') {
      Linking.openSettings().catch(() => {});
      return;
    }
    requestPushPermission()
      .then(granted => {
        refresh();
        if (!granted) toast.show('Notifications stay off on this phone');
      })
      .catch(() => {});
  };

  // Turning an alert on is when it makes sense to ask for permission.
  const askIfNeeded = (on: boolean) => {
    if (on && permission === 'undetermined') allow();
  };

  /** Runs the same check the server does, now (sync plus alerts). */
  const checkNow = () => {
    sync()
      .then(() => toast.show('Checked for new tenders and updates'))
      .catch(e => toast.show(`Couldn’t check: ${(e as Error).message}`));
  };

  const status = {
    granted: {
      Icon: CircleCheck,
      color: t.colors.good,
      title: 'Notifications: On',
      body: 'Alerts arrive on this phone even when Bidwise is closed. You can change this any time in iOS Settings.',
      action: null as string | null,
    },
    denied: {
      Icon: BellOff,
      color: t.colors.crit,
      title: 'Notifications: Off',
      body: 'Notifications are turned off for Bidwise in iOS Settings, so the alerts below only show inside the app.',
      action: 'Open Settings',
    },
    undetermined: {
      Icon: Bell,
      color: t.colors.accent,
      title: 'Notifications: Not set up',
      body: 'Allow notifications to get the alerts below on this phone, even when Bidwise is closed.',
      action: 'Allow notifications',
    },
  }[permission];

  const icon = (I: typeof Clock) => <I size={17} color={t.colors.accent} />;
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

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle>Push notifications</PageTitle>

      <Card padding={14} radius="lg" elevation="sm">
        <View style={styles.statusRow}>
          <status.Icon size={16} color={status.color} />
          <Text style={[styles.statusTitle, { color: t.colors.ink }]}>
            {status.title}
          </Text>
        </View>
        <Text style={[styles.statusBody, { color: t.colors.muted }]}>
          {status.body} Last checked {relativeTime(lastSyncAt)}.
        </Text>
        <View style={styles.actions}>
          {status.action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={status.action}
              onPress={allow}
              style={[styles.check, { backgroundColor: t.colors.accent }]}
            >
              <Text style={[styles.checkText, { color: t.colors.onAccent }]}>
                {status.action}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check now"
            onPress={checkNow}
            disabled={syncing}
            style={[styles.check, { backgroundColor: t.colors.accentWash }]}
          >
            <Spinning spinning={syncing}>
              <RefreshCw size={14} color={t.colors.accentInk} />
            </Spinning>
            <Text style={[styles.checkText, { color: t.colors.accentInk }]}>
              {syncing ? 'Checking…' : 'Check now'}
            </Text>
          </Pressable>
        </View>
      </Card>

      <SettingsSection>
        <SettingsRow
          icon={icon(Building2)}
          title="Bookmarked organisations"
          sub="Notify when new tenders are added under an organisation you've bookmarked."
          right={toggle(
            settings.orgAlerts,
            v => {
              set({ orgAlerts: v });
              askIfNeeded(v);
            },
            'Bookmarked organisations',
          )}
        />
        <SettingsRow
          icon={icon(FileText)}
          title="Bookmarked tenders"
          sub="Notify on status changes, new corrigenda or pre-bid updates for tenders you've bookmarked."
          right={toggle(
            settings.tenderAlerts,
            v => {
              set({ tenderAlerts: v });
              askIfNeeded(v);
            },
            'Bookmarked tenders',
          )}
          last
        />
      </SettingsSection>

      <SettingsSection title="Closing reminders">
        {DAY_THRESHOLDS.map((day, i) => (
          <SettingsRow
            key={day}
            icon={icon(Clock)}
            title={DAY_LABEL[day]}
            sub={`Remind me when a bookmarked tender is closing ${day} day${
              day === 1 ? '' : 's'
            } from now.`}
            right={toggle(
              settings.reminderDays.includes(day),
              v => {
                toggleDay(day, v);
                askIfNeeded(v);
              },
              DAY_LABEL[day],
            )}
            last={i === DAY_THRESHOLDS.length - 1}
          />
        ))}
      </SettingsSection>

      <Text style={[styles.footnote, { color: t.colors.muted }]}>
        The server sends these as they happen, even when the app is closed;
        closing reminders go out once a day between 10:00 and 21:00. They follow
        your account, so the same choices apply in BM Pro. All options above can
        be on together.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusTitle: { fontFamily: fonts.medium, fontSize: 13.5 },
  statusBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 10,
  },
  checkText: { fontFamily: fonts.semibold, fontSize: 12.5 },
  footnote: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 14,
    marginHorizontal: 4,
  },
});
