import os
import base64
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import client_api


class ClientApiTests(unittest.TestCase):
    def setUp(self):
        # Starlette's Windows FileResponse worker can retain a file handle until
        # interpreter teardown even after the response is closed.
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.temp.name)
        self.db_path = self.root / "client.db"
        self.file_path = self.root / "spec.pdf"
        self.file_path.write_bytes(b"test document")
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE websites (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE tenders (
                id INTEGER PRIMARY KEY, website_id INTEGER, org_chain TEXT, tender_id TEXT,
                title TEXT, work_description TEXT, tender_value TEXT, emd TEXT,
                closing_date TEXT, opening_date TEXT, published_date TEXT,
                pre_bid_meeting_date TEXT, location TEXT, tender_category TEXT,
                status TEXT, is_archived INTEGER, tender_url TEXT
            );
            CREATE TABLE downloaded_files (
                id INTEGER PRIMARY KEY, tender_id TEXT, tender_db_id INTEGER,
                file_name TEXT, file_type TEXT, file_size_bytes INTEGER,
                downloaded_at TEXT, download_status TEXT, local_path TEXT, drive_file_id TEXT
            );
            INSERT INTO websites VALUES (1, 'MahaTenders');
            INSERT INTO tenders VALUES
                (1,1,'Road Authority','T-100','Road bridge','Build a bridge','1000','10',
                 '2026-09-10','2026-09-11','2026-08-01','2026-08-20','Pune','Works','Open',0,'https://example.test/t/100'),
                (2,1,'Water Authority','T-200','Water works','Pipeline','2000','20',
                 '2026-10-10','2026-10-11','2026-08-02','','Mumbai','Services','Closed',1,'https://example.test/t/200');
            """
        )
        conn.execute(
            "INSERT INTO downloaded_files VALUES (1,'T-100',1,'spec.pdf','notice',13,'2026-08-18','complete',?,NULL)",
            (str(self.file_path),),
        )
        conn.commit()
        conn.close()

        app = FastAPI()
        app.include_router(client_api.router)
        app.include_router(client_api.download_router)
        self.client = TestClient(app)
        self.patches = [
            mock.patch.object(client_api.core, "DB_FILE", str(self.db_path)),
            mock.patch.object(client_api.core, "BASE_DOWNLOAD_DIRECTORY", str(self.root)),
            mock.patch.dict(os.environ, {
                "CLIENT_API_KEY": "client-secret",
                "ADMIN_API_KEY": "admin-secret",
                "BIDMANAGER_DOWNLOAD_TOKEN_SECRET": "download-secret",
            }, clear=False),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        self.client.close()
        for patch in reversed(self.patches):
            patch.stop()
        self.temp.cleanup()

    @property
    def headers(self):
        return {"x-client-key": "client-secret"}

    def test_all_data_routes_fail_closed_without_client_key(self):
        for path in ("/client/health", "/client/tenders", "/client/search?q=road", "/client/stats"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 401)

        admin_response = self.client.get(
            "/client/health", headers={"x-client-key": "admin-secret"},
        )
        self.assertEqual(admin_response.status_code, 401)

    def test_tender_list_filters_sorts_and_paginates_without_internal_paths(self):
        response = self.client.get(
            "/client/tenders?q=road&archived=false&sort_by=title&page=1&page_size=1",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["pages"], 1)
        self.assertEqual(payload["items"][0]["tender_id"], "T-100")
        self.assertEqual(payload["items"][0]["document_count"], 1)
        self.assertNotIn("folder_path", payload["items"][0])
        self.assertNotIn("drive_file_id", payload["items"][0])

    def test_documents_hide_storage_references(self):
        response = self.client.get("/client/tenders/1/documents", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        document = response.json()["items"][0]
        self.assertEqual(document["name"], "spec.pdf")
        self.assertTrue(document["downloadable"])
        self.assertNotIn("local_path", document)
        self.assertNotIn("drive_file_id", document)

    def test_download_request_returns_expiring_link_without_writing(self):
        response = self.client.post(
            "/client/tenders/1/download-request", headers=self.headers, json={"document_id": 1},
        )
        self.assertEqual(response.status_code, 200)
        link = response.json()["url"]
        self.assertIn("/client/documents/1/download?token=", link)
        encoded_token = link.split("token=", 1)[1].split(".", 1)[0]
        token_payload = json.loads(base64.urlsafe_b64decode(encoded_token + "=" * (-len(encoded_token) % 4)))
        self.assertNotIn(str(self.file_path), json.dumps(token_payload))
        download = self.client.get(link)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.content, b"test document")
        invalid = self.client.get("/client/documents/1/download?token=invalid-token-value-long")
        self.assertEqual(invalid.status_code, 401)
        invalid.close()
        download.close()
        response.close()

    def test_document_cannot_be_requested_through_another_tender(self):
        response = self.client.post(
            "/client/tenders/2/download-request", headers=self.headers, json={"document_id": 1},
        )
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
