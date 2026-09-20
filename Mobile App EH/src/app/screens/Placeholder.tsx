import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card, Screen, ScreenHeader } from '../../components/ui';
import { fonts, useTheme } from '../../theme';

type Props = { title: string; part: string; tabBar?: boolean; back?: boolean };

export function Placeholder({
  title,
  part,
  tabBar = true,
  back = false,
}: Props) {
  const t = useTheme();
  const navigation = useNavigation();
  return (
    <Screen tabBar={tabBar}>
      <ScreenHeader
        title={title}
        onBack={back ? () => navigation.goBack() : undefined}
      />
      <Card>
        <Text style={[styles.label, { color: t.colors.muted }]}>
          Coming in {part}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.medium, fontSize: 13 },
});
