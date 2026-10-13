import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronRight,
  CircleCheck,
  DownloadCloud,
  TriangleAlert,
} from 'lucide-react-native';
import { Card, EmptyState, Screen, ScreenHeader } from '../../components/ui';
import {
  DownloadItem,
  DownloadStatus,
  useDownloads,
} from '../../fixtures/downloads';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

const LABEL: Record<DownloadStatus, string> = {
  requested: 'Requested…',
  downloading: 'Downloading…',
  downloaded: 'Ready',
  failed: 'Failed',
};

/** Every document request and download, newest first. Ready PDFs and ZIPs open on tap. */
export function DownloadsScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { downloads, active } = useDownloads();

  const color = (s: DownloadStatus) =>
    s === 'downloaded'
      ? t.colors.good
      : s === 'failed'
      ? t.colors.crit
      : t.colors.accent;

  const statusIcon = (s: DownloadStatus) =>
    s === 'downloaded' ? (
      <CircleCheck size={17} color={color(s)} />
    ) : s === 'failed' ? (
      <TriangleAlert size={17} color={color(s)} />
    ) : (
      <ActivityIndicator size="small" color={color(s)} />
    );

  const open = (d: DownloadItem) => {
    if (d.status !== 'downloaded') return;
    if (d.kind === 'pdf')
      navigation.navigate('DocumentView', { downloadId: d.id });
    else if (d.kind === 'zip')
      navigation.navigate('DocumentArchive', { downloadId: d.id });
  };

  return (
    <Screen>
      <ScreenHeader
        title="Downloads"
        subtitle={active ? `${active} in progress` : 'Tender documents'}
        onBack={() => navigation.goBack()}
      />
      {downloads.length === 0 ? (
        <EmptyState
          icon={<DownloadCloud size={24} color={t.colors.accentInk} />}
          title="No downloads yet"
          description="Request or download tender documents and they will show up here."
        />
      ) : (
        <Card padding={4} elevation="sm">
          {downloads.map((d, i) => {
            const openable = d.status === 'downloaded' && d.kind !== 'other';
            return (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                accessibilityLabel={`${d.tenderTitle} — ${d.fileName}`}
                accessibilityState={{ disabled: !openable }}
                disabled={!openable}
                onPress={() => open(d)}
                style={[
                  styles.row,
                  i < downloads.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: t.colors.hair,
                  },
                ]}
              >
                <View style={styles.icon}>{statusIcon(d.status)}</View>
                <View style={styles.text}>
                  <Text
                    numberOfLines={1}
                    style={[styles.title, { color: t.colors.ink }]}
                  >
                    {d.tenderTitle}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.file, { color: t.colors.muted }]}
                  >
                    {d.fileName}
                  </Text>
                  {d.status === 'failed' && d.error ? (
                    <Text
                      numberOfLines={2}
                      style={[styles.error, { color: t.colors.crit }]}
                    >
                      {d.error}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.end}>
                  <Text style={[styles.status, { color: color(d.status) }]}>
                    {LABEL[d.status]}
                  </Text>
                  <Text style={[styles.when, { color: t.colors.muted }]}>
                    {d.when}
                  </Text>
                </View>
                {openable ? (
                  <ChevronRight size={15} color={t.colors.muted} />
                ) : null}
              </Pressable>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    paddingHorizontal: 10,
    paddingVertical: 13,
  },
  icon: { width: 20, alignItems: 'center', marginTop: 1 },
  text: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.semibold, fontSize: 13.5 },
  file: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  error: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 3 },
  end: { alignItems: 'flex-end' },
  status: { fontFamily: fonts.bold, fontSize: 12 },
  when: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
});
