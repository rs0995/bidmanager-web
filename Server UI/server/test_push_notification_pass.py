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

    def _register_device(self, token="device-token-aaaa", user_id=1, last_pushed_at=0, last_reminder_date="",
                         app="bmpro", apns_env="production"):
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "INSERT INTO client_push_tokens (user_id, token, platform, app, apns_env, created_at, last_seen_at, "
            "last_pushed_at, last_reminder_date) VALUES (?,?,?,?,?,?,?,?,?)",
            (user_id, token, "ios", app, apns_env, time.time(), time.time(), last_pushed_at, last_reminder_date),
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
        self._register_device(last_pushed_at=time.time() - 600)
        self._insert_tender(20, "", first_seen_at=time.time() - 300)
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

    def _pass_again(self, fake_result):
        # Each run holds a short lease so runs never overlap; release it between runs here.
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("UPDATE scheduler_leases SET lease_until=0, last_run_at=NULL WHERE name='push-notifications'")
        conn.commit()
        conn.close()
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send, \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 2
            sent = api_server._run_push_notification_pass()
        return sent, fake_send

    def test_tender_saved_after_a_pass_is_pushed_even_if_stamped_before_it(self):
        # A scrape stamps a row when it writes it but commits the page later: the pass
        # that ran in between saw nothing, and the next one must still push it -- once.
        self._set_sync_blob(1, {"bookmarkedOrgs": ["Road Authority"], "notificationPrefs": {"notifyOrgAlertsOn": True}})
        self._register_device(last_pushed_at=time.time() - 600)
        ok = api_server.apns_push.PushResult(ok=True)
        sent, _ = self._pass_again(ok)
        self.assertEqual(sent, 0)
        self._insert_tender(23, "", first_seen_at=time.time() - 30)  # stamped before that pass
        sent, fake_send = self._pass_again(ok)
        self.assertEqual(sent, 1)
        self.assertIn("Tender 23", fake_send.call_args.kwargs["body"])
        sent, fake_send = self._pass_again(ok)
        self.assertEqual(sent, 0)
        fake_send.assert_not_called()
        handled = self._row("SELECT handled_at FROM push_handled_events WHERE kind='new' AND ref_id=23", ())
        self.assertIsNotNone(handled)

    def test_tender_change_is_pushed_once(self):
        self._set_sync_blob(1, {"bookmarks": [32], "notificationPrefs": {"notifyTenderAlertsOn": True}})
        self._register_device(last_pushed_at=time.time() - 600)
        self._insert_tender(32, "", first_seen_at=time.time() - 3600)
        conn = sqlite3.connect(core.DB_FILE)
        core.ScraperBackend._record_field_change_if_different(conn, 32, "status", "", "AOC")
        conn.execute("UPDATE tender_history SET scraped_at=? WHERE tender_db_id=32", (time.time() - 300,))
        conn.commit()
        conn.close()
        ok = api_server.apns_push.PushResult(ok=True)
        self.assertEqual(self._pass_again(ok)[0], 1)
        self.assertEqual(self._pass_again(ok)[0], 0)

    def test_device_gets_nothing_from_before_it_registered(self):
        self._set_sync_blob(1, {"bookmarkedOrgs": ["Road Authority"], "notificationPrefs": {"notifyOrgAlertsOn": True}})
        self._insert_tender(24, "", first_seen_at=time.time() - 300)
        self._register_device(last_pushed_at=time.time() - 60)
        sent, fake_send = self._pass_again(api_server.apns_push.PushResult(ok=True))
        self.assertEqual(sent, 0)
        fake_send.assert_not_called()
        # Handled anyway, so it never comes up again.
        self.assertIsNotNone(
            self._row("SELECT 1 FROM push_handled_events WHERE kind='new' AND ref_id=24", ())
        )

    def test_org_alert_push_carries_an_incrementing_badge(self):
        self._set_sync_blob(1, {"bookmarkedOrgs": ["Road Authority"], "notificationPrefs": {"notifyOrgAlertsOn": True}})
        self._register_device(last_pushed_at=time.time() - 600)
        self._insert_tender(22, "", first_seen_at=time.time() - 300)
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
        self._register_device(last_pushed_at=time.time() - 600)
        self._insert_tender(21, "", first_seen_at=time.time() - 300)
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
        self._register_device(last_pushed_at=time.time() - 600)
        self._insert_tender(31, "", first_seen_at=time.time() - 3600)
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("UPDATE tenders SET status='AOC' WHERE id=31")
        core.ScraperBackend._record_field_change_if_different(conn, 31, "status", "", "AOC")
        conn.execute("UPDATE tender_history SET scraped_at=? WHERE tender_db_id=31", (time.time() - 300,))
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

    def _org_pass(self, fake_result):
        # Each run holds a short lease so runs never overlap; release it between runs here.
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("UPDATE scheduler_leases SET lease_until=0, last_run_at=NULL WHERE name='push-notifications'")
        conn.commit()
        conn.close()
        with mock.patch.object(api_server.apns_push, "send", return_value=fake_result) as fake_send, \
                mock.patch("api_server.datetime") as fake_dt:
            fake_dt.now.return_value.hour = 7  # outside the reminder window: org pushes only
            api_server._run_push_notification_pass()
        return fake_send

    def _bidwise_org_setup(self):
        self._set_sync_blob(1, {"bookmarkedOrgs": ["Road Authority"],
                                "notificationPrefs": {"notifyOrgAlertsOn": True}})
        self._register_device(token="bidwise-device", user_id=1, last_pushed_at=time.time() - 7200,
                              app="bidwise", apns_env="production")

    def _set_cursor(self, token, at):
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("UPDATE client_push_tokens SET last_pushed_at=? WHERE token=?", (at, token))
        conn.commit()
        conn.close()

    def _row(self, sql, args):
        conn = sqlite3.connect(core.DB_FILE)
        try:
            return conn.execute(sql, args).fetchone()
        finally:
            conn.close()

    def test_bidwise_org_pushes_group_until_read_and_badge_counts_once(self):
        self._bidwise_org_setup()
        self._insert_tender(70, "", first_seen_at=time.time() - 3600)
        self._insert_tender(71, "", first_seen_at=time.time() - 3600)
        ok = api_server.apns_push.PushResult(ok=True)
        first = self._org_pass(ok)
        self.assertEqual(first.call_count, 1)
        kw = first.call_args.kwargs
        self.assertEqual(kw["title"], "New tenders")
        self.assertEqual(kw["body"], "2 new tenders added under Road Authority.")
        self.assertEqual(kw["badge"], 1)
        collapse = kw["collapse_id"]
        self.assertTrue(collapse.startswith("org-"))

        # Two more arrive before it's read: one grouped push, same id, badge unchanged.
        self._set_cursor("bidwise-device", time.time() - 600)
        self._insert_tender(72, "", first_seen_at=time.time() - 300)
        self._insert_tender(73, "", first_seen_at=time.time() - 300)
        second = self._org_pass(ok)
        kw = second.call_args.kwargs
        self.assertEqual(kw["body"], "4 new tenders added under Road Authority.")
        self.assertEqual(kw["collapse_id"], collapse)
        self.assertEqual(kw["badge"], 1)

        # The app reports it read (not in unread_orgs): the next tender starts afresh.
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("UPDATE client_push_tokens SET pending_orgs='{}', badge_count=0 WHERE token=?",
                     ("bidwise-device",))
        conn.commit()
        conn.close()
        self._set_cursor("bidwise-device", time.time() - 250)
        self._insert_tender(74, "", first_seen_at=time.time() - 200)
        third = self._org_pass(ok)
        kw = third.call_args.kwargs
        self.assertEqual(kw["body"], '"Tender 74" added under Road Authority.')
        self.assertEqual(kw["badge"], 1)

    def test_bmpro_org_push_is_unchanged(self):
        self._set_sync_blob(1, {"bookmarkedOrgs": ["Road Authority"],
                                "notificationPrefs": {"notifyOrgAlertsOn": True}})
        self._register_device(token="bmpro-device", user_id=1, last_pushed_at=time.time() - 7200)
        for tid in (80, 81, 82, 83):
            self._insert_tender(tid, "", first_seen_at=time.time() - 3600)
        sent = self._org_pass(api_server.apns_push.PushResult(ok=True))
        kw = sent.call_args.kwargs
        self.assertEqual(kw["body"], "4 new tenders added under Road Authority.")
        self.assertNotIn("collapse_id", kw)
        self.assertEqual(self._row("SELECT pending_orgs FROM client_push_tokens WHERE token=?",
                                   ("bmpro-device",))[0], "{}")

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
