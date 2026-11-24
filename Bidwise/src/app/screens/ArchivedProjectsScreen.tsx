import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArchiveRestore, ChevronLeft, Trash2 } from 'lucide-react-native';
import {
  Button,
  IconButton,
  Screen,
  SearchField,
  useToast,
} from '../../components/ui';
import { useProjects } from '../../fixtures/projects';
import { showActionSheet } from '../../platform/actionSheet';
import { fonts, useTheme } from '../../theme';
import { ProjectCard } from './ProjectsScreen';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Archived projects (as BM Pro's Archived tab): open one, restore it to Active, or
 * delete it for good.
 */
export function ArchivedProjectsScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation<Nav>();
  const { archivedProjects, restoreProject, deleteProject } = useProjects();
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return archivedProjects.filter(
      p =>
        !needle ||
        `${p.title} ${p.client} ${p.tenderRef ?? p.sourceTenderId}`
          .toLowerCase()
          .includes(needle),
    );
  }, [archivedProjects, search]);

  const confirmDelete = (id: string, title: string) =>
    showActionSheet(
      `Delete “${title}”? Its checklist and documents go too, on every device. This can’t be undone.`,
      [
        {
          label: 'Delete project',
          destructive: true,
          onPress: () => {
            deleteProject(id);
            toast.show('Project deleted');
          },
        },
      ],
    );

  const n = archivedProjects.length;
  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <Text style={[styles.title, { color: t.colors.ink }]}>
        Archived projects
      </Text>
      <Text style={[styles.sub, { color: t.colors.muted }]}>
        {n} archived project{n === 1 ? '' : 's'}
      </Text>
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search archived projects"
      />
      <View style={styles.gap} />
      {visible.map(p => (
        <ProjectCard
          key={p.id}
          p={p}
          onOpen={() => navigation.navigate('ProjectDetail', { id: p.id })}
          footer={
            <View style={[styles.actions, { borderTopColor: t.colors.hair }]}>
              <View style={styles.action}>
                <Button
                  label="Restore"
                  variant="secondary"
                  size="sm"
                  block
                  icon={<ArchiveRestore size={15} color={t.colors.ink} />}
                  onPress={() => {
                    restoreProject(p.id);
                    toast.show('Project restored to Active');
                  }}
                />
              </View>
              <View style={styles.action}>
                <Button
                  label="Delete"
                  variant="danger"
                  size="sm"
                  block
                  icon={<Trash2 size={15} color={t.colors.crit} />}
                  onPress={() => confirmDelete(p.id, p.title)}
                />
              </View>
            </View>
          }
        />
      ))}
      {visible.length === 0 ? (
        <Text style={[styles.empty, { color: t.colors.muted }]}>
          {n
            ? 'No archived projects match your search.'
            : 'No archived projects. Archive one from its page to move it here.'}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  sub: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    marginTop: 4,
    marginBottom: 14,
  },
  gap: { height: 16 },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  action: { flex: 1 },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 30,
  },
});
