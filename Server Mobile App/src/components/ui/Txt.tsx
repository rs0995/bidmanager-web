import React from 'react';
import { StyleProp, StyleSheet, Text, TextProps, TextStyle } from 'react-native';
import { fonts, useTheme } from '../../theme';

type Variant =
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'small'
  | 'label'
  | 'mono'
  | 'monoSmall'
  | 'monoLarge';

type Color = 'ink' | 'ink2' | 'ink3' | 'accent' | 'ok' | 'warn' | 'bad';

type Props = TextProps & {
  variant?: Variant;
  color?: Color;
  style?: StyleProp<TextStyle>;
};

// One text primitive for the whole app. Sizes follow the desktop Server UI:
// condensed bold titles, mono uppercase labels, mono figures.
export function Txt({ variant = 'body', color, style, ...rest }: Props) {
  const t = useTheme();
  const fallback: Color = variant === 'label' ? 'ink2' : 'ink';
  return (
    <Text
      {...rest}
      style={[styles[variant], { color: t.colors[color ?? fallback] }, style]}
    />
  );
}

const styles = StyleSheet.create({
  // Panel title (desktop: Plex Sans Condensed 700, 21px).
  title: { fontFamily: fonts.cond, fontSize: 21, letterSpacing: -0.1 },
  // Status lines like "Serving traffic" (desktop: condensed 700, 17px).
  heading: { fontFamily: fonts.cond, fontSize: 17 },
  body: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 13.5, lineHeight: 19 },
  small: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  // SubHead / register labels (desktop: mono 10.5, tracked, uppercase).
  label: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  monoSmall: {
    fontFamily: fonts.mono,
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  // StatStrip figures (desktop: mono 23px).
  monoLarge: {
    fontFamily: fonts.mono,
    fontSize: 23,
    lineHeight: 29,
    fontVariant: ['tabular-nums'],
  },
});
