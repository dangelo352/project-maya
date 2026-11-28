# Unload local models from DSH

Open the model/reasoning selector beside the composer, then choose **Unload model**.
The control uses DSH's existing `conversation.input.model.options` extension point;
it adds no button or status row to the composer. Desktop and mobile use the same menu.
Its status polling exists only while the menu is mounted and is aborted when it closes.

The action targets local Qwen, Maya and HyperInkling backends. It never changes a cloud
provider, deletes weights, changes context/quantization, cancels turns or pauses goals.
The next local request reloads its model automatically. An ongoing automatic goal can
also issue that next request; unload is not a persistent generation lock.

## Host protocol and safeguards

`GET /api/dsh-local-model` reports backend facts, gate leases, pending admissions,
transition state, and engine/scheduler activity. It does not load or unload anything.
`POST` accepts JSON `{ "backend": "all", "sessionId": "optional" }`; a known single
backend may be used by API callers. Normal DSH authentication and a synchronizer CSRF
token apply. The authenticated, non-cacheable GET returns an ephemeral `csrfToken`;
POST carries it in `x-dsh-csrf-token`. The token is never persisted in sessions or logs.
Explicit foreign origins and cross-site Fetch Metadata remain rejected. Missing Origin
is accepted only with a valid token: Electron's verified `dsh-app://app` bridge strips
Origin and Fetch Metadata before injecting its private Host cookie. Arbitrary URLs,
force flags, invalid fields and oversized bodies are rejected.

The client refreshes an expired nonce and retries once only for the explicit pre-dispatch
`403 csrf_token_required` result. Busy, backend, network and other ambiguous failures are
never retried. Missing nonce responses prevent an action rather than bypassing protection.

The action returns 409 for active/pending DSH work, transitions or observed backend work.
Qwen activity also checks its engine metrics and the streaming proxy queue; Maya checks
its busy/queued status; HyperInkling checks vLLM metrics. Incomplete engine activity fails
closed. This protects requests already running when the gate plugin is reloaded.

Unloading holds the same transition lock as model switching. It preflights every resident
target before unloading any, then verifies each backend no longer reports a resident
model. Failed or ambiguous operations remain failures, not a fabricated GPU-memory saving.
Busy checks cannot make independent external API clients obey DSH's lifecycle lock.

## Applying to an existing desktop profile

Build from this integration directory with `npm run bundle:client`. The package exposes
a fresh `@maya/dsh-backend-gate/memory-controls-v2` entry for an existing profile row:

```yaml
- id: maya-backend-gate
  name: '@maya/dsh-backend-gate/memory-controls-v2'
```

Preserve the profile's other configuration. The installed desktop's previous profile
patch was backed up beside it before changing this one row. Its supported profile hot
reload applied the host route and client module; DSH and the inference engine were not
restarted. To roll back, restore the prior row or the private profile backup.

## Validation — 2026-11-27

* 63 integration tests passed: switching/compaction regression tests, simulated unload,
  automatic reload on next request, concurrency, busy rejection, backend verification,
  CSRF/input handling, menu mounting, request cleanup and bundle registration.
* Client bundle built and smoke-checked against the native model-menu slot.
* Authenticated GET of the live DSH endpoint returned 200 with Qwen ready, Maya unloaded
  and HyperInkling offline.
* The Unload model action and backend labels were observed inside the real desktop model
  selector. No new composer row was present.
* Qwen's engine PID remained 11617 across deployment. No live unload POST, inference
  cancellation, model load, server restart or physical VRAM-release experiment was run.
* Desktop UI verification stopped when Computer Use reported the user's Escape stop.
* The desktop bridge's stripped-Origin bug was reproduced from the shipped source and
  covered by a regression test. Live authenticated invalid-command probes passed the
  authorization check for forwarded desktop, HTTP and Tailscale HTTPS callers (400 at
  schema validation). Missing/forged tokens and foreign origins returned 403. Fresh
  cookie-only test sessions prevented the HTTP test client's headers leaking between cases.
  Every live probe used an invalid backend name, so none could dispatch an unload.

Live unload/reload latency and exact VRAM release remain unmeasured by design: the user
explicitly requested that the loaded model be left alone.
