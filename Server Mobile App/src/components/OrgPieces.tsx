import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ClientUser, Permissions, Section } from '../lib/types';
import { useTheme } from '../theme';
import {
  Button,
  ListRow,
  SearchField,
  SettingRow,
  Sheet,
  StatusPill,
  Toggle,
  Txt,
} from './ui';

// Shared pieces for organisations and per-section access, mirroring the desktop
// Server UI (SECTION_OPTIONS, SectionToggles, KeepWipeConfirm, the Account column).

export const SECTIONS: { key: Section; label: string; hint?: string }[] = [
  { key: 'active', label: 'Active tenders' },
  { key: 'archived', label: 'Archived' },
  { key: 'bookmarks', label: 'Bookmarks' },
  { key: 'projects', label: 'Projects' },
  {
    key: 'portal_search',
    label: 'Portal search',
    hint: 'Lets the user look up a tender ID on a NIC portal from their app. Off by default.',
  },
];

/** What a section is when the server sends nothing for it (NULL permissions = these). */
export const SECTION_DEFAULTS: Permissions = {
  active: true,
  archived: true,
  bookmarks: true,
  projects: true,
  portal_search: false,
};

/** Whether a section is on, falling back to the server's default for that section. */
export const sectionOn = (value: Partial<Permissions> | undefined, key: Section) =>
  value?.[key] ?? SECTION_DEFAULTS[key];

/**
 * One on/off switch per section. Captcha answering is never gated, so it has
 * no switch.
 */
export function SectionToggles({
  value,
  onChange,
  busyKey,
  locked,
}: {
  value: Partial<Permissions> | undefined;
  onChange: (section: Section, on: boolean) => void;
  /** The section whose change is in flight (its switch is disabled). */
  busyKey?: Section | null;
  /** Org admins always have every section; shown but not editable. */
  locked?: boolean;
}) {
  return (
    <View>
      {SECTIONS.map(({ key, label, hint }, i) => {
        const on = locked ? true : sectionOn(value, key);
        return (
          <SettingRow key={key} label={label} hint={hint} divider={i > 0}>
            <View style={[locked || busyKey === key ? styles.dim : null]}>
              <Toggle
                value={on}
                onChange={v => {
                  if (!locked && busyKey !== key) onChange(key, v);
                }}
                label={label}
              />
            </View>
          </SettingRow>
        );
      })}
    </View>
  );
}

/** "Individual", or "<Org> · Admin" / "<Org> · Member". */
export function AccountPill({ user }: { user: Pick<ClientUser, 'org' | 'account_type'> }) {
  if (!user.org) return <StatusPill tone="neutral" label="Individual" />;
  const admin = user.org.role === 'admin';
  return (
    <StatusPill
      tone={admin ? 'info' : 'neutral'}
      label={`${user.org.name} · ${admin ? 'Admin' : 'Member'}`}
    />
  );
}

/**
 * Removing a member or dissolving an org: keep a copy of the org's bookmarks
 * (retain) or wipe the user's data. Either way they become individuals and are
 * signed out; projects stay with the organisation.
 */
export function KeepWipeSheet({
  visible,
  title,
  message,
  busy,
  onChoose,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  busy?: boolean;
  onChoose: (retain: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Txt color="ink2">{message}</Txt>
      <View style={styles.stack}>
        <Button label="Keep bookmarks" variant="primary" busy={busy} onPress={() => onChoose(true)} block />
        <Button label="Wipe everything" variant="danger" disabled={busy} onPress={() => onChoose(false)} block />
        <Button label="Cancel" variant="ghost" onPress={onClose} block />
      </View>
    </Sheet>
  );
}

/** Pick one individual account (for a new organisation's admin or a new member). */
export function UserPickerSheet({
  visible,
  title,
  users,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  users: ClientUser[];
  onPick: (user: ClientUser) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const individuals = useMemo(
    () =>
      users.filter(
        u =>
          u.account_type !== 'organisation' &&
          `${u.email} ${u.display_name}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [users, query],
  );
  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title={title}
    >
      <SearchField value={query} onChangeText={setQuery} placeholder="Search email or name" />
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        <View style={[styles.listBox, { borderColor: t.colors.hair }]}>
          {individuals.length === 0 ? (
            <Txt variant="small" color="ink3" style={styles.none}>
              No individual accounts match. Members of an organisation can't be picked.
            </Txt>
          ) : (
            individuals.map((u, i) => (
              <ListRow
                key={u.id}
                title={u.display_name || u.email}
                subtitle={u.display_name ? u.email : undefined}
                divider={i > 0}
                chevron
                onPress={() => onPick(u)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.45 },
  stack: { gap: 8 },
  list: { maxHeight: 380 },
  listBox: { borderWidth: 1 },
  none: { padding: 14 },
});
