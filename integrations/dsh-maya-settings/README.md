# DSH Maya live settings

This local DeepSeek Harness plugin adds a **Maya Local** settings section.

- Context window: sent to Maya's `/api/context` endpoint through a same-origin DSH route. Maya validates it against the running build and reloads its model/cache; active chats can pause during that reload. DSH's provider catalog is updated to the same context size.
- Maximum response tokens: updates the live `llm-pi-ai` Maya model entry for future requests.
- Automatic compaction trigger: updates the live `compaction-basic` policy for `maya-local / inkling-2-mini`.

The browser never calls Maya's loopback endpoint directly. The DSH host bridge is write-protected by same-origin checks and accepts only the single bounded `context` value. The other provider and compaction rows are cloned before edits so unrelated settings remain intact.

The plugin is added to the user's desktop profile through a local `link:` dependency. Client code is bundled with React external so DSH's shared React runtime is used.

## Add to another profile

Add `@maya/dsh-maya-settings` as a local `link:` dependency and include it in that profile's `dsh.profile.bundles` array. Merge `profile-integration.patch.yml` into the profile patch. Keep the configured Maya provider ID/model ID consistent with `maya-local / inkling-2-mini`. Restart DSH once to load the new plugin; subsequent edits from the Maya Local page are live. Context changes reload the Maya model, while response-cap and compaction changes do not restart either service.

## Development

```powershell
npm install
npm test
npm run bundle:client
```
