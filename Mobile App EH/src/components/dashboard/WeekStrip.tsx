import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from '../ui/GlassBlur';
import type { CalendarDay } from '../../lib/calendar';

const GAP = 7;
const DAYS_PER_PAGE = 7;
/** Today's tile: narrow and tall, so it stands above the plain days around it. */
const TILE_HEIGHT = 76;
/** Room above and below the tile so nothing (shadow, blur edge) gets clipped. */
const ROW_PAD = 6;
/** Backdrop blur behind today's glass tile (10% below the previous 14). */
const GLASS_BLUR = 12.6;
/** Today's tile is this share of a plain day's width. */
const TODAY_SCALE = 0.9;

type Props = {
  days: CalendarDay[];
  /** Which week (0-based page) is showing first. Default: the week containing today. */
  initialPage?: number;
};

/**
 * Calendar strip you can slide through week by week. Days are plain text; only today
 * sits on a raised card (liquid glass in Glass style). A dot marks a day with tenders closing: one accent dot for
 * one tender, an accent and a grey dot for two or more.
 */
export function WeekStrip({ days, initialPage }: Props) {
  const t = useTheme();
  const ref = useRef<ScrollView>(null);
  // 430 wide phone minus the 18px screen padding; replaced by the measured width.
  const [width, setWidth] = useState(394);
  const dayWidth = (width + GAP) / DAYS_PER_PAGE - GAP;
  const pageWidth = (dayWidth + GAP) * DAYS_PER_PAGE;
  const todayWidth = Math.round(dayWidth * TODAY_SCALE);
  const todayIndex = days.findIndex(d => d.today);
  const page =
    initialPage ??
    Math.max(0, Math.floor((todayIndex < 0 ? 0 : todayIndex) / DAYS_PER_PAGE));

  // Very translucent: mostly blur, with a faint fill and edge.
  const dark = t.scheme === 'dark';
  const glassTile = {
    backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.55)',
  };

  useEffect(() => {
    ref.current?.scrollTo({ x: page * pageWidth, y: 0, animated: false });
  }, [page, pageWidth]);

  return (
    <View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={styles.wrap}
    >
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={pageWidth}
        decelerationRate="fast"
        contentContainerStyle={styles.row}
      >
        {days.map(d => {
          const content = (
            <>
              <Text
                style={[
                  styles.name,
                  d.today && styles.nameBig,
                  { color: t.colors.muted },
                ]}
              >
                {d.name.toUpperCase()}
              </Text>
              <Text
                style={[
                  styles.num,
                  d.today && styles.numBig,
                  { color: d.today ? t.colors.accentInk : t.colors.ink },
                ]}
              >
                {d.num}
              </Text>
              <View style={[styles.marks, d.today && styles.marksBig]}>
                {d.count === 0 ? (
                  <View
                    style={[
                      styles.dot,
                      d.today && styles.dotBig,
                      { backgroundColor: t.colors.hair },
                    ]}
                  />
                ) : (
                  <>
                    <View
                      style={[
                        styles.dot,
                        d.today && styles.dotBig,
                        { backgroundColor: t.colors.accent },
                      ]}
                    />
                    {d.count >= 2 ? (
                      <View
                        style={[
                          styles.dot,
                          d.today && styles.dotBig,
                          { backgroundColor: t.colors.muted },
                        ]}
                      />
                    ) : null}
                  </>
                )}
              </View>
            </>
          );
          const label = `${d.name} ${d.num}, ${d.count} closing`;
          if (!d.today) {
            return (
              <View
                key={d.key}
                accessibilityLabel={label}
                style={[styles.day, { width: dayWidth }]}
              >
                {content}
              </View>
            );
          }
          // Today: a raised card, centred in its slot. Glass draws it as liquid glass
          // (blur, sheen, bright edge); Solid is a plain flat card with no border.
          const size = {
            width: todayWidth,
            height: TILE_HEIGHT,
            marginHorizontal: (dayWidth - todayWidth) / 2,
          };
          return t.isGlass ? (
            <View
              key={d.key}
              accessibilityLabel={label}
              style={[styles.todayCard, size, glassTile]}
            >
              <GlassBlur amount={GLASS_BLUR} />
              <View style={styles.todayInner}>{content}</View>
            </View>
          ) : (
            <View
              key={d.key}
              accessibilityLabel={label}
              style={[
                styles.todayCard,
                size,
                { backgroundColor: t.colors.surface },
                t.shadow.sm,
              ]}
            >
              <View style={styles.todayInner}>{content}</View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
    paddingRight: GAP,
    height: TILE_HEIGHT + ROW_PAD * 2,
  },
  day: {
    height: TILE_HEIGHT,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCard: {
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayInner: { alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.3 },
  num: { fontFamily: fonts.bold, fontSize: 15, marginTop: 3 },
  marks: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 6,
    height: 8,
    alignItems: 'center',
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  // Today is magnified inside its tile, like a lens over the date.
  nameBig: { fontSize: 12.5, letterSpacing: 0.4 },
  numBig: { fontSize: 22, marginTop: 2 },
  marksBig: { marginTop: 7, height: 10, gap: 4 },
  dotBig: { width: 7, height: 7, borderRadius: 3.5 },
});
