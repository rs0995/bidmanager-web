import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ArrowUp,
  CircleCheck,
  Clock3,
  Copy,
  FileSpreadsheet,
  FileText,
  MessageSquare,
  Sparkles,
} from 'lucide-react-native';
import { Chip, useSurface } from '../ui';
import { GlassBlur } from '../ui/GlassBlur';
import { useReducedMotion } from '../ui/motion';
import type { AgentChat } from '../../data/bidAgent';
import type { ChatCard, ChatMessage } from '../../lib/bidAgent';
import { share } from '../../platform/share';
import { fonts, useTheme } from '../../theme';

type OpenFile = (file: { file_id: number; name: string }) => void;

const ROWS_SHOWN = 4;

const CYCLE_MS = 3200;
const SWIPE_OPEN = 48;

/**
 * Cycles through the suggested requests every few seconds (with a quick fade, none with
 * Reduce Motion) while not `paused`. Used by the one-line box and the chat's message box.
 */
export function useCycledHint(suggestions: string[], paused: boolean) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const count = suggestions.length;
  useEffect(() => {
    if (paused || count < 2) return;
    const id = setInterval(() => {
      if (reduced) {
        setI(n => n + 1);
        return;
      }
      Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
        setI(n => n + 1);
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      });
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [paused, count, reduced, fade]);
  return { hint: count ? suggestions[i % count] : '', fade };
}

