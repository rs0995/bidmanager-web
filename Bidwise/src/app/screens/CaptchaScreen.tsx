import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Line, Text as SvgText } from 'react-native-svg';
import { ChevronLeft, ShieldQuestion } from 'lucide-react-native';
import {
  Button,
  Card,
  Field,
  IconButton,
  PageTitle,
  Screen,
  useToast,
} from '../../components/ui';
import { useCaptcha } from '../../fixtures/captcha';
import { fonts, useTheme } from '../../theme';

/** Stand-in for the server's PNG: the sample characters, skewed over noise lines. */
function SampleCaptcha({ text }: { text: string }) {
  const t = useTheme();
  const ink = t.scheme === 'dark' ? '#e8eaee' : '#2a2f37';
  return (
    <Svg width="100%" height={110} viewBox="0 0 240 110">
      {[14, 38, 63, 88].map((y, i) => (
        <Line
          key={y}
          x1="0"
          y1={y}
          x2="240"
          y2={110 - y + i * 6}
          stroke={t.colors.muted}
          strokeWidth={1}
          opacity={0.5}
        />
      ))}
      {text.split('').map((ch, i) => (
        <SvgText
          key={i}
          x={34 + i * 31}
          y={66 + (i % 2 ? -6 : 7)}
          fontSize={38}
          fontWeight="700"
          fill={ink}
          rotation={i % 2 ? 12 : -14}
          originX={34 + i * 31}
          originY={60}
        >
          {ch}
        </SvgText>
      ))}
    </Svg>
  );
}

/**
 * Lets the user solve a CAPTCHA one of their own update jobs hit, racing the desktop
 * console: the first valid answer wins.
 */
export function CaptchaScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const { pending, answer } = useCaptcha();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await answer(text).catch(() => false);
    setBusy(false);
    if (ok) {
      setText('');
      toast.show('Submitted — the job will continue shortly');
    } else {
      toast.show('This one may have already been answered elsewhere');
    }
  };

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle>Captcha</PageTitle>

      {!pending ? (
        <View style={styles.empty}>
          <ShieldQuestion size={32} color={t.colors.muted} />
          <Text style={[styles.emptyText, { color: t.colors.muted }]}>
            No CAPTCHA needs solving right now.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={[styles.lede, { color: t.colors.inkSoft }]}>
            One of your updates needs a CAPTCHA solved to continue.
          </Text>
          <Text style={[styles.context, { color: t.colors.muted }]}>
            {pending.context}
          </Text>
          <Card padding={12} radius="lg" elevation="sm">
            {pending.imageBase64 ? (
              <Image
                accessibilityLabel="Captcha image"
                source={{ uri: `data:image/png;base64,${pending.imageBase64}` }}
                style={styles.image}
                resizeMode="contain"
              />
            ) : (
              <SampleCaptcha text={pending.sampleText} />
            )}
          </Card>
          <Field
            label="Enter the text shown above"
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Captcha answer"
            onSubmitEditing={submit}
          />
          <Button
            label="Submit"
            block
            loading={busy}
            disabled={!text.trim()}
            onPress={submit}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  body: { gap: 12 },
  image: { width: '100%', height: 110 },
  lede: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19 },
  context: { fontFamily: fonts.medium, fontSize: 12, marginTop: -6 },
  empty: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontFamily: fonts.regular, fontSize: 13.5, textAlign: 'center' },
});
