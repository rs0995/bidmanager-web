import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Download,
  Globe,
  Pencil,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { JobCard } from '../../components/JobCard';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  Checkbox,
  ConfirmSheet,
  EmptyState,
  FilterChips,
  IconButton,
  ListRow,
  Screen,
  SearchField,
  Section,
  SegmentedControl,
  Sheet,
  StatusPill,
  TextField,
  Toggle,
  Txt,
} from '../../components/ui';
import { fmtAgo, fromSecs } from '../../lib/format';
import {
  useAction,
  useOrganizations,
  useSavedJobs,
  useSuppressedSites,
  useTenders,
  useWebsites,
} from '../../lib/queries';
import type { SavedJob } from '../../lib/types';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type View_ = 'jobs' | 'orgs' | 'tenders';
type Nav = NativeStackNavigationProp<RootStackParamList>;
type InJob = { names: string[]; recurring: boolean };

const toggleId = (set: Set<number>, id: number) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

// Same rule as the desktop ScraperPanel: every org / tender already covered by a
// saved job, and whether that job repeats ("Hide existing" hides only those).
function coverage(jobs: SavedJob[]) {
  const orgs = new Map<number, InJob>();
  const tenders = new Map<number, InJob>();
  for (const job of jobs) {
    const recurring =
      job.schedule_mode === 'interval' ||
      (job.schedule_mode !== 'once' && Number(job.interval_minutes) > 0);
    const add = (map: Map<number, InJob>, id: number) => {
      const e = map.get(id) ?? { names: [], recurring: false };
      e.names.push(job.name);
      e.recurring = e.recurring || recurring;
      map.set(id, e);
    };
    job.org_ids.forEach(id => add(orgs, id));
    job.tender_ids.forEach(id => add(tenders, id));
  }
  return { orgs, tenders };
}

const inJobLabel = (e: InJob) =>
  `in job: ${e.names[0]}${e.names.length > 1 ? ` +${e.names.length - 1}` : ''}`;

