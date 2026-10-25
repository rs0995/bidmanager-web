import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Txt } from './Txt';

type Props = {
  title: string;
  subtitle?: string;
  /** Mono text under the title (IDs, timestamps). */
  meta?: string;
  icon?: LucideIcon;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  /** Draw the rule above this row (every row but the first in a card). */
  divider?: boolean;
  /** Leading content, e.g. a selection checkbox. */
  left?: React.ReactNode;
  children?: React.ReactNode;
};

export function ListRow({
  title,
  subtitle,
  meta,
  icon: Icon,
  right,
  onPress,
  chevron,
  divider,
  left,
  children,
}: Props) {
  const t = useTheme();
  const body = (
    <View
      style={[
        styles.row,
        divider && { borderTopWidth: 1, borderTopColor: t.colors.hairSoft },
      ]}
    >
      {left}
      {Icon ? <Icon size={16} color={t.colors.ink3} strokeWidth={2} /> : null}
      <View style={styles.text}>
        <Txt variant="bodyStrong" numberOfLines={2}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="small" color="ink2" numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
        {meta ? (
          <Txt variant="monoSmall" color="ink3" numberOfLines={1}>
            {meta}
          </Txt>
        ) : null}
        {children}
      </View>
      {right}
      {chevron ? <ChevronRight size={16} color={t.colors.ink3} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => pressed && { backgroundColor: t.colors.raised }}
    >
      {body}
    </Pressable>
  );
}

/**
 * The desktop's signature register line: mono uppercase label, dotted leader,
 * mono value. Used only for read-only vitals, never for editable fields.
 */
export function KeyValue({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.kv}>
      <Txt variant="label" style={styles.kvLabel}>
        {label}
      </Txt>
      {/* Dotted single-side borders don't render on iOS, so clip a fully
          dotted box down to its bottom edge. */}
      <View style={styles.leaderClip}>
        <View style={[styles.leader, { borderColor: t.colors.hair }]} />
      </View>
      <Txt variant="mono" style={styles.kvValue} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  text: { flex: 1, gap: 2 },
  kv: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingVertical: 5,
  },
  kvLabel: { fontSize: 10.5, letterSpacing: 0.9, marginBottom: 1 },
  leaderClip: {
    flex: 1,
    height: 1,
    overflow: 'hidden',
    marginBottom: 5,
    minWidth: 12,
  },
  leader: { height: 3, marginTop: -2, borderWidth: 1, borderStyle: 'dotted' },
  kvValue: { flexShrink: 1, textAlign: 'right' },
});
