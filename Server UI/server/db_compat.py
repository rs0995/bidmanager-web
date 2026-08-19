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
    "saved_custom_jobs",
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

    def get(self, key: str, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def __contains__(self, key):
        return key in self._index if isinstance(key, str) else key in self._values


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
    output = []
    quote = ""
    index = 0
    while index < len(sql):
        char = sql[index]
        if quote:
            output.append(char)
            if char == quote:
                if index + 1 < len(sql) and sql[index + 1] == quote:
                    output.append(sql[index + 1])
                    index += 1
                else:
                    quote = ""
        elif char in {"'", '"'}:
            quote = char
            output.append(char)
        elif char == "?":
            output.append("%s")
        else:
            output.append(char)
        index += 1
    return "".join(output)


def _translate_functions(sql: str) -> str:
    tender_value = r"LOWER\(COALESCE\(tender_id,''\)\)"
    placeholder = r"LOWER\(%s\)"
    out = re.sub(
        rf"INSTR\({tender_value},\s*{placeholder}\)",
        "STRPOS(LOWER(COALESCE(tender_id,'')), LOWER(%s))",
        sql,
        flags=re.I,
    )
    return re.sub(
        rf"INSTR\({placeholder},\s*{tender_value}\)",
        "STRPOS(LOWER(%s), LOWER(COALESCE(tender_id,'')))",
        out,
        flags=re.I,
    )


def _insert_table(sql: str) -> Optional[str]:
    match = re.match(r"\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)", sql, re.I)
    return match.group(1).lower() if match else None


def _translate_sql(sql: str, add_returning: bool = True) -> tuple[str, bool]:
    out = sql
    out = re.sub(r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT", "SERIAL PRIMARY KEY", out, flags=re.I)
    # SQLite REAL is an 8-byte float, while PostgreSQL REAL is only 4 bytes.
    # Durable job timestamps need epoch-second precision, so preserve SQLite's
    # semantics explicitly.
    out = re.sub(r"\bREAL\b", "DOUBLE PRECISION", out, flags=re.I)
    out = re.sub(r"\bALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)", r"ALTER TABLE \1 ADD COLUMN IF NOT EXISTS ", out, flags=re.I)
    out = re.sub(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", out, flags=re.I)
    out = _convert_placeholders(out)
    out = _translate_functions(out)

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


def _needs_statement_savepoint(sql: str) -> bool:
    normalized = " ".join(str(sql or "").upper().split())
    return normalized.startswith("INSERT INTO TENDERS ") or normalized.startswith(
        "UPDATE PROJECTS SET SOURCE_TENDER_ID="
    )


class PostgresCursor:
    def __init__(self, cursor, owner=None):
        self._cursor = cursor
        self._owner = owner
        self.lastrowid = None

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    def execute(self, sql: str, params: Iterable[Any] | None = None):
        if str(sql or "").lstrip().upper().startswith("PRAGMA "):
            self.lastrowid = None
            return self
        translated, added_returning = _translate_sql(sql)
        use_savepoint = _needs_statement_savepoint(sql)
        try:
            if use_savepoint:
                self._cursor.execute("SAVEPOINT bidmanager_compat_statement", ())
            self._cursor.execute(translated, tuple(params or ()))
            statement_rowcount = self._cursor.rowcount
            self.lastrowid = None
            if added_returning and self._cursor.description:
                row = self._cursor.fetchone()
                if row is not None:
                    self.lastrowid = row[0]
            if use_savepoint:
                self._cursor.execute("RELEASE SAVEPOINT bidmanager_compat_statement", ())
            if self._owner is not None:
                self._owner._record_changes(sql, statement_rowcount)
        except Exception as exc:
            recovered_statement = False
            if use_savepoint:
                try:
                    self._cursor.execute("ROLLBACK TO SAVEPOINT bidmanager_compat_statement", ())
                    self._cursor.execute("RELEASE SAVEPOINT bidmanager_compat_statement", ())
                    recovered_statement = True
                except Exception:
                    recovered_statement = False
            name = exc.__class__.__name__.lower()
            if "uniqueviolation" in name:
                if not recovered_statement:
                    try:
                        self._cursor.connection.rollback()
                    except Exception:
                        pass
                raise _sqlite3.IntegrityError(str(exc)) from exc
            if "duplicatecolumn" in name:
                if not recovered_statement:
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
        if self._owner is not None:
            self._owner._record_changes(sql, self._cursor.rowcount)
        return self

    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        return self._wrap_row(row)

    def fetchall(self):
        return [self._wrap_row(row) for row in self._cursor.fetchall()]

    def __iter__(self):
        while True:
            row = self.fetchone()
            if row is None:
                return
            yield row

    def close(self):
        self._cursor.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()
        return False

    def _wrap_row(self, row):
        if self._cursor.description is None:
            return row
        columns = [col.name for col in self._cursor.description]
        return HybridRow(columns, row)


class PostgresConnection:
    def __init__(self, raw):
        self._raw = raw
        self.row_factory = None
        self.total_changes = 0

    def cursor(self):
        return PostgresCursor(self._raw.cursor(), owner=self)

    def _record_changes(self, sql: str, rowcount: int) -> None:
        operation = str(sql or "").lstrip().split(None, 1)[0].upper()
        if operation in {"INSERT", "UPDATE", "DELETE", "REPLACE"}:
            self.total_changes += max(0, int(rowcount or 0))

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

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        if exc_type is None:
            self.commit()
        else:
            self.rollback()
        self.close()
        return False


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
