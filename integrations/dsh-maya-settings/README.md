# DSH Maya live settings

This local DeepSeek Harness plugin adds a detailed **Maya Local** settings section, modeled after the Qwen3.8 Local page.

## Controls

- **Server status:** model/build, active context, image/video support, and the pinned loopback endpoint. Status fields are shown only when the host bridge exposes them; a missing status is not reported as an offline server.
- **Context and output:** context is range-checked against Maya's live `/api/context` endpoint and updates DSH's model catalog. Maya rebuilds its context cache, so active generations can pause while it reloads. The output cap is a live DSH request setting for future requests and must remain below the context window.
- **Reasoning:** default effort plus per-effort low/medium/high mappings, so the DSH selector and what the Maya route sends are visible together.
- **Reliability:** request and stream idle timeouts, independently adjustable.
- **Images:** per-request image count, aggregate byte ceiling, per-image target bytes, pixel budget, and overflow offload quantum. A very high count removes the practical count cap; byte and image processing limits still apply to control request size and memory use.
- **Compaction:** trigger slider, effective token estimate, summary image policy, retained reasoning turns, tool-result character cap, and summary cap ratio. The page labels the scope explicitly: these values edit the shared `qwen38` settings namespace and affect Maya chats using the Qwen38 preset. Other presets retain their own compaction configuration. The active default preset is read from DSH's preset roster where available.

Serving controls are saved to DSH's volatile `llm-pi-ai` settings namespace. Context is applied to Maya first, then mirrored into the catalog. Compaction controls use the same `qwen38` namespace as the Qwen settings page; if that namespace is not exposed by the running deployment, the page reports it and does not pretend the save worked. Optimistic revisions are used for writes so concurrent settings changes are detected rather than silently overwritten.

The browser never calls Maya's loopback endpoint directly. The DSH host bridge is write-protected by same-origin checks and accepts only the bounded `context` value. Provider and compaction rows are cloned before edits so unrelated settings remain intact.

The plugin is added to the user's desktop profile through a local `link:` dependency. Client code is bundled with React external so DSH's shared React runtime is used. Client services must be accessed through `ctx.inject([...], callback)`; declaring `inject` on the plugin alone does not make the services available on the root context.

## Add to another profile

Add `@maya/dsh-maya-settings` as a local `link:` dependency and include it in that profile's `dsh.profile.bundles` array. Merge `profile-integration.patch.yml` into the profile patch. Keep the configured Maya provider ID/model ID consistent with `maya-local / inkling-2-mini`. Restart DSH once to load the new plugin; subsequent context and response-cap edits from the Maya Local page are live. Context changes reload the Maya model. Compaction threshold changes remain in the active DSH preset/profile configuration.

## Development

```powershell
npm install
npm test
npm run bundle:client
```
