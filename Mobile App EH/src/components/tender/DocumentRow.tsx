import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Paperclip } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import type { TenderDoc } from '../../fixtures/tenders';
import { Card } from '../ui/Card';

export function DocumentRow({
  doc,
  onRequest,
}: {
  doc: TenderDoc;
  onRequest: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onRequest}
      style={styles.press}
    >
      <Card padding={12} elevation="sm" radius="md">
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: t.colors.accentWash }]}>
            <Paperclip size={14} color={t.colors.accentInk} />
          </View>
          <View style={styles.text}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: t.colors.ink }]}
            >
              {doc.name}
            </Text>
            <Text style={[styles.meta, { color: t.colors.muted }]}>
              {doc.meta}
            </Text>
          </View>
          <Text style={[styles.action, { color: t.colors.accentInk }]}>
            Request ›
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  name: { fontFamily: fonts.medium, fontSize: 12.5 },
  meta: { fontFamily: fonts.regular, fontSize: 10.5, marginTop: 1 },
  action: { fontFamily: fonts.bold, fontSize: 11 },
});
