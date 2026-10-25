import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  FileArchive,
  FileSpreadsheet,
  FileText,
  Plus,
} from 'lucide-react-native';
import { Card } from '../ui/Card';
import { fonts, useTheme } from '../../theme';

export type DocRowData = {
  key: string;
  name: string;
  meta: string;
  /** Tagged "New" (a corrigendum or a file added since the last look). */
  fresh?: boolean;
  /** Tender docs: where the file is (on the server, on this device...). */
  state?: 'remote' | 'downloading' | 'downloaded' | 'failed' | 'unavailable';
};

function DocIcon({ name }: { name: string }) {
  const t = useTheme();
  const ext = name.split('.').pop()?.toLowerCase();
  const Icon =
    ext === 'zip'
      ? FileArchive
      : ext === 'xls' || ext === 'xlsx' || ext === 'csv'
      ? FileSpreadsheet
      : FileText;
  return (
    <View style={[styles.icon, { backgroundColor: t.colors.accentWash }]}>
      <Icon size={17} color={t.colors.accent} />
    </View>
  );
}

/** A titled list of files with one action per row (download, or remove). */
export function DocGroup({
  title,
  count,
  rows,
  rowAction,
  onAdd,
  empty,
  footer,
  onRowPress,
}: {
  title: string;
  count?: string;
  rows: DocRowData[];
  rowAction: {
    /** One icon for every row, or one per row (download / open / retry). */
    icon: React.ReactNode | ((row: DocRowData) => React.ReactNode);
    label: (row: DocRowData) => string;
    onPress: (row: DocRowData) => void;
  };
  onAdd?: () => void;
  empty?: string;
  /** Under the list: Download all, Request documents, warnings. */
  footer?: React.ReactNode;
  /** Tap a row (not its action button), e.g. to open the file. */
  onRowPress?: (row: DocRowData) => void;
}) {
  const t = useTheme();
  return (
    <Card padding={16} radius="lg" elevation="sm" style={styles.card}>
      <View style={styles.head}>
        <Text style={[styles.h3, { color: t.colors.ink }]}>{title}</Text>
        {onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add to ${title}`}
            onPress={onAdd}
            hitSlop={8}
            style={[styles.add, { backgroundColor: t.colors.accentWash }]}
          >
            <Plus size={16} color={t.colors.accent} />
          </Pressable>
        ) : count ? (
          <Text style={[styles.count, { color: t.colors.muted }]}>{count}</Text>
        ) : null}
      </View>
      {rows.map((r, i) => (
        <View
          key={r.key}
          style={[
            styles.row,
            i > 0 && { borderTopWidth: 1, borderTopColor: t.colors.hair },
          ]}
        >
          <DocIcon name={r.name} />
          <Pressable
            style={styles.copy}
            disabled={!onRowPress}
            accessibilityRole={onRowPress ? 'button' : undefined}
            accessibilityLabel={onRowPress ? `Open ${r.name}` : undefined}
            onPress={() => onRowPress?.(r)}
          >
            <Text
              numberOfLines={1}
              style={[styles.name, { color: t.colors.ink }]}
            >
              {r.name}
            </Text>
            <Text style={[styles.meta, { color: t.colors.muted }]}>
              {r.meta}
              {r.fresh ? (
                <Text
                  style={{ color: t.colors.warn, fontFamily: fonts.semibold }}
                >
                  {' '}
                  · New
                </Text>
              ) : null}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={rowAction.label(r)}
            onPress={() => rowAction.onPress(r)}
            hitSlop={10}
            style={styles.action}
          >
            {typeof rowAction.icon === 'function'
              ? rowAction.icon(r)
              : rowAction.icon}
          </Pressable>
        </View>
      ))}
      {rows.length === 0 && empty ? (
        <Text style={[styles.empty, { color: t.colors.muted }]}>{empty}</Text>
      ) : null}
      {footer}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  h3: { fontFamily: fonts.displaySemibold, fontSize: 16, letterSpacing: -0.4 },
  count: { fontFamily: fonts.medium, fontSize: 11 },
  add: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  name: { fontFamily: fonts.medium, fontSize: 13 },
  meta: { fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  action: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { fontFamily: fonts.regular, fontSize: 12, paddingVertical: 10 },
});
