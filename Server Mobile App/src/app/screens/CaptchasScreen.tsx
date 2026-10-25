import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  ImagePlus,
  RefreshCw,
  Send,
  ShieldCheck,
  SkipForward,
} from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  IconButton,
  KeyValue,
  MeterBar,
  Screen,
  StatStrip,
  TextField,
  Txt,
} from '../../components/ui';
import type { Captcha } from '../../lib/types';
import { useAction, useCaptchas, useCaptchaStats } from '../../lib/queries';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme';

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// CaptchaPanel from the desktop. The server holds one captcha at a time (the
// oldest pending); the scraper session waits until it's answered or expires.
export function CaptchasScreen() {
  const t = useTheme();
  const now = useNow();
  const queryClient = useQueryClient();
  const { base } = useSession();
  const captchas = useCaptchas();
  const stats = useCaptchaStats();
  const { run, busy } = useAction();
  const [answer, setAnswer] = useState('');
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const current = captchas.data?.[0];

  // A different captcha arrived: clear the old answer.
  const currentId = current?.id;
  useEffect(() => setAnswer(''), [currentId]);

  const after = { invalidate: ['captchas', 'captchaStats', 'jobs'] };
  const left = current ? Math.max(0, current.expiresAt - now) : 0;
  const total = current ? Math.max(1, current.expiresAt - current.receivedAt) : 1;
  const secs = Math.ceil(left / 1000);
  const urgent = secs <= 30;

  const newImage = async (c: Captcha) => {
    const r = await run('refresh', a => a.refreshCaptcha(c.id), {
      success: 'Image reloaded',
    });
    if (r?.image) {
      queryClient.setQueryData<Captcha[]>([base, 'captchas'], list =>
        (list ?? []).map(x => (x.id === c.id ? { ...x, image: r.image } : x)),
      );
    }
  };

  return (
    <Screen
      header={
        <AppHeader
          back
          code="CAP"
          title="Captchas"
          hideCaptchaBanner
          right={
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              onPress={() => {
                captchas.refetch();
                stats.refetch();
              }}
            />
          }
        />
      }
    >
      <StatStrip
        items={[
          {
            label: 'Waiting',
            value: String(captchas.data?.length ?? 0),
            tone: captchas.data?.length ? 'bad' : undefined,
          },
          {
            label: 'Manual fallback',
            value: stats.data ? (stats.data.manualFallback ? 'On' : 'Off') : '—',
          },
        ]}
      />

      {!captchas.data ? (
        <QueryState
          what="captchas"
          loading={captchas.isPending}
          error={captchas.error}
          onRetry={() => captchas.refetch()}
        />
      ) : !current ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="No captchas waiting."
            message="When a scraper session needs a human, the captcha shows up here and as a red bar on every screen."
          />
        </Card>
      ) : (
        <Card>
          <View style={styles.headRow}>
            <Txt variant="label">Current · {current.id.slice(0, 8)}</Txt>
            <Txt variant="mono" color={urgent ? 'bad' : 'ink'}>
              {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
            </Txt>
          </View>
          <View style={styles.meter}>
            <MeterBar pct={(left / total) * 100} tone={urgent ? 'bad' : 'warn'} />
          </View>

          <View
            style={[
              styles.image,
              { backgroundColor: t.colors.raised, borderColor: t.colors.hair },
            ]}
          >
            {current.image ? (
              <Image
                source={{ uri: current.image }}
                style={styles.img}
                resizeMode="contain"
                accessibilityLabel="Captcha image"
              />
            ) : (
              <Txt variant="small" color="ink3">
                No image was sent with this captcha.
              </Txt>
            )}
          </View>

          <Txt variant="small" color="warn" style={styles.reason}>
            {current.reason}
          </Txt>
          <KeyValue label="Portal" value={current.portal || '—'} />
          <KeyValue label="Job" value={current.jobId ? current.jobId.slice(0, 8) : '—'} />

          <View style={styles.answer}>
            <TextField
              label="Answer"
              value={answer}
              onChangeText={setAnswer}
              placeholder="Type the characters"
              mono
            />
            <Button
              label="Send answer"
              variant="primary"
              icon={Send}
              busy={busy === 'answer'}
              disabled={!answer.trim() || left <= 0}
              onPress={() =>
                run('answer', a => a.answerCaptcha(current.id, answer.trim()), {
                  success: 'Answer sent',
                  ...after,
                })
              }
              block
            />
            <View style={styles.row}>
              <Button
                label="New image"
                icon={ImagePlus}
                size="sm"
                busy={busy === 'refresh'}
                style={styles.flex}
                onPress={() => newImage(current)}
              />
              <Button
                label="Skip"
                icon={SkipForward}
                size="sm"
                busy={busy === 'skip'}
                style={styles.flex}
                onPress={() =>
                  run('skip', a => a.skipCaptcha(current.id, 'requeue'), {
                    success: 'Skipped — the job will try again',
                    ...after,
                  })
                }
              />
              <Button
                label="Abandon"
                icon={Ban}
                size="sm"
                variant="danger"
                busy={busy === 'abandon'}
                style={styles.flex}
                onPress={() => setConfirmAbandon(true)}
              />
            </View>
          </View>
        </Card>
      )}

      <ConfirmSheet
        visible={confirmAbandon}
        title="Abandon this job?"
        message="The captcha is answered with nothing, so the job gives up instead of trying again."
        confirmLabel="Abandon job"
        danger
        onConfirm={() =>
          current &&
          run('abandon', a => a.skipCaptcha(current.id, 'abandon'), {
            success: 'Job abandoned',
            ...after,
          })
        }
        onClose={() => setConfirmAbandon(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meter: { flexDirection: 'row', marginTop: 8, marginBottom: 14 },
  image: {
    height: 110,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  reason: { marginTop: 10, marginBottom: 4 },
  answer: { gap: 10, marginTop: 12 },
  row: { flexDirection: 'row', gap: 8 },
});
