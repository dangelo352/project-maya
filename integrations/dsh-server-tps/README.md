# DSH generated-token TPS pill

This DeepSeek Harness profile plugin reports output TPS from cumulative counters exposed by the local inference engines. It does not infer token counts from stream chunks.

- Qwen/vLLM: `vllm:generation_tokens_total` from `127.0.0.1:18020/metrics`.
- Maya/Inkling: `llamacpp:tokens_predicted_total` from `127.0.0.1:18022/metrics/prometheus`.
- HyperInkling: `vllm:generation_tokens_total` from `127.0.0.1:18023/metrics`.

The plugin samples these counters when the authenticated DSH route is polled and reports the generated-token delta per second over a rolling window of up to two seconds. A counter reset establishes a new baseline, so a server restart cannot appear as a burst of generated tokens. Multiple open DSH clients share a throttled sample and do not distort the rate. Only the number and state are returned; no prompt, output text, model name, or session identifier is collected.

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
