import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ArrowRight } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import type { Tender } from '../../fixtures/tenders';
import { ringProgress, type AttentionItem } from '../../lib/attention';
import { hoursUntilClose } from '../../lib/deadlines';
import { Card } from '../ui/Card';
import { ProgressRing } from '../ui/ProgressRing';

/** Slides shown on the card; the rest are behind "See more". */
export const ATTENTION_SLIDES = 3;

type Props = {
  /** Tenders needing attention (needsAttention()), most urgent first. */
  items: AttentionItem[];
  /** Shown alone when nothing needs attention. */
  next?: Tender;
  onOpenItem: (item: AttentionItem) => void;
  onOpenTender: (tender: Tender) => void;
  onSeeMore: () => void;
};

/** Why an item needs attention, in one line. */
export function attentionReason(it: AttentionItem) {
  const when = it.level === 'crit' ? 'Critical' : 'Closing soon';
  return `${when} · ${it.project ? 'documents pending' : 'no documents yet'}`;
}

function Slide({
  tender,
  heading,
  detail,
}: {
  tender: Tender;
  heading: string;
  /** Last line: when it closes (the reason stays in the screen-reader label). */
  detail: string;
}) {
  const t = useTheme();
  // Counts down over 6 days, so a tender 5 days out already shows some ring.
  const progress = ringProgress(hoursUntilClose(tender.closeIn));
  return (
    <View style={styles.row}>
      <ProgressRing
        size={92}
        progress={progress}
        colors={[t.colors.crit, t.colors.accent]}
      >
        <Text style={[styles.ends, { color: t.colors.muted }]}>ENDS IN</Text>
        <Text style={[styles.remaining, { color: t.colors.ink }]}>
          {tender.closeIn}
        </Text>
      </ProgressRing>
      <View style={styles.text}>
        <Text style={[styles.heading, { color: t.colors.muted }]}>
          {heading}
        </Text>
        <Text numberOfLines={2} style={[styles.title, { color: t.colors.ink }]}>
          {tender.short}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.org, { color: t.colors.inkSoft }]}
        >
          {tender.org}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.detail, { color: t.colors.muted }]}
        >
          {detail}
        </Text>
      </View>
    </View>
  );
}

/**
 * The Dashboard's first card. When tenders need attention (saved or project tenders
 * closing within 5 days with no documents attached) it slides through the 3 most urgent,
 * with "See more" for the rest. Otherwise it shows the next deadline if that is within 5
 * days too (the Dashboard passes none beyond that), else nothing.
 */
export function NextDeadlineCard({
  items,
  next,
  onOpenItem,
  onOpenTender,
  onSeeMore,
}: Props) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const slides = items.slice(0, ATTENTION_SLIDES);
  const attention = slides.length > 0;
  if (!attention && !next) return null;

  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <Card radius="xl" padding={16} style={styles.card}>
      {attention ? (
        <>
          <View onLayout={onLayout}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={32}
            >
              {slides.map((it, i) => (
                <Pressable
                  key={it.tender.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${
                    it.tender.short
                  }, ${attentionReason(it)}`}
                  onPress={() => onOpenItem(it)}
                  style={{ width: width || undefined }}
                >
                  <Slide
                    tender={it.tender}
                    heading={`NEEDS ATTENTION · ${i + 1} OF ${items.length}`}
                    detail={`Closes ${it.tender.closing}`}
                  />
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {slides.length > 1 || items.length > ATTENTION_SLIDES ? (
            <View style={styles.pager}>
              <View style={styles.dots}>
                {slides.length > 1
                  ? slides.map((it, i) => (
                      <View
                        key={it.tender.id}
                        style={[
                          styles.dot,
                          {
                            backgroundColor:
                              i === page ? t.colors.accent : t.colors.hair,
                            width: i === page ? 16 : 6,
                          },
                        ]}
                      />
                    ))
                  : null}
              </View>
              {items.length > ATTENTION_SLIDES ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`See all ${items.length} tenders needing attention`}
                  onPress={onSeeMore}
                  hitSlop={8}
                  style={styles.more}
                >
                  <Text style={[styles.moreText, { color: t.colors.accent }]}>
                    See more
                  </Text>
                  <ArrowRight size={14} color={t.colors.accent} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      ) : next ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${next.short}`}
          onPress={() => onOpenTender(next)}
        >
          <Slide
            tender={next}
            heading="NEXT DEADLINE"
            detail={`Closes ${next.closing}`}
          />
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14, marginBottom: 14 },
  // Ring at the left, text filling the rest of the card.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  ends: { fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.3 },
  remaining: { fontFamily: fonts.monoSemibold, fontSize: 17, marginTop: 2 },
  text: { flex: 1 },
  heading: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.9 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, marginTop: 4 },
  org: { fontFamily: fonts.medium, fontSize: 12, marginTop: 4 },
  detail: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  // Dots centred under the slide; "See more" pinned to the right of the same row.
  pager: {
    minHeight: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
  },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { height: 6, borderRadius: 3 },
  more: {
    position: 'absolute',
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  moreText: { fontFamily: fonts.semibold, fontSize: 12.5 },
});
