# DSH model switching

## Live progress and steering

The DSH bundle registers a session-scoped card above the composer. It follows DSH's durable `model/selection` event, shows the gate's real stages, and polls the selected backend's own status endpoint. The Qwen router reports `loading_model` and `active_model`; Maya reports loaded/unloaded state. Neither current endpoint exposes trustworthy byte- or percentage-level model-load progress, so the card uses an indeterminate animated bar until the backend confirms ready and never invents a percent.

When a switch is waiting on active local-model work, the card offers an explicit stop button. It targets only DSH session IDs currently holding the GPU gate, using DSH's normal session-cancel API. Queued inbox work remains in DSH. It does not cancel turns automatically.

## Switch latency and GPU memory

Model selection starts the handoff immediately. The gate waits for active streams, unloads the old GPU model, and loads the selected model. It keeps at most one model resident in GPU memory. A cold switch cannot be instantaneous without keeping the next model resident somewhere. Both servers stay available, and the operating system may retain recently read checkpoint pages in its filesystem cache. That cache uses system RAM, is opportunistic, and can be evicted under memory pressure.

The current Qwen router stops the vLLM engine when unloading. It does not implement vLLM sleep/wake. Enabling level-1 sleep is a separate experiment and needs a real switch test with the installed AutoRound model and custom kernels before replacing the current unload/reload path. It may keep weights in CPU RAM while freeing GPU memory, but it must be measured on this build before calling it faster or reliable.

## Explicit Qwen loading

`router-load.patch.py` adds an idempotent `POST /load` route to the local HyperQwen `model_router.py`. It serializes against inference and unload operations, uses the router's existing `ensure_model()` rollback path, and returns only when the engine is healthy. `/status` remains available during loading. Back up the live router file and restart its user service only when no Qwen turn is active:

```powershell
wsl -d Ubuntu -- cp -p /root/hyperqwen-task-native/single-user/model_router.py /root/hyperqwen-task-native/single-user/model_router.py.before-dsh-load-route
wsl -d Ubuntu -- python3 /mnt/e/Project-Maya/integrations/dsh-backend-gate/router-load.patch.py /root/hyperqwen-task-native/single-user/model_router.py
wsl -d Ubuntu -- systemctl --user restart hyperqwen-model-router.service
```

No `sudo` is needed. The DSH gate calls `POST /load` and waits for `/status` to show the selected model and a live engine PID.

To rebuild the browser module on another PC, install this package's development dependency and run its script from the plugin directory:

```powershell
pnpm install --dir E:\Project-Maya\integrations\dsh-backend-gate
pnpm --dir E:\Project-Maya\integrations\dsh-backend-gate bundle:client
```
