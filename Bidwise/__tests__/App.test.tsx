/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders the sign-in screen', async () => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    r = ReactTestRenderer.create(<App mode="demo" />);
  });
  expect(JSON.stringify(r.toJSON())).toContain('Sign in to workspace');
});
