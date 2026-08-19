import unittest
from unittest import mock

import api_server


class _DatabaseContext:
    def __init__(self, row=(1,)):
        self.connection = mock.Mock()
        self.connection.execute.return_value.fetchone.return_value = row

    def __enter__(self):
        return self.connection

    def __exit__(self, exc_type, exc, traceback):
        return False


class _SettingsDatabaseContext:
    def __init__(self, rows):
        self.connection = mock.Mock()
        self.connection.execute.return_value.fetchall.return_value = rows

    def __enter__(self):
        return self.connection

    def __exit__(self, exc_type, exc, traceback):
        return False


class AdminScrapeTests(unittest.TestCase):
    def test_admin_config_masks_saved_captcha_api_key(self):
        rows = [
            {"key": "captcha_ai_provider", "value": "anthropic"},
            {"key": "captcha_ai_api_key", "value": "server-secret"},
        ]
        with mock.patch.object(api_server, "get_db", return_value=_SettingsDatabaseContext(rows)), mock.patch.dict(
            api_server.os.environ, {}, clear=True
        ), mock.patch.object(api_server.security, "is_cloud_environment", return_value=False):
            settings = api_server._admin_config_payload()["settings"]

        self.assertEqual(settings["captcha_ai_api_key"], "")
        self.assertTrue(settings["captcha_ai_api_key_set"])
        self.assertEqual(settings["captcha_ai_provider"], "anthropic")

    def test_refresh_organizations_queues_tender_followup(self):
        queued = {"job_id": "job-1", "status": "queued"}
        with mock.patch.object(api_server, "get_db", return_value=_DatabaseContext()), mock.patch.object(
            api_server, "_enqueue_job", return_value=queued
        ) as enqueue:
            result = api_server.admin_start_scrape(
                api_server.AdminScrapeStart(website_id=2, refresh_organizations=True)
            )

        self.assertEqual(result, queued)
        enqueue.assert_called_once_with(
            "fetch_organisations",
            {
                "website_id": 2,
                "source": "admin",
                "followup_action": "fetch_tenders",
                "followup_all_organizations": True,
                "download_after": False,
            },
        )

    def test_tender_only_run_queues_tender_fetch(self):
        with mock.patch.object(api_server, "get_db", return_value=_DatabaseContext()), mock.patch.object(
            api_server, "_enqueue_job", return_value={"job_id": "job-2", "status": "queued"}
        ) as enqueue:
            api_server.admin_start_scrape(
                api_server.AdminScrapeStart(website_id=3, refresh_organizations=False)
            )

        enqueue.assert_called_once_with(
            "fetch_tenders",
            {"website_id": 3, "source": "admin"},
        )


if __name__ == "__main__":
    unittest.main()
