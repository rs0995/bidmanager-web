import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAccess } from '../../lib/account';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  CheckCheck,
  DownloadCloud,
  ChevronRight,
  CircleCheck,
  Clock3,
  FileDiff,
  Files,
  Paperclip,
} from 'lucide-react-native';
import { Card, PageTitle, Screen, Segmented } from '../../components/ui';
import { FadeSwitch } from '../../components/ui/motion';
import { AlertItem, AlertKind, useAlerts } from '../../fixtures/alerts';
import { ALERT_TITLES, groupAlerts } from '../../lib/alertGroups';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Alerts'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const ICONS: Record<AlertKind, typeof Clock3> = {
  deadline: Clock3,
  change: FileDiff,
  new: Files,
  success: CircleCheck,
  prep: Paperclip,
  download: DownloadCloud,
};

function AlertRow({
  a,
  onPress,
  last,
}: {
  a: AlertItem;
  onPress: () => void;
  last: boolean;
}) {
  const t = useTheme();
  const Icon = ICONS[a.kind];
  const tone =
    a.kind === 'deadline'
      ? { fg: t.colors.crit, bg: t.colors.critWash }
      : a.kind === 'success' || a.kind === 'download'
      ? { fg: t.colors.good, bg: t.colors.goodWash }
      : a.kind === 'prep'
      ? { fg: t.colors.warn, bg: t.colors.warnWash }
      : { fg: t.colors.accent, bg: t.colors.accentWash };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${a.unread ? 'Unread. ' : ''}${
        ALERT_TITLES[a.kind]
      }. ${a.message}`}
      onPress={onPress}
      style={[
        styles.row,
        !last && { borderBottomWidth: 1, borderBottomColor: t.colors.hair },
        // Unread alerts stay highlighted until they are read.
        a.unread && {
          backgroundColor: t.isGlass
            ? `${t.colors.accent}1f`
            : t.colors.accentWash,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: tone.bg }]}>
        <Icon size={17} color={tone.fg} />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: t.colors.ink }]}>
            {ALERT_TITLES[a.kind]}
          </Text>
        </View>
        <Text
          numberOfLines={3}
          style={[
            styles.msg,
            { color: a.unread ? t.colors.ink : t.colors.inkSoft },
            a.unread && styles.msgUnread,
          ]}
        >
          {a.message}
        </Text>
        <Text style={[styles.meta, { color: t.colors.muted }]}>
          {a.tenderId ?? a.projectId ?? a.orgName ?? ''}
          {a.tenderId || a.projectId || a.orgName ? ' · ' : ''}
          {a.time}
        </Text>
      </View>
      <ChevronRight size={17} color={t.colors.muted} />
    </Pressable>
  );
}

export function AlertsScreen() {
  const t = useTheme();
  const navigation = useNavigation<Nav>();
  const { alerts, unread, markRead, markAllRead } = useAlerts();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const groups = useMemo(
    () => groupAlerts(alerts, filter === 'unread'),
    [alerts, filter],
  );

  const access = useAccess();
  const open = (a: AlertItem) => {
    markRead(a.id);
    if (a.projectId) {
      if (access.projects)
        navigation.navigate('ProjectDetail', { id: a.projectId });
    } else if (a.tenderId)
      navigation.navigate('TenderDetail', { id: a.tenderId });
    // Several new tenders under one organisation: a page of just those tenders.
    else if (a.kind === 'new' && a.newTenderIds?.length)
      navigation.navigate('NewTenders', { alertId: a.id });
    else if (access.active) navigation.navigate('Tenders', { view: 'tenders' });
  };

  return (
    <Screen tabBar>
      <PageTitle
        sub="Deadlines, updates and bid preparation."
        right={
          <Pressable
            accessibilityRole="button"
            onPress={markAllRead}
            disabled={unread === 0}
            hitSlop={8}
          >
            <Text
              style={[
                styles.markAll,
                { color: unread ? t.colors.accent : t.colors.muted },
              ]}
            >
              Mark all read
            </Text>
          </Pressable>
        }
      >
        Alerts
      </PageTitle>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread' },
        ]}
      />

      <FadeSwitch id={filter}>
        {groups.map(g => (
          <View key={g.name}>
            <Text style={[styles.group, { color: t.colors.muted }]}>
              {g.name.toUpperCase()}
            </Text>
            <Card padding={4} radius="lg" elevation="sm" style={styles.card}>
              {g.items.map((a, i) => (
                <AlertRow
                  key={a.id}
                  a={a}
                  last={i === g.items.length - 1}
                  onPress={() => open(a)}
                />
              ))}
            </Card>
          </View>
        ))}

        {groups.length === 0 ? (
          <View style={styles.empty}>
            <CheckCheck size={28} color={t.colors.accent} />
            <Text style={[styles.emptyTitle, { color: t.colors.ink }]}>
              You’re all caught up
            </Text>
            <Text style={[styles.emptySub, { color: t.colors.muted }]}>
              No unread alerts.
            </Text>
          </View>
        ) : null}
      </FadeSwitch>
    </Screen>
  );
}

const styles = StyleSheet.create({
  markAll: { fontFamily: fonts.semibold, fontSize: 12, marginBottom: 4 },
  group: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: 16,
    marginBottom: 8,
  },
  card: { marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: fonts.semibold, fontSize: 13 },
  msg: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  msgUnread: { fontFamily: fonts.medium },
  meta: { fontFamily: fonts.regular, fontSize: 10.5, marginTop: 5 },
  empty: { alignItems: 'center', marginTop: 40, gap: 6 },
  emptyTitle: { fontFamily: fonts.displaySemibold, fontSize: 16 },
  emptySub: { fontFamily: fonts.regular, fontSize: 12 },
});
