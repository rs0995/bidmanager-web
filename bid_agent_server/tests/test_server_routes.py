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
        cfg = self.client.put("/admin/bid-agent/config", headers=ah, json={"api_key": ""}).json()
        self.assertFalse(cfg["api_key_set"])


    # ------------------------------------------------------------ chat agent
    def _say(self, text):
        r = self.client.post("/client/tenders/1/bid-agent/chat", headers=self.h, json={"message": text})
        self.assertEqual(r.status_code, 200, r.text)
        for _ in range(300):
            st = self.client.get("/client/tenders/1/bid-agent/chat", headers=self.h).json()
            if st["status"] == "idle":
                return st["messages"][-1]
            time.sleep(0.05)
        self.fail("agent did not answer")

    def test_chat_agent_does_what_is_asked(self):
        import glob
        import json
        import sqlite3

        self.client.put("/client/company-profile", headers=self.h, json={"general": {"name": "Acme Infra"}})
        st = self.client.get("/client/tenders/1/bid-agent/chat", headers=self.h).json()
        self.assertEqual((st["messages"], st["status"]), ([], "idle"))

        # show the prequal -> a table, nothing saved
        m = self._say("Fetch the prequalification")
        self.assertEqual(m["role"], "assistant")
        self.assertEqual(m["cards"][0]["title"], "Prequalification criteria")
        self.assertEqual([r[0] for r in m["cards"][0]["rows"]], ["3.4", "4.2", "5.1"])

        # save it as Excel -> Docs for Preparation on storage + manifest + index
        m = self._say("Save the prequal as excel")
        self.assertEqual(m["cards"][0]["type"], "files")
        prep = self.client.get("/client/tenders/1/bid-agent/files?folder=prep", headers=self.h).json()["items"]
        self.assertEqual(len(prep), 1)
        self.assertTrue(prep[0]["name"].endswith(".xlsx"))
        stored = glob.glob(str(self.root / "project-files" / "P - T-100" / "*" / "*" / "Docs for Preparation" / "*.xlsx"))
        self.assertEqual(len(stored), 1, list(self.root.rglob("*"))[:20])
        index = glob.glob(str(self.root / "project-files" / "P - T-100" / "*" / "*" / "Bid Agent index.json"))
        with open(index[0], encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["files"][0]["folder"], "Docs for Preparation")

        # a specific form
        m = self._say("Extract form FIN-3.2 in word")
        self.assertEqual([f["name"] for f in m["cards"][0]["files"]], ["FIN-3.2 - Average Annual Construction Turnover.docx"])

        # checklist -> rows in Ready Docs (shared sync data), forms attached, rest pending
        m = self._say("Prepare the checklist of documents required")
        rows = {r["name"]: r for r in m["cards"][0]["rows"]}
        self.assertIn("FIN-3.2 - Average Annual Construction Turnover", rows)
        self.assertTrue(rows["FIN-3.2 - Average Annual Construction Turnover"]["file"].endswith(".docx"))
        self.assertIn("CER-5.1", rows)  # asked for by the criteria, not in the files: pending
        self.assertEqual(rows["CER-5.1"]["file"], "")
        sync = self.client.get("/client/sync", headers=self.h).json()["data"]
        mine = [r for r in sync["checklist"] if r["subfolder"] == "Ready Docs"]
        self.assertTrue(all(r["status"] == "Pending" for r in mine))
        fin = next(r for r in mine if r["req_file_name"].startswith("FIN-3.2"))
        self.assertTrue(fin["server_file"]["name"].endswith(".docx"))
        self.assertEqual(sync["projects"][0]["source_tender_id"], "T-100")
        # asking again doesn't duplicate rows
        m = self._say("prepare the checklist again")
        self.assertFalse(any(r["added"] for r in m["cards"][0]["rows"]))

        # the conversation is kept, and the attached file downloads through project-files
        st = self.client.get("/client/tenders/1/bid-agent/chat", headers=self.h).json()
        self.assertEqual(len(st["messages"]), 10)
        dl = self.client.post(f"/client/project-files/{fin['server_file']['id']}/download-request", headers=self.h)
        self.assertEqual(dl.status_code, 200, dl.text)


    @unittest.skipUnless(shutil.which("soffice"), "LibreOffice not installed")
    def test_chat_saves_pdf_with_libreoffice(self):
        m = self._say("save the prequalification as pdf")
        self.assertTrue(m["cards"][0]["files"][0]["name"].endswith(".pdf"), m)
        m = self._say("extract the bidder information form as pdf")
        self.assertTrue(all(f["name"].endswith(".pdf") for f in m["cards"][0]["files"]) if m["cards"] else True, m)

    def test_prep_files_upload_and_delete(self):
        r = self.client.post("/client/tenders/1/bid-agent/prep-files", headers=self.h,
                             files={"file": ("site visit notes.txt", b"notes", "text/plain")})
        self.assertEqual(r.status_code, 200, r.text)
        fid = r.json()["file"]["id"]
        items = self.client.get("/client/tenders/1/bid-agent/files?folder=prep", headers=self.h).json()["items"]
        self.assertEqual([(i["name"], i["kind"]) for i in items], [("site visit notes.txt", "user")])
        self.assertEqual(self.client.delete(f"/client/tenders/1/bid-agent/prep-files/{fid}", headers=self.h).status_code, 200)
        self.assertEqual(self.client.get("/client/tenders/1/bid-agent/files", headers=self.h).json()["items"], [])

    def test_chat_reads_only_what_is_asked(self):
        import sqlite3

        def parts():
            conn = sqlite3.connect(self.db_path)
            row = conn.execute("SELECT result_json FROM bid_analyses WHERE tender_db_id=1").fetchone()
            conn.close()
            import json
            return json.loads(row[0]).get("parts")

        m = self._say("list the tender forms")
        self.assertTrue(m["cards"] and m["cards"][0]["title"].startswith("Tender forms"), m)
        self.assertEqual(parts(), ["forms"])  # the criteria weren't read
        m = self._say("show the prequalification and save the prequal as excel")
        self.assertEqual([c["type"] for c in m["cards"]][:1], ["table"], m)
        self.assertEqual(parts(), ["criteria", "forms"])
        self.assertTrue(any(c["type"] == "files" for c in m["cards"]), m)

    def test_training_and_open_anywhere(self):
        # remember from a chat correction -> learned notes, editable
        m = self._say("remember: always name the EMD row 'EMD - Bank Guarantee'")
        self.assertFalse(m.get("error"), m)
        items = self.client.get("/client/bid-agent/learnings", headers=self.h).json()["items"]
        self.assertEqual(len(items), 1, items)
        self.assertIn("EMD - Bank Guarantee", items[0]["text"])
        lid = items[0]["id"]
        r = self.client.patch(f"/client/bid-agent/learnings/{lid}", headers=self.h, json={"active": False}).json()
        self.assertEqual(r["items"][0]["active"], 0)
        self.assertEqual(self.client.delete(f"/client/bid-agent/learnings/{lid}", headers=self.h).json()["items"], [])

        # standing instructions
        r = self.client.put("/client/bid-agent/instructions", headers=self.h, json={"text": "Answer in one line."}).json()
        self.assertEqual(r["text"], "Answer in one line.")
        self.assertTrue(r["can_edit"])

        # recent chats list the tender with its title
        recent = self.client.get("/client/bid-agent/recent", headers=self.h).json()["items"]
        self.assertEqual([x["id"] for x in recent], [1])
        self.assertEqual(recent[0]["tender_id"], "T-100")

        # reference documents
        r = self.client.post("/client/bid-agent/references", headers=self.h,
                             files={"file": ("GST certificate.pdf", b"%PDF-1.4 gst", "application/pdf")})
        self.assertEqual(r.status_code, 200, r.text)
        refs = r.json()["items"]
        self.assertEqual([x["name"] for x in refs], ["GST certificate.pdf"])
        self.assertNotIn("storage_ref", refs[0])
        r = self.client.delete(f"/client/bid-agent/references/{refs[0]['file_id']}", headers=self.h)
        self.assertEqual(r.json()["items"], [])

    def test_admin_chat_and_instructions(self):
        a = {"x-admin-key": "admin-secret"}
        self.assertEqual(self.client.get("/admin/bid-agent/instructions").status_code, 401)
        self.assertEqual(self.client.put("/admin/bid-agent/instructions", headers=a,
                                         json={"text": "Be brief."}).json()["text"], "Be brief.")
        r = self.client.post("/admin/bid-agent/tenders/1/chat", headers=a, json={"message": "show the prequalification"})
        self.assertEqual(r.status_code, 200, r.text)
        for _ in range(200):
            st = self.client.get("/admin/bid-agent/tenders/1/chat", headers=a).json()
            if st["status"] == "idle" and len(st["messages"]) >= 2:
                break
            time.sleep(0.05)
        reply = st["messages"][-1]
        self.assertEqual(reply["cards"][0]["title"], "Prequalification criteria", reply)
        # saving from the console is refused politely
        r = self.client.post("/admin/bid-agent/tenders/1/chat", headers=a, json={"message": "save the prequalification"})
        for _ in range(200):
            st = self.client.get("/admin/bid-agent/tenders/1/chat", headers=a).json()
            if st["status"] == "idle" and len(st["messages"]) >= 4:
                break
            time.sleep(0.05)
        self.assertIn("apps", st["messages"][-1]["text"])
        self.assertEqual(self.client.get("/admin/bid-agent/tenders/999/chat", headers=a).status_code, 404)
        self.assertEqual(self.client.get("/admin/bid-agent/learnings", headers=a).json()["items"], [])

    def test_auth_and_scope(self):
        self.assertEqual(self.client.get("/client/tenders/1/bid-pack").status_code, 401)
        self.assertEqual(self.client.post("/client/tenders/999/bid-pack", headers=self.h).status_code, 404)
        r = self.client.put("/client/tenders/1/bid-pack/documents", headers=self.h,
                            json={"file": "x", "segments": [{"role": "itb", "start_page": 1, "end_page": 1}]})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
