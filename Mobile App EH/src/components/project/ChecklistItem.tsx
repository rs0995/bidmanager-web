import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Paperclip } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import type { ChecklistItem as Item } from '../../fixtures/projects';
import { Card } from '../ui/Card';

type Props = {
  item: Item;
  onAttach: () => void;
  onRemoveFile: () => void;
  onPreview: () => void;
};

/**
 * One checklist row. With a file attached the row darkens, the box is ticked, the button
 * reads "Attached" (tap to replace the file) and tapping the row previews the file.
 */
export function ChecklistItem({
  item,
  onAttach,
  onRemoveFile,
  onPreview,
}: Props) {
  const t = useTheme();
  const attached = !!item.file;
  const tint = t.colors.good;

  const surface = attached
    ? {
        backgroundColor: t.isGlass ? t.glass.fillStrong : t.colors.surfaceSunk,
        borderWidth: 1,
        borderColor: `${tint}55`,
      }
    : undefined;

  const box = {
    backgroundColor: item.done ? tint : 'transparent',
    borderColor: item.done ? tint : t.colors.muted,
  };
  const attachBtn = attached
    ? { backgroundColor: t.colors.goodWash, borderColor: `${tint}66` }
    : {
        backgroundColor: t.colors.accentWash,
        borderColor: `${t.colors.accent}44`,
      };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={attached ? `Preview ${item.file}` : item.name}
      disabled={!attached}
      onPress={onPreview}
      style={styles.press}
    >
      <Card padding={12} elevation="sm" radius="md" style={surface}>
        <View style={styles.row}>
          <View style={[styles.box, box]}>
            {item.done ? (
              <Check size={12} color="#ffffff" strokeWidth={3} />
            ) : null}
          </View>
          <View style={styles.body}>
            <Text
              style={[
                styles.name,
                { color: item.done ? t.colors.muted : t.colors.ink },
              ]}
            >
              {item.name}
            </Text>
            {item.note ? (
              <Text style={[styles.note, { color: t.colors.muted }]}>
                {item.note}
              </Text>
            ) : null}
            {attached ? (
              <View style={styles.file}>
                <Paperclip size={11} color={t.colors.accentInk} />
                <Text
                  numberOfLines={1}
                  style={[styles.fileName, { color: t.colors.accentInk }]}
                >
                  {item.file}
                </Text>
                <Text style={[styles.hint, { color: t.colors.muted }]}>
                  tap to preview
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.file}`}
                  hitSlop={8}
                  onPress={onRemoveFile}
                >
                  <Text style={[styles.remove, { color: t.colors.crit }]}>
                    Remove
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              attached ? 'Replace attached file' : 'Attach a file'
            }
            onPress={onAttach}
            style={[styles.attach, attachBtn]}
          >
            <Text
              style={[
                styles.attachText,
                { color: attached ? t.colors.good : t.colors.accentInk },
              ]}
            >
              {attached ? 'Attached' : 'Attach'}
            </Text>
          </Pressable>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: {
    width: 18,
    height: 18,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  body: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.medium, fontSize: 13 },
  note: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 1 },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
    flexWrap: 'wrap',
  },
  fileName: { fontFamily: fonts.medium, fontSize: 11, maxWidth: 140 },
  hint: { fontFamily: fonts.regular, fontSize: 10.5 },
  remove: { fontFamily: fonts.bold, fontSize: 10.5 },
  attach: {
    alignSelf: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  attachText: { fontFamily: fonts.bold, fontSize: 10.5 },
});
