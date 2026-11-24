import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from '../ui/GlassBlur';
import { useReducedMotion } from '../ui/motion';
import type { CalendarDay } from '../../lib/calendar';

const GAP = 7;
const DAYS_PER_PAGE = 7;
/** The raised tile: narrow and tall, so it stands above the plain days around it. */
const TILE_HEIGHT = 76;
/** Room above and below the tile so nothing (shadow, blur edge) gets clipped. */
const ROW_PAD = 6;
/** Backdrop blur behind the glass tile. */
const GLASS_BLUR = 12.6;
/** The tile is this share of a plain day's width. */
const TILE_SCALE = 0.9;

type Props = {
  days: CalendarDay[];
  /** Which week (0-based page) is showing first. Default: the week containing today. */
  initialPage?: number;
  /** The day under the raised tile (yyyymmdd). Default: today. */
  selectedKey?: number;
  /** A day was tapped. */
  onSelect?: (day: CalendarDay) => void;
};

/**
 * Calendar strip you can slide through week by week. One raised tile (liquid glass in
 * Glass style) sits under the selected day, today unless a day is tapped, and slides
 * to a tapped day; today keeps its accent number. A dot marks a day with tenders
 * closing: one accent dot for one tender, an accent and a grey dot for two or more.
 */
export function WeekStrip({ days, initialPage, selectedKey, onSelect }: Props) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const ref = useRef<ScrollView>(null);
  // 430 wide phone minus the 18px screen padding; replaced by the measured width.
  const [width, setWidth] = useState(394);
  const dayWidth = (width + GAP) / DAYS_PER_PAGE - GAP;
  const pageWidth = (dayWidth + GAP) * DAYS_PER_PAGE;
  const tileWidth = Math.round(dayWidth * TILE_SCALE);
  const todayIndex = days.findIndex(d => d.today);
  const picked =
    selectedKey !== undefined ? days.findIndex(d => d.key === selectedKey) : -1;
  const selIndex = picked >= 0 ? picked : Math.max(0, todayIndex);
  const page =
    initialPage ??
    Math.max(0, Math.floor((todayIndex < 0 ? 0 : todayIndex) / DAYS_PER_PAGE));

  // The tile's left edge under day `i`, centred in its slot.
  const slotX = (i: number) =>
    i * (dayWidth + GAP) + (dayWidth - tileWidth) / 2;
  const x = useRef(new Animated.Value(slotX(selIndex))).current;
  useEffect(() => {
    const to = slotX(selIndex);
    if (reduced) {
      x.setValue(to);
      return;
    }
    Animated.spring(x, {
      toValue: to,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selIndex, dayWidth, tileWidth, reduced]);

  // Back on today (first draw, or a reset after a tab change): show today's week.
  const onToday = selIndex === todayIndex;
  useEffect(() => {
    if (onToday)
      ref.current?.scrollTo({ x: page * pageWidth, y: 0, animated: false });
  }, [onToday, page, pageWidth]);

  // Very translucent: mostly blur, with a faint fill and edge.
  const dark = t.scheme === 'dark';
  const tileLook = t.isGlass
    ? {
        backgroundColor: dark
          ? 'rgba(255,255,255,0.06)'
          : 'rgba(255,255,255,0.2)',
        borderWidth: 1,
        borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.55)',
      }
    : { backgroundColor: t.colors.surface };

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
        {/* The one raised tile, behind the days; it slides to the selected day. */}
        <Animated.View
          testID="week-tile"
          pointerEvents="none"
          style={[
            styles.tile,
            { width: tileWidth, transform: [{ translateX: x }] },
            tileLook,
            !t.isGlass && t.shadow.sm,
          ]}
        >
          {t.isGlass ? <GlassBlur amount={GLASS_BLUR} /> : null}
        </Animated.View>

        {days.map((d, i) => {
          const big = i === selIndex;
          return (
            <Pressable
              key={d.key}
              accessibilityRole="button"
              accessibilityLabel={`${d.name} ${d.num}, ${d.count} closing`}
              accessibilityState={{ selected: big }}
              onPress={() => onSelect?.(d)}
              style={[styles.day, { width: dayWidth }]}
            >
              <Text
                style={[
                  styles.name,
                  big && styles.nameBig,
                  { color: t.colors.muted },
                ]}
              >
                {d.name.toUpperCase()}
              </Text>
              <Text
                style={[
                  styles.num,
                  big && styles.numBig,
                  { color: d.today ? t.colors.accentInk : t.colors.ink },
                ]}
              >
                {d.num}
              </Text>
              <View style={[styles.marks, big && styles.marksBig]}>
                {d.count === 0 ? (
                  <View
                    style={[
                      styles.dot,
                      big && styles.dotBig,
                      { backgroundColor: t.colors.hair },
                    ]}
                  />
                ) : (
                  <>
                    <View
                      style={[
                        styles.dot,
                        big && styles.dotBig,
                        { backgroundColor: t.colors.accent },
                      ]}
                    />
                    {d.count >= 2 ? (
                      <View
                        style={[
                          styles.dot,
                          big && styles.dotBig,
                          { backgroundColor: t.colors.muted },
                        ]}
                      />
                    ) : null}
                  </>
                )}
              </View>
            </Pressable>
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
  tile: {
    position: 'absolute',
    left: 0,
    top: ROW_PAD,
    height: TILE_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
  },
  day: {
    height: TILE_HEIGHT,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // The selected day is magnified inside the tile, like a lens over the date.
  nameBig: { fontSize: 12.5, letterSpacing: 0.4 },
  numBig: { fontSize: 22, marginTop: 2 },
  marksBig: { marginTop: 7, height: 10, gap: 4 },
  dotBig: { width: 7, height: 7, borderRadius: 3.5 },
});
