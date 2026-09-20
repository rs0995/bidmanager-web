import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import type { Project } from '../../fixtures/projects';
import { projectProgress } from '../../lib/projectProgress';
import { Card } from '../ui/Card';
import { StatusChip } from '../ui/Chip';
import { ProgressRing } from '../ui/ProgressRing';

export function ProjectCard({
  project,
  onPress,
}: {
  project: Project;
  onPress: () => void;
}) {
  const t = useTheme();
  const p = projectProgress(project);
  const tone = { ok: t.colors.good, soon: t.colors.warn, crit: t.colors.crit }[
    project.state
  ];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.press}
    >
      <Card padding={14} elevation="sm">
        <View style={styles.row}>
          <ProgressRing
            size={46}
            stroke={5}
            progress={p.pct / 100}
            colors={[tone, tone]}
          >
            <Text style={[styles.pct, { color: t.colors.ink }]}>{p.pct}</Text>
          </ProgressRing>
          <View style={styles.text}>
            <Text style={[styles.title, { color: t.colors.ink }]}>
              {project.title}
            </Text>
            <Text style={[styles.meta, { color: t.colors.muted }]}>
              {project.client} · {project.value}
            </Text>
            <Text style={[styles.docs, { color: t.colors.muted }]}>
              {p.done}/{p.total} docs ready
            </Text>
          </View>
          <StatusChip tone={project.state} label={project.dueIn} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1 },
  pct: { fontFamily: fonts.monoSemibold, fontSize: 12 },
  title: { fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 3 },
  docs: { fontFamily: fonts.monoMedium, fontSize: 11, marginTop: 2 },
});
