import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import unittest
from pathlib import Path
from unittest import mock

import app_core as core
from scrapers import nprocure

SOURCE_DIR = Path(__file__).resolve().parent
FIXTURES = SOURCE_DIR / "test_fixtures" / "nprocure"


def fixture(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


class FakeResponse:
    def __init__(self, text="", content=b"", status_code=200):
        self.text = text
        self.content = content
        self.status_code = status_code
        self.headers = {"Content-Length": str(len(content))} if content else {}

    def iter_content(self, chunk_size=8192):
        for start in range(0, len(self.content), chunk_size):
            yield self.content[start:start + chunk_size]


class FakePortal:
    """Routes Client.request calls to fixtures and records what was asked."""

    def __init__(self, listing=None):
        self.listing = listing or json.loads(fixture("list.json"))
        self.calls = []
        self.page_threads = set()
        self.on_detail = None

    def count(self, kind):
        return sum(1 for call in self.calls if call[0] == kind)

    def __call__(self, client, method, url, **kwargs):
        if url.endswith("/beforeLoginTenderTableList"):
            inner = nprocure.decrypt_request(kwargs["json"])
            params = {p["name"]: p["value"] for p in inner["reqData"]}
            start = params["iDisplayStart"]
            self.calls.append(("list", url, start, params.get("clientname1")))
            page = dict(self.listing)
            page["data"] = self.listing["data"] if start == 0 else []
            return FakeResponse(json.dumps(page))
        data = kwargs.get("data") or {}
        tender_id = str(data.get("tenderid") or "")
        if url.endswith("/view-nit-home"):
            self.calls.append(("detail", tender_id))
            self.page_threads.add(threading.current_thread().name)
            if self.on_detail:
                self.on_detail()
            return FakeResponse(fixture("detail.html" if tender_id == "356004" else "detail_amended.html"))
        if url.endswith("/view-nit-amendment"):
            self.calls.append(("amendments", tender_id))
            return FakeResponse(fixture("amendment_none.html" if tender_id == "356004" else "amendment_list.html"))
        if url.endswith("/view-nit-document"):
            self.calls.append(("documents", tender_id))
            return FakeResponse(fixture("documents.html" if tender_id == "356004" else "documents_amended.html"))
        if url.endswith("/view-amendment-home"):
            amendment_id = str(data.get("tenderamendmentid"))
            self.calls.append(("amendment_home", amendment_id))
            return FakeResponse(fixture("amendment_home.html" if amendment_id == "119576" else "amendment_none.html"))
        if "/common/download" in url:
            self.calls.append(("download", url))
            return FakeResponse(content=f"bytes of {url}".encode("utf-8"))
        if method == "GET":
            self.calls.append(("home", url))
            return FakeResponse(fixture("home.html"))
        raise AssertionError(f"unexpected request {method} {url}")


class NprocureParserTests(unittest.TestCase):
    def test_request_wrapper_round_trips_and_uses_site_format(self):
        inner = nprocure.build_list_inner(0, 500)
        body = nprocure.encrypt_request(inner, password="aB3dE", iv=bytes(range(16)), salt=bytes(range(16, 32)))
        self.assertEqual(set(body), {"jsonData", "iv", "salt", "key"})
        self.assertEqual(len(body["iv"]), 32)
        self.assertEqual(len(body["salt"]), 32)
        self.assertEqual(nprocure.base64.b64decode(body["key"]).decode(), "aB3dE")
        self.assertEqual(nprocure.decrypt_request(body), inner)
        random_body = nprocure.encrypt_request(inner)
        self.assertEqual(nprocure.decrypt_request(random_body), inner)
        self.assertNotEqual(random_body["jsonData"], body["jsonData"])

    def test_client_dropdown(self):
        clients = nprocure.parse_client_dropdown(fixture("home.html"))
        self.assertEqual(len(clients), 3)
        amc = next(c for c in clients if c["name"] == "Ahmedabad Municipal Corporation")
        self.assertEqual(amc, {
            "name": "Ahmedabad Municipal Corporation", "count": 228, "base_url": "https://amctender.nprocure.com",
            "client_id": "7",
        })
        self.assertIn("Women & Child Development", [c["name"] for c in clients])

    def test_listing_rows(self):
        total, rows = nprocure.parse_list_rows(fixture("list.json"))
        self.assertEqual(total, 228)
        self.assertEqual([r["tender_id"] for r in rows], ["356004", "328609", "347752"])
        first, amended, extended = rows
        self.assertTrue(first["title"].startswith("REPLACEMENT OF EXISTING HYDRAULIC LIFT"))
        self.assertNotIn("Name Of Work", first["title"])
        self.assertEqual(first["est_value"], "4301691.00")
        self.assertEqual(first["closing_raw"], "27-10-2026 18:00:00")
        self.assertEqual(first["office"], "AMC-Light Department")
        self.assertEqual(first["notice_no"], "2026-2027")
        self.assertFalse(first["has_amendment"])
        self.assertEqual(first["doc_count"], 2)
        self.assertTrue(amended["has_amendment"])
        self.assertEqual(amended["amendment_label"], "Addendum-3")
        self.assertEqual(amended["est_value"], "")  # ECV hidden on the portal
        self.assertEqual(extended["amendment_label"], "Date Extend")

    def test_detail_fields(self):
        plain = nprocure.detail_fields(nprocure.parse_label_pairs(fixture("detail.html")))
        self.assertEqual(plain["emd"], "43,017")
        self.assertEqual(plain["tender_value"], "43,01,691")
        self.assertEqual(plain["closing_date"], "27-Oct-2026 06:00 PM")
        self.assertEqual(plain["published_date"], "16-Oct-2026 02:00 PM")
        self.assertEqual(plain["opening_date"], "28-Oct-2026 04:05 PM")
        self.assertEqual(plain["pre_bid_meeting_date"], "N/A")  # "No Meeting"
        self.assertEqual(plain["location"], "Ahmedabad")
        self.assertEqual(plain["tender_category"], "WORKS")
        amended = nprocure.detail_fields(nprocure.parse_label_pairs(fixture("detail_amended.html")))
        self.assertEqual(amended["emd"], "2,00,000")
        self.assertEqual(amended["tender_value"], "N/A")
        self.assertEqual(amended["pre_bid_meeting_date"], "06-Aug-2026 12:00 PM")

    def test_documents_and_amendments(self):
        docs = nprocure.parse_document_links(fixture("documents_amended.html"))
        self.assertEqual([d[0] for d in docs], [
            "BHMS_Tender Documents.pdf", "Adenddem-1(BHMS)tendar.pdf", "Addendum 2.pdf", "Addendum-3.pdf",
        ])
        self.assertTrue(all(d[1].startswith("https://tender.nprocure.com/common/download?uid=") for d in docs))
        dup = '<a href="/common/download?uid=aaaaaaaa-1&name=a.pdf">a</a><a href="/common/download?uid=bbbbbbbb-2&name=a.pdf">a</a>'
        self.assertEqual([d[0] for d in nprocure.parse_document_links(dup)], ["a.pdf", "a_bbbbbbbb.pdf"])
        amendments = nprocure.parse_amendments(fixture("amendment_list.html"))
        self.assertEqual([a["amendment_id"] for a in amendments], ["119576", "118165", "114168"])
        self.assertEqual(amendments[0]["subject"], "Addendum-3")
        self.assertEqual(nprocure.parse_amendments(fixture("amendment_none.html")), [])
        self.assertEqual(nprocure.parse_amendment_document_names(fixture("amendment_home.html")), ["Addendum-3.pdf"])

    def test_normalisers(self):
        self.assertEqual(nprocure.normalize_date("30-10-2026 18:00:00"), "30-Oct-2026 06:00 PM")
        self.assertEqual(nprocure.normalize_date("2026-10-27 18:00:00.0"), "27-Oct-2026 06:00 PM")
        self.assertEqual(nprocure.normalize_date(""), "N/A")
        self.assertIsNotNone(core.ScraperBackend.parse_closing_datetime(nprocure.normalize_date("30-10-2026 18:00:00")))
        self.assertEqual(nprocure.format_amount("875771.00"), "8,75,771")
        self.assertEqual(nprocure.format_amount("1234.50"), "1,234.50")
        self.assertEqual(nprocure.format_amount("1421867.6"), "14,21,867.60")
        self.assertEqual(nprocure.format_amount("( )"), "N/A")

    def test_open_links(self):
        stored = nprocure.tender_url_for("https://tender.nprocure.com", "356004")
        self.assertEqual(nprocure.tender_id_from_url(stored), "356004")
        self.assertEqual(nprocure.open_link_path(stored), "/portal/nprocure/tender/356004")
        self.assertIsNone(nprocure.open_link_path("https://mahatenders.gov.in/nicgep/app?page=X&tenderid=1"))
        self.assertIsNone(nprocure.open_link_path("https://evil.example/view-nit-home?tenderid=1"))
        html = nprocure.open_tender_page("356004")
        self.assertIn('action="https://tender.nprocure.com/view-nit-home"', html)
        self.assertIn('method="POST"', html)
        self.assertIn('name="tenderid" value="356004"', html)
        with self.assertRaises(ValueError):
            nprocure.open_tender_page('1"><script>')

    def test_client_payload_rewrites_only_nprocure_links(self):
        import client_api

        class FakeRequest:
            base_url = "http://bm.example.com/"
            headers = {"x-forwarded-proto": "https"}

        base = client_api._public_base_url(FakeRequest())
        self.assertEqual(base, "https://bm.example.com")
        stored = nprocure.tender_url_for("https://tender.nprocure.com", "356004")
        self.assertEqual(
            client_api._client_tender_url(stored, base), "https://bm.example.com/portal/nprocure/tender/356004"
        )
        nic = "https://mahatenders.gov.in/nicgep/app?component=x&page=FrontEndViewTender"
        self.assertEqual(client_api._client_tender_url(nic, base), nic)

    def test_bundled_intermediate_certificate_is_valid(self):
        from cryptography import x509
        pem = (SOURCE_DIR / "scrapers" / "certs" / "sectigo_ov_r36.pem").read_bytes()
        cert = x509.load_pem_x509_certificate(pem)
        self.assertIn("Sectigo Public Server Authentication CA OV R36", cert.subject.rfc4514_string())
        self.assertGreater(cert.not_valid_after_utc, nprocure.datetime.datetime.now(nprocure.datetime.timezone.utc))
        self.assertTrue(os.path.isfile(nprocure._ca_bundle()))


class NprocureScrapeTests(unittest.TestCase):
    def setUp(self):
        self._old_db_file = core.DB_FILE
        self._old_download_dir = core.BASE_DOWNLOAD_DIRECTORY
        self._temp_dir = tempfile.TemporaryDirectory(prefix="bidmanager-nprocure-", ignore_cleanup_errors=True)
        core.DB_FILE = os.path.join(self._temp_dir.name, "nprocure.db")
        core.BASE_DOWNLOAD_DIRECTORY = os.path.join(self._temp_dir.name, "downloads")
        core.init_db()
        conn = core.sqlite3.connect(core.DB_FILE)
        self.website_id = conn.execute("SELECT id FROM websites WHERE portal_type='nprocure'").fetchone()[0]
        conn.execute(
            "INSERT INTO organizations (website_id, name, tender_count, tenders_url, is_selected) VALUES (?, ?, ?, ?, 1)",
            (self.website_id, "Ahmedabad Municipal Corporation", 228, "https://amctender.nprocure.com"),
        )
        conn.execute(
            "INSERT INTO organizations (website_id, name, tender_count, tenders_url, is_selected) VALUES (?, ?, ?, ?, 0)",
            (self.website_id, "Agriculture University", 8, "https://autender.nprocure.com"),
        )
        nprocure.ensure_tables(conn)
        conn.executemany(
            "INSERT INTO nprocure_clients (website_id, org_name, client_id) VALUES (?, ?, ?)",
            [(self.website_id, "Ahmedabad Municipal Corporation", "7"), (self.website_id, "Agriculture University", "109")],
        )
        conn.commit()
        conn.close()
        self.portal = FakePortal()
        patches = [
            mock.patch.object(nprocure.Client, "request", autospec=True, side_effect=self.portal),
            mock.patch.object(nprocure.Client, "_pace", lambda self: None),
            mock.patch.object(core, "ensure_scraper_dependencies", side_effect=AssertionError("NIC path used")),
            mock.patch.object(core.ScraperBackend, "safe_request", side_effect=AssertionError("NIC path used")),
            mock.patch.object(core.ScraperBackend, "_acquire_download_driver", side_effect=AssertionError("NIC path used")),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def tearDown(self):
        core.DB_FILE = self._old_db_file
        core.BASE_DOWNLOAD_DIRECTORY = self._old_download_dir
        self._temp_dir.cleanup()

    def _rows(self, sql, params=()):
        conn = core.sqlite3.connect(core.DB_FILE)
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    def test_seed_and_portal_type_defaults(self):
        rows = dict(self._rows("SELECT name, portal_type FROM websites"))
        self.assertEqual(rows["nProcure Gujarat"], "nprocure")
        self.assertEqual(rows["MahaTenders"], "nic")
        self.assertEqual(core.ScraperBackend.get_websites()[self.website_id]["portal_type"], "nprocure")
        conn = core.sqlite3.connect(core.DB_FILE)
        conn.execute("DELETE FROM websites WHERE id=?", (self.website_id,))
        conn.commit()
        conn.close()
        core.init_db()  # deleted by the admin -> not re-seeded
        self.assertEqual(self._rows("SELECT COUNT(*) FROM websites WHERE portal_type='nprocure'")[0][0], 0)

    def test_fetch_organisations_through_dispatch(self):
        self.assertTrue(core.ScraperBackend.fetch_organisations_logic(self.website_id))
        rows = self._rows(
            "SELECT name, tender_count, tenders_url, is_available FROM organizations WHERE website_id=? ORDER BY name",
            (self.website_id,),
        )
        by_name = {r[0]: r for r in rows}
        # Link to the main site: not every client subdomain exists in DNS.
        self.assertEqual(by_name["Ahmedabad Municipal Corporation"][1:], (228, "https://tender.nprocure.com", 1))
        self.assertEqual(by_name["Agriculture University"][3], 0)  # not in the trimmed dropdown

    def test_fetch_only_selected_orgs_and_skip_unchanged_details(self):
        self.assertTrue(core.ScraperBackend.fetch_tenders_logic(self.website_id))
        listed = {(call[1], call[3]) for call in self.portal.calls if call[0] == "list"}
        self.assertEqual(listed, {("https://tender.nprocure.com/beforeLoginTenderTableList", "7")})
        self.assertEqual(self.portal.count("detail"), 3)
        self.assertEqual(self.portal.count("amendments"), 2)  # only tenders showing a corrigendum

        rows = {
            r[0]: r for r in self._rows(
                "SELECT tender_id, org_chain, title, tender_value, emd, closing_date, tender_url, corrigendum_count, "
                "prebid_count, tender_ref_no, pre_bid_meeting_date FROM tenders WHERE website_id=?",
                (self.website_id,),
            )
        }
        self.assertEqual(set(rows), {"356004", "328609", "347752"})
        lift = rows["356004"]
        self.assertEqual(lift[1], "Ahmedabad Municipal Corporation")
        self.assertTrue(lift[2].startswith("REPLACEMENT OF EXISTING HYDRAULIC LIFT"))
        self.assertEqual(lift[3:6], ("43,01,691", "43,017", "27-Oct-2026 06:00 PM"))
        self.assertEqual(lift[6], "https://tender.nprocure.com/view-nit-home?tenderid=356004")
        self.assertEqual((lift[7], lift[8], lift[9]), (0, 0, "2026-2027"))
        self.assertEqual(rows["328609"][7], 3)
        self.assertEqual(rows["328609"][10], "06-Aug-2026 12:00 PM")

        self.portal.calls.clear()
        self.assertTrue(core.ScraperBackend.fetch_tenders_logic(self.website_id))
        self.assertEqual(self.portal.count("detail"), 0)
        history = self._rows("SELECT COUNT(*) FROM tender_history")[0][0]
        self.assertEqual(history, 3)  # only the 'created' entries; rerun changed nothing

        # A changed closing date on the listing re-reads just that tender's detail page.
        listing = json.loads(fixture("list.json"))
        listing["data"][0]["2"] = listing["data"][0]["2"].replace("27-10-2026 18:00:00", "03-11-2026 18:00:00")
        self.portal.listing = listing
        self.portal.calls.clear()
        self.assertTrue(core.ScraperBackend.fetch_tenders_logic(self.website_id))
        self.assertEqual([c[1] for c in self.portal.calls if c[0] == "detail"], ["356004"])
        self.assertEqual(
            self._rows("SELECT closing_date FROM tenders WHERE tender_id='356004'")[0][0], "03-Nov-2026 06:00 PM"
        )

    def test_org_without_client_id_is_skipped_not_listed_unfiltered(self):
        conn = core.sqlite3.connect(core.DB_FILE)
        conn.execute("DELETE FROM nprocure_clients")
        conn.commit()
        conn.close()
        core.ScraperBackend.fetch_tenders_logic(self.website_id)
        self.assertEqual(self.portal.count("list"), 0)
        self.assertEqual(self._rows("SELECT COUNT(*) FROM tenders")[0][0], 0)

    def test_fetch_organisations_stores_client_ids(self):
        core.ScraperBackend.fetch_organisations_logic(self.website_id)
        ids = dict(self._rows("SELECT org_name, client_id FROM nprocure_clients WHERE website_id=?", (self.website_id,)))
        self.assertEqual(ids["Ahmedabad Municipal Corporation"], "7")
        self.assertEqual(ids["Women & Child Development"], "85")

    def test_portal_pages_are_fetched_on_worker_threads(self):
        self.assertTrue(core.ScraperBackend.fetch_tenders_logic(self.website_id))
        self.assertTrue(self.portal.page_threads)
        self.assertTrue(all(name.startswith("nprocure") for name in self.portal.page_threads), self.portal.page_threads)

    def test_cancelling_the_job_stops_the_scrape(self):
        cancelled = threading.Event()
        self.portal.on_detail = cancelled.set
        core.configure_job_runtime(cancel_checker=cancelled.is_set)
        self.addCleanup(core.clear_job_runtime)
        with self.assertRaises(core.JobCancelledError):
            core.ScraperBackend.fetch_tenders_logic(self.website_id)
        self.assertEqual(self._rows("SELECT COUNT(*) FROM tenders")[0][0], 0)

    def test_stale_archive_only_after_complete_listing(self):
        conn = core.sqlite3.connect(core.DB_FILE)
        core.ScraperBackend.upsert_tender_row(conn, (
            self.website_id, "Ahmedabad Municipal Corporation", "111111", "Old tender", "N/A", "N/A",
            "01-Jan-2026 06:00 PM", "N/A", "https://tender.nprocure.com/view-nit-home?tenderid=111111",
            "N/A", "N/A", "N/A", "N/A", "Old tender",
        ))
        conn.commit()
        conn.close()
        short = json.loads(fixture("list.json"))  # says 228 records, returns 3
        self.portal.listing = short
        core.ScraperBackend.fetch_tenders_logic(self.website_id)
        self.assertEqual(self._rows("SELECT is_archived FROM tenders WHERE tender_id='111111'")[0][0], 0)

        complete = json.loads(fixture("list.json"))
        complete["iTotalRecords"] = 3
        self.portal.listing = complete
        core.ScraperBackend.fetch_tenders_logic(self.website_id)
        self.assertEqual(self._rows("SELECT is_archived FROM tenders WHERE tender_id='111111'")[0][0], 1)

    def test_detail_budget_defers_remaining_tenders(self):
        with mock.patch.object(core, "setting_int", side_effect=lambda key, default, **kw: 1 if key == "nprocure_detail_max_per_run" else default):
            core.ScraperBackend.fetch_tenders_logic(self.website_id)
        self.assertEqual(self.portal.count("detail"), 1)
        self.assertEqual(self._rows("SELECT COUNT(*) FROM tenders")[0][0], 3)
        self.portal.calls.clear()
        core.ScraperBackend.fetch_tenders_logic(self.website_id)
        self.assertEqual(self.portal.count("detail"), 2)  # the two deferred ones

    def test_download_stores_documents_and_corrigenda(self):
        core.ScraperBackend.fetch_tenders_logic(self.website_id)
        db_id = self._rows("SELECT id FROM tenders WHERE tender_id='328609'")[0][0]
        self.portal.calls.clear()
        self.assertTrue(core.ScraperBackend.download_single_tender_logic(db_id, "full"))
        self.assertEqual(self.portal.count("download"), 4)
        files = dict(self._rows("SELECT file_name, file_type FROM downloaded_files WHERE tender_db_id=?", (db_id,)))
        self.assertEqual(files["Addendum-3.pdf"], "corrigendum")
        self.assertEqual(files["BHMS_Tender Documents.pdf"], "document")
        self.assertEqual(len(files), 4)
        status = self._rows(
            "SELECT download_status, is_downloaded, corrigendum_count, last_dl_corrigendum_count, last_dl_prebid_count "
            "FROM tenders WHERE id=?",
            (db_id,),
        )[0]
        self.assertEqual(status, ("complete", 1, 3, 3, 0))

        self.portal.calls.clear()
        self.assertTrue(core.ScraperBackend.download_single_tender_logic(db_id, "update"))
        self.assertEqual(self.portal.count("download"), 0)
        self.assertTrue(core.ScraperBackend.download_single_tender_logic(db_id, "redownload"))
        self.assertEqual(self.portal.count("download"), 4)

    def test_status_actions_are_unsupported(self):
        self.assertEqual(core.ScraperBackend.check_tender_status_logic(self.website_id), 0)
        self.assertIsNone(core.ScraperBackend.download_tender_results_logic(self.website_id))
        core.ScraperBackend.fetch_tenders_logic(self.website_id)
        db_id = self._rows("SELECT id FROM tenders LIMIT 1")[0][0]
        with self.assertRaises(core.PortalActionUnsupported):
            core.ScraperBackend.fetch_tender_status_single_logic(db_id, client_source=True)


class NicDispatchUnchangedTests(unittest.TestCase):
    def setUp(self):
        self._old_db_file = core.DB_FILE
        self._temp_dir = tempfile.TemporaryDirectory(prefix="bidmanager-nic-", ignore_cleanup_errors=True)
        core.DB_FILE = os.path.join(self._temp_dir.name, "nic.db")
        core.init_db()

    def tearDown(self):
        core.DB_FILE = self._old_db_file
        self._temp_dir.cleanup()

    def test_nic_site_never_reaches_nprocure(self):
        nic_id = core.sqlite3.connect(core.DB_FILE).execute(
            "SELECT id FROM websites WHERE name='MahaTenders'"
        ).fetchone()[0]
        self.assertEqual(core.ScraperBackend.website_portal_type(nic_id), core.PORTAL_NIC)
        with mock.patch.object(core.ScraperBackend, "_nprocure", side_effect=AssertionError("nProcure used")), \
                mock.patch.object(core, "ensure_scraper_dependencies", return_value=False) as deps:
            self.assertIsNone(core.ScraperBackend.fetch_tenders_logic(nic_id))
            self.assertFalse(core.ScraperBackend.fetch_organisations_logic(nic_id))
            self.assertFalse(core.ScraperBackend.download_tenders_logic(nic_id))
        self.assertEqual(deps.call_count, 3)


class EnqueueGuardTests(unittest.TestCase):
    def test_status_jobs_rejected_for_nprocure(self):
        with tempfile.TemporaryDirectory(prefix="bidmanager-nprocure-api-") as tmp:
            root = Path(tmp)
            for source in SOURCE_DIR.glob("*.py"):
                if not source.name.startswith("test_"):
                    shutil.copy2(source, root / source.name)
            shutil.copytree(SOURCE_DIR / "scrapers", root / "scrapers")
            env = os.environ.copy()
            for key in ("K_SERVICE", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING"):
                env.pop(key, None)
            env["BIDMANAGER_ENV"] = "local"
            result = subprocess.run(
                [sys.executable, "-c", textwrap.dedent("""
                    import api_server as api
                    from fastapi import HTTPException
                    api._scheduler_stop.set()
                    if getattr(api, "_scheduler_thread", None):
                        api._scheduler_thread.join(timeout=10)
                    sites = {w['name']: w for w in api.list_websites()}
                    npr = sites['nProcure Gujarat']
                    assert npr['portal_type'] == 'nprocure', npr
                    assert sites['MahaTenders']['portal_type'] == 'nic'
                    try:
                        api._enqueue_job('check_status', {'website_id': npr['id']})
                        raise SystemExit('expected 409')
                    except HTTPException as exc:
                        assert exc.status_code == 409, exc.status_code
                    made = api.create_website(api.WebsiteCreate(name='nProcure AMC', url='https://amctender.nprocure.com'))
                    assert made['portal_type'] == 'nprocure', made
                    other = api.create_website(api.WebsiteCreate(name='Other NIC', url='https://x.gov.in/nicgep/app'))
                    assert other['portal_type'] == 'nic', other
                    try:
                        api.create_website(api.WebsiteCreate(name='Bad', url='https://b.example', portal_type='zzz'))
                        raise SystemExit('expected 400')
                    except HTTPException as exc:
                        assert exc.status_code == 400
                    page = api.open_nprocure_tender('356004')
                    assert b'name="tenderid" value="356004"' in page.body, page.body
                    try:
                        api.open_nprocure_tender('12ab')
                        raise SystemExit('expected 404')
                    except HTTPException as exc:
                        assert exc.status_code == 404
                    print('OK')
                """)],
                cwd=root, env=env, capture_output=True, text=True, timeout=180,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("OK", result.stdout)


if __name__ == "__main__":
    unittest.main()
