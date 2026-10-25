import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { push } from '../../platform/push';
import { routeForPush } from '../../lib/pushRoute';
import { markReadForPush } from '../../lib/alerts';
import { checkForAlerts } from '../../lib/alertChecks';
import type { PushPayload } from '../../platform/push';
import type { RootStackParamList } from './types';

/**
 * Opens what a tapped notification is about. Mounted with the signed-in tabs, so a tap
 * waits for sign-in; with App lock on, the screen opens underneath the lock and shows
 * once Face ID passes. Also handles the tap that launched the app.
 */
export function usePushOpens() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  useEffect(() => {
    const open = (p: PushPayload | null) => {
      // Opened from the notification: its alert counts as read. If this phone hasn't
      // built that alert yet, sync and mark it once it's there.
      if (p && !markReadForPush(p))
        checkForAlerts()
          .then(() => markReadForPush(p))
          .catch(() => {});
      const route = routeForPush(p);
      if (!route) return;
      // The route union matches RootStackParamList entries one to one.
      (navigation.navigate as (name: string, params?: object) => void)(
        route.name,
        'params' in route ? route.params : undefined,
      );
    };
    let alive = true;
    push
      .getInitialOpen()
      .then(p => alive && open(p))
      .catch(() => {});
    const off = push.onOpened(open);
    return () => {
      alive = false;
      off();
    };
  }, [navigation]);
}
