import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PlugZap } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import {
  Button,
  Card,
  Screen,
  SegmentedControl,
  StatusPill,
  TextField,
  Txt,
  useToast,
} from '../../components/ui';
import { createApi } from '../../lib/api';
import { ENVIRONMENTS, EnvKey } from '../../lib/environments';
import { useSession } from '../../state/session';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>;
type Test =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; detail: string }
  | { state: 'failed'; detail: string };

// Server URL + admin key (the desktop masthead's environment picker and key box).
// Shown first when no key is saved; Test calls GET /admin/health with the typed
// values before anything is stored.
export function ConnectScreen({ navigation }: Props) {
  const toast = useToast();
  const session = useSession();
  const [env, setEnv] = useState<EnvKey>(session.env);
  const [base, setBase] = useState(session.base);
  const [key, setKey] = useState(session.adminKey);
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const canClose = navigation.canGoBack();

  const pickEnv = (e: EnvKey) => {
    setEnv(e);
    setBase(e === session.env ? session.base : ENVIRONMENTS[e].base);
    setTest({ state: 'idle' });
  };

  const runTest = async () => {
    setTest({ state: 'testing' });
    try {
      const h = await createApi(base.trim(), key.trim()).health();
      setTest({
        state: 'ok',
        detail: `${h.status}${h.revision ? ` · ${h.revision}` : ''}`,
      });
    } catch (err) {
      setTest({ state: 'failed', detail: (err as Error).message });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await session.connect(env, base.trim(), key.trim());
      toast(`Connected to ${ENVIRONMENTS[env].label}`);
      if (canClose) navigation.goBack();
      else navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
    } catch (err) {
      toast((err as Error).message || 'Could not save the connection');
    } finally {
      setSaving(false);
    }
  };

  const pill =
    test.state === 'ok'
      ? { tone: 'ok' as const, label: 'reachable' }
      : test.state === 'failed'
      ? { tone: 'bad' as const, label: 'failed' }
      : test.state === 'testing'
      ? { tone: 'neutral' as const, label: 'checking' }
      : { tone: 'neutral' as const, label: 'not tested' };

  return (
    <Screen header={<AppHeader code="CON" title="Connection" back={canClose} />}>
      <Card>
        <View style={styles.fields}>
          <SegmentedControl<EnvKey>
            value={env}
            onChange={pickEnv}
            options={[
              { value: 'prod', label: ENVIRONMENTS.prod.label },
              { value: 'staging', label: ENVIRONMENTS.staging.label },
            ]}
          />
          <TextField
            label="API URL"
            value={base}
            onChangeText={v => {
              setBase(v);
              setTest({ state: 'idle' });
            }}
            mono
            keyboardType="url"
          />
          <TextField
            label="Admin key"
            value={key}
            onChangeText={v => {
              setKey(v);
              setTest({ state: 'idle' });
            }}
            secure
            mono
            hint="Sent as x-admin-key on every request. Kept in the device keychain."
          />
        </View>
      </Card>

      <Card>
        <View style={styles.testRow}>
          <StatusPill tone={pill.tone} label={pill.label} />
          <View style={styles.flex} />
          <Button
            label="Test connection"
            icon={PlugZap}
            size="sm"
            busy={test.state === 'testing'}
            disabled={!base.trim() || !key.trim()}
            onPress={runTest}
          />
        </View>
        {test.state === 'ok' || test.state === 'failed' ? (
          <Txt
            variant="monoSmall"
            color={test.state === 'ok' ? 'ok' : 'bad'}
            style={styles.detail}
          >
            {test.detail}
          </Txt>
        ) : null}
      </Card>

      <Button
        label="Save and connect"
        variant="primary"
        busy={saving}
        disabled={!base.trim() || !key.trim()}
        onPress={save}
        block
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fields: { gap: 14 },
  testRow: { flexDirection: 'row', alignItems: 'center' },
  detail: { marginTop: 10 },
});
