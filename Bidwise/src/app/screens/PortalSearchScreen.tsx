import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Search,
  ShieldQuestion,
  Trash2,
} from 'lucide-react-native';
import {
  Button,
  Card,
  Field,
  IconButton,
  Screen,
  useToast,
} from '../../components/ui';
import { useCaptcha } from '../../fixtures/captcha';
import { useTenderSource } from '../../data/tenderSource';
import { api } from '../../lib/api';
import type { PortalSearch } from '../../lib/api';
import { getRaw, setRaw } from '../../lib/kv';
import { showActionSheet } from '../../platform/actionSheet';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** The portal last searched, so the next search starts there. */
const SITE_KEY = 'bw.portalSearchSite';
const HISTORY_KEY = ['portal-search-history'];
/** How often history is re-read while a search is still running. */
const POLL_MS = 2500;

/** The line under a history row: what the search found, or why it didn't. */
export function searchOutcome(s: PortalSearch): string {
  if (s.status === 'pending') return 'Searching the portal…';
  if (s.status === 'not_found') return 'Not on the portal';
  if (s.status === 'failed') return s.error || 'The search failed';
  const where = s.created
    ? s.is_archived
      ? 'Added to archive'
      : 'Added to current'
    : 'Updated';
  return s.stage ? `${s.stage} · ${where}` : where;
}

function StatusChip({ status }: { status: PortalSearch['status'] }) {
  const t = useTheme();
  const look = {
    pending: {
      label: 'Searching',
      bg: t.colors.accentWash,
      fg: t.colors.accentInk,
    },
    found: { label: 'Found', bg: t.colors.goodWash, fg: t.colors.good },
    not_found: {
      label: 'Not found',
      bg: t.colors.surfaceSunk,
      fg: t.colors.muted,
    },
    failed: { label: 'Failed', bg: t.colors.critWash, fg: t.colors.crit },
  }[status];
  return (
    <View style={[styles.chip, { backgroundColor: look.bg }]}>
      <Text style={[styles.chipText, { color: look.fg }]}>{look.label}</Text>
    </View>
  );
}

/**
 * Search a tender ID on a NIC portal (the server reads the portal's Tender Status page).
 * A tender already known is updated for everyone; a new one is added to the current list,
 * or to the archive once it is past bidding. Each account keeps its own history.
 */
