import unittest
from datetime import datetime
from unittest import mock
from zoneinfo import ZoneInfo

import api_server


IST = ZoneInfo("Asia/Kolkata")


def _epoch_at(hour, minute=0):
    return datetime(2026, 8, 24, hour, minute, tzinfo=IST).timestamp()


class ScrapeWindowTests(unittest.TestCase):
    def test_window_boundaries(self):
        self.assertFalse(api_server._within_scrape_window(_epoch_at(8, 59)))
        self.assertTrue(api_server._within_scrape_window(_epoch_at(9, 0)))
        self.assertTrue(api_server._within_scrape_window(_epoch_at(20, 59)))
        self.assertFalse(api_server._within_scrape_window(_epoch_at(21, 0)))

    def test_night_hours_are_blocked(self):
        for hour in (0, 3, 6, 22, 23):
            with self.subTest(hour=hour):
                self.assertFalse(api_server._within_scrape_window(_epoch_at(hour)))

    def test_daytime_hours_are_allowed(self):
        for hour in range(9, 21):
            with self.subTest(hour=hour):
                self.assertTrue(api_server._within_scrape_window(_epoch_at(hour)))


class SchedulerGatingTests(unittest.TestCase):
    def test_consolidated_pass_short_circuits_outside_window_without_touching_the_db(self):
        # get_db() is deliberately left unmocked here: if this called it
        # before returning, the test would error trying to open a real
        # connection — proving the window check runs before any DB access.
        with mock.patch.object(api_server, "_within_scrape_window", return_value=False), \
             mock.patch.object(api_server, "_scheduler_enabled", return_value=True), \
             mock.patch.object(api_server, "_saved_job_scheduler_enabled", return_value=True):
            self.assertEqual(api_server._run_consolidated_scrape_pass(), 0)

    def test_consolidated_pass_short_circuits_when_both_trigger_families_are_disabled(self):
        # Neither enabled means nothing to gather — should return before even
        # checking the time window (also DB-free).
        with mock.patch.object(api_server, "_scheduler_enabled", return_value=False), \
             mock.patch.object(api_server, "_saved_job_scheduler_enabled", return_value=False), \
             mock.patch.object(api_server, "_within_scrape_window") as window_mock:
            self.assertEqual(api_server._run_consolidated_scrape_pass(), 0)
            window_mock.assert_not_called()


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
