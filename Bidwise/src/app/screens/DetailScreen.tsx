import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Clock3,
  DownloadCloud,
  Eye,
  RotateCw,
  TriangleAlert,
  ChevronLeft,
  Download,
  FolderCheck,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react-native';
import {
  Button,
  Card,
  IconButton,
  ProgressBar,
  Screen,
  Segmented,
  useSurface,
  useToast,
} from '../../components/ui';
import { DocGroup } from '../../components/project/DocGroup';
import {
  ReadyChecklist,
  ReadyRow,
} from '../../components/project/ReadyChecklist';
import { leftLabel } from '../../lib/deadlines';
import { useBookmarks } from '../../fixtures/bookmarks';
import {
  OpenResult,
  Project,
  READY_FOLDER,
  useProjects,
} from '../../fixtures/projects';
import type { Tender } from '../../fixtures/tenders';
import { useTenderSource } from '../../data/tenderSource';
import { useDocs } from '../../data/docs';
import { useBidAgent } from '../../data/bidAgent';
import { AgentChatPreview } from '../../components/project/AgentChat';
import { Spinning } from '../../components/ui/motion';
import { browser } from '../../platform/browser';
import { showActionSheet } from '../../platform/actionSheet';
import { projectProgress } from '../../lib/projectProgress';
import { useAccess } from '../../lib/account';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Route =
  | RouteProp<RootStackParamList, 'TenderDetail'>
  | RouteProp<RootStackParamList, 'ProjectDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

/** A project whose tender is no longer listed still gets a detail card. */
function tenderFromProject(p: Project): Tender {
  return {
    id: p.sourceTenderId,
    short: p.title,
    portal: 'MahaTenders',
    org: p.client,
    title: p.description || p.title,
    value: p.value,
    emd: p.emd,
    category: '—',
    location: '—',
    published: '—',
    closing: p.deadline,
    closeIn: p.dueIn,
    state: p.state,
    prebid: p.prebid,
    docs: [],
  };
}

/** One cell of the details grid: muted label over a medium value. */
function Cell({
  label,
  value,
  divider,
}: {
  label: string;
  value: string;
  divider?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.cell,
        divider && {
          borderRightWidth: StyleSheet.hairlineWidth * 2,
          borderRightColor: t.colors.hair,
        },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: t.colors.muted }]}>
        {label}
      </Text>
      <Text
        numberOfLines={2}
        style={[styles.fieldValue, { color: t.colors.ink }]}
      >
        {value || '—'}
      </Text>
    </View>
  );
}

/** Two cells side by side with a hairline under the row (BM Pro's tender detail). */
function GridRow({
  left,
  right,
}: {
  left: [string, string];
  right: [string, string];
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.gridRow,
        {
          borderBottomWidth: StyleSheet.hairlineWidth * 2,
          borderBottomColor: t.colors.hair,
        },
      ]}
    >
      <Cell label={left[0]} value={left[1]} divider />
      <Cell label={right[0]} value={right[1]} />
    </View>
  );
}

/** A full-width row stacked under the grid. */
function StackedRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.stacked,
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth * 2,
          borderBottomColor: t.colors.hair,
        },
      ]}
    >
      <Text style={[styles.fieldLabel, { color: t.colors.muted }]}>
        {label}
      </Text>
      <Text style={[styles.fieldValue, { color: t.colors.ink }]}>
        {value || '—'}
      </Text>
    </View>
  );
}

