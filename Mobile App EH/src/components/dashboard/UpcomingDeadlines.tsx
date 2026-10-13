import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { leftLabel, UpcomingGroup } from '../../lib/deadlines';
import { Card } from '../ui/Card';

type Props = {
  groups: UpcomingGroup[];
  onOpen: (tenderId: string) => void;
};

/** Soonest deadlines grouped by urgency, each row marked with a coloured left stripe. */
export function UpcomingDeadlines({ groups, onOpen }: Props) {
  const t = useTheme();
  const color = { crit: t.colors.crit, soon: t.colors.warn, ok: t.colors.good };

  return (
    <Card elevation="md" style={styles.card}>
      <Text style={[styles.title, { color: t.colors.ink }]}>
        Upcoming deadlines
      </Text>
      {groups.map(g => (
        <View key={g.urgency}>
          <Text style={[styles.group, { color: color[g.urgency] }]}>
            {g.label}
          </Text>
          {g.items.map(item => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.short}`}
              onPress={() => onOpen(item.id)}
              style={styles.row}
            >
              <View
                style={[styles.stripe, { backgroundColor: color[g.urgency] }]}
              />
              <View style={styles.text}>
                <Text
                  numberOfLines={1}
                  style={[styles.id, { color: t.colors.muted }]}
                >
                  {item.id}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[styles.name, { color: t.colors.ink }]}
                >
                  {item.short}
                </Text>
              </View>
              <Text style={[styles.left, { color: color[g.urgency] }]}>
                {leftLabel(item.closeIn)}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14 },
  title: { fontFamily: fonts.extrabold, fontSize: 15, marginBottom: 6 },
  group: {
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    letterSpacing: 1.2,
    marginTop: 14,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  stripe: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  text: { flex: 1, minWidth: 0 },
  id: { fontFamily: fonts.monoMedium, fontSize: 10.5 },
  name: { fontFamily: fonts.semibold, fontSize: 13, marginTop: 2 },
  left: { fontFamily: fonts.bold, fontSize: 12.5 },
});
