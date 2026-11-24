"""Gemini and ChatGPT (OpenAI) back-ends for the Bid Agent.

Claude stays on the anthropic SDK in llm.py / chat.py; the other providers are called over
their REST APIs with httpx (already a server dependency), so no extra packages are needed.

Content everywhere in the agent uses Claude-style blocks: {"type": "text", "text": ...} and
{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": ...}}
or a plain-text source. The functions here translate them for each provider.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

PROVIDERS = ("anthropic", "gemini", "openai")
LABELS = {"anthropic": "Claude", "gemini": "Gemini", "openai": "ChatGPT"}
DEFAULT_MODELS = {  # (document model, chat model)
    "anthropic": ("claude-opus-5-5", "claude-sonnet-5-5"),
    "gemini": ("gemini-2.5-pro", "gemini-2.5-flash"),
    "openai": ("gpt-5", "gpt-5-mini"),
}
ENV_KEYS = {
    "anthropic": ("ANTHROPIC_API_KEY",),
    "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "openai": ("OPENAI_API_KEY",),
}

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"
OPENAI_URL = "https://api.openai.com/v1"
TIMEOUT = 600.0
RETRY_STATUS = (429, 500, 502, 503, 504)
GEMINI_MAX_OUTPUT = 65536


class ProviderError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


class Declined(ProviderError):
    """The provider refused the request (safety filter / refusal)."""


def runnable() -> list[str]:
    """Providers this server can call: Claude needs the anthropic SDK, the others httpx."""
    out = []
    try:
        import anthropic  # noqa: F401

        out.append("anthropic")
    except ImportError:
        pass
    try:
        import httpx  # noqa: F401

        out += ["gemini", "openai"]
    except ImportError:
        pass
    return out


# ------------------------------------------------------------------ HTTP
def _httpx():
    import httpx

    return httpx


def _error_text(resp) -> str:
    try:
        data = resp.json()
        if isinstance(data, list) and data:
            data = data[0]
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            return str(err.get("message") or err.get("status") or err)[:400]
        if err:
            return str(err)[:400]
    except Exception:
        pass
    return (getattr(resp, "text", "") or "")[:400]


def _post(url: str, headers: dict, body: dict) -> dict:
    httpx = _httpx()
    for attempt in range(3):
        r = httpx.post(url, headers=headers, json=body, timeout=TIMEOUT)
        if r.status_code in RETRY_STATUS and attempt < 2:
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code >= 400:
            raise ProviderError(f"HTTP {r.status_code}: {_error_text(r)}", r.status_code)
        return r.json()
    raise ProviderError("No answer from the provider.")  # pragma: no cover


def _get(url: str, headers: dict, params: dict | None = None) -> dict:
    httpx = _httpx()
    r = httpx.get(url, headers=headers, params=params or {}, timeout=60.0)
    if r.status_code >= 400:
        raise ProviderError(f"HTTP {r.status_code}: {_error_text(r)}", r.status_code)
    return r.json()


def _sse(url: str, headers: dict, body: dict):
    """Yields the JSON payload of each server-sent event (retries before the first byte)."""
    httpx = _httpx()
    for attempt in range(3):
        with httpx.stream("POST", url, headers=headers, json=body, timeout=TIMEOUT) as r:
            if r.status_code >= 400:
                r.read()
                if r.status_code in RETRY_STATUS and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise ProviderError(f"HTTP {r.status_code}: {_error_text(r)}", r.status_code)
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                yield json.loads(data)
            return


def _loads(text: str) -> Any:
    """Parses a JSON answer, tolerating a ```json fence around it."""
    t = (text or "").strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.S)
    return json.loads(m.group(1) if m else t)


# ------------------------------------------------------------------ content
def _title(block: dict) -> str:
    return str(block.get("title") or "Document")


def _blocks(content) -> list:
    return [{"type": "text", "text": content}] if isinstance(content, str) else list(content or [])


def gemini_parts(content) -> list[dict]:
    parts: list[dict] = []
    for b in _blocks(content):
        if isinstance(b, str):
            parts.append({"text": b})
            continue
        kind = b.get("type")
        if kind == "text":
            parts.append({"text": b.get("text", "")})
        elif kind == "document":
            src = b.get("source") or {}
            if src.get("type") == "base64":
                if b.get("title"):
                    parts.append({"text": f"[{_title(b)}]"})
                parts.append({"inlineData": {"mimeType": src.get("media_type") or "application/pdf", "data": src["data"]}})
            elif src.get("type") == "text":
                parts.append({"text": f"===== {_title(b)} =====\n{src.get('data', '')}"})
            else:
                raise ProviderError("This document was uploaded for Claude and can't be sent to Gemini.")
    return parts


def openai_parts(content) -> list[dict]:
    parts: list[dict] = []
    for i, b in enumerate(_blocks(content)):
        if isinstance(b, str):
            parts.append({"type": "text", "text": b})
            continue
        kind = b.get("type")
        if kind == "text":
            parts.append({"type": "text", "text": b.get("text", "")})
        elif kind == "document":
            src = b.get("source") or {}
            if src.get("type") == "base64":
                name = re.sub(r"[^\w.\- ]+", "_", _title(b))[:80] or f"document-{i + 1}"
                if not name.lower().endswith(".pdf"):
                    name += ".pdf"
                parts.append({"type": "file", "file": {
                    "filename": name, "file_data": f"data:{src.get('media_type') or 'application/pdf'};base64,{src['data']}"}})
            elif src.get("type") == "text":
                parts.append({"type": "text", "text": f"===== {_title(b)} =====\n{src.get('data', '')}"})
            else:
                raise ProviderError("This document was uploaded for Claude and can't be sent to ChatGPT.")
    return parts


_GEMINI_SCHEMA_KEYS = {"type", "properties", "required", "items", "enum", "description", "nullable", "format",
                       "minimum", "maximum", "minItems", "maxItems", "anyOf"}


def gemini_schema(schema: Any) -> Any:
    """JSON Schema -> the OpenAPI subset of Gemini's ``responseSchema`` / function ``parameters``."""
    if isinstance(schema, list):
        return [gemini_schema(s) for s in schema]
    if not isinstance(schema, dict):
        return schema
    out: dict = {}
    for k, v in schema.items():
        if k not in _GEMINI_SCHEMA_KEYS:
            continue
        if k == "properties":
            out[k] = {name: gemini_schema(p) for name, p in v.items()}
        elif k in ("items",):
            out[k] = gemini_schema(v)
        elif k == "anyOf":
            out[k] = [gemini_schema(s) for s in v]
        elif k == "type" and isinstance(v, list):
            types = [t for t in v if t != "null"]
            out[k] = types[0] if types else "string"
            if "null" in v:
                out["nullable"] = True
        else:
            out[k] = v
    return out


# ------------------------------------------------------------------ Gemini
def _model_id(model: str) -> str:
    return model[7:] if model.startswith("models/") else model


def _gemini_headers(key: str) -> dict:
    return {"x-goog-api-key": key, "Content-Type": "application/json"}


def _gemini_usage(data: dict, usage: dict | None) -> None:
    if usage is None:
        return
    meta = data.get("usageMetadata") or {}
    usage["input_tokens"] = usage.get("input_tokens", 0) + int(meta.get("promptTokenCount") or 0)
    usage["output_tokens"] = usage.get("output_tokens", 0) + int(meta.get("candidatesTokenCount") or 0)


_GEMINI_BLOCKED = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"}


def _gemini_check(data: dict) -> str:
    """Finish reason of the first candidate; raises when Gemini blocked the request."""
    fb = data.get("promptFeedback") or {}
    if fb.get("blockReason"):
        raise Declined(f"Gemini declined this request ({fb['blockReason']}).")
    cands = data.get("candidates") or []
    reason = (cands[0].get("finishReason") if cands else "") or ""
    if reason in _GEMINI_BLOCKED:
        raise Declined(f"Gemini declined this request ({reason}).")
    return reason


def gemini_json(key: str, model: str, system: str, content, schema: dict, max_tokens: int,
                usage: dict | None = None) -> Any:
    url = f"{GEMINI_URL}/models/{_model_id(model)}:generateContent"
    contents = [{"role": "user", "parts": gemini_parts(content)}]
    # Thinking counts toward the output limit on Gemini 2.5+, so leave room for it.
    limit = min(max(max_tokens, 16384), GEMINI_MAX_OUTPUT)
    attempts = [
        ({"responseMimeType": "application/json", "responseJsonSchema": schema}, system),
        ({"responseMimeType": "application/json", "responseSchema": gemini_schema(schema)}, system),
        ({"responseMimeType": "application/json"},
         system + "\n\nAnswer with JSON only, matching this JSON Schema:\n" + json.dumps(schema)),
    ]
    first_error: ProviderError | None = None
    for i, (cfg, sys_text) in enumerate(attempts):
        body = {"systemInstruction": {"parts": [{"text": sys_text}]}, "contents": contents,
                "generationConfig": dict(cfg, maxOutputTokens=limit)}
        try:
            data = _post(url, _gemini_headers(key), body)
        except ProviderError as e:
            if e.status == 400 and i < len(attempts) - 1:  # schema form not accepted by this model
                first_error = first_error or e
                continue
            raise first_error or e
        _gemini_usage(data, usage)
        reason = _gemini_check(data)
        if reason == "MAX_TOKENS":
            raise RuntimeError("Gemini's answer was cut off (max tokens); the section is too large.")
        cands = data.get("candidates") or []
        if not cands:
            raise ProviderError("Gemini returned no answer.")
        text = "".join(p.get("text", "") for p in (cands[0].get("content") or {}).get("parts") or []
                       if not p.get("thought"))
        return _loads(text)
    raise first_error or ProviderError("Gemini returned no answer.")  # pragma: no cover


def _gemini_tool(tool: dict) -> dict:
    decl = {"name": tool["name"], "description": tool.get("description", "")}
    params = gemini_schema(tool.get("input_schema") or {})
    if params.get("properties"):  # Gemini rejects objects with no properties
        decl["parameters"] = params
    return decl


class GeminiChat:
    """A streamed function-calling conversation with Gemini."""

    def __init__(self, key: str, model: str, system: str, tools: list[dict], grounding: list | None,
                 messages: list[dict], max_tokens: int = 8192, usage: dict | None = None):
        self.url = f"{GEMINI_URL}/models/{_model_id(model)}:streamGenerateContent?alt=sse"
        self.headers = _gemini_headers(key)
        self.system = system
        self.tools = [{"functionDeclarations": [_gemini_tool(t) for t in tools]}] if tools else []
        self.max_tokens = max_tokens
        self.usage = usage
        self.contents: list[dict] = []
        if grounding:
            self.contents.append({"role": "user", "parts": gemini_parts(grounding) + [
                {"text": "These are the tender's key pages. Answer from them."}]})
            self.contents.append({"role": "model", "parts": [{"text": "Understood."}]})
        for m in messages:
            self.contents.append({"role": "model" if m["role"] == "assistant" else "user",
                                  "parts": [{"text": m["content"]}]})

    def step(self, on_text: Callable[[str], None] | None = None) -> tuple[str, list[dict]]:
        body = {"systemInstruction": {"parts": [{"text": self.system}]}, "contents": self.contents,
                "generationConfig": {"maxOutputTokens": self.max_tokens}}
        if self.tools:
            body["tools"] = self.tools
        text, parts, calls = "", [], []
        for ev in _sse(self.url, self.headers, body):
            _gemini_usage(ev, self.usage)
            _gemini_check(ev)
            for cand in (ev.get("candidates") or [])[:1]:
                for p in (cand.get("content") or {}).get("parts") or []:
                    if p.get("thought"):
                        continue
                    if "functionCall" in p:
                        parts.append(p)  # echoed back verbatim (keeps any thought signature)
                        fc = p["functionCall"]
                        calls.append({"id": fc.get("id") or f"{fc.get('name')}-{len(calls)}",
                                      "gemini_id": fc.get("id"), "name": fc.get("name", ""),
                                      "input": fc.get("args") or {}})
                    elif "text" in p:
                        text += p["text"]
                        if parts and "text" in parts[-1] and "functionCall" not in parts[-1]:
                            parts[-1] = {**parts[-1], "text": parts[-1]["text"] + p["text"]}
                        else:
                            parts.append(dict(p))
                        if on_text:
                            on_text(text)
        self.contents.append({"role": "model", "parts": parts or [{"text": text or "…"}]})
        return text, calls

    def add_results(self, results: list[tuple[dict, str]]) -> None:
        parts = []
        for call, output in results:
            resp: dict = {"name": call["name"], "response": {"result": output}}
            if call.get("gemini_id"):
                resp["id"] = call["gemini_id"]
            parts.append({"functionResponse": resp})
        self.contents.append({"role": "user", "parts": parts})


# ------------------------------------------------------------------ OpenAI
def _openai_headers(key: str) -> dict:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _openai_usage(data: dict, usage: dict | None) -> None:
    if usage is None or not isinstance(data.get("usage"), dict):
        return
    usage["input_tokens"] = usage.get("input_tokens", 0) + int(data["usage"].get("prompt_tokens") or 0)
    usage["output_tokens"] = usage.get("output_tokens", 0) + int(data["usage"].get("completion_tokens") or 0)


def _token_error(e: ProviderError) -> bool:
    return e.status == 400 and bool(re.search(r"max_(completion_)?tokens|too large|maximum", str(e), re.I))


def openai_json(key: str, model: str, system: str, content, schema: dict, max_tokens: int,
                usage: dict | None = None) -> Any:
    url = OPENAI_URL + "/chat/completions"
    messages = [{"role": "system", "content": system}, {"role": "user", "content": openai_parts(content)}]
    strict, tokens = True, max_tokens
    for _attempt in range(4):
        body = {"model": model, "messages": messages, "max_completion_tokens": tokens,
                "response_format": {"type": "json_schema",
                                    "json_schema": {"name": "result", "schema": schema, "strict": strict}}}
        try:
            data = _post(url, _openai_headers(key), body)
        except ProviderError as e:
            if _token_error(e) and tokens > 16384:
                tokens = 16384  # older models cap the output lower
                continue
            if e.status == 400 and strict and re.search(r"schema|strict", str(e), re.I):
                strict = False  # schema not accepted in strict mode: still guided by it
                continue
            raise
        _openai_usage(data, usage)
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        if msg.get("refusal"):
            raise Declined(f"ChatGPT declined: {msg['refusal']}")
        if choice.get("finish_reason") == "length":
            raise RuntimeError("ChatGPT's answer was cut off (max tokens); the section is too large.")
        if choice.get("finish_reason") == "content_filter":
            raise Declined("ChatGPT declined this request (content filter).")
        return _loads(msg.get("content") or "")
    raise ProviderError("ChatGPT did not accept the request.")


class OpenAIChat:
    """A streamed function-calling conversation with ChatGPT (Chat Completions)."""

    def __init__(self, key: str, model: str, system: str, tools: list[dict], grounding: list | None,
                 messages: list[dict], max_tokens: int = 8000, usage: dict | None = None):
        self.url = OPENAI_URL + "/chat/completions"
        self.headers = _openai_headers(key)
        self.model = model
        self.max_tokens = max_tokens
        self.usage = usage
        self.tools = [{"type": "function", "function": {
            "name": t["name"], "description": t.get("description", ""),
            "parameters": t.get("input_schema") or {"type": "object", "properties": {}}}} for t in tools]
        self.messages: list[dict] = [{"role": "system", "content": system}]
        if grounding:
            self.messages.append({"role": "user", "content": openai_parts(grounding) + [
                {"type": "text", "text": "These are the tender's key pages. Answer from them."}]})
            self.messages.append({"role": "assistant", "content": "Understood."})
        self.messages += [{"role": m["role"], "content": m["content"]} for m in messages]

    def step(self, on_text: Callable[[str], None] | None = None) -> tuple[str, list[dict]]:
        text, finish = "", ""
        acc: dict[int, dict] = {}
        tokens = self.max_tokens
        for _attempt in range(2):
            body = {"model": self.model, "messages": self.messages, "stream": True,
                    "max_completion_tokens": tokens, "stream_options": {"include_usage": True}}
            if self.tools:
                body["tools"] = self.tools
            try:
                for ev in _sse(self.url, self.headers, body):
                    _openai_usage(ev, self.usage)
                    for choice in (ev.get("choices") or [])[:1]:
                        delta = choice.get("delta") or {}
                        if delta.get("refusal"):
                            raise Declined(f"ChatGPT declined: {delta['refusal']}")
                        if delta.get("content"):
                            text += delta["content"]
                            if on_text:
                                on_text(text)
                        for tc in delta.get("tool_calls") or []:
                            slot = acc.setdefault(int(tc.get("index", 0)), {"id": "", "name": "", "arguments": ""})
                            slot["id"] = tc.get("id") or slot["id"]
                            fn = tc.get("function") or {}
                            slot["name"] += fn.get("name") or ""
                            slot["arguments"] += fn.get("arguments") or ""
                        finish = choice.get("finish_reason") or finish
                break
            except ProviderError as e:
                if _token_error(e) and tokens > 4000 and not text and not acc:
                    tokens = 4000
                    continue
                raise
        if finish == "content_filter":
            raise Declined("ChatGPT declined this request (content filter).")
        calls = []
        for i in sorted(acc):
            slot = acc[i]
            try:
                args = json.loads(slot["arguments"] or "{}")
            except ValueError:
                args = {}
            calls.append({"id": slot["id"] or f"call_{i}", "name": slot["name"], "input": args if isinstance(args, dict) else {}})
        msg: dict = {"role": "assistant", "content": text or None}
        if calls:
            msg["tool_calls"] = [{"id": c["id"], "type": "function",
                                  "function": {"name": c["name"], "arguments": json.dumps(c["input"])}} for c in calls]
        self.messages.append(msg)
        return text, calls

    def add_results(self, results: list[tuple[dict, str]]) -> None:
        for call, output in results:
            self.messages.append({"role": "tool", "tool_call_id": call["id"], "content": output})


# ------------------------------------------------------------------ dispatch
def json_call(provider: str, key: str, model: str, system: str, content, schema: dict, max_tokens: int,
              usage: dict | None = None) -> Any:
    if provider == "gemini":
        return gemini_json(key, model, system, content, schema, max_tokens, usage)
    if provider == "openai":
        return openai_json(key, model, system, content, schema, max_tokens, usage)
    raise ProviderError(f"Unknown AI provider: {provider}")


def chat_session(provider: str, key: str, model: str, system: str, tools: list[dict], grounding: list | None,
                 messages: list[dict], usage: dict | None = None):
    if provider == "gemini":
        return GeminiChat(key, model, system, tools, grounding, messages, usage=usage)
    if provider == "openai":
        return OpenAIChat(key, model, system, tools, grounding, messages, usage=usage)
    raise ProviderError(f"Unknown AI provider: {provider}")


_GEMINI_SKIP = re.compile(r"embedding|aqa|imagen|veo|tts|image|audio|live|robotics", re.I)
_OPENAI_CHAT = re.compile(r"^(gpt-|chatgpt-|o\d)", re.I)
_OPENAI_SKIP = re.compile(r"audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|"
                          r"dall-e|whisper|codex|computer-use|deep-research|babbage|davinci", re.I)


def list_models(provider: str, key: str) -> list[dict]:
    """The provider's models usable for the Bid Agent, newest first where the provider says."""
    if provider == "anthropic":
        import anthropic

        client = anthropic.Anthropic(api_key=key, max_retries=1)
        return [{"id": m.id, "label": getattr(m, "display_name", "") or m.id} for m in client.models.list(limit=100)]
    if provider == "gemini":
        out, token = [], ""
        for _page in range(10):
            params = {"pageSize": 1000}
            if token:
                params["pageToken"] = token
            data = _get(f"{GEMINI_URL}/models", {"x-goog-api-key": key}, params)
            for m in data.get("models") or []:
                mid = _model_id(str(m.get("name") or ""))
                if mid and "generateContent" in (m.get("supportedGenerationMethods") or []) and not _GEMINI_SKIP.search(mid):
                    out.append({"id": mid, "label": m.get("displayName") or mid})
            token = data.get("nextPageToken") or ""
            if not token:
                break
        return out
    if provider == "openai":
        data = _get(f"{OPENAI_URL}/models", {"Authorization": f"Bearer {key}"})
        items = [m for m in data.get("data") or [] if _OPENAI_CHAT.search(str(m.get("id") or ""))
                 and not _OPENAI_SKIP.search(str(m.get("id") or ""))]
        items.sort(key=lambda m: -int(m.get("created") or 0))
        return [{"id": m["id"], "label": m["id"]} for m in items]
    raise ProviderError(f"Unknown AI provider: {provider}")
