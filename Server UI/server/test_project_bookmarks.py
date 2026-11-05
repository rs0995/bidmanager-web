"""A tender in a project is always bookmarked: the server adds it, ignores a
removal while the project exists, and keeps it in the bookmark update jobs."""

import json
import sqlite3
import unittest

from fastapi.testclient import TestClient

import api_server
import client_api
import test_client_api

ADMIN = {"x-admin-key": "admin-secret"}
PASSWORD = "correct horse battery"


class ProjectBookmarkTests(unittest.TestCase):
    def setUp(self):
        test_client_api.ClientApiTests.setUp(self)
        self.client.close()
        self.client = TestClient(api_server.app)

    def tearDown(self):
        test_client_api.ClientApiTests.tearDown(self)

    headers = test_client_api.ClientApiTests.headers

    def _push(self, data, removed=None, token=None):
        body = {"data": data}
        if removed is not None:
            body["removed"] = removed
        response = self.client.put("/client/sync", headers={"x-client-key": token or self.token}, json=body)
        self.assertEqual(response.status_code, 200, response.text)

    def _pull(self, token=None):
        return self.client.get("/client/sync", headers={"x-client-key": token or self.token}).json()["data"]

    def test_a_new_projects_tender_is_bookmarked(self):
        self._push({"projects": [{"id": 1, "title": "Bridge bid", "source_tender_id": " t-100 "}]})
        data = self._pull()
        self.assertEqual(data["bookmarkTenderIds"], ["T-100"])
        self.assertEqual(data["bookmarks"], [1])  # row id handle for older apps
        # The 24-hour bookmark job now covers its organisation.
        conn = sqlite3.connect(self.db_path)
        orgs = conn.execute("SELECT org_ids_json FROM saved_custom_jobs WHERE created_by='user'").fetchone()
        conn.close()
        self.assertEqual(json.loads(orgs[0]), [1])

    def test_a_project_tender_cannot_be_unbookmarked_until_the_project_goes(self):
        self._push({"projects": [{"id": 1, "title": "Bridge bid", "source_tender_id": "T-100"}],
                    "bookmarkTenderIds": ["T-100", "T-200"]})
        self._push({"bookmarkTenderIds": []}, removed={"bookmarkTenderIds": ["T-100", "T-200"]})
        self.assertEqual(self._pull()["bookmarkTenderIds"], ["T-100"])
        self._push({"projects": []}, removed={"projects": [1]})
        self._push({"bookmarkTenderIds": []}, removed={"bookmarkTenderIds": ["T-100"]})
        self.assertEqual(self._pull()["bookmarkTenderIds"], [])

    def test_existing_projects_show_their_tender_as_bookmarked_on_pull(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO client_user_sync (user_id, data_json, updated_at) VALUES (?,?,1)",
            (self.user_id, json.dumps({"projects": [{"id": 4, "source_tender_id": "T-200"}],
                                       "bookmarkTenderIds": []})),
        )
        conn.commit()
        conn.close()
        self.assertEqual(self._pull()["bookmarkTenderIds"], ["T-200"])

    def test_a_project_without_a_tender_changes_nothing(self):
        self._push({"projects": [{"id": 1, "title": "Office fit-out"}], "bookmarkTenderIds": []})
        self.assertEqual(self._pull()["bookmarkTenderIds"], [])

    def test_org_project_bookmarks_the_tender_for_the_org(self):
        boss = self.client.post("/client/auth/register", json={
            "email": "boss@acme.test", "password": PASSWORD, "account_type": "organisation", "org_name": "Acme",
        }).json()
        code = self.client.get("/client/org", headers={"x-client-key": boss["token"]}).json()["join_code"]
        request = self.client.post("/client/org/join-requests", headers=self.headers,
                                   json={"join_code": code}).json()["request"]
        self.client.post(f"/client/org/join-requests/{request['id']}/approve",
                         headers={"x-client-key": boss["token"]})
        member = self.client.post("/client/auth/login",
                                  json={"email": "tester@example.com", "password": PASSWORD}).json()["token"]
        self._push({"projects": [{"id": 1, "source_tender_id": "T-100"}]}, token=member)
        self.assertEqual(self._pull(token=boss["token"])["bookmarkTenderIds"], ["T-100"])

    def test_without_the_bookmarks_section_no_bookmark_keys_are_sent(self):
        self._push({"projects": [{"id": 1, "source_tender_id": "T-100"}]})
        self.client.put(f"/admin/users/{self.user_id}/permissions", headers=ADMIN, json={"bookmarks": False})
        data = self._pull()
        self.assertNotIn("bookmarkTenderIds", data)
        self.assertEqual([p["id"] for p in data["projects"]], [1])


if __name__ == "__main__":
    unittest.main()
