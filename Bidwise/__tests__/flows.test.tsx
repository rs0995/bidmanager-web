import React from 'react';
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../App';
import { initialBookmarks } from '../src/fixtures/tenders';

// The rendered tree as JSON: each element's type, style, label and text. Only those
// props are kept: FlatList hands its native view props that reference navigation
// objects, which can't be serialised.
type Json = ReturnType<Renderer['toJSON']> | string;
function slim(node: Json): unknown {
  if (node == null || typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(slim);
  return {
    type: node.type,
    props: {
      style: node.props.style,
      accessibilityLabel: node.props.accessibilityLabel,
    },
    children: node.children?.map(c => slim(c)) ?? null,
  };
}
const textOf = (r: Renderer) => JSON.stringify(slim(r.toJSON()));
// Visible text, with split children ("4", " unread") joined.
function screenText(r: Renderer) {
  return textIn(r.root);
}

async function mount(signedIn = true) {
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<App mode="demo" signedIn={signedIn} />);
  });
  return r;
}

const isPressable = (n: ReactTestInstance) =>
  typeof n.type !== 'string' && typeof n.props.onPress === 'function';

const pressable = (r: Renderer, label: string): ReactTestInstance => {
  const hit = r.root.findAll(
    n => isPressable(n) && n.props.accessibilityLabel === label,
  )[0];
  if (!hit) throw new Error(`No pressable labelled ${label}`);
  return hit;
};

function textIn(n: ReactTestInstance) {
  return n
    .findAll(c => (c.type as unknown) === 'Text')
    .map(c => [c.props.children].flat().join(''))
    .join(' ');
}

/** Innermost pressable whose visible text includes `text`. */
const byText = (
  r: Renderer,
  text: string,
  role?: string,
): ReactTestInstance => {
  const hits = r.root.findAll(
    n =>
      isPressable(n) &&
      (!role || n.props.accessibilityRole === role) &&
      textIn(n).includes(text),
  );
  const hit = hits[hits.length - 1];
  if (!hit) throw new Error(`No pressable with text ${text}`);
  return hit;
};

const press = async (node: ReactTestInstance) => {
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
};

/** The last pressable with this label (the screen on top of the stack). */
const last = (r: Renderer, label: string): ReactTestInstance => {
  const hits = r.root.findAll(
    n => isPressable(n) && n.props.accessibilityLabel === label,
  );
  if (!hits.length) throw new Error(`No pressable labelled ${label}`);
  return hits[hits.length - 1];
};

const tab = (r: Renderer, label: string) =>
  r.root.findAll(
    n =>
      isPressable(n) &&
      n.props.accessibilityRole === 'tab' &&
      n.props.accessibilityLabel === label,
  )[0];

