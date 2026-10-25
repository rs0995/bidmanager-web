import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Field, Screen } from '../../components/ui';
import { useAccount } from '../../fixtures/account';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Mode = 'login' | 'register';

/**
 * Phase 1: validates the form and enters the app. Phase 2B calls the server and gates the
 * app behind it (boot → sign-in → app lock).
 */
export function SignInScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signIn } = useAccount();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);

  const emailError =
    tried && !/^\S+@\S+\.\S+$/.test(email) ? 'Enter a valid email' : '';
  const passwordError = tried && !password ? 'Enter your password' : '';
  const nameError =
    tried && mode === 'register' && !name.trim() ? 'Enter your name' : '';

  const submit = () => {
    setTried(true);
    if (!/^\S+@\S+\.\S+$/.test(email) || !password) return;
    if (mode === 'register' && !name.trim()) return;
    signIn(email, mode === 'register' ? name : undefined);
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Tabs' }] }),
    );
  };

  const register = mode === 'register';
  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.brand}>
        <Text style={[styles.logo, { color: t.colors.accentInk }]}>
          BID MANAGER
        </Text>
        <Text style={[styles.tagline, { color: t.colors.muted }]}>
          {register ? 'Create your account' : 'Sign in to continue'}
        </Text>
      </View>

      <View style={styles.form}>
        {register ? (
          <Field
            label="Display name"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            error={nameError}
          />
        ) : null}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          error={emailError}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          autoCapitalize="none"
          error={passwordError}
        />
        <Button
          block
          label={register ? 'Create account' : 'Sign in'}
          onPress={submit}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          register
            ? 'Already have an account? Sign in'
            : 'Do not have an account? Register'
        }
        onPress={() => {
          setMode(register ? 'login' : 'register');
          setTried(false);
        }}
        style={styles.switch}
      >
        <Text style={[styles.switchText, { color: t.colors.accentInk }]}>
          {register
            ? 'Already have an account? Sign in'
            : 'Do not have an account? Register'}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: 32 },
  logo: { fontFamily: fonts.extrabold, fontSize: 26, letterSpacing: 1 },
  tagline: { fontFamily: fonts.medium, fontSize: 13.5, marginTop: 6 },
  form: { gap: 14 },
  switch: { marginTop: 18, alignItems: 'center' },
  switchText: { fontFamily: fonts.semibold, fontSize: 13 },
});
