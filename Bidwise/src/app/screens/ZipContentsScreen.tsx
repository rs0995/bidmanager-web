import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import {
  ChevronLeft,
  ChevronRight,
  DownloadCloud,
  FileText,
  Folder,
  TriangleAlert,
} from 'lucide-react-native';
import {
  Button,
  Card,
  IconButton,
  PageTitle,
  Screen,
  useToast,
} from '../../components/ui';
import { ListStatus } from '../../components/feedback/ListStatus';
import { useDocs } from '../../data/docs';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

const fmtBytes = (b: number) =>
  !b
    ? ''
    : b < 1024 * 1024
    ? `${Math.max(1, Math.round(b / 1024))} KB`
    : `${(b / 1048576).toFixed(1)} MB`;

/**
 * Files inside a downloaded ZIP (unpacked once on this device); tap one to open it.
 * A ZIP that won't open (saved while the portal's CAPTCHA went unsolved) offers fresh
 * copies of all the tender's documents.
 */
export function ZipContentsScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ZipContents'>>();
  const docs = useDocs();
  const { entries, loading, error, broken, job, jobError, redownload } =
    docs.useZip(params.docId);
  const [starting, setStarting] = useState(false);

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle
        sub={
          entries.length
            ? `${entries.length} ${entries.length === 1 ? 'file' : 'files'}`
            : undefined
        }
      >
        {params.name}
      </PageTitle>

      {entries.length ? (
        <Card padding={4} radius="lg" elevation="sm">
          {entries.map((e, i) => {
            const parts = e.name.split('/');
            const file = parts.pop() ?? e.name;
            const folder = parts.join(' / ');
            return (
              <Pressable
                key={e.name}
                accessibilityRole="button"
                accessibilityLabel={`Open ${file}`}
                onPress={() =>
                  docs
                    .openFile(e.path)
                    .catch(err => toast.show((err as Error).message))
                }
                style={[
                  styles.row,
                  i < entries.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: t.colors.hair,
                  },
                ]}
              >
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: t.colors.accentWash },
                  ]}
                >
                  <FileText size={17} color={t.colors.accent} />
                </View>
                <View style={styles.copy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.name, { color: t.colors.ink }]}
                  >
                    {file}
                  </Text>
                  <View style={styles.metaRow}>
                    {folder ? (
                      <Folder size={11} color={t.colors.muted} />
                    ) : null}
                    <Text
                      numberOfLines={1}
                      style={[styles.meta, { color: t.colors.muted }]}
                    >
                      {[folder, fmtBytes(e.size)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={17} color={t.colors.muted} />
              </Pressable>
            );
          })}
        </Card>
      ) : null}
      {broken && !loading ? (
        <Card padding={16} radius="lg" elevation="sm">
          <View style={[styles.warn, { backgroundColor: t.colors.warnWash }]}>
            <TriangleAlert size={16} color={t.colors.warn} />
            <Text style={[styles.warnTitle, { color: t.colors.warn }]}>
              This ZIP didn’t download properly
            </Text>
          </View>
          <Text style={[styles.warnBody, { color: t.colors.muted }]}>
            The portal may not have finished sending it. Fetch fresh copies of
            all this tender’s documents.
          </Text>
          {jobError ? (
            <Text style={[styles.jobError, { color: t.colors.crit }]}>
              Last try failed: {jobError}
            </Text>
          ) : null}
          <Button
            label="Re-download all documents"
            size="sm"
            block
            loading={starting}
            disabled={starting}
            icon={<DownloadCloud size={15} color={t.colors.onAccent} />}
            onPress={() => {
              setStarting(true);
              redownload()
                .then(toast.show)
                .catch(e => toast.show((e as Error).message))
                .finally(() => setStarting(false));
            }}
          />
        </Card>
      ) : (
        <ListStatus
          loading={loading}
          error={error}
          empty={!entries.length}
          emptyText="This ZIP is empty."
          loadingText={
            job ? 'Fetching fresh copies from the portal…' : undefined
          }
        />
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
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  name: { fontFamily: fonts.medium, fontSize: 13.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { fontFamily: fonts.regular, fontSize: 11.5 },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  warnTitle: { fontFamily: fonts.semibold, fontSize: 13.5, flex: 1 },
  warnBody: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 10,
    marginBottom: 14,
  },
  jobError: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -6,
    marginBottom: 14,
  },
});
