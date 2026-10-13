import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { KeyRound, Lock, LogOut } from 'lucide-react-native';
import { ChangePasswordSheet } from '../../components/more/ChangePasswordSheet';
import { SettingsRow } from '../../components/more/SettingsRow';
import {
  Button,
  Card,
  Screen,
  ScreenHeader,
  useToast,
} from '../../components/ui';
import { useAccount } from '../../fixtures/account';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/** Email (read-only), change password and sign out. */
export function AccountScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toast = useToast();
  const { user, signOut } = useAccount();
  const [pwOpen, setPwOpen] = useState(false);

  const doSignOut = () => {
    signOut();
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'SignIn' }] }),
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title="Account"
        subtitle={user?.name}
        onBack={() => navigation.goBack()}
      />

      <Text style={[styles.label, { color: t.colors.muted }]}>EMAIL</Text>
      <View
        accessibilityLabel={`Email: ${user?.email ?? ''}`}
        style={[
          styles.email,
          {
            backgroundColor: t.isGlass ? t.glass.fill : t.colors.surfaceSoft,
            borderColor: t.isGlass ? t.glass.border : t.colors.hair,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.emailText, { color: t.colors.inkSoft }]}
        >
          {user?.email}
        </Text>
        <Lock size={15} color={t.colors.muted} />
      </View>
      <Text style={[styles.hint, { color: t.colors.muted }]}>
        Your email is your sign-in and can't be changed here.
      </Text>

      <Card padding={0} elevation="sm" style={styles.group}>
        <SettingsRow
          icon={KeyRound}
          label="Change password"
          onPress={() => setPwOpen(true)}
        />
      </Card>

      <Button
        block
        variant="danger"
        label="Sign out"
        icon={<LogOut size={16} color={t.colors.crit} />}
        onPress={doSignOut}
      />

      <ChangePasswordSheet
        visible={pwOpen}
        onClose={() => setPwOpen(false)}
        onSaved={() => {
          setPwOpen(false);
          toast.show('Password changed');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.bold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    marginTop: 4,
    marginBottom: 8,
    marginLeft: 2,
  },
  email: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  emailText: { flex: 1, fontFamily: fonts.medium, fontSize: 14 },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    marginTop: 6,
    marginLeft: 2,
  },
  group: { marginTop: 20, marginBottom: 16, overflow: 'hidden' },
});
