import unittest
from unittest import mock

import app_core


class CaptchaAiProviderTests(unittest.TestCase):
    def test_openai_uses_default_endpoint(self):
        settings = {
            "captcha_ai_provider": "openai",
            "captcha_ai_api_key": "test-key",
            "captcha_ai_model": "vision-model",
            "captcha_ai_endpoint": "",
        }
        with mock.patch.dict(app_core.os.environ, {}, clear=True), mock.patch.object(
            app_core, "GOOGLE_API_KEY", ""
        ), mock.patch.object(
            app_core.ScraperBackend,
            "get_setting",
            side_effect=lambda key, default="": settings.get(key, default),
        ):
            config = app_core.ScraperBackend.get_captcha_ai_config()

        self.assertEqual(config["provider"], "openai")
        self.assertEqual(config["endpoint"], "https://api.openai.com/v1/chat/completions")

    def test_provider_aliases_are_normalized(self):
        settings = {
            "captcha_ai_provider": "claude",
            "captcha_ai_api_key": "test-key",
            "captcha_ai_model": "vision-model",
            "captcha_ai_endpoint": "",
        }
        with mock.patch.dict(app_core.os.environ, {}, clear=True), mock.patch.object(
            app_core, "GOOGLE_API_KEY", ""
        ), mock.patch.object(
            app_core.ScraperBackend,
            "get_setting",
            side_effect=lambda key, default="": settings.get(key, default),
        ):
            config = app_core.ScraperBackend.get_captcha_ai_config()

        self.assertEqual(config["provider"], "anthropic")
        self.assertEqual(config["endpoint"], "https://api.anthropic.com/v1/messages")

    def test_anthropic_request_extracts_captcha_text(self):
        response = mock.Mock()
        response.json.return_value = {
            "content": [{"type": "text", "text": " A1b2C3\n"}]
        }
        config = {
            "api_key": "test-key",
            "model": "vision-model",
            "endpoint": "https://api.anthropic.com/v1/messages",
        }
        requests_client = mock.Mock()
        requests_client.post.return_value = response
        with mock.patch.object(app_core, "requests", requests_client):
            result = app_core.ScraperBackend._solve_captcha_with_anthropic(b"image", config)

        self.assertEqual(result, "A1b2C3")
        response.raise_for_status.assert_called_once_with()
        request = requests_client.post.call_args.kwargs
        self.assertEqual(request["headers"]["x-api-key"], "test-key")
        self.assertEqual(request["json"]["model"], "vision-model")


if __name__ == "__main__":
    unittest.main()