// ScraperPanel from the desktop, split per website into three phone views:
// saved jobs, organizations (scrape selected), tenders (refresh / download).
export function ScraperScreen() {
  const t = useTheme();
  const nav = useNavigation<Nav>();
  const { run, busy } = useAction();
  const websites = useWebsites();
  const [siteId, setSiteId] = useState<number | undefined>();
  const [view, setView] = useState<View_>('jobs');
  const [orgSel, setOrgSel] = useState<Set<number>>(new Set());
  const [tenderSel, setTenderSel] = useState<Set<number>>(new Set());
  const [orgQuery, setOrgQuery] = useState('');
  const [tenderQuery, setTenderQuery] = useState('');
  const [hideExisting, setHideExisting] = useState(false);
  const [deleting, setDeleting] = useState<SavedJob | null>(null);
  const [managing, setManaging] = useState(false);
  const [confirmSite, setConfirmSite] = useState<number | null>(null);
  const [editSite, setEditSite] = useState<{ id: number; name: string; url: string; status: string } | null>(null);
  const [newSite, setNewSite] = useState({ name: '', url: '', status: '' });

  // Default to the first website once the list arrives.
  useEffect(() => {
    if (siteId == null && websites.data?.length) setSiteId(websites.data[0].id);
  }, [siteId, websites.data]);

  const savedJobs = useSavedJobs();
  const suppressed = useSuppressedSites();
  const organizations = useOrganizations(view === 'orgs' ? siteId : undefined);
  const tenders = useTenders(view === 'tenders' ? siteId : undefined, false);

  const allJobs = useMemo(() => savedJobs.data ?? [], [savedJobs.data]);
  const siteJobs = allJobs.filter(j => j.website_id === siteId);
  const covered = useMemo(() => coverage(allJobs), [allJobs]);

  const orgs = useMemo(
    () =>
      (organizations.data ?? []).filter(o => {
        const e = covered.orgs.get(o.id);
        if (hideExisting && e?.recurring && !orgSel.has(o.id)) return false;
        return o.name.toLowerCase().includes(orgQuery.toLowerCase());
      }),
    [organizations.data, covered, hideExisting, orgSel, orgQuery],
  );
  const shownTenders = useMemo(
    () =>
      (tenders.data ?? []).filter(x => {
        const e = covered.tenders.get(x.id);
        if (hideExisting && e?.recurring && !tenderSel.has(x.id)) return false;
        return `${x.tender_id ?? ''} ${x.title ?? ''} ${x.org_chain ?? ''}`
          .toLowerCase()
          .includes(tenderQuery.toLowerCase());
      }),
    [tenders.data, covered, hideExisting, tenderSel, tenderQuery],
  );

  // Selections belong to one website.
  useEffect(() => {
    setOrgSel(new Set());
    setTenderSel(new Set());
  }, [siteId]);

  const selCount =
    view === 'orgs' ? orgSel.size : view === 'tenders' ? tenderSel.size : 0;
  const jobStarted = (what: string) => () => `${what} — see Jobs for progress`;

  const footer =
    selCount > 0 && siteId ? (
      <View style={styles.footer}>
        <Txt variant="bodyStrong" style={styles.flex}>
          {selCount} selected
        </Txt>
        {view === 'orgs' ? (
          <Button
            label="Run"
            icon={Play}
            variant="primary"
            size="sm"
            busy={busy === 'orgs'}
            onPress={async () => {
              const ok = await run(
                'orgs',
                a => a.scrapeOrganizations(siteId, [...orgSel]),
                { success: jobStarted('Scrape queued'), invalidate: ['jobs'] },
              );
              if (ok) setOrgSel(new Set());
            }}
          />
        ) : (
          <>
            <Button
              label="Refresh"
              icon={RefreshCw}
              size="sm"
              busy={busy === 'refresh'}
              onPress={async () => {
                const ok = await run(
                  'refresh',
                  a => a.refreshTenders(siteId, [...tenderSel]),
                  { success: jobStarted('Refresh queued'), invalidate: ['jobs'] },
                );
                if (ok) setTenderSel(new Set());
              }}
            />
            <Button
              label="Download"
              icon={Download}
              variant="primary"
              size="sm"
              busy={busy === 'download'}
              onPress={async () => {
                const ok = await run(
                  'download',
                  a => a.downloadTenders(siteId, [...tenderSel]),
                  { success: jobStarted('Download queued'), invalidate: ['jobs'] },
                );
                if (ok) setTenderSel(new Set());
              }}
            />
          </>
        )}
      </View>
    ) : undefined;

  const hideToggle = (
    <View style={styles.hideRow}>
      <Txt variant="small" color="ink2" style={styles.flex}>
        Hide items already in a repeating job
      </Txt>
      <Toggle value={hideExisting} onChange={setHideExisting} label="Hide existing" />
    </View>
  );

  return (
    <Screen
      tabBar
      footer={footer}
      header={
        <AppHeader
          code="SCR"
          title="Scraper"
          right={
            <IconButton icon={Globe} label="Websites" onPress={() => setManaging(true)} />
          }
        />
      }
    >
      {!websites.data ? (
        <QueryState
          what="websites"
          loading={websites.isPending}
          error={websites.error}
          onRetry={() => websites.refetch()}
        />
      ) : websites.data.length === 0 ? (
        <Card>
          <EmptyState icon={Globe} title="No websites yet. Add one to start." />
        </Card>
      ) : (
        <>
          <FilterChips
            value={String(siteId ?? '')}
            onChange={v => setSiteId(Number(v))}
            options={websites.data.map(w => ({ value: String(w.id), label: w.name }))}
          />
          <SegmentedControl<View_>
            value={view}
            onChange={setView}
            options={[
              { value: 'jobs', label: 'Saved jobs' },
              { value: 'orgs', label: 'Organizations' },
              { value: 'tenders', label: 'Tenders' },
            ]}
          />

          {view === 'jobs' ? (
            <>
              <View style={styles.jobsHead}>
                <Txt variant="label" style={styles.flex}>
                  Saved jobs{'  ·  '}{siteJobs.length}
                </Txt>
                <Button
                  label="New job"
                  icon={Plus}
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    siteId && nav.navigate('CustomJobEditor', { websiteId: siteId })
                  }
                />
              </View>
              {!savedJobs.data ? (
                <QueryState
                  what="saved jobs"
                  loading={savedJobs.isPending}
                  error={savedJobs.error}
                  onRetry={() => savedJobs.refetch()}
                />
              ) : siteJobs.length === 0 ? (
                <Card>
                  <EmptyState icon={Play} title="No saved jobs for this website." />
                </Card>
              ) : (
                siteJobs.map(j => (
                  <JobCard
                    key={j.id}
                    job={j}
                    onOpen={() => nav.navigate('JobDetail', { jobId: j.id })}
                    running={busy === `run:${j.id}`}
                    toggling={busy === `sched:${j.id}`}
                    onRun={() =>
                      run(`run:${j.id}`, a => a.runSavedJob(j.id, j.owner_name), {
                        success: r =>
                          `${j.name}: ${r.queued_count} job${r.queued_count === 1 ? '' : 's'} queued`,
                        invalidate: ['jobs', 'savedJobs'],
                      })
                    }
                    onTogglePause={() =>
                      run(`sched:${j.id}`, a => a.setSavedJobSchedule(j.id, !j.schedule_enabled), {
                        success: r => (r.enabled ? 'Schedule resumed' : 'Schedule paused'),
                        invalidate: ['savedJobs'],
                      })
                    }
                    onDelete={() => setDeleting(j)}
                  />
                ))
              )}

              {suppressed.data?.length ? (
                <Section
                  title="Bookmark auto-update off"
                  meta={String(suppressed.data.length)}
                  pad={false}
                >
                  {suppressed.data.map((s, i) => (
                    <ListRow
                      key={s.website_id}
                      title={s.website_name}
                      subtitle="Its Bookmarks job was deleted, so it won't be recreated until resumed."
                      divider={i > 0}
                      right={
                        <Button
                          label="Resume"
                          size="sm"
                          busy={busy === `resume:${s.website_id}`}
                          onPress={() =>
                            run(
                              `resume:${s.website_id}`,
                              a => a.resumeBookmarkScrape(s.website_id),
                              {
                                success: `Bookmark updates resumed for ${s.website_name}`,
                                invalidate: ['suppressed', 'savedJobs'],
                              },
                            )
                          }
                        />
                      }
                    />
                  ))}
                </Section>
              ) : null}
            </>
          ) : view === 'orgs' ? (
            <>
              <View style={styles.toolbar}>
                <View style={styles.flex}>
                  <SearchField
                    value={orgQuery}
                    onChangeText={setOrgQuery}
                    placeholder="Search organizations"
                  />
                </View>
                <IconButton
                  icon={Radar}
                  label="Refresh organization list"
                  onPress={() =>
                    siteId &&
                    run('orgList', a => a.refreshOrganizationList(siteId), {
                      success: jobStarted('Organization list refresh queued'),
                      invalidate: ['jobs'],
                    })
                  }
                />
              </View>
              {hideToggle}
              {!organizations.data ? (
                <QueryState
                  what="organizations"
                  loading={organizations.isPending}
                  error={organizations.error}
                  onRetry={() => organizations.refetch()}
                />
              ) : (
                <Card pad={false}>
                  {orgs.length === 0 ? (
                    <EmptyState
                      icon={Radar}
                      title={
                        organizations.data.length
                          ? 'No organizations match.'
                          : 'No organizations yet. Refresh the list to fetch them.'
                      }
                    />
                  ) : (
                    orgs.map((o, i) => {
                      const e = covered.orgs.get(o.id);
                      return (
                        <ListRow
                          key={o.id}
                          title={o.name}
                          meta={`${o.tender_count} tenders · updated ${fmtAgo(fromSecs(o.last_scraped_at))}`}
                          divider={i > 0}
                          onPress={() => setOrgSel(s => toggleId(s, o.id))}
                          left={
                            <Checkbox
                              checked={orgSel.has(o.id)}
                              onChange={() => setOrgSel(s => toggleId(s, o.id))}
                              label={o.name}
                            />
                          }
                        >
                          {e ? (
                            <View style={styles.tags}>
                              <StatusPill tone="warn" label={inJobLabel(e)} />
                            </View>
                          ) : null}
                        </ListRow>
                      );
                    })
                  )}
                </Card>
              )}
            </>
          ) : (
            <>
              <SearchField
                value={tenderQuery}
                onChangeText={setTenderQuery}
                placeholder="Search tender ID, title, org"
              />
              {hideToggle}
              {!tenders.data ? (
                <QueryState
                  what="tenders"
                  loading={tenders.isPending}
                  error={tenders.error}
                  onRetry={() => tenders.refetch()}
                />
              ) : (
                <Card pad={false}>
                  {shownTenders.length === 0 ? (
                    <EmptyState icon={Radar} title="No tenders match." />
                  ) : (
                    shownTenders.map((x, i) => {
                      const e = covered.tenders.get(x.id);
                      return (
                        <ListRow
                          key={x.id}
                          title={x.title || x.tender_id || `Tender ${x.id}`}
                          subtitle={(x.org_chain || '').replace(/\s*\|\|\s*/g, ' › ')}
                          meta={`${x.tender_id ?? '—'} · closes ${x.closing_date || '—'}`}
                          divider={i > 0}
                          onPress={() => setTenderSel(s => toggleId(s, x.id))}
                          left={
                            <Checkbox
                              checked={tenderSel.has(x.id)}
                              onChange={() => setTenderSel(s => toggleId(s, x.id))}
                              label={x.tender_id ?? String(x.id)}
                            />
                          }
                        >
                          <View style={styles.tags}>
                            <StatusPill
                              tone={
                                x.download_status === 'complete' || x.download_status === 'downloaded'
                                  ? 'ok'
                                  : x.download_status === 'partial'
                                  ? 'warn'
                                  : 'neutral'
                              }
                              label={x.download_status.replace(/_/g, ' ')}
                            />
                            {e ? <StatusPill tone="warn" label={inJobLabel(e)} /> : null}
                          </View>
                        </ListRow>
                      );
                    })
                  )}
                </Card>
              )}
            </>
          )}
        </>
      )}

      <ConfirmSheet
        visible={!!deleting}
        title="Delete saved job?"
        message={
          deleting?.created_by === 'user'
            ? `“${deleting.name}” keeps bookmarked tenders up to date. Deleting it turns bookmark updates off for this website until you resume them.`
            : `“${deleting?.name ?? ''}” and its schedule will be removed.`
        }
        confirmLabel="Delete"
        danger
        onConfirm={() =>
          deleting &&
          run(`delete:${deleting.id}`, a => a.deleteSavedJob(deleting.id, deleting.owner_name), {
            success: 'Saved job deleted',
            invalidate: ['savedJobs', 'suppressed'],
          })
        }
        onClose={() => setDeleting(null)}
      />

      <Sheet
        visible={managing}
        onClose={() => {
          setManaging(false);
          setConfirmSite(null);
          setEditSite(null);
        }}
        title="Websites"
      >
        <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.sheetBody}>
            {(websites.data ?? []).map(w => (
              <View
                key={w.id}
                style={[styles.site, { borderColor: t.colors.hair }]}
              >
                <View style={styles.siteHead}>
                  <View style={styles.flex}>
                    <Txt variant="bodyStrong">{w.name}</Txt>
                    <Txt variant="monoSmall" color="ink3" numberOfLines={2}>
                      {w.url}
                    </Txt>
                    {w.status_url ? (
                      <Txt variant="monoSmall" color="ink3" numberOfLines={1}>
                        status: {w.status_url}
                      </Txt>
                    ) : null}
                  </View>
                  {confirmSite !== w.id && editSite?.id !== w.id ? (
                    <>
                      <IconButton
                        icon={Pencil}
                        label={`Edit ${w.name}`}
                        onPress={() => {
                          setConfirmSite(null);
                          setEditSite({ id: w.id, name: w.name, url: w.url, status: w.status_url || '' });
                        }}
                      />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${w.name}`}
                        onPress={() => {
                          setEditSite(null);
                          setConfirmSite(w.id);
                        }}
                      />
                    </>
                  ) : null}
                </View>
                {editSite?.id === w.id ? (
                  <View style={styles.editForm}>
                    <TextField
                      label="Name"
                      value={editSite.name}
                      onChangeText={v => setEditSite(e => e && { ...e, name: v })}
                    />
                    <TextField
                      label="Portal URL"
                      value={editSite.url}
                      onChangeText={v => setEditSite(e => e && { ...e, url: v })}
                      mono
                      keyboardType="url"
                    />
                    <TextField
                      label="Status URL (optional)"
                      value={editSite.status}
                      onChangeText={v => setEditSite(e => e && { ...e, status: v })}
                      mono
                      keyboardType="url"
                    />
                    <Txt variant="small" color="ink3">
                      Its organizations, tenders and saved jobs are kept.
                    </Txt>
                    <View style={styles.footer}>
                      <Button
                        label="Cancel"
                        size="sm"
                        style={styles.flex}
                        onPress={() => setEditSite(null)}
                      />
                      <Button
                        label="Save"
                        size="sm"
                        variant="primary"
                        style={styles.flex}
                        busy={busy === `editSite:${w.id}`}
                        disabled={!editSite.name.trim() || !editSite.url.trim()}
                        onPress={async () => {
                          const ok = await run(
                            `editSite:${w.id}`,
                            a =>
                              a.updateWebsite(
                                w.id,
                                editSite.name.trim(),
                                editSite.url.trim(),
                                editSite.status.trim(),
                              ),
                            { success: 'Website updated', invalidate: ['websites'] },
                          );
                          if (ok) setEditSite(null);
                        }}
                      />
                    </View>
                  </View>
                ) : null}
                {confirmSite === w.id ? (
                  <View
                    style={[
                      styles.confirm,
                      { backgroundColor: t.colors.badSoft, borderColor: t.colors.badLine },
                    ]}
                  >
                    <Txt variant="small" color="bad">
                      Deletes {w.name} and every organization, tender and download
                      record saved for it. This can't be undone.
                    </Txt>
                    <View style={styles.footer}>
                      <Button
                        label="Cancel"
                        size="sm"
                        style={styles.flex}
                        onPress={() => setConfirmSite(null)}
                      />
                      <Button
                        label="Delete website"
                        size="sm"
                        variant="danger"
                        style={styles.flex}
                        busy={busy === `delSite:${w.id}`}
                        onPress={async () => {
                          const ok = await run(
                            `delSite:${w.id}`,
                            a => a.deleteWebsite(w.id),
                            {
                              success: `${w.name} deleted`,
                              invalidate: ['websites', 'organizations', 'tenders', 'savedJobs', 'suppressed'],
                            },
                          );
                          if (ok) {
                            setConfirmSite(null);
                            if (siteId === w.id) setSiteId(undefined);
                          }
                        }}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            ))}

            <Txt variant="label" style={styles.addTitle}>
              Add website
            </Txt>
            <TextField
              label="Name"
              value={newSite.name}
              onChangeText={v => setNewSite(s => ({ ...s, name: v }))}
              placeholder="Maharashtra"
            />
            <TextField
              label="Portal URL"
              value={newSite.url}
              onChangeText={v => setNewSite(s => ({ ...s, url: v }))}
              placeholder="https://mahatenders.gov.in"
              mono
              keyboardType="url"
            />
            <TextField
              label="Status URL (optional)"
              value={newSite.status}
              onChangeText={v => setNewSite(s => ({ ...s, status: v }))}
              mono
              keyboardType="url"
            />
            <Button
              label="Add website"
              variant="primary"
              busy={busy === 'addSite'}
              disabled={!newSite.name.trim() || !newSite.url.trim()}
              onPress={async () => {
                const ok = await run(
                  'addSite',
                  a => a.addWebsite(newSite.name.trim(), newSite.url.trim(), newSite.status.trim()),
                  { success: 'Website added', invalidate: ['websites'] },
                );
                if (ok) setNewSite({ name: '', url: '', status: '' });
              }}
              block
            />
          </View>
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  job: { padding: 14, gap: 5 },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jobActions: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hideRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2 },
  tags: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 2 },
  jobsHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, minHeight: 32 },
  sheetScroll: { flexGrow: 0 },
  sheetBody: { gap: 12, paddingBottom: 4 },
  site: { borderWidth: 1, padding: 12, gap: 10 },
  siteHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirm: { borderWidth: 1, padding: 10, gap: 10 },
  addTitle: { marginTop: 8 },
  editForm: { gap: 10 },
});