export function DetailScreen() {
  const t = useTheme();
  const toast = useToast();
  const surface = useSurface();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const fromProjects = route.name === 'ProjectDetail';
  const {
    getProject,
    projectForTender,
    findExistingProject,
    startProject,
    toggleDone,
    attachFile,
    addItem,
    addPrepDoc,
    removePrepDoc,
    removeFile,
    removeItem,
    openAttachment,
    openPrepDoc,
    setStatus,
    archiveProject,
    restoreProject,
  } = useProjects();
  const { isBookmarked, toggle } = useBookmarks();
  // Sections the organisation turned off for this member are left out of the page.
  const access = useAccess();

  const source = useTenderSource();
  const tenderId = fromProjects
    ? getProject(route.params.id)?.sourceTenderId ?? ''
    : route.params.id;
  const fetched = source.useTender(tenderId);
  // Matched by server id or portal tender ID, so a project made elsewhere still shows.
  const project = fromProjects
    ? getProject(route.params.id)
    : projectForTender(route.params.id, fetched.tender?.refId);
  const tender =
    fetched.tender ?? (project ? tenderFromProject(project) : undefined);
  const docs = useDocs().useTenderDocs(fetched.tender);
  const agent = useBidAgent();
  const agentChat = agent.useChat(fetched.tender?.id ?? '');
  const agentPrep = agent.usePrep(fetched.tender?.id ?? '');
  const [checking, setChecking] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  if (!tender && fetched.loading) {
    return (
      <Screen>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
        <ActivityIndicator style={styles.loading} color={t.colors.accent} />
      </Screen>
    );
  }

  if (!tender) {
    return (
      <Screen>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
        <Text style={[styles.missing, { color: t.colors.muted }]}>
          {fetched.error ?? 'This tender is no longer available.'}
        </Text>
      </Screen>
    );
  }

  const saved = isBookmarked(tender.id);
  const ready = project?.checklist.find(f => f.name === READY_FOLDER)?.items;
  // A tender that isn't a project yet starts with an empty checklist; adding the
  // first item (or a prep doc) starts the project.
  const rows: ReadyRow[] = (ready ?? []).map(it => ({
    key: it.id,
    name: it.name,
    file: it.file,
    done: it.done,
    elsewhere: it.elsewhere,
  }));

  // Working on the checklist or prep docs starts a project for this tender. A tender
  // that already has one (here, archived, or made on another device) is never added
  // again: say so and use nothing.
  const ensureProject = () => {
    if (project) return project;
    const existing = findExistingProject(tender.id, tender.refId);
    if (existing) {
      toast.show(
        existing.archived
          ? 'Project already exists (archived)'
          : 'Project already exists',
      );
      return existing.archived ? null : existing.project ?? null;
    }
    const created = startProject(tender.id, tender.refId);
    // A project's tender is always bookmarked (the server does the same).
    if (!isBookmarked(tender.id)) toggle(tender.id);
    toast.show(`“${tender.short}” added to Projects.`);
    return created;
  };
  const showOpen = (r: OpenResult) => {
    if (r === 'elsewhere') toast.show('Attached on another device');
    else if (r === 'missing')
      toast.show('The file is no longer on this phone. Attach it again.');
  };

  const submitted = project?.status === 'Submitted';
  const prog = project ? projectProgress(project) : null;
  const confirmArchive = () => {
    if (!project) return;
    showActionSheet(`Archive “${project.title}”?`, [
      {
        label: 'Archive project',
        destructive: true,
        onPress: () => {
          archiveProject(project.id);
          toast.show('Project archived');
          navigation.goBack();
        },
      },
    ]);
  };
  const closed = tender.archived || tender.closeIn === 'Closed';
  const due = closed
    ? { label: 'Closed', bg: t.colors.surfaceSunk, fg: t.colors.muted }
    : tender.state === 'crit'
    ? {
        label: leftLabel(tender.closeIn),
        bg: t.colors.critWash,
        fg: t.colors.crit,
      }
    : tender.state === 'soon'
    ? {
        label: leftLabel(tender.closeIn),
        bg: t.colors.warnWash,
        fg: t.colors.warn,
      }
    : {
        label: leftLabel(tender.closeIn),
        bg: t.colors.accentWash,
        fg: t.colors.accentInk,
      };

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
        <Text style={[styles.headTitle, { color: t.colors.ink }]}>
          {fromProjects ? 'Project details' : 'Tender details'}
        </Text>
        <View style={styles.headActions}>
          <IconButton
            label="Check for updates"
            onPress={() => {
              if (checking || docs.job) return;
              setChecking(true);
              docs
                .checkUpdates()
                .then(toast.show)
                .catch(e =>
                  toast.show(`Couldn’t check: ${(e as Error).message}`),
                )
                .finally(() => setChecking(false));
            }}
          >
            <Spinning spinning={checking || docs.job === 'update'}>
              <RefreshCw size={18} color={t.colors.inkSoft} />
            </Spinning>
          </IconButton>
          {fromProjects && project?.archived ? (
            // As BM Pro: an archived project is restored from its own page too.
            <IconButton
              label="Restore project"
              onPress={() => {
                restoreProject(project.id);
                toast.show('Project restored to Active');
              }}
            >
              <ArchiveRestore size={18} color={t.colors.accent} />
            </IconButton>
          ) : fromProjects && project ? (
            <IconButton label="Archive project" onPress={confirmArchive}>
              <Archive size={18} color={t.colors.inkSoft} />
            </IconButton>
          ) : null}
        </View>
      </View>

      <Text style={[styles.id, { color: t.colors.accentInk }]}>
        {tender.refId ?? tender.id}
      </Text>
      <Text style={[styles.title, { color: t.colors.ink }]}>
        {tender.title}
      </Text>
      {fromProjects && prog ? (
        <View
          style={styles.progress}
          accessibilityLabel={`${prog.pct}% of documents ready`}
        >
          <View style={styles.flex}>
            <ProgressBar progress={prog.pct / 100} height={8} />
          </View>
          <Text style={[styles.pct, { color: t.colors.ink }]}>{prog.pct}%</Text>
        </View>
      ) : null}
      <View style={styles.pillRow}>
        <View style={[styles.pill, { backgroundColor: due.bg }]}>
          <Text style={[styles.pillText, { color: due.fg }]}>{due.label}</Text>
        </View>
      </View>

      <View style={[styles.grid, surface]}>
        <GridRow
          left={['Tender value', tender.value]}
          right={['EMD', tender.emd]}
        />
        <GridRow
          left={['Category', tender.category]}
          right={['Location', tender.location]}
        />
        <GridRow
          left={['Published date', tender.published]}
          right={['Bid opening date', tender.opening ?? '—']}
        />
        <StackedRow label="Closing" value={tender.closing} />
        <StackedRow label="Pre-bid meeting" value={tender.prebid} />
        <StackedRow
          label="Organisation chain"
          value={`${tender.org} · ${tender.location}`}
          last
        />
      </View>

      <View style={styles.buttons}>
        {access.bookmarks ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Unsave tender' : 'Save tender'}
            accessibilityState={{ selected: saved }}
            onPress={() => toggle(tender.id)}
            style={[
              styles.bookmark,
              saved
                ? { backgroundColor: t.colors.warn, borderColor: t.colors.warn }
                : {
                    backgroundColor: t.colors.surface,
                    borderColor: t.colors.accent,
                  },
            ]}
          >
            <Star
              size={16}
              color={saved ? '#ffffff' : t.colors.accent}
              fill={saved ? '#ffffff' : 'transparent'}
            />
            <Text
              style={[
                styles.bookmarkText,
                { color: saved ? '#ffffff' : t.colors.accent },
              ]}
            >
              {saved ? 'Bookmarked' : 'Bookmark'}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.buttonRow}>
          {access.projects ? (
            <Pressable
              accessibilityRole="button"
              disabled={fromProjects}
              onPress={() => {
                if (project)
                  navigation.navigate('ProjectDetail', { id: project.id });
                else ensureProject();
              }}
              style={[styles.secondaryBtn, surface]}
            >
              {project ? (
                <FolderCheck size={16} color={t.colors.ink} />
              ) : (
                <Plus size={16} color={t.colors.ink} />
              )}
              <Text style={[styles.secondaryText, { color: t.colors.ink }]}>
                {fromProjects
                  ? 'In Projects'
                  : project
                  ? 'View project'
                  : 'Add to Projects'}
              </Text>
            </Pressable>
          ) : null}
          {tender.url ? (
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                browser
                  .open(tender.url!)
                  .catch(() => toast.show('Couldn’t open the portal'))
              }
              style={[styles.secondaryBtn, surface]}
            >
              <ExternalLink size={16} color={t.colors.ink} />
              <Text style={[styles.secondaryText, { color: t.colors.ink }]}>
                Open on portal
              </Text>
            </Pressable>
          ) : (
            <View style={styles.flex} />
          )}
        </View>
      </View>

      <Card padding={16} radius="lg" elevation="sm" style={styles.block}>
        <Text style={[styles.h3, { color: t.colors.ink }]}>Scope of work</Text>
        <Text style={[styles.scope, { color: t.colors.inkSoft }]}>
          {project?.description || tender.title}
        </Text>
      </Card>

      {access.projects && fetched.tender ? (
        <AgentChatPreview
          chat={agentChat}
          onOpen={() =>
            navigation.navigate('BidAgentChat', {
              tenderId: fetched.tender!.id,
              projectId: project ? Number(project.id) : null,
              title: tender.title,
            })
          }
        />
      ) : null}

      {access.projects ? (
        <ReadyChecklist
          rows={rows}
          onToggle={key => project && toggleDone(project.id, key)}
          onAttach={key => project && attachFile(project.id, key)}
          onOpen={key =>
            project &&
            openAttachment(project.id, key)
              .then(showOpen)
              .catch(e => toast.show((e as Error).message))
          }
          onRemove={key => project && removeFile(project.id, key)}
          onDelete={key => project && removeItem(project.id, key)}
          onAdd={name => {
            const p = ensureProject();
            if (p) addItem(p.id, READY_FOLDER, name, '');
          }}
        />
      ) : null}

      <DocGroup
        title="Tender Docs"
        count={`${docs.rows.length} ${
          docs.rows.length === 1 ? 'file' : 'files'
        }`}
        rows={docs.rows.map(d => ({
          key: d.key,
          name: d.name,
          meta:
            d.state === 'failed' && d.error ? `${d.meta} · ${d.error}` : d.meta,
          fresh: d.fresh,
          state: d.state,
        }))}
        empty={
          docs.loading
            ? 'Loading documents…'
            : docs.job === 'request'
            ? 'Fetching the documents from the portal — this can take a few minutes.'
            : 'No tender documents yet.'
        }
        rowAction={{
          icon: r =>
            r.state === 'downloading' ? (
              <ActivityIndicator size="small" color={t.colors.accent} />
            ) : r.state === 'downloaded' ? (
              <Eye size={18} color={t.colors.accent} />
            ) : r.state === 'failed' ? (
              <RotateCw size={17} color={t.colors.crit} />
            ) : r.state === 'unavailable' ? (
              <Clock3 size={17} color={t.colors.muted} />
            ) : (
              <Download size={18} color={t.colors.inkSoft} />
            ),
          label: r =>
            r.state === 'downloaded'
              ? `Open ${r.name}`
              : r.state === 'failed'
              ? `Retry ${r.name}`
              : `Download ${r.name}`,
          onPress: r => {
            if (r.state === 'downloading') return;
            if (r.state === 'unavailable') {
              toast.show('This file isn’t available from the portal yet');
              return;
            }
            if (r.state === 'downloaded') {
              docs
                .open(r.key)
                .then(kind => {
                  if (kind === 'zip')
                    navigation.navigate('ZipContents', {
                      docId: r.key,
                      name: r.name,
                    });
                })
                .catch(e => toast.show((e as Error).message));
              return;
            }
            docs
              .download(r.key)
              .then(() => toast.show(`${r.name} saved to this device`))
              .catch(e =>
                toast.show(`Download failed: ${(e as Error).message}`),
              );
          },
        }}
        footer={
          <View style={styles.docActions}>
            {docs.hasCorrupt ? (
              <View
                style={[styles.warn, { backgroundColor: t.colors.warnWash }]}
              >
                <TriangleAlert size={15} color={t.colors.warn} />
                <Text style={[styles.warnText, { color: t.colors.warn }]}>
                  Some saved files look incomplete.
                </Text>
                <Button
                  label="Re-download"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(docs.job)}
                  onPress={() =>
                    docs
                      .redownload()
                      .then(toast.show)
                      .catch(e => toast.show((e as Error).message))
                  }
                />
              </View>
            ) : null}
            {docs.canRequest ? (
              <Button
                label={
                  docs.job === 'request' ? 'Requesting…' : 'Request documents'
                }
                size="sm"
                variant="outline"
                block
                loading={docs.job === 'request'}
                icon={<DownloadCloud size={15} color={t.colors.accentInk} />}
                onPress={() =>
                  docs
                    .request()
                    .then(toast.show)
                    .catch(e =>
                      toast.show(`Couldn’t request: ${(e as Error).message}`),
                    )
                }
              />
            ) : null}
            {docs.missing > 1 ? (
              <Button
                label={
                  busyAll ? 'Saving…' : `Download all (${docs.rows.length})`
                }
                size="sm"
                variant="outline"
                block
                loading={busyAll}
                icon={<Download size={15} color={t.colors.accentInk} />}
                onPress={() => {
                  setBusyAll(true);
                  docs
                    .downloadAll()
                    .then(toast.show)
                    .catch(e => toast.show((e as Error).message))
                    .finally(() => setBusyAll(false));
                }}
              />
            ) : null}
          </View>
        }
      />


      {access.projects ? (
        <DocGroup
          title="Docs for Preparation"
          rows={[
            ...(project?.prepDocs ?? []).map(d => ({
              key: d.id,
              name: d.name,
              meta: d.meta,
            })),
            // On Drive but not on this phone yet (saved by the Bid Agent or a teammate).
            ...agentPrep.files
              .filter(f => !(project?.prepDocs ?? []).some(d => d.serverFileId === f.file_id))
              .map(f => ({
                key: `drive:${f.file_id}`,
                name: f.name,
                meta: f.kind === 'user' ? 'On Drive' : 'Bid Agent · on Drive',
              })),
          ]}
          empty="Add your estimates, drafts and working files here."
          onAdd={() => {
            const p = ensureProject();
            if (p) addPrepDoc(p.id);
          }}
          onRowPress={r => {
            const drive = agentPrep.files.find(f => `drive:${f.file_id}` === r.key);
            if (drive) {
              agentPrep
                .open(project ? Number(project.id) : null, drive)
                .then(msg => (msg ? toast.show(msg) : undefined))
                .catch(e => toast.show((e as Error).message));
              return;
            }
            if (project)
              openPrepDoc(project.id, r.key)
                .then(showOpen)
                .catch(e => toast.show((e as Error).message));
          }}
          rowAction={{
            icon: <Trash2 size={17} color={t.colors.muted} />,
            label: r => `Remove ${r.name}`,
            onPress: r => {
              const drive = agentPrep.files.find(f => `drive:${f.file_id}` === r.key);
              if (drive) {
                agentPrep
                  .remove(drive)
                  .catch(e => toast.show((e as Error).message));
              } else if (project) removePrepDoc(project.id, r.key);
            },
          }}
        />
      ) : null}

      {fromProjects && project ? (
        <Segmented
          style={styles.status}
          value={submitted ? 'Submitted' : 'Preparing'}
          onChange={v =>
            setStatus(
              project.id,
              v === 'Submitted' ? 'Submitted' : 'Bid in preparation',
            )
          }
          options={[
            { value: 'Preparing', label: 'Preparing' },
            { value: 'Submitted', label: 'Submitted' },
          ]}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  missing: { fontFamily: fonts.regular, fontSize: 14, marginTop: 24 },
  loading: { marginTop: 40 },
  docActions: { gap: 8, marginTop: 6 },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
  },
  warnText: { flex: 1, fontFamily: fonts.medium, fontSize: 12 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 16,
  },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  pct: { fontFamily: fonts.monoSemibold, fontSize: 13 },
  status: { marginTop: 4, marginBottom: 8 },
  headTitle: { fontFamily: fonts.displaySemibold, fontSize: 16 },
  block: { marginBottom: 12 },
  flex: { flex: 1 },
  id: { fontFamily: fonts.monoSemibold, fontSize: 13 },
  title: {
    // Portal titles are long and often ALL CAPS: Inter at normal spacing stays even.
    fontFamily: fonts.semibold,
    fontSize: 17,
    lineHeight: 24,
    marginTop: 4,
  },
  pillRow: { flexDirection: 'row', marginTop: 8, marginBottom: 14 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontFamily: fonts.semibold, fontSize: 12 },
  grid: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 14,
  },
  gridRow: { flexDirection: 'row' },
  cell: { width: '50%', paddingVertical: 10, paddingHorizontal: 12 },
  stacked: { paddingVertical: 10, marginHorizontal: 12 },
  fieldLabel: { fontFamily: fonts.regular, fontSize: 12 },
  fieldValue: { fontFamily: fonts.medium, fontSize: 13.5, marginTop: 3 },
  buttons: { gap: 8, marginBottom: 16 },
  bookmark: {
    minHeight: 44,
    borderRadius: 11,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bookmarkText: { fontFamily: fonts.semibold, fontSize: 14 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  secondaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  h3: { fontFamily: fonts.displaySemibold, fontSize: 16, letterSpacing: -0.4 },
  scope: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
});
