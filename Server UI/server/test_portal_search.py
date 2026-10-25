"""Portal tender search: app_core.portal_search_tender_logic (the portal page
itself is mocked) and the /client/portal-search routes."""

import os
import sqlite3
import tempfile
import time
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import api_server
import app_core as core
import test_client_api

ADMIN = {"x-admin-key": "admin-secret"}
SB = core.ScraperBackend


class PortalSearchLogicTests(unittest.TestCase):
    def setUp(self):
        self._old_db_file = core.DB_FILE
        self._temp = tempfile.TemporaryDirectory(prefix="bidmanager-portal-", ignore_cleanup_errors=True)
        core.DB_FILE = os.path.join(self._temp.name, "portal.db")
        core.init_db()
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("DELETE FROM websites")
        conn.execute(
            "INSERT INTO websites (id,name,url,status_url,portal_type) VALUES "
            "(1,'Maha','https://maha.test/nicgep/app','https://maha.test/status','nic'),"
            "(2,'Gujarat','https://nprocure.test','','nprocure'),"
            "(3,'Other','https://other.test/nicgep/app','https://other.test/status','nic')"
        )
        conn.commit()
        conn.close()
        self.patches = [
            mock.patch.object(core, "ensure_scraper_dependencies", return_value=True),
            mock.patch.object(core, "create_browser_driver", return_value=mock.MagicMock()),
            mock.patch.object(core.storage_runtime, "require_durable_cloud_storage", return_value=None),
            mock.patch.object(core, "log_to_gui", return_value=None),
        ]
        for patch in self.patches:
            patch.start()
        self.save_docs = mock.patch.object(SB, "_save_result_docs", return_value=(True, "")).start()

    def tearDown(self):
        mock.patch.stopall()
        core.DB_FILE = self._old_db_file
        self._temp.cleanup()

    def _portal(self, stage, fields=None, captcha_ok=True):
        fields = fields if fields is not None else {
            "Tender ID": "2026_PWD_1_1", "Title and Ref.No.": "Road works / PWD/1",
            "Organisation Chain": "PWD||Pune", "Tender Stage": stage or "",
        }
        return mock.patch.object(
            SB, "_status_search", return_value=(captcha_ok, stage, fields if stage else {}, mock.MagicMock()),
        )

    def _tender(self, tender_id):
        conn = sqlite3.connect(core.DB_FILE)
        try:
            return conn.execute(
                "SELECT id, website_id, status, is_archived, title, org_chain FROM tenders WHERE tender_id=?",
                (tender_id,),
            ).fetchone()
        finally:
            conn.close()

    def _insert(self, tender_id, website_id=1, is_archived=0, status="Open", title="Existing title"):
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "INSERT INTO tenders (website_id, org_chain, tender_id, normalized_tender_id, title, status, is_archived) "
            "VALUES (?,?,?,?,?,?,?)",
            (website_id, "", tender_id, SB.canonical_tender_id(tender_id), title, status, is_archived),
        )
        conn.commit()
        conn.close()

    def test_new_tender_at_an_open_stage_goes_to_current(self):
        with self._portal("Bid Submission"):
            result = SB.portal_search_tender_logic(1, "2026_PWD_1_1", client_source=True)
        self.assertTrue(result["found"])
        self.assertTrue(result["created"])
        self.assertFalse(result["is_archived"])
        row = self._tender("2026_PWD_1_1")
        self.assertEqual((row[1], row[2], row[3]), (1, "Bid Submission", 0))
        self.assertEqual(row[4], "Road works / PWD/1")
        self.assertEqual(row[5], "PWD||Pune")
        self.save_docs.assert_not_called()

    def test_new_tender_past_bidding_goes_to_archive_with_results(self):
        with self._portal("AOC"):
            result = SB.portal_search_tender_logic(1, "2026_PWD_1_1")
        self.assertTrue(result["is_archived"])
        self.assertEqual(self._tender("2026_PWD_1_1")[3], 1)
        self.save_docs.assert_called_once()
        self.assertTrue(result["result_files"])

    def test_existing_archived_tender_is_updated_in_place(self):
        self._insert("2026_PWD_1_1", is_archived=1, status="Technical Evaluation")
        with self._portal("Financial Evaluation"):
            result = SB.portal_search_tender_logic(1, " 2026_pwd_1_1 ")
        self.assertFalse(result["created"])
        row = self._tender("2026_PWD_1_1")
        self.assertEqual((row[2], row[3]), ("Financial Evaluation", 1))
        self.assertEqual(row[4], "Existing title")  # only blanks are filled
        conn = sqlite3.connect(core.DB_FILE)
        changes = conn.execute("SELECT COUNT(*) FROM tenders").fetchone()[0]
        conn.close()
        self.assertEqual(changes, 1)

    def test_existing_current_tender_stays_current_even_at_a_late_stage(self):
        self._insert("2026_PWD_1_1", is_archived=0, title="")
        with self._portal("Concluded"):
            result = SB.portal_search_tender_logic(1, "2026_PWD_1_1")
        row = self._tender("2026_PWD_1_1")
        self.assertEqual((row[2], row[3], result["is_archived"]), ("Concluded", 0, False))
        self.assertEqual(row[4], "Road works / PWD/1")

    def test_tender_on_another_portal_is_matched_by_tender_id(self):
        self._insert("2026_PWD_1_1", website_id=3)
        with self._portal("Technical Bid Opening"):
            result = SB.portal_search_tender_logic(1, "2026_PWD_1_1")
        self.assertFalse(result["created"])
        self.assertEqual(self._tender("2026_PWD_1_1")[1], 3)

    def test_not_found_is_a_completed_search(self):
        with self._portal(None):
            result = SB.portal_search_tender_logic(1, "2026_NOPE_9_1")
        self.assertEqual(result["found"], False)
        self.assertIsNone(self._tender("2026_NOPE_9_1"))

    def test_captcha_failure_returns_false_for_a_retry(self):
        with self._portal(None, captcha_ok=False):
            self.assertIs(SB.portal_search_tender_logic(1, "2026_PWD_1_1"), False)

    def test_nprocure_and_unknown_portals_are_refused(self):
        with self.assertRaises(core.PortalActionUnsupported):
            SB.portal_search_tender_logic(2, "2026_PWD_1_1")
        with self.assertRaises(core.PortalActionUnsupported):
            SB.portal_search_tender_logic(99, "2026_PWD_1_1")
        with self.assertRaises(core.PortalActionUnsupported):
            SB.portal_search_tender_logic(1, "   ")

    def test_captcha_is_handled_like_a_document_download(self):
        driver = mock.MagicMock()
        with mock.patch.object(core, "WebDriverWait", create=True) as wait, \
                mock.patch.object(core, "EC", create=True), mock.patch.object(core, "By", create=True), \
                mock.patch.object(SB, "handle_captcha_interaction", return_value=False) as captcha:
            wait.return_value.until.return_value = mock.MagicMock()
            self.assertEqual(SB._status_search(driver, "https://maha.test/status", "2026_PWD_1_1", True),
                             (False, None, {}, None))
        captcha.assert_called_once_with(
            driver, "Portal search 2026_PWD_1_1", submit_id="Search", is_download=True, accept_no_records=True,
        )

    def test_job_action_runs_the_search(self):
        with mock.patch.object(SB, "portal_search_tender_logic", return_value={"found": False}) as run:
            self.assertEqual(
                api_server._job_callable("portal_search_tender", {"website_id": 1, "tender_id": "X", "source": "client"}),
                {"found": False},
            )
        run.assert_called_once_with(1, "X", client_source=True)
        self.assertEqual(
            api_server._job_dedupe_key("portal_search_tender", {"website_id": 1, "tender_id": " 2026_pwd_1_1 "}),
            "portal_search_tender:website:1:tid:2026_PWD_1_1",
        )


