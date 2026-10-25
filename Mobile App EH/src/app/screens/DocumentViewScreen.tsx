import React from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { FileWarning, Share2 } from 'lucide-react-native';
import {
  EmptyState,
  IconButton,
  Screen,
  ScreenHeader,
  useToast,
} from '../../components/ui';
import { PaperPage } from '../../components/ui/PaperPage';
import { useDownloads } from '../../fixtures/downloads';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/**
 * A downloaded PDF, or a PDF inside a downloaded ZIP (`entryName`). Phase 1 shows a
 * placeholder page; Phase 2F renders the real file in a WebView and shares it.
 */
export function DocumentViewScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } =
    useRoute<
      NativeStackScreenProps<RootStackParamList, 'DocumentView'>['route']
    >();
  const toast = useToast();
  const item = useDownloads().getDownload(params.downloadId);
  const title = params.entryName ?? item?.fileName;

  if (!item || !title) {
    return (
      <Screen>
        <ScreenHeader title="Document" onBack={() => navigation.goBack()} />
        <EmptyState
          icon={<FileWarning size={24} color={t.colors.accentInk} />}
          title="Document not found"
          description="It may have been removed by Clear cache — try downloading it again."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title={title}
        titleLines={2}
        subtitle={item.tenderTitle}
        onBack={() => navigation.goBack()}
        right={
          <IconButton
            label="Share"
            onPress={() => toast.show('Opening the share sheet…')}
          >
            <Share2 size={18} color={t.colors.ink} />
          </IconButton>
        }
      />
      <PaperPage title={title} />
    </Screen>
  );
}
