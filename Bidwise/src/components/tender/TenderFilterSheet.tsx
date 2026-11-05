import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Field, Sheet } from '../ui';
import { Dropdown } from '../ui/Dropdown';
import { fonts, useTheme } from '../../theme';
import type { LocationOption } from '../../data/tenderSource';
import {
  CATEGORIES,
  NO_SHEET_FILTERS,
  type SheetFilters,
} from '../../lib/tenderFilters';

type Props = {
  visible: boolean;
  value: SheetFilters;
  /** The locations in the data, for the Location list. */
  locations: LocationOption[];
  onApply: (f: SheetFilters) => void;
  onClose: () => void;
};

const CATEGORY_OPTIONS = CATEGORIES.map(c => ({ value: c, label: c }));

/**
 * The Tenders tab's filters: category (Works, Services, Goods) and location chosen from
 * lists, and a tender value range typed in crores. Changes apply on Apply; Clear resets
 * everything.
 */
export function TenderFilterSheet({
  visible,
  value,
  locations,
  onApply,
  onClose,
}: Props) {
  const t = useTheme();
  const [local, setLocal] = useState(value);
  const [open, setOpen] = useState<'category' | 'location' | null>(null);
  // Start from the applied filters each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setLocal(value);
      setOpen(null);
    }
  }, [visible, value]);
  const set = (patch: Partial<SheetFilters>) =>
    setLocal(prev => ({ ...prev, ...patch }));
  const toggle = (which: 'category' | 'location') =>
    setOpen(o => (o === which ? null : which));
  const locationOptions = useMemo(() => {
    const opts = locations.map(l => ({
      value: l.value,
      label: l.value,
      note: String(l.count),
    }));
    // A location already applied stays selectable if the list no longer has it.
    return local.location && !opts.some(o => o.value === local.location)
      ? [{ value: local.location, label: local.location, note: '' }, ...opts]
      : opts;
  }, [locations, local.location]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Filters">
      <Dropdown
        label="Category"
        value={local.category}
        options={CATEGORY_OPTIONS}
        onChange={v => set({ category: v as SheetFilters['category'] })}
        open={open === 'category'}
        onToggle={() => toggle('category')}
      />
      <Dropdown
        label="Location"
        value={local.location}
        options={locationOptions}
        onChange={v => set({ location: v })}
        searchable
        open={open === 'location'}
        onToggle={() => toggle('location')}
      />

      <Text style={[styles.label, { color: t.colors.muted }]}>
        Tender value (₹ Cr)
      </Text>
      <View style={styles.range}>
        <View style={styles.flex}>
          <Field
            label="Min"
            value={local.minCr}
            onChangeText={v => set({ minCr: v })}
            placeholder="No minimum"
            keyboardType="decimal-pad"
            autoCorrect={false}
          />
        </View>
        <View style={styles.flex}>
          <Field
            label="Max"
            value={local.maxCr}
            onChangeText={v => set({ maxCr: v })}
            placeholder="No maximum"
            keyboardType="decimal-pad"
            autoCorrect={false}
          />
        </View>
      </View>

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
    marginTop: 12,
    marginBottom: -4,
  },
  range: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  flex: { flex: 1 },
});
