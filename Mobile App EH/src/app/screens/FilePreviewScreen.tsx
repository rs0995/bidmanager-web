import React from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { EmptyState, Screen, ScreenHeader } from '../../components/ui';
import { PaperPage } from '../../components/ui/PaperPage';
import { useProjects } from '../../fixtures/projects';
import type { RootStackParamList } from '../navigation/types';

/**
 * Phase 1: a stand-in page. Phase 2F replaces the body with the real viewer (PDF via
 * WebView, images inline) for the attached file.
 */
export function FilePreviewScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } =
    useRoute<
      NativeStackScreenProps<RootStackParamList, 'FilePreview'>['route']
    >();
  const { getProject } = useProjects();
  const found = getProject(params.projectId)
    ?.checklist.flatMap(f => f.items)
    .find(i => i.id === params.itemId);

  if (!found || !found.file) {
    return (
      <Screen>
        <ScreenHeader title="Preview" onBack={() => navigation.goBack()} />
        <EmptyState
          title="No file attached"
          description="Attach a document to preview it here."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title={found.file}
        subtitle={found.name}
        onBack={() => navigation.goBack()}
      />
      <PaperPage
        title={found.file}
        note="Preview placeholder. The attached document shows here once file handling is connected."
      />
    </Screen>
  );
}
