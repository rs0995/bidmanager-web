"""Downloads behind an unsolved CAPTCHA, and saved files that are really the
portal's HTML page, must not be logged as complete (job_b830, 2026-11-23)."""
import os
import tempfile
import unittest
from unittest import mock

import app_core as core
from app_core import ScraperBackend

HTML_PAGE = b"\r\n<!DOCTYPE html>\n<html><head><title>eProcurement System</title></head></html>"


class FileProblemTests(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._dir.cleanup)

    def _problem(self, name, data):
        path = os.path.join(self._dir.name, name)
        with open(path, "wb") as f:
            f.write(data)
        return ScraperBackend.downloaded_file_problem(path)

    def test_real_files_pass(self):
        self.assertIsNone(self._problem("a.zip", b"PK\x03\x04rest"))
        self.assertIsNone(self._problem("empty.zip", b"PK\x05\x06" + b"\0" * 18))
        self.assertIsNone(self._problem("a.pdf", b"%PDF-1.7\n..."))
        self.assertIsNone(self._problem("junk-first.pdf", b"\n\n%PDF-1.4"))
        self.assertIsNone(self._problem("a.docx", b"PK\x03\x04"))
        self.assertIsNone(self._problem("a.rar", b"Rar!\x1a\x07\x00"))

    def test_html_page_saved_as_zip_or_pdf_is_rejected(self):
        self.assertIn("web page", self._problem("2026_DTEDM_1350593_1.zip", HTML_PAGE))
        self.assertIn("web page", self._problem("Tendernotice_1.pdf", HTML_PAGE))
        self.assertIn("web page", self._problem("a.pdf", b"\xef\xbb\xbf<html><body>"))

    def test_wrong_magic_bytes_are_rejected(self):
        self.assertEqual(self._problem("a.zip", b"garbage"), "not a ZIP file")
        self.assertEqual(self._problem("a.pdf", b"garbage"), "not a PDF file")
        self.assertEqual(self._problem("a.xlsx", b"garbage"), "not a XLSX file")

    def test_empty_file_is_rejected(self):
        self.assertIn("empty", self._problem("a.pdf", b""))
        self.assertIn("empty", self._problem("a.xls", b""))

    def test_html_xls_and_doc_are_allowed(self):
        # Portals serve real HTML-table .xls and HTML .doc files.
        self.assertIsNone(self._problem("boq.xls", b"<html><table></table></html>"))
        self.assertIsNone(self._problem("form.doc", b"<html><body></body></html>"))


class _Response:
    def __init__(self, body):
        self.body = body
        self.headers = {"Content-Length": str(len(body))}

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size=8192):
        yield self.body


