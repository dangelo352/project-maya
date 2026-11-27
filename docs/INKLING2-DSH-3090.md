# Inkling 2 Mini in DeepSeek Harness on an RTX 3090

This documents the local Windows serving setup tested on the 24 GB RTX 3090. Maya serves an OpenAI-compatible API on loopback; DeepSeek Harness uses it as a normal model provider, including streaming, image input, function tools, and automatic compaction.

## Tested configuration

- GGUF: Unsloth `Inkling-2-Mini-UD-Q4_K_XL.gguf` with Maya's pinned Q8_0 DSpark drafter GGUF.
- Engine: this repository's `maya-ik2.exe`, CUDA 12.8, sm_86; adaptive MTP width up to 8; FP8 target and drafter KV.
- Drafter lookback: 65,536 tokens. A 100K prompt A/B favored this over 32K and full 200K drafter lookback.
- Server: `serve/server.py`, bound to `127.0.0.1:18022`.
- Context: 200,704 tokens. Input, image tokens, and generated output share this limit.
- Images: `maya-vision` with the model's BF16 mmproj; the encoder runs on CPU so it does not take VRAM from the model.
- DSH output cap: 32,768 tokens; compaction starts at 65%, retains the newest 8,192 tokens, and summarizes through the same Maya server with a 4,096-token cap.

The 200K setting is the high-context point tested with all experts and the drafter resident. A 262,144-token run did not have enough VRAM for that full path; 233,472 left too little headroom and had very slow prefill. The tested 200,704 setting is the practical DSH profile.

## Local setup

Build `maya-ik2` using the Windows CUDA instructions in [INKLING2.md](INKLING2.md). Download these files into `models/` from the official repositories:

