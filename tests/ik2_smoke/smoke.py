#!/usr/bin/env python3
"""Bounded smoke checks for a local OpenAI-compatible Maya Inkling endpoint."""

from __future__ import annotations

import argparse
import base64
import json
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from typing import Any


def png_fixture(path: Path) -> None:
    """Write an unambiguous RGB image with no external imaging dependency."""
    width, height = 96, 96
    raw = b"".join(b"\x00" + bytes((230, 35, 35)) * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    image = (b"\x89PNG\r\n\x1a\n"
             + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
             + chunk(b"IDAT", zlib.compress(raw))
             + chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(image)


class Client:
    def __init__(self, base_url: str, timeout: float, max_bytes: int):
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self.max_bytes = max_bytes

    def request(self, path: str, payload: dict[str, Any] | None = None) -> tuple[int, bytes, float]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=data,
                                     headers={"Content-Type": "application/json"},
                                     method="GET" if payload is None else "POST")
        start = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                body = response.read(self.max_bytes + 1)
                elapsed = time.monotonic() - start
                if len(body) > self.max_bytes:
                    raise RuntimeError(f"response exceeded --max-response-bytes ({self.max_bytes})")
                return response.status, body, elapsed
        except urllib.error.HTTPError as exc:
            body = exc.read(self.max_bytes + 1)
            return exc.code, body[:self.max_bytes], time.monotonic() - start

    def post(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any], float]:
        status, body, elapsed = self.request("/v1/chat/completions", payload)
        try:
            parsed = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            parsed = {"_raw": body.decode("utf-8", "replace")}
        return status, parsed, elapsed


def show_result(name: str, status: int, elapsed: float, detail: str = "") -> None:
    state = "PASS" if 200 <= status < 300 else "FAIL"
    print(f"[{state}] {name}: HTTP {status}, {elapsed:.2f}s" + (f" — {detail}" if detail else ""))


def excerpt(obj: Any, limit: int = 240) -> str:
    value = json.dumps(obj, ensure_ascii=False) if not isinstance(obj, str) else obj
    value = " ".join(value.split())
    return value[:limit] + ("…" if len(value) > limit else "")


