import {
  findProjectForTender,
  mergeFromServer,
  normRef,
} from '../src/lib/sharedProjects';

const project = (id: number, over: Record<string, unknown>) => ({
  id,
  title: `P${id}`,
  client_name: '',
  source_tender_id: '',
  source_tender_db_id: null,
  project_value: 0,
  emd: 0,
  deadline: null,
  prebid: null,
  status: 'Active',
  description: '',
  ...over,
});

beforeEach(() => {
  mergeFromServer(
    [
      project(1, { source_tender_db_id: 42, source_tender_id: '2026_PWD_42' }),
      project(2, { source_tender_id: ' 2026_mmrda_7 ' }),
      project(3, { source_tender_db_id: 55, status: 'Archived' }),
    ] as never,
    [],
  );
});

it('finds a tender by its server id', () => {
  expect(findProjectForTender(42)?.id).toBe(1);
  expect(findProjectForTender('42')?.id).toBe(1);
});

it('finds a project made elsewhere by its portal tender ID, ignoring case and spaces', () => {
  expect(normRef(' 2026_mmrda_7 ')).toBe('2026_MMRDA_7');
  expect(findProjectForTender(999, '2026_MMRDA_7')?.id).toBe(2);
});

it('counts archived projects too', () => {
  expect(findProjectForTender(55)?.status).toBe('Archived');
});

it('finds nothing for a new tender, and ignores empty ids', () => {
  expect(findProjectForTender(77, '2026_NEW_1')).toBeUndefined();
  expect(findProjectForTender('', '')).toBeUndefined();
  expect(findProjectForTender(null, undefined)).toBeUndefined();
});
