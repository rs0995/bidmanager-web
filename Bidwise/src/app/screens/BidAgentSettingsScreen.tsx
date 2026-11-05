import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, FileText, Plus, Trash2 } from 'lucide-react-native';
import { Button, Card, IconButton, PageTitle, Screen, Segmented, useSurface, useToast } from '../../components/ui';
import { useBidAgent } from '../../data/bidAgent';
import type { AgentTraining } from '../../data/bidAgent';
import { fonts, useTheme } from '../../theme';

type Tab = 'instructions' | 'learned' | 'references' | 'templates';

/**
 * Settings and training for the Bid Agent: standing instructions it always follows,
 * what it learned from corrections ("remember …"), reference documents it can attach,
 * and how checklist templates are used. Shared by the whole organisation; only its
 * admins can change them.
 */
export function BidAgentSettingsScreen() {
  const t = useTheme();
  const navigation = useNavigation();
  const training = useBidAgent().useTraining();
  const [tab, setTab] = useState<Tab>('instructions');

  return (
    <Screen>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle sub="What the agent follows, has learned and can attach.">Bid Agent training</PageTitle>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'instructions', label: 'Rules' },
          { value: 'learned', label: 'Learned' },
          { value: 'references', label: 'Docs' },
          { value: 'templates', label: 'Lists' },
        ]}
        style={styles.seg}
      />
      {training.loading ? (
        <ActivityIndicator style={styles.pad} color={t.colors.accent} />
      ) : training.error ? (
        <Text style={[styles.note, { color: t.colors.crit }]}>{training.error}</Text>
      ) : tab === 'instructions' ? (
        <Instructions training={training} />
      ) : tab === 'learned' ? (
        <Learned training={training} />
      ) : tab === 'references' ? (
        <References training={training} />
      ) : (
        <Card padding={16} radius="lg" elevation="sm">
          <Text style={[styles.h3, { color: t.colors.ink }]}>Checklist templates</Text>
          <Text style={[styles.body, { color: t.colors.inkSoft }]}>
            When you ask the agent to prepare the checklist, it starts from your checklist template whose
            organisation matches the tender's employer (for example “GMRC”), or else a template named “Bid Agent
            default”, then adds what this tender asks for. Templates are made on the desktop app's Templates page.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

function Instructions({ training }: { training: AgentTraining }) {
  const t = useTheme();
  const toast = useToast();
  const surface = useSurface();
  const [text, setText] = useState(training.instructions);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(training.instructions), [training.instructions]);
  const changed = text.trim() !== training.instructions.trim();
  return (
    <Card padding={16} radius="lg" elevation="sm">
      <Text style={[styles.h3, { color: t.colors.ink }]}>Standing instructions</Text>
      <Text style={[styles.body, { color: t.colors.muted }]}>
        The agent follows these in every chat, e.g. “Save the prequal as Excel”, “Answer in one line”, “Our
        company is a JV lead, check JV criteria too”.
      </Text>
      <TextInput
        accessibilityLabel="Standing instructions"
        multiline
        editable={training.canEdit}
        value={text}
        onChangeText={setText}
        placeholder="One instruction per line"
        placeholderTextColor={t.colors.muted}
        style={[styles.input, surface, { color: t.colors.ink }]}
      />
      {training.canEdit ? (
        <Button
          label="Save"
          size="sm"
          disabled={!changed}
          loading={saving}
          onPress={() => {
            setSaving(true);
            training
              .saveInstructions(text)
              .then(() => toast.show('Instructions saved.'))
              .catch(e => toast.show((e as Error).message))
              .finally(() => setSaving(false));
          }}
        />
      ) : (
        <Text style={[styles.note, { color: t.colors.muted }]}>Only your organisation's admins can change these.</Text>
      )}
    </Card>
  );
}

function Learned({ training }: { training: AgentTraining }) {
  const t = useTheme();
  const toast = useToast();
  const fail = (e: unknown) => toast.show((e as Error).message);
  return (
    <Card padding={4} radius="lg" elevation="sm">
      {training.learnings.length ? (
        training.learnings.map((l, i) => (
          <View
            key={l.id}
            style={[
              styles.row,
              i < training.learnings.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: t.colors.hair,
              },
            ]}
          >
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: l.active ? t.colors.ink : t.colors.muted }]}>{l.text}</Text>
              <Text style={[styles.rowSub, { color: t.colors.muted }]}>
                {l.employer_key ? `For ${l.employer_key} tenders` : 'For every tender'}
                {l.active ? '' : ' · paused'}
              </Text>
            </View>
            {training.canEdit ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={l.active ? 'Pause' : 'Use again'}
                  hitSlop={8}
                  onPress={() => training.setLearningActive(l.id, !l.active).catch(fail)}
                >
                  <Text style={[styles.link, { color: t.colors.accentInk }]}>{l.active ? 'Pause' : 'Use'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Forget"
                  hitSlop={8}
                  onPress={() => training.deleteLearning(l.id).catch(fail)}
                >
                  <Trash2 size={16} color={t.colors.muted} />
                </Pressable>
              </>
            ) : null}
          </View>
        ))
      ) : (
        <Text style={[styles.empty, { color: t.colors.muted }]}>
          Nothing yet. Correct the agent in a chat and say “remember …” (e.g. “remember: for MMRDA the criteria are in
          the NIT”), and it will keep it here.
        </Text>
      )}
    </Card>
  );
}

function References({ training }: { training: AgentTraining }) {
  const t = useTheme();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const fail = (e: unknown) => toast.show((e as Error).message);
  return (
    <>
      <Card padding={4} radius="lg" elevation="sm">
        {training.references.length ? (
          training.references.map((r, i) => (
            <View
              key={r.file_id}
              style={[
                styles.row,
                i < training.references.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: t.colors.hair,
                },
              ]}
            >
              <FileText size={16} color={t.colors.accent} />
              <View style={styles.rowText}>
                <Text numberOfLines={2} style={[styles.rowTitle, { color: t.colors.ink }]}>
                  {r.name}
                </Text>
                <Text style={[styles.rowSub, { color: t.colors.muted }]}>{Math.max(1, Math.round(r.size / 1024))} KB</Text>
              </View>
              {training.canEdit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${r.name}`}
                  hitSlop={8}
                  onPress={() => training.deleteReference(r.file_id).catch(fail)}
                >
                  <Trash2 size={16} color={t.colors.muted} />
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={[styles.empty, { color: t.colors.muted }]}>
            Add documents you submit with most bids (GST, PAN, ISO certificates, solvency). Ask the agent to attach
            them, e.g. “attach the GST certificate to its checklist row”.
          </Text>
        )}
      </Card>
      {training.canEdit ? (
        <View style={styles.addRow}>
          <Button
            label="Add a document"
            variant="secondary"
            size="sm"
            loading={adding}
            icon={<Plus size={16} color={t.colors.ink} />}
            onPress={() => {
              setAdding(true);
              training
                .addReference()
                .then(added => (added ? toast.show('Document added.') : undefined))
                .catch(fail)
                .finally(() => setAdding(false));
            }}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  seg: { marginBottom: 14 },
  h3: { fontFamily: fonts.semibold, fontSize: 15, marginBottom: 6 },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  input: {
    minHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  note: { fontFamily: fonts.regular, fontSize: 12, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12 },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  link: { fontFamily: fonts.semibold, fontSize: 13 },
  empty: { fontFamily: fonts.regular, fontSize: 13, padding: 14, lineHeight: 19 },
  addRow: { flexDirection: 'row', marginTop: 12 },
  pad: { padding: 16 },
});
