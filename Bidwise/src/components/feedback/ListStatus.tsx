import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';

/** `value`, updated only after it has stopped changing for `ms` (search fields). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Loading spinner, error message, or empty-list text under a list. */
export function ListStatus({
  loading,
  error,
  empty,
  emptyText,
  loadingText,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  /** Said under the spinner, e.g. "Fetching the new tenders…". */
  loadingText?: string;
}) {
  const t = useTheme();
  if (loading)
    return (
      <View style={styles.wrap}>
        <ActivityIndicator color={t.colors.accent} />
        {loadingText ? (
          <Text style={[styles.text, { color: t.colors.muted }]}>
            {loadingText}
          </Text>
        ) : null}
      </View>
    );
  if (error)
    return (
      <Text style={[styles.text, { color: t.colors.crit }]}>
        Couldn’t load: {error}
      </Text>
    );
  if (empty)
    return <Text style={[styles.text, { color: t.colors.muted }]}>{emptyText}</Text>;
  return null;
}

/** "Load more" at the end of a paged list. */
export function LoadMore({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.more, { borderColor: t.colors.hair }]}
    >
      <Text style={[styles.moreText, { color: t.colors.accent }]}>Load more</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 30, alignItems: 'center' },
  text: {
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 30,
  },
  more: {
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  moreText: { fontFamily: fonts.semibold, fontSize: 13 },
});
