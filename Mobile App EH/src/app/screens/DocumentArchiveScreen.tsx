import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  ChevronRight,
  File as FileIcon,
  FileText,
  PackageOpen,
} from 'lucide-react-native';
import {
  Card,
  EmptyState,
  Screen,
  ScreenHeader,
  useToast,
} from '../../components/ui';
import { useDownloads } from '../../fixtures/downloads';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/** The files inside a downloaded ZIP. PDFs open in the viewer; others go to the share sheet. */
export function DocumentArchiveScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } =
    useRoute<
      NativeStackScreenProps<RootStackParamList, 'DocumentArchive'>['route']
    >();
  const toast = useToast();
  const item = useDownloads().getDownload(params.downloadId);
  const entries = item?.entries ?? [];

  const header = (
    <ScreenHeader
      title={item?.fileName ?? 'Archive'}
      subtitle={item ? item.tenderTitle : undefined}
      onBack={() => navigation.goBack()}
    />
  );

  if (!item || entries.length === 0) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon={<PackageOpen size={24} color={t.colors.accentInk} />}
          title={item ? 'Archive is empty' : 'Could not open archive'}
          description={
            item ? undefined : 'It may have been removed by Clear cache.'
          }
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <Card padding={4} elevation="sm">
        {entries.map((e, i) => {
          const pdf = /\.pdf$/i.test(e.name);
          const Icon = pdf ? FileText : FileIcon;
          return (
            <Pressable
              key={e.name}
              accessibilityRole="button"
              accessibilityLabel={e.name}
              onPress={() =>
                pdf
                  ? navigation.navigate('DocumentView', {
                      downloadId: item.id,
                      entryName: e.name,
                    })
                  : toast.show('Opening the share sheet…')
              }
              style={[
                styles.row,
                i < entries.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: t.colors.hair,
                },
              ]}
            >
              <View
                style={[styles.icon, { backgroundColor: t.colors.accentWash }]}
              >
                <Icon size={16} color={t.colors.accentInk} />
              </View>
              <View style={styles.text}>
                <Text
                  numberOfLines={1}
                  style={[styles.name, { color: t.colors.ink }]}
                >
                  {e.name}
                </Text>
                <Text style={[styles.size, { color: t.colors.muted }]}>
                  {e.size}
                </Text>
              </View>
              <ChevronRight size={15} color={t.colors.muted} />
            </Pressable>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.semibold, fontSize: 13.5 },
  size: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
});
