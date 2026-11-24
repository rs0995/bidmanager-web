"""Checklist files shared across platforms (project_files.py + the
/client/project-files routes): upload, first upload wins, download through a
signed URL, delete, and the server-owned server_file field in /client/sync."""

import os
import sqlite3
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import api_server
import client_api
import storage_runtime
import test_client_api

ADMIN = {"x-admin-key": "admin-secret"}
PASSWORD = "correct horse battery"


class ProjectFileTests(unittest.TestCase):
    def setUp(self):
        test_client_api.ClientApiTests.setUp(self)
        self.client.close()
        self.client = TestClient(api_server.app)
        self.storage = mock.patch.object(
            storage_runtime, "active_document_storage", return_value=storage_runtime.LocalDocumentStorage()
        )
        self.storage.start()

    def tearDown(self):
        self.storage.stop()
        test_client_api.ClientApiTests.tearDown(self)

    headers = test_client_api.ClientApiTests.headers

    # ── helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _h(token):
        return {"x-client-key": token}

    def _push(self, token, data, removed=None):
        body = {"data": data}
        if removed is not None:
            body["removed"] = removed
        response = self.client.put("/client/sync", headers=self._h(token), json=body)
        self.assertEqual(response.status_code, 200, response.text)

    def _pull(self, token):
        return self.client.get("/client/sync", headers=self._h(token)).json()["data"]

    def _seed_project(self, token, item_ids=(11,)):
        self._push(token, {
            "projects": [{"id": 1, "title": "Bridge bid"}],
            "checklist": [{"id": i, "project_id": 1, "req_file_name": f"Doc {i}", "status": "Pending"}
                          for i in item_ids],
        })

    def _upload(self, token, item_id=11, content=b"%PDF-1.4 first", name="first.pdf", device="desktop"):
        return self.client.post(
            "/client/project-files", headers=self._h(token),
            data={"checklist_item_id": str(item_id), "project_id": "1", "device": device},
            files={"file": (name, content, "application/pdf")},
        )

    def _download(self, token, file_id):
        signed = self.client.post(f"/client/project-files/{file_id}/download-request", headers=self._h(token))
        self.assertEqual(signed.status_code, 200, signed.text)
        url = signed.json()["url"]
        return self.client.get(url[url.index("/client/"):])

    def _row(self, token, item_id=11):
        return next(r for r in self._pull(token)["checklist"] if r["id"] == item_id)

    # ── tests ───────────────────────────────────────────────────────────

    def test_uploaded_file_reaches_the_other_platform(self):
        self._seed_project(self.token)
        uploaded = self._upload(self.token)
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        file = uploaded.json()["file"]
        self.assertEqual((file["name"], file["size"], file["device"]), ("first.pdf", 14, "desktop"))

        phone = self.client.post("/client/auth/login", json={"email": "tester@example.com", "password": PASSWORD})
        phone_token = phone.json()["token"]
        server_file = self._row(phone_token)["server_file"]
        self.assertEqual((server_file["id"], server_file["name"]), (file["id"], "first.pdf"))
        downloaded = self._download(phone_token, file["id"])
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded.content, b"%PDF-1.4 first")
        listed = self.client.get("/client/project-files", headers=self._h(phone_token), params={"project_id": "1"})
        self.assertEqual([f["id"] for f in listed.json()["items"]], [file["id"]])

    def test_first_upload_wins(self):
        self._seed_project(self.token)
        first = self._upload(self.token).json()["file"]
        second = self._upload(self.token, content=b"other bytes", name="second.pdf", device="phone")
        self.assertEqual(second.status_code, 409)
        detail = second.json()["detail"]
        self.assertEqual(detail["reason"], "file_exists")
        self.assertEqual(detail["file"]["id"], first["id"])
        self.assertEqual(self._row(self.token)["server_file"]["name"], "first.pdf")
        self.assertEqual(self._download(self.token, first["id"]).content, b"%PDF-1.4 first")

    def test_row_must_be_synced_first(self):
        self._seed_project(self.token)
        response = self._upload(self.token, item_id=99)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["reason"], "row_not_found")

    def test_projects_section_is_required(self):
        self._seed_project(self.token)
        self.client.put(f"/admin/users/{self.user_id}/permissions", headers=ADMIN, json={"projects": False})
        self.assertEqual(self._upload(self.token).status_code, 403)
        self.assertEqual(self.client.get("/client/project-files", headers=self.headers).status_code, 403)

    def test_files_over_the_size_cap_are_refused(self):
        self._seed_project(self.token)
        real = client_api.core.setting_int

        def small_cap(key, default, **kw):
            return 1 if key == "max_file_size_mb" else real(key, default, **kw)

        with mock.patch.object(client_api.core, "setting_int", side_effect=small_cap):
            response = self._upload(self.token, content=b"x" * (1024 * 1024 + 1))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self._upload(self.token).status_code, 200)  # the row is free again

    def test_a_push_cannot_drop_or_fake_server_file(self):
        self._seed_project(self.token, item_ids=(11, 12))
        file = self._upload(self.token).json()["file"]
        self._push(self.token, {"checklist": [
            {"id": 11, "project_id": 1, "req_file_name": "Doc 11", "status": "Completed"},
            {"id": 12, "project_id": 1, "req_file_name": "Doc 12", "server_file": {"id": 999, "name": "fake"}},
        ]})
        rows = {r["id"]: r for r in self._pull(self.token)["checklist"]}
        self.assertEqual(rows[11]["status"], "Completed")
        self.assertEqual(rows[11]["server_file"]["id"], file["id"])
        self.assertNotIn("server_file", rows[12])

    def test_delete_frees_the_row_for_a_new_file(self):
        self._seed_project(self.token)
        first = self._upload(self.token).json()["file"]
        stored = self._db("SELECT storage_ref FROM client_project_files WHERE id=?", (first["id"],))[0]
        self.assertTrue(os.path.isfile(stored))
        self.assertEqual(self.client.delete(f"/client/project-files/{first['id']}", headers=self.headers).status_code, 200)
        self.assertFalse(os.path.isfile(stored))
        self.assertNotIn("server_file", self._row(self.token))
        self.assertEqual(self.client.post(f"/client/project-files/{first['id']}/download-request",
                                          headers=self.headers).status_code, 404)
        second = self._upload(self.token, content=b"replacement", name="second.pdf")
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(self._row(self.token)["server_file"]["name"], "second.pdf")

    def test_removing_the_checklist_row_trashes_its_file(self):
        self._seed_project(self.token, item_ids=(11, 12))
        file = self._upload(self.token).json()["file"]
        self._push(self.token, {"checklist": [{"id": 12, "project_id": 1}]}, removed={"checklist": [11]})
        self.assertEqual(self.client.get("/client/project-files", headers=self.headers).json()["items"], [])
        self.assertIsNotNone(self._db("SELECT trashed_at FROM client_project_files WHERE id=?", (file["id"],))[0])

    def test_bad_download_token_is_refused(self):
        self._seed_project(self.token)
        file = self._upload(self.token).json()["file"]
        response = self.client.get(f"/client/project-files/{file['id']}/download", params={"token": "x" * 40})
        self.assertEqual(response.status_code, 401)

    def test_org_members_share_files_and_other_accounts_cannot_reach_them(self):
        boss = self.client.post("/client/auth/register", json={
            "email": "boss@acme.test", "password": PASSWORD, "account_type": "organisation", "org_name": "Acme",
        }).json()
        boss_token = boss["token"]
        code = self.client.get("/client/org", headers=self._h(boss_token)).json()["join_code"]
        request = self.client.post("/client/org/join-requests", headers=self.headers,
                                   json={"join_code": code}).json()["request"]
        self.client.post(f"/client/org/join-requests/{request['id']}/approve", headers=self._h(boss_token))
        member_token = self.client.post("/client/auth/login", json={
            "email": "tester@example.com", "password": PASSWORD}).json()["token"]

        self._seed_project(boss_token)
        file = self._upload(member_token, device="phone").json()["file"]
        self.assertEqual(self._row(boss_token)["server_file"]["id"], file["id"])
        self.assertEqual(self._download(boss_token, file["id"]).content, b"%PDF-1.4 first")

        outsider = self.client.post("/client/auth/register",
                                    json={"email": "out@example.com", "password": PASSWORD}).json()["token"]
        self.assertEqual(self.client.post(f"/client/project-files/{file['id']}/download-request",
                                          headers=self._h(outsider)).status_code, 404)

    def test_joining_an_org_trashes_own_files_and_creating_one_keeps_them(self):
        self._seed_project(self.token)
        own = self._upload(self.token).json()["file"]
        created = self.client.post("/client/org", headers=self.headers, json={"name": "Solo Ltd"})
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(self._download(self.token, own["id"]).content, b"%PDF-1.4 first")

        other = self.client.post("/client/auth/register",
                                 json={"email": "joiner@example.com", "password": PASSWORD}).json()
        self._seed_project(other["token"], item_ids=(21,))
        theirs = self._upload(other["token"], item_id=21).json()["file"]
        request = self.client.post("/client/org/join-requests", headers=self._h(other["token"]),
                                   json={"join_code": created.json()["join_code"]}).json()["request"]
        self.client.post(f"/client/org/join-requests/{request['id']}/approve", headers=self.headers)
        self.assertIsNotNone(self._db("SELECT trashed_at FROM client_project_files WHERE id=?", (theirs["id"],))[0])

    # ── where files are stored ──────────────────────────────────────────

    def _stored(self, file_id):
        ref = self._db("SELECT storage_ref FROM client_project_files WHERE id=?", (file_id,))[0]
        return os.path.relpath(ref, os.path.join(str(self.root), "project-files")).replace(os.sep, "/")

    def _seed_tender_project(self, token, title, tender_id, item_ids=(11,), project_id=1):
        project = {"id": project_id, "title": title}
        if tender_id:
            project["source_tender_id"] = tender_id
        self._push(token, {
            "projects": [project],
            "checklist": [{"id": i, "project_id": project_id, "req_file_name": f"Doc {i}"} for i in item_ids],
        })

    def test_files_are_stored_by_tender_owner_and_project(self):
        self.client.post("/client/auth/register", json={"email": "x@example.com", "password": PASSWORD})
        conn = sqlite3.connect(self.db_path)
        conn.execute("UPDATE client_users SET display_name='Ravi Kumar' WHERE id=?", (self.user_id,))
        conn.commit()
        conn.close()
        self._seed_tender_project(self.token, "Bridge bid", "2026_pwd_1345164_1", item_ids=(11, 12))
        first = self._upload(self.token, item_id=11, name="BOQ signed.pdf").json()["file"]
        same_name = self._upload(self.token, item_id=12, content=b"second", name="BOQ signed.pdf").json()["file"]
        self.assertEqual(self._stored(first["id"]),
                         f"P - 2026_PWD_1345164_1/Ravi Kumar (user {self.user_id})/Bridge bid (1)/BOQ signed.pdf")
        self.assertEqual(self._stored(same_name["id"]),
                         f"P - 2026_PWD_1345164_1/Ravi Kumar (user {self.user_id})/Bridge bid (1)/BOQ signed (2).pdf")
        # The apps keep the original name, and each row gets its own bytes.
        self.assertEqual(same_name["name"], "BOQ signed.pdf")
        downloaded = self._download(self.token, same_name["id"])
        self.assertEqual(downloaded.content, b"second")
        self.assertIn("BOQ%20signed.pdf", downloaded.headers["content-disposition"])

    def test_each_user_has_their_own_folder_under_the_shared_tender_folder(self):
        other = self.client.post("/client/auth/register",
                                 json={"email": "other@example.com", "password": PASSWORD}).json()
        self._seed_tender_project(self.token, "Bridge bid", "2026_PWD_1_1")
        self._seed_tender_project(other["token"], "Bridge bid", "2026_PWD_1_1")
        mine = self._upload(self.token).json()["file"]
        theirs = self._upload(other["token"]).json()["file"]
        self.assertEqual(self._stored(mine["id"]).split("/")[:2],
                         ["P - 2026_PWD_1_1", f"tester@example.com (user {self.user_id})"])
        self.assertEqual(self._stored(theirs["id"]).split("/")[:2],
                         ["P - 2026_PWD_1_1", f"other@example.com (user {other['user_id']})"])

    def test_org_members_share_the_org_folder_and_untendered_projects_sit_apart(self):
        boss = self.client.post("/client/auth/register", json={
            "email": "boss@acme.test", "password": PASSWORD, "account_type": "organisation", "org_name": "Acme: Infra",
        }).json()
        self._seed_tender_project(boss["token"], 'Fit/out "phase 1"', "", item_ids=(31,), project_id=7)
        file = self._upload(boss["token"], item_id=31).json()["file"]
        org_id = self.client.get("/client/me", headers=self._h(boss["token"])).json()["org"]["id"]
        self.assertEqual(self._stored(file["id"]),
                         f"P - No tender/Acme Infra (org {org_id})/Fit out phase 1 (7)/first.pdf")

    def test_drive_upload_uses_the_folder_layout(self):
        self._seed_tender_project(self.token, "Bridge bid", "2026_PWD_1_1")
        seen = {}

        def fake_upload(local_path, tender_id="", file_type="", prefix="", folder_id=""):
            seen.update(name=os.path.basename(local_path), folder=tender_id, prefix=prefix, type=file_type)
            return "gdrive://drive-file-1"

        self.storage.stop()
        with mock.patch.object(storage_runtime, "active_document_storage",
                               return_value=storage_runtime.DriveDocumentStorage()), \
                mock.patch.object(storage_runtime.drive_storage, "upload_file", side_effect=fake_upload):
            response = self._upload(self.token, name="BOQ.pdf")
        self.storage.start()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(seen, {
            "name": "BOQ.pdf", "prefix": "project-files/", "type": "project_file",
            "folder": f"P - 2026_PWD_1_1/tester@example.com (user {self.user_id})/Bridge bid (1)",
        })
        self.assertEqual(self._db("SELECT storage_ref FROM client_project_files WHERE id=?",
                                  (response.json()["file"]["id"],))[0], "gdrive://drive-file-1")
        # The scratch copy is gone.
        self.assertFalse(os.listdir(os.path.join(str(self.root), "project-files", ".uploading")))

    def _db(self, sql, params=()):
        conn = sqlite3.connect(self.db_path)
        try:
            return conn.execute(sql, params).fetchone()
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
