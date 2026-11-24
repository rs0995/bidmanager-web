import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  createNavigationContainerRef,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NewTendersScreen } from '../src/app/screens/NewTendersScreen';
import { AlertsContext, type AlertItem } from '../src/fixtures/alerts';
import { ThemeProvider } from '../src/theme';

// A "new tenders under ORG" alert with just one tender opens that tender, not a list.

const Stack = createNativeStackNavigator();
const Detail = () => <Text>detail</Text>;

async function open(alert: AlertItem) {
  const nav =
    createNavigationContainerRef<Record<string, object | undefined>>();
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <ThemeProvider>
          <AlertsContext.Provider
            value={{
              alerts: [alert],
              unread: 1,
              markRead: () => {},
              markAllRead: () => {},
              remindersOn: true,
              setRemindersOn: () => {},
            }}
          >
            <NavigationContainer ref={nav}>
              <Stack.Navigator>
                <Stack.Screen
                  name="NewTenders"
                  component={NewTendersScreen}
                  initialParams={{ alertId: alert.id }}
                />
                <Stack.Screen name="TenderDetail" component={Detail} />
              </Stack.Navigator>
            </NavigationContainer>
          </AlertsContext.Provider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return nav.getCurrentRoute();
}

const alert = (ids: string[]): AlertItem => ({
  id: 'a1',
  kind: 'new',
  message: 'New',
  time: 'now',
  unread: true,
  orgName: 'Municipal Corp. of Greater Mumbai',
  newTenderIds: ids,
});

describe('new tenders page', () => {
  it('opens a single new tender straight on its detail page', async () => {
    const route = await open(alert(['MCGM/RD/2024/1601']));
    expect(route?.name).toBe('TenderDetail');
    expect(route?.params).toEqual({ id: 'MCGM/RD/2024/1601' });
  });

  it('lists several new tenders', async () => {
    const route = await open(
      alert(['MCGM/RD/2024/1601', 'MCGM/SWD/2024/1567']),
    );
    expect(route?.name).toBe('NewTenders');
  });
});
