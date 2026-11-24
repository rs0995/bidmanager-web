import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Building2,
  ChevronLeft,
  FileSpreadsheet,
  FolderOpen,
  Star,
} from 'lucide-react-native';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  IconButton,
  PageTitle,
  Screen,
  SearchField,
  useToast,
} from '../../components/ui';
import { ListStatus, useDebounced } from '../../components/feedback/ListStatus';
import { useDocs } from '../../data/docs';
import { PickOrg, useTenderSource } from '../../data/tenderSource';
import { useBookmarks } from '../../fixtures/bookmarks';
import { useProjects } from '../../fixtures/projects';
import type { ExportScope } from '../../lib/exportCsv';
import { fonts, useTheme } from '../../theme';

type Kind = ExportScope['kind'];

/** Matches shown at once in the organisation list; search narrows the rest. */
const SHOW_MAX = 100;

function Option({
  icon,
  title,
  sub,
  selected,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      <Card
        padding={14}
        radius="lg"
        elevation="sm"
        style={[
          styles.option,
          selected && { borderColor: t.colors.accent, borderWidth: 1.5 },
        ]}
      >
        <View
          style={[styles.optIcon, { backgroundColor: t.colors.accentWash }]}
        >
          {icon}
        </View>
        <View style={styles.flex}>
          <Text style={[styles.optTitle, { color: t.colors.ink }]}>
            {title}
          </Text>
          <Text style={[styles.optSub, { color: t.colors.muted }]}>{sub}</Text>
        </View>
        <View
          style={[
            styles.radio,
            { borderColor: selected ? t.colors.accent : t.colors.muted },
          ]}
        >
          {selected ? (
            <View
              style={[styles.radioDot, { backgroundColor: t.colors.accent }]}
            />
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

export function ExportScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const docs = useDocs();
  const source = useTenderSource();
  const { count: savedCount } = useBookmarks();
  const { projects } = useProjects();
  const projectCount = projects.filter(p => p.sourceTenderId).length;
  const orgs = source.useAllOrgs();

  const [kind, setKind] = useState<Kind>('bookmarked');
  const [picked, setPicked] = useState<Map<string, PickOrg>>(new Map());
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 200);
  const [portal, setPortal] = useState<string | null>(null);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const portals = useMemo(
    () => [...new Set(orgs.items.map(o => o.portal))].sort(),
    [orgs.items],
  );
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orgs.items.filter(
      o =>
        (!portal || o.portal === portal) &&
        (!selectedOnly || picked.has(o.key)) &&
        (!needle || o.name.toLowerCase().includes(needle)),
    );
  }, [orgs.items, portal, selectedOnly, picked, query]);
  const shown = matches.slice(0, SHOW_MAX);

  const toggle = (o: PickOrg) =>
    setPicked(prev => {
      const next = new Map(prev);
      if (next.has(o.key)) next.delete(o.key);
      else next.set(o.key, o);
      return next;
    });

  const ready =
    kind === 'bookmarked'
      ? savedCount > 0
      : kind === 'projects'
      ? projectCount > 0
      : picked.size > 0;

  const exportNow = () => {
    if (!ready || busy) return;
    const scope: ExportScope =
      kind === 'orgs'
        ? {
            kind,
            includeClosed,
            orgs: [...picked.values()].map(o => ({
              name: o.name,
              websiteId: o.websiteId,
            })),
          }
        : { kind };
    setBusy(true);
    setProgress(null);
    docs
      .exportCsv(scope, (done, total) =>
        setProgress(
          done < total
            ? `Organisation ${done + 1} of ${total}…`
            : 'Writing the CSV…',
        ),
      )
      .then(n =>
        toast.show(
          n
            ? `${n} ${n === 1 ? 'tender' : 'tenders'} exported as CSV`
            : 'No tenders to export',
        ),
      )
      .catch(e => toast.show(`Export failed: ${(e as Error).message}`))
      .finally(() => {
        setBusy(false);
        setProgress(null);
      });
  };

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle sub="Choose what goes in the CSV. It opens in the share sheet.">
        Export tenders
      </PageTitle>

      <View style={styles.options}>
        <Option
          icon={<Star size={17} color={t.colors.accent} />}
          title="Bookmarked tenders"
          sub={`${savedCount} saved ${savedCount === 1 ? 'tender' : 'tenders'}`}
          selected={kind === 'bookmarked'}
          onPress={() => setKind('bookmarked')}
        />
        <Option
          icon={<FolderOpen size={17} color={t.colors.accent} />}
          title="Tenders in projects"
          sub={`${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`}
          selected={kind === 'projects'}
          onPress={() => setKind('projects')}
        />
        <Option
          icon={<Building2 size={17} color={t.colors.accent} />}
          title="Tenders of selected organisations"
          sub={
            picked.size
              ? `${picked.size} ${
                  picked.size === 1 ? 'organisation' : 'organisations'
                } selected`
              : 'Pick organisations from any portal'
          }
          selected={kind === 'orgs'}
          onPress={() => setKind('orgs')}
        />
      </View>

      {kind === 'orgs' ? (
        <View style={styles.picker}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search organisations"
          />
          <View style={styles.chips}>
            <Chip
              label="All portals"
              active={!portal}
              onPress={() => setPortal(null)}
            />
            {portals.map(p => (
              <Chip
                key={p}
                label={p}
                active={portal === p}
                onPress={() => setPortal(p)}
              />
            ))}
            <Chip
              label={`Selected only (${picked.size})`}
              active={selectedOnly}
              onPress={() => setSelectedOnly(v => !v)}
            />
          </View>

          <View style={styles.listHead}>
            <Text style={[styles.count, { color: t.colors.muted }]}>
              {matches.length > SHOW_MAX
                ? `Showing ${SHOW_MAX} of ${matches.length} — search to narrow`
                : `${matches.length} ${
                    matches.length === 1 ? 'organisation' : 'organisations'
                  }`}
            </Text>
            {picked.size ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setPicked(new Map())}
              >
                <Text style={[styles.clear, { color: t.colors.accent }]}>
                  Clear
                </Text>
              </Pressable>
            ) : null}
          </View>

          {shown.length ? (
            <Card padding={4} radius="lg" elevation="sm">
              {shown.map((o, i) => {
                const on = picked.has(o.key);
                return (
                  <Pressable
                    key={o.key}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${o.name}, ${o.portal}`}
                    accessibilityState={{ checked: on }}
                    onPress={() => toggle(o)}
                    style={[
                      styles.orgRow,
                      i < shown.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: t.colors.hair,
                      },
                    ]}
                  >
                    <Checkbox
                      checked={on}
                      label={o.name}
                      onPress={() => toggle(o)}
                      size={20}
                    />
                    <View style={styles.flex}>
                      <Text
                        numberOfLines={1}
                        style={[styles.orgName, { color: t.colors.ink }]}
                      >
                        {o.name}
                      </Text>
                      <Text style={[styles.orgMeta, { color: t.colors.muted }]}>
                        {o.portal} · {o.count}{' '}
                        {o.count === 1 ? 'tender' : 'tenders'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          ) : null}
          <ListStatus
            loading={orgs.loading}
            error={orgs.error}
            empty={!shown.length}
            emptyText={
              selectedOnly
                ? 'No organisations selected yet.'
                : 'No organisations match.'
            }
          />

          <View style={styles.closedRow}>
            <View style={styles.flex}>
              <Text style={[styles.orgName, { color: t.colors.ink }]}>
                Include closed tenders
              </Text>
              <Text style={[styles.orgMeta, { color: t.colors.muted }]}>
                Also export tenders that have moved to the Archive
              </Text>
            </View>
            <Switch
              accessibilityLabel="Include closed tenders"
              value={includeClosed}
              onValueChange={setIncludeClosed}
              trackColor={{
                true: t.colors.accent,
                false: t.colors.surfaceSunk,
              }}
              thumbColor="#ffffff"
              ios_backgroundColor={t.colors.surfaceSunk}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.footer}>
        {progress ? (
          <Text style={[styles.progress, { color: t.colors.muted }]}>
            {progress}
          </Text>
        ) : null}
        <Button
          label="Export CSV"
          block
          loading={busy}
          disabled={!ready}
          icon={<FileSpreadsheet size={16} color={t.colors.onAccent} />}
          onPress={exportNow}
        />
        {!ready ? (
          <Text style={[styles.progress, { color: t.colors.muted }]}>
            {kind === 'orgs'
              ? 'Select at least one organisation.'
              : kind === 'projects'
              ? 'You have no projects yet.'
              : 'You have no bookmarked tenders yet.'}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  options: { gap: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  optIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optTitle: { fontFamily: fonts.medium, fontSize: 14 },
  optSub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  picker: { marginTop: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  listHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 10,
  },
  count: { fontFamily: fonts.medium, fontSize: 12 },
  clear: { fontFamily: fonts.semibold, fontSize: 12.5 },
  orgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  orgName: { fontFamily: fonts.medium, fontSize: 13.5 },
  orgMeta: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  footer: { marginTop: 22, gap: 10 },
  progress: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
});
