import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Archive } from 'lucide-react-native';
import { ProjectCard } from '../../components/project/ProjectCard';
import {
  EmptyState,
  Screen,
  ScreenHeader,
  SegmentedControl,
} from '../../components/ui';
import { ARCHIVED_COUNT, useProjects } from '../../fixtures/projects';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Seg = 'active' | 'archived';

export function ProjectsScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { projects } = useProjects();
  const [seg, setSeg] = useState<Seg>('active');

  return (
    <Screen tabBar>
      <ScreenHeader title="Projects" subtitle="Track bids in preparation" />
      <View style={styles.seg}>
        <SegmentedControl
          options={[
            { key: 'active', label: `Active · ${projects.length}` },
            { key: 'archived', label: `Archived · ${ARCHIVED_COUNT}` },
          ]}
          value={seg}
          onChange={setSeg}
        />
      </View>
      {seg === 'active' ? (
        projects.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            onPress={() => navigation.navigate('ProjectDetail', { id: p.id })}
          />
        ))
      ) : (
        <EmptyState
          icon={<Archive size={24} color={t.colors.accentInk} />}
          title={`${ARCHIVED_COUNT} archived projects`}
          description="Completed bids are kept in your archive. The full archive view comes with the next update."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  seg: { marginBottom: 14 },
});
