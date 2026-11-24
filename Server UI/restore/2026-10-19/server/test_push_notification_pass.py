import datetime as real_datetime
import json
import os
import sqlite3
import tempfile
import time
import unittest
from unittest import mock

import app_core as core
import api_server
import client_api

# Fixed reference "today" for every test below, so closing dates computed by
# _closing_in() and the mocked datetime.now().date() in api_server always
# agree -- using the real wall-clock date for one and a hardcoded value for
# the other was the bug that broke this the first time.
_REFERENCE_DATE = real_datetime.date(2026, 10, 9)


class PushNotificationPassTests(unittest.TestCase):
    def setUp(self):
        self._old_db_file = core.DB_FILE
        self._temp_dir = tempfile.TemporaryDirectory(prefix="bidmanager-push-", ignore_cleanup_errors=True)
        core.DB_FILE = os.path.join(self._temp_dir.name, "push.db")
        core.init_db()
        # One lease row per scheduled job name, matching production init.
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "INSERT INTO client_users (id,email,password_hash,created_at) VALUES (1,'a@test.com','x',?)",
            (time.time(),),
        )
        conn.execute(
            "INSERT OR IGNORE INTO websites (id,name,url) VALUES (1,'MahaTenders','https://example.test')"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        core.DB_FILE = self._old_db_file
        self._temp_dir.cleanup()
        # Each test gets its own lease state implicitly via a fresh DB file, but
        # the in-process lease claim below also touches api_server globals only
        # via DB rows, so no extra teardown needed there.

    def _insert_tender(self, tender_id, closing_date, is_archived=0, org_chain="Road Authority", first_seen_at=None):
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "INSERT INTO tenders (id,website_id,org_chain,tender_id,title,closing_date,is_archived,first_seen_at) "
            "VALUES (?,1,?,?,?,?,?,?)",
            (tender_id, org_chain, f"T-{tender_id}", f"Tender {tender_id}", closing_date, is_archived,
             first_seen_at if first_seen_at is not None else time.time() - 3600),
        )
        conn.commit()
        conn.close()

    def _set_sync_blob(self, user_id, blob):
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "INSERT INTO client_user_sync (user_id, data_json, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at",
            (user_id, json.dumps(blob), time.time()),
        )
        conn.commit()
        conn.close()

    def _register_device(self, token="device-token-aaaa", user_id=1, last_pushed_at=0, last_reminder_date=""):
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "INSERT INTO client_push_tokens (user_id, token, platform, created_at, last_seen_at, "
            "last_pushed_at, last_reminder_date) VALUES (?,?,?,?,?,?,?)",
            (user_id, token, "ios", time.time(), time.time(), last_pushed_at, last_reminder_date),
        )
        conn.commit()
        conn.close()

    def test_no_devices_is_a_noop(self):
        sent = api_server._run_push_notification_pass()
        self.assertEqual(sent, 0)

    def test_device_with_no_prefs_on_is_skipped(self):
        self._register_device()
        self._set_sync_blob(1, {"bookmarks": [], "notificationPrefs": {}})
        with mock.patch.object(api_server.apns_push, "send") as fake_send:
            sent = api_server._run_push_notification_pass()
        self.assertEqual(sent, 0)
        fake_send.assert_not_called()

    def test_closing_reminder_within_window_pushes_and_stamps_today(self):
        self._insert_tender(10, self._closing_in(2))
        self._set_sync_blob(1, {"bookmarks": [10], "notificationPrefs": {"reminderDays": [2]}})
        self._register_device()
        fake_result = api_server.apns_push.PushResult(ok=True)
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send, \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 11
            fake_dt.now.return_value.strftime.return_value = "2026-10-09"
            fake_dt.now.return_value.date.return_value = _REFERENCE_DATE
            sent = api_server._run_push_notification_pass()
        self.assertEqual(sent, 1)
        fake_send.assert_called_once()
        _, kwargs = fake_send.call_args
        self.assertIn("closes in 2 day", kwargs["body"])
        conn = sqlite3.connect(core.DB_FILE)
        row = conn.execute("SELECT last_reminder_date FROM client_push_tokens WHERE token=?", ("device-token-aaaa",)).fetchone()
        conn.close()
        self.assertEqual(row[0], "2026-10-09")

    def test_closing_reminder_outside_window_does_not_push(self):
        self._insert_tender(11, self._closing_in(1))
        self._set_sync_blob(1, {"bookmarks": [11], "notificationPrefs": {"reminderDays": [1]}})
        self._register_device()
        with mock.patch.object(api_server.apns_push, "send") as fake_send, \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 7  # before the 10:00 window
            sent = api_server._run_push_notification_pass()
        self.assertEqual(sent, 0)
        fake_send.assert_not_called()

    def test_closing_reminder_already_sent_today_is_not_resent(self):
        self._insert_tender(12, self._closing_in(3))
        self._set_sync_blob(1, {"bookmarks": [12], "notificationPrefs": {"reminderDays": [3]}})
        self._register_device(last_reminder_date="2026-10-09")
        with mock.patch.object(api_server.apns_push, "send") as fake_send, \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 11
            fake_dt.now.return_value.strftime.return_value = "2026-10-09"
            sent = api_server._run_push_notification_pass()
        self.assertEqual(sent, 0)
        fake_send.assert_not_called()

    def test_org_alert_pushes_new_tender_and_advances_cursor(self):
        self._set_sync_blob(1, {"bookmarkedOrgs": ["Road Authority"], "notificationPrefs": {"notifyOrgAlertsOn": True}})
        self._register_device(last_pushed_at=time.time() - 10)
        self._insert_tender(20, "", first_seen_at=time.time())
        fake_result = api_server.apns_push.PushResult(ok=True)
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send, \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 2  # outside reminder window, irrelevant here
            sent = api_server._run_push_notification_pass()
        self.assertEqual(sent, 1)
        fake_send.assert_called_once()
        conn = sqlite3.connect(core.DB_FILE)
        row = conn.execute("SELECT last_pushed_at FROM client_push_tokens WHERE token=?", ("device-token-aaaa",)).fetchone()
        conn.close()
        self.assertGreater(row[0], 0)

    def test_org_alert_push_carries_an_incrementing_badge(self):
        self._set_sync_blob(1, {"bookmarkedOrgs": ["Road Authority"], "notificationPrefs": {"notifyOrgAlertsOn": True}})
        self._register_device(last_pushed_at=time.time() - 10)
        self._insert_tender(22, "", first_seen_at=time.time())
        fake_result = api_server.apns_push.PushResult(ok=True)
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send, \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 2
            api_server._run_push_notification_pass()
        self.assertEqual(fake_send.call_args.kwargs["badge"], 1)
        conn = sqlite3.connect(core.DB_FILE)
        row = conn.execute("SELECT badge_count FROM client_push_tokens WHERE token=?", ("device-token-aaaa",)).fetchone()
        conn.close()
        self.assertEqual(row[0], 1)

    def test_bump_badge_increments_across_calls_and_defaults_to_zero(self):
        self._register_device(token="badge-token")
        self.assertEqual(api_server._bump_badge("badge-token"), 1)
        self.assertEqual(api_server._bump_badge("badge-token"), 2)
        self.assertEqual(api_server._bump_badge("badge-token"), 3)

    def test_dead_token_is_deleted_after_bad_device_token_response(self):
        self._set_sync_blob(1, {"bookmarkedOrgs": ["Road Authority"], "notificationPrefs": {"notifyOrgAlertsOn": True}})
        self._register_device(last_pushed_at=time.time() - 10)
        self._insert_tender(21, "", first_seen_at=time.time())
        dead_result = api_server.apns_push.PushResult(ok=False, should_delete_token=True, error="BadDeviceToken")
        with mock.patch.object(api_server.apns_push, "send", return_value=dead_result), \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 2
            api_server._run_push_notification_pass()
        conn = sqlite3.connect(core.DB_FILE)
        row = conn.execute("SELECT id FROM client_push_tokens WHERE token=?", ("device-token-aaaa",)).fetchone()
        conn.close()
        self.assertIsNone(row)

    def test_record_field_change_if_different_only_records_a_real_change(self):
        self._insert_tender(30, "", first_seen_at=time.time())
        conn = sqlite3.connect(core.DB_FILE)
        core.ScraperBackend._record_field_change_if_different(conn, 30, "status", None, "Active")
        core.ScraperBackend._record_field_change_if_different(conn, 30, "status", "Active", "Active")
        conn.commit()
        rows = conn.execute(
            "SELECT changed_fields FROM tender_history WHERE tender_db_id=?", (30,)
        ).fetchall()
        conn.close()
        self.assertEqual(len(rows), 1)
        self.assertEqual(json.loads(rows[0][0]), ["status"])

    def test_status_change_is_pushed_as_a_tender_alert(self):
        self._set_sync_blob(1, {"bookmarks": [31], "notificationPrefs": {"notifyTenderAlertsOn": True}})
        self._register_device(last_pushed_at=time.time() - 10)
        self._insert_tender(31, "", first_seen_at=time.time() - 3600)
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("UPDATE tenders SET status='AOC' WHERE id=31")
        core.ScraperBackend._record_field_change_if_different(conn, 31, "status", "", "AOC")
        conn.commit()
        conn.close()
        fake_result = api_server.apns_push.PushResult(ok=True)
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send, \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 2
            sent = api_server._run_push_notification_pass()
        self.assertEqual(sent, 1)
        _, kwargs = fake_send.call_args
        self.assertEqual(kwargs["title"], "Status update")
        self.assertIn("AOC", kwargs["body"])

    def test_tender_change_push_text_combines_multiple_fields(self):
        title, body = api_server._tender_change_push_text(
            {"title": "T-1", "status": "Concluded", "changed_fields": ["status", "closing_date"]}
        )
        self.assertEqual(title, "Tender update")
        self.assertIn("Concluded", body)
        self.assertIn("closing date", body)

        title2, body2 = api_server._tender_change_push_text(
            {"title": "T-2", "changed_fields": ["prebid_count"]}
        )
        self.assertEqual(title2, "Tender update")
        self.assertIn("pre-bid or corrigendum", body2)

    def test_push_download_complete_sends_to_every_registered_device(self):
        self._insert_tender(40, "", first_seen_at=time.time())
        self._register_device(token="device-a", user_id=1)
        self._register_device(token="device-b", user_id=1)
        fake_result = api_server.apns_push.PushResult(ok=True)
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send:
            api_server._push_download_complete({"requested_by_user_id": 1, "tender_db_id": 40})
        self.assertEqual(fake_send.call_count, 2)
        sent_tokens = {c.args[0] for c in fake_send.call_args_list}
        self.assertEqual(sent_tokens, {"device-a", "device-b"})
        for c in fake_send.call_args_list:
            self.assertEqual(c.kwargs["thread_id"], "download")

    def test_push_download_complete_is_a_noop_without_requesting_user(self):
        self._insert_tender(41, "", first_seen_at=time.time())
        self._register_device(token="device-c", user_id=1)
        with mock.patch.object(api_server.apns_push, "send") as fake_send:
            api_server._push_download_complete({"tender_db_id": 41})
        fake_send.assert_not_called()

    def test_push_captcha_needed_sends_to_all_user_devices(self):
        self._register_device(token="captcha-device-a", user_id=1)
        self._register_device(token="captcha-device-b", user_id=1)
        fake_result = api_server.apns_push.PushResult(ok=True)
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send:
            api_server._push_captcha_needed(1, "req-abc")
        self.assertEqual(fake_send.call_count, 2)
        for c in fake_send.call_args_list:
            self.assertEqual(c.kwargs["thread_id"], "captcha")
            self.assertEqual(c.kwargs["extra"], {"captchaId": "req-abc"})
        conn = sqlite3.connect(core.DB_FILE)
        badges = [r[0] for r in conn.execute("SELECT badge_count FROM client_push_tokens WHERE user_id=1").fetchall()]
        conn.close()
        self.assertEqual(sorted(badges), [1, 1])

    def test_answer_captcha_succeeds_for_owner_via_client_api(self):
        now = time.time()
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "INSERT INTO captcha_requests (id,job_id,context,image_base64,status,created_at,expires_at,user_id) "
            "VALUES ('cap-1','job-1','captcha','aGVsbG8=','pending',?,?,1)",
            (now, now + 120),
        )
        conn.commit()
        conn.close()
        result = client_api.client_answer_captcha(
            "cap-1", client_api.CaptchaAnswerRequest(text="XYZ789"), user_id=1,
        )
        self.assertEqual(result, {"ok": True})
        conn = sqlite3.connect(core.DB_FILE)
        row = conn.execute("SELECT status, response_text FROM captcha_requests WHERE id='cap-1'").fetchone()
        conn.close()
        self.assertEqual(row[0], "answered")
        self.assertEqual(row[1], "XYZ789")

    def test_answer_captcha_second_attempt_loses_the_race(self):
        now = time.time()
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "INSERT INTO captcha_requests (id,job_id,context,image_base64,status,created_at,expires_at,user_id) "
            "VALUES ('cap-2','job-1','captcha','aGVsbG8=','pending',?,?,1)",
            (now, now + 120),
        )
        conn.commit()
        conn.close()
        # Simulate the admin console answering first.
        api_server.submit_captcha(api_server.CaptchaSubmitRequest(request_id="cap-2", text="admin-answer"))
        with self.assertRaises(Exception):
            client_api.client_answer_captcha(
                "cap-2", client_api.CaptchaAnswerRequest(text="too-late"), user_id=1,
            )

    def test_update_check_with_no_new_files_does_not_push(self):
        self._insert_tender(50, "", first_seen_at=time.time())
        self._register_device(token="dl-device", user_id=1)
        payload = {"requested_by_user_id": 1, "tender_db_id": 50, "mode": "update"}
        with mock.patch.object(api_server.apns_push, "send") as fake_send:
            pushed = api_server._notify_download_finished(payload, 3, 3)
        self.assertFalse(pushed)
        fake_send.assert_not_called()

    def test_update_check_with_new_files_pushes_new_documents(self):
        self._insert_tender(51, "", first_seen_at=time.time())
        self._register_device(token="dl-device", user_id=1)
        payload = {"requested_by_user_id": 1, "tender_db_id": 51, "mode": "update"}
        fake_result = api_server.apns_push.PushResult(ok=True)
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send:
            pushed = api_server._notify_download_finished(payload, 3, 4)
        self.assertTrue(pushed)
        self.assertEqual(fake_send.call_args.kwargs["title"], "New documents")

    def test_first_download_pushes_even_when_count_is_unchanged(self):
        self._insert_tender(52, "", first_seen_at=time.time())
        self._register_device(token="dl-device", user_id=1)
        payload = {"requested_by_user_id": 1, "tender_db_id": 52, "mode": "full"}
        fake_result = api_server.apns_push.PushResult(ok=True)
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send:
            pushed = api_server._notify_download_finished(payload, 0, 0)
        self.assertTrue(pushed)
        self.assertEqual(fake_send.call_args.kwargs["title"], "Download complete")

    def test_tender_document_count_counts_this_tenders_files(self):
        self._insert_tender(53, "", first_seen_at=time.time())
        self.assertEqual(api_server._tender_document_count(53), 0)
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("INSERT INTO downloaded_files (tender_id, file_name) VALUES ('T-53', 'a.pdf')")
        conn.execute("INSERT INTO downloaded_files (tender_id, file_name) VALUES ('T-999', 'other.pdf')")
        conn.commit()
        conn.close()
        self.assertEqual(api_server._tender_document_count(53), 1)

    @staticmethod
    def _ist_closing(hours_ago):
        ist = real_datetime.timezone(real_datetime.timedelta(hours=5, minutes=30))
        moment = real_datetime.datetime.now(ist) - real_datetime.timedelta(hours=hours_ago)
        return moment.strftime("%d-%b-%Y %I:%M %p")

    def _is_archived(self, tender_id):
        conn = sqlite3.connect(core.DB_FILE)
        row = conn.execute("SELECT COALESCE(is_archived,0) FROM tenders WHERE id=?", (tender_id,)).fetchone()
        conn.close()
        return bool(row[0])

    def test_archive_cutoff_is_24h_in_ist(self):
        self._insert_tender(60, self._ist_closing(30))
        self._insert_tender(61, self._ist_closing(20))
        core.ScraperBackend.archive_completed_tenders_logic(1, emit_log=False)
        self.assertTrue(self._is_archived(60))
        self.assertFalse(self._is_archived(61))

    def test_archive_sweep_runs_during_scraper_downtime(self):
        self._insert_tender(62, self._ist_closing(72))
        with mock.patch("api_server.datetime") as fake_dt,                 mock.patch.object(api_server, "_within_downtime", return_value=True):
            fake_dt.now.return_value.hour = 22
            archived = api_server._run_expired_tender_sweep()
        self.assertGreaterEqual(archived, 1)
        self.assertTrue(self._is_archived(62))

    @staticmethod
    def _closing_in(days):
        d = _REFERENCE_DATE + real_datetime.timedelta(days=days)
        return d.strftime("%d-%b-%Y")


if __name__ == "__main__":
    unittest.main()
