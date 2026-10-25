import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Building2,
  ChevronLeft,
  LockKeyhole,
  Mail,
  UserRound,
} from 'lucide-react-native';
import {
  Button,
  Field,
  IconButton,
  Screen,
  Segmented,
} from '../../components/ui';
import { useSession } from '../../fixtures/session';
import { useTenderSource } from '../../data/tenderSource';
import { fonts, useTheme } from '../../theme';

type Kind = 'individual' | 'organisation';

/**
 * Create an account: for yourself, or for an organisation (created with you as its
 * admin; others join with its code). Signs in when done.
 */
export function SignUpScreen() {
  const t = useTheme();
  const navigation = useNavigation();
  const { signUp } = useSession();
  const demo = useTenderSource().mode === 'demo';
  const [kind, setKind] = useState<Kind>('individual');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!demo) {
      if (!email.trim() || !password) {
        setError('Enter your work email and a password.');
        return;
      }
      // The server's own minimum.
      if (password.length < 8) {
        setError('Use at least 8 characters for the password.');
        return;
      }
      if (kind === 'organisation' && !orgName.trim()) {
        setError('Enter the organisation’s name.');
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      await signUp({
        name,
        email,
        password,
        accountType: kind,
        orgName: kind === 'organisation' ? orgName : undefined,
      });
    } catch (e) {
      setError((e as Error).message || 'Couldn’t create the account.');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <Text style={[styles.title, { color: t.colors.ink }]}>
        Create an account
      </Text>
      <Text style={[styles.sub, { color: t.colors.muted }]}>
        {kind === 'organisation'
          ? 'Your organisation is created with you as its admin. Others join with its code and share its bookmarks and projects.'
          : 'Just for you. You can create or join an organisation later from More.'}
      </Text>

      <Segmented<Kind>
        style={styles.seg}
        value={kind}
        onChange={setKind}
        options={[
          { value: 'individual', label: 'Individual' },
          { value: 'organisation', label: 'Organisation' },
        ]}
      />

      {kind === 'organisation' ? (
        <Field
          label="Organisation name"
          icon={<Building2 size={18} color={t.colors.muted} />}
          value={orgName}
          onChangeText={setOrgName}
          placeholder="Company or team name"
          autoCapitalize="words"
        />
      ) : null}
      <Field
        label="Your name"
        icon={<UserRound size={18} color={t.colors.muted} />}
        value={name}
        onChangeText={setName}
        placeholder="Name"
        autoCapitalize="words"
        textContentType="name"
      />
      <Field
        label="Work email"
        icon={<Mail size={18} color={t.colors.muted} />}
        value={email}
        onChangeText={setEmail}
        placeholder="you@company.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="username"
      />
      <Field
        label="Password"
        icon={<LockKeyhole size={18} color={t.colors.muted} />}
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        textContentType="newPassword"
        onSubmitEditing={submit}
      />

      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: t.colors.crit }]}
        >
          {error}
        </Text>
      ) : null}

      <Button
        label={busy ? 'Creating account…' : 'Create account'}
        block
        loading={busy}
        onPress={submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  seg: { marginTop: 16, marginBottom: 14 },
  error: { fontFamily: fonts.medium, fontSize: 13, marginBottom: 12 },
});
