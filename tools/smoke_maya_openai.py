"""Manual OpenAI API smoke checks for a running local Maya server."""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time

import requests
from PIL import Image, ImageDraw


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:18022")
    parser.add_argument("--model", default="inkling-2-mini")
    parser.add_argument("--long-repetitions", type=int, default=900,
                        help="repeat count for the long-context check (default: 900)")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    health = requests.get(f"{base}/health", timeout=10).json()
    if health.get("status") != "ok" or not health.get("images"):
        raise RuntimeError(f"server is not healthy with image support: {health}")
    print(json.dumps({"check": "health", "context": health["max_context"], "images": health["images"]}))

    tool_body = {
        "model": args.model,
        "messages": [{"role": "user", "content": "Use calculator to add 19 and 23."}],
        "tools": [{"type": "function", "function": {
            "name": "calculator",
            "description": "Adds two numbers",
            "parameters": {
                "type": "object",
                "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
                "required": ["a", "b"],
                "additionalProperties": False,
            },
        }}],
        "tool_choice": {"type": "function", "function": {"name": "calculator"}},
        "max_tokens": 96,
        "reasoning_effort": "none",
        "temperature": 0,
    }
    tool_response = requests.post(f"{base}/v1/chat/completions", json=tool_body, timeout=180)
    tool_response.raise_for_status()
    tool_result = tool_response.json()
    calls = tool_result["choices"][0]["message"].get("tool_calls") or []
    if len(calls) != 1 or calls[0]["function"]["name"] != "calculator":
        raise RuntimeError(f"forced function call failed: {tool_result}")
    call_args = calls[0]["function"]["arguments"]
    if isinstance(call_args, str):
        call_args = json.loads(call_args)
    if call_args != {"a": 19, "b": 23}:
        raise RuntimeError(f"unexpected function arguments: {call_args}")
    print(json.dumps({"check": "function-call", "name": "calculator", "arguments": call_args}))

    code_body = {
        "model": args.model,
        "messages": [{"role": "user", "content":
            "Implement merge_intervals(intervals) in Python. Sort by start, merge touching or overlapping "
            "intervals, return an empty list for empty input, and include two short tests."}],
        "max_tokens": 700,
        "reasoning_effort": "none",
        "temperature": 0,
    }
    start = time.perf_counter()
    code_response = requests.post(f"{base}/v1/chat/completions", json=code_body, timeout=240)
    code_response.raise_for_status()
    code_result = code_response.json()
    code_answer = code_result["choices"][0]["message"].get("content", "")
    if "merge_intervals" not in code_answer or "def " not in code_answer:
        raise RuntimeError(f"coding response did not contain the requested function: {code_answer}")
    print(json.dumps({"check": "coding", "elapsed_seconds": round(time.perf_counter() - start, 2),
                      "usage": code_result.get("usage", {}), "timings": code_result.get("timings", {}),
                      "answer_chars": len(code_answer)}))

    image = Image.new("RGB", (256, 256), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, 215, 215), fill="blue")
    draw.text((65, 112), "BLUE SQUARE", fill="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    data = base64.b64encode(buffer.getvalue()).decode("ascii")
    image_body = {
        "model": args.model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "What color and shape are shown? Answer briefly."},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{data}"}},
        ]}],
        "max_tokens": 96,
        "reasoning_effort": "none",
        "temperature": 0,
    }
    start = time.perf_counter()
    image_response = requests.post(f"{base}/v1/chat/completions", json=image_body, timeout=240)
    image_response.raise_for_status()
    image_result = image_response.json()
    image_answer = image_result["choices"][0]["message"].get("content", "")
    if "blue" not in image_answer.lower() or "square" not in image_answer.lower():
        raise RuntimeError(f"image recognition failed: {image_answer}")
    print(json.dumps({"check": "image", "elapsed_seconds": round(time.perf_counter() - start, 2),
                      "answer": image_answer}))

    long_text = ("Check the edge cases carefully. Preserve input order, preserve all values, and return a "
                 "concise verified result. " * args.long_repetitions) + \
        " Final question: what exact word should the final answer include? Answer with the single word ORANGE."
    long_body = {
        "model": args.model,
        "messages": [{"role": "user", "content": long_text}],
        "max_tokens": 64,
        "reasoning_effort": "none",
        "temperature": 0,
    }
    start = time.perf_counter()
    long_response = requests.post(f"{base}/v1/chat/completions", json=long_body, timeout=300)
    long_response.raise_for_status()
    long_result = long_response.json()
    long_answer = long_result["choices"][0]["message"].get("content", "")
    usage = long_result.get("usage", {})
    timings = long_result.get("timings", {})
    if "ORANGE" not in long_answer:
        raise RuntimeError(f"long prompt answer marker missing: {long_answer}")
    print(json.dumps({"check": "long-prompt", "elapsed_seconds": round(time.perf_counter() - start, 2),
                      "usage": usage, "timings": timings, "answer": long_answer}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
