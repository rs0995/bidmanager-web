import argparse
import os
import sqlite3
from typing import Iterable


TABLES = [
    "websites",
    "organizations",
    "tenders",
    "downloaded_files",
    "projects",
    "checklist_items",
    "checklist_templates",
    "checklist_template_items",
    "checklist_template_item_files",
    "app_settings",
    "auto_archive_runs",
]


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [str(row[1]) for row in rows]


def _copy_table(sqlite_conn, pg_conn, table: str) -> int:
    columns = _table_columns(sqlite_conn, table)
    if not columns:
        return 0

    rows = sqlite_conn.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
    if not rows:
        return 0

    placeholders = ", ".join("?" for _ in columns)
    sql = (
        f"INSERT INTO {table} ({', '.join(columns)}) "
        f"VALUES ({placeholders}) ON CONFLICT DO NOTHING"
    )
    pg_conn.executemany(sql, [tuple(row) for row in rows])
    pg_conn.commit()
    return len(rows)


def _reset_sequence(pg_conn, table: str) -> None:
    try:
        pg_conn.execute(
            "SELECT setval(pg_get_serial_sequence(%s, 'id'), COALESCE((SELECT MAX(id) FROM %s), 1), true)" % ("%s", table),
            (table,),
        )
        pg_conn.commit()
    except Exception:
        try:
            pg_conn.rollback()
        except Exception:
            pass


def migrate(sqlite_path: str) -> None:
    if not os.getenv("DATABASE_URL") and not os.getenv("POSTGRES_URL"):
        raise RuntimeError("Set DATABASE_URL or POSTGRES_URL before running migration.")
    if not os.path.isfile(sqlite_path):
        raise RuntimeError(f"SQLite database not found: {sqlite_path}")

    import app_core
    import db_compat

    sqlite_conn = db_compat._ORIGINAL_CONNECT(sqlite_path)
    pg_conn = db_compat.connect("")
    try:
        app_core.init_db()
        for table in TABLES:
            copied = _copy_table(sqlite_conn, pg_conn, table)
            if copied:
                _reset_sequence(pg_conn, table)
            print(f"{table}: {copied}")
    finally:
        sqlite_conn.close()
        pg_conn.close()


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Copy BidManager SQLite data into Postgres.")
    parser.add_argument("--sqlite", default="tender_manager.db", help="Path to local tender_manager.db")
    args = parser.parse_args(list(argv) if argv is not None else None)
    migrate(args.sqlite)


if __name__ == "__main__":
    main()
