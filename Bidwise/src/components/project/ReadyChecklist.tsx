import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Paperclip, Plus } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { Checkbox, useSurface } from '../ui/Controls';
import { fonts, useTheme } from '../../theme';
import { showActionSheet } from '../../platform/actionSheet';

export type ReadyRow = {
  key: string;
  name: string;
  file?: string;
  done: boolean;
  /** Attached on another device: listed, but not on this phone. */
  elsewhere?: boolean;
};

/** "1 of 3 ready". */
export function readyCount(rows: ReadyRow[]) {
  if (!rows.length) return 'No items yet';
  return `${rows.filter(r => r.done).length} of ${rows.length} ready`;
}

/**
 * "Ready for Bid": the bid-preparation checklist. Each item has its own attach button;
 * an item with a file attached is drawn pressed-in with its box ticked.
 */
export function ReadyChecklist({
  rows,
  onToggle,
  onAttach,
  onOpen,
  onRemove,
  onAdd,
}: {
  rows: ReadyRow[];
  onToggle: (key: string) => void;
  /** Pick a file for the item (also "Replace"). */
  onAttach: (key: string) => void;
  onOpen: (key: string) => void;
  onRemove: (key: string) => void;
  onAdd: (name: string) => void;
}) {
  const t = useTheme();
  const surface = useSurface();
  const [draft, setDraft] = useState('');
  // An attached item: open it, swap the file, or take it off (iOS action sheet).
  const manage = (r: ReadyRow) =>
    showActionSheet(r.file ?? r.name, [
      { label: 'Open', onPress: () => onOpen(r.key) },
      { label: 'Replace file', onPress: () => onAttach(r.key) },
      {
        label: 'Remove attachment',
        destructive: true,
        onPress: () => onRemove(r.key),
      },
    ]);

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    onAdd(name);
    setDraft('');
  };

  return (
    <Card padding={16} radius="lg" elevation="sm" style={styles.card}>
      <View style={styles.head}>
        <Text style={[styles.h3, { color: t.colors.ink }]}>Ready for Bid</Text>
        <Text style={[styles.count, { color: t.colors.accent }]}>
          {readyCount(rows)}
        </Text>
      </View>
      {rows.map(r => {
        const pressed = r.done;
        return (
          <View
            key={r.key}
            style={[
              styles.row,
              {
                borderColor: pressed ? t.colors.edge : t.colors.hair,
                backgroundColor: pressed ? t.colors.surfaceSunk : 'transparent',
              },
              pressed && styles.rowPressed,
            ]}
          >
            <Checkbox
              checked={r.done}
              label={`${r.name} ready`}
              onPress={() => onToggle(r.key)}
            />
            <Pressable
              style={styles.copy}
              disabled={!r.file}
              accessibilityRole={r.file ? 'button' : undefined}
              accessibilityLabel={r.file ? `Open ${r.file}` : undefined}
              onPress={() => onOpen(r.key)}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.name,
                  { color: t.colors.ink },
                  pressed && { color: t.colors.inkSoft },
                ]}
              >
                {r.name}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.file,
                  { color: r.file ? t.colors.accent : t.colors.muted },
                ]}
              >
                {r.file
                  ? r.elsewhere
                    ? `${r.file} · on another device`
                    : r.file
                  : 'Awaiting attachment'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                r.file
                  ? `Manage attachment for ${r.name}`
                  : `Attach file to ${r.name}`
              }
              onPress={() => (r.file ? manage(r) : onAttach(r.key))}
              hitSlop={8}
              style={[styles.attach, surface]}
            >
              <Paperclip size={16} color={t.colors.inkSoft} />
            </Pressable>
          </View>
        );
      })}
      <View style={[styles.addRow, surface]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder="Add a checklist item"
          placeholderTextColor={t.colors.muted}
          style={[styles.addInput, { color: t.colors.ink }]}
          returnKeyType="done"
          accessibilityLabel="New checklist item"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add checklist item"
          onPress={add}
          style={[styles.addBtn, { backgroundColor: t.colors.accentWash }]}
        >
          <Plus size={17} color={t.colors.accent} />
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  h3: { fontFamily: fonts.displaySemibold, fontSize: 16, letterSpacing: -0.4 },
  count: { fontFamily: fonts.medium, fontSize: 11 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    marginBottom: 8,
  },
  // Recessed: an inset look for attached items.
  rowPressed: { transform: [{ scale: 0.985 }] },
  copy: { flex: 1 },
  name: { fontFamily: fonts.medium, fontSize: 13 },
  file: { fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  attach: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 13,
    paddingLeft: 12,
    paddingRight: 5,
    height: 46,
    marginTop: 2,
  },
  addInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    paddingVertical: 0,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
