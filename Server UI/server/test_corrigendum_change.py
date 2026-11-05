"""A new corrigendum that replaces the old one in the detail page's Latest
Corrigendum List (count unchanged) must still trigger the update download
and a tender-change alert (tender 2026_MMRDA_1341650_1: "CORRIGENDUM 1" ->
"CSD", one row both times)."""

import json
import os
import sqlite3
import tempfile
import time
import unittest
from unittest import mock

from bs4 import BeautifulSoup

import app_core as core
import client_api

SB = core.ScraperBackend


def detail_page(*rows):
    body = "".join(
        f"<tr><td>{n}</td><td>{title}</td><td>{kind}</td><td><a href='#'>view</a></td></tr>"
        for n, (title, kind) in enumerate(rows, start=1)
    )
    return (
        "<html><body><table id='corrigendumDocumenttable'>"
        "<tr><td>S.No</td><td>Corrigendum Title</td><td>Corrigendum Type</td><td>View</td></tr>"
        f"{body}</table></body></html>"
    )


class CorrigendumChangeTests(unittest.TestCase):
    def setUp(self):
        self._old_db_file = core.DB_FILE
        self._temp = tempfile.TemporaryDirectory(prefix="bidmanager-corr-", ignore_cleanup_errors=True)
        core.DB_FILE = os.path.join(self._temp.name, "corr.db")
        core.init_db()
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("INSERT OR IGNORE INTO websites (id,name,url) VALUES (1,'Maha','https://maha.test')")
        conn.commit()
        conn.close()
        self.log = mock.patch.object(core, "log_to_gui", return_value=None)
        self.log.start()

    def tearDown(self):
        self.log.stop()
        core.DB_FILE = self._old_db_file
        self._temp.cleanup()

    def _row(self, latest=None, corrigendum_count=1):
        return (1, "MMRDA", "2026_MMRDA_1341650_1", "FoB at Gundavali", "", "", "", "",
                "https://maha.test/t/1", "", "", "", "", "", 0, corrigendum_count, latest)

    def _upsert(self, **kw):
        conn = sqlite3.connect(core.DB_FILE)
        result = SB.upsert_tender_row(conn, self._row(**kw))
        conn.commit()
        conn.close()
        return result

    def _db(self, sql, params=()):
        conn = sqlite3.connect(core.DB_FILE)
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    def _history_fields(self):
        return [json.loads(r[0]) for r in self._db("SELECT changed_fields FROM tender_history ORDER BY id")]

    def test_latest_list_is_read_from_the_detail_page(self):
        soup = BeautifulSoup(detail_page(("CSD", "Other")), "html.parser")
        self.assertEqual(SB.extract_latest_corrigenda(soup), "CSD | Other")
        two = BeautifulSoup(detail_page(("CORRIGENDUM 1", "Drawings"), ("CSD", "Other")), "html.parser")
        self.assertEqual(SB.extract_latest_corrigenda(two), "CORRIGENDUM 1 | Drawings; CSD | Other")
        self.assertEqual(SB.extract_latest_corrigenda(BeautifulSoup("<html></html>", "html.parser")), "")
        self.assertIsNone(SB.extract_latest_corrigenda(None))
        self.assertEqual(SB.extract_prebid_corrigendum_counts(soup), (0, 1))

    def test_replaced_corrigendum_is_recorded_as_a_change_after_the_baseline(self):
        self._upsert(latest="CORRIGENDUM 1 | Other")
        self.assertEqual(self._history_fields(), [["created"]])  # first value: baseline only
        self._upsert(latest="CORRIGENDUM 1 | Other")
        self.assertEqual(self._history_fields(), [["created"]])
        self._upsert(latest="CSD | Other")  # same count (1), new latest corrigendum
        self.assertEqual(self._history_fields(), [["created"], ["corrigendum_latest"]])
        self.assertEqual(self._db("SELECT corrigendum_latest FROM tenders")[0][0], "CSD | Other")
        self._upsert(latest=None)  # page not read this time: nothing changes
        self.assertEqual(self._db("SELECT corrigendum_latest FROM tenders")[0][0], "CSD | Other")

    def test_new_files_are_detected_when_the_list_changes_with_the_same_count(self):
        self._upsert(latest="CORRIGENDUM 1 | Other")
        tender_db_id = self._db("SELECT id FROM tenders")[0][0]
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute(
            "UPDATE tenders SET last_dl_prebid_count=0, last_dl_corrigendum_count=1, "
            "last_dl_corrigendum_latest='CORRIGENDUM 1 | Other' WHERE id=?",
            (tender_db_id,),
        )
        conn.commit()
        conn.close()
        self.assertFalse(SB.new_portal_files_available(tender_db_id)[0])
        self._upsert(latest="CSD | Other")
        self.assertTrue(SB.new_portal_files_available(tender_db_id)[0])

    def test_tenders_downloaded_before_tracking_take_todays_list_as_the_baseline(self):
        self._upsert(latest="CSD | Other")
        tender_db_id = self._db("SELECT id FROM tenders")[0][0]
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("UPDATE tenders SET last_dl_prebid_count=0, last_dl_corrigendum_count=1 WHERE id=?",
                     (tender_db_id,))
        conn.commit()
        conn.close()
        self.assertFalse(SB.new_portal_files_available(tender_db_id)[0])  # count rule only
        self.assertEqual(self._db("SELECT last_dl_corrigendum_latest FROM tenders")[0][0], "CSD | Other")

    def test_the_pre_download_check_reads_and_records_the_list(self):
        self._upsert(latest="CORRIGENDUM 1 | Other")
        tender_db_id = self._db("SELECT id FROM tenders")[0][0]
        page = mock.Mock(text=detail_page(("CSD", "Other")))
        with mock.patch.object(core, "ensure_scraper_dependencies", return_value=True), \
                mock.patch.object(core, "BeautifulSoup", BeautifulSoup, create=True), \
                mock.patch.object(SB, "safe_request", return_value=page):
            self.assertTrue(SB.refresh_tender_counts(tender_db_id))
        self.assertEqual(self._db("SELECT corrigendum_latest, corrigendum_count FROM tenders")[0],
                         ("CSD | Other", 1))
        self.assertIn(["corrigendum_latest"], self._history_fields())

    def test_changes_feed_reports_a_replaced_corrigendum(self):
        self._upsert(latest="CORRIGENDUM 1 | Other")
        since = time.time() - 1
        self._upsert(latest="CSD | Other")
        conn = sqlite3.connect(core.DB_FILE)
        conn.execute("INSERT INTO client_users (id,email,password_hash,created_at) VALUES (1,'a@t.com','x',0)")
        conn.execute("INSERT INTO client_user_sync (user_id,data_json,updated_at) VALUES (1,?,0)",
                     (json.dumps({"bookmarkTenderIds": ["2026_MMRDA_1341650_1"]}),))
        conn.commit()
        changed, _new = client_api._compute_user_changes(conn, 1, since)
        conn.close()
        self.assertEqual([(t["tender_id"], t["changed_fields"]) for t in changed],
                         [("2026_MMRDA_1341650_1", ["corrigendum_latest"])])


if __name__ == "__main__":
    unittest.main()
