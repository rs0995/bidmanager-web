import os
import re
import sqlite3 as _sqlite3
from typing import Any, Iterable, Optional


ID_TABLES = {
    "auto_archive_runs",
    "checklist_items",
    "checklist_template_item_files",
    "checklist_template_items",
    "checklist_templates",
    "downloaded_files",
    "organizations",
    "projects",
    "tenders",
    "websites",
}


class HybridRow:
    def __init__(self, columns: list[str], values: Iterable[Any]):
        self._columns = list(columns)
        self._values = tuple(values)
        self._index = {name: idx for idx, name in enumerate(self._columns)}

    def __getitem__(self, key: int | str):
        if isinstance(key, str):
            return self._values[self._index[key]]
        return self._values[key]

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)

    def keys(self):
        return self._columns

    def items(self):
        for name in self._columns:
            yield name, self[name]


def _database_url() -> str:
    url = (
        os.getenv("DATABASE_URL")
        or os.getenv("POSTGRES_URL")
        or os.getenv("POSTGRES_CONNECTION_STRING")
        or ""
    ).strip()
    if url.startswith("postgresql://"):
        return "postgres://" + url[len("postgresql://") :]
    return url


def using_postgres() -> bool:
    return bool(_database_url())


def _convert_placeholders(sql: str) -> str:
    return sql.replace("?", "%s")


def _insert_table(sql: str) -> Optional[str]:
    match = re.match(r"\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)", sql, re.I)
    return match.group(1).lower() if match else None


def _translate_sql(sql: str, add_returning: bool = True) -> tuple[str, bool]:
    out = sql
    out = re.sub(r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT", "SERIAL PRIMARY KEY", out, flags=re.I)
    out = re.sub(r"\bALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)", r"ALTER TABLE \1 ADD COLUMN IF NOT EXISTS ", out, flags=re.I)
    out = re.sub(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", out, flags=re.I)
    out = _convert_placeholders(out)

    inserted_table = _insert_table(sql)
    upper = out.upper()
    did_add_returning = False

    if "INSERT OR IGNORE" in sql.upper() and "ON CONFLICT" not in upper:
        out = f"{out} ON CONFLICT DO NOTHING"
        upper = out.upper()

    if (
        add_returning
        and inserted_table in ID_TABLES
        and " RETURNING " not in upper
        and "ON CONFLICT DO UPDATE" not in upper
    ):
        out = f"{out} RETURNING id"
        did_add_returning = True

    return out, did_add_returning


class PostgresCursor:
    def __init__(self, cursor):
        self._cursor = cursor
        self.lastrowid = None

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    def execute(self, sql: str, params: Iterable[Any] | None = None):
        translated, added_returning = _translate_sql(sql)
        try:
            self._cursor.execute(translated, tuple(params or ()))
            self.lastrowid = None
            if added_returning and self._cursor.description:
                row = self._cursor.fetchone()
                if row is not None:
                    self.lastrowid = row[0]
        except Exception as exc:
            name = exc.__class__.__name__.lower()
            if "uniqueviolation" in name:
                try:
                    self._cursor.connection.rollback()
                except Exception:
                    pass
                raise _sqlite3.IntegrityError(str(exc)) from exc
            if "duplicatecolumn" in name:
                try:
                    self._cursor.connection.rollback()
                except Exception:
                    pass
                raise _sqlite3.OperationalError(str(exc)) from exc
            raise
        return self

    def executemany(self, sql: str, seq_of_params):
        translated, _added_returning = _translate_sql(sql, add_returning=False)
        self._cursor.executemany(translated, [tuple(params or ()) for params in seq_of_params])
        self.lastrowid = None
        return self

    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        return self._wrap_row(row)

    def fetchall(self):
        return [self._wrap_row(row) for row in self._cursor.fetchall()]

    def close(self):
        self._cursor.close()

    def _wrap_row(self, row):
        if self._cursor.description is None:
            return row
        columns = [col.name for col in self._cursor.description]
        return HybridRow(columns, row)


class PostgresConnection:
    def __init__(self, raw):
        self._raw = raw
        self.row_factory = None

    def cursor(self):
        return PostgresCursor(self._raw.cursor())

    def execute(self, sql: str, params: Iterable[Any] | None = None):
        cur = self.cursor()
        return cur.execute(sql, params)

    def executemany(self, sql: str, seq_of_params):
        cur = self.cursor()
        return cur.executemany(sql, seq_of_params)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()


def connect(_path: str = "", *args, **kwargs):
    if not using_postgres():
        return _ORIGINAL_CONNECT(_path, *args, **kwargs)
    try:
        import psycopg
    except Exception as exc:
        raise RuntimeError("Postgres mode requires psycopg. Install backend requirements.") from exc
    return PostgresConnection(psycopg.connect(_database_url()))


_ORIGINAL_CONNECT = _sqlite3.connect


def patch_sqlite3(sqlite3_module) -> None:
    if using_postgres():
        sqlite3_module.connect = connect
