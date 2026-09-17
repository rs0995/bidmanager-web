"""One-time copy of a BidManager SQLite database into Neon/PostgreSQL."""

import argparse
import os
from typing import Iterable


TABLES = [
    "websites",
    "organizations",
    "tenders",
    "tender_history",
    "downloaded_files",
    "projects",
    "checklist_items",
    "checklist_templates",
    "checklist_template_items",
    "checklist_template_item_files",
    "app_settings",
    "auto_archive_runs",
    "background_jobs",
    "saved_custom_jobs",
    "captcha_requests",
    "scheduler_leases",
]

SERIAL_TABLES = {
    "websites",
    "organizations",
    "tenders",
    "tender_history",
    "downloaded_files",
    "projects",
    "checklist_items",
    "checklist_templates",
    "checklist_template_items",
    "checklist_template_item_files",
    "auto_archive_runs",
    "saved_custom_jobs",
}


def _table_columns(conn, table: str) -> list[str]:
    rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    return [str(row[1]) for row in rows]


def _copy_table(sqlite_conn, pg_conn, table: str) -> int:
    columns = _table_columns(sqlite_conn, table)
    if not columns:
        return 0
    quoted_columns = ", ".join(f'"{column}"' for column in columns)
    rows = sqlite_conn.execute(f'SELECT {quoted_columns} FROM "{table}"').fetchall()
    if not rows:
        return 0
    placeholders = ", ".join("?" for _ in columns)
    pg_conn.executemany(
        f'INSERT INTO "{table}" ({quoted_columns}) VALUES ({placeholders}) ON CONFLICT DO NOTHING',
        [tuple(row) for row in rows],
    )
    pg_conn.commit()
    return len(rows)


def _reset_sequence(pg_conn, table: str) -> None:
    if table not in SERIAL_TABLES:
        return
    pg_conn.execute(
        f'SELECT setval(pg_get_serial_sequence(?, \'id\'), '
        f'COALESCE(MAX(id), 1), COUNT(*) > 0) FROM "{table}"',
        (table,),
    )
    pg_conn.commit()


def migrate(sqlite_path: str) -> None:
    if not any(
        str(os.getenv(name, "") or "").strip()
        for name in ("DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING")
    ):
        raise RuntimeError("Set DATABASE_URL, POSTGRES_URL, or POSTGRES_CONNECTION_STRING first.")
    if not os.path.isfile(sqlite_path):
        raise RuntimeError(f"SQLite database not found: {sqlite_path}")

    import app_core
    import db_compat

    sqlite_conn = db_compat._ORIGINAL_CONNECT(sqlite_path)
    pg_conn = db_compat.connect("")
    try:
        app_core.init_db()
        for table in TABLES:
            try:
                copied = _copy_table(sqlite_conn, pg_conn, table)
                _reset_sequence(pg_conn, table)
                print(f"{table}: {copied}")
            except Exception:
                pg_conn.rollback()
                raise
    finally:
        sqlite_conn.close()
        pg_conn.close()


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", required=True, help="Path to the source tender_manager.db")
    args = parser.parse_args(list(argv) if argv is not None else None)
    migrate(args.sqlite)


if __name__ == "__main__":
    main()
