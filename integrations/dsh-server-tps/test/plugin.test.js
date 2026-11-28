import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineTokenRate, METRIC_SOURCES, parseGeneratedTokens, parseMayaRate, createSnapshotHandler, apply } from '../index.js'
import { formatPill, pollIntervalMs } from '../client-src.js'

test('parses exact generated-token counters for vLLM and Maya', () => {
  assert.equal(parseGeneratedTokens('# help\nvllm:generation_tokens_total{engine="0"} 100.0\nvllm:generation_tokens_total{engine="1"} 2', 'vllm'), 102)
  assert.equal(parseGeneratedTokens('llamacpp:tokens_predicted_total 42', 'maya'), 42)
  assert.equal(parseGeneratedTokens('vllm:other_total 10', 'vllm'), null)
  assert.equal(parseGeneratedTokens('', 'maya'), null)
})

test('measures TPS from engine token-counter deltas and becomes idle', async () => {
  let time = 1000
  let qwenTokens = 100
  const source = { name: 'qwen', url: 'http://qwen/metrics', kind: 'vllm' }
  const rate = new EngineTokenRate({
    sources: [source], now: () => time,
    fetchImpl: async () => new Response(`vllm:generation_tokens_total  ${qwenTokens}`),
  })
  assert.deepEqual(await rate.snapshot(), { tps: 0, timestamp: 1000, window_ms: 2000, state: 'idle' })
  time = 2000; qwenTokens = 200
  assert.deepEqual(await rate.snapshot(), { tps: 100, timestamp: 2000, window_ms: 2000, state: 'live' })
  time = 3000
  assert.deepEqual(await rate.snapshot(), { tps: 50, timestamp: 3000, window_ms: 2000, state: 'live' })
  time = 4001
  assert.deepEqual(await rate.snapshot(), { tps: 0, timestamp: 4001, window_ms: 2000, state: 'idle' })
})

test('supports both local engines and does not turn a restarted counter into fake TPS', async () => {
  let time = 10_000
  const counters = { qwen: 500, maya: 700, inkling: null }
  const rate = new EngineTokenRate({
    sources: METRIC_SOURCES.map(s => s.name === 'maya' ? { ...s, kind: 'maya' } : s),
    now: () => time,
    fetchImpl: async url => {
      const source = METRIC_SOURCES.find(item => item.url === url)
      if (counters[source.name] === null) throw new Error('offline')
      const metric = source.name === 'maya' ? 'llamacpp:tokens_predicted_total' : 'vllm:generation_tokens_total'
      return new Response(`${metric} ${counters[source.name]}`)
    },
  })
  await rate.snapshot()
  time += 1000; counters.qwen += 80; counters.maya += 30
  assert.equal((await rate.snapshot()).tps, 110)
  time += 1000; counters.qwen = 2
  const reset = await rate.snapshot()
  assert.equal(reset.tps, 55)
  assert.equal(reset.state, 'live')
})

test('Maya uses live decode, never prefill or completion-total bursts', async () => {
  let time = 1000
  let live = {state: 'generating', tok_s: 99, prefill_tok_s_mean: 2000}
  let total = 0
  const rate = new EngineTokenRate({
    sources: METRIC_SOURCES.filter(s => s.name === 'maya'), now: () => time,
    fetchImpl: async () => Response.json({live, totals: {output_tokens: total}}),
  })
  assert.equal((await rate.snapshot()).tps, 99)
  time += 1000; total = 8000; live = {state: 'idle', tok_s: null}
  assert.equal((await rate.snapshot()).tps, 0)
  time += 1000; live = {state: 'reading', tok_s: 2000, prefill_tok_s_mean: 2000}
  assert.equal((await rate.snapshot()).tps, 0)
  assert.equal(parseMayaRate({live: {state: 'generating', tok_s: -1}}), null)
  assert.equal(parseMayaRate({live: {state: 'generating', tok_s: '99'}}), null)
  assert.equal(parseMayaRate({live: {state: 'generating', tok_s: null}}), null)
  assert.equal(parseMayaRate({live: {state: 'generating', tok_s: NaN}}), null)
  assert.equal(parseMayaRate({}), null)
})

test('drops counters spanning a long disconnected gap instead of showing a false burst', async () => {
  let time = 1000
  let output = 20
  const rate = new EngineTokenRate({
    sources: [{ name: 'qwen', url: 'http://qwen/metrics', kind: 'vllm' }],
    now: () => time,
    fetchImpl: async () => new Response(`vllm:generation_tokens_total ${output}`),
  })
  await rate.snapshot()
  time = 20_000; output = 2020
  const resumed = await rate.snapshot()
  assert.equal(resumed.tps, 0)
  assert.equal(resumed.state, 'idle')
})

test('snapshot endpoint is method/query restricted and returns only TPS data', async () => {
  const rate = new EngineTokenRate({ sources: [], now: () => 9000 })
  const handler = createSnapshotHandler(rate)
  const result = await handler(new Request('http://localhost/api/dsh-server-tps'))
  const body = await result.json()
  assert.deepEqual(Object.keys(body).sort(), ['state', 'timestamp', 'tps', 'window_ms'])
  assert.equal(body.state, 'unavailable')
  assert.equal((await handler(new Request('http://localhost/api/dsh-server-tps?provider=secret'))).status, 400)
  assert.equal((await handler(new Request('http://localhost/api/dsh-server-tps', { method: 'POST' }))).status, 405)
})

test('plugin registers only the authenticated DSH route, without stream labels', () => {
  let route
  const ctx = {
    inject(names, callback) {
      assert.deepEqual(names, ['connection'])
      callback({
        connection: { fetch: { register(config) { route = config.path; return async () => {} } } },
        effect(register) { register() },
      })
    },
  }
  apply(ctx)
  assert.equal(route, '/api/dsh-server-tps')
})

test('pill shows only measured TPS, including idle and unavailable states', () => {
  const live = { timestamp: 10000, tps: 22.45, state: 'live', window_ms: 2000 }
  assert.equal(formatPill(live, 11000).text, '22.4 TPS')
  assert.equal(formatPill({ ...live, tps: 0, state: 'idle' }, 11000).text, '0.0 TPS')
  assert.equal(formatPill(null).text, 'TPS unavailable')
  assert.equal(formatPill(live, 14000).state, 'stale')
  assert.equal(pollIntervalMs, 1000)
})
