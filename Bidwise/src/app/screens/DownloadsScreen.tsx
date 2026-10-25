import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Clock3,
  DownloadCloud,
  RotateCw,
} from 'lucide-react-native';
import {
  Card,
  IconButton,
  PageTitle,
  ProgressBar,
  Screen,
  useToast,
} from '../../components/ui';
import { Spinning } from '../../components/ui/motion';
import type { DownloadItem } from '../../fixtures/downloads';
import { useDocs } from '../../data/docs';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function StatusIcon({ d }: { d: DownloadItem }) {
  const t = useTheme();
  if (d.status === 'done')
    return <CircleCheck size={17} color={t.colors.good} />;
  if (d.status === 'failed')
    return <CircleAlert size={17} color={t.colors.crit} />;
  if (d.status === 'queued') return <Clock3 size={17} color={t.colors.muted} />;
  return (
    <Spinning spinning>
      <RotateCw size={17} color={t.colors.accent} />
    </Spinning>
  );
}

const STATUS_TEXT: Record<DownloadItem['status'], string> = {
  done: 'Downloaded',
  downloading: 'Downloading',
  queued: 'Waiting',
  failed: 'Failed · tap to retry',
};

export function DownloadsScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation<Nav>();
  const dl = useDocs().useDownloads();
  const downloads = dl.items;
  const active = dl.active;

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle
        sub={
          active ? `${active} in progress` : 'Tender documents on this device.'
        }
      >
        Downloads
      </PageTitle>

      {downloads.length === 0 ? (
        <View style={styles.empty}>
          <DownloadCloud size={28} color={t.colors.accent} />
          <Text style={[styles.emptyTitle, { color: t.colors.ink }]}>
            No downloads yet
          </Text>
          <Text style={[styles.emptySub, { color: t.colors.muted }]}>
            Download tender documents and they will show up here.
          </Text>
        </View>
      ) : (
        <Card padding={4} radius="lg" elevation="sm">
          {downloads.map((d, i) => (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={`${d.name}, ${STATUS_TEXT[d.status]}`}
              onPress={() => {
                if (d.status === 'failed') {
                  toast.show(`Retrying ${d.name}`);
                  dl.retry(d.id)
                    .then(() => toast.show(`${d.name} saved to this device`))
                    .catch(e =>
                      toast.show(`Download failed: ${(e as Error).message}`),
                    );
                } else if (d.status === 'done') {
                  dl.open(d.id)
                    .then(kind => {
                      if (kind === 'zip')
                        navigation.navigate('ZipContents', {
                          docId: d.id,
                          name: d.name,
                        });
                    })
                    .catch(e => toast.show((e as Error).message));
                } else {
                  navigation.navigate('TenderDetail', { id: d.tenderId });
                }
              }}
              style={[
                styles.row,
                i < downloads.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: t.colors.hair,
                },
              ]}
            >
              <StatusIcon d={d} />
              <View style={styles.copy}>
                <Text
                  numberOfLines={1}
                  style={[styles.name, { color: t.colors.ink }]}
                >
                  {d.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.meta, { color: t.colors.muted }]}
                >
                  {d.tenderShort} · {d.size} · {d.when}
                </Text>
                {d.status === 'downloading' ? (
                  <View style={styles.bar}>
                    <ProgressBar progress={d.progress ?? 0} height={4} />
                  </View>
                ) : (
                  <Text
                    style={[
                      styles.meta,
                      {
                        color:
                          d.status === 'failed'
                            ? t.colors.crit
                            : t.colors.muted,
                      },
                    ]}
                  >
                    {STATUS_TEXT[d.status]}
                  </Text>
                )}
              </View>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  copy: { flex: 1 },
  name: { fontFamily: fonts.medium, fontSize: 13.5 },
  meta: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  bar: { marginTop: 7 },
  empty: { alignItems: 'center', marginTop: 40, gap: 6 },
  emptyTitle: { fontFamily: fonts.displaySemibold, fontSize: 16 },
  emptySub: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
});
