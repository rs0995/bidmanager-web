"""Gemini / ChatGPT back-ends (no network: the HTTP helpers are replaced). Run: python -m pytest bid_agent_server/tests"""

from __future__ import annotations

import copy
import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from bid_agent import chat, providers  # noqa: E402
from bid_agent.llm import LLM  # noqa: E402

SCHEMA = {"type": "object", "properties": {"a": {"type": ["string", "null"]}, "b": {"type": "array", "items": {
    "type": "object", "properties": {"x": {"type": "integer"}}, "required": ["x"], "additionalProperties": False}}},
    "required": ["a", "b"], "additionalProperties": False}
PDF = {"type": "document", "title": "NIT (pages 1-2)",
       "source": {"type": "base64", "media_type": "application/pdf", "data": "JVBERi0="}}
TEXT_DOC = {"type": "document", "title": "BOQ.xlsx (pages 1-1)", "source": {"type": "text", "data": "Item 1"}}


class ContentTests(unittest.TestCase):
    def test_gemini_parts(self):
        parts = providers.gemini_parts([PDF, TEXT_DOC, {"type": "text", "text": "hi"}])
        self.assertEqual(parts[1], {"inlineData": {"mimeType": "application/pdf", "data": "JVBERi0="}})
        self.assertIn("Item 1", parts[2]["text"])
        self.assertEqual(parts[-1], {"text": "hi"})
        self.assertEqual(providers.gemini_parts("plain"), [{"text": "plain"}])

    def test_openai_parts(self):
        parts = providers.openai_parts([PDF, {"type": "text", "text": "hi"}])
        self.assertEqual(parts[0]["type"], "file")
        self.assertTrue(parts[0]["file"]["filename"].endswith(".pdf"))
        self.assertTrue(parts[0]["file"]["file_data"].startswith("data:application/pdf;base64,"))

    def test_claude_file_ids_are_refused(self):
        doc = {"type": "document", "source": {"type": "file", "file_id": "file_1"}}
        with self.assertRaises(providers.ProviderError):
            providers.gemini_parts([doc])
        with self.assertRaises(providers.ProviderError):
            providers.openai_parts([doc])

    def test_gemini_schema(self):
        s = providers.gemini_schema(SCHEMA)
        self.assertNotIn("additionalProperties", s)
        self.assertNotIn("additionalProperties", s["properties"]["b"]["items"])
        self.assertEqual(s["properties"]["a"], {"type": "string", "nullable": True})

    def test_json_fence(self):
        self.assertEqual(providers._loads('```json\n{"a": 1}\n```'), {"a": 1})


class GeminiJsonTests(unittest.TestCase):
    def test_falls_back_when_json_schema_is_not_accepted(self):
        bodies = []

        def post(url, headers, body):
            bodies.append(body)
            self.assertEqual(headers["x-goog-api-key"], "AIza-key")
            if "responseJsonSchema" in body["generationConfig"]:
                raise providers.ProviderError("HTTP 400: Invalid JSON payload", 400)
            return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": '{"a": "x", "b": []}'}]}}],
                    "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 3}}

        usage = {}
        with mock.patch.object(providers, "_post", post):
            out = providers.gemini_json("AIza-key", "models/gemini-2.5-pro", "sys", [PDF], SCHEMA, 8000, usage)
        self.assertEqual(out, {"a": "x", "b": []})
        self.assertEqual(len(bodies), 2)
        self.assertIn("responseSchema", bodies[1]["generationConfig"])
        self.assertGreaterEqual(bodies[1]["generationConfig"]["maxOutputTokens"], 16384)
        self.assertEqual(usage, {"input_tokens": 10, "output_tokens": 3})

    def test_blocked_and_cut_off(self):
        with mock.patch.object(providers, "_post", lambda *a: {"promptFeedback": {"blockReason": "SAFETY"}}):
            with self.assertRaises(providers.Declined):
                providers.gemini_json("k", "gemini-2.5-pro", "s", "t", SCHEMA, 100)
        cut = {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "{"}]}}]}
        with mock.patch.object(providers, "_post", lambda *a: cut):
            with self.assertRaises(RuntimeError):
                providers.gemini_json("k", "gemini-2.5-pro", "s", "t", SCHEMA, 100)

    def test_llm_dispatches_to_gemini(self):
        with mock.patch.object(providers, "_post", lambda *a: {"candidates": [
                {"finishReason": "STOP", "content": {"parts": [{"text": '{"a": null, "b": []}'}]}}]}):
            llm = LLM(api_key="AIza-key", provider="gemini")
            self.assertTrue(llm.available)
            self.assertEqual(llm.model, providers.DEFAULT_MODELS["gemini"][0])
            self.assertEqual(llm.json_call("s", "t", SCHEMA), {"a": None, "b": []})
            self.assertEqual(llm.usage["calls"], 1)

    def test_no_key_means_unavailable(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "", "GOOGLE_API_KEY": "", "OPENAI_API_KEY": ""}):
            self.assertFalse(LLM(provider="gemini").available)
            self.assertFalse(LLM(provider="openai").available)
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-env"}):
            self.assertEqual(LLM(provider="openai").api_key, "sk-env")


