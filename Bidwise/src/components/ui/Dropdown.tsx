import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from './GlassBlur';
import { useSurface } from './Controls';
import { useCycledHint } from './useCycledHint';

export type DropdownOption = {
  value: string;
  label: string;
  /** Small text at the right (a count). */
  note?: string;
};

type Props = {
  label: string;
  /** The chosen option's value; '' is "any". */
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  /** Shown when nothing is chosen. */
  anyLabel?: string;
  /** A search box above the list, for long lists. */
  searchable?: boolean;
  /** Examples the empty search box cycles through ("e.g. …"). */
  hints?: string[];
  open: boolean;
  onToggle: () => void;
};

const LIST_HEIGHT = 190;
const NO_HINTS: string[] = [];

/**
 * A field that opens its choices in a list right under it (picking one closes it). The
 * caller owns `open`, so only one dropdown in a sheet is open at a time.
 */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  anyLabel = 'Any',
  searchable,
  hints = NO_HINTS,
  open,
  onToggle,
}: Props) {
  const t = useTheme();
  const surface = useSurface();
  const [query, setQuery] = useState('');
  const { hint } = useCycledHint(hints, !open || Boolean(query));
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter(o => o.label.toLowerCase().includes(needle))
    : options;
  const chosen = options.find(o => o.value === value)?.label ?? (value || null);
  const Chevron = open ? ChevronUp : ChevronDown;
  const pick = (v: string) => {
    onChange(v);
    setQuery('');
    onToggle();
  };
  const row = (v: string, text: string, note?: string) => {
    const on = v === value;
    return (
      <Pressable
        key={v || 'any'}
        accessibilityRole="menuitem"
        accessibilityState={{ selected: on }}
        onPress={() => pick(v)}
        style={styles.item}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.itemText,
            { color: on ? t.colors.accent : t.colors.ink },
            on && { fontFamily: fonts.semibold },
          ]}
        >
          {text}
        </Text>
        {note ? (
          <Text style={[styles.note, { color: t.colors.muted }]}>{note}</Text>
        ) : null}
        {on ? <Check size={16} color={t.colors.accent} /> : null}
      </Pressable>
    );
  };
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: t.colors.muted }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen ?? anyLabel}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={[styles.field, surface]}
      >
        <GlassBlur amount={14} />
        <Text
          numberOfLines={1}
          style={[
            styles.fieldText,
            { color: chosen ? t.colors.ink : t.colors.muted },
          ]}
        >
          {chosen ?? anyLabel}
        </Text>
        <Chevron size={16} color={t.colors.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.list, surface]}>
          {searchable ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={
                hint ? `Search, e.g. ${hint}` : `Search ${label.toLowerCase()}`
              }
              placeholderTextColor={t.colors.muted}
              accessibilityLabel={`Search ${label.toLowerCase()}`}
              autoCorrect={false}
              style={[
                styles.search,
                { color: t.colors.ink, borderBottomColor: t.colors.hair },
              ]}
            />
          ) : null}
          <ScrollView
            style={{ maxHeight: LIST_HEIGHT }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {needle ? null : row('', anyLabel)}
            {shown.map(o => row(o.value, o.label, o.note))}
            {shown.length === 0 ? (
              <Text style={[styles.none, { color: t.colors.muted }]}>
                Nothing matches.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  label: { fontFamily: fonts.regular, fontSize: 11, marginBottom: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    overflow: 'hidden',
  },
  fieldText: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  list: {
    marginTop: 6,
    borderRadius: 13,
    borderWidth: 1,
    overflow: 'hidden',
  },
  search: {
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 42,
  },
  itemText: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 12 },
  none: {
    fontFamily: fonts.regular,
    fontSize: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
