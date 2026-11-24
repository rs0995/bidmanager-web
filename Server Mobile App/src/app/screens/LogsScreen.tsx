import React, { useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Pause, Play } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import {
  Button,
  FilterChips,
  Screen,
  SearchField,
  Txt,
} from '../../components/ui';
import { fmtClock } from '../../lib/format';
import { LOG_BUFFER, LOG_SOURCES, useLiveLogs } from '../../lib/logs';
import type { LogLevel, LogLine } from '../../lib/types';
import { fonts, useTheme } from '../../theme';

type LevelFilter = 'all' | LogLevel;

// LogsPanel from the desktop: live lines from the running service, polled every
// 2 s while following (see useLiveLogs), filtered by level, source and text.
export function LogsScreen() {
  const t = useTheme();
  const [follow, setFollow] = useState(true);
  const { lines, error, loaded } = useLiveLogs(follow);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [source, setSource] = useState('all');
  const [query, setQuery] = useState('');
  const list = useRef<FlatList<LogLine>>(null);

  const shown = useMemo(
    () =>
      lines.filter(
        l =>
          (level === 'all' || l.level === level) &&
          (source === 'all' || l.source === source) &&
          l.message.toLowerCase().includes(query.toLowerCase()),
      ),
    [lines, level, source, query],
  );


  return (
    <Screen
      scroll={false}
      header={
        <AppHeader
          back
          code="LOG"
          title="Logs"
          right={
            <Button
              label={follow ? 'Pause' : 'Follow'}
              icon={follow ? Pause : Play}
              size="sm"
              variant={follow ? 'default' : 'primary'}
              onPress={() => setFollow(f => !f)}
            />
          }
        />
      }
    >
      <View style={styles.filters}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Filter lines" />
        <FilterChips<LevelFilter>
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'All levels' },
            { value: 'error', label: 'Error' },
            { value: 'warn', label: 'Warn' },
            { value: 'info', label: 'Info' },
          ]}
        />
        <FilterChips
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: 'All sources' },
            ...LOG_SOURCES.map(s => ({ value: s, label: s })),
          ]}
        />
      </View>
      <View
        style={[
          styles.console,
          // The one inverted surface in the app, as on the desktop.
          { backgroundColor: t.colors.console, borderColor: t.colors.consoleRule },
        ]}
      >
        <FlatList
          ref={list}
          data={shown}
          keyExtractor={l => String(l.seq)}
          onContentSizeChange={() =>
            follow && list.current?.scrollToEnd({ animated: false })
          }
          contentContainerStyle={styles.consoleContent}
          ListEmptyComponent={
            <Txt style={[styles.line, styles.empty, { color: t.colors.consoleSource }]}>
              {!loaded
                ? error || 'Connecting to the live log…'
                : lines.length
                ? 'Nothing matches these filters. Widen the level or clear the search.'
                : 'No log lines yet.'}
            </Txt>
          }
          renderItem={({ item }) => (
            <Txt
              style={[
                styles.line,
                {
                  color:
                    item.level === 'error'
                      ? t.colors.consoleErrorInk
                      : t.colors.consoleInk,
                },
              ]}
            >
              <Txt style={[styles.line, { color: t.colors.consoleTime }]}>
                {fmtClock(item.ts)}{' '}
              </Txt>
              <Txt style={[styles.line, { color: t.colors.logLevel[item.level] }]}>
                {item.level.toUpperCase().padEnd(5)}{' '}
              </Txt>
              <Txt style={[styles.line, { color: t.colors.consoleSource }]}>
                {item.source.padEnd(9)}{' '}
              </Txt>
              {item.message}
            </Txt>
          )}
        />
      </View>
      <Txt variant="monoSmall" color="ink3" style={styles.footer}>
        {error && loaded
          ? `Connection problem: ${error}`
          : `${shown.length} of ${lines.length} lines · keeps last ${LOG_BUFFER} · ${
              follow ? 'following' : 'paused'
            }`}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  console: {
    flex: 1,
    marginHorizontal: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  consoleContent: { padding: 12, gap: 4 },
  line: { fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 16 },
  footer: { textAlign: 'center', paddingTop: 8, paddingHorizontal: 16 },
  empty: { textAlign: 'center', paddingVertical: 40 },
});
