import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronDown, ChevronRight, MessageSquare, Settings2, Sparkles } from 'lucide-react-native';
import { Card, IconButton, Screen, SearchField } from '../../components/ui';
import { useBidAgent } from '../../data/bidAgent';
import { useTenderSource } from '../../data/tenderSource';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'BidAgentHub'>;

/** Waits until typing pauses before searching. */
function useDebounced(value: string, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * The Bid Agent hub (the tab bar's centre button): find any tender by ID or title and
 * chat about it (it needn't be a project yet), continue a recent chat, or open the
 * agent's settings and training.
 */
export function BidAgentHubScreen() {
  const t = useTheme();
  const navigation = useNavigation<Nav>();
  const source = useTenderSource();
  const agent = useBidAgent();
  const recent = agent.useRecent();
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim());
  const list = source.useTenderList({
    portal: null,
    org: null,
    search,
    savedOnly: false,
    closingSoon: false,
    sort: 'closing',
    paused: search.length < 2,
  });
  const results = search.length >= 2 ? list.items.slice(0, 20) : [];

  const open = (tenderId: string, title: string) =>
    navigation.navigate('BidAgentChat', { tenderId, title });

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Close" onPress={() => navigation.goBack()}>
          <ChevronDown size={22} color={t.colors.ink} />
        </IconButton>
        <View style={[styles.tile, { backgroundColor: t.colors.accent }]}>
          <Sparkles size={17} color={t.colors.onAccent} />
        </View>
        <View style={styles.titleBox}>
          <Text style={[styles.title, { color: t.colors.ink }]}>Bid Agent</Text>
          <Text style={[styles.sub, { color: t.colors.muted }]}>Pick a tender to ask about it.</Text>
        </View>
        <IconButton label="Bid Agent settings and training" onPress={() => navigation.navigate('BidAgentSettings')}>
          <Settings2 size={20} color={t.colors.ink} />
        </IconButton>
      </View>

      <SearchField value={query} onChangeText={setQuery} placeholder="Tender ID or title" />

      {search.length >= 2 ? (
        <>
          <Text style={[styles.section, { color: t.colors.muted }]}>Tenders</Text>
          <Card padding={4} radius="lg" elevation="sm">
            {list.loading && !results.length ? (
              <ActivityIndicator style={styles.pad} color={t.colors.accent} />
            ) : results.length ? (
              results.map((x, i) => (
                <Row
                  key={x.id}
                  title={x.title}
                  sub={`${x.refId ?? x.id} · ${x.org}`}
                  last={i === results.length - 1}
                  onPress={() => open(x.id, x.title)}
                />
              ))
            ) : (
              <Text style={[styles.empty, { color: t.colors.muted }]}>
                {list.error ?? 'No tender matches. Try the full tender ID.'}
              </Text>
            )}
          </Card>
        </>
      ) : null}

      <Text style={[styles.section, { color: t.colors.muted }]}>Recent chats</Text>
      <Card padding={4} radius="lg" elevation="sm">
        {recent.loading ? (
          <ActivityIndicator style={styles.pad} color={t.colors.accent} />
        ) : recent.items.length ? (
          recent.items.map((r, i) => (
            <Row
              key={`${r.id}-${r.tender_id}`}
              icon
              title={r.title || r.tender_id}
              sub={r.last}
              last={i === recent.items.length - 1}
              onPress={() => open(r.id ? String(r.id) : r.tender_id, r.title)}
            />
          ))
        ) : (
          <Text style={[styles.empty, { color: t.colors.muted }]}>
            No chats yet. Search a tender above, or open one from Tenders or Projects.
          </Text>
        )}
      </Card>
    </Screen>
  );
}

function Row({
  title,
  sub,
  last,
  icon,
  onPress,
}: {
  title: string;
  sub: string;
  last: boolean;
  icon?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Chat about ${title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.hair },
        pressed && { backgroundColor: t.colors.surfaceSunk },
      ]}
    >
      {icon ? <MessageSquare size={16} color={t.colors.accent} /> : null}
      <View style={styles.rowText}>
        <Text numberOfLines={2} style={[styles.rowTitle, { color: t.colors.ink }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSub, { color: t.colors.muted }]}>
          {sub}
        </Text>
      </View>
      <ChevronRight size={16} color={t.colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 14 },
  tile: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  titleBox: { flex: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  sub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },
  section: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12 },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 14 },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  empty: { fontFamily: fonts.regular, fontSize: 13, padding: 14, lineHeight: 19 },
  pad: { padding: 16 },
});
