import React from 'react';
import ReactTestRenderer, {
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../App';

const textOf = (r: Renderer) => JSON.stringify(r.toJSON());

async function mount() {
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<App />);
  });
  return r;
}

describe('Dashboard', () => {
  it('shows the initials tile, title, and all sections', async () => {
    const r = await mount();
    const out = textOf(r);
    [
      'RI',
      'Dashboard',
      'Rakshit Infra',
      'Needs attention',
      'Tenders synced',
      'Active projects',
      'Orgs',
      'Closing this week',
      'Pipeline Snapshot',
      'Across bookmarked tenders',
      'NEXT DEADLINE',
      'Closing soon',
      'Sync tenders',
      'Sync now',
      'Upcoming deadlines',
      'CRITICAL',
      'SOON',
    ].forEach(s => expect(out).toContain(s));
  });

  it('has five tabs including Alerts', async () => {
    const r = await mount();
    const tabs = r.root.findAll(
      n => typeof n.type === 'string' && n.props.accessibilityRole === 'tab',
    );
    expect(tabs.map(t => t.props.accessibilityLabel)).toEqual([
      'Dashboard',
      'Tenders',
      'Projects',
      'Alerts',
      'More',
    ]);
  });

  it('opens the Alerts tab from the bell and clears unread', async () => {
    const r = await mount();
    const bell = r.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Alerts' &&
        n.props.accessibilityRole === 'button' &&
        typeof n.props.onPress === 'function',
    )[0];
    await ReactTestRenderer.act(async () => {
      bell.props.onPress();
    });
    expect(textOf(r)).toContain('3 unread');

    const markAll = r.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Mark all read' &&
        typeof n.props.onPress === 'function',
    )[0];
    await ReactTestRenderer.act(async () => {
      markAll.props.onPress();
    });
    expect(textOf(r)).not.toContain('3 unread');
    expect(textOf(r)).toContain('Deadlines and recent changes');
  });
});
