import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SOURCE_DIR = Path(__file__).resolve().parent


class DurableJobRuntimeTests(unittest.TestCase):
    def _isolated_server_copy(self, root: Path) -> Path:
        for source in SOURCE_DIR.glob("*.py"):
            if source.name.startswith("test_"):
                continue
            shutil.copy2(source, root / source.name)
        return root

    def _run(self, root: Path, source: str) -> subprocess.CompletedProcess:
        env = os.environ.copy()
        for key in (
            "K_SERVICE",
            "DATABASE_URL",
            "POSTGRES_URL",
            "POSTGRES_CONNECTION_STRING",
            "GOOGLE_DRIVE_FOLDER_ID",
        ):
            env.pop(key, None)
        env["BIDMANAGER_ENV"] = "local"
        return subprocess.run(
            [sys.executable, "-c", textwrap.dedent(source)],
            cwd=root,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )

    def test_queue_cancel_retry_and_captcha_are_durable(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-job-test-") as tmp:
            root = self._isolated_server_copy(Path(tmp))
            result = self._run(
                root,
                """
                import time
                import api_server as api

                def wait_for(job_id, wanted, timeout=8):
                    deadline = time.time() + timeout
                    while time.time() < deadline:
                        with api._job_lock:
                            status = api._jobs[job_id]['status']
                        if status in wanted:
                            return status
                        time.sleep(0.05)
                    raise AssertionError((job_id, status, wanted))

                def cancellable(_website_id):
                    for _ in range(200):
                        api.core.check_job_cancelled()
                        time.sleep(0.02)
                    return True

                api.core.ScraperBackend.fetch_organisations_logic = staticmethod(cancellable)
                api._queue_limit = lambda: 1
                first = api._enqueue_job('fetch_organisations', {'website_id': 1})['job_id']
                assert wait_for(first, {'running'}) == 'running'
                try:
                    api._enqueue_job('fetch_organisations', {'website_id': 1})
                    raise AssertionError('queue limit was not enforced')
                except api.HTTPException as exc:
                    assert exc.status_code == 429
                api.admin_cancel_job(first, None)
                assert wait_for(first, {'cancelled'}) == 'cancelled'

                with api.get_db() as conn:
                    row = conn.execute(
                        'SELECT status,cancel_requested FROM background_jobs WHERE id=?',
                        (first,),
                    ).fetchone()
                assert row[0] == 'cancelled' and int(row[1]) == 1

                api.core.ScraperBackend.fetch_organisations_logic = staticmethod(lambda _website_id: True)
                api._queue_limit = lambda: 25
                retried = api.admin_retry_job(first, None)['job_id']
                assert wait_for(retried, {'completed'}) == 'completed'

                def captcha_job(_website_id):
                    answer = api.core.request_manual_captcha(
                        b'fake-png', context='Lifecycle test', timeout=5
                    )
                    return answer == 'ABCD'

                api.core.ScraperBackend.fetch_organisations_logic = staticmethod(captcha_job)
                cap_job = api._enqueue_job('fetch_organisations', {'website_id': 1})['job_id']
                deadline = time.time() + 5
                pending = None
                while time.time() < deadline and not pending:
                    pending = api.get_pending_captcha()
                    if not pending:
                        time.sleep(0.05)
                assert pending and pending['job_id'] == cap_job
                api.submit_captcha(
                    api.CaptchaSubmitRequest(request_id=pending['request_id'], text='ABCD')
                )
                assert wait_for(cap_job, {'completed'}) == 'completed'
                with api.get_db() as conn:
                    cap = conn.execute(
                        'SELECT status,response_text FROM captcha_requests WHERE id=?',
                        (pending['request_id'],),
                    ).fetchone()
                assert cap[0] == 'answered' and cap[1] == 'ABCD'
                api._job_executor.shutdown(wait=True, cancel_futures=True)
                """,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_queued_job_recovers_after_process_restart(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-recovery-test-") as tmp:
            root = self._isolated_server_copy(Path(tmp))
            first = self._run(
                root,
                """
                import time
                import api_server as api
                job_id = 'job_restart_recovery_test'
                job = {
                    'status':'queued', 'action':'archive_completed_tenders',
                    'payload':{'website_id':1}, 'result':None, 'error':'', 'logs':[],
                    'progress':0, 'created_at':time.time(), 'started_at':None,
                    'finished_at':None, 'heartbeat_at':time.time(),
                    'cancel_requested':False, 'attempt_count':0, 'worker_id':'',
                    'website_id':1, 'tender_id':None, 'mode':None,
                }
                with api._job_lock:
                    api._jobs[job_id] = job
                api._persist_job(job_id, job)
                api._job_executor.shutdown(wait=True, cancel_futures=True)
                """,
            )
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)

            second = self._run(
                root,
                """
                import time
                import api_server as api
                job_id = 'job_restart_recovery_test'
                deadline = time.time() + 8
                while time.time() < deadline:
                    with api._job_lock:
                        status = api._jobs[job_id]['status']
                    if status in {'completed', 'failed'}:
                        break
                    time.sleep(0.05)
                assert status == 'completed', status
                with api.get_db() as conn:
                    row = conn.execute(
                        'SELECT status,attempt_count FROM background_jobs WHERE id=?',
                        (job_id,),
                    ).fetchone()
                assert row[0] == 'completed' and int(row[1]) == 1
                api._job_executor.shutdown(wait=True, cancel_futures=True)
                """,
            )
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)

    def test_operational_gates_concurrency_scheduler_and_retention(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-settings-test-") as tmp:
            root = self._isolated_server_copy(Path(tmp))
            result = self._run(
                root,
                """
                import os
                import threading
                import time
                import api_server as api

                api.core.ScraperBackend.set_setting('read_only_mode', 'true')
                try:
                    api._enqueue_job('fetch_organisations', {'website_id': 1})
                    raise AssertionError('read-only gate was not enforced')
                except api.HTTPException as exc:
                    assert exc.status_code == 423
                api.core.ScraperBackend.set_setting('read_only_mode', 'false')
                api.core.ScraperBackend.set_setting('drain_mode', 'true')
                try:
                    api._enqueue_job('fetch_organisations', {'website_id': 1})
                    raise AssertionError('drain gate was not enforced')
                except api.HTTPException as exc:
                    assert exc.status_code == 423
                api.core.ScraperBackend.set_setting('drain_mode', 'false')

                state = {'active': 0, 'maximum': 0}
                lock = threading.Lock()
                def tracked(_website_id):
                    with lock:
                        state['active'] += 1
                        state['maximum'] = max(state['maximum'], state['active'])
                    time.sleep(0.2)
                    with lock:
                        state['active'] -= 1
                    return True
                def wait_all(ids):
                    deadline = time.time() + 8
                    while time.time() < deadline:
                        with api._job_lock:
                            statuses = [api._jobs[job_id]['status'] for job_id in ids]
                        if all(status == 'completed' for status in statuses):
                            return
                        time.sleep(0.05)
                    raise AssertionError(statuses)

                api.core.ScraperBackend.fetch_organisations_logic = staticmethod(tracked)
                api.core.ScraperBackend.set_setting('max_concurrent_sessions', '1')
                ids = [api._enqueue_job('fetch_organisations', {'website_id': 1})['job_id'] for _ in range(2)]
                wait_all(ids)
                assert state['maximum'] == 1, state

                state.update(active=0, maximum=0)
                api.core.ScraperBackend.set_setting('max_concurrent_sessions', '2')
                ids = [api._enqueue_job('fetch_organisations', {'website_id': 1})['job_id'] for _ in range(2)]
                wait_all(ids)
                assert state['maximum'] == 2, state

                api.core.ScraperBackend.download_single_tender_logic = staticmethod(
                    lambda _tender_id, _mode: time.sleep(0.3) or True
                )
                api.core.ScraperBackend.set_setting('dedupe_by_tender_id', 'true')
                first = api._enqueue_job('download_single_tender', {'tender_db_id': 42, 'mode': 'full'})
                duplicate = api._enqueue_job('download_single_tender', {'tender_db_id': 42, 'mode': 'full'})
                assert duplicate['job_id'] == first['job_id'], (first, duplicate)
                wait_all([first['job_id']])

                original_callable = api._job_callable
                requeue_calls = {'count': 0}
                def requeue_once(_action, _payload):
                    requeue_calls['count'] += 1
                    if requeue_calls['count'] == 1:
                        raise api.core.JobRequeueError('captcha answer timed out')
                    return True
                api._job_callable = requeue_once
                api.core.ScraperBackend.set_setting('retry_attempts', '2')
                requeued_id = api._enqueue_job('fetch_organisations', {'website_id': 1})['job_id']
                wait_all([requeued_id])
                durable_deadline = time.time() + 3
                while True:
                    with api.get_db() as conn:
                        requeued_row = conn.execute(
                            'SELECT status,attempt_count FROM background_jobs WHERE id=?', (requeued_id,)
                        ).fetchone()
                    if requeued_row[0] == 'completed' and int(requeued_row[1]) == 2:
                        break
                    if time.time() >= durable_deadline:
                        break
                    time.sleep(0.02)
                assert requeued_row[0] == 'completed' and int(requeued_row[1]) == 2, requeued_row
                api._job_callable = original_callable

                timeout_id = 'job_lifetime_test'
                timeout_job = {
                    'status':'queued','action':'fetch_organisations','payload':{'website_id':1},
                    'result':None,'error':'','logs':[],'progress':0,
                    'created_at':time.time()-120,'started_at':None,
                    'finished_at':None,'heartbeat_at':time.time()-120,
                    'cancel_requested':False,'attempt_count':0,'worker_id':'',
                    'website_id':1,'tender_id':None,'mode':None,
                }
                with api._job_lock:
                    api._jobs[timeout_id] = timeout_job
                api._persist_job(timeout_id, timeout_job)
                api.core.ScraperBackend.set_setting('job_ttl_minutes', '1')
                assert api._job_cancel_requested(timeout_id) is True
                with api.get_db() as conn:
                    timeout_row = conn.execute(
                        'SELECT status,error FROM background_jobs WHERE id=?', (timeout_id,)
                    ).fetchone()
                assert timeout_row[0] == 'cancelled'
                assert 'configured 1-minute lifetime' in timeout_row[1]

                old_id = 'job_expired_test'
                old = {
                    'status':'completed','action':'fetch_organisations','payload':{'website_id':1},
                    'result':True,'error':'','logs':[],'progress':100,
                    'created_at':time.time()-(3*86400),'started_at':time.time()-(3*86400)+10,
                    'finished_at':time.time()-(3*86400)+60,'heartbeat_at':time.time()-(3*86400)+60,
                    'cancel_requested':False,'attempt_count':1,'worker_id':'old',
                    'website_id':1,'tender_id':None,'mode':None,
                }
                with api._job_lock:
                    api._jobs[old_id] = old
                api._persist_job(old_id, old)
                os.environ['BIDMANAGER_JOB_HISTORY_DAYS'] = '1'
                assert api._cleanup_expired_jobs() >= 1
                with api.get_db() as conn:
                    assert conn.execute('SELECT id FROM background_jobs WHERE id=?',(old_id,)).fetchone() is None

                captured = []
                original_enqueue = api._enqueue_job
                api._enqueue_job = lambda action, payload=None: captured.append((action, payload)) or {'job_id':'fake','status':'queued'}
                api.core.ScraperBackend.set_setting('schedule_enabled', 'true')
                api.core.ScraperBackend.set_setting('scheduler_paused', 'false')
                api.core.ScraperBackend.set_setting('portal_mahatenders', 'true')
                api.core.ScraperBackend.set_setting('portal_etenders', 'true')
                api.core.ScraperBackend.set_setting('portal_eprocure', 'false')
                with api.get_db() as conn:
                    conn.execute("UPDATE scheduler_leases SET lease_until=0,last_run_at=NULL WHERE name='default'")
                    conn.commit()
                assert api._scheduler_tick() == 2
                assert len(captured) == 2
                assert api._scheduler_tick() == 0
                api._enqueue_job = original_enqueue
                api.core.ScraperBackend.set_setting('schedule_enabled', 'false')
                api._scheduler_stop.set()
                api._job_executor.shutdown(wait=True, cancel_futures=True)
                """,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_admin_jobs_batches_display_label_queries(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-jobs-list-test-") as tmp:
            root = self._isolated_server_copy(Path(tmp))
            result = self._run(
                root,
                """
                import time
                import api_server as api

                with api.get_db() as conn:
                    website = conn.execute('SELECT id,name FROM websites ORDER BY id LIMIT 1').fetchone()
                    website_id = int(website[0])
                    cursor = conn.execute(
                        'INSERT INTO tenders (website_id,tender_id,title) VALUES (?,?,?)',
                        (website_id, 'BATCH-JOB-TENDER', 'Batch job tender'),
                    )
                    tender_db_id = int(cursor.lastrowid)
                    conn.commit()

                now = time.time()
                base_job = {
                    'status':'completed', 'action':'fetch_tenders', 'payload':{},
                    'result':True, 'error':'', 'logs':[], 'progress':100,
                    'created_at':now, 'started_at':now, 'finished_at':now,
                    'heartbeat_at':now, 'cancel_requested':False,
                    'attempt_count':1, 'worker_id':'test', 'mode':None,
                }
                with api._job_lock:
                    api._jobs['website-job'] = {
                        **base_job, 'website_id':website_id, 'tender_id':None,
                    }
                    api._jobs['tender-job'] = {
                        **base_job, 'website_id':None, 'tender_id':tender_db_id,
                    }

                # The list endpoint must use its batch maps, never the legacy
                # one-query-per-job display helpers.
                api._job_website_label = lambda _id: (_ for _ in ()).throw(AssertionError('N+1 website query'))
                api._job_tender_display = lambda _id: (_ for _ in ()).throw(AssertionError('N+1 tender query'))
                response = api.admin_jobs('', None)
                rows = {row['id']: row for row in response['jobs']}
                assert rows['website-job']['portal'] == str(website[1])
                assert rows['tender-job']['portal'] == str(website[1])
                assert rows['tender-job']['tenderId'] == 'BATCH-JOB-TENDER'
                api._scheduler_stop.set()
                api._job_executor.shutdown(wait=True, cancel_futures=True)
                """,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
