import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Archive,
  ArrowUpRight,
  Building2,
  CircleCheck,
  Clock3,
  ListChecks,
  MapPin,
} from 'lucide-react-native';
import {
  Card,
  IconButton,
  Segmented,
  PageTitle,
  ProgressBar,
  Screen,
  SearchField,
} from '../../components/ui';
import { FadeSwitch } from '../../components/ui/motion';
import { Project, useProjects } from '../../fixtures/projects';
import { useTenderSource } from '../../data/tenderSource';
import { hoursUntilClose, leftLabel } from '../../lib/deadlines';
import { splitValue } from '../../lib/format';
import { projectProgress } from '../../lib/projectProgress';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Projects'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Section = 'Active' | 'Submitted';

export const projectSection = (p: Project): Section =>
  p.status === 'Submitted' ? 'Submitted' : 'Active';

/**
 * Time-left pill in BM Pro's colours (calendar days): red within 3 days, amber within
 * a week, green beyond. "Closed" once the deadline has passed.
 */
export function timeLeftPill(dueIn: string): {
  label: string;
  tone: 'crit' | 'warn' | 'good' | 'muted';
} {
  if (dueIn === 'Closed') return { label: 'Closed', tone: 'muted' };
  if (!dueIn || dueIn === '—') return { label: 'No deadline', tone: 'muted' };
  const days = Math.floor(hoursUntilClose(dueIn) / 24);
  return {
    label: leftLabel(dueIn),
    tone: days <= 3 ? 'crit' : days <= 7 ? 'warn' : 'good',
  };
}

export function ProjectCard({
  p,
  onOpen,
  footer,
}: {
  p: Project;
  onOpen: () => void;
  /** Under the progress line, inside the card (the archive's Restore / Delete). */
  footer?: React.ReactNode;
}) {
  const t = useTheme();
  const { tender } = useTenderSource().useTender(p.sourceTenderId);
  const submitted = p.status === 'Submitted';
  const prog = projectProgress(p);
  const { amount, unit } = splitValue(p.value);
  // As BM Pro: the linked tender's current closing date (a corrigendum may have
  // extended it), falling back to the deadline saved when the project started.
  const left = timeLeftPill(
    tender && tender.closeIn && tender.closeIn !== '—'
      ? tender.closeIn
      : p.dueIn,
  );
  const tones = {
    crit: { bg: t.colors.critWash, fg: t.colors.crit },
    warn: { bg: t.colors.warnWash, fg: t.colors.warn },
    good: { bg: t.colors.goodWash, fg: t.colors.good },
    muted: { bg: t.colors.surfaceSunk, fg: t.colors.muted },
  };
  const pill = submitted
    ? { label: 'Submitted', ...tones.good }
    : { label: left.label, ...tones[left.tone] };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${p.title}, ${pill.label}`}
      onPress={onOpen}
    >
      <Card padding={16} radius="lg" elevation="sm" style={styles.card}>
        <View style={styles.top}>
          <View style={styles.org}>
            <Building2 size={15} color={t.colors.accent} />
            <Text
              numberOfLines={1}
              style={[styles.orgText, { color: t.colors.inkSoft }]}
            >
              {p.client}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: pill.bg }]}>
            {submitted ? (
              <CircleCheck size={12} color={pill.fg} />
            ) : (
              <Clock3 size={12} color={pill.fg} />
            )}
            <Text style={[styles.badgeText, { color: pill.fg }]}>
              {pill.label}
            </Text>
          </View>
        </View>
        <Text style={[styles.id, { color: t.colors.accentInk }]}>
          {p.tenderRef ?? p.sourceTenderId}
        </Text>
        <Text numberOfLines={2} style={[styles.title, { color: t.colors.ink }]}>
          {p.title}
        </Text>
        {tender ? (
          <View style={styles.loc}>
            <MapPin size={13} color={t.colors.muted} />
            <Text style={[styles.locText, { color: t.colors.muted }]}>
              {tender.location}
            </Text>
          </View>
        ) : null}
        <View style={[styles.bottom, { borderTopColor: t.colors.hair }]}>
          <Text style={[styles.value, { color: t.colors.ink }]}>
            {amount}
            {unit ? (
              <Text style={[styles.unit, { color: t.colors.muted }]}>
                {' '}
                {unit}
              </Text>
            ) : null}
          </Text>
          <ArrowUpRight size={15} color={t.colors.muted} />
        </View>
        <ProgressBar
          height={5}
          progress={submitted ? 1 : prog.total ? prog.done / prog.total : 0}
        />
        <View style={styles.progRow}>
          {submitted ? (
            <CircleCheck size={14} color={t.colors.good} />
          ) : (
            <ListChecks size={14} color={t.colors.accent} />
          )}
          <Text style={[styles.progText, { color: t.colors.inkSoft }]}>
            {submitted
              ? 'Submission complete'
              : `${prog.done} of ${prog.total} documents ready`}
          </Text>
        </View>
        {footer}
      </Card>
    </Pressable>
  );
}

export function ProjectsScreen() {
  const t = useTheme();
  const navigation = useNavigation<Nav>();
  const { projects } = useProjects();
  const [section, setSection] = useState<Section>('Active');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter(
      p =>
        projectSection(p) === section &&
        (!needle ||
          `${p.title} ${p.client} ${p.sourceTenderId}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [projects, section, search]);
  const counts = useMemo(
    () => ({
      Active: projects.filter(p => projectSection(p) === 'Active').length,
      Submitted: projects.filter(p => projectSection(p) === 'Submitted').length,
    }),
    [projects],
  );

  return (
    <Screen tabBar>
      {/* As BM Pro: archived projects, which can be restored, open from here. */}
      <View style={styles.head}>
        <IconButton
          label="Archived projects"
          onPress={() => navigation.navigate('ArchivedProjects')}
        >
          <Archive size={18} color={t.colors.inkSoft} />
        </IconButton>
      </View>
      <PageTitle sub="Your bids, moving forward.">Projects</PageTitle>
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search projects"
      />
      <Segmented<Section>
        style={styles.sections}
        value={section}
        onChange={setSection}
        options={[
          { value: 'Active', label: `Active · ${counts.Active}` },
          { value: 'Submitted', label: `Submitted · ${counts.Submitted}` },
        ]}
      />
      <FadeSwitch id={section}>
        {visible.map(p => (
          <ProjectCard
            key={p.id}
            p={p}
            onOpen={() => navigation.navigate('ProjectDetail', { id: p.id })}
          />
        ))}
        {visible.length === 0 ? (
          <Text style={[styles.empty, { color: t.colors.muted }]}>
            No projects found.
          </Text>
        ) : null}
      </FadeSwitch>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  sections: { marginTop: 12, marginBottom: 16 },
  card: { marginBottom: 12 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  org: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  orgText: { fontFamily: fonts.medium, fontSize: 11, flexShrink: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { fontFamily: fonts.semibold, fontSize: 10 },
  id: { fontFamily: fonts.monoSemibold, fontSize: 11, marginTop: 12 },
  title: {
    // Portal titles are long and often ALL CAPS: Inter at normal spacing stays even.
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
  },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  locText: { fontFamily: fonts.regular, fontSize: 11 },
  bottom: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  value: {
    fontFamily: fonts.bold,
    fontSize: 18,
    letterSpacing: -0.2,
  },
  unit: { fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0 },
  due: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dueText: { fontFamily: fonts.medium, fontSize: 11 },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  progText: { fontFamily: fonts.regular, fontSize: 11 },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 30,
  },
});
