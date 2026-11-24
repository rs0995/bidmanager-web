import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Bell, ChevronDown, ChevronLeft } from 'lucide-react-native';
import type { RootStackParamList } from '../app/navigation/types';
import { ENVIRONMENTS } from '../lib/environments';
import { useSession } from '../state/session';
import { fonts, useTheme } from '../theme';
import { IconButton, StatusPill, Txt } from './ui';

type Props = {
  title: string;
  /** Three-letter section code in the boxed badge (SRV, JOB, CAP…). */
  code?: string;
  back?: boolean;
  right?: React.ReactNode;
  /** Hide the captcha bar (on the Captchas screen itself). */
  hideCaptchaBanner?: boolean;
};

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Mirrors the desktop Server UI chrome: white masthead ("BidManager CONTROL",
// environment, connection pill), the red captcha bar, then the panel header
// with its boxed section code and condensed title over a rule.
export function AppHeader({ title, code, back, right, hideCaptchaBanner }: Props) {
  const t = useTheme();
  const nav = useNavigation<Nav>();
  const { env, status, pendingCaptchas } = useSession();
  const tone =
    status === 'connected' ? 'ok' : status === 'disconnected' ? 'bad' : 'neutral';

  return (
    <View>
      <View
        style={[
          styles.masthead,
          { backgroundColor: t.colors.surface, borderBottomColor: t.colors.hair },
        ]}
      >
        <View style={styles.brand}>
          <Txt style={[styles.brandName, { color: t.colors.ink }]}>
            BidManager
          </Txt>
          <Txt style={[styles.brandTag, { color: t.colors.accent }]}>
            Control
          </Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Environment: ${ENVIRONMENTS[env].label}`}
          onPress={() => nav.navigate('Connect')}
          style={[
            styles.env,
            { borderColor: t.colors.hair, backgroundColor: t.colors.surface },
          ]}
        >
          <Txt variant="monoSmall">{ENVIRONMENTS[env].label}</Txt>
          <ChevronDown size={13} color={t.colors.ink3} />
        </Pressable>
        <StatusPill tone={tone} label={status} />
      </View>

      {pendingCaptchas > 0 && !hideCaptchaBanner ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Solve waiting captchas"
          onPress={() => nav.navigate('Captchas')}
          style={[
            styles.banner,
            {
              backgroundColor: t.colors.badSoft,
              borderBottomColor: t.colors.badLine,
            },
          ]}
        >
          <Bell size={13} color={t.colors.bad} />
          <Txt variant="small" color="bad" style={styles.bannerText}>
            {pendingCaptchas} captcha{pendingCaptchas === 1 ? '' : 's'} waiting
            on you
          </Txt>
          <Txt
            style={[
              styles.solve,
              { color: t.colors.bad, borderBottomColor: t.colors.bad },
            ]}
          >
            Solve now
          </Txt>
        </Pressable>
      ) : null}

      <View style={[styles.panelHead, { borderBottomColor: t.colors.hair }]}>
        {back ? (
          <IconButton
            icon={ChevronLeft}
            label="Back"
            onPress={() => nav.goBack()}
          />
        ) : null}
        <View style={styles.titleRow}>
          {code ? (
            <View
              style={[
                styles.code,
                {
                  borderColor: t.colors.hair,
                  backgroundColor: t.colors.surface,
                },
              ]}
            >
              <Txt style={[styles.codeText, { color: t.colors.accent }]}>
                {code}
              </Txt>
            </View>
          ) : null}
          <Txt variant="title" numberOfLines={1} style={styles.title}>
            {title}
          </Txt>
        </View>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  brandName: { fontFamily: fonts.cond, fontSize: 18, letterSpacing: -0.2 },
  brandTag: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.9,
    textTransform: 'uppercase',
  },
  env: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    paddingHorizontal: 8,
    borderWidth: 1,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 12.5 },
  solve: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    borderBottomWidth: 1,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    minHeight: 44,
  },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  code: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  codeText: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
  },
  title: { flexShrink: 1 },
});
