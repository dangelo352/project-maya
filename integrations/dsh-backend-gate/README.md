# DSH local backend gate

This profile bundle keeps the Maya and Qwen GPU services mutually exclusive while allowing concurrent calls to whichever backend is selected. It uses the DSH 0.2.2-rc.5 `llm/stream` waterfall (`ctx.on('llm/stream', (options, next) => ...)`). The gate holds a backend lease until the returned async stream finishes or is cancelled.

Provider routing is exact:

| Provider IDs | Backend | Base URL |
| --- | --- | --- |
| `maya-local`, `maya-local-compact` | Maya | `http://127.0.0.1:18022` |
| `hyperqwen-local`, `hyperqwen-local-compact` | Qwen | `http://127.0.0.1:18021` |

On first use after DSH starts, the gate probes Maya `GET /api/ps` and Qwen `GET /status`. If the other backend is loaded, it unloads that backend before dispatch. Status or unload errors fail the request with a clear message; the gate does not guess that unknown means idle. Maya unload uses its existing `POST /models/unload` endpoint and therefore requires Maya model management to be enabled. Qwen unload uses the added `POST /unload` router route.

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
```

## Rollback

Remove `@maya/dsh-backend-gate` from `dsh.profile.bundles` and remove the dependency with `pnpm remove @maya/dsh-backend-gate` from the selected profile. This integration does not edit `app.asar`, a profile, or either live service.

## Tests

Run `node --test integrations/dsh-backend-gate/test/gate.test.js` from the Maya repository root.
