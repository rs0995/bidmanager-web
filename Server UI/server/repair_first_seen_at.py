"""One-time data repair for the first_seen_at backfill bug.

Background: a migration in app_core.py's _init_db_schema() used to backfill
every pre-existing tender's first_seen_at to "now" (the moment the migration
ran) instead of a real historical value. /client/changes's "N new tenders
added" alert filters on first_seen_at > since, so any client whose cursor
predates that migration saw the whole backfilled batch reported as newly
added -- even though every one of those tenders had existed for a long time.
The migration itself is now fixed (falls back to a parsed published_date
instead of "now"), but rows already bad-backfilled on a live database need a
one-time correction; this script does that.

Heuristic: a genuine first_seen_at is set once per tender, one row at a time,
as it's individually discovered during scraping -- real values are scattered
across many distinct timestamps. The migration's bad backfill set EVERY
affected row to the exact same now_epoch value in one UPDATE, so a first_seen_at
value shared by an unusually large number of rows is almost certainly a
backfill artifact, not organic. This script finds those large clusters and
re-derives first_seen_at from published_date for the rows in them, same as
the fixed migration now does for new rows.

This is deliberately NOT wired into automatic server startup -- it mutates
historical timestamps on a live database and should be reviewed and run
manually, once, after confirming the plan with the user.

Usage:
    python repair_first_seen_at.py                 # dry run, prints what it would do
    python repair_first_seen_at.py --apply          # actually writes the changes
    python repair_first_seen_at.py --min-cluster 20 # override the cluster-size threshold
"""

import argparse
import sys

import app_core as core


def find_suspect_clusters(conn, min_cluster: int):
    """Timestamps shared by >= min_cluster rows -- likely backfill artifacts."""
    rows = conn.execute(
        "SELECT first_seen_at, COUNT(*) AS n FROM tenders "
        "WHERE first_seen_at IS NOT NULL "
        "GROUP BY first_seen_at HAVING COUNT(*) >= ? ORDER BY n DESC",
        (min_cluster,),
    ).fetchall()
    return [(row[0], row[1]) for row in rows]


def repair(apply: bool, min_cluster: int):
    conn = core.sqlite3.connect(core.DB_FILE)
    conn.row_factory = core.sqlite3.Row
    try:
        clusters = find_suspect_clusters(conn, min_cluster)
        if not clusters:
            print(f"No first_seen_at value is shared by >= {min_cluster} rows. Nothing to repair.")
            return

        total_rows = 0
        total_reparsed = 0
        total_left_now = 0
        for ts, count in clusters:
            print(f"Suspect cluster: first_seen_at={ts} shared by {count} rows")
            total_rows += count
            tender_rows = conn.execute(
                "SELECT id, published_date FROM tenders WHERE first_seen_at=?",
                (ts,),
            ).fetchall()
            for row_id, published_date in tender_rows:
                parsed = core.ScraperBackend.parse_closing_datetime(published_date)
                if parsed:
                    new_epoch = parsed.timestamp()
                    total_reparsed += 1
                else:
                    # Can't derive a real value -- leave first_seen_at as-is
                    # (still wrong, but not worse) rather than guessing.
                    total_left_now += 1
                    continue
                if apply:
                    conn.execute("UPDATE tenders SET first_seen_at=? WHERE id=?", (new_epoch, row_id))

        print(f"\n{total_rows} rows in suspect clusters: {total_reparsed} re-derived from published_date, "
              f"{total_left_now} left unchanged (no parseable published_date).")

        if apply:
            conn.commit()
            print("Applied.")
        else:
            print("Dry run only -- re-run with --apply to write these changes.")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Actually write the changes (default: dry run).")
    parser.add_argument("--min-cluster", type=int, default=20,
                         help="Minimum rows sharing one first_seen_at to treat as a backfill artifact (default: 20).")
    args = parser.parse_args()
    repair(apply=args.apply, min_cluster=args.min_cluster)
    sys.exit(0)
