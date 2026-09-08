import os
import base64
import json
import sqlite3
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import client_api


class ClientApiTests(unittest.TestCase):
    def setUp(self):
        # Starlette's Windows FileResponse worker can retain a file handle until
        # interpreter teardown even after the response is closed.
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.temp.name)
        self.db_path = self.root / "client.db"
        self.file_path = self.root / "spec.pdf"
        self.file_path.write_bytes(b"test document")
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE websites (id INTEGER PRIMARY KEY, name TEXT, url TEXT);
            CREATE TABLE tenders (
                id INTEGER PRIMARY KEY, website_id INTEGER, org_chain TEXT, tender_id TEXT,
                title TEXT, work_description TEXT, tender_value TEXT, emd TEXT,
                closing_date TEXT, opening_date TEXT, published_date TEXT,
                pre_bid_meeting_date TEXT, location TEXT, tender_category TEXT,
                status TEXT, is_archived INTEGER, tender_url TEXT,
                prebid_count INTEGER DEFAULT 0, corrigendum_count INTEGER DEFAULT 0,
                scrape_enabled INTEGER DEFAULT 0, scrape_interval_minutes INTEGER DEFAULT 0,
                next_scrape_at REAL DEFAULT 0, last_scraped_at REAL,
                first_seen_at REAL, last_changed_at REAL
            );
            CREATE TABLE organizations (
                id INTEGER PRIMARY KEY, website_id INTEGER, name TEXT, tenders_url TEXT,
                tender_count INTEGER, is_selected INTEGER DEFAULT 0,
                scrape_enabled INTEGER DEFAULT 0, scrape_interval_minutes INTEGER DEFAULT 0,
                next_scrape_at REAL DEFAULT 0, last_scraped_at REAL
            );
            CREATE TABLE downloaded_files (
                id INTEGER PRIMARY KEY, tender_id TEXT, tender_db_id INTEGER,
                file_name TEXT, file_type TEXT, file_size_bytes INTEGER,
                downloaded_at TEXT, download_status TEXT, local_path TEXT, drive_file_id TEXT
            );
            CREATE TABLE client_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                password_enc TEXT,
                display_name TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                created_at REAL NOT NULL,
                last_login_at REAL,
                last_seen_at REAL
            );
            CREATE UNIQUE INDEX idx_client_users_email ON client_users(LOWER(email));
            CREATE TABLE client_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL,
                created_at REAL NOT NULL,
                revoked_at REAL
            );
            CREATE TABLE client_activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                route TEXT NOT NULL,
                tender_id INTEGER,
                created_at REAL NOT NULL
            );
            CREATE TABLE client_user_sync (
                user_id INTEGER PRIMARY KEY,
                data_json TEXT NOT NULL DEFAULT '{}',
                updated_at REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE background_jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                action TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                result_json TEXT,
                error TEXT,
                logs_json TEXT NOT NULL DEFAULT '[]',
                progress INTEGER DEFAULT 0,
                created_at REAL NOT NULL,
                started_at REAL,
                finished_at REAL,
                heartbeat_at REAL,
                cancel_requested INTEGER DEFAULT 0,
                attempt_count INTEGER DEFAULT 0,
                worker_id TEXT,
                dedupe_key TEXT
            );
            CREATE TABLE saved_custom_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_name TEXT NOT NULL,
                name TEXT NOT NULL,
                website_id INTEGER NOT NULL,
                job_type TEXT NOT NULL,
                org_ids_json TEXT NOT NULL DEFAULT '[]',
                tender_ids_json TEXT NOT NULL DEFAULT '[]',
                all_organizations INTEGER DEFAULT 0,
                all_tenders INTEGER DEFAULT 0,
                download_mode TEXT DEFAULT 'full',
                schedule_enabled INTEGER DEFAULT 0,
                schedule_mode TEXT DEFAULT 'manual',
                interval_minutes INTEGER DEFAULT 0,
                scheduled_for_at REAL DEFAULT 0,
                next_run_at REAL DEFAULT 0,
                last_run_at REAL,
                last_job_id TEXT,
                created_by TEXT DEFAULT 'admin',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            CREATE TABLE bookmark_scrape_suppressed (
                website_id INTEGER PRIMARY KEY,
                suppressed_at REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE tender_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tender_db_id INTEGER NOT NULL,
                tender_key TEXT NOT NULL,
                scraped_at REAL NOT NULL,
                content_hash TEXT NOT NULL,
                changed_fields TEXT NOT NULL DEFAULT '[]',
                snapshot_json TEXT NOT NULL DEFAULT '{}'
            );
            INSERT INTO websites VALUES (1, 'MahaTenders', 'https://example.test');
            INSERT INTO tenders VALUES
                (1,1,'Road Authority','T-100','Road bridge','Build a bridge','1000','10',
                 '2026-09-10','2026-09-11','2026-08-01','2026-08-20','Pune','Works','Open',0,'https://example.test/t/100',1,2,0,0,0,NULL,NULL,NULL),
                (2,1,'Water Authority','T-200','Water works','Pipeline','2000','20',
                 '2026-10-10','2026-10-11','2026-08-02','','Mumbai','Services','Closed',1,'https://example.test/t/200',0,0,0,0,0,NULL,NULL,NULL);
            INSERT INTO organizations VALUES
                (1,1,'Road Authority','https://example.test/org/1',1,1,0,0,0,NULL),
                (2,1,'Water Authority','https://example.test/org/2',1,1,0,0,0,NULL);
            """
        )
        conn.execute(
            "INSERT INTO downloaded_files VALUES (1,'T-100',1,'spec.pdf','notice',13,'2026-08-18','complete',?,NULL)",
            (str(self.file_path),),
        )
        conn.commit()
        conn.close()

        app = FastAPI()
        app.include_router(client_api.router)
        app.include_router(client_api.download_router)
        self.client = TestClient(app)
        self.patches = [
            mock.patch.object(client_api.core, "DB_FILE", str(self.db_path)),
            mock.patch.object(client_api.core, "BASE_DOWNLOAD_DIRECTORY", str(self.root)),
            mock.patch.dict(os.environ, {
                "ADMIN_API_KEY": "admin-secret",
                "BIDMANAGER_DOWNLOAD_TOKEN_SECRET": "download-secret",
            }, clear=False),
        ]
        for patch in self.patches:
            patch.start()

        register = self.client.post(
            "/client/auth/register",
            json={"email": "tester@example.com", "password": "correct horse battery"},
        )
        self.assertEqual(register.status_code, 200, register.text)
        self.token = register.json()["token"]
        self.user_id = register.json()["user_id"]
        register.close()

    def tearDown(self):
        self.client.close()
        for patch in reversed(self.patches):
            patch.stop()
        self.temp.cleanup()

    @property
    def headers(self):
        return {"x-client-key": self.token}

    def _row(self, sql, params=()):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            return conn.execute(sql, params).fetchone()
        finally:
            conn.close()

    # ── auth ────────────────────────────────────────────────────────────

    def test_all_data_routes_fail_closed_without_a_valid_token(self):
        for path in ("/client/health", "/client/tenders", "/client/search?q=road", "/client/stats"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 401)
                self.assertEqual(
                    self.client.get(path, headers={"x-client-key": "not-a-real-token"}).status_code, 401
                )

    def test_register_rejects_duplicate_email(self):
        response = self.client.post(
            "/client/auth/register",
            json={"email": "tester@example.com", "password": "another password"},
        )
        self.assertEqual(response.status_code, 409)

    def test_login_succeeds_with_correct_password_and_fails_otherwise(self):
        ok = self.client.post(
            "/client/auth/login",
            json={"email": "tester@example.com", "password": "correct horse battery"},
        )
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(ok.json()["token"])
        self.assertNotEqual(ok.json()["token"], self.token)  # a fresh token per login

        bad = self.client.post(
            "/client/auth/login",
            json={"email": "tester@example.com", "password": "wrong password"},
        )
        self.assertEqual(bad.status_code, 401)

    def test_password_is_stored_reversibly_for_the_admin_console(self):
        row = self._row("SELECT password_enc FROM client_users WHERE id=?", (self.user_id,))
        self.assertIsNotNone(dict(row)["password_enc"])
        self.assertEqual(
            client_api.security.decrypt_password(dict(row)["password_enc"]),
            "correct horse battery",
        )
        changed = self.client.post(
            "/client/auth/change-password",
            headers=self.headers,
            json={"current_password": "correct horse battery", "new_password": "a brand new secret"},
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        row2 = self._row("SELECT password_enc FROM client_users WHERE id=?", (self.user_id,))
        self.assertEqual(
            client_api.security.decrypt_password(dict(row2)["password_enc"]),
            "a brand new secret",
        )

    def test_logout_revokes_the_token(self):
        logout = self.client.post("/client/auth/logout", headers=self.headers)
        self.assertEqual(logout.status_code, 200)
        after = self.client.get("/client/health", headers=self.headers)
        self.assertEqual(after.status_code, 401)

    def test_suspended_account_is_rejected_with_reason(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute("UPDATE client_users SET status='suspended' WHERE id=?", (self.user_id,))
        conn.commit()
        conn.close()
        response = self.client.get("/client/health", headers=self.headers)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["reason"], "suspended")

    def test_authenticated_requests_are_logged_per_user(self):
        self.client.get("/client/health", headers=self.headers).close()
        self.client.get("/client/tenders/1", headers=self.headers).close()
        row = self._row(
            "SELECT COUNT(*) AS n FROM client_activity_log WHERE user_id=?", (self.user_id,)
        )
        self.assertEqual(dict(row)["n"], 2)
        tender_row = self._row(
            "SELECT tender_id FROM client_activity_log WHERE route LIKE '%/tenders/1'"
        )
        self.assertEqual(dict(tender_row)["tender_id"], 1)

    # ── tenders / documents (unchanged contract, now behind per-user auth) ──

    def test_tender_list_filters_sorts_and_paginates_without_internal_paths(self):
        response = self.client.get(
            "/client/tenders?q=road&archived=false&sort_by=title&page=1&page_size=1",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["pages"], 1)
        self.assertEqual(payload["items"][0]["tender_id"], "T-100")
        self.assertEqual(payload["items"][0]["document_count"], 1)
        self.assertNotIn("folder_path", payload["items"][0])
        self.assertNotIn("drive_file_id", payload["items"][0])

    def test_documents_hide_storage_references(self):
        response = self.client.get("/client/tenders/1/documents", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        document = response.json()["items"][0]
        self.assertEqual(document["name"], "spec.pdf")
        self.assertTrue(document["downloadable"])
        self.assertNotIn("local_path", document)
        self.assertNotIn("drive_file_id", document)

    def test_download_request_returns_expiring_link_without_writing(self):
        response = self.client.post(
            "/client/tenders/1/download-request", headers=self.headers, json={"document_id": 1},
        )
        self.assertEqual(response.status_code, 200)
        link = response.json()["url"]
        self.assertIn("/client/documents/1/download?token=", link)
        encoded_token = link.split("token=", 1)[1].split(".", 1)[0]
        token_payload = json.loads(base64.urlsafe_b64decode(encoded_token + "=" * (-len(encoded_token) % 4)))
        self.assertNotIn(str(self.file_path), json.dumps(token_payload))
        download = self.client.get(link)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.content, b"test document")
        invalid = self.client.get("/client/documents/1/download?token=invalid-token-value-long")
        self.assertEqual(invalid.status_code, 401)
        invalid.close()
        download.close()
        response.close()

    def test_document_cannot_be_requested_through_another_tender(self):
        response = self.client.post(
            "/client/tenders/2/download-request", headers=self.headers, json={"document_id": 1},
        )
        self.assertEqual(response.status_code, 404)

    # ── async tender download job ──────────────────────────────────────

    def test_request_download_enqueues_a_job_and_status_can_be_polled(self):
        fake_api_server = types.ModuleType("api_server")
        fake_api_server._enqueue_job = mock.Mock(return_value={"job_id": "job-1", "status": "queued"})
        with mock.patch.dict(sys.modules, {"api_server": fake_api_server}):
            response = self.client.post("/client/tenders/1/request-download", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"job_id": "job-1", "status": "queued"})
        fake_api_server._enqueue_job.assert_called_once_with(
            "download_single_tender", {"tender_db_id": 1, "mode": "full", "source": "client"}
        )

        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO background_jobs (id,status,action,payload_json,created_at) VALUES (?,?,?,?,?)",
            ("job-1", "completed", "download_single_tender", json.dumps({"tender_db_id": 1}), time.time()),
        )
        conn.commit()
        conn.close()

        status = self.client.get("/client/tenders/1/download-status?job_id=job-1", headers=self.headers)
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["status"], "completed")

        mismatched = self.client.get("/client/tenders/2/download-status?job_id=job-1", headers=self.headers)
        self.assertEqual(mismatched.status_code, 404)

    def test_request_download_for_missing_tender_404s(self):
        response = self.client.post("/client/tenders/999/request-download", headers=self.headers)
        self.assertEqual(response.status_code, 404)

    def test_download_status_for_unknown_job_404s(self):
        response = self.client.get("/client/tenders/1/download-status?job_id=nope", headers=self.headers)
        self.assertEqual(response.status_code, 404)

    # ── organizations ──────────────────────────────────────────────────

    def test_organizations_list_requires_auth_and_returns_expected_shape(self):
        self.assertEqual(self.client.get("/client/organizations").status_code, 401)
        response = self.client.get("/client/organizations", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        names = {item["name"] for item in payload["items"]}
        self.assertEqual(names, {"Road Authority", "Water Authority"})
        first = payload["items"][0]
        self.assertIn("scrape_enabled", first)
        self.assertIn("website_name", first)

    def test_organizations_list_filters_by_query(self):
        response = self.client.get("/client/organizations?q=road", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)

    # ── cloud sync ──────────────────────────────────────────────────────

    def test_sync_pull_is_empty_before_any_push(self):
        response = self.client.get("/client/sync", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": {}, "updated_at": 0})

    def test_sync_push_then_pull_round_trips(self):
        blob = {"templates": [{"id": 1, "template_name": "Standard"}], "bookmarks": []}
        pushed = self.client.put("/client/sync", json={"data": blob}, headers=self.headers)
        self.assertEqual(pushed.status_code, 200, pushed.text)
        pulled = self.client.get("/client/sync", headers=self.headers)
        self.assertEqual(pulled.status_code, 200)
        self.assertEqual(pulled.json()["data"], blob)
        self.assertGreater(pulled.json()["updated_at"], 0)

    def test_sync_push_requires_auth(self):
        response = self.client.put("/client/sync", json={"data": {}})
        self.assertEqual(response.status_code, 401)

    def test_sync_push_rejects_oversized_payload(self):
        blob = {"notes": "x" * (client_api.MAX_SYNC_PAYLOAD_BYTES + 1)}
        response = self.client.put("/client/sync", json={"data": blob}, headers=self.headers)
        self.assertEqual(response.status_code, 413)

    def _user_job(self, website_id=1):
        return self._row(
            "SELECT id,org_ids_json,schedule_enabled,interval_minutes,schedule_mode "
            "FROM saved_custom_jobs WHERE created_by='user' AND website_id=?",
            (website_id,),
        )

    def test_bookmark_creates_one_user_scrape_job_per_website(self):
        # Bookmark tender 1 (org 'Road Authority' = org id 1) and org id 2 ->
        # one auto-managed saved_custom_jobs row holding both org ids.
        response = self.client.put(
            "/client/sync",
            json={"data": {"bookmarks": [1], "bookmarkedOrgIds": [2]}},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        job = self._user_job()
        self.assertIsNotNone(job)
        self.assertEqual(sorted(json.loads(job["org_ids_json"])), [1, 2])
        self.assertEqual(job["schedule_enabled"], 1)
        self.assertEqual(job["interval_minutes"], 1440)
        self.assertEqual(job["schedule_mode"], "interval")
        # Exactly one user job for this website.
        count = self._row(
            "SELECT COUNT(*) AS n FROM saved_custom_jobs WHERE created_by='user' AND website_id=1"
        )
        self.assertEqual(count["n"], 1)

    def test_second_bookmarked_org_merges_into_the_same_user_job(self):
        self.client.put("/client/sync", json={"data": {"bookmarkedOrgIds": [1]}}, headers=self.headers)
        first = self._user_job()
        self.client.put("/client/sync", json={"data": {"bookmarkedOrgIds": [1, 2]}}, headers=self.headers)
        second = self._user_job()
        self.assertEqual(first["id"], second["id"])  # same row grew, no new job
        self.assertEqual(sorted(json.loads(second["org_ids_json"])), [1, 2])

    def test_sync_push_resolves_bookmarked_org_by_name_when_id_is_missing(self):
        response = self.client.put(
            "/client/sync",
            json={"data": {"bookmarkedOrgs": ["Water Authority"]}},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        job = self._user_job()
        self.assertIsNotNone(job)
        self.assertEqual(json.loads(job["org_ids_json"]), [2])

    def test_admin_job_coverage_means_no_user_job(self):
        now = time.time()
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO saved_custom_jobs (owner_name,name,website_id,job_type,org_ids_json,"
            "schedule_enabled,schedule_mode,interval_minutes,next_run_at,created_by,created_at,updated_at) "
            "VALUES ('admin','nightly',1,'scrape','[2]',1,'interval',30,?,'admin',?,?)",
            (now + 60, now, now),
        )
        conn.commit()
        conn.close()
        self.client.put(
            "/client/sync", json={"data": {"bookmarkedOrgIds": [2]}}, headers=self.headers
        )
        # Org 2 is already kept fresh by the admin job -> no user job at all.
        self.assertIsNone(self._user_job())
        # The admin job is left exactly as it was.
        admin = self._row("SELECT interval_minutes FROM saved_custom_jobs WHERE owner_name='admin'")
        self.assertEqual(admin["interval_minutes"], 30)

    def test_last_bookmarker_removal_deletes_the_user_job(self):
        self.client.put("/client/sync", json={"data": {"bookmarkedOrgIds": [2]}}, headers=self.headers)
        self.assertIsNotNone(self._user_job())
        self.client.put("/client/sync", json={"data": {"bookmarkedOrgIds": []}}, headers=self.headers)
        self.assertIsNone(self._user_job())

    def test_reconcile_respects_a_pause_and_a_suppression(self):
        self.client.put("/client/sync", json={"data": {"bookmarkedOrgIds": [2]}}, headers=self.headers)
        job = self._user_job()
        conn = sqlite3.connect(self.db_path)
        conn.execute("UPDATE saved_custom_jobs SET schedule_enabled=0 WHERE id=?", (job["id"],))
        conn.commit()
        conn.close()
        # Another bookmark push must refresh coverage but NOT re-enable the schedule.
        self.client.put("/client/sync", json={"data": {"bookmarkedOrgIds": [1, 2]}}, headers=self.headers)
        job = self._user_job()
        self.assertEqual(job["schedule_enabled"], 0)
        self.assertEqual(sorted(json.loads(job["org_ids_json"])), [1, 2])
        # Delete it and suppress the website -> reconcile won't recreate it.
        conn = sqlite3.connect(self.db_path)
        conn.execute("DELETE FROM saved_custom_jobs WHERE id=?", (job["id"],))
        conn.execute("INSERT INTO bookmark_scrape_suppressed (website_id, suppressed_at) VALUES (1, ?)", (time.time(),))
        conn.commit()
        conn.close()
        self.client.put("/client/sync", json={"data": {"bookmarkedOrgIds": [1, 2]}}, headers=self.headers)
        self.assertIsNone(self._user_job())

    def test_changes_feed_reports_closing_date_change_and_new_tender(self):
        # First call establishes the cursor without alerting on the back-catalogue.
        self.client.put("/client/sync", json={"data": {
            "bookmarks": [1], "bookmarkedOrgs": ["Road Authority"],
        }}, headers=self.headers)
        first = self.client.get("/client/changes?since=0", headers=self.headers).json()
        self.assertEqual(first["tenders"], [])
        self.assertEqual(first["new_by_org"], {})
        cursor = first["now"]

        now = time.time()
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO tender_history (tender_db_id,tender_key,scraped_at,content_hash,changed_fields) "
            "VALUES (1,'1:T-100',?,'h',?)",
            (now, json.dumps(["closing_date"])),
        )
        conn.execute(
            "INSERT INTO tenders (id,website_id,org_chain,tender_id,title,is_archived,first_seen_at) "
            "VALUES (3,1,'Road Authority','T-300','New road job',0,?)",
            (now,),
        )
        conn.commit()
        conn.close()

        out = self.client.get(f"/client/changes?since={cursor}", headers=self.headers).json()
        self.assertEqual([t["id"] for t in out["tenders"]], [1])
        self.assertEqual(out["tenders"][0]["changed_fields"], ["closing_date"])
        self.assertEqual([t["id"] for t in out["new_by_org"]["Road Authority"]], [3])


if __name__ == "__main__":
    unittest.main()
