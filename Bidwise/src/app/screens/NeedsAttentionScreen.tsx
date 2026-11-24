import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react-native';
import { Card, IconButton, PageTitle, Screen } from '../../components/ui';
import { attentionReason } from '../../components/dashboard/NextDeadlineCard';
import { useTenderSource } from '../../data/tenderSource';
import { useBookmarks } from '../../fixtures/bookmarks';
import { useProjects } from '../../fixtures/projects';
import { needsAttention } from '../../lib/attention';
import { leftLabel } from '../../lib/deadlines';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Every tender needing attention: saved or project tenders closing within 5 days with
 * no documents attached, most urgent first (the Dashboard card's "See more").
 */
export function NeedsAttentionScreen() {
  const t = useTheme();
  const navigation = useNavigation<Nav>();
  const { tenders } = useTenderSource().usePipeline();
  const { projects } = useProjects();
  const { isBookmarked } = useBookmarks();
  const items = useMemo(
    () => needsAttention(tenders, projects, isBookmarked),
    [tenders, projects, isBookmarked],
  );

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle sub="Closing within 5 days with no documents attached.">
        Needs attention
      </PageTitle>

      {items.length ? (
        <Card padding={4} radius="lg" elevation="sm">
          {items.map((it, i) => {
            const crit = it.level === 'crit';
            return (
              <Pressable
                key={it.tender.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${it.tender.short}, ${attentionReason(
                  it,
                )}`}
                onPress={() =>
                  it.project
                    ? navigation.navigate('ProjectDetail', {
                        id: it.project.id,
                      })
                    : navigation.navigate('TenderDetail', { id: it.tender.id })
                }
                style={[
                  styles.row,
                  i < items.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: t.colors.hair,
                  },
                ]}
              >
                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor: crit
                        ? t.colors.critWash
                        : t.colors.warnWash,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: crit ? t.colors.crit : t.colors.warn },
                    ]}
                  >
                    {leftLabel(it.tender.closeIn)}
                  </Text>
                </View>
                <View style={styles.copy}>
                  <Text
                    numberOfLines={2}
                    style={[styles.title, { color: t.colors.ink }]}
                  >
                    {it.tender.short}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.meta, { color: t.colors.muted }]}
                  >
                    {it.tender.org} ·{' '}
                    {it.project ? 'documents pending' : 'no documents yet'}
                  </Text>
                </View>
                <ChevronRight size={17} color={t.colors.muted} />
              </Pressable>
            );
          })}
        </Card>
      ) : (
        <View style={styles.empty}>
          <TriangleAlert size={28} color={t.colors.muted} />
          <Text style={[styles.emptyTitle, { color: t.colors.ink }]}>
            Nothing needs attention
          </Text>
          <Text style={[styles.emptySub, { color: t.colors.muted }]}>
            Saved and project tenders closing within 5 days without documents
            show up here.
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  pill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontFamily: fonts.semibold, fontSize: 11.5 },
  copy: { flex: 1 },
  title: { fontFamily: fonts.medium, fontSize: 13.5 },
  meta: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 50, gap: 8, paddingHorizontal: 20 },
  emptyTitle: { fontFamily: fonts.displaySemibold, fontSize: 16 },
  emptySub: { fontFamily: fonts.regular, fontSize: 12.5, textAlign: 'center' },
});
