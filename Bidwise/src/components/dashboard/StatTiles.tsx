import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bookmark, Clock, FolderOpen, Globe } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { Card } from '../ui/Card';

type Tone = 'accent' | 'good' | 'warn' | 'crit';

function useTone(tone: Tone) {
  const t = useTheme();
  return {
    accent: { bg: t.colors.accentWash, fg: t.colors.accentInk },
    good: { bg: t.colors.goodWash, fg: t.colors.good },
    warn: { bg: t.colors.warnWash, fg: t.colors.warn },
    crit: { bg: t.colors.critWash, fg: t.colors.crit },
  }[tone];
}

function IconChip({
  tone,
  children,
}: {
  tone: Tone;
  children: (color: string) => React.ReactNode;
}) {
  const t = useTheme();
  const c = useTone(tone);
  // Glass cards are pale, so the light wash disappears: use a stronger tint of the tone.
  const tint = { backgroundColor: t.isGlass ? `${c.fg}38` : c.bg };
  return <View style={[styles.icon, tint]}>{children(c.fg)}</View>;
}

type TileProps = {
  value: number;
  label: string;
  tone: Tone;
  icon: 'globe' | 'folder' | 'clock';
  onPress: () => void;
};

const ICONS = { globe: Globe, folder: FolderOpen, clock: Clock } as const;

export function StatTile({ value, label, tone, icon, onPress }: TileProps) {
  const t = useTheme();
  const Icon = ICONS[icon];
  const c = useTone(tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={styles.cell}
    >
      <Card elevation="md" padding={12}>
        <IconChip tone={tone}>{() => <Icon size={19} color={c.fg} />}</IconChip>
        <Text style={[styles.value, { color: t.colors.ink }]}>{value}</Text>
        <Text style={[styles.label, { color: t.colors.muted }]}>{label}</Text>
      </Card>
    </Pressable>
  );
}

type BookmarksProps = {
  orgs: number;
  tenders: number;
  onOrgs: () => void;
  onTenders: () => void;
};

/** Bookmarked organisations and tenders side by side. */
export function BookmarksTile({
  orgs,
  tenders,
  onOrgs,
  onTenders,
}: BookmarksProps) {
  const t = useTheme();
  return (
    <View style={styles.cell}>
      <Card elevation="md" padding={12}>
        <IconChip tone="warn">
          {color => <Bookmark size={19} color={color} />}
        </IconChip>
        <View style={styles.split}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Bookmarked organisations: ${orgs}`}
            onPress={onOrgs}
            style={styles.half}
          >
            <Text style={[styles.value, { color: t.colors.ink }]}>{orgs}</Text>
            <Text style={[styles.label, { color: t.colors.muted }]}>Orgs</Text>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: t.colors.hair }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Bookmarked tenders: ${tenders}`}
            onPress={onTenders}
            style={styles.half}
          >
            <Text style={[styles.value, { color: t.colors.ink }]}>
              {tenders}
            </Text>
            <Text style={[styles.label, { color: t.colors.muted }]}>
              Tenders
            </Text>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { flex: 1 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontFamily: fonts.extrabold,
    fontSize: 26,
    letterSpacing: -0.5,
    marginTop: 8,
    marginLeft: 2,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 1,
    marginLeft: 2,
  },
  split: { flexDirection: 'row', alignItems: 'stretch' },
  half: { flex: 1 },
  divider: { width: 1, marginHorizontal: 10, marginTop: 8 },
});
