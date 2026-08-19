import unittest
from unittest import mock

import api_server


class _Context:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self.connection

    def __exit__(self, exc_type, exc, traceback):
        return False


class CustomJobTests(unittest.TestCase):
    def test_fetch_all_resolves_every_organization_on_server(self):
        conn = mock.Mock()
        conn.execute.return_value.fetchall.return_value = [(7,), (9,)]
        queued = {"job_id": "job-all", "status": "queued"}
        with mock.patch.object(api_server, "get_db", return_value=_Context(conn)), mock.patch.object(
            api_server, "_enqueue_job", return_value=queued
        ) as enqueue:
            result = api_server.fetch_all_tenders(3)
        self.assertEqual(result, queued)
        enqueue.assert_called_once_with(
            "fetch_tenders_selected",
            {
                "website_id": 3,
                "org_ids": [7, 9],
                "download_after": False,
                "source": "custom-all",
            },
        )

    def test_selected_download_passes_exact_ids_and_mode(self):
        conn = mock.Mock()
        conn.execute.return_value.fetchone.return_value = (2,)
        queued = {"job_id": "job-download", "status": "queued"}
        with mock.patch.object(api_server, "get_db", return_value=_Context(conn)), mock.patch.object(
            api_server, "_enqueue_job", return_value=queued
        ) as enqueue:
            result = api_server.download_tender_batch(
                2,
                api_server.BatchTenderDownloadRequest(
                    tender_ids=[12, 10, 12], all_tenders=False, mode="update"
                ),
            )
        self.assertEqual(result, queued)
        enqueue.assert_called_once_with(
            "refresh_and_download_tenders",
            {
                "website_id": 2,
                "target_db_ids": [10, 12],
                "include_all": False,
                "mode": "update",
                "source": "custom",
            },
        )

    def test_selected_tender_run_queues_refresh_without_download(self):
        conn = mock.Mock()
        conn.execute.return_value.fetchone.return_value = (2,)
        queued = {"job_id": "job-refresh", "status": "queued"}
        with mock.patch.object(api_server, "get_db", return_value=_Context(conn)), mock.patch.object(
            api_server, "_enqueue_job", return_value=queued
        ) as enqueue:
            result = api_server.refresh_tender_batch(
                2, api_server.BatchTenderDownloadRequest(tender_ids=[12, 10, 12])
            )
        self.assertEqual(result, queued)
        enqueue.assert_called_once_with(
            "refresh_selected_tenders",
            {"website_id": 2, "target_db_ids": [10, 12], "source": "custom"},
        )

    def test_auto_download_mode_uses_existing_main_files(self):
        with mock.patch.object(
            api_server.core.ScraperBackend,
            "_has_required_full_download_artifacts",
            return_value=(True, []),
        ):
            self.assertEqual(
                api_server.core.ScraperBackend._resolve_download_mode("auto", "T-1", "folder"),
                "update",
            )
        with mock.patch.object(
            api_server.core.ScraperBackend,
            "_has_required_full_download_artifacts",
            return_value=(False, ["notice"]),
        ):
            self.assertEqual(
                api_server.core.ScraperBackend._resolve_download_mode("auto", "T-1", "folder"),
                "full",
            )

    def test_download_worker_receives_batch_scope(self):
        with mock.patch.object(
            api_server.core.ScraperBackend, "download_tenders_logic", return_value=True
        ) as download:
            result = api_server._job_callable(
                "download_tenders",
                {
                    "website_id": 1,
                    "target_db_ids": [4, 5],
                    "mode": "full",
                    "include_all": False,
                },
            )
        self.assertTrue(result)
        download.assert_called_once_with(
            1, target_db_ids=[4, 5], forced_mode="full", include_all=False
        )

    def test_batch_schedule_validates_website_and_updates_each_tender(self):
        conn = mock.Mock()
        conn.execute.return_value.fetchall.return_value = [(4,), (5,)]
        with mock.patch.object(api_server, "get_db", return_value=_Context(conn)), mock.patch.object(
            api_server.core.ScraperBackend, "set_tender_scrape_schedule", return_value=True
        ) as schedule:
            result = api_server.schedule_tender_batch(
                1,
                api_server.BatchTenderScheduleRequest(
                    tender_ids=[5, 4], interval_minutes=90, enabled=True
                ),
            )
        self.assertEqual(result, {"ok": True, "updated": 2})
        self.assertEqual(
            schedule.call_args_list,
            [mock.call(4, 90, True), mock.call(5, 90, True)],
        )


if __name__ == "__main__":
    unittest.main()