class OpenAIJsonTests(unittest.TestCase):
    def _answer(self, content="", finish="stop", refusal=None):
        return {"choices": [{"finish_reason": finish, "message": {"content": content, "refusal": refusal}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2}}

    def test_strict_then_relaxed_schema_and_token_cap(self):
        bodies = []

        def post(url, headers, body):
            bodies.append(body)
            self.assertEqual(headers["Authorization"], "Bearer sk-key")
            if body["max_completion_tokens"] > 16384:
                raise providers.ProviderError("HTTP 400: max_tokens is too large", 400)
            if body["response_format"]["json_schema"]["strict"]:
                raise providers.ProviderError("HTTP 400: Invalid schema for response_format", 400)
            return self._answer('{"a": "x", "b": [{"x": 1}]}')

        with mock.patch.object(providers, "_post", post):
            out = providers.openai_json("sk-key", "gpt-4o", "sys", [PDF], SCHEMA, 64000, {})
        self.assertEqual(out["b"], [{"x": 1}])
        self.assertEqual([b["max_completion_tokens"] for b in bodies], [64000, 16384, 16384])
        self.assertFalse(bodies[-1]["response_format"]["json_schema"]["strict"])
        self.assertEqual(bodies[0]["messages"][1]["content"][0]["type"], "file")

    def test_refusal_and_length(self):
        with mock.patch.object(providers, "_post", lambda *a: self._answer(refusal="no")):
            with self.assertRaises(providers.Declined):
                providers.openai_json("k", "gpt-5", "s", "t", SCHEMA, 100)
        with mock.patch.object(providers, "_post", lambda *a: self._answer("{", finish="length")):
            with self.assertRaises(RuntimeError):
                providers.openai_json("k", "gpt-5", "s", "t", SCHEMA, 100)


TOOLS = [{"name": "list_tender_forms", "description": "Lists forms.",
          "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
         {"name": "read_tender_pages", "description": "Reads pages.",
          "input_schema": {"type": "object", "properties": {"file": {"type": "string"}, "start_page": {"type": "integer"}},
                           "required": ["file", "start_page"], "additionalProperties": False}}]


class ChatSessionTests(unittest.TestCase):
    def test_gemini_tool_loop(self):
        steps = [
            [{"candidates": [{"content": {"parts": [{"text": "Let me look. "}]}}]},
             {"candidates": [{"content": {"parts": [{"functionCall": {"name": "read_tender_pages",
                                                                       "args": {"file": "NIT", "start_page": 3}},
                                                      "thoughtSignature": "sig"}]}}]}],
            [{"candidates": [{"content": {"parts": [{"text": "Turnover INR 190 Cr."}]}, "finishReason": "STOP"}]}],
        ]
        sent = []

        def sse(url, headers, body):
            sent.append(copy.deepcopy(body))  # the session keeps appending to its history
            self.assertIn(":streamGenerateContent?alt=sse", url)
            yield from steps[len(sent) - 1]

        s = providers.GeminiChat("k", "gemini-2.5-flash", "sys", TOOLS, [PDF], [{"role": "user", "content": "Turnover?"}])
        decls = s.tools[0]["functionDeclarations"]
        self.assertNotIn("parameters", decls[0])  # no properties -> no parameters
        self.assertNotIn("additionalProperties", decls[1]["parameters"])
        seen = []
        with mock.patch.object(providers, "_sse", sse):
            text, calls = s.step(seen.append)
            self.assertEqual(calls[0]["name"], "read_tender_pages")
            self.assertEqual(calls[0]["input"], {"file": "NIT", "start_page": 3})
            s.add_results([(calls[0], "page text")])
            text, calls = s.step()
        self.assertEqual((text, calls), ("Turnover INR 190 Cr.", []))
        self.assertEqual(seen, ["Let me look. "])
        model_turn = sent[1]["contents"][-2]
        self.assertEqual(model_turn["role"], "model")
        self.assertEqual(model_turn["parts"][1]["thoughtSignature"], "sig")  # echoed back verbatim
        self.assertEqual(sent[1]["contents"][-1]["parts"][0]["functionResponse"]["response"], {"result": "page text"})
        self.assertIn("inlineData", sent[0]["contents"][0]["parts"][1])  # grounding pages inline

    def test_openai_tool_loop_streams_arguments(self):
        steps = [
            [{"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "read_tender_pages", "arguments": '{"file": "NIT",'}}]}}]},
             {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": ' "start_page": 3}'}}]}, "finish_reason": "tool_calls"}]},
             {"choices": [], "usage": {"prompt_tokens": 7, "completion_tokens": 4}}],
            [{"choices": [{"delta": {"content": "Turnover "}}]}, {"choices": [{"delta": {"content": "INR 190 Cr."}, "finish_reason": "stop"}]}],
        ]
        sent = []

        def sse(url, headers, body):
            sent.append(copy.deepcopy(body))
            yield from steps[len(sent) - 1]

        usage = {}
        s = providers.OpenAIChat("k", "gpt-5-mini", "sys", TOOLS, None, [{"role": "user", "content": "Turnover?"}], usage=usage)
        with mock.patch.object(providers, "_sse", sse):
            _text, calls = s.step()
            self.assertEqual(calls, [{"id": "call_1", "name": "read_tender_pages", "input": {"file": "NIT", "start_page": 3}}])
            s.add_results([(calls[0], "page text")])
            seen = []
            text, calls = s.step(seen.append)
        self.assertEqual((text, calls), ("Turnover INR 190 Cr.", []))
        self.assertEqual(seen, ["Turnover ", "Turnover INR 190 Cr."])
        self.assertEqual(sent[1]["messages"][-1], {"role": "tool", "tool_call_id": "call_1", "content": "page text"})
        self.assertEqual(sent[1]["messages"][-2]["tool_calls"][0]["function"]["name"], "read_tender_pages")
        self.assertEqual(usage, {"input_tokens": 7, "output_tokens": 4})


class RunTurnTests(unittest.TestCase):
    """chat.run_turn routes Gemini / ChatGPT through providers.chat_session and runs the tools."""

    def test_run_turn_with_other_provider(self):
        class FakeSession:
            def __init__(self):
                self.results = []
                self.steps = [("", [{"id": "c1", "name": "list_tender_forms", "input": {}}]), ("Two forms.", [])]

            def step(self, on_text):
                text, calls = self.steps.pop(0)
                if text:
                    on_text(text)
                return text, calls

            def add_results(self, results):
                self.results += results

        session = FakeSession()
        made = {}

        def chat_session(provider, key, model, system, tools, grounding, messages, usage=None):
            made.update(provider=provider, model=model, messages=messages, tools=tools)
            return session

        turn = SimpleNamespace(ws=SimpleNamespace(tender={"tender_id": "T-1", "title": "Road", "org_chain": "PWD"}),
                               call=lambda name, args: f"{name} ok", progress=lambda m: None)
        partials = []
        llm = LLM(api_key="sk-x", provider="openai")
        with mock.patch.object(providers, "chat_session", chat_session):
            reply = chat.run_turn(turn, [{"role": "assistant", "text": "hi"}, {"role": "user", "text": "earlier"}],
                                  "Which forms?", llm, model="gpt-5-mini", on_partial=partials.append)
        self.assertEqual(reply, "Two forms.")
        self.assertEqual(made["provider"], "openai")
        self.assertEqual(made["model"], "gpt-5-mini")
        self.assertEqual(made["messages"][0], {"role": "user", "content": "earlier"})  # leading assistant dropped
        self.assertEqual(made["messages"][-1], {"role": "user", "content": "Which forms?"})
        self.assertIs(made["tools"], chat.TOOLS)
        self.assertEqual(session.results[0][1], "list_tender_forms ok")
        self.assertEqual(partials, ["Two forms."])
        self.assertEqual(llm.usage["calls"], 2)

    def test_declined_reply(self):
        class Refuses:
            def step(self, on_text):
                raise providers.Declined("no")

        turn = SimpleNamespace(ws=SimpleNamespace(tender={}), call=lambda *a: "", progress=lambda m: None)
        with mock.patch.object(providers, "chat_session", lambda *a, **k: Refuses()):
            self.assertEqual(chat.run_turn(turn, [], "x", LLM(api_key="k", provider="gemini")),
                             "I can't help with that request.")


class ModelListTests(unittest.TestCase):
    def test_gemini_models_filtered_and_paged(self):
        pages = [
            {"models": [{"name": "models/gemini-2.5-pro", "displayName": "Gemini 2.5 Pro",
                         "supportedGenerationMethods": ["generateContent", "countTokens"]},
                        {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]}],
             "nextPageToken": "p2"},
            {"models": [{"name": "models/gemini-2.5-flash-preview-tts", "supportedGenerationMethods": ["generateContent"]},
                        {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]}]},
        ]
        calls = []

        def get(url, headers, params=None):
            calls.append(params)
            return pages[len(calls) - 1]

        with mock.patch.object(providers, "_get", get):
            out = providers.list_models("gemini", "k")
        self.assertEqual([m["id"] for m in out], ["gemini-2.5-pro", "gemini-2.5-flash"])
        self.assertEqual(out[0]["label"], "Gemini 2.5 Pro")
        self.assertEqual(calls[1]["pageToken"], "p2")

    def test_openai_models_filtered(self):
        data = {"data": [{"id": "gpt-4o", "created": 1}, {"id": "gpt-5", "created": 3}, {"id": "o3", "created": 2},
                         {"id": "text-embedding-3-large", "created": 9}, {"id": "gpt-4o-realtime-preview", "created": 8},
                         {"id": "whisper-1", "created": 7}, {"id": "dall-e-3", "created": 6}]}
        with mock.patch.object(providers, "_get", lambda *a, **k: data):
            self.assertEqual([m["id"] for m in providers.list_models("openai", "k")], ["gpt-5", "o3", "gpt-4o"])


if __name__ == "__main__":
    unittest.main()