- `Inkling-2-Mini-UD-Q4_K_XL.gguf` and `mmproj-BF16.gguf` from [Unsloth](https://huggingface.co/unsloth/Inkling-2-Mini-GGUF)
- `dspark-Inkling-2-Mini-Q8_0.gguf` from [Maya's pinned drafter release](https://huggingface.co/peasantsmith/Inkling-2-Mini-Maya-GGUF/tree/37027719327de5f574684b525ad88fe50c4ff222/drafter). The project setup script fetches this Q8_0 format by default; it is the fastest supported drafter path in the engine.

Write and validate the tokenizer:

```powershell
python tools/strata_tokenizer.py --gguf models/Inkling-2-Mini-UD-Q4_K_XL.gguf --out ik2 `
  --chat-template tools/ik2/chat_template.jinja --check
```

Build the optional image encoder as described in [INKLING2.md](INKLING2.md). The pinned llama.cpp vocab compatibility patch is in [`patches/llama.cpp-inkling2-vocab-only.patch`](../patches/llama.cpp-inkling2-vocab-only.patch). It maps only the image encoder's vocab-only model load; Maya's CUDA inference engine remains the model runner.

Start the server from the repository root:

```powershell
python serve/server.py --engine maya --config docs/inkling2-mini/ik2-mini-3090-200k-mtp.json `
  --host 127.0.0.1 --port 18022
```

The server config uses relative paths, so keep the repository root as the working directory. `127.0.0.1` keeps the inference endpoint local; DSH talks to it on the same PC.

## DeepSeek Harness profile

Add these providers under the existing `llm-pi-ai` plugin's `config.providers`. Keep other providers in place:

```yaml
maya-local:
  displayName: Maya Inkling 2 Mini (3090, MTP, 200K)
  api: openai-completions
  baseURL: http://127.0.0.1:18022/v1
  timeoutMs: 1800000
  streamIdleTimeoutMs: 1800000
  models:
    - id: inkling-2-mini
      name: Maya Inkling 2 Mini — MTP / 200K context
      input: [text, image]
      contextWindow: 200704
      maxTokens: 32768
      reasoningEfforts: { low: low, medium: medium, high: high }
  reasoning: medium
  apiKeyEnv: HYPERQWEN_LOCAL_API_KEY
maya-local-compact:
  displayName: Maya Inkling 2 Mini Compaction
  api: openai-completions
  baseURL: http://127.0.0.1:18022/v1
  timeoutMs: 1800000
  streamIdleTimeoutMs: 1800000
  models:
    - id: inkling-2-mini
      name: Maya Inkling 2 Mini Compaction
      input: [text]
      contextWindow: 200704
      maxTokens: 4096
  reasoning: low
  apiKeyEnv: HYPERQWEN_LOCAL_API_KEY
```

Set the default model to `provider: maya-local`, `model: inkling-2-mini`. Add a compaction policy for that pair with `thresholdRatio: 0.65`, `headroomTokens: 8192`, `retainTokens: 8192`, `maxTokens: 4096`, `summarizationProvider: maya-local-compact`, and `summarizationModel: inkling-2-mini`. If the profile defines compaction both at the top level and inside the standard preset, add the model policy in both places. Restart DSH after editing the profile so its model list refreshes.

## Verification record (2026-11-26)

The reference checkout's corrected loop-aware CUDA build generated 599 tokens from a 505-token coding prompt at 200,704 context in 2.95 s: **202.89 tok/s**, with 5.20 accepted draft tokens per window and all 3,072 experts resident. This is one workload-specific sample, not a guaranteed average.

The OpenAI server was then tested on the same 3090 using this repository's server and engine build. The repeatable
checks are in [`tools/smoke_maya_openai.py`](../tools/smoke_maya_openai.py):

- `/health` returned `status=ok`, `max_context=200704`, and `images=true`.
- A forced OpenAI function call returned `calculator({"a":19,"b":23})`.
- A generated test image was identified as a blue square.
- A 214-token Python coding answer completed at 186.5 tok/s; MTP accepted 152 of 205 proposed draft tokens in that request.
- A 20,737-token prompt completed in 21.33 s without truncation and returned the requested `ORANGE` marker. Prefill measured 975.8 tok/s. Its five-token answer is too short to represent sustained decode speed.
- Under concurrent GPU use, a 92,037-token prompt completed in 94.15 s and returned the requested `ORANGE` marker; prefill measured 978.7 tok/s. This checks a substantially longer prompt, not a full 200,704-token fill.
- In that same loaded run, the coding answer generated at 193.2 tok/s with MTP accepting 153 of 180 proposed draft tokens. The forced tool call and image recognition also passed (0.98 s image response).
- Swapping the old BF16 safetensors drafter and 8K drafter lookback for the pinned Q8_0 GGUF, FP8 drafter cache, and 65K lookback improved the same short coding API check to **231.5 tok/s** (214 generated tokens; 166/252 draft tokens accepted). The old path measured 193.2 tok/s on that same check.
- For a controlled 100,076-token repeated prompt with a 512-token coding output cap, the new configuration measured **147.9 tok/s** (331/504 drafts accepted). The BF16/8K setup measured 136.5 tok/s; Q8/FP8 at 32K measured 146.8, and at full 200K drafter lookback measured 139.8. These one-run results identify 65K as the best tested setting, not a universal benchmark.
- On the final configuration, the full API smoke run identified the generated image as a blue square, returned the exact forced calculator arguments, generated the 214-token coding answer at 231.5 tok/s, and processed a 92,037-token prompt in 86.69 s (1,063.4 tok/s prefill) with the requested `ORANGE` answer. The 5-token response speed is not a sustained decode measurement.

Speculative decoding verifies candidate windows against the main model, so the drafter changes proposal speed rather than the main model's accepted output distribution. The current PC's DSH desktop profile points to this loopback server, defaults new sessions to Maya, declares text and image input, and routes auto-compaction through Maya. Existing Qwen provider settings remain available. The endpoint handled a 92,037-token prompt; a single prompt filling all 200,704 tokens and an entire long-running DSH compaction cycle were not exercised in this smoke run.

Re-run the manual API checks with `python tools/smoke_maya_openai.py --base-url http://127.0.0.1:18022`.
