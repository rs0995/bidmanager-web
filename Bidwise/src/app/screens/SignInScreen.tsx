import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react-native';
import {
  Checkbox,
  Field,
  GlassBlur,
  Kicker,
  Screen,
  useSurface,
  Wordmark,
} from '../../components/ui';
import { useSession } from '../../fixtures/session';
import { useTenderSource } from '../../data/tenderSource';
import { fonts, useTheme } from '../../theme';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

export function SignInScreen() {
  const t = useTheme();
  const surface = useSurface();
  const { signIn } = useSession();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demo = useTenderSource().mode === 'demo';

  const submit = async () => {
    if (busy) return;
    // The sample-data preview lets anyone in; the live app needs real details.
    if (!demo && (!email.trim() || !password)) {
      setError('Enter your work email and password.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password, remember);
    } catch (e) {
      setError((e as Error).message || 'Couldn’t sign in. Try again.');
      setBusy(false);
    }
  };
  const primaryBg = t.isGlass ? t.glass.fillStrong : t.colors.tint;
  const primaryFg = t.isGlass ? t.colors.accent : t.colors.deep;

  return (
    <Screen>
      {/* A large logo, centred in the space above the intro. */}
      <View style={styles.top}>
        <Wordmark size="xl" />
      </View>

      <View style={styles.intro}>
        <Kicker>YOUR NEXT OPPORTUNITY</Kicker>
        <Text style={[styles.h1, { color: t.colors.ink }]}>
          Big bids.{'\n'}
          <Text style={{ color: t.colors.accent }}>Clear focus.</Text>
        </Text>
        <Text style={[styles.lede, { color: t.colors.muted }]}>
          Your tenders, documents and deadlines.{'\n'}All in one place.
        </Text>
      </View>

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
        placeholder="Password"
        secureTextEntry={!show}
        autoComplete="password"
        textContentType="password"
        // Return only closes the keyboard: signing in is the button's job.
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={show ? 'Hide password' : 'Show password'}
            hitSlop={10}
            onPress={() => setShow(s => !s)}
          >
            {show ? (
              <Eye size={18} color={t.colors.muted} />
            ) : (
              <EyeOff size={18} color={t.colors.muted} />
            )}
          </Pressable>
        }
      />

      <View style={styles.meta}>
        <Pressable
          style={styles.remember}
          onPress={() => setRemember(r => !r)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: remember }}
          accessibilityLabel="Remember me"
        >
          <Checkbox
            checked={remember}
            label="Remember me"
            onPress={() => setRemember(r => !r)}
          />
          <Text style={[styles.metaText, { color: t.colors.inkSoft }]}>
            Remember me
          </Text>
        </Pressable>
        <Pressable accessibilityRole="link" hitSlop={10}>
          <Text style={[styles.metaText, { color: t.colors.accent }]}>
            Forgot password?
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: t.colors.crit }]}
        >
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={submit}
        style={[
          styles.primary,
          {
            backgroundColor: primaryBg,
            borderColor: t.isGlass ? t.glass.edge : t.colors.edge,
          },
          t.shadow.sm,
        ]}
      >
        <GlassBlur amount={14} />
        <Text style={[styles.primaryText, { color: primaryFg }]}>
          {busy ? 'Signing in…' : 'Sign in to workspace'}
        </Text>
        {busy ? (
          <ActivityIndicator size="small" color={primaryFg} />
        ) : (
          <ArrowRight size={18} color={primaryFg} />
        )}
      </Pressable>

      <Pressable accessibilityRole="button" style={[styles.secondary, surface]}>
        <GlassBlur amount={14} />
        <Fingerprint size={18} color={t.colors.ink} />
        <Text style={[styles.secondaryText, { color: t.colors.ink }]}>
          Use biometric sign-in
        </Text>
      </Pressable>

      <Text style={[styles.footnote, { color: t.colors.muted }]}>
        New to bidwise?{' '}
        <Text
          accessibilityRole="link"
          onPress={() => navigation.navigate('SignUp')}
          style={{ color: t.colors.accent, fontFamily: fonts.semibold }}
        >
          Create an account
        </Text>
      </Text>

      <View style={styles.secure}>
        <ShieldCheck size={13} color={t.colors.muted} />
        <Text style={[styles.secureText, { color: t.colors.muted }]}>
          Your workspace. Secure by design.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { marginTop: 28, marginBottom: 8, alignItems: 'center' },
  intro: { marginTop: 36, marginBottom: 14 },
  h1: {
    fontFamily: fonts.display,
    fontSize: 39,
    lineHeight: 43,
    letterSpacing: -2,
    marginBottom: 14,
  },
  lede: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  meta: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  remember: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  metaText: { fontFamily: fonts.medium, fontSize: 13 },
  error: { fontFamily: fonts.medium, fontSize: 12.5, marginTop: 14 },
  primary: {
    marginTop: 18,
    height: 54,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  primaryText: { fontFamily: fonts.semibold, fontSize: 14 },
  secondary: {
    marginTop: 12,
    height: 50,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    overflow: 'hidden',
  },
  secondaryText: { fontFamily: fonts.medium, fontSize: 13 },
  footnote: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 26,
  },
  secure: {
    marginTop: 26,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secureText: { fontFamily: fonts.regular, fontSize: 11 },
});