export function PortalSearchScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const demo = useTenderSource().mode === 'demo';
  const { pending: captcha } = useCaptcha();

  const portals = useQuery({
    queryKey: ['portal-search-portals'],
    queryFn: () => api.portalSearchPortals(),
    enabled: !demo,
    staleTime: 10 * 60_000,
  });
  const [siteId, setSiteId] = useState<number | null>(
    () => Number(getRaw(SITE_KEY)) || null,
  );
  const sites = portals.data?.items ?? [];
  const site = sites.find(p => p.id === siteId) ?? sites[0];
  const [tenderId, setTenderId] = useState('');
  const [starting, setStarting] = useState(false);

  const history = useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => api.portalSearchHistory(50),
    enabled: !demo,
    // Re-read only while a search is still running.
    refetchInterval: q =>
      q.state.data?.items.some(i => i.status === 'pending') ? POLL_MS : false,
  });
  const items = useMemo(() => history.data?.items ?? [], [history.data]);
  const running = items.filter(i => i.status === 'pending');

  // While a search runs, look for a manual captcha on every poll (normally once a minute).
  useEffect(() => {
    if (running.length) qc.invalidateQueries({ queryKey: ['captcha-pending'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.dataUpdatedAt]);

  // A search that just found its tender: refresh the lists it now appears in.
  const lastStatus = useRef(new Map<number, string>());
  useEffect(() => {
    let found = false;
    for (const it of items) {
      if (
        lastStatus.current.get(it.id) === 'pending' &&
        it.status === 'found'
      ) {
        found = true;
        if (it.tender_db_id)
          qc.invalidateQueries({
            queryKey: ['tender', String(it.tender_db_id)],
          });
      }
      lastStatus.current.set(it.id, it.status);
    }
    if (found) {
      qc.invalidateQueries({ queryKey: ['tenders'] });
      qc.invalidateQueries({ queryKey: ['organizations'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    }
  }, [items, qc]);

  const pickPortal = () =>
    showActionSheet(
      'Search which portal?',
      sites.map(p => ({
        label: p.name,
        onPress: () => {
          setSiteId(p.id);
          setRaw(SITE_KEY, String(p.id));
        },
      })),
    );

  const id = tenderId.trim();
  const alreadyRunning = running.some(
    r => r.website_id === site?.id && r.tender_id === id,
  );

  const start = async () => {
    if (!site || !id || starting) return;
    setStarting(true);
    try {
      await api.startPortalSearch(site.id, id);
      setTenderId('');
      await qc.invalidateQueries({ queryKey: HISTORY_KEY });
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const remove = (s: PortalSearch) =>
    api
      .deletePortalSearch(s.id)
      .then(() => qc.invalidateQueries({ queryKey: HISTORY_KEY }))
      .catch(e => toast.show((e as Error).message));

  const open = (s: PortalSearch) => {
    if (s.status !== 'found' || !s.tender_db_id) return;
    if (!s.tender) {
      toast.show('This tender is in a section your account can’t open.');
      return;
    }
    navigation.navigate('TenderDetail', { id: String(s.tender_db_id) });
  };

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <Text style={[styles.title, { color: t.colors.ink }]}>
        Search on portal
      </Text>
      <Text style={[styles.sub, { color: t.colors.muted }]}>
        Find a tender by its ID on a NIC portal. It’s added to Tenders, or to
        Archive once past bidding; a tender already here is updated.
      </Text>

      {demo ? (
        <Card style={styles.card}>
          <Text style={[styles.body, { color: t.colors.inkSoft }]}>
            Searching a portal needs a signed-in account, not the demo.
          </Text>
        </Card>
      ) : (
        <Card style={styles.card}>
          <Text style={[styles.label, { color: t.colors.muted }]}>Portal</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Portal: ${site?.name ?? 'none'}`}
            onPress={pickPortal}
            disabled={sites.length < 2}
            style={[styles.picker, { borderColor: t.colors.hair }]}
          >
            <Globe size={16} color={t.colors.muted} />
            <Text
              numberOfLines={1}
              style={[styles.pickerText, { color: t.colors.ink }]}
            >
              {portals.isLoading
                ? 'Loading portals…'
                : site?.name ?? 'No portal can be searched'}
            </Text>
            {sites.length > 1 ? (
              <ChevronDown size={16} color={t.colors.muted} />
            ) : null}
          </Pressable>
          <Field
            label="Tender ID"
            value={tenderId}
            onChangeText={setTenderId}
            placeholder="e.g. 2026_MMRDA_1341650_1"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={start}
          />
          <Button
            label={alreadyRunning ? 'Already searching' : 'Search'}
            block
            loading={starting}
            disabled={!site || !id || alreadyRunning}
            icon={<Search size={16} color={t.colors.onAccent} />}
            onPress={start}
          />
          {running.length ? (
            <View style={styles.running}>
              <ActivityIndicator size="small" color={t.colors.accent} />
              <Text
                style={[styles.body, styles.flex, { color: t.colors.inkSoft }]}
              >
                Searching{' '}
                {running
                  .map(r => `${r.tender_id} on ${r.website_name}`)
                  .join(', ')}
                …
              </Text>
            </View>
          ) : null}
          {running.length && captcha ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="A captcha needs you"
              onPress={() => navigation.navigate('Captcha')}
              style={[styles.captcha, { backgroundColor: t.colors.warnWash }]}
            >
              <ShieldQuestion size={18} color={t.colors.warn} />
              <Text style={[styles.captchaText, { color: t.colors.warn }]}>
                A captcha needs you to finish the search
              </Text>
              <ChevronRight size={16} color={t.colors.warn} />
            </Pressable>
          ) : null}
        </Card>
      )}

      {!demo ? (
        <>
          <View style={styles.historyHead}>
            <Text style={[styles.section, { color: t.colors.muted }]}>
              Your searches
            </Text>
            {items.length ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  showActionSheet('Clear your search history?', [
                    {
                      label: 'Clear history',
                      destructive: true,
                      onPress: () => {
                        api
                          .clearPortalSearchHistory()
                          .then(() =>
                            qc.invalidateQueries({ queryKey: HISTORY_KEY }),
                          )
                          .catch(e => toast.show((e as Error).message));
                      },
                    },
                  ])
                }
                hitSlop={8}
              >
                <Text style={[styles.clear, { color: t.colors.accent }]}>
                  Clear history
                </Text>
              </Pressable>
            ) : null}
          </View>
          {history.isLoading ? (
            <ActivityIndicator style={styles.loading} color={t.colors.accent} />
          ) : items.length === 0 ? (
            <Text style={[styles.empty, { color: t.colors.muted }]}>
              Searches you run show here.
            </Text>
          ) : (
            <Card padding={4} style={styles.card}>
              {items.map((s, i) => (
                <View
                  key={s.id}
                  style={[
                    styles.row,
                    i > 0 && [
                      styles.divider,
                      { borderTopColor: t.colors.hair },
                    ],
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${s.tender_id}, ${searchOutcome(s)}`}
                    disabled={s.status !== 'found'}
                    onPress={() => open(s)}
                    style={styles.rowMain}
                  >
                    <View style={styles.rowTop}>
                      <Text
                        numberOfLines={1}
                        style={[styles.tid, { color: t.colors.ink }]}
                      >
                        {s.tender_id}
                      </Text>
                      <StatusChip status={s.status} />
                    </View>
                    <Text style={[styles.meta, { color: t.colors.muted }]}>
                      {s.website_name}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.outcome,
                        {
                          color:
                            s.status === 'failed'
                              ? t.colors.crit
                              : t.colors.inkSoft,
                        },
                      ]}
                    >
                      {searchOutcome(s)}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${s.tender_id} from history`}
                    onPress={() => remove(s)}
                    hitSlop={8}
                    style={styles.trash}
                  >
                    <Trash2 size={16} color={t.colors.muted} />
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 16,
  },
  card: { marginBottom: 14, gap: 10 },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  label: { fontFamily: fonts.medium, fontSize: 11.5 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  pickerText: { flex: 1, fontFamily: fonts.medium, fontSize: 14 },
  running: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  captcha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  captchaText: { flex: 1, fontFamily: fonts.semibold, fontSize: 13 },
  historyHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  section: { fontFamily: fonts.semibold, fontSize: 12 },
  clear: { fontFamily: fonts.semibold, fontSize: 12.5 },
  loading: { marginTop: 20 },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  divider: { borderTopWidth: 1 },
  rowMain: { flex: 1, paddingHorizontal: 12, paddingVertical: 12, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tid: { flex: 1, fontFamily: fonts.monoSemibold, fontSize: 13 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  outcome: { fontFamily: fonts.medium, fontSize: 12.5 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontFamily: fonts.semibold, fontSize: 10.5 },
  trash: { padding: 14 },
});
