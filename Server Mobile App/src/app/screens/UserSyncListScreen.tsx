import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Inbox } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { QueryState } from '../../components/QueryState';
import {
  Card,
  EmptyState,
  ListRow,
  Screen,
  SearchField,
  StatusPill,
  Txt,
} from '../../components/ui';
import { fmtDateTime, fromSecs } from '../../lib/format';
import { useUser } from '../../lib/queries';
import type { UserDetail } from '../../lib/types';
import type { RootStackParamList } from '../navigation/types';

export type UserSyncSection = 'bookmarks' | 'orgs' | 'projects' | 'templates' | 'activity';

type Props = NativeStackScreenProps<RootStackParamList, 'UserSyncList'>;

type Row = { key: string; title: string; subtitle?: string; meta?: string; pill?: string };

export const SYNC_SECTIONS: Record<
  UserSyncSection,
  { title: string; rows: (u: UserDetail) => Row[] }
> = {
  bookmarks: {
    title: 'Bookmarked tenders',
    rows: u =>
      u.sync.bookmarks.map(b => ({
        key: String(b.id),
        title: b.title || b.tender_id,
        subtitle: (b.org_chain || '').replace(/\s*\|\|\s*/g, ' › ') || undefined,
        meta: `${b.tender_id} · ${b.website_name}`,
      })),
  },
  orgs: {
    title: 'Bookmarked organizations',
    rows: u => u.sync.bookmarked_orgs.map(o => ({ key: o, title: o })),
  },
  projects: {
    title: 'Projects',
    rows: u =>
      u.sync.projects.map((p, i) => ({
        key: `${String(p.id)}-${i}`,
        title: p.title || 'Untitled project',
        subtitle: p.client_name || undefined,
        pill: p.status || 'Active',
      })),
  },
  templates: {
    title: 'Templates',
    rows: u =>
      u.sync.templates.map((tp, i) => ({
        key: `${String(tp.id)}-${i}`,
        title: tp.template_name || 'Untitled template',
        subtitle: tp.organization || undefined,
      })),
  },
  activity: {
    title: 'Recent activity',
    rows: u =>
      u.recent_activity.map((a, i) => ({
        key: `${a.created_at}-${i}`,
        title: a.route,
        meta: `${fmtDateTime(fromSecs(a.created_at))}${a.tender_id ? ` · tender ${a.tender_id}` : ''}`,
      })),
  },
};

// One part of a client user's synced data, on its own page (opened from the
// user's page). Reads the same cached user query, so no extra request is made.
export function UserSyncListScreen({ route }: Props) {
  const id = Number(route.params.userId);
  const section = SYNC_SECTIONS[route.params.section] ?? SYNC_SECTIONS.bookmarks;
  const user = useUser(id);
  const [query, setQuery] = useState('');
  const u = user.data;
  const rows = u ? section.rows(u) : [];
  const shown = rows.filter(r =>
    `${r.title} ${r.subtitle ?? ''} ${r.meta ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Screen header={<AppHeader back code="USR" title={section.title} />}>
      {!u ? (
        <QueryState
          what="this user"
          loading={user.isPending}
          error={user.error}
          onRetry={() => user.refetch()}
        />
      ) : (
        <>
          <View style={styles.who}>
            <Txt variant="bodyStrong" numberOfLines={1} style={styles.flex}>
              {u.display_name || u.email}
            </Txt>
            <Txt variant="monoSmall" color="ink3">
              {rows.length}
            </Txt>
          </View>
          {rows.length > 8 ? (
            <SearchField value={query} onChangeText={setQuery} placeholder="Filter" />
          ) : null}
          <Card pad={false}>
            {shown.length === 0 ? (
              <EmptyState icon={Inbox} title={rows.length ? 'Nothing matches.' : 'Nothing here yet.'} />
            ) : (
              shown.map((r, i) => (
                <ListRow
                  key={r.key}
                  title={r.title}
                  subtitle={r.subtitle}
                  meta={r.meta}
                  divider={i > 0}
                  right={r.pill ? <StatusPill tone="info" label={r.pill} /> : undefined}
                />
              ))
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
});
