import React from 'react';
import {
  KeyboardTypeOptions,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Check, Eye, EyeOff, Search, X } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { Txt } from './Txt';

/* ── Chips ─────────────────────────────────────────────────────────── */

type ChipOption<T extends string> = { value: T; label: string; count?: number };

/** Horizontal scrolling single-select filter buttons (desktop job / level filters). */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              {
                backgroundColor: on ? t.colors.ink : t.colors.surface,
                borderColor: on ? t.colors.ink : t.colors.hair,
              },
            ]}
          >
            <Txt
              style={[
                styles.monoCaps,
                { color: on ? t.colors.onAccent : t.colors.ink2 },
              ]}
            >
              {o.label}
              {o.count != null ? `  ${o.count}` : ''}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ── Segmented control ─────────────────────────────────────────────── */

/** Bordered strip, selected option filled indigo (desktop `Segmented`). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.seg, { borderColor: t.colors.hair }]}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[
              styles.segItem,
              {
                backgroundColor: on ? t.colors.accent : t.colors.surface,
                borderLeftWidth: i > 0 ? 1 : 0,
                borderLeftColor: on ? t.colors.accent : t.colors.hair,
              },
            ]}
          >
            <Txt
              numberOfLines={1}
              style={[
                styles.segText,
                { color: on ? t.colors.onAccent : t.colors.ink2 },
              ]}
            >
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── Toggle and checkbox ───────────────────────────────────────────── */

/** Square switch with a white block knob (desktop `Toggle`). */
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={10}
      style={[
        styles.toggle,
        {
          backgroundColor: value ? t.colors.accent : t.colors.toggleOff,
          borderColor: value ? t.colors.accent : t.colors.hair,
        },
      ]}
    >
      <View
        style={[styles.knob, { transform: [{ translateX: value ? 20 : 0 }] }]}
      />
    </Pressable>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      hitSlop={10}
      style={[
        styles.box,
        {
          borderColor: checked ? t.colors.accent : t.colors.hair,
          backgroundColor: checked ? t.colors.accent : t.colors.surface,
        },
      ]}
    >
      {checked ? (
        <Check size={12} color={t.colors.onAccent} strokeWidth={3} />
      ) : null}
    </Pressable>
  );
}

/* ── Text inputs ───────────────────────────────────────────────────── */

