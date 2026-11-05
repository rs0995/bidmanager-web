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
  FileSpreadsheet,
  FileText,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native';
import { Card, Chip, useSurface } from '../ui';
import type { AgentChat } from '../../data/bidAgent';
import type { ChatCard, ChatMessage } from '../../lib/bidAgent';
import { fonts, useTheme } from '../../theme';

type Props = {
  chat: AgentChat;
  /** Opens a file the agent saved (Docs for Preparation). */
  onOpenFile: (file: { file_id: number; name: string }) => void;
};

const ROWS_SHOWN = 4;

/**
 * The Bid Agent as a chat on the tender / project page, above Ready for Bid. The user
 * asks in their own words ("show the prequal", "save it as PDF", "extract form
 * FIN-3.2", "prepare the checklist") and the agent does it: tables appear in the chat,
 * files go to Docs for Preparation, checklist rows go to Ready for Bid.
 */
export function AgentChatCard({ chat, onOpenFile }: Props) {
  const t = useTheme();
  const surface = useSurface();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = (msg: string) => {
    const body = msg.trim();
    if (!body || chat.working || sending) return;
    setSending(true);
    setError('');
    chat
      .send(body)
      .then(() => setText(''))
      .catch(e => setError((e as Error).message))
      .finally(() => setSending(false));
  };

  const busy = chat.working || sending;
  return (
    <Card padding={14} radius="lg" elevation="sm" style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.tile, { backgroundColor: t.colors.accentWash }]}>
          <Sparkles size={17} color={t.colors.accent} />
        </View>
        <View style={styles.headCopy}>
          <Text style={[styles.h3, { color: t.colors.ink }]}>Bid Agent</Text>
          <Text style={[styles.sub, { color: t.colors.muted }]}>
            {chat.aiEnabled ? 'Ask for the prequal, forms or the checklist' : 'Basic mode: AI reading is off on the server'}
          </Text>
        </View>
        {chat.messages.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear the conversation"
            disabled={busy}
            onPress={() => chat.clear().catch(e => setError((e as Error).message))}
            hitSlop={8}
            style={styles.clear}
          >
            <RotateCcw size={16} color={t.colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {chat.messages.map(m => (
        <Message key={m.id} m={m} onOpenFile={onOpenFile} />
      ))}

      {busy ? (
        <View style={styles.progress}>
          <ActivityIndicator size="small" color={t.colors.accent} />
          <Text style={[styles.progressText, { color: t.colors.muted }]}>
            {chat.progress || 'Working…'}
          </Text>
        </View>
      ) : null}
      {error || chat.error ? (
        <Text style={[styles.error, { color: t.colors.crit }]}>{error || chat.error}</Text>
      ) : null}

      {!busy ? (
        <View style={styles.chips}>
          {chat.suggestions
            .filter(s => !chat.messages.some(m => m.role === 'user' && m.text === s))
            .slice(0, 4)
            .map(s => (
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
          onSubmitEditing={() => send(text)}
          blurOnSubmit
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!text.trim() || busy}
          onPress={() => send(text)}
          style={[
            styles.send,
            { backgroundColor: text.trim() && !busy ? t.colors.accent : t.colors.surfaceSunk },
          ]}
        >
          <ArrowUp size={17} color={text.trim() && !busy ? t.colors.onAccent : t.colors.muted} />
        </Pressable>
      </View>
    </Card>
  );
}

function Message({ m, onOpenFile }: { m: ChatMessage; onOpenFile: Props['onOpenFile'] }) {
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
          <Text style={[styles.bubbleText, { color: mine ? t.colors.onAccent : m.error ? t.colors.crit : t.colors.ink }]}>
            {m.text}
          </Text>
        </View>
      ) : null}
      {(m.cards ?? []).map((c, i) => (
        <CardView key={i} card={c} onOpenFile={onOpenFile} />
      ))}
    </View>
  );
}

function CardView({ card, onOpenFile }: { card: ChatCard; onOpenFile: Props['onOpenFile'] }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const box = [styles.block, { borderColor: t.colors.hair, backgroundColor: t.colors.surface }];
  const title = <Text style={[styles.blockTitle, { color: t.colors.inkSoft }]}>{card.title}</Text>;

  if (card.type === 'table') {
    const rows = all ? card.rows : card.rows.slice(0, ROWS_SHOWN);
    return (
      <View style={box}>
        {title}
        {rows.map((r, i) => (
          <View key={i} style={[styles.tRow, i > 0 && [styles.divider, { borderTopColor: t.colors.hair }]]}>
            <Text style={[styles.tHead, { color: t.colors.ink }]}>
              {[r[0], r[1]].filter(Boolean).join('  ')}
            </Text>
            {card.columns.slice(2).map((col, j) =>
              r[j + 2] ? (
                <Text key={col} style={[styles.tCell, { color: t.colors.inkSoft }]}>
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
        {title}
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
          <Text style={[styles.tCell, { color: t.colors.muted }]}>
            Also attached in Ready for Bid: {card.attached.map(a => a.row).join(', ')}
          </Text>
        ) : null}
      </View>
    );
  }

  // checklist
  const rows = all ? card.rows : card.rows.slice(0, 6);
  return (
    <View style={box}>
      <Text style={[styles.blockTitle, { color: t.colors.inkSoft }]}>Added to Ready for Bid</Text>
      {rows.map(r => (
        <View key={r.id} style={styles.fileRow}>
          {r.file ? (
            <CircleCheck size={16} color={t.colors.good} />
          ) : (
            <Clock3 size={16} color={t.colors.warn} />
          )}
          <View style={styles.headCopy}>
            <Text numberOfLines={2} style={[styles.fileName, { color: t.colors.ink }]}>{r.name}</Text>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  tile: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headCopy: { flex: 1 },
  h3: { fontFamily: fonts.semibold, fontSize: 15 },
  sub: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 1 },
  clear: { padding: 4 },
  msg: { marginTop: 8, maxWidth: '100%' },
  mine: { alignItems: 'flex-end' },
  theirs: { alignItems: 'flex-start' },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '88%' },
  bubbleText: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19 },
  block: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 6, alignSelf: 'stretch' },
  blockTitle: { fontFamily: fonts.semibold, fontSize: 12, marginBottom: 6 },
  tRow: { paddingVertical: 6 },
  divider: { borderTopWidth: 1 },
  tHead: { fontFamily: fonts.medium, fontSize: 12.5 },
  tCell: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  more: { fontFamily: fonts.semibold, fontSize: 12, marginTop: 6 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  fileName: { flex: 1, fontFamily: fonts.medium, fontSize: 12.5 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progressText: { fontFamily: fonts.regular, fontSize: 12 },
  error: { fontFamily: fonts.medium, fontSize: 12, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 14, padding: 6, marginTop: 10 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14, minHeight: 34, maxHeight: 110, paddingHorizontal: 8, paddingVertical: 7 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
