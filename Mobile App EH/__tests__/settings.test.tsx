import React from 'react';
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../App';

const flat = (j: any): string =>
  j == null
    ? ''
    : typeof j === 'string'
    ? j
    : Array.isArray(j)
    ? j.map(flat).join(' ')
    : flat(j.children);
const screenText = (r: Renderer) => flat(r.toJSON());

async function mount() {
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<App />);
  });
  return r;
}

const safe = (r: Renderer, pred: (n: ReactTestInstance) => boolean) =>
  r.root.findAll(n => {
    try {
      return pred(n);
    } catch {
      return false; // unmounted navigation scenes throw when inspected
    }
  });

const byLabel = (r: Renderer, label: string, need = 'onPress') =>
  safe(
    r,
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props[need] === 'function',
  );

async function press(r: Renderer, label: string) {
  const node = byLabel(r, label).pop();
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
}

async function type(r: Renderer, label: string, text: string) {
  const node = byLabel(r, label, 'onChangeText').pop();
  if (!node) throw new Error(`No input labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onChangeText(text);
  });
}

// The tab screens stay mounted underneath: read from the pushed screen's title on.
const fromLast = (r: Renderer, marker: string) => {
  const all = screenText(r);
  return all.slice(all.lastIndexOf(marker));
};

const openMore = async (r: Renderer) => press(r, 'More');

describe('More', () => {
  it('lists Account, Colours & style and Deadline reminders, with no Bookmarks row', async () => {
    const r = await mount();
    await openMore(r);
    const s = fromLast(r, 'Account, appearance and reminders');
    [
      'Account',
      'APPEARANCE',
      'Colours & style',
      'Deadline reminders',
      'Downloads',
    ].forEach(x => expect(s).toContain(x));
    expect(byLabel(r, 'Bookmarks')).toHaveLength(0);
  });

  it('moved the deadline reminders toggle off the Alerts tab', async () => {
    const r = await mount();
    await press(r, 'Alerts');
    expect(screenText(r)).not.toContain('Notifications 72h');
    expect(byLabel(r, 'Deadline reminders')).toHaveLength(0);
    await openMore(r);
    const toggle = byLabel(r, 'Deadline reminders')[0];
    expect(toggle.props.accessibilityState.checked).toBe(true);
    await ReactTestRenderer.act(async () => {
      toggle.props.onPress();
    });
    expect(
      byLabel(r, 'Deadline reminders')[0].props.accessibilityState.checked,
    ).toBe(false);
  });

  it('shows Lock now only while app lock is on, and opens the lock screen', async () => {
    const r = await mount();
    await openMore(r);
    expect(byLabel(r, 'Lock now')).toHaveLength(0);
    await press(r, 'App lock');
    await press(r, 'Lock now');
    expect(fromLast(r, 'BidManager is locked')).toContain('Unlock');
  });

  it('clears the cache from a confirmation sheet', async () => {
    const r = await mount();
    await openMore(r);
    await press(r, 'Clear local cache');
    expect(screenText(r)).toContain('Clear local cache?');
    await press(r, 'Clear cache');
    expect(screenText(r)).toContain('Cache cleared');
  });
});

describe('Account', () => {
  it('shows a read-only email and validates the new password', async () => {
    const r = await mount();
    await openMore(r);
    await press(r, 'Account');
    expect(
      safe(r, n => n.props.accessibilityLabel === 'Email: you@rakshitinfra.com')
        .length,
    ).toBeGreaterThan(0);
    // The email is plain text, not an input.
    expect(
      byLabel(r, 'Email: you@rakshitinfra.com', 'onChangeText'),
    ).toHaveLength(0);
    await press(r, 'Change password');
    await press(r, 'Save password');
    expect(screenText(r)).toContain('Enter your current password');
    await type(r, 'Current password', 'old-password');
    await type(r, 'New password', 'short');
    await press(r, 'Save password');
    expect(screenText(r)).toContain('Use at least 8 characters');
    await type(r, 'New password', 'long-enough-1');
    await press(r, 'Save password');
    expect(screenText(r)).toContain('Password changed');
  });

  it('signs out to the sign-in screen, then signs back in', async () => {
    const r = await mount();
    await openMore(r);
    await press(r, 'Account');
    await press(r, 'Sign out');
    expect(screenText(r)).toContain('Sign in to continue');

    await press(r, 'Sign in');
    expect(screenText(r)).toContain('Enter a valid email');
    await type(r, 'Email', 'me@example.com');
    await type(r, 'Password', 'secret123');
    await press(r, 'Sign in');
    expect(screenText(r)).toContain('Dashboard');
  });

  it('switches to registration', async () => {
    const r = await mount();
    await openMore(r);
    await press(r, 'Account');
    await press(r, 'Sign out');
    await press(r, 'Do not have an account? Register');
    expect(screenText(r)).toContain('Create your account');
    expect(byLabel(r, 'Display name', 'onChangeText').length).toBeGreaterThan(
      0,
    );
  });
});

describe('Appearance', () => {
  it('changes the theme options live and reflects them on More', async () => {
    const r = await mount();
    await openMore(r);
    // Light / Dark / System sit on the More tab itself, not inside this screen.
    const more = fromLast(r, 'APPEARANCE');
    ['Dark', 'Light', 'System'].forEach(x => expect(more).toContain(x));
    await press(r, 'Colours & style');
    const s = fromLast(r, 'Accent');
    expect(s).toMatch(/Accent:\s+Orange/);
    expect(s).toMatch(/Base colour:\s+White/);
    // Nothing after the base name (no description of what it covers).
    expect(s).not.toContain('page, cards');
    ['Solid', 'Glass'].forEach(x => expect(s).toContain(x));
    expect(s).not.toContain('System');

    await press(r, 'Accent Emerald');
    expect(
      byLabel(r, 'Accent Emerald').pop()?.props.accessibilityState.selected,
    ).toBe(true);
    expect(fromLast(r, 'Accent')).toMatch(/Accent:\s+Emerald/);
    await press(r, 'Base Paper');
    expect(fromLast(r, 'Accent')).toMatch(/Base colour:\s+Paper/);

    // Glass hides the base colour options.
    await press(r, 'Glass style');
    expect(
      byLabel(r, 'Glass style').pop()?.props.accessibilityState.selected,
    ).toBe(true);
    expect(byLabel(r, 'Base White')).toHaveLength(0);
    expect(fromLast(r, 'Accent')).not.toContain('Base colour');

    await press(r, 'Solid style');
    expect(byLabel(r, 'Base White').length).toBeGreaterThan(0);
  });
});
