import unittest
from unittest import mock

import app_core
from app_core import ScraperBackend


class _FakeDriver:
    _n = 0

    def __init__(self, title="Tenders"):
        _FakeDriver._n += 1
        self.instance = _FakeDriver._n
        self.title = title
        self.quit_calls = 0
        self.get_calls = []

    def get(self, url):
        self.get_calls.append(url)

    def quit(self):
        self.quit_calls += 1


class DownloadSessionTests(unittest.TestCase):
    def setUp(self):
        _FakeDriver._n = 0
        ScraperBackend._download_driver = None
        ScraperBackend._download_driver_website = None
        ScraperBackend._download_driver_last_used = 0.0
        ScraperBackend.captcha_solved_in_session = False
        self._made = []

        def _fake_create(attempts=2, register=True):
            self.assertFalse(register, "download session must not register a job driver")
            d = _FakeDriver()
            self._made.append(d)
            return d

        self._p = [
            mock.patch.object(app_core, "create_browser_driver", side_effect=_fake_create),
            mock.patch.object(app_core.time, "sleep", lambda *_a, **_k: None),
            mock.patch.object(
                ScraperBackend, "_download_session_idle_seconds", staticmethod(lambda: 900)
            ),
        ]
        for p in self._p:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self._p])
        self.addCleanup(ScraperBackend.close_download_session)

    def test_same_website_reuses_the_driver_and_keeps_the_captcha_flag(self):
        d1 = ScraperBackend._acquire_download_driver(1, "https://x/base")
        self.assertEqual(len(self._made), 1)
        self.assertFalse(ScraperBackend.captcha_solved_in_session)

        ScraperBackend.captcha_solved_in_session = True  # solved during the 1st download
        d2 = ScraperBackend._acquire_download_driver(1, "https://x/base")
        self.assertIs(d2, d1)                     # same browser
        self.assertEqual(len(self._made), 1)      # nothing new built
        self.assertEqual(d1.quit_calls, 0)        # not torn down
        self.assertTrue(ScraperBackend.captcha_solved_in_session)  # CAPTCHA still valid

    def test_website_switch_rebuilds_and_forces_a_new_captcha(self):
        d1 = ScraperBackend._acquire_download_driver(1, "https://a/base")
        ScraperBackend.captcha_solved_in_session = True
        d2 = ScraperBackend._acquire_download_driver(2, "https://b/base")
        self.assertIsNot(d2, d1)
        self.assertEqual(d1.quit_calls, 1)
        self.assertFalse(ScraperBackend.captcha_solved_in_session)

    def test_stale_page_on_reuse_rebuilds_and_forces_a_new_captcha(self):
        d1 = ScraperBackend._acquire_download_driver(1, "https://x/base")
        ScraperBackend.captcha_solved_in_session = True
        d1.title = "Stale Session"  # portal dropped the session
        d2 = ScraperBackend._acquire_download_driver(1, "https://x/base")
        self.assertIsNot(d2, d1)
        self.assertEqual(d1.quit_calls, 1)
        self.assertFalse(ScraperBackend.captcha_solved_in_session)

    def test_idle_reaper_closes_the_session(self):
        d1 = ScraperBackend._acquire_download_driver(1, "https://x/base")
        ScraperBackend.captcha_solved_in_session = True
        ScraperBackend._download_driver_last_used -= 10_000  # long idle
        ScraperBackend.close_idle_download_session()
        self.assertIsNone(ScraperBackend._download_driver)
        self.assertEqual(d1.quit_calls, 1)
        self.assertFalse(ScraperBackend.captcha_solved_in_session)

    def test_close_download_session_is_idempotent(self):
        ScraperBackend._acquire_download_driver(1, "https://x/base")
        ScraperBackend.close_download_session()
        ScraperBackend.close_download_session()  # no crash
        self.assertIsNone(ScraperBackend._download_driver)

    def test_new_browser_driver_register_false_skips_job_resources(self):
        app_core._job_runtime.resources = []
        with mock.patch.object(app_core, "configured_browser", return_value="chromium"), \
             mock.patch.object(app_core, "new_chromium_options", return_value=object()), \
             mock.patch.object(app_core, "ChromeService", create=True), \
             mock.patch.object(app_core, "ChromeWebDriver", create=True, return_value=_FakeDriver()), \
             mock.patch.object(app_core.os.path, "exists", return_value=False):
            app_core.new_browser_driver(register=False)
        self.assertEqual(app_core._job_runtime.resources, [])
        del app_core._job_runtime.resources


if __name__ == "__main__":
    unittest.main()
