import React from 'react';
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BidPackScreen } from '../src/app/screens/BidPackScreen';
import { ToastProvider } from '../src/components/ui';
import { BidPackProvider } from '../src/data/bidPack';
import { checkCounts } from '../src/lib/bidPack';
import { demoBidPack } from '../src/fixtures/bidPack';
import { ThemeProvider } from '../src/theme';

// The bid pack page on the demo sample: summary, checks (gaps first), forms, sections.

const Stack = createNativeStackNavigator();

const textIn = (n: ReactTestInstance) =>
  n
    .findAll(c => (c.type as unknown) === 'Text')
    .map(c => [c.props.children].flat().join(''))
    .join(' ');

const pressText = async (r: Renderer, text: string) => {
  const hits = r.root.findAll(
    n => typeof n.type !== 'string' && typeof n.props.onPress === 'function' && textIn(n).includes(text),
  );
  await ReactTestRenderer.act(async () => {
    hits[hits.length - 1].props.onPress();
  });
};

async function mount() {
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <ThemeProvider>
          <ToastProvider>
            <BidPackProvider mode="demo">
              <NavigationContainer>
                <Stack.Navigator>
                  <Stack.Screen
                    name="BidPack"
                    component={BidPackScreen}
                    initialParams={{ tenderId: 'GMRC/MMI-2', title: 'MMI works' }}
                  />
                </Stack.Navigator>
              </NavigationContainer>
            </BidPackProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

describe('bid pack', () => {
  it('counts meets, gaps and items to review', () => {
    expect(checkCounts(demoBidPack.result!.compliance)).toEqual({ meets: 3, gaps: 1, review: 1 });
  });

  it('shows the checks with gaps first, then forms and sections', async () => {
    const r = await mount();
    let out = textIn(r.root);
    expect(out).toContain('Bid pack');
    expect(out).toContain('GMRC/MMI-2/SURAT/PH-1/2026');
    expect(out.indexOf('ISO certificates')).toBeLessThan(out.indexOf('Average Annual Turnover'));
    expect(out).toContain('Missing: ISO 45001');

    await pressText(r, 'Forms (4)');
    out = textIn(r.root);
    expect(out).toContain('Bid Forms Workbook');
    expect(out).toContain('ELI-1.1 · Bidder Information Form');

    await pressText(r, 'Sections');
    out = textIn(r.root);
    expect(out).toContain('Qualification & Evaluation Criteria');
    expect(out).toContain('Not found in the downloaded files');
    expect(out).toContain('Project Manager × 1');
  });
});