describe('bidwise flows', () => {
  it('signs in and lands on the Mobile App EH dashboard', async () => {
    const r = await mount(false);
    expect(textOf(r)).toContain('Big bids.');
    await press(byText(r, 'Sign in to workspace', 'button'));
    const out = textOf(r);
    [
      'Dashboard',
      'NEEDS ATTENTION',
      'ACTIVE BID PIPELINE',
      'Upcoming deadlines',
    ].forEach(s => expect(out).toContain(s));
  });

  it('has an icon-only island with five tabs', async () => {
    const r = await mount();
    const tabs = r.root.findAll(
      n => typeof n.type === 'string' && n.props.accessibilityRole === 'tab',
    );
    expect(tabs.map(t => t.props.accessibilityLabel)).toEqual([
      'Overview',
      'Tenders',
      'Projects',
      'Alerts',
      'More',
    ]);
  });

  it('shows Organisations first and saves a tender with the star', async () => {
    const r = await mount();
    await press(tab(r, 'Tenders'));
    expect(textOf(r)).toContain('organisations');
    await press(byText(r, 'Tenders', 'tab'));
    const saved = () =>
      r.root.findAll(
        n => isPressable(n) && n.props.accessibilityLabel === 'Unsave tender',
      ).length;
    const before = saved();
    await press(pressable(r, 'Save tender'));
    expect(saved()).toBe(before + 1);
  });

  it('puts the portal above the sub tabs, a star square before search, and Sort and Filter below', async () => {
    const r = await mount();
    await press(tab(r, 'Tenders'));
    const order = r.root
      .findAll(isPressable)
      .map(n => n.props.accessibilityLabel);
    expect(order.indexOf('Portal: MahaTenders')).toBeGreaterThan(-1);
    expect(order.indexOf('Portal: MahaTenders')).toBeLessThan(
      order.indexOf('Bookmarked organisations only'),
    );
    const segs = r.root.findAll(
      n =>
        isPressable(n) &&
        n.props.accessibilityRole === 'tab' &&
        textIn(n) === 'Organisations',
    );
    expect(segs.length).toBe(1);
    expect(r.root.findAll(isPressable).indexOf(segs[0])).toBeGreaterThan(
      order.indexOf('Portal: MahaTenders'),
    );
    // No chips: the bookmarked filter is the star square, the rest are in Filter.
    let out = screenText(r);
    expect(out).not.toContain('Closing \u2264 5d');

    await press(byText(r, 'Tenders', 'tab'));
    out = screenText(r);
    expect(out).toContain('Closing soonest');
    const star = pressable(r, 'Bookmarked tenders only');
    expect(star.props.accessibilityState).toEqual({ selected: false });
    await press(star);
    expect(
      pressable(r, 'Bookmarked tenders only').props.accessibilityState,
    ).toEqual({
      selected: true,
    });
    await press(pressable(r, 'Bookmarked tenders only'));

    await press(pressable(r, 'Filters'));
    // Category and location are pick-lists; documents and closing-soon are gone.
    out = screenText(r);
    expect(out).not.toContain('Has documents');
    expect(out).not.toContain('Closing within 5 days');
    await press(pressable(r, 'Category: Any'));
    out = screenText(r);
    ['Works', 'Services', 'Goods'].forEach(c => expect(out).toContain(c));
    await press(byText(r, 'Services', 'menuitem'));
    expect(pressable(r, 'Category: Services')).toBeTruthy();
    await press(byText(r, 'Apply', 'button'));
    expect(pressable(r, 'Filters, 1 on')).toBeTruthy();
    expect(screenText(r)).toContain('Filter \u00b7 1');
    await press(pressable(r, 'Filters, 1 on'));
    await press(byText(r, 'Clear', 'button'));
    expect(pressable(r, 'Filters')).toBeTruthy();
  });

  it('starts a project from the first Ready for Bid item, then attaches and toggles', async () => {
    const r = await mount();
    await press(tab(r, 'Tenders'));
    await press(byText(r, 'Tenders', 'tab'));
    // One portal at a time: switch to eProcure through the dropdown.
    expect(screenText(r)).not.toContain('All portals');
    await press(pressable(r, 'Portal: MahaTenders'));
    await press(pressable(r, 'eProcure'));
    expect(screenText(r)).toContain('3 tenders');
    // Rows: amount after the location, star next to the days-left badge.
    expect(textOf(r)).toContain('"₹7.10 Cr"');
    expect(screenText(r)).not.toContain('Mumbai · Maintenance');
    // The HVAC & DG AMC tender (eProcure) has no project yet.
    await press(
      pressable(
        r,
        'HVAC & DG AMC, CGO complex, Central Public Works Department',
      ),
    );
    let out = screenText(r);
    expect(out).toContain('Tender details');
    expect(out).toContain('Tender Docs');
    expect(out).toContain('Docs for Preparation');
    // As in BM Pro: no starter checklist.
    expect(out).toContain('No items yet');
    expect(out).toContain('Add to Projects');
    // BM Pro's full-width Bookmark button.
    expect(out).toContain('Bookmark');
    await press(last(r, 'Save tender'));
    expect(screenText(r)).toContain('Bookmarked');
    await press(last(r, 'Unsave tender'));

    const input = r.root.findAll(
      n =>
        n.props.accessibilityLabel === 'New checklist item' &&
        n.props.onChangeText,
    )[0];
    await ReactTestRenderer.act(async () => {
      input.props.onChangeText('Site visit certificate');
    });
    await press(pressable(r, 'Add checklist item'));
    out = screenText(r);
    expect(out).toContain('“HVAC & DG AMC, CGO complex” added to Projects.');
    // BM Pro layout: once it's a project the middle button opens it.
    expect(out).toContain('View project');
    expect(out).toContain('0 of 1 ready');
    // A project's tender is bookmarked, and can't be un-bookmarked while it's a project.
    expect(out).toContain('Bookmarked');
    await press(last(r, 'Unsave tender'));
    out = screenText(r);
    expect(out).toContain('Bookmarked');
    expect(out).toContain(
      "Tenders in projects can't be removed from bookmarks. Remove the project first.",
    );

    // R3: tapping the checkbox marks it done, and again undoes it.
    await press(pressable(r, 'Site visit certificate ready'));
    expect(screenText(r)).toContain('1 of 1 ready');
    await press(pressable(r, 'Site visit certificate ready'));
    expect(screenText(r)).toContain('0 of 1 ready');

    // Attaching marks it ready; an attached item then offers Open / Replace / Remove.
    await press(pressable(r, 'Attach file to Site visit certificate'));
    expect(screenText(r)).toContain('1 of 1 ready');
    expect(
      r.root.findAll(
        n =>
          n.props.accessibilityLabel ===
          'Manage attachment for Site visit certificate',
      ).length,
    ).toBeGreaterThan(0);
    const open = r.root.findAll(
      n =>
        isPressable(n) &&
        String(n.props.accessibilityLabel ?? '').startsWith('Open '),
    );
    expect(open.length).toBeGreaterThan(0);
  });

  it('filters alerts and marks all read', async () => {
    const r = await mount();
    await press(tab(r, 'Alerts'));
    const unreadRows = () =>
      r.root.findAll(
        n =>
          isPressable(n) &&
          String(n.props.accessibilityLabel ?? '').startsWith('Unread.'),
      ).length;
    expect(unreadRows()).toBe(4);
    expect(screenText(r)).not.toContain('unread');
    expect(textOf(r)).toContain('TODAY');
    await press(byText(r, 'Mark all read', 'button'));
    expect(unreadRows()).toBe(0);
  });

  it('opens an organisation’s own page of tenders, as BM Pro', async () => {
    const r = await mount();
    await press(tab(r, 'Tenders'));
    // Whichever organisation is listed first (earlier tests may switch portal).
    const rows = r.root.findAll(
      n =>
        isPressable(n) &&
        / \d+ tenders?$/.test(String(n.props.accessibilityLabel ?? '')),
    );
    expect(rows.length).toBeGreaterThan(0);
    const label = String(rows[0].props.accessibilityLabel);
    const name = label.replace(/, \d+ tenders?$/, '');
    await press(rows[0]);
    // Its own page: the organisation as the title, with search and sort.
    const titles = r.root.findAll(
      n =>
        (n.type as unknown) === 'Text' &&
        [n.props.children].flat().join('') === name,
    );
    expect(titles.length).toBeGreaterThan(0);
    // The name on its band under the back button, and no sort label under it.
    expect(titles.some(n => n.props.numberOfLines === 3)).toBe(true);
    expect(screenText(r)).not.toContain('· Closing soonest');
    expect(pressable(r, 'Sort: Closing soonest')).toBeTruthy();
    const lists = r.root.findAll(
      n =>
        Array.isArray(n.props.data) &&
        n.props.ListHeaderComponent !== undefined,
    );
    const page = lists[lists.length - 1].props.data as { org: string }[];
    expect(page.length).toBeGreaterThan(0);
    expect(page.every(t => t.org === name)).toBe(true);
  });

  it('opens a new-tenders alert as a page of just those tenders, with search and sort', async () => {
    const r = await mount();
    await press(tab(r, 'Alerts'));
    await press(byText(r, '2 new tenders were added under'));
    let out = screenText(r);
    expect(out).toContain('Municipal Corp. of Greater Mumbai');
    expect(out).toContain('MCGM/RD/2024/1601');
    expect(out).toContain('Newest first');
    // EMD is one of the sorts, highest first.
    const page = r.root.findAll(n => Array.isArray(n.props.sorts));
    const keys = (page[page.length - 1].props.sorts as { key: string }[]).map(
      s => s.key,
    );
    expect(keys).toContain('emd');
    await ReactTestRenderer.act(async () => {
      page[page.length - 1].props.onSort('emd');
    });
    const byEmd = r.root.findAll(
      n =>
        Array.isArray(n.props.data) &&
        n.props.ListHeaderComponent !== undefined,
    );
    const order = (
      byEmd[byEmd.length - 1].props.data as { emd: string }[]
    ).map(x => x.emd);
    expect(order).toEqual(['₹16,20,000', '₹9,35,000']);
    // Search narrows the list.
    const search = r.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Search title or tender ID' &&
        n.props.onChangeText,
    )[0];
    await ReactTestRenderer.act(async () => {
      search.props.onChangeText('K-West');
      await new Promise(res => setTimeout(res, 350));
    });
    // The page's own list (other screens stay mounted underneath).
    const lists = r.root.findAll(
      n =>
        Array.isArray(n.props.data) &&
        n.props.ListHeaderComponent !== undefined,
    );
    const shown = (
      lists[lists.length - 1].props.data as { short: string }[]
    ).map(x => x.short);
    expect(shown).toEqual(['K-West storm-water drains']);
    // On to every tender of that organisation.
    await press(
      pressable(r, 'View all tenders from Municipal Corp. of Greater Mumbai'),
    );
    // The organisation page sorts by closing date.
    expect(pressable(r, 'Sort: Closing soonest')).toBeTruthy();
  });

  it('opens a new-tenders notification as that organisation’s newest alert', async () => {
    const r = await mount();
    // Screens get the navigator as a prop; go there as a notification tap would.
    const screen = r.root.findAll(n => n.props.navigation && n.props.route)[0];
    await ReactTestRenderer.act(async () => {
      screen.props.navigation.navigate('NewTenders', {
        org: 'Municipal Corp. of Greater Mumbai',
      });
    });
    const out = screenText(r);
    expect(out).toContain('2 new tenders');
    expect(out).toContain('resurfacing of arterial roads in P-North ward');
    expect(out).toContain('storm-water drains in K-West ward');
  });

  it('opens bookmarks on their own page from the Dashboard tile, as BM Pro', async () => {
    let r = await mount();
    const tile = (prefix: string) =>
      r.root.findAll(
        n =>
          isPressable(n) &&
          String(n.props.accessibilityLabel ?? '').startsWith(prefix),
      )[0];
    // The page's two lists (organisations, then tenders) are the last ones mounted.
    // (FlatList and its inner list share `data`: one entry per list.)
    const pageLists = () => {
      const seen = new Set<unknown>();
      return r.root
        .findAll(
          n =>
            Array.isArray(n.props.data) &&
            n.props.ListHeaderComponent !== undefined,
        )
        .filter(n => !seen.has(n.props.data) && seen.add(n.props.data))
        .slice(-2);
    };

    await press(tile('Bookmarked organisations:'));
    expect(screenText(r)).toContain('Bookmarks');
    expect(screenText(r)).toContain('1 organisation');
    const [orgList] = pageLists();
    expect((orgList.props.data as { name: string }[]).map(o => o.name)).toEqual(
      ['Maharashtra Jeevan Pradhikaran'],
    );
    expect(last(r, 'Sort: Most tenders')).toBeTruthy();

    // The tile's other half opens the same page on Tenders.
    r.unmount();
    r = await mount();
    await press(tile('Bookmarked tenders:'));
    const tenders = pageLists()[1].props.data as { id: string }[];
    expect(tenders.length).toBe(initialBookmarks.length);
    expect(tenders.every(x => initialBookmarks.includes(x.id))).toBe(true);
    expect(last(r, 'Sort: Closing soonest')).toBeTruthy();
    // Search narrows the bookmarked tenders.
    const field = r.root.findAll(
      n =>
        n.props.placeholder === 'Search bookmarked tenders' &&
        n.props.onChangeText,
    )[0];
    await ReactTestRenderer.act(async () => {
      field.props.onChangeText('zzzz-no-match');
    });
    // The search waits for typing to stop (300 ms) before filtering.
    await ReactTestRenderer.act(async () => {
      await new Promise(res => setTimeout(res, 350));
    });
    expect(pageLists()[1].props.data).toHaveLength(0);
    expect(screenText(r)).toContain('No tenders match your search.');
  });

  it('opens Closing this week as its own page of the bookmarked tenders it counts', async () => {
    const r = await mount();
    const tile = r.root.findAll(
      n =>
        isPressable(n) &&
        String(n.props.accessibilityLabel ?? '').startsWith(
          'Closing this week:',
        ),
    )[0];
    const count = Number(
      String(tile.props.accessibilityLabel).replace(/\D+/g, ''),
    );
    expect(count).toBeGreaterThan(0);
    await press(tile);
    expect(screenText(r)).toContain(
      `${count} bookmarked tender${count === 1 ? '' : 's'}`,
    );
    const lists = r.root.findAll(
      n =>
        Array.isArray(n.props.data) &&
        n.props.ListHeaderComponent !== undefined,
    );
    const page = lists[lists.length - 1].props.data as { id: string }[];
    expect(page).toHaveLength(count);
    expect(page.every(x => initialBookmarks.includes(x.id))).toBe(true);
    // Its own page: search and sort, not the Tenders tab's portal and filters.
    expect(last(r, 'Sort: Closing soonest')).toBeTruthy();
  });

  it('opens a tapped calendar day in a sheet, and resets to today on leaving the tab', async () => {
    const r = await mount();
    const day = (label: string) =>
      r.root.findAll(
        n => isPressable(n) && n.props.accessibilityLabel === label,
      )[0];
    expect(day('Tu 27, 0 closing').props.accessibilityState).toEqual({
      selected: true,
    });
    // An empty day only moves the tile: no sheet.
    const empty = r.root.findAll(
      n =>
        isPressable(n) &&
        / 0 closing$/.test(String(n.props.accessibilityLabel ?? '')) &&
        n.props.accessibilityLabel !== 'Tu 27, 0 closing',
    )[0];
    await press(empty);
    expect(empty.props.accessibilityState).toEqual({ selected: true });
    expect(screenText(r)).not.toContain('due');
    await press(day('Mo 26, 1 closing'));
    expect(day('Mo 26, 1 closing').props.accessibilityState).toEqual({
      selected: true,
    });
    let out = screenText(r);
    expect(out).toContain('Mon, 26 Aug');
    expect(out).toContain('1 tender due');
    // The day's tender opens from the sheet.
    await press(
      last(
        r,
        'Panvel–Uran road widening, Public Works Department, Konkan Region',
      ),
    );
    expect(screenText(r)).toContain('Tender details');
    await press(last(r, 'Back'));
    // Another tab and back: the tile is on today again and the sheet is gone.
    await press(tab(r, 'Alerts'));
    await press(tab(r, 'Overview'));
    expect(day('Tu 27, 0 closing').props.accessibilityState).toEqual({
      selected: true,
    });
    out = screenText(r);
    expect(out).not.toContain('1 tender due');
  });

  it('signs in from the button only, not from Return in the password field', async () => {
    const r = await mount(false);
    const password = r.root.findAll(
      n => n.props.label === 'Password' && n.props.onChangeText,
    )[0];
    expect(password.props.onSubmitEditing).toBeUndefined();
    expect(password.props.returnKeyType).toBe('done');
    await press(byText(r, 'Create an account'));
    const newPassword = r.root
      .findAll(n => n.props.label === 'Password' && n.props.onChangeText)
      .slice(-1)[0];
    expect(newPassword.props.onSubmitEditing).toBeUndefined();
  });

  it('tap and hold a checklist item: Delete item alone, or with the attachment options', async () => {
    const sheet = require('../src/platform/actionSheet');
    let offered: string[] = [];
    let pick = '';
    const spy = jest
      .spyOn(sheet, 'showActionSheet')
      .mockImplementation((...args: unknown[]) => {
        const opts = args[1] as { label: string; onPress: () => void }[];
        offered = opts.map(o => o.label);
        opts.find(o => o.label === pick)?.onPress();
      });
    const r = await mount();
    await press(tab(r, 'Projects'));
    await press(
      r.root.findAll(
        n =>
          isPressable(n) &&
          String(n.props.accessibilityLabel ?? '').startsWith(
            'Panvel–Uran road widening',
          ),
      )[0],
    );
    const items = () =>
      r.root.findAll(n => typeof n.props.onLongPress === 'function');
    const withFile = items().find(n =>
      String(n.props.accessibilityLabel).startsWith('Open '),
    )!;
    await ReactTestRenderer.act(async () => withFile.props.onLongPress());
    expect(offered).toEqual([
      'Open',
      'Replace file',
      'Remove attachment',
      'Delete item',
    ]);
    const before = items().length;
    const bare = items().find(
      n => !String(n.props.accessibilityLabel).startsWith('Open '),
    )!;
    const name = String(bare.props.accessibilityLabel);
    pick = 'Delete item';
    await ReactTestRenderer.act(async () => bare.props.onLongPress());
    expect(offered).toEqual(['Delete item']);
    expect(items().length).toBe(before - 1);
    expect(items().some(n => n.props.accessibilityLabel === name)).toBe(false);
    spy.mockRestore();
  });

  it('puts the archive button on the Projects title line, orders cards by closing, and shows the company letter', async () => {
    const r = await mount();
    // The Dashboard tile: the company's initial (Rakshit Infra).
    expect(
      r.root.findAll(
        n => (n.type as unknown) === 'Text' && n.props.children === 'R',
      ).length,
    ).toBeGreaterThan(0);
    await press(tab(r, 'Projects'));
    const archive = last(r, 'Archived projects');
    // Same row as the title.
    let row = archive.parent;
    while (row && !textIn(row).includes('Projects')) row = row.parent;
    expect(row && textIn(row)).toContain('Your bids, moving forward.');
    // Cards in closing order: their time-left pills run from soonest.
    const pills = r.root
      .findAll(
        n =>
          isPressable(n) &&
          / (\d+[dh]) left$/.test(String(n.props.accessibilityLabel ?? '')),
      )
      .map(n => String(n.props.accessibilityLabel).match(/(\d+)([dh]) left$/)!)
      .map(m => Number(m[1]) * (m[2] === 'd' ? 24 : 1));
    const unique = pills.filter(
      (_, i) => i % 2 === 0 || pills[i] !== pills[i - 1],
    );
    expect(unique.length).toBeGreaterThan(1);
    expect([...unique].sort((a, b) => a - b)).toEqual(unique);
  });

  it("switches accent and display in More's Theme row", async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    expect(screenText(r)).toContain('Accent colour');
    await press(pressable(r, 'Indigo'));
    expect(textOf(r)).toContain('#4f46c8');
    await press(byText(r, 'Liquid glass', 'tab'));
    expect(textOf(r)).toContain('rgba(255,255,255,0.62)');
    // Paper: BM Pro's own theme, so the accent choice goes away.
    await press(byText(r, 'Paper', 'tab'));
    expect(textOf(r)).toContain('#f2f1ec');
    expect(screenText(r)).not.toContain('Accent colour');
    await press(byText(r, 'Solid', 'tab'));
    expect(screenText(r)).toContain('Accent colour');
  });

  it('shows the four stat tiles', async () => {
    const r = await mount();
    const out = screenText(r);
    ['Tenders synced', 'Orgs', 'Active projects', 'Closing this week'].forEach(
      x => expect(out).toContain(x),
    );
  });

  it('has a Dark / Light / System Theme row under Connection, and colour circles without names', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    let out = screenText(r);
    expect(out.indexOf('Theme')).toBeGreaterThan(out.indexOf('Connection'));
    expect(out.indexOf('Theme')).toBeLessThan(out.indexOf('Archive'));
    await press(byText(r, 'Dark', 'tab'));
    expect(textOf(r)).toContain('#1b1d22');
    await press(byText(r, 'Light', 'tab'));
    // Display and accent sit in the same row; there is no Appearance row any more.
    expect(
      r.root.findAll(
        n => isPressable(n) && n.props.accessibilityLabel === 'Appearance',
      ),
    ).toHaveLength(0);
    out = screenText(r);
    expect(out).toContain('Display');
    expect(out).toContain('Accent colour');
    // Circles only: the names are for screen readers.
    expect(pressable(r, 'Orange')).toBeTruthy();
    expect(out).not.toContain('Orange');
  });

  it('keeps both Tenders lists mounted so switching sub tabs is instant', async () => {
    const r = await mount();
    await press(tab(r, 'Tenders'));
    const out = screenText(r);
    expect(out).toContain('organisations');
    expect(out).toContain('Closing soonest');
  });

  it('signs out from More', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    await press(byText(r, 'Sign out', 'button'));
    expect(textOf(r)).toContain('Sign in to workspace');
  });

  it('lists BM Pro More rows and opens Downloads', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    const out = screenText(r);
    [
      'Sync tenders',
      'Connection',
      'Archive',
      'Downloads',
      'Export tenders (CSV)',
      'Captcha',
      'App lock',
      'Push notifications',
      'Clear local cache',
      'Change password',
      'Theme',
      'Accent colour',
    ].forEach(s => expect(out).toContain(s));
    expect(out).not.toContain('Checklist templates');
    await press(pressable(r, 'Downloads'));
    expect(screenText(r)).toContain('Corrigendum I.pdf');
    expect(screenText(r)).toContain('2 in progress');
  });

  it('opens the clear-cache confirmation', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    await press(pressable(r, 'Clear local cache'));
    expect(screenText(r)).toContain('Clear local cache?');
  });

  it('lists closed tenders in Archive and opens one', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    await press(pressable(r, 'Archive'));
    let out = screenText(r);
    // Archive is scoped to one portal too; the last choice is remembered across screens.
    const picker = r.root.findAll(
      n =>
        isPressable(n) &&
        String(n.props.accessibilityLabel ?? '').startsWith('Portal: '),
    );
    await press(picker[picker.length - 1]);
    await press(pressable(r, 'MahaTenders'));
    out = screenText(r);
    expect(out).toContain('2 closed tenders');
    expect(out).toContain('Closed 19 Aug');
    await press(
      pressable(
        r,
        'Alibag–Revdanda road resurfacing, Public Works Department, Konkan Region',
      ),
    );
    out = screenText(r);
    expect(out).toContain('Tender details');
    expect(out).toContain('2024_PWD_1031188_1');
  });

  it('solves the waiting captcha and clears the More badge', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    expect(
      r.root.findAll(n => n.props.accessibilityLabel === 'Captcha waiting'),
    ).not.toHaveLength(0);
    await press(pressable(r, 'Captcha'));
    const input = r.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Enter the text shown above' &&
        n.props.onChangeText,
    )[0];
    await ReactTestRenderer.act(async () => {
      input.props.onChangeText('x7K2mq');
    });
    await press(pressable(r, 'Submit'));
    expect(screenText(r)).toContain('No CAPTCHA needs solving right now.');
  });

  it('shows push notification settings with closing reminders', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    await press(pressable(r, 'Push notifications'));
    let out = screenText(r);
    [
      'Notifications: Not set up',
      'Allow notifications',
      'Bookmarked organisations',
      'Bookmarked tenders',
      'New projects',
      'Closing reminders',
      '1 and 3 days before',
    ].forEach(x => expect(out).toContain(x));
    // One row, not a switch per day: the days are in its dropdown.
    expect(out).not.toContain('2 days before');
    await press(byText(r, 'Closing reminders'));
    out = screenText(r);
    ['1 day before', '2 days before', '3 days before', '5 days before'].forEach(
      x => expect(out).toContain(x),
    );
    await press(last(r, 'Remind 2 days before'));
    expect(screenText(r)).toContain('1, 2 and 3 days before');
  });

  it('shows the profile card first on More', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    const out = screenText(r);
    expect(out.indexOf('R. Shah')).toBeGreaterThan(-1);
    expect(out.indexOf('R. Shah')).toBeLessThan(
      out.indexOf('Sync & connection'),
    );
  });

  it('exports tenders of a picked organisation', async () => {
    const r = await mount();
    await press(tab(r, 'More'));
    await press(pressable(r, 'Export tenders (CSV)'));
    expect(screenText(r)).toContain('Bookmarked tenders');
    await press(pressable(r, 'Tenders of selected organisations'));
    expect(screenText(r)).toContain('Select at least one organisation.');
    await press(pressable(r, 'Maharashtra Jeevan Pradhikaran, MahaTenders'));
    expect(screenText(r)).toContain('1 organisation selected');
    await press(byText(r, 'Export CSV', 'button'));
    await ReactTestRenderer.act(async () => {
      await new Promise(res => setTimeout(res, 800));
    });
    expect(screenText(r)).toContain('2 tenders exported as CSV');
  });

  it("shows BM Pro's progress bar, archive next to sync, and the status switch last", async () => {
    const sheet = require('../src/platform/actionSheet');
    const spy = jest
      .spyOn(sheet, 'showActionSheet')
      .mockImplementation((...args: unknown[]) =>
        (args[1] as { onPress: () => void }[])[0].onPress(),
      );
    const r = await mount();
    await press(tab(r, 'Projects'));
    const open = r.root.findAll(
      n =>
        isPressable(n) &&
        String(n.props.accessibilityLabel ?? '').startsWith(
          'Panvel\u2013Uran road widening',
        ),
    )[0];
    await press(open);
    let out = screenText(r);
    expect(out).toContain('Project details');
    expect(out).toMatch(/\d+%/);
    expect(out.lastIndexOf('Preparing')).toBeGreaterThan(
      out.indexOf('Docs for Preparation'),
    );
    const labels = r.root
      .findAll(isPressable)
      .map(n => n.props.accessibilityLabel);
    // Each IconButton wrapper (unlabelled) and its Pressable both match: archive is next.
    expect(labels.indexOf('Archive project')).toBe(
      labels.lastIndexOf('Check for updates') + 2,
    );

    await press(last(r, 'Archive project'));
    out = screenText(r);
    expect(out).toContain('Project archived');
    expect(out).toContain('Active \u00b7 4');
    spy.mockRestore();
  });

  it('archives, restores and deletes projects from the archive box, as BM Pro', async () => {
    const sheet = require('../src/platform/actionSheet');
    const spy = jest
      .spyOn(sheet, 'showActionSheet')
      .mockImplementation((...args: unknown[]) =>
        (args[1] as { onPress: () => void }[])[0].onPress(),
      );
    const r = await mount();
    await press(tab(r, 'Projects'));
    const archiveOne = async () => {
      const open = r.root.findAll(
        n =>
          isPressable(n) &&
          String(n.props.accessibilityLabel ?? '').startsWith(
            'Panvel–Uran road widening',
          ),
      )[0];
      await press(open);
      await press(last(r, 'Archive project'));
    };

    await archiveOne();
    await press(last(r, 'Archived projects'));
    let out = screenText(r);
    expect(out).toContain('1 archived project');
    expect(out).toContain('Panvel–Uran road widening');

    // Restore: back to Active.
    await press(byText(r, 'Restore', 'button'));
    out = screenText(r);
    expect(out).toContain('Project restored to Active');
    expect(out).toContain('0 archived projects');
    expect(out).toContain('Active · 5');

    // Archive again, then delete for good.
    await press(last(r, 'Back'));
    await archiveOne();
    await press(last(r, 'Archived projects'));
    await press(byText(r, 'Delete', 'button'));
    out = screenText(r);
    expect(out).toContain('Project deleted');
    expect(out).toContain('0 archived projects');
    expect(out).toContain('Active · 4');
    spy.mockRestore();
  });

  it('splits Projects into Active and Submitted with time-left pills and tender IDs', async () => {
    const r = await mount();
    await press(tab(r, 'Projects'));
    let out = screenText(r);
    expect(out).toContain('Active · 5');
    expect(out).toContain('Submitted · 1');
    expect(out).not.toContain('Preparing');
    expect(out).not.toContain('Closed left');
    // Tender reference above the title; BM Pro-coloured time left.
    expect(out).toContain('2024_PWD_1043567_1');
    expect(out).toContain('2d left');
    await press(byText(r, 'Submitted · 1', 'tab'));
    out = screenText(r);
    expect(out).toContain('ZP Pune anganwadi buildings');
  });
});
