import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';

type Props = {
  folders: string[];
  onSubmit: (folder: string, name: string, note: string) => void;
  onCancel: () => void;
};

export function AddChecklistItemForm({ folders, onSubmit, onCancel }: Props) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [folder, setFolder] = useState(folders[0]);
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a document name');
      return;
    }
    onSubmit(folder, trimmed, note.trim());
  };

  return (
    <Card padding={14} elevation="sm" style={styles.card}>
      <View style={styles.gap}>
        <Field
          label="Document name"
          value={name}
          onChangeText={v => {
            setName(v);
            if (error) setError(undefined);
          }}
          placeholder="e.g. Turnover certificate"
          error={error}
          autoFocus
        />
        <View style={styles.sectionBlock}>
          <Text style={[styles.label, { color: t.colors.inkSoft }]}>
            Section
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {folders.map(f => (
              <Chip
                key={f}
                label={f}
                selected={f === folder}
                onPress={() => setFolder(f)}
              />
            ))}
          </ScrollView>
        </View>
        <Field
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Add a note"
        />
        <View style={styles.actions}>
          <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} />
          <Button label="Add to checklist" size="sm" onPress={submit} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  gap: { gap: 12 },
  sectionBlock: { gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 12 },
  chips: { gap: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
