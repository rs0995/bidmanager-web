import time
import unittest

import api_server


class LiveLogTimestampTests(unittest.TestCase):
    def setUp(self):
        with api_server._live_log_lock:
            api_server._live_log_buffer.clear()

    def test_entries_carry_emit_timestamp_and_lines_stay_back_compat(self):
        before = time.time()
        api_server._append_live_log("scrape started")
        api_server._append_live_log("scrape done")
        after = time.time()

        payload = api_server.get_live_logs(limit=100, since_seq=0)

        # Back-compat: plain string list still present.
        self.assertEqual(payload["lines"], ["scrape started", "scrape done"])

        entries = payload["entries"]
        self.assertEqual([e["text"] for e in entries], ["scrape started", "scrape done"])
        self.assertEqual([e["seq"] for e in entries], sorted(e["seq"] for e in entries))
        for e in entries:
            self.assertGreaterEqual(e["ts"], before)
            self.assertLessEqual(e["ts"], after)

    def test_explicit_ts_is_preserved(self):
        old = time.time() - 36000  # 10h ago
        api_server._append_live_log("replayed job line", ts=old)

        entries = api_server.get_live_logs(limit=100, since_seq=0)["entries"]
        self.assertEqual(len(entries), 1)
        self.assertAlmostEqual(entries[0]["ts"], old, delta=1)

    def test_since_seq_filters_by_sequence_not_time(self):
        api_server._append_live_log("one")
        first = api_server.get_live_logs(limit=100, since_seq=0)
        cursor = first["next_seq"]
        api_server._append_live_log("two")

        payload = api_server.get_live_logs(limit=100, since_seq=cursor)
        self.assertEqual([e["text"] for e in payload["entries"]], ["two"])


if __name__ == "__main__":
    unittest.main()
