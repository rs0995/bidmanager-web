import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlarmClock, FileText } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { closingSoon, ClosingItem } from '../../fixtures/dashboard';
import { Card } from '../ui/Card';
import { StatusChip } from '../ui/Chip';

type Props = {
  items?: ClosingItem[];
  onSeeAll?: () => void;
  onOpen?: (id: string) => void;
};

export function ClosingSoonList({
  items = closingSoon,
  onSeeAll,
  onOpen,
}: Props) {
  const t = useTheme();
  const wash = {
    ok: t.colors.goodWash,
    soon: t.colors.warnWash,
    crit: t.colors.critWash,
  } as const;
  const fg = {
    ok: t.colors.good,
    soon: t.colors.warn,
    crit: t.colors.crit,
  } as const;

  return (
    <View>
      <View style={styles.head}>
        <Text style={[styles.h2, { color: t.colors.ink }]}>Closing Soon</Text>
        <Pressable accessibilityRole="button" onPress={onSeeAll} hitSlop={8}>
          <Text style={[styles.see, { color: t.colors.accentInk }]}>
            See all
          </Text>
        </Pressable>
      </View>
      <Card padding={0}>
        <View style={styles.inner}>
          {items.map((it, i) => {
            const tone =
              it.tone === 'ok' || it.tone === 'soon' || it.tone === 'crit'
                ? it.tone
                : 'soon';
            const Icon = it.urgent ? AlarmClock : FileText;
            return (
              <Pressable
                key={it.id}
                accessibilityRole="button"
                onPress={() => onOpen?.(it.id)}
                style={[
                  styles.row,
                  i < items.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: t.colors.hair,
                  },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: wash[tone] }]}>
                  <Icon size={18} color={fg[tone]} />
                </View>
                <View style={styles.text}>
                  <Text
                    numberOfLines={1}
                    style={[styles.org, { color: t.colors.muted }]}
                  >
                    {it.org.toUpperCase()}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.title, { color: t.colors.ink }]}
                  >
                    {it.title}
                  </Text>
                </View>
                <StatusChip tone={it.tone} label={it.remaining} />
              </Pressable>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4,
    marginHorizontal: 4,
    marginBottom: 10,
  },
  h2: { fontFamily: fonts.extrabold, fontSize: 15 },
  see: { fontFamily: fonts.bold, fontSize: 11.5 },
  inner: { paddingHorizontal: 16, paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  org: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.3 },
  title: { fontFamily: fonts.semibold, fontSize: 12.5, marginTop: 2 },
});
