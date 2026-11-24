import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Check, Copy, KeyRound, Pencil, UserPlus, X } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { KeepWipeSheet, SECTIONS, SectionToggles, UserPickerSheet } from '../../components/OrgPieces';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  ConfirmSheet,
  IconButton,
  KeyValue,
  Screen,
  Section,
  SegmentedControl,
  Sheet,
  StatusPill,
  TextField,
  Txt,
  useToast,
} from '../../components/ui';
import { fmtAgo, fmtDateTime, fromSecs } from '../../lib/format';
import { useAction, useOrg, useUsers } from '../../lib/queries';
import type { ClientUser, JoinRequest, OrgMember, OrgRole, Section as SectionKey } from '../../lib/types';
import { clipboard } from '../../platform';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'OrgDetail'>;

// One organisation (the desktop OrgsCard's expanded view): name and join code,
// join requests, members with role / sections / remove, add member, dissolve.
// Every action is followed by a refetch of the org, the org list and the users.
export function OrgDetailScreen({ route, navigation }: Props) {
  const t = useTheme();
  const toast = useToast();
  const id = Number(route.params.orgId);
  const org = useOrg(id);
  const users = useUsers();
  const { run, busy } = useAction();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmCode, setConfirmCode] = useState(false);
  const [approving, setApproving] = useState<JoinRequest | null>(null);
  const [removing, setRemoving] = useState<OrgMember | null>(null);
  const [dissolving, setDissolving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState<ClientUser | null>(null);
  const [addRole, setAddRole] = useState<OrgRole>('member');
  const [busySection, setBusySection] = useState<string | null>(null);

  const o = org.data;
  const refresh = ['org', 'orgs', 'users', 'user'];
  const adminCount = o?.members.filter(m => m.role === 'admin').length ?? 0;

  const copyCode = async () => {
    if (!o) return;
    try {
      await clipboard.copy(o.join_code);
      toast('Join code copied');
    } catch {
      toast('Could not copy the join code');
    }
  };

  const setSection = async (m: OrgMember, section: SectionKey, on: boolean) => {
    setBusySection(`${m.user_id}:${section}`);
    const label = SECTIONS.find(s => s.key === section)?.label ?? section;
    await run(`perm:${m.user_id}`, a => a.setUserPermissions(m.user_id, { [section]: on }), {
      success: `${label} ${on ? 'on' : 'off'} for ${m.email}`,
      invalidate: refresh,
    });
    setBusySection(null);
  };

  return (
    <Screen header={<AppHeader back code="ORG" title={o?.name ?? 'Organisation'} />}>
      {!o ? (
        <QueryState what="the organisation" loading={org.isPending} error={org.error} onRetry={() => org.refetch()} />
      ) : (
        <>
          <Card>
            <View style={styles.titleRow}>
              <Txt style={[styles.name, { color: t.colors.ink }]} numberOfLines={2}>
                {o.name}
              </Txt>
              <IconButton
                icon={Pencil}
                label="Rename"
                onPress={() => {
                  setNewName(o.name);
                  setRenaming(true);
                }}
              />
            </View>
            <View style={[styles.code, { backgroundColor: t.colors.raised, borderColor: t.colors.hair }]}>
              <Txt variant="label">Join code</Txt>
              <Txt style={[styles.codeText, { color: t.colors.ink }]}>{o.join_code}</Txt>
              <View style={styles.flex} />
              <IconButton icon={Copy} label="Copy join code" onPress={copyCode} />
              <IconButton icon={KeyRound} label="Issue a new join code" onPress={() => setConfirmCode(true)} />
            </View>
            <KeyValue label="Members" value={String(o.members.length)} />
            <KeyValue label="Created" value={fmtDateTime(fromSecs(o.created_at))} />
            {o.synced_at ? <KeyValue label="Shared data synced" value={fmtAgo(fromSecs(o.synced_at))} /> : null}
          </Card>

          <Section title="Join requests" meta={String(o.pending_requests.length)} pad={false}>
            {o.pending_requests.length === 0 ? (
              <Txt variant="small" color="ink3" style={styles.none}>
                No pending requests.
              </Txt>
            ) : (
              o.pending_requests.map((r, i) => (
                <View
                  key={r.id}
                  style={[styles.item, i > 0 && { borderTopWidth: 1, borderTopColor: t.colors.hairSoft }]}
                >
                  <Txt variant="bodyStrong">{r.display_name || r.email}</Txt>
                  {r.display_name ? <Txt variant="small" color="ink2">{r.email}</Txt> : null}
                  {r.note ? (
                    <Txt variant="small" color="ink2" style={styles.note}>
                      “{r.note}”
                    </Txt>
                  ) : null}
                  <Txt variant="monoSmall" color="ink3">
                    Asked {fmtAgo(fromSecs(r.created_at))}
                  </Txt>
                  <View style={styles.row}>
                    <Button
                      label="Approve"
                      icon={Check}
                      size="sm"
                      variant="primary"
                      busy={busy === `approve:${r.id}`}
                      onPress={() => setApproving(r)}
                    />
                    <Button
                      label="Reject"
                      icon={X}
                      size="sm"
                      busy={busy === `reject:${r.id}`}
                      onPress={() =>
                        run(`reject:${r.id}`, a => a.rejectJoinRequest(id, r.id), {
                          success: `${r.email} rejected`,
                          invalidate: refresh,
                        })
                      }
                    />
                  </View>
                </View>
              ))
            )}
          </Section>

          <Section
            title="Members"
            meta={String(o.members.length)}
            right={
              <Button label="Add" icon={UserPlus} size="sm" variant="ghost" onPress={() => setPicking(true)} />
            }
            pad={false}
          >
            {o.members.map((m, i) => (
              <View
                key={m.user_id}
                style={[styles.item, i > 0 && { borderTopWidth: 1, borderTopColor: t.colors.hairSoft }]}
              >
                <View style={styles.memberHead}>
                  <View style={styles.flex}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {m.display_name || m.email}
                    </Txt>
                    {m.display_name ? (
                      <Txt variant="small" color="ink2" numberOfLines={1}>
                        {m.email}
                      </Txt>
                    ) : null}
                    <Txt variant="monoSmall" color="ink3">
                      Seen {fmtAgo(fromSecs(m.last_seen_at)).replace(/^never$/, 'never')}
                    </Txt>
                  </View>
                  {m.status !== 'active' ? <StatusPill tone="bad" label={m.status} /> : null}
                </View>
                <SegmentedControl<OrgRole>
                  value={m.role}
                  onChange={role =>
                    role !== m.role &&
                    run(`role:${m.user_id}`, a => a.setMemberRole(id, m.user_id, role), {
                      success: `${m.email} is now ${role === 'admin' ? 'an admin' : 'a member'}`,
                      invalidate: refresh,
                    })
                  }
                  options={[
                    { value: 'admin', label: 'Admin' },
                    { value: 'member', label: 'Member' },
                  ]}
                />
                {m.role === 'admin' ? (
                  <Txt variant="small" color="ink3">
                    Admins always have every section.
                  </Txt>
                ) : (
                  <SectionToggles
                    value={m.permissions}
                    busyKey={
                      busySection?.startsWith(`${m.user_id}:`)
                        ? (busySection.split(':')[1] as SectionKey)
                        : null
                    }
                    onChange={(section, on) => setSection(m, section, on)}
                  />
                )}
                <Button
                  label="Remove from organisation"
                  size="sm"
                  variant="danger"
                  disabled={m.role === 'admin' && adminCount <= 1}
                  onPress={() => setRemoving(m)}
                  style={styles.start}
                />
                {m.role === 'admin' && adminCount <= 1 ? (
                  <Txt variant="small" color="ink3">
                    The last admin can't be removed. Make someone else admin first.
                  </Txt>
                ) : null}
              </View>
            ))}
          </Section>

          <Button
            label="Dissolve organisation"
            variant="danger"
            busy={busy === 'dissolve'}
            onPress={() => setDissolving(true)}
            block
          />
        </>
      )}

      <Sheet visible={renaming} onClose={() => setRenaming(false)} title="Rename organisation">
        <TextField label="Name" value={newName} onChangeText={setNewName} />
        <Button
          label="Rename"
          variant="primary"
          busy={busy === 'rename'}
          disabled={!newName.trim() || newName.trim() === o?.name}
          onPress={async () => {
            const ok = await run('rename', a => a.renameOrg(id, newName.trim()), {
              success: 'Organisation renamed',
              invalidate: refresh,
            });
            if (ok) setRenaming(false);
          }}
          block
        />
      </Sheet>

      <ConfirmSheet
        visible={confirmCode}
        title="Issue a new join code?"
        message="The current code stops working immediately."
        confirmLabel="New code"
        onConfirm={() =>
          run('code', a => a.regenerateJoinCode(id), { success: 'New join code issued', invalidate: refresh })
        }
        onClose={() => setConfirmCode(false)}
      />

      <ConfirmSheet
        visible={!!approving}
        title={`Approve ${approving?.email ?? ''}?`}
        message={`They join ${o?.name ?? 'the organisation'}. Their own bookmarks and projects are discarded and their devices are signed out.`}
        confirmLabel="Approve"
        onConfirm={() => {
          const r = approving;
          if (r)
            run(`approve:${r.id}`, a => a.approveJoinRequest(id, r.id), {
              success: `${r.email} approved`,
              invalidate: refresh,
            });
        }}
        onClose={() => setApproving(null)}
      />

      <KeepWipeSheet
        visible={!!removing}
        title={`Remove ${removing?.email ?? ''}?`}
        message="They become an individual and are signed out. Projects stay with the organisation."
        busy={busy === 'delink'}
        onChoose={async retain => {
          const m = removing;
          if (!m) return;
          const ok = await run('delink', a => a.delinkMember(id, m.user_id, retain), {
            success: `${m.email} removed (${retain ? 'bookmarks kept' : 'data wiped'})`,
            invalidate: refresh,
          });
          if (ok) setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />

      <KeepWipeSheet
        visible={dissolving}
        title={`Dissolve "${o?.name ?? ''}"?`}
        message="Every member becomes an individual and is signed out, and the shared projects are deleted."
        busy={busy === 'dissolve'}
        onChoose={async retain => {
          const ok = await run('dissolve', a => a.dissolveOrg(id, retain), {
            success: `Organisation dissolved (${retain ? 'bookmarks kept' : 'data wiped'})`,
            invalidate: ['orgs', 'users', 'user'],
          });
          if (ok) {
            setDissolving(false);
            navigation.goBack();
          }
        }}
        onClose={() => setDissolving(false)}
      />

      <UserPickerSheet
        visible={picking}
        title="Add member"
        users={users.data ?? []}
        onPick={u => {
          setPicking(false);
          setAddRole('member');
          setAdding(u);
        }}
        onClose={() => setPicking(false)}
      />
      <Sheet visible={!!adding} onClose={() => setAdding(null)} title={`Add ${adding?.email ?? ''}`}>
        <Txt color="ink2">
          Their own bookmarks and projects are discarded and their devices are signed out.
        </Txt>
        <SegmentedControl<OrgRole>
          value={addRole}
          onChange={setAddRole}
          options={[
            { value: 'member', label: 'Member' },
            { value: 'admin', label: 'Admin' },
          ]}
        />
        <Button
          label={`Add to ${o?.name ?? 'organisation'}`}
          variant="primary"
          busy={busy === 'add'}
          onPress={async () => {
            const u = adding;
            if (!u) return;
            const ok = await run('add', a => a.addOrgMember(id, u.id, addRole), {
              success: `${u.email} added`,
              invalidate: refresh,
            });
            if (ok) setAdding(null);
          }}
          block
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontFamily: fonts.cond, fontSize: 20 },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    marginVertical: 10,
  },
  codeText: { fontFamily: fonts.monoSemibold, fontSize: 17, letterSpacing: 2 },
  none: { padding: 14 },
  item: { padding: 14, gap: 8 },
  note: { fontStyle: 'italic' },
  row: { flexDirection: 'row', gap: 8 },
  memberHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  start: { alignSelf: 'flex-start' },
});
