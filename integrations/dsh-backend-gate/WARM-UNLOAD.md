# Normal unload and full unload

The model-selector menu contains two existing-style actions; no composer row was added.

- **Unload model** requests `mode: normal`. Qwen uses the router's verified RAM-ready sleep path when enabled: its initialized engine survives, model weights move to system RAM, and GPU KV state is discarded. It may retain a CUDA context/graph overhead in VRAM. The next load/request wakes that same engine.
- **Fully unload · release RAM** requests `mode: full`. Qwen terminates its engine, including a parked engine; the next request cold-starts. Process-owned model RAM is released, while ordinary OS file cache remains reclaimable.
- On Windows, Maya normal unload stops the engine and starts a background prefetch for the model and drafter GGUF files from its configured launch arguments. Windows can reclaim those file-backed pages. Maya reads the original files on the next load and still initializes its engine. The prefetch requires enough available RAM for the file sizes plus an 8 GiB reserve, rechecks the reserve while proceeding, and stops if Maya is selected, fully unloaded, or the DSH plugin is disposed. The full action stops prefetch; ordinary OS cache remains reclaimable. Disable this with `mayaPrefetch: false` in the gate configuration.
- Hyperinkling's normal path retains its existing sleep-or-service-stop fallback; full mode stops the service.

The API accepts `normal|full`, defaults to normal, and preserves its authenticated GET/non-persistent CSRF token and the one-time pre-dispatch token refresh. Work leases, backend activity, selection changes and inference share the existing handoff guard. Full unload includes already-parked Qwen state; it cannot skip RAM residency merely because GPU loaded=false.

The Qwen router hides the active GPU PID while parked and exposes `parked_model`, `parked_engine_pid`, `fast_resume`, `last_sleep_s`, and `last_wake_s`. The menu truthfully shows **Qwen: ready in RAM**. Raw process existence is not evidence that the GPU model is loaded.

Live DavidAU / 131,072 / native MTP-3 / W4A16 qualification on the RTX 3090 at 350 W: normal unload 6.29–9.27 s; next short chat first text 2.40–2.56 s, same API server PID, correct tool-call nonce after both wakes. About 20 GiB was released from card-wide GPU usage. Full unload of a parked engine took 4.02 s and its PID disappeared. These measurements are short-prompt checks: sleep clears prefix/KV caches, so a long retained conversation can require substantial prompt processing after wake. First launch and full-unload reload remain cold starts.

Validated native model-menu and API tests: 71 passed. Runtime export `memory-controls-v3` forces supported DSH host hot reload of the updated handler and menu bundle; older exports remain for rollback. The production desktop profile has a private adjacent backup before the one-row module change. No DSH process restart or Tailscale change was required.
