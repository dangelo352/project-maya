# Inkling 2 Mini on one RTX 3090: local kernel A/B

This is a small local experiment for the Windows CUDA path. It is not a general performance claim or a quality benchmark.

## Setup

- GPU: GeForce RTX 3090, sm_86
- Build: Windows Release, CUDA 12.8.61, MSVC 19.44
- Model: AtomicChat `Inkling-2-Mini-Uncensored-AD-Q4_K.gguf` (16.53 GB)
- Expert tensors in the GGUF: Q4_K fused gate/up and Q5_0 down, across 24 unique layers
- Context: 8,192; KV: FP8; 255 generated tokens per run
- Baseline: `e370446e` (`Support native Windows Inkling 2 GGUFs`)
- Candidate: `d7e25c3e` (Q4_K/Q5_0 row-dot specializations)
- Same coding prompt in every run: write a Python function returning the second-largest distinct integer, raise `ValueError` if fewer than two distinct values exist, include two small tests, and briefly explain edge cases.

Xenoverse remained open in the background. GPU load was not controlled during each run; post-run snapshots ranged from 9% to 16% utilization, with 2.1–2.4 GiB in use after the inference process exited.

## Results

| Decode mode | Baseline runs (tok/s) | Candidate runs (tok/s) | Mean change |
|---|---:|---:|---:|
| Drafting off | 29.64, 28.27 | 40.28, 38.92 | +36.8% |
| Drafting on (DSpark + prompt lookup) | 28.06, 28.49 | 42.43, 40.19 | +46.1% |

Each baseline/candidate pair produced identical token IDs. The CUDA `ik2_kernels_test.exe` suite also completed with `all passed` on the RTX 3090. The source review checked the Q4_K and Q5_0 block arithmetic and bounds.

This is two repeats of one short coding prompt at 8K context. It shows that these specializations help this model on this machine; it does not establish the same gain on other prompts, contexts, GPUs, or in a long Harness session. The drafted runs also show why `--drafting auto` is useful: the best drafting mode depends on whether verification beats plain decoding for the current workload.

Raw local CLI logs are retained under `build/maya-inkling-test/ab-results-20261126/` (the build directory is ignored by Git). The relevant invocation shape was:

```powershell
$env:IK2_KV = 'fp8'
maya-ik2.exe --model <model.gguf> --tokens @<prompt.ids> --gen 256 --ctx 8192 --drafting off
maya-ik2.exe --model <model.gguf> --tokens @<prompt.ids> --gen 256 --ctx 8192 --draft <dspark.gguf> --drafting on
```

## Paired Q4_K subgroup follow-up

After the first A/B, `row_dot_2`'s Q4_K path was changed to hoist each block's scale/minimum values and decode each packed byte's two nibbles together. This comparison uses the saved first optimized executable (`d7e25c3e`) as baseline and the paired-subgroup build as candidate. It is the same RTX 3090, model file, prompt, 8,192-token context, FP8 KV, and 255 measured output tokens; the six runs were interleaved to reduce drift.

| Decode mode | Previous optimized build | Paired Q4_K subgroup candidate | Change |
| --- | ---: | ---: | ---: |
| Drafting off | 41.51, 41.62, 41.84 (mean 41.66) | 57.41, 57.23, 57.20 (mean 57.28) | +37.5% |
| DSpark drafting on | 43.08, 42.84 (mean 42.96) | 63.39, 66.30 (mean 64.85) | +51.0% |

The paired path is faster in both modes on this prompt. All ten runs generated the same token IDs (SHA-256 of the generated-ID line: `3AA9AB73D8AEDF2F947CA2C41A85402B07887841EF5EA7C0199178CBDF129E91`). The complete `ik2_kernels_test.exe` suite ended with `all passed` after rebuilding the candidate for Windows, CUDA 12.8, sm_86.

