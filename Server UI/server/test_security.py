import unittest
from unittest import mock

import security


class SecurityPolicyTests(unittest.TestCase):
    def test_cloud_run_defaults_to_strict_production_policy(self):
        self.assertEqual(security.deployment_environment({"K_SERVICE": "bidmanager"}), "production")
        self.assertTrue(security.is_cloud_environment({"K_SERVICE": "bidmanager"}))
        self.assertEqual(
            security.deployment_environment({"K_SERVICE": "bidmanager", "BIDMANAGER_ENV": "local"}),
            "production",
        )

    def test_explicit_modes_are_normalized(self):
        self.assertEqual(security.deployment_environment({"BIDMANAGER_ENV": "dev"}), "local")
        self.assertEqual(security.deployment_environment({"BIDMANAGER_ENV": "stage"}), "staging")
        self.assertEqual(security.deployment_environment({"BIDMANAGER_ENV": "prod"}), "production")

    def test_loopback_detection_does_not_allow_lan_addresses(self):
        self.assertTrue(security.is_loopback_host("127.0.0.1"))
        self.assertTrue(security.is_loopback_host("::1"))
        self.assertFalse(security.is_loopback_host("192.168.1.10"))

    def test_mutating_v1_routes_include_legacy_get_actions(self):
        self.assertTrue(security.is_v1_mutation("POST", "/v1/projects"))
        self.assertTrue(security.is_v1_mutation("GET", "/v1/data/clear"))
        self.assertTrue(security.is_v1_mutation("GET", "/v1/tenders/42/download"))
        self.assertFalse(security.is_v1_mutation("GET", "/v1/tenders"))

    def test_public_settings_remove_credentials_and_cloud_paths(self):
        source = {
            "captcha_ai_api_key": "secret",
            "database_password": "secret",
            "download_dir": "C:/private/path",
            "headless": "true",
        }
        self.assertEqual(
            security.redact_public_settings(source, cloud=True),
            {"headless": "true"},
        )
        self.assertEqual(
            security.redact_public_settings(source, cloud=False),
            {"download_dir": "C:/private/path", "headless": "true"},
        )

    def test_secure_comparison_rejects_empty_expected_key(self):
        self.assertTrue(security.secure_equals("abc", "abc"))
        self.assertFalse(security.secure_equals("abc", "def"))
        self.assertFalse(security.secure_equals("", ""))

    def test_download_tokens_are_path_bound_signed_and_expiring(self):
        env = {"BIDMANAGER_DOWNLOAD_TOKEN_SECRET": "test-secret"}
        token, expires = security.create_download_token(
            "tenders/42/spec.pdf", 60, now=1000, environ=env
        )
        self.assertEqual(expires, 1060)
        self.assertTrue(
            security.verify_download_token(
                token, "tenders/42/spec.pdf", now=1059, environ=env
            )
        )
        self.assertFalse(
            security.verify_download_token(token, "tenders/43/spec.pdf", now=1059, environ=env)
        )
        self.assertFalse(
            security.verify_download_token(token, "tenders/42/spec.pdf", now=1061, environ=env)
        )
        self.assertFalse(
            security.verify_download_token(token + "x", "tenders/42/spec.pdf", now=1059, environ=env)
        )


    def test_password_encryption_round_trips_and_fails_safe(self):
        env = {"BIDMANAGER_DOWNLOAD_TOKEN_SECRET": "enc-secret"}
        with mock.patch.dict(security.os.environ, env, clear=False):
            token = security.encrypt_password("hunter2 correct")
            self.assertNotEqual(token, "hunter2 correct")
            self.assertEqual(security.decrypt_password(token), "hunter2 correct")
        self.assertIsNone(security.decrypt_password(None))
        self.assertIsNone(security.decrypt_password(""))
        self.assertIsNone(security.decrypt_password("not-a-real-token"))
        # A different server secret cannot read the ciphertext.
        with mock.patch.dict(security.os.environ, {"BIDMANAGER_DOWNLOAD_TOKEN_SECRET": "different"}, clear=False):
            self.assertIsNone(security.decrypt_password(token))


if __name__ == "__main__":
    unittest.main()
