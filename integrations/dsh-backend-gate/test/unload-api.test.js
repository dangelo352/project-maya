import test from 'node:test'
import assert from 'node:assert/strict'
import { BackendGate, parseEngineActivity } from '../lib/index.js'
import { createLocalModelHandler } from '../lib/local-model-control.js'

function fixture() {
  const resident = new Set(['qwen'])
  const calls = []
  const clients = {
    loaded: async name => resident.has(name),
    unload: async name => { calls.push(['unload', name]); resident.delete(name) },
    ensure: async name => { calls.push(['ensure', name]); resident.add(name) },
    status: async name => name === 'qwen'
      ? { active_model: resident.has(name) ? 'qwen3.8-27b' : null, engine_pid: resident.has(name) ? 42 : null }
      : name === 'maya' ? { status: 'ok', unloaded: !resident.has(name) } : { sleeping: !resident.has(name) },
  }
  const gate = new BackendGate({ clients })
  gate.currentBackend = 'qwen'
  return { gate, clients, resident, calls, handle: createLocalModelHandler(gate) }
}
const request = (body = { backend: 'all' }, extra = {}) => new Request('http://localhost/api/dsh-local-model', {
  method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', ...extra.headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

test('status is read-only and reports actual unloaded and sleeping backends', async () => {
  const f = fixture()
  const response = await f.handle(new Request('http://localhost/api/dsh-local-model'))
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json()
  assert.deepEqual(Object.fromEntries(data.backends.map(item => [item.backend, item.state])), { qwen: 'ready', maya: 'unloaded', hyperinkling: 'sleeping' })
  assert.deepEqual(f.calls, [])
})
test('explicit unload clears residency and next inference reloads automatically', async () => {
  const f = fixture()
  const response = await f.handle(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, status: 'unloaded', unloaded: ['qwen'] })
  assert.equal(f.gate.currentBackend, null)
  assert.deepEqual(f.calls, [['unload', 'qwen']])
  const release = await f.gate.acquire('hyperqwen-local', 'session-a', 'qwen3.8-27b')
  assert.deepEqual(f.calls, [['unload', 'qwen'], ['ensure', 'qwen']])
  release()
})
test('all backends can be unloaded while cloud and unknown provider requests remain unaffected', async () => {
  const f = fixture()
  f.resident.add('maya'); f.resident.add('hyperinkling')
  await f.gate.unloadIdle()
  assert.equal(f.resident.size, 0)
  assert.deepEqual(f.calls.map(x => x[1]), ['maya', 'qwen', 'hyperinkling'])
  const release = await f.gate.acquire('remote-cloud')
  release()
  assert.equal(f.gate.pendingRequests, 0)
})
test('idle unload is idempotent and does not start any server', async () => {
  const f = fixture(); f.resident.clear()
  assert.equal((await f.gate.unloadIdle()).status, 'already_idle')
  assert.deepEqual(f.calls, [])
})
test('active inference returns busy and never cancels the session or backend', async () => {
  const f = fixture()
  const release = await f.gate.acquire('hyperqwen-local', 'busy-session')
  f.calls.length = 0
  const response = await f.handle(request())
  assert.equal(response.status, 409)
  assert.deepEqual((await response.json()).blockingSessionIds, ['busy-session'])
  assert.deepEqual(f.calls, [])
  assert.equal(f.gate.manualUnload.phase, 'idle')
  release()
})
for (const property of ['pendingRequests', 'transitioning']) test(`unload respects ${property}`, async () => {
  const f = fixture(); f.gate[property] = property === 'transitioning' ? true : 1
  assert.equal((await f.handle(request())).status, 409)
  assert.deepEqual(f.calls, [])
})
test('unload lock blocks racing inference until unloading has finished', async () => {
  const f = fixture()
  let finish
  const blocked = new Promise(resolve => { finish = resolve })
  f.clients.unload = async name => { await blocked; f.resident.delete(name) }
  const operation = f.gate.unloadIdle()
  let acquired = false
  const next = f.gate.acquire('hyperqwen-local').then(release => { acquired = true; release() })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(acquired, false)
  assert.equal((await f.handle(request())).status, 409)
  finish()
  await operation; await next
  assert.equal(f.gate.pendingRequests, 0)
})
test('backend failure never claims successful release and clears the transition lock', async () => {
  const f = fixture()
  f.clients.unload = async () => { throw new Error('backend refused') }
  const response = await f.handle(request())
  assert.equal(response.status, 502)
  assert.equal(f.gate.currentBackend, 'qwen')
  assert.equal(f.gate.transitioning, false)
  assert.equal(f.gate.manualUnload.phase, 'error')
})
test('backend residency must actually clear before success', async () => {
  const f = fixture(); f.clients.unload = async () => ({ ok: true })
  assert.equal((await f.handle(request())).status, 502)
  assert.equal(f.gate.manualUnload.phase, 'error')
})
test('engine work outside a gate lease blocks unloading without touching any model', async () => {
  const f = fixture(); f.resident.add('maya')
  f.clients.activity = async name => ({ busy: name === 'qwen' })
  assert.equal((await f.gate.localStatusSnapshot()).backendBusy, true)
  assert.equal((await f.handle(request())).status, 409)
  assert.deepEqual(f.calls, [])
  assert.equal(f.resident.size, 2)
})
test('unavailable engine activity fails closed without claiming release', async () => {
  const f = fixture(); f.clients.activity = async () => { throw new Error('metrics unavailable') }
  assert.equal((await f.gate.localStatusSnapshot()).backendBusy, true)
  assert.equal((await f.handle(request())).status, 502)
  assert.deepEqual(f.calls, [])
})
test('activity metrics include running and queued requests without double-counting reason labels', () => {
  assert.deepEqual(parseEngineActivity('vllm:num_requests_running{engine="0"} 0.0\nvllm:num_requests_waiting{engine="0"} 1\nvllm:num_requests_waiting_by_reason{reason="capacity"} 1'), { running: 0, waiting: 1, busy: true })
  assert.equal(parseEngineActivity('vllm:num_requests_running 0\nvllm:num_requests_waiting 0').busy, false)
  assert.throws(() => parseEngineActivity('vllm:num_requests_running 0'), /incomplete/)
})
test('unload is protected from cross-origin and missing-origin requests', async () => {
  const f = fixture()
  for (const origin of ['', 'https://attacker.invalid'])
    assert.equal((await f.handle(request({}, { headers: { origin } }))).status, 403)
  assert.equal((await f.handle(request({}, { headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403)
  assert.deepEqual(f.calls, [])
})
test('forwarded Tailscale origin is accepted without hardcoded desktop hostname', async () => {
  const f = fixture()
  const result = await f.handle(request({}, { headers: { origin: 'https://desktop.example.ts.net', 'x-forwarded-host': 'desktop.example.ts.net' } }))
  assert.equal(result.status, 200)
})
test('invalid or force bodies and arbitrary backend URLs are rejected', async () => {
  const f = fixture()
  for (const body of [null, [], { force: true }, { backend: 'http://arbitrary' }, { backend: null }, { sessionId: 3 }, '{bad'])
    assert.equal((await f.handle(request(body))).status, 400)
  assert.equal((await f.handle(request('x'.repeat(1025)))).status, 413)
  assert.equal((await f.handle(request({}, { headers: { 'content-type': 'text/plain' } }))).status, 415)
  assert.deepEqual(f.calls, [])
})
test('GET never mutates and unsupported methods/query strings are rejected', async () => {
  const f = fixture()
  assert.equal((await f.handle(new Request('http://localhost/api/dsh-local-model?backend=qwen'))).status, 400)
  assert.equal((await f.handle(new Request('http://localhost/api/dsh-local-model', { method: 'DELETE' }))).status, 405)
  assert.deepEqual(f.calls, [])
})
