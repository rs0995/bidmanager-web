import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { Plus } from 'lucide-react-native';
import { AddChecklistItemForm } from '../../components/project/AddChecklistItemForm';
import { ChecklistItem } from '../../components/project/ChecklistItem';
import { FieldGrid } from '../../components/tender/FieldGrid';
import {
  EmptyState,
  ProgressBar,
  Screen,
  ScreenHeader,
  StatusChip,
  useToast,
} from '../../components/ui';
import { useProjects } from '../../fixtures/projects';
import { folderNames, projectProgress } from '../../lib/projectProgress';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

export function ProjectDetailScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } =
    useRoute<
      NativeStackScreenProps<RootStackParamList, 'ProjectDetail'>['route']
    >();
  const toast = useToast();
  const { getProject, addItem, attachFile, removeFile } = useProjects();
  const [adding, setAdding] = useState(false);
  const project = getProject(params.id);

  if (!project) {
    return (
      <Screen>
        <ScreenHeader title="Project" onBack={() => navigation.goBack()} />
        <EmptyState
          title="Project not found"
          description="It may have been removed."
        />
      </Screen>
    );
  }

  const progress = projectProgress(project);

  return (
    <Screen>
      <ScreenHeader title="Project" onBack={() => navigation.goBack()} />

      <Text style={[styles.id, { color: t.colors.accentInk }]}>
        {project.id}
      </Text>
      <Text style={[styles.title, { color: t.colors.ink }]}>
        {project.title}
      </Text>

      <View style={styles.progress}>
        <View style={styles.bar}>
          <ProgressBar progress={progress.pct / 100} height={7} />
        </View>
        <Text style={[styles.pct, { color: t.colors.ink }]}>
          {progress.pct}%
        </Text>
      </View>
      <View style={styles.chips}>
        <StatusChip tone={project.state} label={`Due ${project.dueIn}`} />
        <StatusChip tone="plain" label={`Pre-bid ${project.prebid}`} />
      </View>

      <FieldGrid
        items={[
          {
            label: 'Source tender ID',
            value: project.sourceTenderId,
            full: true,
          },
          { label: 'Client', value: project.client, full: true },
          { label: 'Project value', value: project.value },
          { label: 'EMD', value: project.emd },
          { label: 'Pre-bid meeting', value: project.prebid },
          { label: 'Deadline', value: project.deadline },
          { label: 'Status', value: project.status },
          {
            label: 'Documents ready',
            value: `${progress.done} / ${progress.total}`,
          },
          { label: 'Work description', value: project.description, full: true },
        ]}
      />

      <View style={styles.head}>
        <Text style={[styles.section, { color: t.colors.muted }]}>
          DOCUMENT CHECKLIST
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add checklist item"
          onPress={() => setAdding(a => !a)}
          style={[
            styles.add,
            {
              backgroundColor: t.colors.accentWash,
              borderColor: `${t.colors.accent}44`,
            },
          ]}
        >
          <Plus size={13} color={t.colors.accentInk} />
          <Text style={[styles.addText, { color: t.colors.accentInk }]}>
            Add item
          </Text>
        </Pressable>
      </View>

      {adding ? (
        <AddChecklistItemForm
          folders={folderNames(project)}
          onCancel={() => setAdding(false)}
          onSubmit={(folder, name, note) => {
            addItem(project.id, folder, name, note);
            setAdding(false);
            toast.show('Item added to checklist');
          }}
        />
      ) : null}

      {project.checklist.map(folder => {
        const done = folder.items.filter(i => i.done).length;
        return (
          <View key={folder.name} style={styles.folder}>
            <Text style={[styles.folderName, { color: t.colors.inkSoft }]}>
              {folder.name}{' '}
              <Text style={{ color: t.colors.muted }}>
                {done}/{folder.items.length}
              </Text>
            </Text>
            {folder.items.length === 0 ? (
              <Text style={[styles.empty, { color: t.colors.muted }]}>
                No items in this section yet
              </Text>
            ) : null}
            {folder.items.map(it => (
              <ChecklistItem
                key={it.id}
                item={it}
                onAttach={() => {
                  const replacing = !!it.file;
                  attachFile(project.id, it.id);
                  toast.show(
                    replacing ? 'Document replaced' : 'Document attached',
                  );
                }}
                onRemoveFile={() => {
                  removeFile(project.id, it.id);
                  toast.show('Document removed');
                }}
                onPreview={() =>
                  navigation.navigate('FilePreview', {
                    projectId: project.id,
                    itemId: it.id,
                  })
                }
              />
            ))}
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  id: { fontFamily: fonts.monoMedium, fontSize: 11.5 },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    marginTop: 6,
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  bar: { flex: 1 },
  pct: { fontFamily: fonts.monoSemibold, fontSize: 12 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 16 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 10,
  },
  section: {
    fontFamily: fonts.bold,
    fontSize: 10.5,
    letterSpacing: 0.9,
    marginLeft: 2,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  addText: { fontFamily: fonts.bold, fontSize: 12 },
  folder: { marginTop: 8 },
  folderName: {
    fontFamily: fonts.bold,
    fontSize: 12,
    marginBottom: 8,
    marginTop: 6,
  },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    fontStyle: 'italic',
    marginBottom: 8,
  },
});
