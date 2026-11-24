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


class ValidateCaptchaAiConfigTests(unittest.TestCase):
    def _model(self, name):
        m = mock.Mock()
        m.name = name
        m.supported_generation_methods = ["generateContent"]
        return m

    def _genai(self, list_models):
        stub = mock.Mock()
        stub.configure = mock.Mock()
        stub.list_models = list_models
        return stub

    def test_non_gemini_provider_is_a_noop(self):
        app_core.ScraperBackend.validate_captcha_ai_config(
            {"provider": "openai", "api_key": "", "model": ""}
        )

    def test_rejected_api_key_raises(self):
        genai = self._genai(mock.Mock(side_effect=Exception(
            '400 API key not valid. Please pass a valid API key. [reason: "API_KEY_INVALID"]'
        )))
        with mock.patch.object(app_core, "genai", genai), mock.patch.object(
            app_core, "ensure_scraper_dependencies", return_value=True
        ):
            with self.assertRaises(ValueError) as ctx:
                app_core.ScraperBackend.validate_captcha_ai_config(
                    {"provider": "gemini", "api_key": "bad", "model": "gemini-2.5-flash"}
                )
        self.assertIn("rejected", str(ctx.exception).lower())

    def test_unknown_model_raises_with_hint(self):
        genai = self._genai(mock.Mock(return_value=[
            self._model("models/gemini-2.5-flash"), self._model("models/gemini-2.0-flash"),
        ]))
        with mock.patch.object(app_core, "genai", genai), mock.patch.object(
            app_core, "ensure_scraper_dependencies", return_value=True
        ):
            with self.assertRaises(ValueError) as ctx:
                app_core.ScraperBackend.validate_captcha_ai_config(
                    {"provider": "gemini", "api_key": "ok", "model": "gemini-3.7-flash"}
                )
        self.assertIn("gemini-2.5-flash", str(ctx.exception))

    def test_valid_key_and_model_passes(self):
        genai = self._genai(mock.Mock(return_value=[self._model("models/gemini-2.5-flash")]))
        with mock.patch.object(app_core, "genai", genai), mock.patch.object(
            app_core, "ensure_scraper_dependencies", return_value=True
        ):
            app_core.ScraperBackend.validate_captcha_ai_config(
                {"provider": "gemini", "api_key": "ok", "model": "gemini-2.5-flash"}
            )
        genai.configure.assert_called_once()


if __name__ == "__main__":
    unittest.main()