This does not explain the much higher 110–125 tok/s reports for the separate Unsloth UD-Q4_K_XL path: that file stores its routed experts as NVFP4 and uses Maya's dedicated tensor-core expert kernels, while this AtomicChat AD-Q4_K file stores its experts as Q4_K/Q5_0 and takes the scalar row-dot path. Other builds and quant formats are not directly comparable. No per-run GPU power trace was captured, and the result is still one short prompt at 8K context; see the logs under `build/maya-inkling-test/` for the local raw runs.

## Q5_0 down-projection loop follow-up

The Q5_0 paired row-dot loop now hoists lane-invariant nibble/high-bit indexes and advances each row pointer by its 22-byte block stride. The FP32 accumulation and index order are unchanged. Compared with the paired-Q4 build immediately before it, under the same DSpark-on prompt and settings:

| Build | Runs (tok/s) | Mean |
| --- | ---: | ---: |
| Paired Q4_K build | 64.24, 65.58 | 64.91 |
| Paired Q4_K + Q5_0 pointer hoist | 66.62, 67.05 | 66.84 |

That is a 3.0% gain in this two-run check. The generated token IDs matched exactly across all four runs (same SHA-256 as above), and the full CUDA kernel test executable ended with `all passed`. This small change is retained because it improved the measured path without changing the output; more repetitions are needed to estimate the size of the gain precisely.

## Published Maya fast path comparison

I built the separate public `alesha-pro/maya-inkling-mini` checkout (`27daec5`) for the RTX 3090 and tested its own Unsloth `Inkling-2-Mini-UD-Q4_K_XL.gguf` plus the Thinking Machines MTP drafter. This is a different expert quant from the AtomicChat file above: the Unsloth file stores experts as NVFP4, while AtomicChat stores Q4_K/Q5_0. The reference engine rejects the AtomicChat expert tensor (`Q4_K not decoded here`), so these results do not establish speed or refusal behavior for the uncensored checkpoint.

The public checkout needed a local loader compatibility patch before the test was valid. This GGUF uses `general.architecture=inkling2_loop`, `loop.count/start/end`, and one `blk.N.loop_msg_query.weight` per loop layer. The unmodified checkout expected the older metadata and silently treated the three-pass loop as one pass; its resulting 235 tok/s run emitted repeating special tokens and is invalid. After mapping the current metadata and tensors, the log correctly reported layers 6–17 repeated three times (48 visits per token). Prompts were encoded with this GGUF's tokenizer and Maya's Inkling template.

On a 505-token coding prompt at 65,536 context, FP8 KV, all experts resident, and the MTP drafter enabled:

| Draft width | Generated tokens | Decode speed | Draft acceptance |
| ---: | ---: | ---: | ---: |
| 5 (default) | 599 | 171.13 tok/s | 3.67 per window |
| 8 | 599 | 199.89 tok/s | 5.44 per window |
| 8 | 1,099 | 194.14 tok/s | 5.14 per window |

The first 600 token IDs were identical between widths 5 and 8 (SHA-256 `63028cff9b91ca312a3917d03c63ee730c38b82a2ea56dbb1e53b664db6bf275`). The longer run produced the requested implementation and tests; this is a throughput sample, not a code correctness certification. The single prompt makes the speed content-dependent. It demonstrates about 200 tok/s on this GPU with this supported quant and direct coding output, but does not show that all replies or the AtomicChat quant run at 200 tok/s. The published guide's 211.6 tok/s figure is for an editing prompt; its DSH three-file agent report is 150–167 tok/s. The reference guide's main speed runs use Linux; this local test ran under Windows WDDM/MSVC.

At 262,144 context, the Windows build had too little room for full expert residency plus drafting and reported drafting disabled. At 233,472, it fit the intended fast path but used almost all VRAM and prefilled this short prompt at only 14.6 tok/s, so I stopped that run. The 65,536 result is the useful local comparison. The existing AtomicChat row-dot path remains the relevant speed for the uncensored file until a tensor-core-compatible quant is built and its behavior is checked.

Raw logs are retained under `build/maya-inkling-test/reference-build/` (ignored by Git). The compatibility patch remains in the separate reference checkout; it was not copied into the personal fork because that fork already reads the looped metadata and per-layer message-query tensors.
