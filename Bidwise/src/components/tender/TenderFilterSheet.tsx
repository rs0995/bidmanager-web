import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Checkbox, Field, Segmented, Sheet } from '../ui';
import { fonts, useTheme } from '../../theme';
import { NO_SHEET_FILTERS, type SheetFilters } from '../../lib/tenderFilters';

type Props = {
  visible: boolean;
  value: SheetFilters;
  onApply: (f: SheetFilters) => void;
  onClose: () => void;
};

/**
 * The Tenders tab's filters, as BM Pro's filter sheet: category, location and documents
 * (filtered on the server), tender value, and closing within 5 days. Changes apply on
 * Apply; Clear resets everything.
 */
export function TenderFilterSheet({ visible, value, onApply, onClose }: Props) {
  const t = useTheme();
  const [local, setLocal] = useState(value);
  // Start from the applied filters each time the sheet opens.
  useEffect(() => {
    if (visible) setLocal(value);
  }, [visible, value]);
  const set = (patch: Partial<SheetFilters>) =>
    setLocal(prev => ({ ...prev, ...patch }));

  const label = (text: string) => (
    <Text style={[styles.label, { color: t.colors.muted }]}>{text}</Text>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Filters">
      <Field
        label="Category"
        value={local.category}
        onChangeText={v => set({ category: v })}
        placeholder="e.g. Works"
        autoCorrect={false}
      />
      <Field
        label="Location"
        value={local.location}
        onChangeText={v => set({ location: v })}
        placeholder="e.g. Pune"
        autoCorrect={false}
      />

      {label('Documents')}
      <Segmented
        value={local.docs}
        onChange={docs => set({ docs })}
        options={[
          { value: 'any', label: 'Any' },
          { value: 'with', label: 'Has documents' },
          { value: 'without', label: 'None yet' },
        ]}
      />

      {label('Tender value')}
      <Segmented
        value={local.value}
        onChange={v => set({ value: v })}
        options={[
          { value: 'any', label: 'Any' },
          { value: 'gt25', label: 'Above ₹25 Cr' },
          { value: 'lt10', label: 'Below ₹10 Cr' },
        ]}
      />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: local.closingSoon }}
        onPress={() => set({ closingSoon: !local.closingSoon })}
        style={styles.check}
      >
        <Checkbox
          checked={local.closingSoon}
          label="Closing within 5 days"
          onPress={() => set({ closingSoon: !local.closingSoon })}
        />
        <Text style={[styles.checkText, { color: t.colors.ink }]}>
          Closing within 5 days
        </Text>
      </Pressable>

      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button
            label="Clear"
            variant="secondary"
            block
            onPress={() => {
              setLocal(NO_SHEET_FILTERS);
              onApply(NO_SHEET_FILTERS);
              onClose();
            }}
          />
        </View>
        <View style={styles.flex}>
          <Button
            label="Apply"
            block
            onPress={() => {
              onApply(local);
              onClose();
            }}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    marginTop: 16,
    marginBottom: 8,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
  },
  checkText: { fontFamily: fonts.medium, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  flex: { flex: 1 },
});
