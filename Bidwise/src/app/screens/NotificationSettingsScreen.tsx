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
  BookmarkCheck,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleCheck,
  Clock,
  FileText,
  FolderPlus,
  RefreshCw,
} from 'lucide-react-native';
import {
  Card,
  Checkbox,
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
  PREBID_LEAD_OPTIONS,
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

/** The reminder row's text: "Off", "1 day before", "1 and 3 days before", ... */
export function reminderSummary(days: number[]) {
  const d = [...days].sort((a, b) => a - b);
  if (!d.length) return 'Off';
  if (d.length === 1) return DAY_LABEL[d[0]] ?? `${d[0]} days before`;
  const list = `${d.slice(0, -1).join(', ')} and ${d[d.length - 1]}`;
  return `${list} days before`;
}

const LEAD_LABEL: Record<number, string> = {
  1440: '1 day before',
  240: '4 h before',
  120: '2 h before',
  60: '1 h before',
};
const leadShort = (m: number) =>
  m >= 1440 ? `${m / 1440} day` : `${m / 60} h`;

/** The pre-bid row's text: "Off", "2 h before", "1 day and 2 h before", ... */
export function prebidSummary(leads: number[]) {
  const l = [...leads].sort((a, b) => b - a);
  if (!l.length) return 'Off';
  if (l.length === 1) return LEAD_LABEL[l[0]] ?? `${leadShort(l[0])} before`;
  const parts = l.map(leadShort);
  return `${parts.slice(0, -1).join(', ')} and ${
    parts[parts.length - 1]
  } before`;
}

export function NotificationSettingsScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const { settings, set, toggleDay, togglePrebidLead } = useNotifySettings();
  const { sync, syncing, lastSyncAt } = useActions();
  const [permission, setPermission] = useState<PushPermission>('undetermined');
  const [daysOpen, setDaysOpen] = useState(false);
  const [leadsOpen, setLeadsOpen] = useState(false);

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
      <PageTitle>Push notifications & Alerts</PageTitle>

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
        />
        <SettingsRow
          icon={icon(FolderPlus)}
          title="New projects"
          sub="Show an alert in Alerts when someone else adds a project (another device or a member of your organisation). Not sent as a notification."
          right={toggle(
            settings.projectAlerts,
            v => set({ projectAlerts: v }),
            'New projects',
          )}
          last
        />
      </SettingsSection>

      <SettingsSection title="Closing reminders">
        {/* One row; its dropdown ticks any of the days the server sends reminders for. */}
        <SettingsRow
          icon={icon(Clock)}
          title="Closing reminders"
          sub="Remind me before a bookmarked tender closes."
          value={reminderSummary(settings.reminderDays)}
          right={
            daysOpen ? (
              <ChevronUp size={16} color={t.colors.muted} />
            ) : (
              <ChevronDown size={16} color={t.colors.muted} />
            )
          }
          onPress={() => setDaysOpen(o => !o)}
          last={!daysOpen}
        />
        {daysOpen ? (
          <View
            accessibilityLabel="Reminder days"
            style={[styles.days, { borderTopColor: t.colors.hair }]}
          >
            {DAY_THRESHOLDS.map(day => {
              const on = settings.reminderDays.includes(day);
              const change = () => {
                toggleDay(day, !on);
                askIfNeeded(!on);
              };
              return (
                <Pressable
                  key={day}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Remind ${DAY_LABEL[day]}`}
                  onPress={change}
                  style={styles.dayRow}
                >
                  <Checkbox
                    checked={on}
                    label={`Remind ${DAY_LABEL[day]}`}
                    onPress={change}
                  />
                  <Text style={[styles.dayText, { color: t.colors.ink }]}>
                    {DAY_LABEL[day]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Pre-bid reminders">
        {/* Times for the "Remind me" switch on a tender's pre-bid meeting. */}
        <SettingsRow
          icon={icon(CalendarClock)}
          title="Pre-bid reminders"
          sub="Remind me before a pre-bid meeting I've switched on (on the tender's page)."
          value={prebidSummary(settings.prebidLeads)}
          right={
            leadsOpen ? (
              <ChevronUp size={16} color={t.colors.muted} />
            ) : (
              <ChevronDown size={16} color={t.colors.muted} />
            )
          }
          onPress={() => setLeadsOpen(o => !o)}
        />
        {leadsOpen ? (
          <View
            accessibilityLabel="Pre-bid reminder times"
            style={[styles.days, { borderTopColor: t.colors.hair }]}
          >
            {PREBID_LEAD_OPTIONS.map(lead => {
              const on = settings.prebidLeads.includes(lead);
              const change = () => {
                togglePrebidLead(lead, !on);
                askIfNeeded(!on);
              };
              return (
                <Pressable
                  key={lead}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Remind ${LEAD_LABEL[lead]}`}
                  onPress={change}
                  style={styles.dayRow}
                >
                  <Checkbox
                    checked={on}
                    label={`Remind ${LEAD_LABEL[lead]}`}
                    onPress={change}
                  />
                  <Text style={[styles.dayText, { color: t.colors.ink }]}>
                    {LEAD_LABEL[lead]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <SettingsRow
          icon={icon(BookmarkCheck)}
          title="Bookmarked tenders automatically"
          sub="Turn the pre-bid reminder on for every bookmarked tender. You can still switch it off on a tender's page."
          right={toggle(
            settings.prebidAutoBookmarked,
            v => {
              set({ prebidAutoBookmarked: v });
              askIfNeeded(v);
            },
            'Pre-bid reminders for bookmarked tenders',
          )}
          last
        />
      </SettingsSection>

      <Text style={[styles.footnote, { color: t.colors.muted }]}>
        The server sends these as they happen, even when the app is closed;
        closing reminders go out once a day between 10:00 and 21:00, and pre-bid
        reminders at the times you choose. They follow your account, so the same
        choices apply in BM Pro. A pre-bid reminder switched on for a tender is
        shared with your organisation, so every member is reminded. New projects
        only appears in Alerts. All options above can be on together.
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
  days: { borderTopWidth: 1, paddingVertical: 4, paddingHorizontal: 14 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  dayText: { fontFamily: fonts.medium, fontSize: 14 },
  footnote: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 14,
    marginHorizontal: 4,
  },
});
