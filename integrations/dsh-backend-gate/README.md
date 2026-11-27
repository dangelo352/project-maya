# DSH local backend gate

This profile bundle keeps Maya, Qwen, and HyperInkling GPU use mutually exclusive while allowing concurrent calls to whichever backend is selected. It uses the DSH 0.2.2-rc.5 `llm/stream` waterfall (`ctx.on('llm/stream', (options, next) => ...)`). The gate holds a backend lease until the returned async stream finishes or is cancelled.

Provider routing is exact:

| Provider IDs | Backend | Base URL |
| --- | --- | --- |
| `maya-local`, `maya-local-compact` | Maya | `http://127.0.0.1:18022` |
| `hyperqwen-local`, `hyperqwen-local-compact` | Qwen | `http://127.0.0.1:18021` |
| `hyperinkling-local`, `hyperinkling-local-compact` | HyperInkling | `http://127.0.0.1:18023` |

On first use after DSH starts, the gate probes all three backends. It unloads every active non-target backend before starting or waking the selected one. A missing HyperInkling server is treated as idle while routing Maya/Qwen; selecting HyperInkling starts the WSL systemd unit on demand, waits for `/is_sleeping`, and wakes it if needed. Switching away uses vLLM level-1 sleep, which offloads weights and discards the KV cache. Status or unload errors fail the request; the gate does not assume that an unknown reachable service is idle. Maya unload uses its existing `POST /models/unload` endpoint and therefore requires Maya model management to be enabled. Qwen unload uses the added `POST /unload` router route. HyperInkling requires vLLM sleep mode enabled and the optional systemd unit installed as described below.

## Install into a DSH profile

Run these commands from a PowerShell prompt, replacing `$ProfileDir` with the profile directory actually selected by the user-level DSH launcher. This changes only that profile's package manifest and lockfile; do not copy the example over an existing profile.

```powershell
$ProfileDir = 'C:\path\to\the\selected\dsh-profile'
Set-Location $ProfileDir
pnpm add 'file:E:\Project-Maya\integrations\dsh-backend-gate'
```

Ensure `@maya/dsh-backend-gate` is in `dsh.profile.bundles` in that profile's `package.json`, preserving the existing bundle list. The `dsh.bundle.patch` declaration in this package contributes the `maya-backend-gate` plugin row when the bundle is active. Restart DSH only when the profile change is intentionally applied.

The following is an integration example, not an active-profile edit. Merge the provider entries into the existing `llm-pi-ai` config and preserve unrelated providers and rows. Keep Maya as the DSH default if that is desired; the gate applies whichever selected model emits an `llm/stream` request.

```yaml
# Provider config example (inside the existing llm-pi-ai row's config.providers)
maya-local:
  baseURL: http://127.0.0.1:18022/v1
  apiKey: local
  models:
    - id: inkling-2-mini
      name: Maya Inkling 2 Mini
maya-local-compact:
  baseURL: http://127.0.0.1:18022/v1
  apiKey: local
  models:
    - id: inkling-2-mini
      name: Maya Inkling 2 Mini (compact)
hyperqwen-local:
  baseURL: http://127.0.0.1:18021/v1
  apiKey: local
  models:
    - id: qwen3.8-27b
      name: Qwen3.8 27B
hyperqwen-local-compact:
  baseURL: http://127.0.0.1:18021/v1
  apiKey: local
  models:
    - id: qwen3.8-27b
      name: Qwen3.8 27B (compact)
hyperinkling-local:
  baseURL: http://127.0.0.1:18023/v1
  apiKey: local
  models:
    - id: inkling-2-mini
      name: Abliterated Inkling 2 Mini (HyperInkling)
      input: [text, image]
      contextWindow: 262144 # Set to the actual server max_model_len after its first boot.
      maxTokens: 32768
hyperinkling-local-compact:
  baseURL: http://127.0.0.1:18023/v1
  apiKey: local
  models:
    - id: inkling-2-mini
      name: Abliterated Inkling 2 Mini (HyperInkling compact)
      input: [text]
      contextWindow: 262144 # Must match the normal route's server context.
      maxTokens: 4096
```

## On-demand HyperInkling service (Windows + WSL)

Install `hyperinkling.service` into `/etc/systemd/system/` after editing its paths for the local clone. Create a private `.env` beside `start.sh` with the exact model path and serving settings. Keep `HOST=127.0.0.1`, `PORT=18023`, `DASHBOARD=0`, `MAX_LEN=auto`, `KEEP_FREE_GB=2`, and `EXTRA_ARGS=--enable-sleep-mode`. Set `IMAGES=999`, the upstream limit; the context window, rather than a small image-count cap, is the practical bound. Use `SPEC=dflash2` for best ordinary chat/code speed if its drafter is installed; use `SPEC=dspark` for long-document summarization. The unit is deliberately not enabled at boot: the DSH gate starts it when the HyperInkling route is selected. `Restart=on-failure` recovers a crashed server while preserving on-demand startup.

The gate invokes `wsl.exe -d Ubuntu -u root -- systemctl start hyperinkling.service`. Change `distro` and `serviceUnit` in the gate configuration if the local unit uses different names. Do not configure both HyperInkling and another model to start automatically on boot.

## Rollback

Remove `@maya/dsh-backend-gate` from `dsh.profile.bundles` and remove the dependency with `pnpm remove @maya/dsh-backend-gate` from the selected profile. This integration does not edit `app.asar`, a profile, or either live service.

## Tests

Run `node --test integrations/dsh-backend-gate/test/gate.test.js` from the Maya repository root.
