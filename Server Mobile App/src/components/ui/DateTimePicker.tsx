import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { formatIst, pad2, parseIst } from '../../lib/format';
import { fonts, useTheme } from '../../theme';
import { Txt } from './Txt';

// Calendar + time list, like the desktop's date-time field, in the desktop's
// square style. Value is IST text "YYYY-MM-DD HH:MM" (the same text the manual
// field edits), so typing and tapping stay in sync both ways.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEK_HEAD = ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const CELL = 40;

type Parts = { y: number; mo: number; d: number; h: number; mi: number };

function partsOf(text: string, fallbackSecs: number): Parts {
  const secs = parseIst(text) ?? fallbackSecs;
  const m = formatIst(secs).match(/^(\d+)-(\d+)-(\d+) (\d+):(\d+)$/)!;
  const [, y, mo, d, h, mi] = m.map(Number);
  return { y, mo, d, h, mi };
}

const toText = (p: Parts) =>
  `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}`;

const daysIn = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

export function DateTimePicker({
  value,
  onChange,
  fallbackSecs,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Shown/selected when the text doesn't parse (e.g. next whole hour). */
  fallbackSecs: number;
}) {
  const t = useTheme();
  const sel = partsOf(value, fallbackSecs);
  const today = partsOf(formatIst(Math.floor(Date.now() / 1000)), 0);
  const [view, setView] = useState({ y: sel.y, mo: sel.mo });

  // Follow the field when the user types a date in another month.
  useEffect(() => setView({ y: sel.y, mo: sel.mo }), [sel.y, sel.mo]);

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.mo - 1, 1)).getUTCDay(); // 0 = Sun
    const lead = (first + 6) % 7; // Monday-first grid
    const n = daysIn(view.y, view.mo);
    return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  }, [view]);

  const set = (patch: Partial<Parts>) => {
    const next = { ...sel, ...patch };
    next.d = Math.min(next.d, daysIn(next.y, next.mo));
    onChange(toText(next));
  };
  const shift = (delta: number) =>
    setView(v => {
      const m = v.mo - 1 + delta;
      return { y: v.y + Math.floor(m / 12), mo: (((m % 12) + 12) % 12) + 1 };
    });
  const isPast = (d: number) =>
    view.y * 10000 + view.mo * 100 + d < today.y * 10000 + today.mo * 100 + today.d;

  const hourRef = useRef<ScrollView>(null);
  const minRef = useRef<ScrollView>(null);
  useEffect(() => {
    hourRef.current?.scrollTo({ y: Math.max(0, (sel.h - 2) * CELL), animated: false });
    minRef.current?.scrollTo({
      y: Math.max(0, (Math.floor(sel.mi / 5) - 2) * CELL),
      animated: false,
    });
  }, [sel.h, sel.mi]);

  const cellStyle = (on: boolean) => [
    styles.timeCell,
    {
      backgroundColor: on ? t.colors.accent : t.colors.surface,
      borderBottomColor: t.colors.hairSoft,
    },
  ];

  return (
    <View style={[styles.wrap, { borderColor: t.colors.hair }]}>
      <View style={styles.calendar}>
        <View style={styles.monthRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shift(-1)} hitSlop={8} style={styles.arrow}>
            <ChevronLeft size={16} color={t.colors.ink2} />
          </Pressable>
          <Txt style={[styles.month, { color: t.colors.ink }]}>
            {MONTHS[view.mo - 1]} {view.y}
          </Txt>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shift(1)} hitSlop={8} style={styles.arrow}>
            <ChevronRight size={16} color={t.colors.ink2} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {WEEK_HEAD.map(w => (
            <Txt key={w} style={[styles.weekHead, { color: t.colors.ink3 }]}>
              {w}
            </Txt>
          ))}
          {cells.map((d, i) => {
            if (d == null) return <View key={`e${i}`} style={styles.day} />;
            const selected = d === sel.d && view.mo === sel.mo && view.y === sel.y;
            const isToday = d === today.d && view.mo === today.mo && view.y === today.y;
            const past = isPast(d);
            return (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityLabel={`${d} ${MONTHS[view.mo - 1]} ${view.y}`}
                accessibilityState={{ selected, disabled: past }}
                disabled={past}
                onPress={() => set({ y: view.y, mo: view.mo, d })}
                style={[
                  styles.day,
                  selected && { backgroundColor: t.colors.accent },
                  !selected && isToday && { borderWidth: 1, borderColor: t.colors.accent },
                ]}
              >
                <Txt
                  style={[
                    styles.dayText,
                    {
                      color: selected
                        ? t.colors.onAccent
                        : past
                        ? t.colors.hair
                        : t.colors.ink,
                    },
                  ]}
                >
                  {d}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.time, { borderLeftColor: t.colors.hair }]}>
        <ScrollView ref={hourRef} style={styles.timeCol} showsVerticalScrollIndicator={false}>
          {HOURS.map(h => (
            <Pressable key={h} accessibilityRole="button" accessibilityLabel={`${pad2(h)} hours`} onPress={() => set({ h })} style={cellStyle(h === sel.h)}>
              <Txt style={[styles.timeText, { color: h === sel.h ? t.colors.onAccent : t.colors.ink }]}>
                {pad2(h)}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView
          ref={minRef}
          style={[styles.timeCol, { borderLeftWidth: 1, borderLeftColor: t.colors.hairSoft }]}
          showsVerticalScrollIndicator={false}
        >
          {MINUTES.map(mi => {
            const on = Math.floor(sel.mi / 5) * 5 === mi;
            return (
              <Pressable key={mi} accessibilityRole="button" accessibilityLabel={`${pad2(mi)} minutes`} onPress={() => set({ mi })} style={cellStyle(on)}>
                <Txt style={[styles.timeText, { color: on ? t.colors.onAccent : t.colors.ink }]}>
                  {pad2(mi)}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderWidth: 1 },
  calendar: { flex: 1, padding: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  arrow: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  month: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekHead: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontFamily: fonts.mono,
    fontSize: 10,
    paddingVertical: 4,
  },
  day: {
    width: `${100 / 7}%`,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontFamily: fonts.mono, fontSize: 12.5 },
  time: { flexDirection: 'row', width: 96, borderLeftWidth: 1, height: 252 },
  timeCol: { flex: 1 },
  timeCell: {
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
  },
  timeText: { fontFamily: fonts.mono, fontSize: 13 },
});
