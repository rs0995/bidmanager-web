import { SECTIONS, sectionOn } from '../src/components/OrgPieces';

test('sections fall back to the server defaults', () => {
  // An account with NULL permissions (or an older server) sends nothing.
  expect(sectionOn(undefined, 'active')).toBe(true);
  expect(sectionOn(undefined, 'portal_search')).toBe(false);
  expect(sectionOn({ active: true }, 'portal_search')).toBe(false);
  // Explicit values always win.
  expect(sectionOn({ portal_search: true }, 'portal_search')).toBe(true);
  expect(sectionOn({ archived: false }, 'archived')).toBe(false);
});

test('there is a switch for portal search and none for captcha', () => {
  const keys = SECTIONS.map(s => s.key);
  expect(keys).toEqual(['active', 'archived', 'bookmarks', 'projects', 'portal_search']);
});
