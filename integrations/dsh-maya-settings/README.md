# DSH Maya live settings

This local DeepSeek Harness plugin adds a **Maya Local** settings section.

- Context window: sent to Maya's `/api/context` endpoint through a same-origin DSH route. Maya validates it against the running build and reloads its model/cache; active chats can pause during that reload. DSH's provider catalog is updated to the same context size.
- Maximum response tokens: updates the live `llm-pi-ai` Maya model entry for future requests.
- Automatic compaction: remains controlled by the selected DSH preset. The current profile does not expose the built-in compaction policy as a volatile settings namespace, so this page reports that limitation instead of failing or claiming a save succeeded.

The browser never calls Maya's loopback endpoint directly. The DSH host bridge is write-protected by same-origin checks and accepts only the single bounded `context` value. The other provider and compaction rows are cloned before edits so unrelated settings remain intact.

The plugin is added to the user's desktop profile through a local `link:` dependency. Client code is bundled with React external so DSH's shared React runtime is used. Client services must be accessed through `ctx.inject([...], callback)`; declaring `inject` on the plugin alone does not make the services available on the root context.

## Add to another profile

Add `@maya/dsh-maya-settings` as a local `link:` dependency and include it in that profile's `dsh.profile.bundles` array. Merge `profile-integration.patch.yml` into the profile patch. Keep the configured Maya provider ID/model ID consistent with `maya-local / inkling-2-mini`. Restart DSH once to load the new plugin; subsequent context and response-cap edits from the Maya Local page are live. Context changes reload the Maya model. Compaction threshold changes remain in the active DSH preset/profile configuration.

## Development

```powershell
npm install
npm test
npm run bundle:client
```
