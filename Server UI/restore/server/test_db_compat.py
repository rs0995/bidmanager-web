import os
import sys
import types
import unittest
from unittest import mock

import db_compat


class _RawCursor:
    def __init__(self):
        self.calls = []
        self.description = None
        self.rowcount = 0
        self.connection = None
        self.closed = False

    def execute(self, sql, params):
        self.calls.append((sql, params))

    def executemany(self, sql, params):
        self.calls.append((sql, params))

    def close(self):
        self.closed = True


class _RawConnection:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0
        self.closed = False
        self.cursor_instance = _RawCursor()
        self.cursor_instance.connection = self

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


class UniqueViolation(Exception):
    pass


class _UniqueTenderCursor(_RawCursor):
    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        if str(sql).lstrip().upper().startswith("INSERT INTO TENDERS"):
            raise UniqueViolation("duplicate tender")


class _IterableCursor(_RawCursor):
    def __init__(self):
        super().__init__()
        self.description = [type("Column", (), {"name": "id"})()]
        self.rows = [(1,), (2,)]

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


class PostgresCompatibilityTests(unittest.TestCase):
    def test_placeholder_translation_ignores_quoted_question_marks(self):
        sql = "SELECT '?' AS literal, \"?\" AS identifier WHERE id=? AND note='it''s ?'"
        converted = db_compat._convert_placeholders(sql)
        self.assertEqual(converted.count("%s"), 1)
        self.assertIn("SELECT '?'", converted)
        self.assertIn("note='it''s ?'", converted)

    def test_sqlite_instr_search_is_translated_to_postgres_strpos(self):
        sql = (
            "WHERE INSTR(LOWER(COALESCE(tender_id,'')), LOWER(?)) > 0 "
            "OR INSTR(LOWER(?), LOWER(COALESCE(tender_id,''))) > 0"
        )
        translated, _ = db_compat._translate_sql(sql)
        self.assertNotIn("INSTR", translated.upper())
        self.assertEqual(translated.upper().count("STRPOS"), 2)
        self.assertEqual(translated.count("%s"), 2)

    def test_schema_and_insert_or_ignore_translation(self):
        schema, _ = db_compat._translate_sql(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL)"
        )
        self.assertIn("SERIAL PRIMARY KEY", schema)
        self.assertIn("created_at DOUBLE PRECISION", schema)
        insert, returning = db_compat._translate_sql(
            "INSERT OR IGNORE INTO projects (title) VALUES (?)"
        )
        self.assertIn("ON CONFLICT DO NOTHING", insert)
        self.assertTrue(returning)
        self.assertTrue(insert.endswith("RETURNING id"))

    def test_pragma_is_a_safe_noop_in_postgres_mode(self):
        raw = _RawCursor()
        cursor = db_compat.PostgresCursor(raw)
        cursor.execute("PRAGMA foreign_keys=ON")
        self.assertEqual(raw.calls, [])

    def test_connection_context_commits_or_rolls_back_and_closes(self):
        raw = _RawConnection()
        with db_compat.PostgresConnection(raw):
            pass
        self.assertEqual(raw.commits, 1)
        self.assertTrue(raw.closed)

        raw_error = _RawConnection()
        with self.assertRaises(RuntimeError):
            with db_compat.PostgresConnection(raw_error):
                raise RuntimeError("failure")
        self.assertEqual(raw_error.rollbacks, 1)
        self.assertTrue(raw_error.closed)

    def test_expected_unique_violation_rolls_back_only_the_statement(self):
        raw_connection = _RawConnection()
        raw_cursor = _UniqueTenderCursor()
        raw_cursor.connection = raw_connection
        cursor = db_compat.PostgresCursor(raw_cursor)
        with self.assertRaises(Exception) as raised:
            cursor.execute("INSERT INTO tenders (tender_id) VALUES (?)", ("T-1",))
        self.assertIsInstance(raised.exception, __import__("sqlite3").IntegrityError)
        statements = [call[0] for call in raw_cursor.calls]
        self.assertIn("ROLLBACK TO SAVEPOINT bidmanager_compat_statement", statements)
        self.assertEqual(raw_connection.rollbacks, 0)

    def test_hybrid_row_supports_mapping_get(self):
        row = db_compat.HybridRow(["id", "name"], [7, "Tender"])
        self.assertEqual(row.get("name"), "Tender")
        self.assertEqual(row.get("missing", "fallback"), "fallback")
        self.assertIn("id", row)

    def test_postgres_cursor_is_iterable_like_sqlite_cursor(self):
        rows = list(db_compat.PostgresCursor(_IterableCursor()))
        self.assertEqual([row["id"] for row in rows], [1, 2])

    def test_connection_tracks_sqlite_style_total_changes_for_dml(self):
        raw = _RawConnection()
        raw.cursor_instance.rowcount = 2
        conn = db_compat.PostgresConnection(raw)
        conn.execute("UPDATE projects SET status=?", ("Active",))
        self.assertEqual(conn.total_changes, 2)
        conn.execute("SELECT id FROM projects")
        self.assertEqual(conn.total_changes, 2)

    def test_pooled_connection_is_returned_not_closed(self):
        class _FakePool:
            def __init__(self):
                self.returned = []

            def putconn(self, raw):
                self.returned.append(raw)

        pool = _FakePool()

        # Explicit close(): rolled back and handed back to the pool, socket kept.
        raw = _RawConnection()
        conn = db_compat.PostgresConnection(raw, pool=pool)
        conn.close()
        self.assertEqual(pool.returned, [raw])
        self.assertEqual(raw.rollbacks, 1)
        self.assertFalse(raw.closed)

        # Context-manager exit follows the same path (commit then return).
        raw2 = _RawConnection()
        with db_compat.PostgresConnection(raw2, pool=pool):
            pass
        self.assertEqual(raw2.commits, 1)
        self.assertIn(raw2, pool.returned)
        self.assertFalse(raw2.closed)

        # Repeated open/close cycles must not accumulate live connections.
        for _ in range(50):
            db_compat.PostgresConnection(_RawConnection(), pool=pool).close()
        self.assertEqual(len(pool.returned), 52)

    def test_pool_is_built_with_liveness_check_and_finite_lifetime(self):
        # A pooled Neon connection that Neon has since closed must not be handed
        # back out: the pool needs check= (validate on checkout) and finite
        # max_lifetime / max_idle so stale sockets are recycled, not queried.
        captured = {}

        class _FakePool:
            check_connection = staticmethod(lambda conn: None)

            def __init__(self, conninfo, **kwargs):
                captured["conninfo"] = conninfo
                captured["kwargs"] = kwargs

            def open(self, *a, **k):
                captured["opened"] = True

        fake_module = types.ModuleType("psycopg_pool")
        fake_module.ConnectionPool = _FakePool

        saved_pool = db_compat._pool
        saved_mod = sys.modules.get("psycopg_pool")
        db_compat._pool = None
        sys.modules["psycopg_pool"] = fake_module
        try:
            self.assertTrue(db_compat.using_postgres())  # test env points DATABASE_URL at PG
            pool = db_compat._get_pool()
        finally:
            db_compat._pool = saved_pool
            if saved_mod is not None:
                sys.modules["psycopg_pool"] = saved_mod
            else:
                sys.modules.pop("psycopg_pool", None)

        self.assertIsInstance(pool, _FakePool)
        kwargs = captured["kwargs"]
        self.assertIs(kwargs.get("check"), _FakePool.check_connection)
        self.assertTrue(0 < kwargs.get("max_lifetime") < 3600)
        self.assertTrue(0 < kwargs.get("max_idle") <= kwargs["max_lifetime"])
        self.assertIsNone(kwargs.get("kwargs", {}).get("prepare_threshold", "missing"))

    def test_double_close_is_safe(self):
        raw = _RawConnection()
        conn = db_compat.PostgresConnection(raw)
        conn.close()
        conn.close()
        self.assertTrue(raw.closed)


if __name__ == "__main__":
    unittest.main()
