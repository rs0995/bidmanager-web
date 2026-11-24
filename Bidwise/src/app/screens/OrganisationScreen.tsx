import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react-native';
import {
  Button,
  Card,
  Field,
  IconButton,
  Screen,
  Sheet,
  useToast,
} from '../../components/ui';
import { useTenderSource } from '../../data/tenderSource';
import { DEFAULT_SECTIONS, refreshAccount, useAccess } from '../../lib/account';
import { api } from '../../lib/api';
import type { OrgMember, SectionPerms } from '../../lib/api';
import { getUser } from '../../lib/auth';
import { showActionSheet } from '../../platform/actionSheet';
import { fonts, useTheme } from '../../theme';

const SECTIONS: { key: keyof SectionPerms; label: string }[] = [
  { key: 'active', label: 'Active tenders' },
  { key: 'archived', label: 'Archived tenders' },
  { key: 'bookmarks', label: 'Bookmarks' },
  { key: 'projects', label: 'Projects' },
  { key: 'portal_search', label: 'Portal search' },
];

// The server's own wording (client_api.JOIN_DISCARD_WARNING), shown before sending.
const JOIN_WARNING =
  'When an admin approves this request, the projects, bookmarks and checklists now in your account are discarded and you use the organisation’s data instead.';

const day = (epochSeconds: number | null | undefined) =>
  epochSeconds
    ? new Date(epochSeconds * 1000).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const who = (p: { display_name: string; email: string }) =>
  p.display_name || p.email;