def run(args: argparse.Namespace) -> int:
    client = Client(args.url, args.timeout, args.max_response_bytes)
    failures = 0

    try:
        status, body, elapsed = client.request("/v1/models")
        models = json.loads(body)
        show_result("models", status, elapsed, excerpt(models))
        if not 200 <= status < 300:
            print("  error:", excerpt(body.decode("utf-8", "replace")))
            return 1
        entries = models.get("data", [])
        model = args.model or (entries[0].get("id") if entries else None)
        if not model:
            print("  error: no model id returned; pass --model")
            return 1
    except Exception as exc:
        print(f"[FAIL] models: {type(exc).__name__}: {exc}")
        return 1

    common = {"model": model, "max_tokens": args.max_tokens, "reasoning_effort": "low", "stream": False}
    status, result, elapsed = client.post({**common, "messages": [
        {"role": "user", "content": "Reply with exactly: inkling-smoke-ok"}
    ]})
    choices = result.get("choices", []) if isinstance(result, dict) else []
    content = choices[0].get("message", {}).get("content", "") if choices else ""
    show_result("chat", status, elapsed, excerpt(content) or excerpt(result))
    if not 200 <= status < 300 or not choices:
        failures += 1

    # SSE is consumed incrementally, bounded by timeout, event count, byte count and token cap.
    stream_payload = {**common, "stream": True, "messages": [
        {"role": "user", "content": "Count from one to three, briefly."}
    ]}
    req = urllib.request.Request(client.base + "/v1/chat/completions",
                                 data=json.dumps(stream_payload).encode(),
                                 headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
                                 method="POST")
    start = time.monotonic()
    event_count = 0
    stream_bytes = 0
    stream_text = ""
    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError(f"HTTP {response.status}")
            while event_count < args.max_sse_events:
                if time.monotonic() - start >= args.timeout:
                    raise TimeoutError("SSE total time limit reached")
                line = response.readline(args.max_response_bytes + 1)
                if not line:
                    break
                stream_bytes += len(line)
                if stream_bytes > args.max_response_bytes:
                    raise RuntimeError("SSE stream exceeded response byte limit")
                line = line.strip()
                if not line.startswith(b"data:"):
                    continue
                data = line[5:].strip()
                if data == b"[DONE]":
                    break
                event_count += 1
                try:
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if isinstance(delta, str):
                        stream_text += delta
                except (json.JSONDecodeError, IndexError, AttributeError):
                    pass
        elapsed = time.monotonic() - start
        show_result("SSE stream", 200, elapsed, f"{event_count} events; {excerpt(stream_text)}")
        if not event_count:
            failures += 1
    except Exception as exc:
        elapsed = time.monotonic() - start
        show_result("SSE stream", 0, elapsed, f"{type(exc).__name__}: {exc}")
        failures += 1

    # Required tool choice encourages a real tool-call response. Only this named fixture
    # tool is accepted and executed locally; no arbitrary function or shell is run.
    tool = {"type": "function", "function": {
        "name": "get_smoke_fixture",
        "description": "Return the fixed fixture value used by this smoke check.",
        "parameters": {"type": "object", "properties": {"key": {"type": "string"}},
                       "required": ["key"], "additionalProperties": False},
    }}
    first_status, first, first_elapsed = client.post({**common, "messages": [
        {"role": "user", "content": "Use get_smoke_fixture with key 'proof', then tell me its value."}
    ], "tools": [tool], "tool_choice": "required"})
    calls = (first.get("choices", [{}])[0].get("message", {}).get("tool_calls", [])
             if isinstance(first, dict) else [])
    if first_status < 200 or first_status >= 300 or not calls:
        show_result("tool call (turn 1)", first_status, first_elapsed, excerpt(first))
        failures += 1
    else:
        call = calls[0]
        fn = call.get("function", {})
        try:
            arguments = json.loads(fn.get("arguments", "{}"))
            if fn.get("name") != "get_smoke_fixture" or arguments.get("key") != "proof":
                raise ValueError("unexpected tool name or arguments")
            tool_output = {"key": "proof", "value": "fixture-42"}
            show_result("tool call (turn 1)", first_status, first_elapsed, f"{fn['name']}({excerpt(arguments)})")
            second_status, second, second_elapsed = client.post({**common, "messages": [
                {"role": "user", "content": "Use get_smoke_fixture with key 'proof', then tell me its value."},
                first["choices"][0]["message"],
                {"role": "tool", "tool_call_id": call.get("id", ""),
                 "name": "get_smoke_fixture", "content": json.dumps(tool_output)},
            ]})
            final = (second.get("choices", [{}])[0].get("message", {}).get("content", "")
                     if isinstance(second, dict) else "")
            ok = second_status == 200 and "fixture-42" in str(final)
            show_result("tool round trip (turn 2)", second_status, second_elapsed, excerpt(final) or excerpt(second))
            if not ok:
                failures += 1
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            show_result("tool call (turn 1)", first_status, first_elapsed, f"invalid tool response: {exc}")
            failures += 1

    fixture = Path(args.fixture_dir) / "ik2_smoke_fixture.png"
    png_fixture(fixture)
    image_data = base64.b64encode(fixture.read_bytes()).decode("ascii")
    image_payload = {**common, "reasoning_effort": "low", "messages": [{"role": "user", "content": [
        {"type": "text", "text": "What single color is this image? Reply with one color word."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}},
    ]}]}
    image_status, image_result, image_elapsed = client.post(image_payload)
    image_choices = image_result.get("choices", []) if isinstance(image_result, dict) else []
    if 200 <= image_status < 300 and image_choices:
        image_answer = image_choices[0].get("message", {}).get("content", "")
        show_result("image input", image_status, image_elapsed, excerpt(image_answer))
        if "red" not in str(image_answer).lower():
            print("  expected the one-word answer to identify the solid red image")
            failures += 1
    elif image_status in (400, 404, 415, 422, 501):
        print(f"[SKIP] image input: endpoint appears not to expose image input (HTTP {image_status}; {excerpt(image_result)})")
    else:
        show_result("image input", image_status, image_elapsed, excerpt(image_result))
        failures += 1

    print(f"\nSummary: {'FAIL' if failures else 'PASS'} ({failures} failed check(s)); model={model}; endpoint={client.base}")
    print(f"PNG fixture: {fixture.resolve()}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", type=int, help="loopback TCP port (default: 8080)")
    parser.add_argument("--url", help="base URL override, e.g. http://127.0.0.1:8080")
    parser.add_argument("--model", help="model id override (defaults to first /v1/models entry)")
    parser.add_argument("--timeout", type=float, default=30.0, help="per-request/read timeout seconds (default: 30)")
    parser.add_argument("--max-tokens", type=int, default=96, help="completion token cap (default: 96)")
    parser.add_argument("--max-response-bytes", type=int, default=1_000_000, help="per response/SSE line byte cap")
    parser.add_argument("--max-sse-events", type=int, default=256, help="maximum SSE data events to consume")
    parser.add_argument("--fixture-dir", default=str(Path(__file__).parent / "fixtures"), help="directory for generated PNG fixture")
    args = parser.parse_args()
    if args.port is not None and not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    for name in ("timeout", "max_tokens", "max_response_bytes", "max_sse_events"):
        if getattr(args, name) <= 0:
            parser.error(f"--{name.replace('_', '-')} must be positive")
    args.url = args.url or f"http://127.0.0.1:{args.port or 8080}"
    return run(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError) as exc:
        print(f"[FAIL] {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
