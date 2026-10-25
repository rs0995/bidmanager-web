import React from 'react';
import { StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Archive,
  Link2,
  ListOrdered,
  ScrollText,
  ShieldAlert,
} from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import {
  Badge,
  ListRow,
  Screen,
  Section,
  Txt,
} from '../../components/ui';
import { ENVIRONMENTS } from '../../lib/environments';
import { useSession } from '../../state/session';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function MoreScreen() {
  const nav = useNavigation<Nav>();
  const { env, base, pendingCaptchas } = useSession();

  return (
    <Screen tabBar header={<AppHeader code="ETC" title="More" />}>
      <Section title="Operations" pad={false}>
        <ListRow
          icon={ShieldAlert}
          title="Captchas"
          subtitle={
            pendingCaptchas
              ? `${pendingCaptchas} waiting on you`
              : 'Nothing waiting'
          }
          right={<Badge count={pendingCaptchas} />}
          chevron
          onPress={() => nav.navigate('Captchas')}
        />
        <ListRow
          icon={Archive}
          title="Archive"
          subtitle="Closed tenders and their latest status"
          chevron
          divider
          onPress={() => nav.navigate('Archive')}
        />
        <ListRow
          icon={ScrollText}
          title="Logs"
          subtitle="Live from the running service"
          chevron
          divider
          onPress={() => nav.navigate('Logs')}
        />
        <ListRow
          icon={ListOrdered}
          title="Job queue settings"
          subtitle="Queue limits, archive sweep, scheduler downtime"
          chevron
          divider
          onPress={() => nav.navigate('Settings')}
        />
      </Section>

      <Section title="Connection" pad={false}>
        <ListRow
          icon={Link2}
          title={ENVIRONMENTS[env].label}
          meta={base}
          chevron
          onPress={() => nav.navigate('Connect')}
        />
      </Section>

      <Txt variant="monoSmall" color="ink3" style={styles.version}>
        BM Server · 1.0.0
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  version: { textAlign: 'center', marginTop: 6 },
});
