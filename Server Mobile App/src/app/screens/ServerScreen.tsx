import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AlertTriangle, Check, Pause, Play, RefreshCw, Zap } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  ConfirmSheet,
  Dot,
  IconButton,
  KeyValue,
  MeterBar,
  Screen,
  Section,
  StatStrip,
  StatusPill,
  Txt,
} from '../../components/ui';
import { fmtDur, fmtNumber } from '../../lib/format';
import { useAction, useConfig, useHealth, useMetrics } from '../../lib/queries';
import { useTheme } from '../../theme';

const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const ms = (v: number | null) => (v == null ? '—' : String(v));

// ServerPanel from the desktop: GET /admin/health + /admin/metrics (15 s).
// The paused / draining state lives in /admin/config (scheduler_paused,
// drain_mode). Restart isn't offered: the server answers 501 for it.
export function ServerScreen() {
  const t = useTheme();
  const health = useHealth();
  const metrics = useMetrics();
  const config = useConfig();
  const { run, busy } = useAction();
  const [confirmDrain, setConfirmDrain] = useState(false);

  const h = health.data;
  const m = metrics.data;
  const paused = config.data?.scheduler_paused === true;
  const draining = config.data?.drain_mode === true;
  const serving = h?.status === 'serving';

  const refresh = () => {
    health.refetch();
    metrics.refetch();
    config.refetch();
  };

  return (
    <Screen
      tabBar
      header={
        <AppHeader
          code="SRV"
          title="Server"
          right={<IconButton icon={RefreshCw} label="Refresh" onPress={refresh} />}
        />
      }
    >
      {!h ? (
        <QueryState
          what="service status"
          loading={health.isPending}
          error={health.error}
          onRetry={refresh}
        />
      ) : (
        <>
          <Card>
            <View style={styles.statusRow}>
              <Dot tone={serving ? 'ok' : 'bad'} halo />
              <Txt variant="heading" style={styles.flex}>
                {serving ? 'Serving traffic' : 'Not serving'}
              </Txt>
              <StatusPill tone={serving ? 'ok' : 'bad'} label={h.status} />
            </View>
            <Txt variant="monoSmall" color="ink3" style={styles.uptime}>
              up {fmtDur(h.uptimeSeconds * 1000)}
              {h.label ? ` · ${h.label}` : ''}
            </Txt>
            <View style={[styles.rule, { backgroundColor: t.colors.hairSoft }]} />
            <KeyValue label="Service" value={h.service || '—'} />
            <KeyValue label="Revision" value={h.revision || '—'} />
            <KeyValue label="Version" value={h.version || '—'} />
            <KeyValue label="Region" value={h.region || '—'} />
            <KeyValue label="Scheduler" value={paused ? 'paused' : 'running'} />
          </Card>

          {m ? (
            <StatStrip
              items={[
                { label: 'Req · 1h', value: fmtNumber(m.requests1h) },
                { label: 'p95 ms', value: ms(m.p95) },
                { label: 'p99 ms', value: ms(m.p99) },
              ]}
            />
          ) : null}

          {m ? (
            <Section title="Resource load">
              <View style={styles.meters}>
                {[
                  { label: 'CPU', v: m.cpuPct },
                  { label: 'Memory', v: m.memPct },
                ].map(x => (
                  <View key={x.label} style={styles.meter}>
                    <View style={styles.meterHead}>
                      <Txt variant="small" color="ink2">
                        {x.label}
                      </Txt>
                      <Txt variant="monoSmall">{pct(x.v)}</Txt>
                    </View>
                    <MeterBar pct={x.v ?? 0} />
                  </View>
                ))}
                <View style={styles.meter}>
                  <View style={styles.meterHead}>
                    <Txt variant="small" color="ink2">
                      Error rate
                    </Txt>
                    <Txt variant="monoSmall">{m.errorRate}%</Txt>
                  </View>
                  <MeterBar
                    pct={m.errorRate * 10}
                    tone={m.errorRate > 2 ? 'bad' : 'ok'}
                  />
                </View>
              </View>
            </Section>
          ) : null}

          <Section
            title="Dependency checks"
            meta={`${h.checks.filter(c => c.state === 'ok').length}/${h.checks.length} ok`}
            pad={false}
          >
            {h.checks.map((c, i) => (
              <View
                key={c.name}
                style={[
                  styles.check,
                  i > 0 && { borderTopWidth: 1, borderTopColor: t.colors.hairSoft },
                ]}
              >
                {c.state === 'ok' ? (
                  <Check size={15} color={t.colors.ok} />
                ) : (
                  <AlertTriangle size={15} color={t.colors.warn} />
                )}
                <Txt variant="bodyStrong">{c.name}</Txt>
                <Txt
                  variant="monoSmall"
                  color="ink3"
                  numberOfLines={2}
                  style={styles.checkDetail}
                >
                  {c.detail}
                </Txt>
              </View>
            ))}
          </Section>

          <Section title="Controls">
            <View style={styles.controls}>
              <Button
                label={paused ? 'Resume scheduler' : 'Pause scheduler'}
                icon={paused ? Play : Pause}
                busy={busy === 'pause'}
                onPress={() =>
                  run('pause', a => a.togglePauseScheduler(), {
                    success: r => (r.paused ? 'Scheduler paused' : 'Scheduler resumed'),
                    invalidate: ['config'],
                  })
                }
                block
              />
              <Button
                label={draining ? 'Draining sessions…' : 'Drain sessions'}
                icon={Zap}
                variant="danger"
                busy={busy === 'drain'}
                onPress={() => setConfirmDrain(true)}
                block
              />
            </View>
          </Section>
        </>
      )}

      <ConfirmSheet
        visible={confirmDrain}
        title="Drain sessions?"
        message="No new jobs are accepted until the running and queued ones finish."
        confirmLabel="Drain"
        danger
        onConfirm={() =>
          run('drain', a => a.drain(), {
            success: r =>
              r.draining
                ? `Draining · ${r.activeJobs} job${r.activeJobs === 1 ? '' : 's'} still active`
                : 'Nothing was running — sessions drained',
            invalidate: ['config', 'jobs'],
          })
        }
        onClose={() => setConfirmDrain(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  uptime: { marginTop: 4, marginLeft: 22 },
  rule: { height: 1, marginVertical: 10 },
  meters: { gap: 14 },
  meter: { gap: 7 },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between' },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    minHeight: 46,
    paddingVertical: 8,
  },
  checkDetail: { flex: 1, textAlign: 'right' },
  controls: { gap: 10 },
});
