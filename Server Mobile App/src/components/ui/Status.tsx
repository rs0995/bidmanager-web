import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fonts, Tone, toneColors, useTheme } from '../../theme';
import { Txt } from './Txt';

/** Square bordered mono state pill (desktop `Pill`): RUNNING, FAILED, ACTIVE… */
export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.bd }]}>
      <Txt style={[styles.pillText, { color: c.fg }]}>{label}</Txt>
    </View>
  );
}

/** Round status dot, optionally with a soft halo (connected / serving). */
export function Dot({ tone, halo }: { tone: Tone; halo?: boolean }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View
      style={[styles.halo, { backgroundColor: halo ? c.bg : 'transparent' }]}
    >
      <View style={[styles.dot, { backgroundColor: c.fg }]} />
    </View>
  );
}

/** Square red count badge (desktop nav badge). */
export function Badge({ count }: { count: number }) {
  const t = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: t.colors.bad }]}>
      <Txt style={styles.badgeText}>{count > 9 ? '9+' : count}</Txt>
    </View>
  );
}

/** Thin bordered bar (desktop `Bar`). `pct` is 0–100. */
export function MeterBar({ pct, tone = 'info' }: { pct: number; tone?: Tone }) {
  const t = useTheme();
  const w = Math.max(0, Math.min(100, pct));
  return (
    <View
      style={[
        styles.track,
        { backgroundColor: t.colors.raised, borderColor: t.colors.hairSoft },
      ]}
    >
      <View
        style={[
          styles.fill,
          { width: `${w}%`, backgroundColor: toneColors(t, tone).fg },
        ]}
      />
    </View>
  );
}

type StatItem = { label: string; value: string; tone?: Tone };

/** Ruled totals strip: mono label over a mono figure (desktop `StatStrip`). */
export function StatStrip({ items }: { items: StatItem[] }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.strip,
        { backgroundColor: t.colors.surface, borderColor: t.colors.hair },
      ]}
    >
      {items.map((it, i) => (
        <View
          key={it.label}
          style={[
            styles.tile,
            i > 0 && { borderLeftWidth: 1, borderLeftColor: t.colors.hairSoft },
          ]}
        >
          <Txt variant="label" numberOfLines={1} style={styles.tileLabel}>
            {it.label}
          </Txt>
          <Txt
            variant="monoLarge"
            style={{ color: it.tone ? toneColors(t, it.tone).fg : t.colors.ink }}
          >
            {it.value}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  halo: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: { paddingHorizontal: 5, minWidth: 16, alignItems: 'center' },
  badgeText: {
    color: '#FFFFFF',
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 15,
  },
  // flexGrow, not flex: 1 — a zero flex-basis would collapse the height in a column.
  track: { height: 6, borderWidth: 1, flexGrow: 1, flexShrink: 1 },
  fill: { height: '100%' },
  strip: { flexDirection: 'row', borderWidth: 1 },
  tile: { flex: 1, paddingVertical: 9, paddingHorizontal: 12 },
  tileLabel: { fontSize: 10, letterSpacing: 1.2 },
});
