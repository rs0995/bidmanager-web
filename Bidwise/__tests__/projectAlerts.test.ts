import { __resetKV } from '../src/lib/kv';
import { setSession } from '../src/lib/auth';
import { getAlerts, rehydrateAlerts } from '../src/lib/alerts';
import { rehydrateStore, setSettings } from '../src/lib/store';
import { checkNewProjects, noteOwnProject } from '../src/lib/projectAlerts';
import { reminderSummary } from '../src/app/screens/NotificationSettingsScreen';
import type { SharedProject } from '../src/lib/api';

// "New projects" (an Alerts-tab alert for projects someone else added) and the
// closing-reminder row's text.

const project = (id: number, title = `Project ${id}`, status = 'Active') =>
  ({ id, title, status } as SharedProject);

beforeEach(() => {
  __resetKV();
  rehydrateStore();
  rehydrateAlerts();
  setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
});

const projectAlerts = () => getAlerts().filter(a => a.kind === 'project');

it('the first pull only records what is there', () => {
  checkNewProjects([project(1), project(2)]);
  expect(projectAlerts()).toHaveLength(0);
});

it('alerts for a project someone else added, not for one made here', () => {
  checkNewProjects([project(1)]);
  noteOwnProject(2); // made on this phone
  checkNewProjects([project(1), project(2), project(3, 'Bridge repair')]);
  const alerts = projectAlerts();
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatchObject({
    message: '“Bridge repair” was added to Projects.',
    projectId: '3',
  });
  // Seen now: the next pull doesn't repeat it.
  checkNewProjects([project(1), project(2), project(3)]);
  expect(projectAlerts()).toHaveLength(1);
});

it('skips archived ones, and sums up many at once', () => {
  checkNewProjects([]);
  checkNewProjects([project(9, 'Old', 'Archived')]);
  expect(projectAlerts()).toHaveLength(0);
  checkNewProjects([project(10), project(11), project(12), project(13)]);
  expect(projectAlerts().map(a => a.message)).toEqual([
    '4 projects were added to Projects.',
  ]);
});

it('stays quiet when turned off, but still remembers them', () => {
  checkNewProjects([project(1)]);
  setSettings({ notifyProjectAlertsOn: false });
  checkNewProjects([project(1), project(2)]);
  setSettings({ notifyProjectAlertsOn: true });
  checkNewProjects([project(1), project(2)]);
  expect(projectAlerts()).toHaveLength(0);
});

it('words the closing-reminder choice', () => {
  expect(reminderSummary([])).toBe('Off');
  expect(reminderSummary([1])).toBe('1 day before');
  expect(reminderSummary([3, 1])).toBe('1 and 3 days before');
  expect(reminderSummary([1, 2, 5])).toBe('1, 2 and 5 days before');
});
