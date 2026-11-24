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
            "download_tenders",
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
            "refresh_tender_details",
            {"website_id": 2, "target_db_ids": [10, 12], "source": "custom"},
        )

    def test_saved_scrape_job_allows_all_organizations_without_org_ids(self):
        conn = mock.Mock()
        conn.execute.return_value.fetchone.return_value = (5,)
        with mock.patch.object(api_server, "get_db", return_value=_Context(conn)):
            value = api_server._validated_saved_custom_job(
                api_server.SavedCustomJobRequest(
                    owner_name="Alice", name="Whole site", website_id=5,
                    job_type="scrape", org_ids=[], all_organizations=True,
                )
            )
        self.assertTrue(value["all_organizations"])
        self.assertEqual(value["org_ids"], [])

    def test_saved_scrape_job_without_orgs_or_all_organizations_rejected(self):
        conn = mock.Mock()
        conn.execute.return_value.fetchone.return_value = (5,)
        with mock.patch.object(api_server, "get_db", return_value=_Context(conn)):
            with self.assertRaises(api_server.HTTPException):
                api_server._validated_saved_custom_job(
                    api_server.SavedCustomJobRequest(
                        owner_name="Alice", name="No scope", website_id=5,
                        job_type="scrape", org_ids=[],
                    )
                )

    def test_auto_download_mode_uses_existing_main_files(self):
        # Blobs present AND both main files recorded as completed downloads.
        with mock.patch.object(
            api_server.core.ScraperBackend,
            "_has_required_full_download_artifacts",
            return_value=(True, []),
        ), mock.patch.object(
            api_server.core.ScraperBackend,
            "_main_download_ledger_complete",
            return_value=(True, []),
        ):
            self.assertEqual(
                api_server.core.ScraperBackend._resolve_download_mode("auto", "T-1", "folder"),
                "update",
            )
        # Blobs present but the ledger has no completed row for the zip -> full.
        with mock.patch.object(
            api_server.core.ScraperBackend,
            "_has_required_full_download_artifacts",
            return_value=(True, []),
        ), mock.patch.object(
            api_server.core.ScraperBackend,
            "_main_download_ledger_complete",
            return_value=(False, ["zip"]),
        ):
            self.assertEqual(
                api_server.core.ScraperBackend._resolve_download_mode("auto", "T-1", "folder"),
                "full",
            )
        # Blobs missing -> full, ledger not consulted.
        with mock.patch.object(
            api_server.core.ScraperBackend,
            "_has_required_full_download_artifacts",
            return_value=(False, ["notice"]),
        ):
            self.assertEqual(
                api_server.core.ScraperBackend._resolve_download_mode("auto", "T-1", "folder"),
                "full",
            )

    def test_main_download_ledger_complete_requires_completed_rows(self):
        import os
        import sqlite3
        import tempfile

        backend = api_server.core.ScraperBackend
        tmpdir = tempfile.TemporaryDirectory(prefix="bidmanager-ledger-", ignore_cleanup_errors=True)
        db_path = os.path.join(tmpdir.name, "ledger.db")
        try:
            conn = sqlite3.connect(db_path)
            conn.execute(
                "CREATE TABLE downloaded_files ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, tender_id TEXT, file_name TEXT, "
                "file_type TEXT, download_status TEXT DEFAULT 'complete', file_size_bytes INTEGER)"
            )
            conn.commit()
            conn.close()

            with mock.patch.object(api_server.core, "DB_FILE", db_path):
                self.assertEqual(
                    backend._main_download_ledger_complete("T-1"), (False, ["notice", "zip"])
                )

                conn = sqlite3.connect(db_path)
                conn.executemany(
                    "INSERT INTO downloaded_files "
                    "(tender_id,file_name,file_type,download_status,file_size_bytes) VALUES (?,?,?,?,?)",
                    [
                        ("T-1", "Tendernotice_T-1.pdf", "notice", "complete", 1234),
                        ("T-1", "T-1.zip", "zip", "complete", 999999),
                    ],
                )
                conn.commit()
                conn.close()
                self.assertEqual(backend._main_download_ledger_complete("t-1"), (True, []))

                conn = sqlite3.connect(db_path)
                conn.execute(
                    "UPDATE downloaded_files SET download_status='partial' WHERE file_type='zip'"
                )
                conn.commit()
                conn.close()
                self.assertEqual(backend._main_download_ledger_complete("T-1"), (False, ["zip"]))

                conn = sqlite3.connect(db_path)
                conn.execute(
                    "UPDATE downloaded_files SET download_status='complete' WHERE file_type='zip'"
                )
                conn.execute(
                    "UPDATE downloaded_files SET file_size_bytes=0 WHERE file_type='notice'"
                )
                conn.commit()
                conn.close()
                self.assertEqual(
                    backend._main_download_ledger_complete("T-1"), (False, ["notice"])
                )
        finally:
            os.remove(db_path)

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
