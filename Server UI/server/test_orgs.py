"""Organisations, membership and per-section access (org_access.py) through the
real routes: /client/* for users and org admins, /admin/* for the operator.

Reuses test_client_api's fixture database (two tenders: T-100 active under
'Road Authority', T-200 archived under 'Water Authority') plus T-300, active
under 'Bridge Board'."""

import json
import sqlite3
import time
import unittest

from fastapi.testclient import TestClient

import api_server
import client_api
import test_client_api

ADMIN = {"x-admin-key": "admin-secret"}
PASSWORD = "correct horse battery"


class OrgAccessTests(unittest.TestCase):
    def setUp(self):
        # Same temp database, patches and first user as the client API tests.
        test_client_api.ClientApiTests.setUp(self)
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO tenders (id,website_id,org_chain,tender_id,title,status,is_archived) "
            "VALUES (3,1,'Bridge Board','T-300','Flyover','Open',0)"
        )
        conn.execute(
            "INSERT INTO organizations VALUES (3,1,'Bridge Board','https://example.test/org/3',1,1,0,0,0,NULL,1,NULL,NULL)"
        )
        conn.commit()
        conn.close()
        self.client.close()
        # The full app: client routes plus the operator's /admin routes.
        self.client = TestClient(api_server.app)

    def tearDown(self):
        test_client_api.ClientApiTests.tearDown(self)

    headers = test_client_api.ClientApiTests.headers
    _row = test_client_api.ClientApiTests._row

    # ── helpers ─────────────────────────────────────────────────────────

    def _register(self, email, **extra):
        response = self.client.post(
            "/client/auth/register", json={"email": email, "password": PASSWORD, **extra}
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        return body["token"], body["user_id"]

    def _login(self, email):
        response = self.client.post("/client/auth/login", json={"email": email, "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["token"]

    @staticmethod
    def _h(token):
        return {"x-client-key": token}

    def _pull(self, token):
        response = self.client.get("/client/sync", headers=self._h(token))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _push(self, token, data, base=None, removed=None):
        body = {"data": data}
        if base is not None:
            body["base_updated_at"] = base
        if removed is not None:
            body["removed"] = removed
        response = self.client.put("/client/sync", headers=self._h(token), json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _me(self, token):
        response = self.client.get("/client/me", headers=self._h(token))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _org_with_member(self, permissions=None):
        """Org 'Acme' (admin@) with member@ approved. Returns tokens and ids."""
        admin_token, admin_id = self._register("admin@acme.test", account_type="organisation", org_name="Acme")
        code = self.client.get("/client/org", headers=self._h(admin_token)).json()["join_code"]
        member_token, member_id = self._register("member@acme.test")
        request = self.client.post(
            "/client/org/join-requests", headers=self._h(member_token), json={"join_code": code}
        ).json()["request"]
        body = {"permissions": permissions} if permissions is not None else {}
        approve = self.client.post(
            f"/client/org/join-requests/{request['id']}/approve", headers=self._h(admin_token), json=body
        )
        self.assertEqual(approve.status_code, 200, approve.text)
        return admin_token, admin_id, self._login("member@acme.test"), member_id

    def _tender_ids(self, token, **params):
        response = self.client.get("/client/tenders", headers=self._h(token), params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return sorted(item["tender_id"] for item in response.json()["items"])

    # ── existing accounts ───────────────────────────────────────────────

    def test_existing_user_is_an_individual_with_every_section(self):
        me = self._me(self.token)
        self.assertEqual(me["account_type"], "individual")
        self.assertIsNone(me["org"])
        self.assertEqual(me["permissions"], {"active": True, "archived": True, "bookmarks": True, "projects": True,
                                            "portal_search": False})
        self.assertIsNone(self._row("SELECT permissions_json FROM client_users WHERE id=?", (self.user_id,))[0])
        login = self.client.post("/client/auth/login", json={"email": "tester@example.com", "password": PASSWORD})
        self.assertEqual(login.json()["account"]["account_type"], "individual")

    def test_individual_sync_and_tenders_are_unchanged(self):
        data = {"projects": [{"id": 1, "title": "Bridge bid", "source_tender_id": "T-100"}],
                "bookmarkTenderIds": ["T-200"], "tenderColumnPrefs": {"title": 200}}
        self._push(self.token, data)
        pulled = self._pull(self.token)["data"]
        self.assertEqual(pulled["projects"][0]["title"], "Bridge bid")
        # T-100 is the project's tender, so it is bookmarked too (always).
        self.assertEqual(pulled["bookmarkTenderIds"], ["T-100", "T-200"])
        self.assertEqual(pulled["tenderColumnPrefs"], {"title": 200})
        self.assertEqual(self._tender_ids(self.token), ["T-100", "T-200", "T-300"])
        stats = self.client.get("/client/stats", headers=self.headers).json()
        self.assertEqual(stats["total_tenders"], 3)
        self.assertEqual(stats["documents"], 1)

    # ── organisations ───────────────────────────────────────────────────

    def test_organisation_signup_creates_the_org_with_its_admin(self):
        token, user_id = self._register("boss@acme.test", account_type="organisation", org_name="Acme")
        me = self._me(token)
        self.assertEqual(me["account_type"], "organisation")
        self.assertEqual(me["org"]["role"], "admin")
        org = self.client.get("/client/org", headers=self._h(token)).json()
        self.assertEqual(org["name"], "Acme")
        self.assertEqual(len(org["join_code"]), 8)
        self.assertEqual([m["user_id"] for m in org["members"]], [user_id])

    def test_organisation_signup_needs_a_name(self):
        response = self.client.post("/client/auth/register", json={
            "email": "x@acme.test", "password": PASSWORD, "account_type": "organisation",
        })
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(self._row("SELECT id FROM client_users WHERE email='x@acme.test'"))

    def test_individual_creating_an_org_keeps_their_data_as_the_orgs(self):
        self._push(self.token, {"projects": [{"id": 5, "title": "Mine"}], "tenderColumnPrefs": {"a": 1}})
        created = self.client.post("/client/org", headers=self.headers, json={"name": "Solo Ltd"})
        self.assertEqual(created.status_code, 200, created.text)
        pulled = self._pull(self.token)["data"]
        self.assertEqual([p["title"] for p in pulled["projects"]], ["Mine"])
        self.assertEqual(pulled["tenderColumnPrefs"], {"a": 1})
        own = json.loads(self._row("SELECT data_json FROM client_user_sync WHERE user_id=?", (self.user_id,))[0])
        self.assertNotIn("projects", own)

    def test_join_approval_discards_personal_data_and_signs_out(self):
        admin_token, _admin_id = self._register("admin@acme.test", account_type="organisation", org_name="Acme")
        code = self.client.get("/client/org", headers=self._h(admin_token)).json()["join_code"]
        member_token, member_id = self._register("member@acme.test")
        self._push(member_token, {"projects": [{"id": 9, "title": "Old"}], "tenderColumnPrefs": {"x": 1}})
        sent = self.client.post(
            "/client/org/join-requests", headers=self._h(member_token), json={"join_code": code.lower()}
        )
        self.assertEqual(sent.status_code, 200, sent.text)
        self.assertIn("discarded", sent.json()["warning"])
        self.assertEqual(self._me(member_token)["pending_request"]["org_name"], "Acme")
        pending = self.client.get("/client/org/join-requests", headers=self._h(admin_token)).json()["items"]
        self.assertEqual([r["user_id"] for r in pending], [member_id])

        self.client.post(
            f"/client/org/join-requests/{pending[0]['id']}/approve", headers=self._h(admin_token),
            json={"permissions": {"active": False, "archived": False}},
        )
        self.assertEqual(self.client.get("/client/me", headers=self._h(member_token)).status_code, 401)
        token = self._login("member@acme.test")
        me = self._me(token)
        self.assertEqual(me["org"], {"id": me["org"]["id"], "name": "Acme", "role": "member"})
        self.assertEqual(me["permissions"], {"active": False, "archived": False, "bookmarks": True, "projects": True,
                                            "portal_search": False})
        pulled = self._pull(token)["data"]
        self.assertNotIn("Old", [p.get("title") for p in pulled.get("projects", [])])
        self.assertEqual(pulled["tenderColumnPrefs"], {"x": 1})

    def test_members_share_projects_and_bookmarks(self):
        admin_token, _a, member_token, _m = self._org_with_member()
        self._push(admin_token, {"projects": [{"id": 1, "title": "Shared bid"}]}, base=self._pull(admin_token)["updated_at"])
        member_view = self._pull(member_token)
        self.assertEqual([p["title"] for p in member_view["data"]["projects"]], ["Shared bid"])
        self._push(member_token, {"bookmarkTenderIds": ["T-100"]}, base=member_view["updated_at"])
        self.assertEqual(self._pull(admin_token)["data"]["bookmarkTenderIds"], ["T-100"])

    def test_hidden_section_is_left_out_and_ignored_until_turned_back_on(self):
        admin_token, _a, member_token, member_id = self._org_with_member()
        self._push(admin_token, {"projects": [{"id": 1, "title": "Shared bid"}]})
        changed = self.client.put(
            f"/client/org/members/{member_id}/permissions", headers=self._h(admin_token),
            json={"projects": False},
        )
        self.assertEqual(changed.json()["permissions"]["projects"], False)
        self.assertNotIn("projects", self._pull(member_token)["data"])
        self._push(member_token, {"projects": [{"id": 2, "title": "Sneaky"}]}, removed={"projects": [1]})
        self.assertEqual([p["title"] for p in self._pull(admin_token)["data"]["projects"]], ["Shared bid"])
        self.client.put(
            f"/client/org/members/{member_id}/permissions", headers=self._h(admin_token),
            json={"projects": True},
        )
        self.assertEqual([p["title"] for p in self._pull(member_token)["data"]["projects"]], ["Shared bid"])

    def test_bookmarks_only_member_sees_only_bookmarked_tenders(self):
        admin_token, _a, member_token, _m = self._org_with_member(
            {"active": False, "archived": False, "projects": False}
        )
        self._push(admin_token, {"bookmarkTenderIds": ["T-100"], "bookmarkedOrgs": ["Road Authority"]})
        self.assertEqual(self._tender_ids(member_token), ["T-100"])
        self.assertEqual(self._tender_ids(member_token, archived="true"), [])
        self.assertEqual(self.client.get("/client/tenders/1", headers=self._h(member_token)).status_code, 200)
        for tender_id in (2, 3):
            self.assertEqual(
                self.client.get(f"/client/tenders/{tender_id}", headers=self._h(member_token)).status_code, 404
            )
        resolved = self.client.post(
            "/client/tenders/resolve", headers=self._h(member_token), json={"tender_ids": ["T-100", "T-300"]}
        ).json()["tenders"]
        self.assertEqual(sorted(resolved), ["T-100"])
        orgs = self.client.get("/client/organizations", headers=self._h(member_token)).json()["items"]
        self.assertEqual([o["name"] for o in orgs], ["Road Authority"])
        self.assertEqual(self.client.get("/client/stats", headers=self._h(member_token)).json()["total_tenders"], 1)
        refresh = self.client.post("/client/organizations/1/request-tenders", headers=self._h(member_token))
        self.assertEqual(refresh.status_code, 403)
        # The admin still sees everything.
        self.assertEqual(self._tender_ids(admin_token), ["T-100", "T-200", "T-300"])

    def test_project_tenders_stay_visible_with_only_projects(self):
        admin_token, _a, member_token, _m = self._org_with_member(
            {"active": False, "archived": False, "bookmarks": False}
        )
        self._push(admin_token, {"projects": [{"id": 1, "title": "Flyover bid", "source_tender_id": "T-300"}],
                                 "bookmarkTenderIds": ["T-100"]})
        self.assertEqual(self._tender_ids(member_token), ["T-300"])
        self.assertNotIn("bookmarkTenderIds", self._pull(member_token)["data"])

    def test_operator_can_restrict_an_individual_to_archived_tenders(self):
        response = self.client.put(
            f"/admin/users/{self.user_id}/permissions", headers=ADMIN,
            json={"active": False, "bookmarks": False, "projects": False},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self._tender_ids(self.token), ["T-200"])
        orgs = self.client.get("/client/organizations", headers=self.headers, params={"archived": "true"}).json()
        self.assertEqual([o["name"] for o in orgs["items"]], ["Water Authority"])
        self.assertEqual(self.client.get("/client/organizations", headers=self.headers).json()["items"], [])
        # All sections back on: stored as NULL again, exactly like before.
        self.client.put(f"/admin/users/{self.user_id}/permissions", headers=ADMIN,
                        json={"active": True, "bookmarks": True, "projects": True})
        self.assertIsNone(self._row("SELECT permissions_json FROM client_users WHERE id=?", (self.user_id,))[0])
        self.assertEqual(self._tender_ids(self.token), ["T-100", "T-200", "T-300"])

    def test_disabled_section_keeps_its_stored_data(self):
        self._push(self.token, {"projects": [{"id": 1, "title": "Keep me"}]})
        self.client.put(f"/admin/users/{self.user_id}/permissions", headers=ADMIN, json={"projects": False})
        self.assertNotIn("projects", self._pull(self.token)["data"])
        self._push(self.token, {"projects": []}, removed={"projects": [1]})
        self.client.put(f"/admin/users/{self.user_id}/permissions", headers=ADMIN, json={"projects": True})
        self.assertEqual([p["title"] for p in self._pull(self.token)["data"]["projects"]], ["Keep me"])

    # ── leaving an org ──────────────────────────────────────────────────

    def test_delink_with_retain_keeps_only_bookmarks(self):
        admin_token, _a, member_token, member_id = self._org_with_member()
        self._push(admin_token, {"projects": [{"id": 1, "title": "Org bid"}],
                                 "bookmarkTenderIds": ["T-100"], "bookmarkedOrgs": ["Road Authority"]})
        response = self.client.post(
            f"/client/org/members/{member_id}/delink", headers=self._h(admin_token), json={"retain": True}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/client/me", headers=self._h(member_token)).status_code, 401)
        token = self._login("member@acme.test")
        me = self._me(token)
        self.assertEqual(me["account_type"], "individual")
        self.assertEqual(me["permissions"], {"active": True, "archived": True, "bookmarks": True,
                                             "projects": True, "portal_search": False})
        data = self._pull(token)["data"]
        self.assertEqual(data["bookmarkTenderIds"], ["T-100"])
        self.assertEqual(data["bookmarkedOrgs"], ["Road Authority"])
        self.assertNotIn("projects", data)
        # The org keeps its data.
        self.assertEqual([p["title"] for p in self._pull(admin_token)["data"]["projects"]], ["Org bid"])

    def test_delink_without_retain_wipes_the_account(self):
        admin_token, _a, member_token, member_id = self._org_with_member()
        self._push(member_token, {"tenderColumnPrefs": {"x": 1}})
        self._push(admin_token, {"bookmarkTenderIds": ["T-100"]})
        self.client.post(
            f"/client/org/members/{member_id}/delink", headers=self._h(admin_token), json={"retain": False}
        )
        self.assertEqual(self._pull(self._login("member@acme.test"))["data"], {})

    def test_stale_device_push_after_delink_is_ignored(self):
        admin_token, _a, member_token, member_id = self._org_with_member()
        self._push(admin_token, {"projects": [{"id": 1, "title": "Org bid"}]})
        stale_base = self._pull(member_token)["updated_at"]
        self.client.post(
            f"/client/org/members/{member_id}/delink", headers=self._h(admin_token), json={"retain": True}
        )
        token = self._login("member@acme.test")
        self._push(token, {"projects": [{"id": 1, "title": "Org bid"}]}, base=stale_base)
        fresh = self._pull(token)
        self.assertNotIn("projects", fresh["data"])
        self._push(token, {"projects": [{"id": 7, "title": "New own bid"}]}, base=fresh["updated_at"])
        self.assertEqual([p["title"] for p in self._pull(token)["data"]["projects"]], ["New own bid"])

    def test_org_always_keeps_an_admin(self):
        admin_token, admin_id, _member_token, member_id = self._org_with_member()
        demote = self.client.put(
            f"/client/org/members/{admin_id}/role", headers=self._h(admin_token), json={"role": "member"}
        )
        self.assertEqual(demote.status_code, 409)
        leave = self.client.post(
            f"/client/org/members/{admin_id}/delink", headers=self._h(admin_token), json={"retain": True}
        )
        self.assertEqual(leave.status_code, 409)
        self.client.put(f"/client/org/members/{member_id}/role", headers=self._h(admin_token), json={"role": "admin"})
        demote = self.client.put(
            f"/client/org/members/{admin_id}/role", headers=self._h(admin_token), json={"role": "member"}
        )
        self.assertEqual(demote.status_code, 200, demote.text)

    # ── requests & rights ───────────────────────────────────────────────

    def test_join_request_errors_and_cancel(self):
        admin_token, _a = self._register("admin@acme.test", account_type="organisation", org_name="Acme")
        code = self.client.get("/client/org", headers=self._h(admin_token)).json()["join_code"]
        bad = self.client.post("/client/org/join-requests", headers=self.headers, json={"join_code": "NOPE1234"})
        self.assertEqual(bad.status_code, 404)
        self.client.post("/client/org/join-requests", headers=self.headers, json={"join_code": code})
        again = self.client.post("/client/org/join-requests", headers=self.headers, json={"join_code": code})
        self.assertEqual(again.status_code, 409)
        self.assertEqual(self.client.delete("/client/org/join-requests/mine", headers=self.headers).status_code, 200)
        self.assertIsNone(self.client.get("/client/org/join-requests/mine", headers=self.headers).json()["request"])
        own = self.client.post("/client/org/join-requests", headers=self._h(admin_token), json={"join_code": code})
        self.assertEqual(own.status_code, 409)

    def test_rejected_request_leaves_the_user_alone(self):
        admin_token, _a = self._register("admin@acme.test", account_type="organisation", org_name="Acme")
        code = self.client.get("/client/org", headers=self._h(admin_token)).json()["join_code"]
        self._push(self.token, {"projects": [{"id": 3, "title": "Still mine"}]})
        request = self.client.post(
            "/client/org/join-requests", headers=self.headers, json={"join_code": code}
        ).json()["request"]
        self.client.post(f"/client/org/join-requests/{request['id']}/reject", headers=self._h(admin_token))
        self.assertEqual(self._me(self.token)["account_type"], "individual")
        self.assertEqual([p["title"] for p in self._pull(self.token)["data"]["projects"]], ["Still mine"])

    def test_members_cannot_manage_the_org(self):
        _admin_token, admin_id, member_token, _m = self._org_with_member()
        self.assertEqual(self.client.get("/client/org", headers=self._h(member_token)).status_code, 403)
        response = self.client.post(
            f"/client/org/members/{admin_id}/delink", headers=self._h(member_token), json={"retain": True}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get("/client/org", headers=self.headers).status_code, 403)

    def test_admin_cannot_manage_another_orgs_member(self):
        _admin_token, _a, _member_token, member_id = self._org_with_member()
        other_token, _o = self._register("boss@other.test", account_type="organisation", org_name="Other")
        response = self.client.put(
            f"/client/org/members/{member_id}/permissions", headers=self._h(other_token), json={"projects": False}
        )
        self.assertEqual(response.status_code, 404)

    # ── operator ────────────────────────────────────────────────────────

    def test_operator_routes_need_the_admin_key(self):
        self.assertEqual(self.client.get("/admin/orgs").status_code, 401)

    def test_operator_manages_orgs(self):
        created = self.client.post("/admin/orgs", headers=ADMIN, json={"name": "Ops Org", "admin_user_id": self.user_id})
        self.assertEqual(created.status_code, 200, created.text)
        org_id = created.json()["id"]
        other_token, other_id = self._register("other@example.com")
        self.client.post(f"/admin/orgs/{org_id}/members", headers=ADMIN,
                         json={"user_id": other_id, "permissions": {"archived": False}})
        listed = self.client.get("/admin/orgs", headers=ADMIN).json()["items"]
        self.assertEqual([(o["name"], o["member_count"]) for o in listed], [("Ops Org", 2)])
        detail = self.client.get(f"/admin/orgs/{org_id}", headers=ADMIN).json()
        member = next(m for m in detail["members"] if m["user_id"] == other_id)
        self.assertFalse(member["permissions"]["archived"])
        users = {u["id"]: u for u in self.client.get("/admin/users", headers=ADMIN).json()["items"]}
        self.assertEqual(users[self.user_id]["org"]["role"], "admin")
        self.assertEqual(users[other_id]["account_type"], "organisation")
        self.assertEqual(self.client.get(f"/admin/users/{other_id}", headers=ADMIN).json()["org"]["name"], "Ops Org")

        dissolved = self.client.delete(f"/admin/orgs/{org_id}", headers=ADMIN, params={"retain": "true"})
        self.assertEqual(dissolved.json()["members_released"], 2)
        self.assertEqual(self.client.get("/admin/orgs", headers=ADMIN).json()["items"], [])
        self.assertEqual(self._me(self._login("other@example.com"))["account_type"], "individual")

    def test_operator_approves_a_request(self):
        admin_token, _a = self._register("admin@acme.test", account_type="organisation", org_name="Acme")
        org = self.client.get("/client/org", headers=self._h(admin_token)).json()
        request = self.client.post(
            "/client/org/join-requests", headers=self.headers, json={"join_code": org["join_code"]}
        ).json()["request"]
        approved = self.client.post(
            f"/admin/orgs/{org['id']}/join-requests/{request['id']}/approve", headers=ADMIN,
            json={"permissions": {"projects": False}},
        )
        self.assertEqual(approved.json()["request"]["status"], "approved")
        self.assertFalse(self._me(self._login("tester@example.com"))["permissions"]["projects"])

    # ── alerts & bookmark scraping ──────────────────────────────────────

    def test_changes_feed_follows_org_bookmarks_and_permissions(self):
        admin_token, _a, member_token, member_id = self._org_with_member()
        self._push(admin_token, {"bookmarkTenderIds": ["T-100"]})
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO tender_history (tender_db_id, tender_key, scraped_at, content_hash, changed_fields) "
            "VALUES (1,'T-100',?,'h','[\"status\"]')",
            (time.time(),),
        )
        conn.commit()
        conn.close()
        since = time.time() - 60
        changes = self.client.get("/client/changes", headers=self._h(member_token), params={"since": since}).json()
        self.assertEqual([t["tender_id"] for t in changes["tenders"]], ["T-100"])
        self.client.put(f"/client/org/members/{member_id}/permissions", headers=self._h(admin_token),
                        json={"bookmarks": False})
        changes = self.client.get("/client/changes", headers=self._h(member_token), params={"since": since}).json()
        self.assertEqual(changes["tenders"], [])

    def test_org_bookmarks_count_for_bookmark_scraping(self):
        admin_token, _a = self._register("admin@acme.test", account_type="organisation", org_name="Acme")
        self._push(admin_token, {"bookmarkTenderIds": ["T-300"]})
        with client_api._get_db() as conn:
            tender_counts, _org_counts = client_api._bookmark_union(conn)
        self.assertEqual(tender_counts, {3: 1})


if __name__ == "__main__":
    unittest.main()
