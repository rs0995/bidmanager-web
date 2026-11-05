import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import {
  CircleAlert,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react-native';
import {
  Button,
  Card,
  IconButton,
  Kicker,
  PageTitle,
  Screen,
  Segmented,
  useToast,
} from '../../components/ui';
import { useBidPackSource } from '../../data/bidPack';
import { checkCounts } from '../../lib/bidPack';
import type { BidCheck, BidPackFile, BidPackResult } from '../../lib/bidPack';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type View3 = 'checks' | 'forms' | 'sections';

/**
 * Bid pack for one tender: the server reads the tender's documents, checks the
 * qualification criteria against the company profile and prepares the bidding forms
 * as Word / Excel files that open in QuickLook (with Share / Open in Word).
 */
export function BidPackScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'BidPack'>>();
  const source = useBidPackSource();
  const status = source.useStatus();
  const bp = source.useBidPack(params.tenderId);
  const [tab, setTab] = useState<View3>('checks');
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState('');

  const pack = bp.pack;
  const result = pack?.status === 'completed' ? pack.result : null;
  const running = pack?.status === 'running' || starting;

  const prepare = () => {
    setStarting(true);
    bp.prepare()
      .catch(e => toast.show(`Couldn’t start: ${(e as Error).message}`))
      .finally(() => setStarting(false));
  };
  const open = (name: string) => {
    setOpening(name);
    bp.open(name)
      .then(msg => (msg ? toast.show(msg) : undefined))
      .catch(e => toast.show((e as Error).message))
      .finally(() => setOpening(''));
  };

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle sub={result?.tender.reference || params.title}>Bid pack</PageTitle>

      {status && !status.ai_enabled ? (
        <View style={[styles.note, { backgroundColor: t.colors.warnWash }]}>
          <TriangleAlert size={15} color={t.colors.warn} />
          <Text style={[styles.noteText, { color: t.colors.warn }]}>
            AI reading is off on the server, so check results against the tender.
          </Text>
        </View>
      ) : null}

      {bp.loading ? (
        <ActivityIndicator style={styles.loading} color={t.colors.accent} />
      ) : running ? (
        <Card radius="lg" elevation="sm">
          <View style={styles.runHead}>
            <ActivityIndicator color={t.colors.accent} />
            <Text style={[styles.runTitle, { color: t.colors.ink }]}>Preparing the bid pack…</Text>
          </View>
          {(pack?.logs ?? []).slice(-5).map((l, i) => (
            <Text key={i} numberOfLines={2} style={[styles.log, { color: t.colors.muted }]}>
              {l}
            </Text>
          ))}
          <Text style={[styles.hint, { color: t.colors.muted }]}>
            Usually takes a minute. You can leave this page.
          </Text>
        </Card>
      ) : !result ? (
        <Card radius="lg" elevation="sm">
          <View style={[styles.iconTile, { backgroundColor: t.colors.accentWash }]}>
            <Sparkles size={20} color={t.colors.accent} />
          </View>
          <Text style={[styles.introTitle, { color: t.colors.ink }]}>
            Prepare the bid from the tender documents
          </Text>
          <Text style={[styles.intro, { color: t.colors.inkSoft }]}>
            Bidwise finds the qualification criteria and bidding forms in this tender, checks the
            criteria against your company profile, and prepares the forms as Word and Excel files.
          </Text>
          {pack?.status === 'failed' ? (
            <Text style={[styles.error, { color: t.colors.crit }]}>{pack.error}</Text>
          ) : null}
          {bp.error ? <Text style={[styles.error, { color: t.colors.crit }]}>{bp.error}</Text> : null}
          <Button
            label={pack?.status === 'failed' ? 'Try again' : 'Prepare bid pack'}
            block
            loading={starting}
            icon={<Sparkles size={16} color={t.colors.onAccent} />}
            onPress={prepare}
          />
          <Text style={[styles.hint, { color: t.colors.muted }]}>
            Download the tender documents first.
          </Text>
        </Card>
      ) : (
        <>
          <Summary result={result} />
          <Segmented<View3>
            style={styles.segment}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'checks', label: 'Checks' },
              { value: 'forms', label: `Forms (${result.forms.length})` },
              { value: 'sections', label: 'Sections' },
            ]}
          />
          {tab === 'checks' ? (
            <Checks checks={result.compliance} />
          ) : tab === 'forms' ? (
            <Forms result={result} files={pack?.files ?? []} opening={opening} onOpen={open} />
          ) : (
            <Sections result={result} />
          )}
          <View style={styles.footer}>
            <Button
              label="Prepare again"
              variant="outline"
              size="sm"
              block
              loading={starting}
              icon={<RefreshCw size={15} color={t.colors.accentInk} />}
              onPress={prepare}
            />
            <Text style={[styles.hint, { color: t.colors.muted }]}>
              Forms are filled from your company profile each time you open them. Correct
              section types from the desktop app.
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function Summary({ result }: { result: BidPackResult }) {
  const t = useTheme();
  const c = checkCounts(result.compliance);
  const tiles = [
    { label: 'Meet', value: c.meets, color: t.colors.good, wash: t.colors.goodWash },
    { label: 'Gaps', value: c.gaps, color: t.colors.crit, wash: t.colors.critWash },
    { label: 'To review', value: c.review, color: t.colors.warn, wash: t.colors.warnWash },
  ];
  return (
    <View style={styles.summary}>
      {tiles.map(s => (
        <View key={s.label} style={[styles.tile, { backgroundColor: s.wash }]}>
          <Text style={[styles.tileValue, { color: s.color }]}>{s.value}</Text>
          <Text style={[styles.tileLabel, { color: s.color }]}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

function statusColors(t: ReturnType<typeof useTheme>, status: string) {
  if (status === 'Meets') return { fg: t.colors.good, bg: t.colors.goodWash };
  if (status === 'Shortfall') return { fg: t.colors.crit, bg: t.colors.critWash };
  if (status === 'Manual check') return { fg: t.colors.muted, bg: t.colors.surfaceSunk };
  return { fg: t.colors.warn, bg: t.colors.warnWash };
}

function Checks({ checks }: { checks: BidCheck[] }) {
  const t = useTheme();
  // Gaps first, then the rest in tender order.
  const order = (s: string) => (s === 'Shortfall' ? 0 : s === 'Meets' ? 2 : s === 'Manual check' ? 3 : 1);
  const rows = [...checks].sort((a, b) => order(a.status) - order(b.status));
  if (!rows.length) {
    return <Text style={[styles.empty, { color: t.colors.muted }]}>No criteria were found.</Text>;
  }
  return (
    <Card padding={4} radius="lg" elevation="sm">
      {rows.map((c, i) => {
        const col = statusColors(t, c.status);
        return (
          <View
            key={`${c.ref}-${i}`}
            style={[styles.row, i < rows.length - 1 && [styles.divider, { borderBottomColor: t.colors.hair }]]}
          >
            <View style={styles.copy}>
              <Text numberOfLines={2} style={[styles.name, { color: t.colors.ink }]}>
                {c.subject || c.requirement}
              </Text>
              {c.required || c.actual ? (
                <Text numberOfLines={2} style={[styles.meta, { color: t.colors.muted }]}>
                  {[c.required && `Needs ${c.required}`, c.actual && `ours ${c.actual}`].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {c.remarks ? (
                <Text numberOfLines={2} style={[styles.meta, { color: t.colors.muted }]}>{c.remarks}</Text>
              ) : null}
            </View>
            <View style={[styles.pill, { backgroundColor: col.bg }]}>
              <Text style={[styles.pillText, { color: col.fg }]}>{c.status}</Text>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function Forms({
  result,
  files,
  opening,
  onOpen,
}: {
  result: BidPackResult;
  files: BidPackFile[];
  opening: string;
  onOpen: (name: string) => void;
}) {
  const t = useTheme();
  const workbook = files.find(f => f.kind === 'workbook');
  const zip = files.find(f => f.kind === 'zip');
  const rows = [
    ...(workbook ? [{ file: workbook, title: 'Bid Forms Workbook', sub: 'Checks, criteria, personnel, equipment, table forms', excel: true }] : []),
    ...files
      .filter(f => f.kind === 'form')
      .map(f => {
        const form = result.forms.find(x => x.code === f.code);
        return { file: f, title: f.code ? `${f.code} · ${form?.title ?? ''}` : f.name, sub: form ? `Tender p${form.start_page}–${form.end_page}` : '', excel: false };
      }),
  ];
  return (
    <>
      {result.missing_forms.length ? (
        <View style={[styles.note, { backgroundColor: t.colors.warnWash }]}>
          <CircleAlert size={15} color={t.colors.warn} />
          <Text style={[styles.noteText, { color: t.colors.warn }]}>
            Not in the downloaded files: {result.missing_forms.join(', ')}
          </Text>
        </View>
      ) : null}
      <Card padding={4} radius="lg" elevation="sm">
        {rows.map((r, i) => (
          <Pressable
            key={r.file.name}
            accessibilityRole="button"
            accessibilityLabel={`Open ${r.title}`}
            disabled={Boolean(opening)}
            onPress={() => onOpen(r.file.name)}
            style={[styles.row, i < rows.length - 1 && [styles.divider, { borderBottomColor: t.colors.hair }]]}
          >
            <View style={[styles.icon, { backgroundColor: r.excel ? t.colors.goodWash : t.colors.accentWash }]}>
              {r.excel ? (
                <FileSpreadsheet size={17} color={t.colors.good} />
              ) : (
                <FileText size={17} color={t.colors.accent} />
              )}
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={2} style={[styles.name, { color: t.colors.ink }]}>{r.title}</Text>
              {r.sub ? <Text numberOfLines={1} style={[styles.meta, { color: t.colors.muted }]}>{r.sub}</Text> : null}
            </View>
            {opening === r.file.name ? (
              <ActivityIndicator color={t.colors.accent} />
            ) : (
              <ChevronRight size={17} color={t.colors.muted} />
            )}
          </Pressable>
        ))}
      </Card>
      {zip ? (
        <View style={styles.footer}>
          <Button
            label="All files (.zip)"
            variant="secondary"
            size="sm"
            block
            loading={opening === zip.name}
            icon={<FolderArchive size={15} color={t.colors.ink} />}
            onPress={() => onOpen(zip.name)}
          />
        </View>
      ) : null}
    </>
  );
}

function Sections({ result }: { result: BidPackResult }) {
  const t = useTheme();
  const people = result.criteria.personnel ?? [];
  return (
    <>
      <Card padding={4} radius="lg" elevation="sm">
        {result.key_sections.map((s, i) => (
          <View
            key={s.role}
            style={[styles.row, i < result.key_sections.length - 1 && [styles.divider, { borderBottomColor: t.colors.hair }]]}
          >
            {s.found ? (
              <CircleCheck size={17} color={t.colors.good} />
            ) : (
              <CircleAlert size={17} color={t.colors.muted} />
            )}
            <View style={styles.copy}>
              <Text style={[styles.name, { color: s.found ? t.colors.ink : t.colors.muted }]}>{s.label}</Text>
              <Text numberOfLines={2} style={[styles.meta, { color: t.colors.muted }]}>
                {s.found
                  ? s.locations.map(l => `${l.file} · p${l.start_page}–${l.end_page}`).join('\n')
                  : 'Not found in the downloaded files'}
              </Text>
            </View>
          </View>
        ))}
      </Card>
      {people.length ? (
        <>
          <View style={styles.kicker}>
            <Kicker>Key personnel</Kicker>
          </View>
          <Card padding={4} radius="lg" elevation="sm">
            {people.map((p, i) => (
              <View
                key={`${p.position}-${i}`}
                style={[styles.row, i < people.length - 1 && [styles.divider, { borderBottomColor: t.colors.hair }]]}
              >
                <View style={styles.copy}>
                  <Text style={[styles.name, { color: t.colors.ink }]}>
                    {p.position}
                    {p.count ? ` × ${p.count}` : ''}
                  </Text>
                  <Text numberOfLines={3} style={[styles.meta, { color: t.colors.muted }]}>
                    {[p.qualification, p.experience].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  loading: { marginTop: 40 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 10, marginBottom: 12 },
  noteText: { flex: 1, fontFamily: fonts.medium, fontSize: 12.5 },
  runHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  runTitle: { fontFamily: fonts.semibold, fontSize: 14.5 },
  log: { fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  hint: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 10, textAlign: 'center' },
  iconTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  introTitle: { fontFamily: fonts.semibold, fontSize: 15.5, marginBottom: 6 },
  intro: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  error: { fontFamily: fonts.medium, fontSize: 12.5, marginBottom: 12 },
  summary: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tile: { flex: 1, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  tileValue: { fontFamily: fonts.displayBold, fontSize: 22 },
  tileLabel: { fontFamily: fonts.medium, fontSize: 11.5, marginTop: 1 },
  segment: { marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  name: { fontFamily: fonts.medium, fontSize: 13.5 },
  meta: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, maxWidth: 110 },
  pillText: { fontFamily: fonts.semibold, fontSize: 11, textAlign: 'center' },
  empty: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', marginTop: 20 },
  footer: { marginTop: 14 },
  divider: { borderBottomWidth: 1 },
  kicker: { marginTop: 18, marginBottom: 8 },
});