type FieldProps = {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  hint?: string;
  secure?: boolean;
  mono?: boolean;
  /** Unit shown in a paper box at the right edge (desktop `NumIn`). */
  suffix?: string;
  keyboardType?: KeyboardTypeOptions;
  /** Compact right-aligned input for settings rows (numbers, times). */
  compact?: boolean;
  editable?: boolean;
};

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  secure,
  mono,
  suffix,
  keyboardType,
  compact,
  editable = true,
}: FieldProps) {
  const t = useTheme();
  const [hidden, setHidden] = React.useState(true);
  const input = (
    <View
      style={[
        styles.input,
        { backgroundColor: t.colors.surface, borderColor: t.colors.hair },
        compact && styles.inputCompact,
        !editable && { backgroundColor: t.colors.raised },
      ]}
    >
      <TextInput
        editable={editable}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.ink3}
        secureTextEntry={secure && hidden}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        style={[
          styles.inputText,
          {
            color: t.colors.ink,
            fontFamily: mono ? fonts.mono : fonts.regular,
          },
          compact && styles.inputTextCompact,
        ]}
      />
      {secure ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hidden ? 'Show' : 'Hide'}
          onPress={() => setHidden(h => !h)}
          hitSlop={8}
          style={styles.eye}
        >
          {hidden ? (
            <Eye size={16} color={t.colors.ink3} />
          ) : (
            <EyeOff size={16} color={t.colors.ink3} />
          )}
        </Pressable>
      ) : null}
      {suffix ? (
        <View
          style={[
            styles.suffix,
            { backgroundColor: t.colors.raised, borderLeftColor: t.colors.hair },
          ]}
        >
          <Txt style={[styles.suffixText, { color: t.colors.ink3 }]}>
            {suffix}
          </Txt>
        </View>
      ) : null}
    </View>
  );
  if (compact) return input;
  return (
    <View style={styles.field}>
      {label ? <Txt variant="bodyStrong">{label}</Txt> : null}
      {input}
      {hint ? (
        <Txt variant="small" color="ink3">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.input,
        styles.search,
        { backgroundColor: t.colors.surface, borderColor: t.colors.hair },
      ]}
    >
      <Search size={14} color={t.colors.ink3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.ink3}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={placeholder}
        style={[
          styles.inputText,
          { color: t.colors.ink, fontFamily: fonts.mono },
        ]}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={8}
        >
          <X size={15} color={t.colors.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ── Settings row ──────────────────────────────────────────────────── */

/** One editable setting (desktop `Field`): label + hint, control right or below. */
export function SettingRow({
  label,
  hint,
  dirty,
  stacked,
  divider,
  children,
}: {
  label: string;
  hint?: string;
  dirty?: boolean;
  stacked?: boolean;
  divider?: boolean;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.setting,
        !stacked && styles.settingInline,
        divider && { borderTopWidth: 1, borderTopColor: t.colors.hairSoft },
      ]}
    >
      <View style={stacked ? undefined : styles.settingText}>
        <View style={styles.settingLabel}>
          <Txt variant="bodyStrong" style={styles.settingLabelText}>
            {label}
          </Txt>
          {dirty ? (
            <View style={[styles.dirty, { backgroundColor: t.colors.warn }]} />
          ) : null}
        </View>
        {hint ? (
          <Txt variant="small" color="ink3" style={styles.hint}>
            {hint}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/* ── Weekday picker ────────────────────────────────────────────────── */

export const WEEKDAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const;

/** Value is a comma list of weekday keys ("sat,sun"), same as the server setting. */
export function WeekdayPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTheme();
  const days = new Set(
    value
      .split(',')
      .map(d => d.trim())
      .filter(Boolean),
  );
  return (
    <View style={styles.weekdays}>
      {WEEKDAYS.map(({ key, label }) => {
        const on = days.has(key);
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              const next = new Set(days);
              if (on) next.delete(key);
              else next.add(key);
              onChange(
                WEEKDAYS.map(w => w.key)
                  .filter(k => next.has(k))
                  .join(','),
              );
            }}
            style={[
              styles.day,
              {
                backgroundColor: on ? t.colors.ink : t.colors.surface,
                borderColor: on ? t.colors.ink : t.colors.hair,
              },
            ]}
          >
            <Txt
              style={[
                styles.monoCaps,
                { color: on ? t.colors.onAccent : t.colors.ink3 },
              ]}
            >
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  monoCaps: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  chips: { gap: 6, paddingVertical: 1 },
  chip: {
    paddingHorizontal: 11,
    height: 30,
    justifyContent: 'center',
    borderWidth: 1,
  },
  seg: { flexDirection: 'row', borderWidth: 1 },
  segItem: {
    flex: 1,
    height: 34,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segText: { fontFamily: fonts.mono, fontSize: 11.5, letterSpacing: 0.4 },
  toggle: { width: 42, height: 22, borderWidth: 1, padding: 2 },
  knob: { width: 16, height: 16, backgroundColor: '#FFFFFF' },
  box: {
    width: 18,
    height: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { gap: 6 },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderWidth: 1,
    overflow: 'hidden',
  },
  search: { gap: 8, paddingHorizontal: 10, height: 38 },
  inputCompact: { height: 32, minWidth: 104 },
  inputText: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
    paddingHorizontal: 10,
    minWidth: 0,
  },
  inputTextCompact: { textAlign: 'right', fontSize: 12.5, paddingHorizontal: 8 },
  eye: { paddingHorizontal: 10 },
  suffix: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderLeftWidth: 1,
  },
  suffixText: { fontFamily: fonts.mono, fontSize: 10.5 },
  setting: { paddingVertical: 11, gap: 8 },
  settingInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  settingText: { flex: 1 },
  settingLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  settingLabelText: { fontSize: 13 },
  hint: { marginTop: 2, fontSize: 11.5 },
  dirty: { width: 5, height: 5, borderRadius: 3 },
  weekdays: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  day: {
    paddingHorizontal: 10,
    height: 30,
    justifyContent: 'center',
    borderWidth: 1,
  },
});
