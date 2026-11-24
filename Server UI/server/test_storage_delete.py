import os
import sqlite3
import tempfile
import types
import unittest
from unittest import mock

import admin_providers
import api_server


class _FakeHttpError(Exception):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.resp = types.SimpleNamespace(status=status)


class DriveDeleteTrashesTests(unittest.TestCase):
    def _provider(self):
        p = admin_providers.HybridStorageProvider()
        return p

    def test_delete_trashes_instead_of_permanently_deleting(self):
        provider = self._provider()
        with mock.patch.object(provider, "metadata", return_value={"provider": "google-drive"}), \
             mock.patch.object(provider, "_drive_id_for_path", return_value="FILE_ID"), \
             mock.patch.object(admin_providers.drive_storage, "trash") as trash, \
             mock.patch.object(
                 admin_providers.drive_storage, "_drive_service", create=True
             ) as service:
            result = provider.delete("tenders/2026_X_1_1")
        self.assertEqual(result, {"ok": True})
        trash.assert_called_once_with("FILE_ID")
        service.assert_not_called()  # no files().delete() path

    def test_delete_treats_drive_404_as_already_gone(self):
        provider = self._provider()
        with mock.patch.object(provider, "metadata", return_value={"provider": "google-drive"}), \
             mock.patch.object(provider, "_drive_id_for_path", return_value="STALE_ID"), \
             mock.patch.object(
                 admin_providers.drive_storage, "trash", side_effect=_FakeHttpError(404)
             ):
            result = provider.delete("tenders/2026_X_1_1")
        self.assertEqual(result, {"ok": True})

    def test_delete_reraises_other_drive_errors(self):
        provider = self._provider()
        with mock.patch.object(provider, "metadata", return_value={"provider": "google-drive"}), \
             mock.patch.object(provider, "_drive_id_for_path", return_value="FILE_ID"), \
             mock.patch.object(
                 admin_providers.drive_storage, "trash", side_effect=_FakeHttpError(500)
             ):
            with self.assertRaises(_FakeHttpError):
                provider.delete("tenders/2026_X_1_1")


class ForgetDeletedDownloadsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db = os.path.join(self.tmp.name, "t.db")
        conn = sqlite3.connect(self.db)
        conn.executescript(
            """
            CREATE TABLE downloaded_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT, tender_id TEXT, file_name TEXT,
                file_type TEXT, download_status TEXT DEFAULT 'complete', file_size_bytes INTEGER
            );
            CREATE TABLE tenders (
                id INTEGER PRIMARY KEY AUTOINCREMENT, tender_id TEXT, is_downloaded INTEGER DEFAULT 0,
                download_status TEXT, last_downloaded_at REAL, initial_download_completed_at REAL,
                last_download_error TEXT
            );
            """
        )
        conn.executemany(
            "INSERT INTO downloaded_files (tender_id,file_name,file_type,download_status,file_size_bytes) "
            "VALUES (?,?,?,?,?)",
            [
                ("2026_X_1_1", "Tendernotice_2026_X_1_1.pdf", "notice", "complete", 100),
                ("2026_X_1_1", "2026_X_1_1.zip", "zip", "complete", 200),
                ("2026_X_1_1", "PreBid_Meeting_2026_X_1_1.pdf", "prebid", "complete", 50),
                ("2026_Y_2_1", "2026_Y_2_1.zip", "zip", "complete", 300),
            ],
        )
        conn.execute(
            "INSERT INTO tenders (tender_id,is_downloaded,download_status) VALUES ('2026_X_1_1',1,'complete')"
        )
        conn.execute(
            "INSERT INTO tenders (tender_id,is_downloaded,download_status) VALUES ('2026_Y_2_1',1,'complete')"
        )
        conn.commit()
        conn.close()
        self.p = [
            mock.patch.object(api_server.core, "DB_FILE", self.db),
            mock.patch.object(
                api_server.core.ScraperBackend, "get_setting",
                staticmethod(lambda key, default=None: "tenders/" if key == "storage_prefix" else default),
            ),
        ]
        for patch in self.p:
            patch.start()
        self.addCleanup(lambda: [patch.stop() for patch in self.p])
        self.addCleanup(self.tmp.cleanup)

    def _rows(self, sql, params=()):
        conn = sqlite3.connect(self.db)
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    def test_folder_delete_clears_ledger_and_tender(self):
        api_server._forget_deleted_downloads("tenders/2026_X_1_1")
        self.assertEqual(
            self._rows("SELECT COUNT(*) FROM downloaded_files WHERE tender_id='2026_X_1_1'")[0][0], 0
        )
        row = self._rows("SELECT is_downloaded,download_status FROM tenders WHERE tender_id='2026_X_1_1'")[0]
        self.assertEqual(row[0], 0)
        self.assertEqual(row[1], "deleted")
        # The other tender is untouched.
        self.assertEqual(
            self._rows("SELECT COUNT(*) FROM downloaded_files WHERE tender_id='2026_Y_2_1'")[0][0], 1
        )

    def test_non_main_file_delete_only_removes_that_row(self):
        api_server._forget_deleted_downloads("tenders/2026_X_1_1/PreBid_Meeting_2026_X_1_1.pdf")
        names = {r[0] for r in self._rows(
            "SELECT file_name FROM downloaded_files WHERE tender_id='2026_X_1_1'"
        )}
        self.assertNotIn("PreBid_Meeting_2026_X_1_1.pdf", names)
        self.assertEqual(len(names), 2)
        self.assertEqual(
            self._rows("SELECT is_downloaded FROM tenders WHERE tender_id='2026_X_1_1'")[0][0], 1
        )

    def test_main_file_delete_marks_tender_partial(self):
        api_server._forget_deleted_downloads("tenders/2026_X_1_1/Tendernotice_2026_X_1_1.pdf")
        row = self._rows("SELECT is_downloaded,download_status FROM tenders WHERE tender_id='2026_X_1_1'")[0]
        self.assertEqual(row[0], 0)
        self.assertEqual(row[1], "partial")

    def test_path_outside_prefix_is_a_no_op(self):
        api_server._forget_deleted_downloads("misc/whatever")
        self.assertEqual(self._rows("SELECT COUNT(*) FROM downloaded_files")[0][0], 4)
        self.assertEqual(
            self._rows("SELECT COUNT(*) FROM tenders WHERE is_downloaded=1")[0][0], 2
        )


if __name__ == "__main__":
    unittest.main()