/** One switch per section (captcha is always on, so it isn't listed). */
function SectionSwitches({
  value,
  onChange,
  disabled,
}: {
  value: SectionPerms;
  onChange: (key: keyof SectionPerms, on: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View>
      {SECTIONS.map((s, i) => (
        <View
          key={s.key}
          style={[
            styles.switchRow,
            i > 0 && [styles.divider, { borderTopColor: t.colors.hair }],
          ]}
        >
          <Text style={[styles.switchLabel, { color: t.colors.ink }]}>
            {s.label}
          </Text>
          <Switch
            accessibilityLabel={s.label}
            value={value[s.key]}
            disabled={disabled}
            onValueChange={on => onChange(s.key, on)}
            trackColor={{ true: t.colors.accent, false: t.colors.surfaceSunk }}
            thumbColor="#ffffff"
            ios_backgroundColor={t.colors.surfaceSunk}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * The account's organisation (as the Server UI's Users tab, for the app): an individual
 * creates one or asks to join one; a member sees it and their sections; an admin renames
 * it, shares the join code, approves requests and sets each member's sections, role and
 * removal.
 */
export function OrganisationScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const demo = useTenderSource().mode === 'demo';
  const { account, isAdmin } = useAccess();
  const org = account.org;
  const pending = account.pending_request;

  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [note, setNote] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [rename, setRename] = useState('');
  const [approving, setApproving] = useState<number | null>(null);
  const [approvePerms, setApprovePerms] =
    useState<SectionPerms>(DEFAULT_SECTIONS);
  const [memberId, setMemberId] = useState<number | null>(null);

  // The admin may have changed something since this account was last fetched.
  useEffect(() => {
    if (!demo) refreshAccount().catch(() => {});
  }, [demo]);

  const detail = useQuery({
    queryKey: ['org'],
    queryFn: () => api.org(),
    enabled: !demo && isAdmin,
  });
  const member: OrgMember | undefined = detail.data?.members.find(
    m => m.user_id === memberId,
  );
  const me = getUser()?.user_id;

  /** Runs an organisation change, then refreshes the account and the org. */
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    if (demo) {
      toast.show('Organisations need a signed-in account, not the demo.');
      return false;
    }
    setBusy(true);
    try {
      await fn();
      if (done) toast.show(done);
      await refreshAccount().catch(() => {});
      await qc.invalidateQueries({ queryKey: ['org'] });
      return true;
    } catch (e) {
      toast.show((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <Text style={[styles.title, { color: t.colors.ink }]}>Organisation</Text>
      <Text style={[styles.sub, { color: t.colors.muted }]}>
        {org
          ? `${org.name} · ${isAdmin ? 'Admin' : 'Member'}`
          : 'Individual account'}
      </Text>
    </>
  );

  // --- Individual: create or join ---
  if (!org) {
    return (
      <Screen>
        {header}
        {pending ? (
          <Card style={styles.card}>
            <Text style={[styles.h3, { color: t.colors.ink }]}>
              Request to join {pending.org_name}
            </Text>
            <Text style={[styles.body, { color: t.colors.inkSoft }]}>
              Sent {day(pending.created_at)}. Waiting for an admin to approve
              it. Once approved you’re signed out; sign in again to use the
              organisation’s data.
            </Text>
            <Button
              label="Cancel request"
              variant="danger"
              size="sm"
              loading={busy}
              onPress={() =>
                run(() => api.cancelJoinRequest(), 'Request cancelled')
              }
            />
          </Card>
        ) : (
          <>
            <Card style={styles.card}>
              <Text style={[styles.h3, { color: t.colors.ink }]}>
                Create an organisation
              </Text>
              <Text style={[styles.body, { color: t.colors.inkSoft }]}>
                You become its admin. Your bookmarks and projects become the
                organisation’s, shared with everyone who joins.
              </Text>
              <Field
                label="Organisation name"
                value={newName}
                onChangeText={setNewName}
                autoCapitalize="words"
              />
              <Button
                label="Create organisation"
                block
                loading={busy}
                disabled={!newName.trim()}
                onPress={() =>
                  run(
                    () => api.createOrg(newName.trim()),
                    'Organisation created. You’re its admin.',
                  ).then(ok => ok && setNewName(''))
                }
              />
            </Card>
            <Card style={styles.card}>
              <Text style={[styles.h3, { color: t.colors.ink }]}>
                Join an organisation
              </Text>
              <Text style={[styles.body, { color: t.colors.inkSoft }]}>
                Ask its admin for the join code.
              </Text>
              <Field
                label="Join code"
                value={joinCode}
                onChangeText={v => setJoinCode(v.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Field
                label="Note to the admin (optional)"
                value={note}
                onChangeText={setNote}
              />
              <Button
                label="Request to join"
                block
                loading={busy}
                disabled={joinCode.trim().length < 4}
                onPress={() =>
                  showActionSheet(JOIN_WARNING, [
                    {
                      label: 'Send request',
                      onPress: () => {
                        run(
                          () => api.requestJoin(joinCode.trim(), note.trim()),
                          'Request sent',
                        ).then(ok => {
                          if (ok) {
                            setJoinCode('');
                            setNote('');
                          }
                        });
                      },
                    },
                  ])
                }
              />
            </Card>
          </>
        )}
      </Screen>
    );
  }

  // --- Member: the organisation and what this account can use ---
  if (!isAdmin) {
    return (
      <Screen>
        {header}
        <Card style={styles.card}>
          <Text style={[styles.h3, { color: t.colors.ink }]}>{org.name}</Text>
          <Text style={[styles.body, { color: t.colors.inkSoft }]}>
            Bookmarks and projects are shared with your organisation. Your admin
            decides which sections you can use.
          </Text>
          {SECTIONS.map(s => (
            <View key={s.key} style={styles.permRow}>
              <Text style={[styles.switchLabel, { color: t.colors.ink }]}>
                {s.label}
              </Text>
              <Text
                style={[
                  styles.permState,
                  {
                    color: account.permissions[s.key]
                      ? t.colors.good
                      : t.colors.muted,
                  },
                ]}
              >
                {account.permissions[s.key] ? 'On' : 'Off'}
              </Text>
            </View>
          ))}
        </Card>
      </Screen>
    );
  }

  // --- Admin ---
  const d = detail.data;
  return (
    <Screen>
      {header}
      {!d ? (
        detail.error ? (
          <Text style={[styles.body, { color: t.colors.crit }]}>
            Couldn’t load the organisation: {(detail.error as Error).message}
          </Text>
        ) : (
          <ActivityIndicator style={styles.loading} color={t.colors.accent} />
        )
      ) : (
        <>
          <Card style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={[styles.h3, styles.flex, { color: t.colors.ink }]}>
                {d.name}
              </Text>
              <Button
                label="Rename"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setRename(d.name);
                  setRenameOpen(true);
                }}
              />
            </View>
            <Text style={[styles.label, { color: t.colors.muted }]}>
              Join code
            </Text>
            <Text
              selectable
              accessibilityLabel={`Join code ${d.join_code}`}
              style={[styles.code, { color: t.colors.ink }]}
            >
              {d.join_code}
            </Text>
            <View style={styles.actions}>
              <View style={styles.flex}>
                <Button
                  label="Share code"
                  variant="secondary"
                  size="sm"
                  block
                  onPress={() =>
                    Share.share({
                      message: `Join ${d.name} on Bidwise with the code ${d.join_code}`,
                    }).catch(() => {})
                  }
                />
              </View>
              <View style={styles.flex}>
                <Button
                  label="New code"
                  variant="secondary"
                  size="sm"
                  block
                  onPress={() =>
                    showActionSheet(
                      'Make a new join code? The old one stops working.',
                      [
                        {
                          label: 'Make a new code',
                          destructive: true,
                          onPress: () => {
                            run(
                              () => api.regenerateJoinCode(),
                              'New join code made',
                            );
                          },
                        },
                      ],
                    )
                  }
                />
              </View>
            </View>
          </Card>

          <Text style={[styles.section, { color: t.colors.muted }]}>
            Join requests
          </Text>
          <Card style={styles.card}>
            {d.pending_requests.length === 0 ? (
              <Text style={[styles.body, { color: t.colors.muted }]}>
                No requests waiting.
              </Text>
            ) : (
              d.pending_requests.map((r, i) => (
                <View
                  key={r.id}
                  style={[
                    styles.request,
                    i > 0 && [
                      styles.divider,
                      { borderTopColor: t.colors.hair },
                    ],
                  ]}
                >
                  <Text style={[styles.name, { color: t.colors.ink }]}>
                    {who(r)}
                  </Text>
                  <Text style={[styles.meta, { color: t.colors.muted }]}>
                    {r.email} · {day(r.created_at)}
                  </Text>
                  {r.note ? (
                    <Text style={[styles.body, { color: t.colors.inkSoft }]}>
                      “{r.note}”
                    </Text>
                  ) : null}
                  <View style={styles.actions}>
                    <View style={styles.flex}>
                      <Button
                        label="Approve"
                        size="sm"
                        block
                        onPress={() => {
                          setApprovePerms(DEFAULT_SECTIONS);
                          setApproving(r.id);
                        }}
                      />
                    </View>
                    <View style={styles.flex}>
                      <Button
                        label="Reject"
                        variant="danger"
                        size="sm"
                        block
                        onPress={() =>
                          showActionSheet(`Reject ${who(r)}’s request?`, [
                            {
                              label: 'Reject request',
                              destructive: true,
                              onPress: () => {
                                run(
                                  () => api.rejectRequest(r.id),
                                  'Request rejected',
                                );
                              },
                            },
                          ])
                        }
                      />
                    </View>
                  </View>
                </View>
              ))
            )}
          </Card>

          <Text style={[styles.section, { color: t.colors.muted }]}>
            Members · {d.members.length}
          </Text>
          <Card style={styles.card} padding={4}>
            {d.members.map((m, i) => (
              <Pressable
                key={m.user_id}
                accessibilityRole="button"
                accessibilityLabel={`${who(m)}, ${m.role}`}
                onPress={() => setMemberId(m.user_id)}
                style={[
                  styles.memberRow,
                  i > 0 && [styles.divider, { borderTopColor: t.colors.hair }],
                ]}
              >
                <Users size={16} color={t.colors.muted} />
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: t.colors.ink }]}>
                    {who(m)}
                    {m.user_id === me ? ' (you)' : ''}
                  </Text>
                  <Text style={[styles.meta, { color: t.colors.muted }]}>
                    {m.role === 'admin' ? 'Admin' : 'Member'} ·{' '}
                    {m.role === 'admin'
                      ? 'All sections'
                      : `${
                          SECTIONS.filter(s => m.permissions[s.key]).length
                        } of ${SECTIONS.length} sections`}
                  </Text>
                </View>
                <ChevronRight size={16} color={t.colors.muted} />
              </Pressable>
            ))}
          </Card>
        </>
      )}

      <Sheet
        visible={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename organisation"
      >
        <Field
          label="Organisation name"
          value={rename}
          onChangeText={setRename}
        />
        <Button
          label="Save name"
          block
          loading={busy}
          disabled={!rename.trim()}
          onPress={() =>
            run(
              () => api.renameOrg(rename.trim()),
              'Organisation renamed',
            ).then(ok => ok && setRenameOpen(false))
          }
        />
      </Sheet>

      <Sheet
        visible={approving !== null}
        onClose={() => setApproving(null)}
        title="Approve request"
      >
        <Text style={[styles.body, { color: t.colors.inkSoft }]}>
          Choose the sections this member can use (portal search starts off).
          You can change them later.
        </Text>
        <SectionSwitches
          value={approvePerms}
          onChange={(k, on) => setApprovePerms(p => ({ ...p, [k]: on }))}
        />
        <Button
          label="Approve"
          block
          loading={busy}
          onPress={() => {
            const id = approving;
            if (id === null) return;
            run(
              () => api.approveRequest(id, approvePerms),
              'Request approved',
            ).then(ok => ok && setApproving(null));
          }}
        />
      </Sheet>

      <Sheet
        visible={member !== undefined}
        onClose={() => setMemberId(null)}
        title={member ? who(member) : 'Member'}
      >
        {member ? (
          <>
            <Text style={[styles.meta, { color: t.colors.muted }]}>
              {member.email} · joined {day(member.joined_at)}
              {member.last_seen_at
                ? ` · last seen ${day(member.last_seen_at)}`
                : ''}
            </Text>
            <SectionSwitches
              value={member.permissions}
              // Admins always have every section.
              disabled={member.role === 'admin' || busy}
              onChange={(k, on) =>
                run(() => api.setMemberPermissions(member.user_id, { [k]: on }))
              }
            />
            <Button
              label={member.role === 'admin' ? 'Make member' : 'Make admin'}
              variant="secondary"
              block
              loading={busy}
              onPress={() =>
                run(
                  () =>
                    api.setMemberRole(
                      member.user_id,
                      member.role === 'admin' ? 'member' : 'admin',
                    ),
                  member.role === 'admin'
                    ? `${who(member)} is now a member`
                    : `${who(member)} is now an admin`,
                )
              }
            />
            {member.user_id !== me ? (
              <Button
                label="Remove from organisation"
                variant="danger"
                block
                onPress={() =>
                  showActionSheet(
                    `Remove ${who(
                      member,
                    )}? Their projects stay with the organisation.`,
                    [
                      {
                        label: 'Remove, keep their bookmarks',
                        onPress: () => {
                          run(
                            () => api.delinkMember(member.user_id, true),
                            `${who(member)} removed`,
                          ).then(ok => ok && setMemberId(null));
                        },
                      },
                      {
                        label: 'Remove and wipe their account',
                        destructive: true,
                        onPress: () => {
                          run(
                            () => api.delinkMember(member.user_id, false),
                            `${who(member)} removed and wiped`,
                          ).then(ok => ok && setMemberId(null));
                        },
                      },
                    ],
                  )
                }
              />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  divider: { borderTopWidth: 1 },
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  sub: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    marginTop: 4,
    marginBottom: 16,
  },
  card: { marginBottom: 14, gap: 10 },
  h3: { fontFamily: fonts.semibold, fontSize: 15 },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  label: { fontFamily: fonts.medium, fontSize: 11.5, marginTop: 4 },
  code: { fontFamily: fonts.monoSemibold, fontSize: 24, letterSpacing: 3 },
  section: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    marginTop: 6,
    marginBottom: 8,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', gap: 10 },
  request: { gap: 6, paddingVertical: 8 },
  name: { fontFamily: fonts.semibold, fontSize: 14 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  switchLabel: { fontFamily: fonts.medium, fontSize: 14 },
  permRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  permState: { fontFamily: fonts.semibold, fontSize: 13 },
  loading: { marginTop: 40 },
});
