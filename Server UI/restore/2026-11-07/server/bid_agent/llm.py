"""Thin wrapper around the Claude API for structured (JSON) extraction.

Configuration (first match wins):
  * API key: ``app_settings.anthropic_api_key`` -> env ``ANTHROPIC_API_KEY``
    (the SDK also honours ``ANTHROPIC_AUTH_TOKEN`` / ``ant auth login`` profiles)
  * Model:   ``app_settings.bid_agent_model`` -> env ``BID_AGENT_MODEL`` -> claude-opus-5-5
"""

from __future__ import annotations

import base64
import io
import json
import os
from typing import Any, Callable

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMUnavailable(RuntimeError):
    """Raised when no Claude credentials are configured."""


class LLM:
    def __init__(self, api_key: str = "", model: str = "", log: Callable[[str], None] | None = None):
        self.api_key = (api_key or os.getenv("ANTHROPIC_API_KEY", "")).strip()
        self.model = (model or os.getenv("BID_AGENT_MODEL", "") or DEFAULT_MODEL).strip()
        self.log = log or (lambda _m: None)
        self._client = None
        self.usage = {"input_tokens": 0, "output_tokens": 0, "calls": 0}

    @property
    def available(self) -> bool:
        return bool(self.api_key or os.getenv("ANTHROPIC_AUTH_TOKEN", "").strip())

    def _get_client(self):
        if self._client is None:
            try:
                import anthropic
            except ImportError as e:
                raise LLMUnavailable("The 'anthropic' package is not installed (pip install anthropic).") from e
            if not self.available:
                raise LLMUnavailable("No Claude API key configured. Add it in Settings -> Bid Agent.")
            self._client = anthropic.Anthropic(api_key=self.api_key or None, max_retries=3)
        return self._client

    def json_call(
        self,
        system: str,
        content: list[dict] | str,
        schema: dict,
        *,
        effort: str = "medium",
        max_tokens: int = 32000,
    ) -> Any:
        """Run one request whose answer must match ``schema``; returns parsed JSON."""
        client = self._get_client()
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        with client.beta.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        ) as stream:
            msg = stream.get_final_message()
        self.usage["calls"] += 1
        try:
            self.usage["input_tokens"] += int(msg.usage.input_tokens or 0)
            self.usage["output_tokens"] += int(msg.usage.output_tokens or 0)
        except Exception:
            pass
        if msg.stop_reason == "refusal":
            raise RuntimeError("Claude declined to process this document section.")
        if msg.stop_reason == "max_tokens":
            raise RuntimeError("Claude's answer was cut off (max_tokens); the section is too large.")
        text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text")
        return json.loads(text)


def pdf_pages_block(path: str, first: int, last: int) -> dict:
    """A base64 ``document`` content block containing pages [first, last] of a PDF.

    Used for scanned PDFs (no text layer) and for form layouts where the visual
    structure matters.
    """
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(path)
    writer = PdfWriter()
    for i in range(max(0, first - 1), min(last, len(reader.pages))):
        writer.add_page(reader.pages[i])
    buf = io.BytesIO()
    writer.write(buf)
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}}


def strict_schema(props: dict, required: list[str] | None = None) -> dict:
    """Helper to build an object schema with additionalProperties=false."""
    return {
        "type": "object",
        "properties": props,
        "required": required if required is not None else list(props.keys()),
        "additionalProperties": False,
    }
