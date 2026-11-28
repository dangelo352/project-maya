# DSH generated-token TPS pill

This DeepSeek Harness profile plugin reports output TPS from native local inference metrics. It does not infer token counts from stream chunks or count prompt-prefill tokens as output.

- Qwen/vLLM: `vllm:generation_tokens_total` from `127.0.0.1:18020/metrics`.
- Maya/Inkling: `live.tok_s` from `127.0.0.1:18022/metrics`, only while `live.state` is `generating`. This is Maya's native rolling decode window (currently five seconds). Reading, idle and unloaded report zero output TPS. Missing or invalid decode metrics report unavailable.
- HyperInkling: `vllm:generation_tokens_total` from `127.0.0.1:18023/metrics`.

For vLLM the plugin measures counter deltas over up to two seconds. Maya's Prometheus generated total updates on request completion: differencing that total caused false multi-thousand TPS bursts. The plugin now uses its live decode gauge instead. Multiple open DSH clients share a throttled sample. Rates are engine-wide, summed when multiple engines generate; they are not per-chat speeds. No prompt, output text, model name or session identifier is returned.

The composer pill displays only `NN.N TPS`. It does not display active-stream counts. A reachable backend with no recent generated tokens displays `0.0 TPS`; if all three metric endpoints are unavailable, it displays `TPS unavailable`.

## Install in the desktop profile

The desktop profile links this package from `E:\Project-Maya\integrations\dsh-server-tps` and already includes it in its bundle list. After changing the Host plugin, restart DeepSeek Harness so the updated server plugin loads. The client bundle is generated from `client-src.js`.

```powershell
cd E:/Project-Maya/integrations/dsh-server-tps
npm install
npm test
npm run bundle:client
```

The plugin exposes only the DSH authenticated Connection Fetch route `/api/dsh-server-tps`; it opens no listener of its own.
