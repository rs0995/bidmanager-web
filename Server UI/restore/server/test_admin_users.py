import unittest
from unittest import mock

import api_server


class _FakeCursor:
    def __init__(self, rows=None, one=None):
        self._rows = rows or []
        self._one = one

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._one


class _FakeConnection:
    """Returns queued _FakeCursor responses in call order, one per .execute()."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.executed = []

    def execute(self, sql, params=()):
        self.executed.append((sql, params))
        return self._responses.pop(0) if self._responses else _FakeCursor()

    def commit(self):
        pass


class _DbCtx:
    def __init__(self, responses):
        self.connection = _FakeConnection(responses)

    def __enter__(self):
        return self.connection

    def __exit__(self, exc_type, exc, traceback):
        return False


class AdminUsersTests(unittest.TestCase):
    def test_list_users_returns_public_shape_with_activity_count(self):
        rows = [{
            "id": 1, "email": "a@example.com", "display_name": "Alice", "status": "active",
            "created_at": 100.0, "last_login_at": 200.0, "last_seen_at": 300.0, "activity_count": 4,
        }]
        with mock.patch.object(api_server, "get_db", return_value=_DbCtx([_FakeCursor(rows=rows)])):
            result = api_server.admin_list_users()
        self.assertEqual(result["items"][0]["email"], "a@example.com")
        self.assertEqual(result["items"][0]["activity_count"], 4)
        self.assertNotIn("password_hash", result["items"][0])
        # No password_enc on the row -> null password, no crash.
        self.assertIsNone(result["items"][0]["password"])

    def test_list_users_exposes_decrypted_password_when_captured(self):
        rows = [{
            "id": 1, "email": "a@example.com", "display_name": "Alice", "status": "active",
            "created_at": 100.0, "last_login_at": 200.0, "last_seen_at": 300.0, "activity_count": 0,
            "password_enc": api_server.security.encrypt_password("hunter2"),
        }]
        with mock.patch.object(api_server, "get_db", return_value=_DbCtx([_FakeCursor(rows=rows)])):
            result = api_server.admin_list_users()
        self.assertEqual(result["items"][0]["password"], "hunter2")
        self.assertNotIn("password_enc", result["items"][0])

    def test_get_user_404s_when_missing(self):
        with mock.patch.object(api_server, "get_db", return_value=_DbCtx([_FakeCursor(one=None)])):
            with self.assertRaises(api_server.HTTPException) as ctx:
                api_server.admin_get_user(999)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_get_user_returns_detail_and_recent_activity(self):
        user_row = {
            "id": 1, "email": "a@example.com", "display_name": "Alice", "status": "active",
            "created_at": 100.0, "last_login_at": 200.0, "last_seen_at": 300.0,
        }
        activity_rows = [{"route": "/client/health", "tender_id": None, "created_at": 300.0}]
        with mock.patch.object(
            api_server, "get_db",
            return_value=_DbCtx([_FakeCursor(one=user_row), _FakeCursor(rows=activity_rows)]),
        ):
            result = api_server.admin_get_user(1)
        self.assertEqual(result["activity_count"], 1)
        self.assertEqual(result["recent_activity"][0]["route"], "/client/health")

    def test_suspend_user_revokes_tokens_and_updates_status(self):
        with mock.patch.object(
            api_server, "get_db",
            return_value=_DbCtx([_FakeCursor(one={"id": 1}), _FakeCursor(), _FakeCursor()]),
        ) as get_db:
            result = api_server.admin_suspend_user(1)
        self.assertEqual(result, {"ok": True, "status": "suspended"})
        executed_sql = [call[0] for call in get_db.return_value.connection.executed]
        self.assertTrue(any("UPDATE client_users SET status='suspended'" in sql for sql in executed_sql))
        self.assertTrue(any("UPDATE client_tokens SET revoked_at" in sql for sql in executed_sql))

    def test_suspend_missing_user_404s(self):
        with mock.patch.object(api_server, "get_db", return_value=_DbCtx([_FakeCursor(one=None)])):
            with self.assertRaises(api_server.HTTPException) as ctx:
                api_server.admin_suspend_user(999)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_reactivate_user_sets_active(self):
        with mock.patch.object(
            api_server, "get_db",
            return_value=_DbCtx([_FakeCursor(one={"id": 1}), _FakeCursor()]),
        ):
            result = api_server.admin_reactivate_user(1)
        self.assertEqual(result, {"ok": True, "status": "active"})

    def test_reactivate_missing_user_404s(self):
        with mock.patch.object(api_server, "get_db", return_value=_DbCtx([_FakeCursor(one=None)])):
            with self.assertRaises(api_server.HTTPException) as ctx:
                api_server.admin_reactivate_user(999)
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
