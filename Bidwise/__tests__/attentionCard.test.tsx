import React from 'react';
import ReactTestRenderer, { ReactTestRenderer as Renderer } from 'react-test-renderer';
import { NextDeadlineCard } from '../src/components/dashboard/NextDeadlineCard';
import { ThemeProvider } from '../src/theme';
import { tenders } from '../src/fixtures/tenders';
import type { AttentionItem } from '../src/lib/attention';

const text = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => [n.props.children].flat().join(''))
    .join(' ');

async function render(items: AttentionItem[], next = tenders[0]) {
  const onSeeMore = jest.fn();
  const onOpenItem = jest.fn();
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        <NextDeadlineCard
          items={items}
          next={next}
          onOpenItem={onOpenItem}
          onOpenTender={jest.fn()}
          onSeeMore={onSeeMore}
        />
      </ThemeProvider>,
    );
  });
  return { r, onSeeMore, onOpenItem };
}

const item = (i: number, level: 'crit' | 'soon' = 'crit'): AttentionItem => ({
  tender: tenders[i],
  level,
});

it('slides through the 3 most urgent and offers See more for the rest', async () => {
  const { r, onSeeMore } = await render([item(0), item(1), item(2, 'soon'), item(3, 'soon')]);
  const out = text(r);
  expect(out).toContain('NEEDS ATTENTION · 1 OF 4');
  expect(out).toContain('NEEDS ATTENTION · 3 OF 4');
  expect(out).not.toContain('4 OF 4');
  // No reason or portal pills on the slides (kept for screen readers only).
  expect(out).not.toContain('no documents yet');
  expect(out).not.toContain(tenders[0].portal);
  // The Closing soon bar is gone.
  expect(out).not.toContain('Closing soon');
  const more = r.root.findAll(
    n => n.props.accessibilityLabel === 'See all 4 tenders needing attention' && n.props.onPress,
  )[0];
  await ReactTestRenderer.act(async () => more.props.onPress());
  expect(onSeeMore).toHaveBeenCalled();
});

it('has no See more with 3 or fewer', async () => {
  const { r } = await render([item(0), item(1)]);
  expect(r.root.findAll(n => String(n.props.accessibilityLabel ?? '').startsWith('See all')).length).toBe(0);
});

it('shows the single next deadline when nothing needs attention', async () => {
  const { r } = await render([]);
  const out = text(r);
  expect(out).toContain('NEXT DEADLINE');
  expect(out).not.toContain('NEEDS ATTENTION');
});

it('fills the card: organisation and closing date under the title', async () => {
  const { r } = await render([item(0)]);
  const out = text(r);
  expect(out).toContain(tenders[0].org);
  expect(out).toContain(`Closes ${tenders[0].closing}`);
});
