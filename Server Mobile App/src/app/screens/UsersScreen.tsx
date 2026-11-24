import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Building2, ChevronRight, Copy, Plus, RefreshCw, Users as UsersIcon } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { AccountPill, UserPickerSheet, sectionOn } from '../../components/OrgPieces';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  FilterChips,
  IconButton,
  ListRow,
  Screen,
  SearchField,
  SegmentedControl,
  Sheet,
  StatStrip,
  StatusPill,
  TextField,
  Txt,
  useToast,
} from '../../components/ui';
import { fmtAgo, fmtDateTime, fromSecs, pad2 } from '../../lib/format';
import { useAction, useOrgs, useUsers } from '../../lib/queries';
import type { ClientUser } from '../../lib/types';
import { clipboard } from '../../platform';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type View_ = 'people' | 'orgs';
type Filter = 'all' | 'active' | 'suspended' | 'individual' | 'organisation';
type Nav = NativeStackNavigationProp<RootStackParamList>;

// UsersPanel from the desktop: client accounts (People) and, since the
// 2026-10-23 server update, organisations. Polls both every 15 s.
export function UsersScreen() {
  const t = useTheme();
  const nav = useNavigation<Nav>();
  const toast = useToast();
  const users = useUsers();
  const orgs = useOrgs();
  const { run, busy } = useAction();
  const [view, setView] = useState<View_>('people');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  // New organisation: name sheet → pick admin → confirm.
  const [creating, setCreating] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [picking, setPicking] = useState(false);
  const [admin, setAdmin] = useState<ClientUser | null>(null);

  const list = useMemo(() => users.data ?? [], [users.data]);
  const active = list.filter(u => u.status === 'active').length;
  const suspended = list.filter(u => u.status === 'suspended').length;
  const shown = useMemo(
    () =>
      list.filter(u => {
        const type = u.account_type ?? 'individual';
        const pass =
          filter === 'all' ||
          (filter === 'individual' || filter === 'organisation' ? type === filter : u.status === filter);
        return pass && `${u.email} ${u.display_name}`.toLowerCase().includes(query.toLowerCase());
      }),
    [list, filter, query],
  );

  const copyCode = async (code: string) => {
    try {
      await clipboard.copy(code);
      toast('Join code copied');
    } catch {
      toast('Could not copy the join code');
    }
  };

  const createOrg = async () => {
    if (!admin) return;
    const name = orgName.trim();
    const created = await run('createOrg', a => a.createOrg(name, admin.id), {
      success: `Organisation "${name}" created`,
      invalidate: ['orgs', 'users'],
    });
    setAdmin(null);
    if (created) {
      setOrgName('');
      nav.navigate('OrgDetail', { orgId: created.id });
    }
  };

  return (
    <Screen
      tabBar
      header={
        <AppHeader
          code="USR"
          title="Users"
          right={
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              onPress={() => {
                users.refetch();
                orgs.refetch();
              }}
            />
          }
        />
      }
    >
      <SegmentedControl<View_>
        value={view}
        onChange={setView}
        options={[
          { value: 'people', label: 'People' },
          { value: 'orgs', label: 'Organisations' },
        ]}
      />

      {view === 'people' ? (
        !users.data ? (
          <QueryState what="users" loading={users.isPending} error={users.error} onRetry={() => users.refetch()} />
        ) : (
          <>
            <StatStrip
              items={[
                { label: 'Active', value: pad2(active), tone: 'ok' },
                { label: 'Suspended', value: pad2(suspended), tone: 'bad' },
                { label: 'Total', value: pad2(list.length) },
              ]}
            />
            <SearchField value={query} onChangeText={setQuery} placeholder="Search email or name" />
            <FilterChips<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
                { value: 'individual', label: 'Individual' },
                { value: 'organisation', label: 'Organisation' },
              ]}
            />
            <Card pad={false}>
              {shown.length === 0 ? (
                <EmptyState
                  icon={UsersIcon}
                  title={list.length ? 'No matching users.' : 'Nobody has signed in from the client app yet.'}
                />
              ) : (
                shown.map((u, i) => (
                  <ListRow
                    key={u.id}
                    title={u.display_name || u.email}
                    subtitle={u.display_name ? u.email : undefined}
                    meta={`seen ${fmtAgo(fromSecs(u.last_seen_at))} · ${u.activity_count} actions`}
                    divider={i > 0}
                    chevron
                    onPress={() => nav.navigate('UserDetail', { userId: u.id })}
                  >
                    <View style={styles.pills}>
                      <AccountPill user={u} />
                      {u.permissions && (u.org?.role === 'admin' || sectionOn(u.permissions, 'portal_search')) ? (
                        <StatusPill tone="info" label="Portal search" />
                      ) : null}
                      {u.status !== 'active' ? <StatusPill tone="bad" label={u.status} /> : null}
                    </View>
                  </ListRow>
                ))
              )}
            </Card>
          </>
        )
      ) : orgs.data === undefined ? (
        <QueryState what="organisations" loading={orgs.isPending} error={orgs.error} onRetry={() => orgs.refetch()} />
      ) : orgs.data === null ? (
        <Card>
          <EmptyState icon={Building2} title="Organisations aren't available on this server." />
        </Card>
      ) : (
        <>
          <View style={styles.orgHead}>
            <Txt variant="small" color="ink2" style={styles.flex}>
              Members share the organisation's bookmarks and projects. Sections control
              what each member's app shows.
            </Txt>
            <Button label="New" icon={Plus} size="sm" variant="primary" onPress={() => setCreating(true)} />
          </View>
          {orgs.data.length === 0 ? (
            <Card>
              <EmptyState icon={Building2} title="No organisations yet." />
            </Card>
          ) : (
            orgs.data.map(o => (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${o.name}`}
                onPress={() => nav.navigate('OrgDetail', { orgId: o.id })}
                style={({ pressed }) => [
                  styles.orgCard,
                  { backgroundColor: pressed ? t.colors.raised : t.colors.surface, borderColor: t.colors.hair },
                ]}
              >
                <View style={styles.orgTitleRow}>
                  <Txt style={[styles.orgName, { color: t.colors.ink }]} numberOfLines={1}>
                    {o.name}
                  </Txt>
                  {o.pending_requests > 0 ? (
                    <StatusPill tone="warn" label={`${o.pending_requests} pending`} />
                  ) : null}
                  <ChevronRight size={18} color={t.colors.ink3} />
                </View>
                <View style={styles.orgMetaRow}>
                  <Txt variant="bodyStrong">
                    {o.member_count} member{o.member_count === 1 ? '' : 's'}
                  </Txt>
                  <View style={styles.flex} />
                  <Txt variant="label">Code</Txt>
                  <Txt variant="mono">{o.join_code}</Txt>
                  <IconButton icon={Copy} label="Copy join code" onPress={() => copyCode(o.join_code)} />
                </View>
                <Txt variant="monoSmall" color="ink3">
                  Created {fmtDateTime(fromSecs(o.created_at))}
                </Txt>
              </Pressable>
            ))
          )}
        </>
      )}

      <Sheet visible={creating} onClose={() => setCreating(false)} title="New organisation">
        <TextField label="Organisation name" value={orgName} onChangeText={setOrgName} placeholder="e.g. Rakshit Infra" />
        <Txt variant="small" color="ink3">
          Next, pick the individual account that becomes its admin.
        </Txt>
        <Button
          label="Choose admin"
          variant="primary"
          disabled={!orgName.trim()}
          onPress={() => {
            setCreating(false);
            setPicking(true);
          }}
          block
        />
      </Sheet>
      <UserPickerSheet
        visible={picking}
        title="Choose the admin"
        users={list}
        onPick={u => {
          setPicking(false);
          setAdmin(u);
        }}
        onClose={() => setPicking(false)}
      />
      <ConfirmSheet
        visible={!!admin}
        title={`Create "${orgName.trim()}"?`}
        message={`${admin?.email ?? ''} becomes its admin. Their bookmarks and projects become the organisation's shared data.`}
        confirmLabel={busy === 'createOrg' ? 'Creating…' : 'Create'}
        onConfirm={createOrg}
        onClose={() => setAdmin(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  orgHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2 },
  orgCard: { borderWidth: 1, padding: 14, gap: 8 },
  orgTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orgName: { flex: 1, fontFamily: fonts.cond, fontSize: 17 },
  orgMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
