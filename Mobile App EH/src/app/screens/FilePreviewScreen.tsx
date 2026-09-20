import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { EmptyState, Screen, ScreenHeader } from '../../components/ui';
import { useProjects } from '../../fixtures/projects';
import { fonts } from '../../theme';
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
      <View style={styles.sheet}>
        <Text style={styles.heading}>{found.file}</Text>
        {Array.from({ length: 20 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.line,
              i % 4 === 3 && styles.short,
              i % 7 === 6 && styles.medium,
            ]}
          />
        ))}
        <Text style={styles.note}>
          Preview placeholder. The attached document shows here once file
          handling is connected.
        </Text>
      </View>
    </Screen>
  );
}

// A paper sheet: fixed light colours on purpose, like a printed page in any theme.
const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    padding: 22,
    gap: 9,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#1b1d24',
    marginBottom: 8,
  },
  line: { height: 8, borderRadius: 3, backgroundColor: '#e6e6e8' },
  short: { width: '62%' },
  medium: { width: '83%' },
  note: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: '#8a8a90',
    fontStyle: 'italic',
    marginTop: 12,
  },
});
