import test from 'node:test'
import assert from 'node:assert/strict'
import { StreamRateTracker, countOutputDelta, trackStream, createSnapshotHandler, apply } from '../index.js'
import { formatPill, pollIntervalMs } from '../client-src.js'

test('counts only non-empty user-visible or tool output deltas', () => {
  assert.equal(countOutputDelta({ type: 'text-delta', text: 'x' }), true)
  assert.equal(countOutputDelta({ type: 'reasoning-delta', text: 'x' }), true)
  assert.equal(countOutputDelta({ type: 'tool-call-delta', argumentsDelta: '{' }), true)
  for (const chunk of [
    { type: 'text-delta', text: '' }, { type: 'block-start' }, { type: 'block-end' },
    { type: 'usage' }, { type: 'finish' }, { type: 'tool-call-delta', argumentsDelta: '' }, null,
  ]) assert.equal(countOutputDelta(chunk), false)
})

test('rolling rate is bounded to two seconds and keeps concurrent active stream count', () => {
  let time = 1000
  const tracker = new StreamRateTracker({ now: () => time, windowMs: 2000, maxDeltas: 4 })
  tracker.start(); tracker.start()
  for (let n = 0; n < 6; n += 1) tracker.delta(true)
  assert.deepEqual(tracker.snapshot(), { approx_tps: 2, active_streams: 2, window_ms: 2000, timestamp: 1000 })
  time = 3001
  assert.deepEqual(tracker.snapshot(), { approx_tps: 0, active_streams: 2, window_ms: 2000, timestamp: 3001 })
  tracker.finish(); tracker.finish()
  assert.equal(tracker.snapshot().active_streams, 0)
})

test('wrapped async stream counts concurrently and always releases active count', async () => {
  const tracker = new StreamRateTracker({ now: () => 5000 })
  async function* source() {
    yield { type: 'text-delta', text: 'hello' }
    yield { type: 'usage' }
    yield { type: 'tool-call-delta', argumentsDelta: '{}' }
  }
  const output = []
  for await (const chunk of trackStream(tracker, source())) output.push(chunk)
  assert.equal(output.length, 3)
  assert.equal(tracker.snapshot().approx_tps, 1)
  assert.equal(tracker.snapshot().active_streams, 0)
})

test('plugin attaches one transparent llm/stream wrapper and authenticated fetch route', async () => {
  let streamListener
  let route
  let handler
  const tracker = new StreamRateTracker({ now: () => 5000 })
  const ctx = {
    on(name, listener) { assert.equal(name, 'llm/stream'); streamListener = listener },
    inject(names, callback) {
      assert.deepEqual(names, ['connection'])
      callback({
        connection: { fetch: { register(config) { route = config.path; handler = config.fetch; return async () => {} } } },
        effect(register) { register() },
      })
    },
  }
  apply(ctx)
  assert.equal(route, '/api/dsh-server-tps')
  const chunks = [{ type: 'text-delta', index: 0, text: 'output' }, { type: 'finish', reason: 'stop' }]
  const observed = []
  for await (const chunk of streamListener({}, () => (async function* () { yield* chunks })())) observed.push(chunk)
  assert.deepEqual(observed, chunks)
  const result = await handler(new Request('http://localhost/api/dsh-server-tps'))
  const body = await result.json()
  assert.equal(result.status, 200)
  assert.equal(body.approx_tps, 0.5)
  assert.equal(body.active_streams, 0)
})

test('snapshot route validates method and query and returns only aggregate TPS', async () => {
  const tracker = new StreamRateTracker({ now: () => 9000 })
  tracker.start(); tracker.delta(true)
  const handler = createSnapshotHandler(tracker)
  const result = await handler(new Request('http://localhost/api/dsh-server-tps'))
  const body = await result.json()
  assert.deepEqual(Object.keys(body).sort(), ['active_streams', 'approx_tps', 'timestamp', 'window_ms'])
  assert.equal(body.active_streams, 1)
  assert.equal(JSON.stringify(body).includes('prompt'), false)
  assert.equal((await handler(new Request('http://localhost/api/dsh-server-tps?provider=secret'))).status, 400)
  assert.equal((await handler(new Request('http://localhost/api/dsh-server-tps', { method: 'POST' }))).status, 405)
})

test('pill formats approximate rate, unavailable and stale states', () => {
  const current = { timestamp: 10000, approx_tps: 22.45, active_streams: 2, window_ms: 2000 }
  assert.equal(formatPill(current, 11000).text, '~22.4 TPS · 2 active streams')
  assert.equal(formatPill({ ...current, active_streams: 1 }, 10000).text, '~22.4 TPS · 1 active stream')
  assert.equal(formatPill(current, 14000).state, 'stale')
  assert.equal(formatPill(null).state, 'unavailable')
  assert.equal(pollIntervalMs, 1000)
})
