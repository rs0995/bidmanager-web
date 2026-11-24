import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { DownloadCloud, Globe, RefreshCw } from 'lucide-react-native';
import { TenderListPage } from '../../components/tender/TenderListPage';
import { useDebounced } from '../../components/feedback/ListStatus';
import { Button, Card, IconButton, useToast } from '../../components/ui';
import { Spinning } from '../../components/ui/motion';
import { useTenderSource } from '../../data/tenderSource';
import {
  ORG_COOLDOWN_MS,
  requestOrgTenders,
  scrapeCooldownMessage,
  useOrgRequestPending,
} from '../../lib/orgRequests';
import { fonts, useTheme } from '../../theme';
import { useAccess } from '../../lib/account';
import { closedLabel } from './ArchiveScreen';
import type { RootStackParamList } from '../navigation/types';

const SORTS = [
  { key: 'closing' as const, label: 'Closing soonest' },
  { key: 'value' as const, label: 'Highest value' },
];

/**
 * One organisation's tenders, opened by tapping its row (as BM Pro's organisation page),
 * with search and sort, and BM Pro's sync button and "Request tenders" for an
 * organisation not fetched yet. From Archive it lists that organisation's closed tenders.
 */
export function OrgTendersScreen() {
  const t = useTheme();
  const toast = useToast();
  const { params } = useRoute<RouteProp<RootStackParamList, 'OrgTenders'>>();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'closing' | 'value'>('closing');
  const query = useDebounced(search, 300);
  const source = useTenderSource();
  const list = source.useTenderList({
    portal: params.portal ?? null,
    org: params.org,
    search: query,
    savedOnly: false,
    closingSoon: false,
    sort,
    archived: params.archived,
  });
  const meta = source.useOrgMeta(params.org, params.portal ?? null);
  // Requesting needs the active section (the server refuses it otherwise).
  const active = useAccess().active;
  const orgId = params.archived || !active ? undefined : meta?.id;
  const pending = useOrgRequestPending(orgId);

  // As BM Pro: within 24 h of the last fetch the server refuses, so say when it's due.
  const request = useCallback(async () => {
    if (orgId === undefined || pending) return;
    const last = meta?.lastScrapedAt ?? 0;
    if (last > 0 && Date.now() - last * 1000 < ORG_COOLDOWN_MS) {
      toast.show(`Update not due yet. ${scrapeCooldownMessage(last)}`);
      return;
    }
    try {
      await requestOrgTenders(orgId);
      toast.show(
        'Fetching tenders for this organisation — this can take a few minutes.',
      );
    } catch (e) {
      const msg = (e as Error).message || '';
      toast.show(
        /already/i.test(msg)
          ? 'This organisation is already being updated.'
          : /less than 24 hours/i.test(msg)
          ? `Update not due yet. ${scrapeCooldownMessage(last)}`
          : `Couldn’t request tenders: ${msg}`,
      );
    }
  }, [orgId, pending, meta?.lastScrapedAt, toast]);

  const noun = params.archived ? 'closed tender' : 'tender';
  return (
    <TenderListPage
      titleBand
      title={params.org}
      sub={
        list.total > 0
          ? `${list.total} ${noun}${list.total === 1 ? '' : 's'}`
          : ''
      }
      action={
        orgId !== undefined ? (
          <IconButton
            label={pending ? 'Requesting tenders' : 'Request tenders'}
            onPress={request}
          >
            <Spinning spinning={pending}>
              <RefreshCw size={18} color={t.colors.accent} />
            </Spinning>
          </IconButton>
        ) : null
      }
      tenders={list.items}
      loading={list.loading}
      error={list.error}
      emptyText={
        params.archived
          ? 'No closed tenders from this organisation.'
          : 'No open tenders from this organisation.'
      }
      emptyContent={
        params.archived || query ? undefined : (
          <Card style={styles.empty}>
            <Globe size={40} color={t.colors.muted} strokeWidth={1.6} />
            <Text style={[styles.emptyTitle, { color: t.colors.ink }]}>
              No tenders yet
            </Text>
            {orgId !== undefined ? (
              // Button sizes to its label at the left by default: centre it.
              <View style={styles.emptyAction}>
                <Button
                  label={pending ? 'Requesting…' : 'Request tenders'}
                  variant="outline"
                  size="sm"
                  loading={pending}
                  icon={<DownloadCloud size={15} color={t.colors.accentInk} />}
                  onPress={request}
                />
              </View>
            ) : null}
          </Card>
        )
      }
      search={search}
      onSearch={setSearch}
      sort={sort}
      sorts={SORTS}
      onSort={setSort}
      hasMore={list.hasMore}
      onLoadMore={list.loadMore}
      badgeText={params.archived ? closedLabel : undefined}
    />
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, paddingVertical: 36, marginTop: 4 },
  emptyAction: { alignSelf: 'center' },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 15 },
});
