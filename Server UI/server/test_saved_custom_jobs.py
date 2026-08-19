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
                        return {'job_id':f'manual-{len(captured)}','status':'queued'}
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
                    api.run_saved_custom_job(saved_id, 'Alice', None)
                    after_manual_run = next(
                        job for job in api.list_saved_custom_jobs('Alice', None)['jobs'] if job['id'] == saved_id
                    )
                    assert after_manual_run['next_run_at'] == scheduled_next

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
                    assert api._queue_due_saved_custom_jobs() == 1
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
                        'refresh_and_download_tenders', 'refresh_and_download_tenders',
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

                    api.delete_saved_custom_job(saved_id, 'Alice', None)
                    api.delete_saved_custom_job(once['id'], 'Alice', None)
                    api.delete_saved_custom_job(cross['id'], 'Alice', None)
                    api.delete_saved_custom_job(repeating['id'], 'Alice', None)
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


if __name__ == "__main__":
    unittest.main()
