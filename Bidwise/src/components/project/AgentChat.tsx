import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { Card, Chip, useSurface } from '../ui';
import type { AgentChat } from '../../data/bidAgent';
import type { ChatCard, ChatMessage } from '../../lib/bidAgent';
import { share } from '../../platform/share';
import { fonts, useTheme } from '../../theme';

type OpenFile = (file: { file_id: number; name: string }) => void;

const ROWS_SHOWN = 4;

/**
 * The Bid Agent on the tender / project page, above Ready for Bid: one compact card
 * (last answer or progress) that opens the chat in its own screen, so the page
 * doesn't grow with the conversation.
 */
export function AgentChatPreview({ chat, onOpen }: { chat: AgentChat; onOpen: () => void }) {
  const t = useTheme();
  const last = [...chat.messages].reverse().find(m => m.role === 'assistant');
  const busy = chat.working;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open the Bid Agent chat" onPress={onOpen}>
      <Card padding={14} radius="lg" elevation="sm" style={styles.card}>
        <View style={styles.head}>
          <View style={[styles.tile, { backgroundColor: t.colors.accentWash }]}>
            <Sparkles size={17} color={t.colors.accent} />
          </View>
          <View style={styles.headCopy}>
            <Text style={[styles.h3, { color: t.colors.ink }]}>Bid Agent</Text>
            <Text numberOfLines={2} style={[styles.sub, { color: t.colors.muted }]}>
              {busy
                ? chat.progress || 'Working…'
                : last
                ? last.text
                : chat.aiEnabled
                ? 'Ask for the prequal, tender forms or the documents checklist'
                : 'Basic mode: AI reading is off on the server'}
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator size="small" color={t.colors.accent} />
          ) : (
            <View style={[styles.openBtn, { backgroundColor: t.colors.accentWash }]}>
              <MessageSquare size={14} color={t.colors.accentInk} />
              <Text style={[styles.openText, { color: t.colors.accentInk }]}>
                {chat.messages.length ? 'Open' : 'Ask'}
              </Text>
            </View>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

/** The conversation (used by the Bid Agent screen). Text is selectable. */
export function ChatMessages({ chat, onOpenFile }: { chat: AgentChat; onOpenFile: OpenFile }) {
  const t = useTheme();
  return (
    <View>
      {chat.messages.length === 0 ? (
        <Text style={[styles.empty, { color: t.colors.muted }]}>
          Ask in your own words, e.g. “fetch the qualification criteria”, “the criteria are on pages 12–14”,
          “save the prequal as PDF”, “extract form FIN-3.2”, “prepare the checklist”.
        </Text>
      ) : null}
      {chat.messages.map(m => (
        <Message key={m.id} m={m} onOpenFile={onOpenFile} />
      ))}
      {chat.working ? (
        <View style={styles.progress}>
          <ActivityIndicator size="small" color={t.colors.accent} />
          <Text style={[styles.progressText, { color: t.colors.muted }]}>{chat.progress || 'Working…'}</Text>
        </View>
      ) : null}
      {chat.error ? <Text style={[styles.error, { color: t.colors.crit }]}>{chat.error}</Text> : null}
    </View>
  );
}

/** Suggestions + the message box, pinned at the bottom of the Bid Agent screen. */
export function ChatComposer({ chat }: { chat: AgentChat }) {
  const t = useTheme();
  const surface = useSurface();
  const [text, setText] = useState('');
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
  const chips = chat.suggestions.filter(s => !chat.messages.some(m => m.role === 'user' && m.text === s)).slice(0, 4);
  return (
    <View>
      {error ? <Text style={[styles.error, { color: t.colors.crit }]}>{error}</Text> : null}
      {!busy && chips.length ? (
        <View style={styles.chips}>
          {chips.map(s => (
            <Chip key={s} label={s} onPress={() => send(s)} />
          ))}
        </View>
      ) : null}
      <View style={[styles.inputRow, surface]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask the Bid Agent…"
          placeholderTextColor={t.colors.muted}
          accessibilityLabel="Message the Bid Agent"
          style={[styles.input, { color: t.colors.ink }]}
          multiline
          editable={!busy}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!text.trim() || busy}
          onPress={() => send(text)}
          style={[styles.send, { backgroundColor: text.trim() && !busy ? t.colors.accent : t.colors.surfaceSunk }]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={t.colors.onAccent} />
          ) : (
            <ArrowUp size={17} color={text.trim() && !busy ? t.colors.onAccent : t.colors.muted} />
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
  card: { marginTop: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headCopy: { flex: 1 },
  h3: { fontFamily: fonts.semibold, fontSize: 15 },
  sub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2, lineHeight: 16 },
  openBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  openText: { fontFamily: fonts.semibold, fontSize: 12 },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 20, paddingHorizontal: 12 },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 16, padding: 6 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, minHeight: 36, maxHeight: 120, paddingHorizontal: 8, paddingVertical: 8 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