class DownloadFileTests(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._dir.cleanup)
        self.storage = mock.Mock(remote=True)
        self.storage.persist.return_value = mock.Mock(reference="gdrive://abc/x", remove_local_copy=True)
        self.session = mock.Mock()
        self.logs = []
        patches = [
            mock.patch.object(core, "ensure_scraper_dependencies", lambda: True),
            mock.patch.object(core.storage_runtime, "require_durable_cloud_storage", lambda: None),
            mock.patch.object(core.storage_runtime, "active_document_storage", lambda: self.storage),
            mock.patch.object(core, "_new_scraper_session", lambda: self.session),
            mock.patch.object(ScraperBackend, "get_setting", staticmethod(lambda key, default=None: default)),
            mock.patch.object(ScraperBackend, "downloaded_content_reference", staticmethod(lambda *a: None)),
            mock.patch.object(ScraperBackend, "log_downloaded_file"),
            mock.patch.object(core, "log_to_gui", self.logs.append),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(lambda: setattr(core._job_runtime, "rejected_downloads", None))

    def _download(self, body, name="2026_X_1.zip"):
        self.session.get.return_value = _Response(body)
        path = os.path.join(self._dir.name, name)
        ok = ScraperBackend.download_file_with_requests("https://portal/x", path, [], "2026_X_1", "zip")
        return ok, path

    def test_html_page_is_not_stored_or_logged(self):
        core._job_runtime.rejected_downloads = rejected = []
        ok, path = self._download(HTML_PAGE)
        self.assertFalse(ok)
        self.storage.persist.assert_not_called()
        ScraperBackend.log_downloaded_file.assert_not_called()
        self.assertFalse(os.path.exists(path))
        self.assertEqual(rejected, ["2026_X_1.zip"])
        self.assertIn("web page instead of the file; not stored", self.logs[-1])

    def test_real_zip_is_stored_and_logged_complete(self):
        ok, _ = self._download(b"PK\x03\x04" + b"x" * 100)
        self.assertTrue(ok)
        self.storage.persist.assert_called_once()
        ScraperBackend.log_downloaded_file.assert_called_once()


class DownloadLoopTests(unittest.TestCase):
    """_run_download_loop for one NIC tender with every portal call faked."""

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._dir.cleanup)
        self._old_db = core.DB_FILE
        core.DB_FILE = os.path.join(self._dir.name, "dl.db")
        self.addCleanup(lambda: setattr(core, "DB_FILE", self._old_db))
        core.init_db()
        conn = core.sqlite3.connect(core.DB_FILE)
        ScraperBackend.upsert_tender_row(conn, (
            1, "DTE", "2026_DTEDM_1350593_1", "Works", "1000", "100", "20-Aug-2026",
            "21-Aug-2026", "https://portal/tender?id=1", "Pune", "Works", "N/A",
            "16-Aug-2026", "Road",
        ))
        conn.commit()
        self.db_id = conn.execute("SELECT id FROM tenders").fetchone()[0]
        conn.close()

        self.logs = []
        self.captcha_ok = False
        self.download = mock.Mock(return_value=True)
        driver = mock.MagicMock()
        driver.find_elements.return_value = []
        hrefs = {"Tendernotice": "https://portal/notice", "Download as zip file": "https://portal/zip"}
        B = ScraperBackend
        patches = [
            mock.patch.object(core, "BASE_DOWNLOAD_DIRECTORY", self._dir.name),
            mock.patch.object(core, "WebDriverWait", mock.MagicMock()),
            mock.patch.object(core, "EC", mock.MagicMock()),
            mock.patch.object(core, "By", mock.MagicMock()),
            mock.patch.object(core, "log_to_gui", self.logs.append),
            mock.patch.object(core.storage_runtime, "cleanup_scratch_folder", lambda *_: None),
            mock.patch.object(B, "_acquire_download_driver", staticmethod(lambda *a: driver)),
            mock.patch.object(B, "_resolve_download_mode", staticmethod(lambda *a: "full")),
            mock.patch.object(B, "open_tender_page_with_recovery", staticmethod(lambda *a: True)),
            mock.patch.object(B, "should_skip_file", staticmethod(lambda *a, **k: False)),
            mock.patch.object(B, "record_tender_download_result", staticmethod(lambda *a, **k: None)),
            mock.patch.object(B, "handle_captcha_interaction", staticmethod(lambda *a, **k: self.captcha_ok)),
            mock.patch.object(
                B, "_wait_for_href", staticmethod(lambda d, by, loc, timeout=15: (None, hrefs.get(loc, "")))
            ),
            mock.patch.object(B, "download_file_with_requests", staticmethod(self.download)),
            mock.patch.object(B, "captcha_solved_in_session", False),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _run(self):
        row = (self.db_id, "2026_DTEDM_1350593_1", "Works", "https://portal/tender?id=1", None, "")
        return ScraperBackend._run_download_loop(1, "https://portal/base", [row], "full")

    def _tender_status(self):
        conn = core.sqlite3.connect(core.DB_FILE)
        row = conn.execute(
            "SELECT download_status,last_download_error FROM tenders WHERE id=?", (self.db_id,)
        ).fetchone()
        conn.close()
        return row

    def _fetched_types(self):
        return [c.kwargs.get("file_type") for c in self.download.call_args_list]

    def test_unsolved_captcha_skips_gated_files_and_fails_the_job(self):
        self.assertFalse(self._run())
        self.assertNotIn("notice", self._fetched_types())
        self.assertNotIn("zip", self._fetched_types())
        status, error = self._tender_status()
        self.assertEqual(status, "failed")
        self.assertIn("CAPTCHA was not solved", error)
        self.assertIn("Tender Notice and Zip file", error)
        self.assertTrue(self.logs[-1].startswith("Download failed for 2026_DTEDM_1350593_1:"))

    def test_unsolved_captcha_with_gated_files_already_complete_still_succeeds(self):
        def skip(tender_id, name, path, source_url=None, file_type="document"):
            return file_type in ("notice", "zip")
        with mock.patch.object(ScraperBackend, "should_skip_file", staticmethod(skip)):
            self.assertTrue(self._run())

    def test_rejected_file_fails_the_job(self):
        self.captcha_ok = True

        def fake_download(url, path, cookies, tender_id=None, file_type="document"):
            if file_type == "zip":
                core._job_runtime.rejected_downloads.append(os.path.basename(path))
                return False
            return True
        self.download.side_effect = fake_download
        self.assertFalse(self._run())
        status, error = self._tender_status()
        self.assertEqual(status, "failed")
        self.assertIn("2026_DTEDM_1350593_1.zip", error)
        self.assertIsNone(core._job_runtime.rejected_downloads)

    def test_solved_captcha_downloads_everything_and_succeeds(self):
        self.captcha_ok = True
        self.assertTrue(self._run())
        self.assertIn("notice", self._fetched_types())
        self.assertIn("zip", self._fetched_types())
        self.assertNotEqual(self._tender_status()[0], "failed")


if __name__ == "__main__":
    unittest.main()
