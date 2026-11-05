import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { ChevronDown, RotateCcw, Sparkles } from 'lucide-react-native';
import { IconButton, Screen, useToast } from '../../components/ui';
import { ChatComposer, ChatMessages } from '../../components/project/AgentChat';
import { useBidAgent } from '../../data/bidAgent';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/**
 * The Bid Agent chat for one tender, opened from the card above Ready for Bid. The
 * conversation scrolls on its own and the message box stays at the bottom.
 */
export function BidAgentChatScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'BidAgentChat'>>();
  const agent = useBidAgent();
  const chat = agent.useChat(params.tenderId);
  const prep = agent.usePrep(params.tenderId);
  const scroll = useRef<ScrollView>(null);
  const [clearing, setClearing] = useState(false);

  const openFile = (f: { file_id: number; name: string }) =>
    prep
      .open(params.projectId ?? null, f)
      .then(msg => (msg ? toast.show(msg) : undefined))
      .catch(e => toast.show((e as Error).message));

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.head}>
          <IconButton label="Close the chat" onPress={() => navigation.goBack()}>
            <ChevronDown size={22} color={t.colors.ink} />
          </IconButton>
          <View style={[styles.tile, { backgroundColor: t.colors.accentWash }]}>
            <Sparkles size={16} color={t.colors.accent} />
          </View>
          <View style={styles.titleBox}>
            <Text style={[styles.title, { color: t.colors.ink }]}>Bid Agent</Text>
            {params.title ? (
              <Text numberOfLines={1} style={[styles.sub, { color: t.colors.muted }]}>
                {params.title}
              </Text>
            ) : null}
          </View>
          {chat.messages.length && !chat.working ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear the conversation"
              disabled={clearing}
              onPress={() => {
                setClearing(true);
                chat
                  .clear()
                  .catch(e => toast.show((e as Error).message))
                  .finally(() => setClearing(false));
              }}
              hitSlop={8}
            >
              <RotateCcw size={17} color={t.colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          ref={scroll}
          style={styles.fill}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        >
          <ChatMessages chat={chat} onOpenFile={openFile} />
        </ScrollView>
        <View style={[styles.composer, { borderTopColor: t.colors.hair }]}>
          <ChatComposer chat={chat} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 8 },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleBox: { flex: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 16 },
  sub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },
  list: { paddingBottom: 12 },
  composer: { borderTopWidth: 1, paddingTop: 10, paddingBottom: 6 },
});
