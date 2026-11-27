# DSH server-wide approximate TPS pill

This self-contained profile plugin targets DeepSeek Harness `0.2.2-rc.5`. Its Host half wraps the RC5 `llm/stream` waterfall for every provider and observes text, reasoning, and tool-argument delta events. It stores only event timestamps in a bounded two-second window and a concurrent active-stream count. It never stores or returns prompts, generated text, provider names, model names, or session identifiers.

The owner-only snapshot is served by DSH's authenticated Connection Fetch route at `/api/dsh-server-tps`. It returns only `{ approx_tps, active_streams, window_ms, timestamp }`. `approx_tps` is a chunk/delta rate, not tokenizer-exact TPS. DSH's desktop shell forwards this same-origin API request through its authenticated host connection, while the Tailscale browser uses the normal authenticated web route. The plugin does not expose a second listener.

## Install in an RC5 profile

1. Copy this directory to a stable location on the DSH host, or leave it at `E:\Project-Maya\integrations\dsh-server-tps`.
2. From the profile directory, add the local package dependency (adjust the path if copied):

   ```powershell
   pnpm add 'file:E:/Project-Maya/integrations/dsh-server-tps'
   ```

3. Build the browser entry if you changed `client-src.js`:

   ```powershell
   cd E:/Project-Maya/integrations/dsh-server-tps
   npm install
   npm run bundle:client
   ```

4. Ensure the profile's bundle list includes `@maya/dsh-server-tps` if the local profile manager did not activate it automatically. The included `cordis.patch.yml` adds the Host plugin; package metadata publishes its web client face.
5. Restart DSH after changing the Host plugin. The pill appears in the composer dock and refreshes once per second. A stale display means there has been no fresh snapshot; a disconnected display means the authenticated DSH API route is unavailable. It does not make a network request to Maya.

## Development checks

```powershell
npm test
npm run bundle:client
```

`llm/stream` is the RC5 waterfall signature `(options, next) => AsyncIterable<StreamChunk>`. The observer returns every original chunk unchanged and decrements active count even when a consumer cancels or the stream throws.
