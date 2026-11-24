import os
import unittest
from unittest import mock

import apns_push


class ApnsPushTests(unittest.TestCase):
    def setUp(self):
        self._env_backup = {
            k: os.environ.get(k)
            for k in ("APNS_KEY_PATH", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_TOPIC", "APNS_ENVIRONMENT")
        }
        apns_push._warned_unconfigured = False
        apns_push._cached_token = None
        apns_push._cached_token_at = 0.0

    def tearDown(self):
        for k, v in self._env_backup.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _clear_env(self):
        for k in ("APNS_KEY_PATH", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_TOPIC", "APNS_ENVIRONMENT"):
            os.environ.pop(k, None)

    def test_send_is_a_noop_when_unconfigured(self):
        self._clear_env()
        result = apns_push.send("deadbeef", title="Hi", body="There")
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "apns_not_configured")

    def test_send_success_posts_expected_payload_and_headers(self):
        self._clear_env()
        os.environ["APNS_KEY_PATH"] = __file__  # any readable file; jwt.encode is mocked below
        os.environ["APNS_KEY_ID"] = "KEYID12345"
        os.environ["APNS_TEAM_ID"] = "TEAMID1234"
        os.environ["APNS_TOPIC"] = "com.raku.s0995.bidmanager-mobile"

        captured = {}

        class FakeResponse:
            status_code = 200

            def json(self):
                return {}

        class FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, headers=None, content=None):
                captured["url"] = url
                captured["headers"] = headers
                captured["content"] = content
                return FakeResponse()

        with mock.patch.object(apns_push.jwt, "encode", return_value="fake.jwt.token"), \
                mock.patch.object(apns_push.httpx, "Client", return_value=FakeClient()):
            result = apns_push.send(
                "abc123device", title="New tender", body="Something new", badge=3, thread_id="org",
                extra={"orgName": "Road Authority"},
            )

        self.assertTrue(result.ok)
        self.assertEqual(captured["url"], "https://api.push.apple.com/3/device/abc123device")
        self.assertEqual(captured["headers"]["apns-topic"], "com.raku.s0995.bidmanager-mobile")
        self.assertEqual(captured["headers"]["authorization"], "bearer fake.jwt.token")
        import json as json_mod
        body = json_mod.loads(captured["content"])
        self.assertEqual(body["aps"]["alert"], {"title": "New tender", "body": "Something new"})
        self.assertEqual(body["aps"]["badge"], 3)
        self.assertEqual(body["aps"]["thread-id"], "org")
        self.assertEqual(body["orgName"], "Road Authority")

    def test_send_sandbox_environment_uses_sandbox_host(self):
        self._clear_env()
        os.environ["APNS_KEY_PATH"] = __file__
        os.environ["APNS_KEY_ID"] = "KEYID12345"
        os.environ["APNS_TEAM_ID"] = "TEAMID1234"
        os.environ["APNS_TOPIC"] = "com.raku.s0995.bidmanager-mobile"
        os.environ["APNS_ENVIRONMENT"] = "sandbox"

        captured = {}

        class FakeResponse:
            status_code = 200

            def json(self):
                return {}

        class FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, headers=None, content=None):
                captured["url"] = url
                return FakeResponse()

        with mock.patch.object(apns_push.jwt, "encode", return_value="fake.jwt.token"), \
                mock.patch.object(apns_push.httpx, "Client", return_value=FakeClient()):
            apns_push.send("abc123device", title="T", body="B")
        self.assertTrue(captured["url"].startswith("https://api.sandbox.push.apple.com/"))

    def test_send_marks_dead_token_for_deletion_on_bad_device_token(self):
        self._clear_env()
        os.environ["APNS_KEY_PATH"] = __file__
        os.environ["APNS_KEY_ID"] = "KEYID12345"
        os.environ["APNS_TEAM_ID"] = "TEAMID1234"
        os.environ["APNS_TOPIC"] = "com.raku.s0995.bidmanager-mobile"

        class FakeResponse:
            status_code = 400

            def json(self):
                return {"reason": "BadDeviceToken"}

        class FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, *a, **k):
                return FakeResponse()

        with mock.patch.object(apns_push.jwt, "encode", return_value="fake.jwt.token"), \
                mock.patch.object(apns_push.httpx, "Client", return_value=FakeClient()):
            result = apns_push.send("stale-token", title="T", body="B")
        self.assertFalse(result.ok)
        self.assertTrue(result.should_delete_token)
        self.assertEqual(result.error, "BadDeviceToken")

    def test_send_transient_network_error_does_not_mark_token_dead(self):
        self._clear_env()
        os.environ["APNS_KEY_PATH"] = __file__
        os.environ["APNS_KEY_ID"] = "KEYID12345"
        os.environ["APNS_TEAM_ID"] = "TEAMID1234"
        os.environ["APNS_TOPIC"] = "com.raku.s0995.bidmanager-mobile"

        class FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, *a, **k):
                raise ConnectionError("boom")

        with mock.patch.object(apns_push.jwt, "encode", return_value="fake.jwt.token"), \
                mock.patch.object(apns_push.httpx, "Client", return_value=FakeClient()):
            result = apns_push.send("some-token", title="T", body="B")
        self.assertFalse(result.ok)
        self.assertFalse(result.should_delete_token)


if __name__ == "__main__":
    unittest.main()
