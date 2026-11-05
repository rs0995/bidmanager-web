import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardEvent,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { ChevronDown, RotateCcw, Sparkles } from 'lucide-react-native';
import { IconButton, Screen, useToast } from '../../components/ui';
import { ChatComposer, ChatMessages, useChatSend } from '../../components/project/AgentChat';
import { useBidAgent } from '../../data/bidAgent';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/**
 * How far the keyboard overlaps `view`, measured in window coordinates. The chat opens
 * as a page sheet that sits lower than the window's top, which KeyboardAvoidingView
 * gets wrong (it measures from its parent), leaving the message box under the keyboard.
 */
function useKeyboardOverlap(view: React.RefObject<View | null>) {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const animate = (e?: KeyboardEvent) => {
      if (e?.duration) {
        LayoutAnimation.configureNext({
          duration: e.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
    };
    const onShow = (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY;
      view.current?.measureInWindow((_x, y, _w, h) => {
        animate(e);
        setOverlap(Math.max(0, y + h - top));
      });
    };
    const onHide = (e: KeyboardEvent) => {
      animate(e);
      setOverlap(0);
    };
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', onShow),
      Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidChangeFrame', onShow),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', onHide),
    ];
    return () => subs.forEach(s => s.remove());
  }, [view]);
  return overlap;
}

/**
 * The Bid Agent chat for one tender, opened from the box above Ready for Bid. The
 * conversation scrolls on its own and the message box stays at the bottom, above the
 * keyboard when it is up.
 */
export function BidAgentChatScreen() {
  const t = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'BidAgentChat'>>();
  const agent = useBidAgent();
  const chat = agent.useChat(params.tenderId);
  const prep = agent.usePrep(params.tenderId);
  const sender = useChatSend(chat, params.prefill);
  const scroll = useRef<ScrollView>(null);
  const body = useRef<View>(null);
  const keyboard = useKeyboardOverlap(body);
  const [clearing, setClearing] = useState(false);

  const openFile = (f: { file_id: number; name: string }) =>
    prep
      .open(params.projectId ?? null, f)
      .then(msg => (msg ? toast.show(msg) : undefined))
      .catch(e => toast.show((e as Error).message));

  return (
    <Screen scroll={false}>
      <View ref={body} style={[styles.fill, { paddingBottom: keyboard }]}>
        <View style={[styles.head, { borderBottomColor: t.colors.hair }]}>
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
          <ChatMessages chat={chat} onOpenFile={openFile} onPick={sender.send} />
        </ScrollView>
        <View style={[styles.composer, { borderTopColor: t.colors.hair }]}>
          <ChatComposer chat={chat} sender={sender} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleBox: { flex: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 16 },
  sub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },
  list: { flexGrow: 1, paddingTop: 4, paddingBottom: 12 },
  composer: { borderTopWidth: 1, paddingTop: 10, paddingBottom: 6 },
});
