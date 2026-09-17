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

    def test_refresh_organizations_only_refreshes_orgs(self):
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

    def test_put_config_rejects_a_bad_gemini_key_without_writing(self):
        db = _DatabaseContext()
        with mock.patch.object(api_server.core.ScraperBackend, "get_setting", side_effect=lambda k, d="": {"captcha_ai_provider": "gemini", "captcha_ai_model": "gemini-2.5-flash"}.get(k, d)), \
             mock.patch.object(api_server.core.ScraperBackend, "validate_captcha_ai_config", side_effect=ValueError("Google rejected this Gemini API key.")), \
             mock.patch.object(api_server, "get_db", return_value=db):
            with self.assertRaises(api_server.HTTPException) as ctx:
                api_server.admin_put_config(
                    api_server.AdminConfigPatch(settings={"captcha_ai_api_key": "bad-key"})
                )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("rejected", ctx.exception.detail.lower())
        db.connection.executemany.assert_not_called()

    def test_put_config_writes_when_gemini_key_validates(self):
        db = _DatabaseContext()
        with mock.patch.object(api_server.core.ScraperBackend, "get_setting", side_effect=lambda k, d="": {"captcha_ai_provider": "gemini", "captcha_ai_model": "gemini-2.5-flash"}.get(k, d)), \
             mock.patch.object(api_server.core.ScraperBackend, "validate_captcha_ai_config", return_value=None), \
             mock.patch.object(api_server.core.ScraperBackend, "invalidate_settings_cache"), \
             mock.patch.object(api_server, "_admin_config_payload", return_value={"settings": {}}), \
             mock.patch.object(api_server, "get_db", return_value=db):
            api_server.admin_put_config(
                api_server.AdminConfigPatch(settings={"captcha_ai_api_key": "good-key"})
            )
        db.connection.executemany.assert_called_once()


if __name__ == "__main__":
    unittest.main()
