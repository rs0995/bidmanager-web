/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('opens on the tabs when an admin key is saved', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  // Let the saved key load from the (mocked) keychain.
  for (let i = 0; i < 40 && !tree!.root.findAllByProps({ accessibilityRole: 'tab' }).length; i++) {
    await ReactTestRenderer.act(() => new Promise<void>(r => setTimeout(r, 25)));
  }
  const tabs = new Set(
    tree!.root
      .findAllByProps({ accessibilityRole: 'tab' })
      .map(n => n.props.accessibilityLabel),
  );
  expect([...tabs]).toEqual(['Server', 'Scraper', 'Users', 'Jobs', 'More']);
  await ReactTestRenderer.act(() => tree!.unmount());
});
