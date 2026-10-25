import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Activity,
  Ban,
  Bookmark,
  Building2,
  Copy,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  RotateCcw,
  UserCheck,
  type LucideIcon,
} from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  ConfirmSheet,
  ListRow,
  Screen,
  Section,
  StatusPill,
  Txt,
  useToast,
} from '../../components/ui';
import { fmtAgo, fmtDateTime, fromSecs } from '../../lib/format';
import { useAction, useUser } from '../../lib/queries';
import { clipboard } from '../../platform';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';
import type { UserSyncSection } from './UserSyncListScreen';
import { AccountPill, SECTIONS as ACCESS_SECTIONS, SectionToggles } from '../../components/OrgPieces';
import type { Section as SectionKey } from '../../lib/types';

type Props = NativeStackScreenProps<RootStackParamList, 'UserDetail'>;

const SECTIONS: { key: UserSyncSection; label: string; icon: LucideIcon }[] = [
  { key: 'bookmarks', label: 'Bookmarked tenders', icon: Bookmark },
  { key: 'orgs', label: 'Bookmarked organizations', icon: Building2 },
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  { key: 'templates', label: 'Templates', icon: FileText },
  { key: 'activity', label: 'Recent activity', icon: Activity },
];

// One client user (UserSyncDetail on the desktop): account, password and actions
// on this page; each part of their synced data opens its own page.
export function UserDetailScreen({ route, navigation }: Props) {
  const t = useTheme();
  const toast = useToast();
  const id = Number(route.params.userId);
  const user = useUser(id);
  const { run, busy } = useAction();
  const [reveal, setReveal] = useState(false);
  const [confirm, setConfirm] = useState<'suspend' | 'reset' | null>(null);
  const u = user.data;
  const after = { invalidate: ['user', 'users'] };
  const [busySection, setBusySection] = useState<SectionKey | null>(null);

  const setSection = async (section: SectionKey, on: boolean) => {
    if (!u) return;
    setBusySection(section);
    const label = ACCESS_SECTIONS.find(s => s.key === section)?.label ?? section;
    await run(`perm:${section}`, a => a.setUserPermissions(id, { [section]: on }), {
      success: `${label} ${on ? 'on' : 'off'} for ${u.email}`,
      invalidate: ['user', 'users', 'org'],
    });
    setBusySection(null);
  };

  const copy = async (text: string, what: string) => {
    try {
      await clipboard.copy(text);
      toast(`${what} copied`);
    } catch {
      toast(`Could not copy the ${what.toLowerCase()}`);
    }
  };

  const counts: Record<UserSyncSection, number> = u
    ? {
        bookmarks: u.sync.bookmarks.length,
        orgs: u.sync.bookmarked_orgs.length,
        projects: u.sync.projects.length,
        templates: u.sync.templates.length,
        activity: u.recent_activity.length,
      }
    : { bookmarks: 0, orgs: 0, projects: 0, templates: 0, activity: 0 };

  return (
    <Screen header={<AppHeader back code="USR" title="User" />}>
      {!u ? (
        <QueryState
          what="this user"
          loading={user.isPending}
          error={user.error}
          onRetry={() => user.refetch()}
        />
      ) : (
        <>
          <Card pad={false}>
            <View style={styles.account}>
              <View style={styles.nameRow}>
                <Txt style={[styles.name, { color: t.colors.ink }]} numberOfLines={1}>
                  {u.display_name || u.email}
                </Txt>
                <StatusPill tone={u.status === 'active' ? 'ok' : 'bad'} label={u.status} />
              </View>
              {u.account_type ? (
                <Pressable
                  accessibilityRole={u.org ? 'button' : undefined}
                  disabled={!u.org}
                  onPress={() => u.org && navigation.navigate('OrgDetail', { orgId: u.org.id })}
                  style={styles.accountRow}
                >
                  <AccountPill user={u} />
                  {u.org ? <Txt variant="small" color="accent">Open organisation ›</Txt> : null}
                </Pressable>
              ) : null}
              {u.display_name ? (
                <Txt variant="mono" color="ink2" numberOfLines={1}>
                  {u.email}
                </Txt>
              ) : null}
              <View
                style={[
                  styles.pw,
                  { backgroundColor: t.colors.raised, borderColor: t.colors.hair },
                ]}
              >
                <Txt variant="label" style={styles.pwLabel}>
                  Password
                </Txt>
                <Txt variant="mono" style={styles.flex} numberOfLines={1}>
                  {u.password == null ? 'Not available' : reveal ? u.password : '••••••••••'}
                </Txt>
                {u.password != null ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
                      onPress={() => setReveal(r => !r)}
                      hitSlop={8}
                    >
                      {reveal ? (
                        <EyeOff size={16} color={t.colors.ink3} />
                      ) : (
                        <Eye size={16} color={t.colors.ink3} />
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Copy password"
                      onPress={() => copy(u.password!, 'Password')}
                      hitSlop={8}
                    >
                      <Copy size={15} color={t.colors.ink3} />
                    </Pressable>
                  </>
                ) : null}
              </View>
              <View style={styles.dates}>
                <Txt variant="monoSmall" color="ink2">
                  Seen {fmtAgo(fromSecs(u.last_seen_at)).replace(/^never$/, 'Never')}
                </Txt>
                <Txt variant="monoSmall" color="ink2">
                  Login {fmtAgo(fromSecs(u.last_login_at)).replace(/^never$/, 'Never')}
                </Txt>
              </View>
              <View style={styles.dates}>
                <Txt variant="monoSmall" color="ink2">
                  Joined {fmtDateTime(fromSecs(u.created_at))}
                </Txt>
                <Txt variant="monoSmall" color="ink2">
                  Synced {u.sync.synced_at ? fmtAgo(fromSecs(u.sync.synced_at)) : 'Never'}
                </Txt>
              </View>
            </View>
            <View
              style={[
                styles.actions,
                { backgroundColor: t.colors.raised, borderTopColor: t.colors.hairSoft },
              ]}
            >
              {u.status === 'active' ? (
                <Button
                  label="Suspend"
                  icon={Ban}
                  size="sm"
                  variant="danger"
                  busy={busy === 'suspend'}
                  style={styles.flex}
                  onPress={() => setConfirm('suspend')}
                />
              ) : (
                <Button
                  label="Reactivate"
                  icon={UserCheck}
                  size="sm"
                  busy={busy === 'reactivate'}
                  style={styles.flex}
                  onPress={() =>
                    run('reactivate', a => a.reactivateUser(id), {
                      success: 'User reactivated',
                      ...after,
                    })
                  }
                />
              )}
              <Button
                label="Reset synced data"
                icon={RotateCcw}
                size="sm"
                busy={busy === 'reset'}
                style={styles.flex}
                onPress={() => setConfirm('reset')}
              />
            </View>
          </Card>

          {u.permissions ? (
            <Section title="Access" pad={false}>
              <View style={styles.access}>
                <Txt variant="small" color="ink3">
                  {u.org?.role === 'admin'
                    ? `Admin of ${u.org.name}. Organisation admins always have every section.`
                    : u.org
                    ? `Member of ${u.org.name}. The synced data below is the organisation's shared pool.`
                    : 'Individual account. A section turned off stops the app receiving that data; nothing stored is deleted.'}
                </Txt>
                <SectionToggles
                  value={u.permissions}
                  locked={u.org?.role === 'admin'}
                  busyKey={busySection}
                  onChange={setSection}
                />
              </View>
            </Section>
          ) : null}

          <Section title="Synced data" pad={false}>
            {SECTIONS.map((s, i) => (
              <ListRow
                key={s.key}
                icon={s.icon}
                title={s.label}
                divider={i > 0}
                chevron
                right={
                  <Txt variant="mono" color={counts[s.key] ? 'ink' : 'ink3'}>
                    {counts[s.key]}
                  </Txt>
                }
                onPress={() =>
                  navigation.navigate('UserSyncList', { userId: id, section: s.key })
                }
              />
            ))}
          </Section>
        </>
      )}

      <ConfirmSheet
        visible={confirm === 'suspend'}
        title="Suspend this user?"
        message="All of their sign-ins are revoked immediately. You can reactivate them later."
        confirmLabel="Suspend"
        danger
        onConfirm={() =>
          run('suspend', a => a.suspendUser(id), { success: 'User suspended', ...after })
        }
        onClose={() => setConfirm(null)}
      />
      <ConfirmSheet
        visible={confirm === 'reset'}
        title="Reset synced data?"
        message="Wipes the server copy of this user's bookmarks, projects, templates and checklist."
        confirmLabel="Reset"
        danger
        onConfirm={() =>
          run('reset', a => a.resetUserSync(id), { success: 'Synced data reset', ...after })
        }
        onClose={() => setConfirm(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  account: { padding: 14, gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  access: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  name: { flex: 1, fontFamily: fonts.cond, fontSize: 19 },
  pw: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    marginVertical: 2,
  },
  pwLabel: { width: 74 },
  dates: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
});
