import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  AlarmClock,
  BellOff,
  CircleCheck,
  Plus,
  TriangleAlert,
} from 'lucide-react-native';
import {
  Card,
  EmptyState,
  Screen,
  ScreenHeader,
  Toggle,
} from '../../components/ui';
import { AlertItem, AlertKind, useAlerts } from '../../fixtures/alerts';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

export function AlertsScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { alerts, unread, markRead, markAllRead, remindersOn, setRemindersOn } =
    useAlerts();

  const look = (kind: AlertKind) =>
    ({
      deadline: { Icon: AlarmClock, fg: t.colors.crit, bg: t.colors.critWash },
      change: { Icon: TriangleAlert, fg: t.colors.warn, bg: t.colors.warnWash },
      new: { Icon: Plus, fg: t.colors.accentInk, bg: t.colors.accentWash },
      success: { Icon: CircleCheck, fg: t.colors.good, bg: t.colors.goodWash },
    }[kind]);

  const open = (a: AlertItem) => {
    markRead(a.id);
    if (a.tenderId) navigation.navigate('TenderDetail', { id: a.tenderId });
    else if (a.projectId)
      navigation.navigate('ProjectDetail', { id: a.projectId });
  };

  return (
    <Screen tabBar>
      <ScreenHeader
        title="Alerts"
        subtitle={unread ? `${unread} unread` : 'Deadlines and recent changes'}
        right={
          unread ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark all read"
              onPress={markAllRead}
              hitSlop={8}
            >
              <Text style={[styles.markAll, { color: t.colors.accentInk }]}>
                Mark all read
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      <Card padding={14} elevation="sm" style={styles.reminder}>
        <View style={styles.reminderRow}>
          <View style={styles.reminderText}>
            <Text style={[styles.reminderTitle, { color: t.colors.ink }]}>
              Deadline reminders
            </Text>
            <Text style={[styles.reminderSub, { color: t.colors.muted }]}>
              Notifications 72h, 24h and 3h before a tender closes
            </Text>
          </View>
          <Toggle
            value={remindersOn}
            onValueChange={setRemindersOn}
            accessibilityLabel="Deadline reminders"
          />
        </View>
      </Card>

      {alerts.length === 0 ? (
        <EmptyState
          icon={<BellOff size={24} color={t.colors.accentInk} />}
          title="No alerts yet"
          description="Deadline reminders and changes to your tenders show up here."
        />
      ) : (
        alerts.map(a => {
          const { Icon, fg, bg } = look(a.kind);
          return (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              onPress={() => open(a)}
              style={styles.press}
            >
              <Card padding={14} elevation="sm">
                <View style={styles.row}>
                  <View style={[styles.icon, { backgroundColor: bg }]}>
                    <Icon size={17} color={fg} />
                  </View>
                  <View style={styles.text}>
                    <Text style={[styles.message, { color: t.colors.ink }]}>
                      {a.message}
                    </Text>
                    <Text style={[styles.time, { color: t.colors.muted }]}>
                      {a.time}
                    </Text>
                  </View>
                  {a.unread ? (
                    <View
                      accessibilityLabel="Unread"
                      style={[styles.dot, { backgroundColor: t.colors.accent }]}
                    />
                  ) : null}
                </View>
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  markAll: { fontFamily: fonts.bold, fontSize: 12 },
  reminder: { marginBottom: 16 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reminderText: { flex: 1 },
  reminderTitle: { fontFamily: fonts.bold, fontSize: 13.5 },
  reminderSub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  press: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  message: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  time: { fontFamily: fonts.regular, fontSize: 11, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
});
