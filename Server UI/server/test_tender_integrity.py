import os
import tempfile
import time
import unittest

import app_core as core


class TenderIntegrityTests(unittest.TestCase):
    def setUp(self):
        self._old_db_file = core.DB_FILE
        self._temp_dir = tempfile.TemporaryDirectory(
            prefix="bidmanager-integrity-", ignore_cleanup_errors=True
        )
        core.DB_FILE = os.path.join(self._temp_dir.name, "integrity.db")
        core.init_db()

    def tearDown(self):
        core.DB_FILE = self._old_db_file
        self._temp_dir.cleanup()

    @staticmethod
    def _tender(title="Road work", tender_id="NIC/2026/001"):
        return (
            1, "Public Works", tender_id, title, "1000", "100", "20-Aug-2026",
            "21-Aug-2026", "https://example.test/tender?id=1&session=abc", "Pune",
            "Works", "N/A", "16-Aug-2026", "Road improvements",
        )

    def test_canonical_upsert_tracks_only_real_changes(self):
        conn = core.sqlite3.connect(core.DB_FILE)
        first_result = core.ScraperBackend.upsert_tender_row(conn, self._tender())
        conn.commit()
        second_result = core.ScraperBackend.upsert_tender_row(
            conn, self._tender(tender_id=" nic/2026/001 ")
        )
        conn.commit()
        third_result = core.ScraperBackend.upsert_tender_row(
            conn, self._tender(title="Updated road work")
        )
        conn.commit()
        tender_count = conn.execute("SELECT COUNT(*) FROM tenders").fetchone()[0]
        history = conn.execute(
            "SELECT changed_fields FROM tender_history ORDER BY id"
        ).fetchall()
        row = conn.execute(
            "SELECT normalized_tender_id,last_scraped_at,last_changed_at,scrape_count FROM tenders"
        ).fetchone()
        conn.close()
        self.assertEqual(first_result, "inserted")
        self.assertEqual(second_result, "unchanged")
        self.assertEqual(third_result, "updated")
        self.assertEqual(tender_count, 1)
        self.assertEqual(len(history), 2)
        self.assertIn("title", history[-1][0])
        self.assertEqual(row[0], "NIC/2026/001")
        self.assertGreater(float(row[1]), 0)
        self.assertGreater(float(row[2]), 0)
        self.assertEqual(int(row[3]), 3)

    def test_schedule_uses_last_scrape_and_due_timestamp(self):
        conn = core.sqlite3.connect(core.DB_FILE)
        core.ScraperBackend.upsert_tender_row(conn, self._tender())
        conn.commit()
        tender_db_id = conn.execute("SELECT id FROM tenders").fetchone()[0]
        conn.close()

        self.assertTrue(core.ScraperBackend.set_tender_scrape_schedule(tender_db_id, 30, True))
        conn = core.sqlite3.connect(core.DB_FILE)
        row = conn.execute(
            "SELECT last_scraped_at,next_scrape_at,scrape_enabled FROM tenders WHERE id=?",
            (tender_db_id,),
        ).fetchone()
        conn.close()
        self.assertEqual(int(row[2]), 1)
        self.assertAlmostEqual(float(row[1]) - float(row[0]), 1800, delta=2)
        self.assertFalse(core.ScraperBackend.tender_scrape_due(tender_db_id, float(row[1]) - 1))
        self.assertTrue(core.ScraperBackend.tender_scrape_due(tender_db_id, float(row[1])))

    def test_download_ledger_tracks_hash_and_ignores_session_token_changes(self):
        conn = core.sqlite3.connect(core.DB_FILE)
        core.ScraperBackend.upsert_tender_row(conn, self._tender())
        conn.commit()
        conn.close()
        file_path = os.path.join(self._temp_dir.name, "corrigendum.pdf")
        with open(file_path, "wb") as handle:
            handle.write(b"revision-one")
        core.ScraperBackend.log_downloaded_file(
            "NIC/2026/001",
            "corrigendum.pdf",
            file_type="corrigendum",
            source_url="https://example.test/file?doc=10&session=first",
            local_path=file_path,
            content_sha256="known-hash",
        )
        self.assertTrue(
            core.ScraperBackend.should_skip_file(
                "nic/2026/001",
                "corrigendum.pdf",
                file_path,
                source_url="https://example.test/file?session=second&doc=10",
                file_type="corrigendum",
            )
        )
        self.assertFalse(
            core.ScraperBackend.should_skip_file(
                "NIC/2026/001",
                "corrigendum.pdf",
                file_path,
                source_url="https://example.test/file?doc=11",
                file_type="corrigendum",
            )
        )
        conn = core.sqlite3.connect(core.DB_FILE)
        row = conn.execute(
            "SELECT tender_db_id,content_sha256,download_status,last_checked_at "
            "FROM downloaded_files WHERE file_name='corrigendum.pdf'"
        ).fetchone()
        conn.close()
        self.assertIsNotNone(row[0])
        self.assertEqual(row[1], "known-hash")
        self.assertEqual(row[2], "complete")
        self.assertGreater(float(row[3]), 0)

    def test_download_ledger_deduplicates_identical_content(self):
        conn = core.sqlite3.connect(core.DB_FILE)
        core.ScraperBackend.upsert_tender_row(conn, self._tender())
        conn.commit()
        conn.close()
        first_path = os.path.join(self._temp_dir.name, "first.pdf")
        second_path = os.path.join(self._temp_dir.name, "renamed.pdf")
        for path in (first_path, second_path):
            with open(path, "wb") as handle:
                handle.write(b"identical-document")
        core.ScraperBackend.log_downloaded_file(
            "nic/2026/001", "first.pdf", source_url="https://example.test/a",
            local_path=first_path, content_sha256="same-hash", file_size_bytes=18,
        )
        core.ScraperBackend.log_downloaded_file(
            "NIC/2026/001", "renamed.pdf", source_url="https://example.test/b",
            local_path=second_path, content_sha256="same-hash", file_size_bytes=18,
        )
        conn = core.sqlite3.connect(core.DB_FILE)
        rows = conn.execute(
            "SELECT tender_id,content_sha256,seen_count FROM downloaded_files"
        ).fetchall()
        conn.close()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "NIC/2026/001")
        self.assertEqual(rows[0][1], "same-hash")
        self.assertEqual(int(rows[0][2]), 2)

    def test_complete_main_files_mark_tender_downloaded(self):
        conn = core.sqlite3.connect(core.DB_FILE)
        core.ScraperBackend.upsert_tender_row(conn, self._tender())
        conn.commit()
        tender_db_id = conn.execute("SELECT id FROM tenders").fetchone()[0]
        conn.close()
        folder = os.path.join(self._temp_dir.name, "download")
        os.makedirs(folder, exist_ok=True)
        for name in ("Tendernotice_NIC2026001.pdf", "NIC2026001.zip"):
            with open(os.path.join(folder, name), "wb") as handle:
                handle.write(b"document")

        result = core.ScraperBackend.record_tender_download_result(
            tender_db_id, "NIC/2026/001", folder, any_new_download=True
        )
        conn = core.sqlite3.connect(core.DB_FILE)
        row = conn.execute(
            "SELECT is_downloaded,download_status,folder_path,last_update_checked_at "
            "FROM tenders WHERE id=?",
            (tender_db_id,),
        ).fetchone()
        conn.close()
        self.assertTrue(result["complete"])
        self.assertEqual(int(row[0]), 1)
        self.assertEqual(row[1], "complete")
        self.assertEqual(row[2], folder)
        self.assertGreater(float(row[3]), 0)


if __name__ == "__main__":
    unittest.main()
