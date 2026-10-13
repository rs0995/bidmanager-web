import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '../../theme';

type Props = {
  title: string;
  note?: string;
};

/**
 * Phase 1 stand-in for a document page. Phase 2F replaces it with the real viewer
 * (PDF via WebView, images inline). Fixed light colours on purpose, like a printed page.
 */
export function PaperPage({
  title,
  note = 'Preview placeholder. The document shows here once file handling is connected.',
}: Props) {
  return (
    <View style={styles.sheet}>
      <Text style={styles.heading}>{title}</Text>
      {Array.from({ length: 20 }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.line,
            i % 4 === 3 && styles.short,
            i % 7 === 6 && styles.medium,
          ]}
        />
      ))}
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    padding: 22,
    gap: 9,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#1b1d24',
    marginBottom: 8,
  },
  line: { height: 8, borderRadius: 3, backgroundColor: '#e6e6e8' },
  short: { width: '62%' },
  medium: { width: '83%' },
  note: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: '#8a8a90',
    fontStyle: 'italic',
    marginTop: 12,
  },
});
