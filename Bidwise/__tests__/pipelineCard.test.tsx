import React from 'react';
import ReactTestRenderer, { ReactTestRenderer as Renderer } from 'react-test-renderer';
import { PipelineCard } from '../src/components/dashboard/PipelineCard';
import { ThemeProvider } from '../src/theme';

const text = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => [n.props.children].flat().join(''))
    .join(' ');

async function render(crores: number, activeCount: number) {
  const onViewPipeline = jest.fn();
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        <PipelineCard crores={crores} activeCount={activeCount} onViewPipeline={onViewPipeline} />
      </ThemeProvider>,
    );
  });
  return { r, onViewPipeline };
}

it('matches the reference: kicker, value, caption and footer, no ring', async () => {
  const { r, onViewPipeline } = await render(403.5, 3);
  const out = text(r);
  expect(out).toContain('ACTIVE BID PIPELINE');
  expect(out).toContain('₹403.50 Cr');
  expect(out).toContain('Total value of bids in preparation');
  expect(out).toContain('3 active projects');
  expect(out).toContain('View pipeline');
  expect(out).not.toContain('PREP');
  expect(out).not.toContain('Pipeline Snapshot');
  const view = r.root.findAll(n => n.props.accessibilityLabel === 'View pipeline' && n.props.onPress)[0];
  await ReactTestRenderer.act(async () => view.props.onPress());
  expect(onViewPipeline).toHaveBeenCalled();
});

it('says "1 active project" in the singular', async () => {
  const { r } = await render(12.4, 1);
  expect(text(r)).toContain('1 active project');
  expect(text(r)).not.toContain('1 active projects');
});
