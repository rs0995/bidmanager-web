import { classify } from '../src/lib/logs';
import { apiFetch, createApi } from '../src/lib/api';

const fetchMock = globalThis.fetch as unknown as jest.Mock;

test('sends the admin key and maps "completed" jobs to "done"', async () => {
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ jobs: [{ id: 'x', status: 'completed' }] }),
  }));
  const jobs = await createApi('https://srv.example', 'k1').jobs();
  expect(jobs[0].status).toBe('done');
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  expect(url).toBe('https://srv.example/admin/jobs');
  expect(init.headers['x-admin-key']).toBe('k1');
});

test("uses the server's detail as the error message", async () => {
  fetchMock.mockImplementationOnce(async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    text: async () => JSON.stringify({ detail: 'Queue is full' }),
  }));
  await expect(apiFetch('https://srv.example', 'k', '/admin/jobs/purge')).rejects.toThrow(
    'Queue is full',
  );
});

test('classifies log lines like the desktop', () => {
  expect(classify({ seq: 1, ts: 1, text: 'Traceback: boom' }).level).toBe('error');
  expect(classify({ seq: 2, ts: 1, text: 'captcha handed over' }).source).toBe('scraper');
  expect(classify({ seq: 3, ts: 1, text: 'upload done' }).source).toBe('storage');
});

test('deletes a website with DELETE /v1/websites/{id} and the admin key', async () => {
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true }),
  }));
  await createApi('https://srv.example', 'k2').deleteWebsite(7);
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  expect(url).toBe('https://srv.example/v1/websites/7');
  expect(init.method).toBe('DELETE');
  expect(init.headers['x-admin-key']).toBe('k2');
});

test('edits a website with PUT /v1/websites/{id}', async () => {
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ id: 3, name: 'New', url: 'https://n', status_url: '' }),
  }));
  const site = await createApi('https://srv.example', 'k3').updateWebsite(3, 'New', 'https://n', '');
  expect(site.name).toBe('New');
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  expect(url).toBe('https://srv.example/v1/websites/3');
  expect(init.method).toBe('PUT');
  expect(JSON.parse(init.body)).toEqual({ name: 'New', url: 'https://n', status_url: '' });
});

describe('organisation admin calls', () => {
  const ok = (body: unknown) =>
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }));
  const last = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const api = createApi('https://srv.example', 'k4');

  test('delink sends retain in the body', async () => {
    ok({ ok: true, retained: false });
    await api.delinkMember(3, 15, false);
    const [url, init] = last();
    expect(url).toBe('https://srv.example/admin/orgs/3/members/15/delink');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ retain: false });
  });

  test('dissolve passes retain as a query parameter', async () => {
    ok({ ok: true, members_released: 2, retained: true });
    await api.dissolveOrg(3, true);
    const [url, init] = last();
    expect(url).toBe('https://srv.example/admin/orgs/3?retain=true');
    expect(init.method).toBe('DELETE');
  });

  test('permissions are a partial update', async () => {
    ok({ user_id: 12, permissions: { active: true, archived: false, bookmarks: true, projects: true } });
    await api.setUserPermissions(12, { archived: false });
    const [url, init] = last();
    expect(url).toBe('https://srv.example/admin/users/12/permissions');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ archived: false });
  });

  test('an older server without organisations gives null, not an error', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({ detail: 'Not Found' }),
    }));
    await expect(api.orgs()).resolves.toBeNull();
  });
});
