import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import {
  BASE_FILTERS,
  BaseFilter,
  CustomFilterKey,
  customLabel,
  FilterMenuGroup,
  MAX_CUSTOM_FILTERS,
} from '../../lib/tenderFilters';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { useToast } from '../feedback/Toast';

type Props = {
  base: BaseFilter;
  onBase: (b: BaseFilter) => void;
  custom: CustomFilterKey[];
  onAddCustom: (k: CustomFilterKey) => void;
  onRemoveCustom: (k: CustomFilterKey) => void;
  menuGroups: FilterMenuGroup[];
};

/** Base filters, up to two removable custom filters, and a "+ Filter" menu. */
export function FilterBar({
  base,
  onBase,
  custom,
  onAddCustom,
  onRemoveCustom,
  menuGroups,
}: Props) {
  const t = useTheme();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const full = custom.length >= MAX_CUSTOM_FILTERS;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.row}
      >
        {BASE_FILTERS.map(f => (
          <Chip
            key={f.key}
            label={f.label}
            selected={base === f.key}
            onPress={() => onBase(f.key)}
          />
        ))}
        {custom.map(k => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityLabel={`Remove filter: ${customLabel(k)}`}
            onPress={() => {
              setOpen(false);
              onRemoveCustom(k);
            }}
            style={[
              styles.custom,
              {
                backgroundColor: t.colors.accentWash,
                borderColor: t.colors.accent,
              },
            ]}
          >
            <Text style={[styles.customText, { color: t.colors.accentInk }]}>
              {customLabel(k)}
            </Text>
            <X size={12} color={t.colors.accentInk} />
          </Pressable>
        ))}
        {!full ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a custom filter"
            onPress={() => setOpen(o => !o)}
            style={[styles.add, { borderColor: t.colors.accent }]}
          >
            <Plus size={13} color={t.colors.accentInk} />
            <Text style={[styles.customText, { color: t.colors.accentInk }]}>
              Filter
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {open && !full ? (
        <Card padding={6} elevation="sm" style={styles.menu}>
          {menuGroups.map(g => (
            <View key={g.heading}>
              <Text style={[styles.heading, { color: t.colors.muted }]}>
                {g.heading.toUpperCase()}
              </Text>
              {g.options.map(o => (
                <Pressable
                  key={o.key}
                  accessibilityRole="button"
                  onPress={() => {
                    if (custom.length >= MAX_CUSTOM_FILTERS) {
                      toast.show('Up to 2 custom filters at a time');
                      return;
                    }
                    onAddCustom(o.key);
                    setOpen(false);
                  }}
                  style={styles.option}
                >
                  <Text style={[styles.optionText, { color: t.colors.ink }]}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -18, flexGrow: 0 },
  row: {
    paddingHorizontal: 18,
    gap: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  custom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  customText: { fontFamily: fonts.semibold, fontSize: 12.5 },
  menu: { marginTop: 8 },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
  },
  option: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 9 },
  optionText: { fontFamily: fonts.medium, fontSize: 13 },
});
