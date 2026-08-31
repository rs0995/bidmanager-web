import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SOURCE_DIR = Path(__file__).resolve().parent


class SavedCustomJobTests(unittest.TestCase):
    def test_named_job_crud_manual_run_and_interval(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-saved-job-") as tmp:
            root = Path(tmp)
            for source in SOURCE_DIR.glob("*.py"):
                if not source.name.startswith("test_"):
                    shutil.copy2(source, root / source.name)
            env = os.environ.copy()
            for key in ("K_SERVICE", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING"):
                env.pop(key, None)
            env["BIDMANAGER_ENV"] = "local"
            result = subprocess.run(
                [sys.executable, "-c", textwrap.dedent("""
                    import time
                    import api_server as api
                    api._scheduler_stop.set()
                    if getattr(api, "_scheduler_thread", None):
                        api._scheduler_thread.join(timeout=10)
                    with api.get_db() as conn:
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url) VALUES (1,'Org A',1,'https://example.test')"
                        )
                        org_id = conn.execute("SELECT id FROM organizations WHERE name='Org A'").fetchone()[0]
                        conn.execute("INSERT INTO websites (name,url,status_url) VALUES ('Portal B','https://b.example','')")
                        website_b = conn.execute("SELECT id FROM websites WHERE name='Portal B'").fetchone()[0]
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url) VALUES (?,'Org B',1,'https://b.example/tenders')",
                            (website_b,),
                        )
                        org_b = conn.execute("SELECT id FROM organizations WHERE name='Org B'").fetchone()[0]
                        conn.execute("INSERT INTO tenders (website_id,org_chain,tender_id,title) VALUES (1,'Org A','T-A','Tender A')")
                        tender_a = conn.execute("SELECT id FROM tenders WHERE tender_id='T-A'").fetchone()[0]
                        conn.execute("INSERT INTO tenders (website_id,org_chain,tender_id,title) VALUES (?,'Org B','T-B','Tender B')", (website_b,))
                        tender_b = conn.execute("SELECT id FROM tenders WHERE tender_id='T-B'").fetchone()[0]
                        conn.commit()

                    created = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Alice', name='Morning scrape', website_id=1,
                        job_type='scrape', org_ids=[org_id], schedule_enabled=False,
                    ), None)
                    saved_id = created['id']
                    listed = api.list_saved_custom_jobs('Alice', None)['jobs']
                    assert len(listed) == 1 and listed[0]['name'] == 'Morning scrape'

                    captured = []
                    original_enqueue = api._enqueue_job
                    def fake_enqueue(action, payload=None):
                        captured.append((action, payload))
                        return {'job_id':f'manual-{len(captured)}','status':'queued','created':True}
                    api._enqueue_job = fake_enqueue
                    queued = api.run_saved_custom_job(saved_id, 'Alice', None)
                    assert queued['job_id'] == 'manual-1'
                    assert captured[0][0] == 'fetch_tenders_selected'
                    assert captured[0][1]['org_ids'] == [org_id]

                    api.update_saved_custom_job(saved_id, api.SavedCustomJobRequest(
                        owner_name='Alice', name='Morning scrape', website_id=1,
                        job_type='scrape', org_ids=[org_id], schedule_enabled=True,
                        interval_minutes=30,
                    ), None)
                    updated = api.list_saved_custom_jobs('Alice', None)['jobs'][0]
                    assert updated['schedule_enabled'] is True
                    assert updated['schedule_mode'] == 'interval'
                    assert updated['interval_minutes'] == 30 and updated['next_run_at'] > 0
                    assert updated['last_job_id'] == 'manual-1'
                    scheduled_next = updated['next_run_at']
                    before_manual = time.time()
                    api.run_saved_custom_job(saved_id, 'Alice', None)
                    after_manual_run = next(
                        job for job in api.list_saved_custom_jobs('Alice', None)['jobs'] if job['id'] == saved_id
                    )
                    # A hand-run of an interval job restarts its clock from now.
                    assert after_manual_run['next_run_at'] != scheduled_next
                    assert abs(after_manual_run['next_run_at'] - (before_manual + 30 * 60)) < 5

                    once_at = time.time() + 120
                    once = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Alice', name='One scheduled scrape', website_id=1,
                        job_type='scrape', org_ids=[org_id], schedule_mode='once',
                        schedule_enabled=True, scheduled_for_at=once_at,
                    ), None)
                    once_job = next(
                        job for job in api.list_saved_custom_jobs('Alice', None)['jobs'] if job['id'] == once['id']
                    )
                    assert once_job['schedule_mode'] == 'once'
                    assert once_job['schedule_enabled'] is True
                    assert abs(once_job['next_run_at'] - once_at) < 1
                    with api.get_db() as conn:
                        conn.execute('UPDATE saved_custom_jobs SET next_run_at=? WHERE id=?', (time.time() - 1, once['id']))
                        conn.commit()
                    original_saved_scheduler_enabled = api._saved_job_scheduler_enabled
                    original_claim_lease = api._claim_scheduler_lease
                    api._saved_job_scheduler_enabled = lambda: True
                    api._claim_scheduler_lease = lambda *args, **kwargs: True
                    assert api._run_consolidated_scrape_pass() == 1
                    api._saved_job_scheduler_enabled = original_saved_scheduler_enabled
                    api._claim_scheduler_lease = original_claim_lease
                    completed_once = next(
                        job for job in api.list_saved_custom_jobs('Alice', None)['jobs'] if job['id'] == once['id']
                    )
                    assert completed_once['schedule_enabled'] is False
                    assert completed_once['next_run_at'] == 0

                    cross = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Alice', name='Cross portal download', website_id=1,
                        job_type='download', tender_ids=[tender_a, tender_b],
                        download_mode='update', schedule_enabled=False,
                    ), None)
                    assert api._job_dedupe_key('fetch_tenders_selected', {
                        'saved_custom_job_id': cross['id'], 'website_id': 1,
                    }) != api._job_dedupe_key('fetch_tenders_selected', {
                        'saved_custom_job_id': cross['id'], 'website_id': website_b,
                    })
                    cross_start = len(captured)
                    cross_run = api.run_saved_custom_job(cross['id'], 'Alice', None)
                    assert cross_run['queued_count'] == 2
                    assert [item[0] for item in captured[cross_start:]] == [
                        'download_tenders', 'download_tenders',
                    ]
                    assert {item[1]['website_id'] for item in captured[cross_start:]} == {1, website_b}
                    assert all(item[1].get('include_all') is False for item in captured[cross_start:])

                    calls = []
                    api.core.ScraperBackend.fetch_tenders_logic = staticmethod(
                        lambda website_id, org_ids=None: calls.append(('scrape', website_id, org_ids)) or True
                    )
                    api.core.ScraperBackend.download_tenders_logic = staticmethod(
                        lambda website_id, target_db_ids=None, forced_mode=None, include_all=False:
                            calls.append(('download', website_id, target_db_ids, forced_mode)) or True
                    )
                    api._job_callable('refresh_and_download_tenders', {
                        'website_id': 1, 'target_db_ids': [tender_a], 'mode': 'update',
                    })
                    assert calls == [
                        ('scrape', 1, [org_id]),
                        ('download', 1, [tender_a], 'update'),
                    ], calls

                    repeat_at = time.time() + 300
                    repeating = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Alice', name='Anchored repeat', website_id=1,
                        job_type='scrape', org_ids=[org_id], schedule_mode='interval',
                        schedule_enabled=True, scheduled_for_at=repeat_at, interval_minutes=120,
                    ), None)
                    repeating_before = next(
                        job for job in api.list_saved_custom_jobs('Alice', None)['jobs']
                        if job['id'] == repeating['id']
                    )
                    assert abs(repeating_before['next_run_at'] - repeat_at) < 1
                    api._enqueue_saved_custom_job(repeating['id'], scheduled_trigger=True)
                    repeating_after = next(
                        job for job in api.list_saved_custom_jobs('Alice', None)['jobs']
                        if job['id'] == repeating['id']
                    )
                    assert abs(repeating_after['next_run_at'] - (repeat_at + 120 * 60)) < 1

                    try:
                        api.create_saved_custom_job(api.SavedCustomJobRequest(
                            owner_name='Alice', name='Old both', website_id=1,
                            job_type='both', org_ids=[org_id], tender_ids=[tender_a],
                        ), None)
                        raise AssertionError('both job type should be rejected')
                    except api.HTTPException as exc:
                        assert exc.status_code == 400

                    # Ids auto-compact on every delete, so re-read the list each time.
                    while True:
                        jobs = api.list_saved_custom_jobs('Alice', None)['jobs']
                        if not jobs:
                            break
                        api.delete_saved_custom_job(jobs[0]['id'], 'Alice', None)
                    assert api.list_saved_custom_jobs('Alice', None)['jobs'] == []
                    api._enqueue_job = original_enqueue
                    api._job_executor.shutdown(wait=True, cancel_futures=True)
                """)],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_consolidated_pass_merges_sources_and_protects_uncovered_saved_jobs(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-consolidated-") as tmp:
            root = Path(tmp)
            for source in SOURCE_DIR.glob("*.py"):
                if not source.name.startswith("test_"):
                    shutil.copy2(source, root / source.name)
            env = os.environ.copy()
            for key in ("K_SERVICE", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING"):
                env.pop(key, None)
            env["BIDMANAGER_ENV"] = "local"
            result = subprocess.run(
                [sys.executable, "-c", textwrap.dedent("""
                    import time
                    import api_server as api
                    api._scheduler_stop.set()
                    if getattr(api, "_scheduler_thread", None):
                        api._scheduler_thread.join(timeout=10)
                    now = time.time()
                    with api.get_db() as conn:
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url) "
                            "VALUES (1,'Org A',1,'https://example.test/a')"
                        )
                        org_a = conn.execute("SELECT id FROM organizations WHERE name='Org A'").fetchone()[0]
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url) "
                            "VALUES (1,'Org B',1,'https://example.test/b')"
                        )
                        org_b = conn.execute("SELECT id FROM organizations WHERE name='Org B'").fetchone()[0]
                        # A bookmark-driven due tender (one user's bookmark) pointing at Org A.
                        conn.execute(
                            "INSERT INTO tenders (website_id,org_chain,tender_id,title,"
                            "scrape_enabled,scrape_interval_minutes,next_scrape_at) "
                            "VALUES (1,'Org A','T-A','Tender A',1,180,?)",
                            (now - 1,),
                        )
                        conn.commit()

                    # A saved custom job — a second, independent "user" — targeting Org B.
                    saved = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Bob', name='Bob scrape', website_id=1,
                        job_type='scrape', org_ids=[org_b], schedule_enabled=True,
                        schedule_mode='interval', interval_minutes=60,
                    ), None)
                    saved_id = saved['id']
                    with api.get_db() as conn:
                        conn.execute('UPDATE saved_custom_jobs SET next_run_at=? WHERE id=?', (now - 1, saved_id))
                        conn.commit()

                    def next_run_at():
                        with api.get_db() as conn:
                            return conn.execute(
                                'SELECT next_run_at FROM saved_custom_jobs WHERE id=?', (saved_id,)
                            ).fetchone()[0]

                    api._scheduler_enabled = lambda: True
                    api._saved_job_scheduler_enabled = lambda: True
                    api._claim_scheduler_lease = lambda *a, **k: True

                    # Tick 1: a fresh job — both the bookmark-driven tender's org (A) and
                    # the saved job's org (B) must land in ONE merged enqueue call.
                    captured = []
                    def fake_enqueue_created(action, payload=None):
                        captured.append((action, dict(payload or {})))
                        return {'job_id': 'job-1', 'status': 'queued', 'created': True}
                    api._enqueue_job = fake_enqueue_created

                    queued = api._run_consolidated_scrape_pass()
                    assert queued == 1, queued
                    assert len(captured) == 1, captured
                    action, payload = captured[0]
                    assert action == 'fetch_tenders_selected', action
                    assert payload['website_id'] == 1
                    assert sorted(payload['org_ids']) == sorted([org_a, org_b]), payload['org_ids']
                    assert payload['source'] == 'consolidated-schedule'
                    assert next_run_at() > now

                    # Tick 2: the saved job is due again, but this time the merged
                    # enqueue resolves to an already in-flight job from a previous
                    # tick (created=False) — its own org was NOT necessarily in that
                    # job's payload, so it must NOT be credited/advanced.
                    with api.get_db() as conn:
                        conn.execute('UPDATE saved_custom_jobs SET next_run_at=? WHERE id=?', (now - 1, saved_id))
                        conn.commit()
                    stale_marker = next_run_at()
                    assert stale_marker == now - 1

                    captured.clear()
                    def fake_enqueue_collapsed(action, payload=None):
                        captured.append((action, dict(payload or {})))
                        return {'job_id': 'already-running-job', 'status': 'running', 'created': False}
                    api._enqueue_job = fake_enqueue_collapsed

                    queued_again = api._run_consolidated_scrape_pass()
                    assert queued_again == 0, queued_again
                    assert next_run_at() == stale_marker  # unchanged: not falsely credited

                    api.delete_saved_custom_job(saved_id, 'Bob', None)
                """)],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_whole_website_job_does_not_swallow_an_explicitly_due_org(self):
        # A "whole website" saved job refreshes the organization list only
        # (fetch_organisations). It must not suppress an explicitly-due
        # per-org tender scrape queued for the same website in the same tick.
        with tempfile.TemporaryDirectory(prefix="bidmanager-wildcard-") as tmp:
            root = Path(tmp)
            for source in SOURCE_DIR.glob("*.py"):
                if not source.name.startswith("test_"):
                    shutil.copy2(source, root / source.name)
            env = os.environ.copy()
            for key in ("K_SERVICE", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING"):
                env.pop(key, None)
            env["BIDMANAGER_ENV"] = "local"
            result = subprocess.run(
                [sys.executable, "-c", textwrap.dedent("""
                    import time
                    import api_server as api
                    api._scheduler_stop.set()
                    if getattr(api, "_scheduler_thread", None):
                        api._scheduler_thread.join(timeout=10)
                    now = time.time()
                    with api.get_db() as conn:
                        # Org A is NOT is_selected — matches the production
                        # case where the wildcard job's own coverage is empty.
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url,is_selected) "
                            "VALUES (1,'Org A',1,'https://example.test/a',0)"
                        )
                        org_a = conn.execute("SELECT id FROM organizations WHERE name='Org A'").fetchone()[0]
                        conn.commit()

                    wildcard = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Carol', name='Whole-site scrape', website_id=1,
                        job_type='scrape', all_organizations=True, schedule_enabled=True,
                        schedule_mode='interval', interval_minutes=60,
                    ), None)
                    explicit = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Dave', name='Just Org A', website_id=1,
                        job_type='scrape', org_ids=[org_a], schedule_enabled=True,
                        schedule_mode='interval', interval_minutes=60,
                    ), None)
                    with api.get_db() as conn:
                        conn.execute(
                            'UPDATE saved_custom_jobs SET next_run_at=? WHERE id IN (?,?)',
                            (now - 1, wildcard['id'], explicit['id']),
                        )
                        conn.commit()

                    captured = []
                    def fake_enqueue(action, payload=None):
                        captured.append((action, dict(payload or {})))
                        return {'job_id': 'merged-job', 'status': 'queued', 'created': True}
                    api._enqueue_job = fake_enqueue
                    api._scheduler_enabled = lambda: True
                    api._saved_job_scheduler_enabled = lambda: True
                    api._claim_scheduler_lease = lambda *a, **k: True

                    queued = api._run_consolidated_scrape_pass()
                    assert queued == 2, queued
                    assert len(captured) == 2, captured
                    by_action = {action: payload for action, payload in captured}
                    # Whole-website job -> org-list refresh only.
                    assert 'fetch_organisations' in by_action, captured
                    assert by_action['fetch_organisations']['website_id'] == 1
                    # Explicitly-due Org A job still runs its own tender scrape.
                    assert 'fetch_tenders_selected' in by_action, captured
                    assert by_action['fetch_tenders_selected']['org_ids'] == [org_a], by_action['fetch_tenders_selected']['org_ids']

                    # Ids auto-compact on delete; re-resolve per owner.
                    for job_owner in ('Carol', 'Dave'):
                        for j in api.list_saved_custom_jobs(job_owner, None)['jobs']:
                            api.delete_saved_custom_job(j['id'], job_owner, None)
                """)],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_whole_website_job_refreshes_organisations_only(self):
        # A "whole website" saved scrape job enqueues a single
        # fetch_organisations for the website (refresh the org list + counts)
        # on both the manual-run and the scheduled/consolidated path — never a
        # per-org tender scrape fan-out.
        with tempfile.TemporaryDirectory(prefix="bidmanager-all-orgs-") as tmp:
            root = Path(tmp)
            for source in SOURCE_DIR.glob("*.py"):
                if not source.name.startswith("test_"):
                    shutil.copy2(source, root / source.name)
            env = os.environ.copy()
            for key in ("K_SERVICE", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING"):
                env.pop(key, None)
            env["BIDMANAGER_ENV"] = "local"
            result = subprocess.run(
                [sys.executable, "-c", textwrap.dedent("""
                    import time
                    import api_server as api
                    api._scheduler_stop.set()
                    if getattr(api, "_scheduler_thread", None):
                        api._scheduler_thread.join(timeout=10)
                    with api.get_db() as conn:
                        # None of these are is_selected=1 — matches the
                        # common production case for a brand-new website.
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url,is_selected) "
                            "VALUES (1,'Org X',1,'https://example.test/x',0)"
                        )
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url,is_selected) "
                            "VALUES (1,'Org Y',1,'https://example.test/y',0)"
                        )
                        org_ids = sorted(
                            row[0] for row in conn.execute(
                                "SELECT id FROM organizations WHERE website_id=1"
                            ).fetchall()
                        )
                        conn.commit()
                    assert len(org_ids) >= 2, org_ids

                    captured = []
                    def fake_enqueue(action, payload=None):
                        captured.append((action, dict(payload or {})))
                        return {'job_id': f'run-{len(captured)}', 'status': 'queued', 'created': True}
                    api._enqueue_job = fake_enqueue

                    # Manual run.
                    manual = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Erin', name='Whole-site scrape (manual)', website_id=1,
                        job_type='scrape', all_organizations=True, schedule_enabled=False,
                    ), None)
                    api.run_saved_custom_job(manual['id'], 'Erin', None)
                    assert len(captured) == 1, captured
                    action, payload = captured[0]
                    assert action == 'fetch_organisations', action
                    assert payload['website_id'] == 1, payload
                    assert 'org_ids' not in payload, payload
                    api.delete_saved_custom_job(manual['id'], 'Erin', None)
                    captured.clear()

                    # Scheduled run, alone (no other saved job due this tick).
                    scheduled = api.create_saved_custom_job(api.SavedCustomJobRequest(
                        owner_name='Frank', name='Whole-site scrape (scheduled)', website_id=1,
                        job_type='scrape', all_organizations=True, schedule_enabled=True,
                        schedule_mode='interval', interval_minutes=60,
                    ), None)
                    with api.get_db() as conn:
                        conn.execute('UPDATE saved_custom_jobs SET next_run_at=? WHERE id=?', (time.time() - 1, scheduled['id']))
                        conn.commit()
                    api._scheduler_enabled = lambda: True
                    api._saved_job_scheduler_enabled = lambda: True
                    api._claim_scheduler_lease = lambda *a, **k: True

                    queued = api._run_consolidated_scrape_pass()
                    assert queued == 1, queued
                    assert len(captured) == 1, captured
                    action, payload = captured[0]
                    assert action == 'fetch_organisations', action
                    assert payload['website_id'] == 1, payload
                    assert 'org_ids' not in payload, payload

                    api.delete_saved_custom_job(scheduled['id'], 'Frank', None)
                """)],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_ids_auto_renumber_on_create_and_delete(self):
        # No manual renumber step: deleting a middle job compacts ids to 1..N,
        # and the next create lands on the next low id.
        with tempfile.TemporaryDirectory(prefix="bidmanager-renumber-") as tmp:
            root = Path(tmp)
            for source in SOURCE_DIR.glob("*.py"):
                if not source.name.startswith("test_"):
                    shutil.copy2(source, root / source.name)
            env = os.environ.copy()
            for key in ("K_SERVICE", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING"):
                env.pop(key, None)
            env["BIDMANAGER_ENV"] = "local"
            result = subprocess.run(
                [sys.executable, "-c", textwrap.dedent("""
                    import api_server as api
                    api._scheduler_stop.set()
                    if getattr(api, "_scheduler_thread", None):
                        api._scheduler_thread.join(timeout=10)
                    with api.get_db() as conn:
                        conn.execute(
                            "INSERT INTO organizations (website_id,name,tender_count,tenders_url) "
                            "VALUES (1,'Org A',1,'https://example.test/a')"
                        )
                        org_id = conn.execute("SELECT id FROM organizations WHERE name='Org A'").fetchone()[0]
                        conn.commit()

                    def mk(name):
                        return api.create_saved_custom_job(api.SavedCustomJobRequest(
                            owner_name='Zed', name=name, website_id=1,
                            job_type='scrape', org_ids=[org_id], schedule_enabled=False,
                        ), None)['id']

                    a, b, c = mk('A'), mk('B'), mk('C')
                    assert [a, b, c] == [1, 2, 3], (a, b, c)

                    api.delete_saved_custom_job(b, 'Zed', None)
                    listed = sorted(api.list_saved_custom_jobs('Zed', None)['jobs'], key=lambda j: j['id'])
                    assert [(j['id'], j['name']) for j in listed] == [(1, 'A'), (2, 'C')], listed

                    d = mk('D')
                    assert d == 3, d

                    # Deleting the last job leaves ids already sequential -> no churn.
                    api.delete_saved_custom_job(d, 'Zed', None)
                    listed = sorted(api.list_saved_custom_jobs('Zed', None)['jobs'], key=lambda j: j['id'])
                    assert [(j['id'], j['name']) for j in listed] == [(1, 'A'), (2, 'C')], listed
                """)],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
