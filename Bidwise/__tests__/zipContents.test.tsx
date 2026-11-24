import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ZipContentsScreen } from '../src/app/screens/ZipContentsScreen';
import { DocsContext, type DocsSource } from '../src/data/docs';
import { ThemeProvider } from '../src/theme';

// A ZIP that won't open (saved while the portal's CAPTCHA went unsolved) offers a
// re-download of all the tender's documents instead of a dead end.

const Stack = createNativeStackNavigator();

type Zip = ReturnType<DocsSource['useZip']>;
const base: Zip = {
  entries: [],
  loading: false,
  error: null,
  broken: false,
  job: false,
  jobError: null,
  redownload: async () => 'Fresh copies requested from the portal',
};

async function render(zip: Partial<Zip>) {
  const source = {
    useZip: () => ({ ...base, ...zip }),
    openFile: async () => {},
  } as unknown as DocsSource;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <ThemeProvider>
          <DocsContext.Provider value={source}>
            <NavigationContainer>
              <Stack.Navigator>
                <Stack.Screen
                  name="ZipContents"
                  component={ZipContentsScreen}
                  initialParams={{ docId: '7', name: 'Tender.zip' }}
                />
              </Stack.Navigator>
            </NavigationContainer>
          </DocsContext.Provider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

const text = (tree: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());
const button = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      /Re-download all documents/.test(String(n.props.accessibilityLabel)),
  )[0];

describe('ZIP that won’t open', () => {
  it('explains it and re-downloads all the documents', async () => {
    const redownload = jest.fn(async () => 'Fresh copies requested from the portal');
    const tree = await render({
      broken: true,
      error: 'This ZIP didn’t download properly.',
      redownload,
    });
    expect(text(tree)).toContain('This ZIP didn’t download properly');
    expect(text(tree)).not.toContain('Couldn’t load');
    await ReactTestRenderer.act(async () => {
      button(tree).props.onPress();
    });
    expect(redownload).toHaveBeenCalledTimes(1);
  });

  it('says why the last re-download failed', async () => {
    const tree = await render({
      broken: true,
      jobError: 'the portal CAPTCHA was not solved',
    });
    expect(text(tree)).toContain('the portal CAPTCHA was not solved');
    expect(button(tree)).toBeDefined();
  });

  it('shows progress while fresh copies are fetched', async () => {
    const tree = await render({ loading: true, job: true });
    expect(button(tree)).toBeUndefined();
    expect(text(tree)).toContain('Fetching fresh copies from the portal');
  });

  it('offers no re-download when the ZIP simply isn’t on the device', async () => {
    const tree = await render({ error: 'Download the ZIP first.' });
    expect(button(tree)).toBeUndefined();
    expect(text(tree)).toContain('Download the ZIP first.');
  });
});