class PortalSearchRouteTests(unittest.TestCase):
    def setUp(self):
        test_client_api.ClientApiTests.setUp(self)
        conn = sqlite3.connect(self.db_path)
        conn.execute("ALTER TABLE websites ADD COLUMN status_url TEXT")
        conn.execute("ALTER TABLE websites ADD COLUMN portal_type TEXT")
        conn.execute("UPDATE websites SET status_url='https://example.test/status', portal_type='nic' WHERE id=1")
        conn.execute("INSERT INTO websites (id,name,url,status_url,portal_type) VALUES (2,'Guj','u','','nprocure')")
        conn.commit()
        conn.close()
        self.client.close()
        self.client = TestClient(api_server.app)
        self.jobs = []

        def fake_enqueue(action, payload):
            self.jobs.append((action, payload))
            job_id = f"job-{len(self.jobs)}"
            conn = sqlite3.connect(self.db_path)
            conn.execute(
                "INSERT INTO background_jobs (id,status,action,payload_json,created_at) VALUES (?,?,?,?,?)",
                (job_id, "queued", action, "{}", time.time()),
            )
            conn.commit()
            conn.close()
            return {"job_id": job_id, "status": "queued", "created": True}

        self.enqueue = mock.patch.object(api_server, "_enqueue_job", side_effect=fake_enqueue)
        self.enqueue.start()

    def tearDown(self):
        self.enqueue.stop()
        test_client_api.ClientApiTests.tearDown(self)

    headers = test_client_api.ClientApiTests.headers

    def _allow(self, user_id=None, on=True):
        response = self.client.put(
            f"/admin/users/{user_id or self.user_id}/permissions", headers=ADMIN, json={"portal_search": on}
        )
        self.assertEqual(response.status_code, 200, response.text)

    def _finish(self, job_id, status, result_json=None, error=None):
        conn = sqlite3.connect(self.db_path)
        conn.execute("UPDATE background_jobs SET status=?, result_json=?, error=? WHERE id=?",
                     (status, result_json, error, job_id))
        conn.commit()
        conn.close()

    def test_off_by_default_for_existing_users(self):
        me = self.client.get("/client/me", headers=self.headers).json()
        self.assertFalse(me["permissions"]["portal_search"])
        self.assertTrue(me["permissions"]["active"])
        response = self.client.post("/client/portal-search", headers=self.headers,
                                    json={"website_id": 1, "tender_id": "T-100"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["section"], "portal_search")
        portals = self.client.get("/client/portal-search/portals", headers=self.headers).json()
        self.assertEqual(portals, {"allowed": False, "items": []})
        self.assertEqual(self.jobs, [])

    def test_org_admin_may_search(self):
        response = self.client.post("/client/auth/register", json={
            "email": "boss@acme.test", "password": "correct horse battery",
            "account_type": "organisation", "org_name": "Acme",
        })
        token = response.json()["token"]
        portals = self.client.get("/client/portal-search/portals", headers={"x-client-key": token}).json()
        self.assertTrue(portals["allowed"])

    def test_search_queues_a_job_and_keeps_history(self):
        self._allow()
        portals = self.client.get("/client/portal-search/portals", headers=self.headers).json()
        self.assertEqual([p["id"] for p in portals["items"]], [1])  # NIC with a status page only
        bad = self.client.post("/client/portal-search", headers=self.headers, json={"website_id": 2, "tender_id": "T-100"})
        self.assertEqual(bad.status_code, 400)

        started = self.client.post("/client/portal-search", headers=self.headers,
                                   json={"website_id": 1, "tender_id": " T-100 "})
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(self.jobs[-1], ("portal_search_tender", {
            "website_id": 1, "tender_id": "T-100", "source": "client", "requested_by_user_id": self.user_id,
        }))
        search = started.json()["search"]
        self.assertEqual((search["status"], search["website_name"]), ("pending", "MahaTenders"))

        self._finish(started.json()["job_id"], "completed",
                     '{"found": true, "tender_db_id": 1, "created": false, "is_archived": false, "stage": "AOC"}')
        polled = self.client.get(f"/client/portal-search/{search['id']}", headers=self.headers).json()["search"]
        self.assertEqual((polled["status"], polled["stage"], polled["created"]), ("found", "AOC", False))
        self.assertEqual(polled["tender"]["tender_id"], "T-100")

        second = self.client.post("/client/portal-search", headers=self.headers,
                                  json={"website_id": 1, "tender_id": "NOPE"}).json()
        self._finish(second["job_id"], "completed", '{"found": false}')
        third = self.client.post("/client/portal-search", headers=self.headers,
                                 json={"website_id": 1, "tender_id": "BROKEN"}).json()
        self._finish(third["job_id"], "failed", None, "CAPTCHA failed")
        history = self.client.get("/client/portal-search/history", headers=self.headers).json()["items"]
        self.assertEqual([(h["tender_id"], h["status"]) for h in history],
                         [("BROKEN", "failed"), ("NOPE", "not_found"), ("T-100", "found")])
        self.assertEqual(history[0]["error"], "CAPTCHA failed")

        self.client.delete(f"/client/portal-search/history/{history[0]['id']}", headers=self.headers)
        self.assertEqual(len(self.client.get("/client/portal-search/history", headers=self.headers).json()["items"]), 2)
        self.client.delete("/client/portal-search/history", headers=self.headers)
        self.assertEqual(self.client.get("/client/portal-search/history", headers=self.headers).json()["items"], [])

    def test_history_is_per_user(self):
        self._allow()
        started = self.client.post("/client/portal-search", headers=self.headers,
                                   json={"website_id": 1, "tender_id": "T-100"}).json()
        response = self.client.post("/client/auth/register",
                                    json={"email": "other@example.com", "password": "correct horse battery"})
        other = {"x-client-key": response.json()["token"]}
        self._allow(response.json()["user_id"])
        self.assertEqual(self.client.get("/client/portal-search/history", headers=other).json()["items"], [])
        self.assertEqual(
            self.client.get(f"/client/portal-search/{started['search']['id']}", headers=other).status_code, 404
        )

    def test_found_tender_outside_the_users_sections_shows_only_the_summary(self):
        self._allow()
        self.client.put(f"/admin/users/{self.user_id}/permissions", headers=ADMIN, json={"archived": False})
        started = self.client.post("/client/portal-search", headers=self.headers,
                                   json={"website_id": 1, "tender_id": "T-200"}).json()
        self._finish(started["job_id"], "completed",
                     '{"found": true, "tender_db_id": 2, "created": false, "is_archived": true, "stage": "Concluded"}')
        polled = self.client.get(f"/client/portal-search/{started['search']['id']}", headers=self.headers).json()
        self.assertEqual(polled["search"]["stage"], "Concluded")
        self.assertIsNone(polled["search"]["tender"])


if __name__ == "__main__":
    unittest.main()
