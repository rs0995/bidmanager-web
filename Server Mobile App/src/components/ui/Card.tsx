import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Txt } from './Txt';

type CardProps = {
  children?: React.ReactNode;
  /** false: rows run edge to edge (lists of ListRow). */
  pad?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** White card with a 1px rule border and square corners (desktop `Card`). */
export function Card({ children, pad = true, style }: CardProps) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.colors.surface, borderColor: t.colors.hair },
        pad && styles.pad,
        style,
      ]}
    >
      {children}
    </View>
  );
}

type SectionProps = {
  title: string;
  /** Short count/tag shown after the title, e.g. "5/6 ok". */
  meta?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  /** false: children are edge-to-edge rows under a ruled sub-head. */
  pad?: boolean;
};

/** A card with a mono uppercase sub-head inside it (desktop `Card` + `SubHead`). */
export function Section({
  title,
  meta,
  right,
  children,
  pad = true,
}: SectionProps) {
  const t = useTheme();
  return (
    <Card pad={false}>
      <View
        style={[
          styles.head,
          !pad && {
            borderBottomWidth: 1,
            borderBottomColor: t.colors.hairSoft,
            paddingBottom: 10,
          },
        ]}
      >
        <Txt variant="label" style={styles.headText}>
          {title}
          {meta ? `  ·  ${meta}` : ''}
        </Txt>
        {right}
      </View>
      <View style={pad ? styles.body : undefined}>{children}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden' },
  pad: { padding: 14 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    minHeight: 34,
  },
  headText: { flex: 1 },
  body: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14 },
});