/** The message being typed and sending it; shared by the message box and the suggestions. */
export function useChatSend(chat: AgentChat, initialText?: string) {
  const [text, setText] = useState(initialText ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const busy = chat.working || sending;
  const send = (msg: string) => {
    const body = msg.trim();
    if (!body || busy) return;
    setSending(true);
    setError('');
    chat
      .send(body)
      .then(() => setText(''))
      .catch(e => setError((e as Error).message))
      .finally(() => setSending(false));
  };
  return { text, setText, sending, error, busy, send };
}

export type ChatSend = ReturnType<typeof useChatSend>;

/**
 * The Bid Agent on the tender / project page, above Ready for Bid: a one-line box whose
 * placeholder cycles through the suggested requests. Tapping it opens the chat (with the
 * suggestions); swiping it sideways opens the chat with the request on show typed in.
 */
export function AgentChatPreview({
  chat,
  onOpen,
}: {
  chat: AgentChat;
  /** Opens the chat; `prefill` is typed into its message box. */
  onOpen: (prefill?: string) => void;
}) {
  const t = useTheme();
  const surface = useSurface();
  const busy = chat.working;
  const { hint, fade } = useCycledHint(chat.suggestions, busy);
  const drag = useRef(new Animated.Value(0)).current;

  // The pan handlers are made once; they read the latest values from here.
  const latest = useRef({ hint, onOpen });
  latest.current = { hint, onOpen };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(-60, Math.min(60, g.dx))),
        onPanResponderRelease: (_, g) => {
          Animated.timing(drag, { toValue: 0, duration: 160, useNativeDriver: true }).start();
          if (Math.abs(g.dx) >= SWIPE_OPEN) latest.current.onOpen(latest.current.hint || undefined);
        },
        onPanResponderTerminate: () => drag.setValue(0),
      }),
    [drag],
  );

  const text = busy ? chat.progress || 'Working…' : hint || 'Ask the Bid Agent…';
  return (
    <View style={styles.card} {...pan.panHandlers}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? `Bid Agent: ${text}` : 'Ask the Bid Agent'}
        accessibilityHint={hint ? `Suggestion: ${hint}` : undefined}
        accessibilityActions={hint ? [{ name: 'ask', label: `Ask: ${hint}` }] : undefined}
        onAccessibilityAction={e => e.nativeEvent.actionName === 'ask' && onOpen(hint)}
        onPress={() => onOpen()}
        style={[styles.box, surface]}
      >
        <GlassBlur amount={14} />
        <View style={[styles.tile, { backgroundColor: t.colors.accentWash }]}>
          <Sparkles size={16} color={t.colors.accent} />
        </View>
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.hint,
            { color: busy ? t.colors.inkSoft : t.colors.muted },
            !busy && { opacity: fade, transform: [{ translateX: drag }] },
          ]}
        >
          {text}
        </Animated.Text>
        {busy ? (
          <ActivityIndicator size="small" color={t.colors.accent} />
        ) : chat.messages.length ? (
          <MessageSquare size={16} color={t.colors.accentInk} />
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * The conversation (used by the Bid Agent screen). Text is selectable. An empty chat
 * shows the suggested requests, centred; tapping one sends it (`onPick`).
 */
export function ChatMessages({
  chat,
  onOpenFile,
  onPick,
}: {
  chat: AgentChat;
  onOpenFile: OpenFile;
  onPick?: (request: string) => void;
}) {
  const t = useTheme();
  const empty = chat.messages.length === 0 && !chat.working;
  const pick = onPick ?? ((s: string) => chat.send(s).catch(() => {}));
  return (
    <View style={empty ? styles.emptyWrap : undefined}>
      {empty && chat.suggestions.length ? (
        <View style={styles.cloud}>
          {chat.suggestions.map(s => (
            <Chip key={s} label={s} onPress={() => pick(s)} />
          ))}
        </View>
      ) : null}
      {chat.messages.map(m => (
        <Message key={m.id} m={m} onOpenFile={onOpenFile} />
      ))}
      {chat.working && chat.partial ? (
        <View style={[styles.msg, styles.theirs]}>
          <View style={[styles.bubble, { backgroundColor: t.colors.surfaceSunk }]}>
            <Text selectable style={[styles.bubbleText, { color: t.colors.ink }]}>
              {chat.partial}
            </Text>
          </View>
        </View>
      ) : chat.working ? (
        <View style={styles.progress}>
          <ActivityIndicator size="small" color={t.colors.accent} />
          <Text style={[styles.progressText, { color: t.colors.muted }]}>{chat.progress || 'Working…'}</Text>
        </View>
      ) : null}
      {chat.error ? <Text style={[styles.error, { color: t.colors.crit }]}>{chat.error}</Text> : null}
    </View>
  );
}

/**
 * The message box, pinned at the bottom of the Bid Agent screen. While empty, its
 * placeholder cycles through the suggested requests.
 */
export function ChatComposer({ chat, sender }: { chat: AgentChat; sender: ChatSend }) {
  const t = useTheme();
  const surface = useSurface();
  const { text, setText, sending, error, busy, send } = sender;
  const { hint } = useCycledHint(chat.suggestions, busy || Boolean(text));
  // Focus on open only when a request was swiped in from the tender page.
  const [focusOnOpen] = useState(Boolean(text));
  const ready = Boolean(text.trim()) && !busy;
  return (
    <View>
      {error ? <Text style={[styles.error, { color: t.colors.crit }]}>{error}</Text> : null}
      <View style={[styles.inputRow, surface]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={hint || 'Ask the Bid Agent…'}
          placeholderTextColor={t.colors.muted}
          accessibilityLabel="Message the Bid Agent"
          style={[styles.input, { color: t.colors.ink }]}
          multiline
          autoFocus={focusOnOpen}
          editable={!busy}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!ready}
          onPress={() => send(text)}
          style={[styles.send, { backgroundColor: ready ? t.colors.accent : t.colors.surfaceSunk }]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={t.colors.onAccent} />
          ) : (
            <ArrowUp size={17} color={ready ? t.colors.onAccent : t.colors.muted} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

function CopyAction({ text, label = 'Copy / share' }: { text: string; label?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => share.shareText(text).catch(() => {})}
      hitSlop={6}
      style={styles.copy}
    >
      <Copy size={11} color={t.colors.muted} />
      <Text style={[styles.copyText, { color: t.colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

const tableText = (c: Extract<ChatCard, { type: 'table' }>) =>
  [c.columns, ...c.rows].map(r => r.map(v => String(v ?? '').replace(/\s+/g, ' ')).join('\t')).join('\n');

function Message({ m, onOpenFile }: { m: ChatMessage; onOpenFile: OpenFile }) {
  const t = useTheme();
  const mine = m.role === 'user';
  return (
    <View style={[styles.msg, mine ? styles.mine : styles.theirs]}>
      {m.text ? (
        <View
          style={[
            styles.bubble,
            mine
              ? { backgroundColor: t.colors.accent }
              : { backgroundColor: m.error ? t.colors.critWash : t.colors.surfaceSunk },
          ]}
        >
          <Text
            selectable
            style={[styles.bubbleText, { color: mine ? t.colors.onAccent : m.error ? t.colors.crit : t.colors.ink }]}
          >
            {m.text}
          </Text>
        </View>
      ) : null}
      {!mine && m.text ? <CopyAction text={m.text} /> : null}
      {(m.cards ?? []).map((c, i) => (
        <CardView key={i} card={c} onOpenFile={onOpenFile} />
      ))}
    </View>
  );
}

function CardView({ card, onOpenFile }: { card: ChatCard; onOpenFile: OpenFile }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const box = [styles.block, { borderColor: t.colors.hair, backgroundColor: t.colors.surface }];

  if (card.type === 'table') {
    const rows = all ? card.rows : card.rows.slice(0, ROWS_SHOWN);
    return (
      <View style={box}>
        <View style={styles.blockHead}>
          <Text style={[styles.blockTitle, { color: t.colors.inkSoft }]}>{card.title}</Text>
          <CopyAction text={tableText(card)} label="Copy table" />
        </View>
        {rows.map((r, i) => (
          <View key={i} style={[styles.tRow, i > 0 && [styles.divider, { borderTopColor: t.colors.hair }]]}>
            <Text selectable style={[styles.tHead, { color: t.colors.ink }]}>
              {[r[0], r[1]].filter(Boolean).join('  ')}
            </Text>
            {card.columns.slice(2).map((col, j) =>
              r[j + 2] ? (
                <Text selectable key={col} style={[styles.tCell, { color: t.colors.inkSoft }]}>
                  <Text style={{ color: t.colors.muted }}>{col}: </Text>
                  {String(r[j + 2])}
                </Text>
              ) : null,
            )}
          </View>
        ))}
        {card.rows.length > ROWS_SHOWN ? (
          <Pressable accessibilityRole="button" onPress={() => setAll(v => !v)} hitSlop={6}>
            <Text style={[styles.more, { color: t.colors.accentInk }]}>
              {all ? 'Show less' : `Show all ${card.rows.length}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (card.type === 'files') {
    return (
      <View style={box}>
        <Text style={[styles.blockTitle, { color: t.colors.inkSoft }]}>{card.title}</Text>
        {card.files.map(f => {
          const excel = /\.xlsx?$/i.test(f.name);
          return (
            <Pressable
              key={f.file_id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${f.name}`}
              onPress={() => onOpenFile(f)}
              style={styles.fileRow}
            >
              {excel ? (
                <FileSpreadsheet size={16} color={t.colors.good} />
              ) : (
                <FileText size={16} color={t.colors.accent} />
              )}
              <Text numberOfLines={2} style={[styles.fileName, { color: t.colors.ink }]}>
                {f.name}
              </Text>
            </Pressable>
          );
        })}
        {card.attached.length ? (
          <Text selectable style={[styles.tCell, { color: t.colors.muted }]}>
            Also attached in Ready for Bid: {card.attached.map(a => a.row).join(', ')}
          </Text>
        ) : null}
      </View>
    );
  }

  const rows = all ? card.rows : card.rows.slice(0, 6);
  return (
    <View style={box}>
      <Text style={[styles.blockTitle, { color: t.colors.inkSoft }]}>Added to Ready for Bid</Text>
      {rows.map(r => (
        <View key={r.id} style={styles.fileRow}>
          {r.file ? <CircleCheck size={16} color={t.colors.good} /> : <Clock3 size={16} color={t.colors.warn} />}
          <View style={styles.headCopy}>
            <Text selectable numberOfLines={2} style={[styles.fileName, { color: t.colors.ink }]}>{r.name}</Text>
            <Text numberOfLines={1} style={[styles.tCell, { color: t.colors.muted }]}>
              {r.file ? `Attached: ${r.file}` : 'Pending: file to be attached'}
              {r.added ? '' : ' · already in the list'}
            </Text>
          </View>
        </View>
      ))}
      {card.rows.length > 6 ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(v => !v)} hitSlop={6}>
          <Text style={[styles.more, { color: t.colors.accentInk }]}>
            {all ? 'Show less' : `Show all ${card.rows.length}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 26,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tile: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hint: { flex: 1, fontFamily: fonts.regular, fontSize: 14.5 },
  headCopy: { flex: 1 },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  cloud: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingHorizontal: 8 },
  msg: { marginTop: 10, maxWidth: '100%' },
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '88%' },
  bubbleText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, paddingHorizontal: 4 },
  copyText: { fontFamily: fonts.medium, fontSize: 11 },
  block: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 6, alignSelf: 'stretch' },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  blockTitle: { fontFamily: fonts.semibold, fontSize: 12, marginBottom: 4 },
  tRow: { paddingVertical: 6 },
  divider: { borderTopWidth: 1 },
  tHead: { fontFamily: fonts.medium, fontSize: 12.5 },
  tCell: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  more: { fontFamily: fonts.semibold, fontSize: 12, marginTop: 6 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  fileName: { flex: 1, fontFamily: fonts.medium, fontSize: 12.5 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  progressText: { fontFamily: fonts.regular, fontSize: 12 },
  error: { fontFamily: fonts.medium, fontSize: 12, marginTop: 8, marginBottom: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 16, padding: 6 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, minHeight: 36, maxHeight: 120, paddingHorizontal: 8, paddingVertical: 8 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
