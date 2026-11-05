"""Route tests against the real server modules.

Needs a server directory with bid_agent installed (python bid_agent_server/install.py
does that for Server UI/server). Point BID_AGENT_SERVER_DIR at it; skipped otherwise:

    BID_AGENT_SERVER_DIR="Server UI/server" python -m unittest discover -s bid_agent_server/tests
"""

from __future__ import annotations

import io
import os
import shutil
import sys
import time
import unittest
import zipfile

SERVER_DIR = os.environ.get("BID_AGENT_SERVER_DIR", "")
HERE = os.path.dirname(os.path.abspath(__file__))


@unittest.skipUnless(SERVER_DIR and os.path.isdir(os.path.join(SERVER_DIR, "bid_agent")),
                     "set BID_AGENT_SERVER_DIR to a server dir with bid_agent installed")
class BidPackRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, os.path.abspath(SERVER_DIR))
        sys.path.insert(1, HERE)

    def setUp(self):
        import sqlite3

        import org_access
        import test_client_api
        from fastapi import Header, HTTPException

        from bid_agent import server_routes
        from fixtures import build_tender

        test_client_api.ClientApiTests.setUp(self)  # temp DB, user + token, patched paths
        self.addCleanup(lambda: [p.stop() for p in self.patches])
        conn = sqlite3.connect(self.db_path)
        org_access.ensure_schema(conn)
        conn.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("DELETE FROM downloaded_files")
        for i, p in enumerate(build_tender(str(self.root / "T-100")), start=10):
            conn.execute("INSERT INTO downloaded_files VALUES (?,?,?,?,?,?,?,?,?,NULL)",
                         (i, "T-100", 1, os.path.basename(p), "document", 1, "2026-08-18", "complete", p))
        conn.commit()
        conn.close()

        def require_admin(x_admin_key: str = Header(default="")):
            if x_admin_key != "admin-secret":
                raise HTTPException(401, "admin key")

        client_router, admin_router = server_routes.create_routers(require_admin)
        self.client.app.include_router(client_router)
        self.client.app.include_router(admin_router)
        self.h = {"x-client-key": self.token}

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _wait(self, tender_id=1):
        for _ in range(200):
            r = self.client.get(f"/client/tenders/{tender_id}/bid-pack", headers=self.h).json()
            if r["status"] in ("completed", "failed"):
                return r
            time.sleep(0.05)
        self.fail("bid pack did not finish")

    def test_full_flow(self):
        self.assertEqual(self.client.get("/client/tenders/1/bid-pack", headers=self.h).json()["status"], "none")
        st = self.client.get("/client/bid-agent/status", headers=self.h).json()
        self.assertFalse(st["ai_enabled"])
        self.assertTrue(st["can_edit_profile"])

        prof = self.client.put("/client/company-profile", headers=self.h,
                               json={"general": {"name": "Acme Infra"}, "secret_field": "x"}).json()
        self.assertEqual(prof["profile"]["general"]["name"], "Acme Infra")
        self.assertNotIn("secret_field", prof["profile"])

        r = self.client.post("/client/tenders/1/bid-pack", headers=self.h)
        self.assertEqual(r.status_code, 200, r.text)
        done = self._wait()
        self.assertEqual(done["status"], "completed", done.get("logs"))
        res = done["result"]
        self.assertEqual([f["code"] for f in res["forms"]], ["FIN-3.2", "EXP-4.2"])
        names = [f["name"] for f in done["files"]]

        f = self.client.get(f"/client/tenders/1/bid-pack/files/{names[1]}", headers=self.h)
        self.assertEqual(f.status_code, 200)
        import docx
        self.assertIn("Acme Infra", "\n".join(p.text for p in docx.Document(io.BytesIO(f.content)).paragraphs))
        z = self.client.get("/client/tenders/1/bid-pack/files/Bid%20Forms.zip", headers=self.h)
        self.assertEqual(len(zipfile.ZipFile(io.BytesIO(z.content)).namelist()), len(names) - 1)
        self.assertEqual(self.client.get("/client/tenders/1/bid-pack/files/..%2Fx", headers=self.h).status_code, 404)

        # correction -> rerun with override, alias learned for the employer
        vol1 = "Volume 1 - ITT.docx"
        r = self.client.put("/client/tenders/1/bid-pack/documents", headers=self.h,
                            json={"file": vol1, "segments": [{"role": "nit", "start_page": 1, "end_page": 2}]})
        self.assertEqual(r.status_code, 200, r.text)
        done = self._wait()
        doc = next(d for d in done["result"]["documents"] if d["file"] == vol1)
        self.assertEqual((doc["segments"][0]["role"], doc["segments_source"]), ("nit", "manual"))

        # admin
        self.assertEqual(self.client.get("/admin/bid-agent/config").status_code, 401)
        ah = {"x-admin-key": "admin-secret"}
        emp = self.client.get("/admin/bid-agent/employers", headers=ah).json()
        self.assertIn("Volume 1 - ITT", emp[0]["aliases"]["nit"])
        cfg = self.client.put("/admin/bid-agent/config", headers=ah, json={"api_key": "sk-ant-test-123456789"}).json()
        self.assertTrue(cfg["api_key_set"])
        self.assertNotIn("123456789", cfg["api_key_hint"][:-4])

    def test_auth_and_scope(self):
        self.assertEqual(self.client.get("/client/tenders/1/bid-pack").status_code, 401)
        self.assertEqual(self.client.post("/client/tenders/999/bid-pack", headers=self.h).status_code, 404)
        r = self.client.put("/client/tenders/1/bid-pack/documents", headers=self.h,
                            json={"file": "x", "segments": [{"role": "itb", "start_page": 1, "end_page": 1}]})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
