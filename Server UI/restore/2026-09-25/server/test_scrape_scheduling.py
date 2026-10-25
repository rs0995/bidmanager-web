import unittest
from datetime import datetime
from unittest import mock
from zoneinfo import ZoneInfo

import api_server


IST = ZoneInfo("Asia/Kolkata")


def _epoch_at(hour, minute=0, day=24):
    return datetime(2026, 8, day, hour, minute, tzinfo=IST).timestamp()


class SchedulerGatingTests(unittest.TestCase):
    def test_consolidated_pass_short_circuits_when_both_trigger_families_are_disabled(self):
        # Neither enabled means nothing to gather — should return before any
        # DB access (get_db is left unmocked to prove it).
        with mock.patch.object(api_server, "_scheduler_enabled", return_value=False), \
             mock.patch.object(api_server, "_saved_job_scheduler_enabled", return_value=False):
            self.assertEqual(api_server._run_consolidated_scrape_pass(), 0)


class SchedulerDowntimeTests(unittest.TestCase):
    def _settings(self, frm, to, days=""):
        return mock.patch.object(
            api_server.core.ScraperBackend, "get_setting",
            side_effect=lambda k, d=None: {
                "scheduler_downtime_from": frm, "scheduler_downtime_to": to,
                "scheduler_downtime_days": days,
            }.get(k, d),
        )

    def test_within_downtime_normal_window(self):
        with self._settings("09:00", "18:00"):
            self.assertEqual(api_server._downtime_window(), (540, 1080))
            self.assertTrue(api_server._within_downtime(_epoch_at(12)))
            self.assertFalse(api_server._within_downtime(_epoch_at(8, 59)))
            self.assertFalse(api_server._within_downtime(_epoch_at(18, 0)))

    def test_within_downtime_overnight_window(self):
        with self._settings("22:00", "06:00"):
            self.assertTrue(api_server._within_downtime(_epoch_at(23)))
            self.assertTrue(api_server._within_downtime(_epoch_at(3)))
            self.assertFalse(api_server._within_downtime(_epoch_at(12)))

    def test_within_downtime_disabled_when_unset_or_equal(self):
        with self._settings("", ""):
            self.assertIsNone(api_server._downtime_window())
            self.assertFalse(api_server._within_downtime(_epoch_at(12)))
        with self._settings("09:00", "09:00"):
            self.assertIsNone(api_server._downtime_window())

    def test_defer_past_downtime(self):
        with self._settings("09:00", "18:00"):
            deferred = api_server._defer_past_downtime(_epoch_at(12))
            self.assertEqual(deferred, _epoch_at(18, 0))
            unchanged = api_server._defer_past_downtime(_epoch_at(20))
            self.assertEqual(unchanged, _epoch_at(20))
        with self._settings("22:00", "06:00"):
            # pre-midnight half -> 'to' is the next day
            deferred = api_server._defer_past_downtime(_epoch_at(23))
            self.assertEqual(deferred, _epoch_at(6, 0, day=25))

    def test_within_downtime_paused_weekdays_full_day(self):
        with self._settings("", "", days="sat,sun"):
            self.assertTrue(api_server._within_downtime(_epoch_at(0, 0, day=22)))  # Saturday
            self.assertTrue(api_server._within_downtime(_epoch_at(23, 59, day=23)))  # Sunday
            self.assertFalse(api_server._within_downtime(_epoch_at(12, day=24)))  # Monday

    def test_within_downtime_paused_weekday_overrides_time_window(self):
        # Weekday pause applies all day, even outside the configured time window.
        with self._settings("09:00", "18:00", days="sat"):
            self.assertTrue(api_server._within_downtime(_epoch_at(2, 0, day=22)))  # Saturday, before window

    def test_defer_past_downtime_skips_consecutive_paused_weekdays(self):
        with self._settings("", "", days="sat,sun"):
            deferred = api_server._defer_past_downtime(_epoch_at(10, 0, day=22))  # Saturday
            self.assertEqual(deferred, _epoch_at(0, 0, day=24))  # Monday 00:00

    def test_defer_past_downtime_combines_weekday_pause_and_time_window(self):
        with self._settings("22:00", "06:00", days="sun"):
            # Saturday 23:00 is within the overnight window -> defers to Sunday 06:00,
            # but Sunday is a fully paused day -> jumps to Monday 00:00, which is still
            # within the (daily, weekday-independent) overnight window -> defers once
            # more to Monday 06:00, the first moment that's clear of both.
            deferred = api_server._defer_past_downtime(_epoch_at(23, 0, day=22))
            self.assertEqual(deferred, _epoch_at(6, 0, day=24))

    def test_consolidated_pass_short_circuits_during_downtime_without_touching_the_db(self):
        with mock.patch.object(api_server, "_within_downtime", return_value=True), \
             mock.patch.object(api_server, "_scheduler_enabled", return_value=True), \
             mock.patch.object(api_server, "_saved_job_scheduler_enabled", return_value=True):
            self.assertEqual(api_server._run_consolidated_scrape_pass(), 0)


class JobDedupeKeyTests(unittest.TestCase):
    def test_consolidated_schedule_source_dedupes_by_website_only(self):
        key_a = api_server._job_dedupe_key(
            "fetch_tenders_selected",
            {"website_id": 5, "org_ids": [1, 2], "source": "consolidated-schedule"},
        )
        key_b = api_server._job_dedupe_key(
            "fetch_tenders_selected",
            {"website_id": 5, "org_ids": [3], "source": "consolidated-schedule"},
        )
        self.assertTrue(key_a)
        self.assertEqual(key_a, key_b)

    def test_different_websites_never_share_a_dedupe_key(self):
        key_a = api_server._job_dedupe_key(
            "fetch_tenders_selected", {"website_id": 1, "org_ids": [1], "source": "consolidated-schedule"},
        )
        key_b = api_server._job_dedupe_key(
            "fetch_tenders_selected", {"website_id": 2, "org_ids": [1], "source": "consolidated-schedule"},
        )
        self.assertNotEqual(key_a, key_b)

    def test_custom_sources_still_dedupe_by_exact_org_set(self):
        key_a = api_server._job_dedupe_key(
            "fetch_tenders_selected", {"website_id": 1, "org_ids": [1, 2], "source": "custom"},
        )
        key_b = api_server._job_dedupe_key(
            "fetch_tenders_selected", {"website_id": 1, "org_ids": [1], "source": "custom"},
        )
        self.assertNotEqual(key_a, key_b)


if __name__ == "__main__":
    unittest.main()
