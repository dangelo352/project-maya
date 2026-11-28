import test from 'node:test'
import assert from 'node:assert/strict'
import { BackendGate, parseEngineActivity } from '../lib/index.js'
import { createLocalModelHandler } from '../lib/local-model-control.js'
const TEST_TOKEN = 'T'.repeat(43)

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
  return { gate, clients, resident, calls, handle: createLocalModelHandler(gate, { csrfToken: TEST_TOKEN }) }
}
const request = (body = { backend: 'all' }, extra = {}) => new Request('http://localhost/api/dsh-local-model', {
  method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-dsh-csrf-token': TEST_TOKEN, ...extra.headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

test('status is read-only and reports actual unloaded and sleeping backends', async () => {
  const f = fixture()
  const response = await f.handle(new Request('http://localhost/api/dsh-local-model'))
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json()
  assert.equal(data.csrfToken, TEST_TOKEN)
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

test('normal unload parks Qwen and full unload releases an already parked engine', async () => {
  const f = fixture()
  let parked = false
  const modes = []
  f.clients.unload = async (name, mode) => {
    modes.push(mode)
    f.resident.delete(name)
    parked = mode === 'normal'
  }
  f.clients.status = async () => ({ parked_model: parked ? 'qwen3.8-27b' : null,
    active_model: f.resident.has('qwen') ? 'qwen3.8-27b' : null,
    engine_pid: f.resident.has('qwen') ? 42 : null })
  await f.gate.unloadIdle('qwen', 'a', 'normal')
  assert.equal((await f.gate.localStatusSnapshot()).backends.find(x => x.backend === 'qwen').state, 'parked')
  await f.gate.unloadIdle('qwen', 'a', 'full')
  assert.equal(parked, false)
  assert.deepEqual(modes, ['normal', 'full'])
})

test('full unload refuses a backend that still claims RAM residency', async () => {
  const f = fixture(); f.resident.clear()
  f.clients.status = async () => ({ parked_model: 'qwen3.8-27b' })
  await assert.rejects(f.gate.unloadIdle('qwen', 'a', 'full'), /retained in RAM/)
})

test('invalid unload mode is rejected before touching any backend', async () => {
  const f = fixture()
  await assert.rejects(f.gate.unloadIdle('qwen', 'a', 'pretend'), /Invalid unload mode/)
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
test('unload is protected from explicit cross-origin and cross-site requests even with a valid token', async () => {
  const f = fixture()
  for (const origin of ['null', 'https://attacker.invalid'])
    assert.equal((await f.handle(request({}, { headers: { origin } }))).status, 403)
  assert.equal((await f.handle(request({}, { headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403)
  assert.deepEqual(f.calls, [])
})
test('forwarded Tailscale origin is accepted without hardcoded desktop hostname', async () => {
  const f = fixture()
  const result = await f.handle(request({}, { headers: { origin: 'https://desktop.example.ts.net', 'x-forwarded-host': 'desktop.example.ts.net' } }))
  assert.equal(result.status, 200)
})
test('real Electron bridge shape succeeds without Origin or Fetch Metadata when the synchronizer token is valid', async () => {
  const f = fixture()
  const forwarded = request()
  forwarded.headers.delete('origin')
  forwarded.headers.delete('sec-fetch-site')
  forwarded.headers.set('host', '127.0.0.1:63676')
  assert.equal((await f.handle(forwarded)).status, 200)
  assert.deepEqual(f.calls, [['unload', 'qwen']])
})
test('missing-Origin requests with missing or forged synchronizer tokens never unload', async () => {
  const f = fixture()
  for (const token of ['', 'X'.repeat(43), 'short', 'X'.repeat(44)]) {
    const forwarded = request({}, { headers: { 'x-dsh-csrf-token': token } })
    forwarded.headers.delete('origin')
    assert.equal((await f.handle(forwarded)).status, 403)
  }
  assert.deepEqual(f.calls, [])
})
test('tokens are rotated with the handler and never accepted by another instance', async () => {
  const f = fixture()
  const next = createLocalModelHandler(f.gate)
  const state = await (await next(new Request('http://localhost/api/dsh-local-model'))).json()
  assert.match(state.csrfToken, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(state.csrfToken, TEST_TOKEN)
  assert.equal((await next(request())).status, 403)
  assert.deepEqual(f.calls, [])
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


test('API defaults to normal and forwards explicit unload modes and session unchanged', async () => {
  for (const [body, expected] of [
    [{}, ['all', undefined, 'normal']],
    [{ backend: 'qwen', sessionId: 'park-session', mode: 'normal' }, ['qwen', 'park-session', 'normal']],
    [{ backend: 'all', sessionId: 'release-session', mode: 'full' }, ['all', 'release-session', 'full']],
  ]) {
    const calls = []
    const handle = createLocalModelHandler({ unloadIdle: async (...args) => {
      calls.push(args)
      return { ok: true, status: 'unloaded' }
    } }, { csrfToken: TEST_TOKEN })
    assert.equal((await handle(request(body))).status, 200)
    assert.deepEqual(calls, [expected])
  }
})

test('API rejects every invalid mode before gate dispatch', async () => {
  const calls = []
  const handle = createLocalModelHandler({ unloadIdle: async (...args) => { calls.push(args) } }, { csrfToken: TEST_TOKEN })
  for (const mode of [null, '', 'FULL', 'park', false, 0, [], {}, ['normal']]) {
    const result = await handle(request({ mode }))
    assert.equal(result.status, 400)
    assert.equal((await result.json()).error, 'invalid_request')
  }
  assert.deepEqual(calls, [])
})
