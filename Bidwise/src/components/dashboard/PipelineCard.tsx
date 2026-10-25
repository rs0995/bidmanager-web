import React, { useId, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { ArrowUpRight } from 'lucide-react-native';
import {
  ACCENTS,
  fonts,
  PAPER_ACCENT,
  useTheme,
  useThemePrefs,
} from '../../theme';
import { formatCrores } from '../../lib/format';
import { GlassBlur } from '../ui/GlassBlur';

type Props = {
  /** Combined value of the projects still in preparation, in crores. */
  crores: number;
  /** How many projects are in preparation. */
  activeCount: number;
  onViewPipeline: () => void;
};

const WHITE_73 = 'rgba(255,255,255,0.73)';
const WHITE_72 = 'rgba(255,255,255,0.72)';

/**
 * "Active bid pipeline", as in the bidwise reference: the value of bids in
 * preparation on the selected accent (its light shade in every mode, so the white text
 * always reads), a faint arch in the top-right corner, and a footer with the project
 * count and "View pipeline". Liquid glass makes the fill translucent over a blur.
 */
export function PipelineCard({ crores, activeCount, onViewPipeline }: Props) {
  const t = useTheme();
  const { prefs } = useThemePrefs();
  const fill =
    t.style === 'paper'
      ? PAPER_ACCENT.light[0]
      : (ACCENTS[prefs.accent] ?? ACCENTS.green).light[0];
  // Unique per instance: duplicate SVG ids break on web.
  const uid = `pl${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const glass = t.isGlass;
  // The highlight is drawn at the card's measured size: a percentage-sized Svg can keep
  // its first layout on iOS and leave the lower part of the card unfilled.
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w !== size.w || h !== size.h) setSize({ w, h });
  };

  return (
    <View
      onLayout={glass ? onLayout : undefined}
      style={[
        styles.card,
        {
          backgroundColor: glass ? 'transparent' : fill,
          borderColor: glass
            ? 'rgba(255,255,255,0.40)'
            : 'rgba(255,255,255,0.07)',
        },
        t.shadow.md,
      ]}
    >
      {glass ? (
        <>
          <GlassBlur amount={18} />
          {/* The accent at 84% over the blur, as an edge-to-edge layer so it always
              covers the whole card. */}
          <View
            pointerEvents="none"
            style={[styles.fill, { backgroundColor: `${fill}d6` }]}
          />
          {size.w > 0 ? (
            <Svg
              style={StyleSheet.absoluteFill}
              width={size.w}
              height={size.h}
              pointerEvents="none"
            >
              <Defs>
                <RadialGradient id={`${uid}hi`} cx="68%" cy="2%" r="60%">
                  <Stop offset="0" stopColor="#ffffff" stopOpacity={0.13} />
                  <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect width={size.w} height={size.h} fill={`url(#${uid}hi)`} />
            </Svg>
          ) : null}
        </>
      ) : null}

      {/* The reference's thick, very faint arch, mostly off the top-right corner. */}
      <View
        pointerEvents="none"
        style={[
          styles.arch,
          {
            borderColor: glass
              ? 'rgba(255,255,255,0.05)'
              : 'rgba(255,255,255,0.07)',
          },
        ]}
      />

      <Text style={styles.kicker}>ACTIVE BID PIPELINE</Text>
      <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
        {formatCrores(crores)} Cr
      </Text>
      <Text style={styles.caption}>Total value of bids in preparation</Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {activeCount} active {activeCount === 1 ? 'project' : 'projects'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View pipeline"
          onPress={onViewPipeline}
          hitSlop={10}
          style={styles.view}
        >
          <Text style={styles.footerText}>View pipeline</Text>
          <ArrowUpRight size={14} color="#ffffff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    paddingTop: 23,
    paddingHorizontal: 18,
    paddingBottom: 18,
    overflow: 'hidden',
    marginBottom: 14,
  },
  arch: {
    position: 'absolute',
    width: 226,
    height: 226,
    borderRadius: 113,
    borderWidth: 34,
    right: -89,
    top: -113,
  },
  kicker: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1.15,
    color: WHITE_73,
  },
  amount: {
    fontFamily: fonts.semibold,
    fontSize: 32,
    letterSpacing: -1.4,
    lineHeight: 38,
    color: '#ffffff',
    marginTop: 8,
  },
  caption: {
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 16,
    color: WHITE_72,
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingTop: 17,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  footerText: { fontFamily: fonts.semibold, fontSize: 10, color: '#ffffff' },
  view: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
