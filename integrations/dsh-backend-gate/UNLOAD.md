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
backend may be used by API callers. Normal DSH authentication and a same-origin POST
check apply. Arbitrary URLs, force flags, invalid fields and oversized bodies are rejected.

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
a fresh `@maya/dsh-backend-gate/memory-controls` entry for an existing profile row:

```yaml
- id: maya-backend-gate
  name: '@maya/dsh-backend-gate/memory-controls'
```

Preserve the profile's other configuration. The installed desktop's previous profile
patch was backed up beside it before changing this one row. Its supported profile hot
reload applied the host route and client module; DSH and the inference engine were not
restarted. To roll back, restore the prior row or the private profile backup.

## Validation — 2026-11-27

* 55 integration tests passed: switching/compaction regression tests, simulated unload,
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

Live unload/reload latency and exact VRAM release remain unmeasured by design: the user
explicitly requested that the loaded model be left alone.
