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
