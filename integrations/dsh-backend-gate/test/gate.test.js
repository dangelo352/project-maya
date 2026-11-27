import test from 'node:test'
import assert from 'node:assert/strict'
import { BackendGate, BACKENDS, createBackendClients } from '../lib/index.js'

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

function clients(overrides = {}) {
  const calls = []
  return {
    calls,
    loaded: async backend => { calls.push(['status', backend]); return false },
    unload: async backend => { calls.push(['unload', backend]); return { status: 'unloaded' } },
    ...overrides,
  }
}

test('same selected backend is a no-op and aliases map exactly', async () => {
  const io = clients()
  const gate = new BackendGate({ clients: io })
  gate.currentBackend = 'qwen'
  const release = await gate.acquire('qwen38')
  assert.equal(gate.activeRequests, 1)
  release()
  assert.deepEqual(io.calls, [])
  assert.deepEqual(BACKENDS, {
    'maya-local': 'maya', 'maya-local-compact': 'maya',
    'hyperqwen-local': 'qwen', 'hyperqwen-local-compact': 'qwen',
    'hyperinkling-local': 'hyperinkling', 'hyperinkling-local-compact': 'hyperinkling',
    qwen38: 'qwen',
  })
})

test('default qwen38 route shares the same drain and unload gate', async () => {
  const io = clients()
  const gate = new BackendGate({ clients: io })
  gate.currentBackend = 'maya'
  const release = await gate.acquire('qwen38')
  assert.deepEqual(io.calls, [['unload', 'maya']])
  assert.equal(gate.currentBackend, 'qwen')
  release()
})

test('same backend requests overlap without unloading', async () => {
  const io = clients()
  const gate = new BackendGate({ clients: io })
  gate.currentBackend = 'maya'
  const a = await gate.acquire('maya-local')
  const b = await gate.acquire('maya-local-compact')
  assert.equal(gate.activeRequests, 2)
  a(); b()
  assert.deepEqual(io.calls, [])
})

test('backend switch waits for active calls to drain before unloading', async () => {
  const started = deferred()
  const io = clients({ unload: async backend => { io.calls.push(['unload', backend]); return { status: 'unloaded' } } })
  const gate = new BackendGate({ clients: io })
  gate.currentBackend = 'maya'
  const release = await gate.acquire('maya-local')
  const switching = gate.acquire('hyperqwen-local')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(io.calls, [])
  started.resolve()
  release()
  const releaseQwen = await switching
  assert.deepEqual(io.calls, [['unload', 'maya']])
  assert.equal(gate.currentBackend, 'qwen')
  releaseQwen()
})

test('unload failure rejects the switch and preserves prior backend', async () => {
  const gate = new BackendGate({ clients: clients({ unload: async () => { throw new Error('Maya unload busy') } }) })
  gate.currentBackend = 'maya'
  await assert.rejects(gate.acquire('hyperqwen-local'), /Maya unload busy/)
  assert.equal(gate.currentBackend, 'maya')
  assert.equal(gate.activeRequests, 0)
})

test('unknown bootstrap probes both endpoints and unloads loaded non-target', async () => {
  const io = clients({
    loaded: async backend => { io.calls.push(['status', backend]); return backend === 'maya' },
  })
  const gate = new BackendGate({ clients: io })
  const release = await gate.acquire('hyperqwen-local')
  assert.deepEqual(io.calls, [
    ['status', 'maya'], ['status', 'qwen'], ['status', 'hyperinkling'], ['unload', 'maya'],
  ])
  assert.equal(gate.currentBackend, 'qwen')
  release()
})

test('unknown bootstrap retains target when it is already loaded', async () => {
  const io = clients({
    loaded: async backend => { io.calls.push(['status', backend]); return backend === 'maya' },
  })
  const gate = new BackendGate({ clients: io })
  const release = await gate.acquire('maya-local')
  assert.deepEqual(io.calls, [['status', 'maya'], ['status', 'qwen'], ['status', 'hyperinkling']])
  assert.equal(gate.currentBackend, 'maya')
  release()
})

test('bootstrap reserves its backend before waking a competing switch', async () => {
  const statusesReady = deferred()
  const statusStarted = deferred()
  const io = clients({
    loaded: async backend => {
      io.calls.push(['status', backend])
      if (backend === 'maya') {
        statusStarted.resolve()
        await statusesReady.promise
        return true
      }
      return false
    },
  })
  const gate = new BackendGate({ clients: io })
  const mayaRequest = gate.acquire('maya-local')
  await statusStarted.promise
  const qwenRequest = gate.acquire('hyperqwen-local')

  statusesReady.resolve()
  const releaseMaya = await mayaRequest
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(gate.currentBackend, 'maya')
  assert.equal(gate.activeRequests, 1)
  assert.deepEqual(io.calls, [['status', 'maya'], ['status', 'qwen'], ['status', 'hyperinkling']])

  releaseMaya()
  const releaseQwen = await qwenRequest
  assert.deepEqual(io.calls, [
    ['status', 'maya'], ['status', 'qwen'], ['status', 'hyperinkling'], ['unload', 'maya'],
  ])
  assert.equal(gate.currentBackend, 'qwen')
  releaseQwen()
})

test('switching to HyperInkling unloads the old backend before starting it', async () => {
  const io = clients({ ensure: async backend => { io.calls.push(['ensure', backend]) } })
  const gate = new BackendGate({ clients: io })
  gate.currentBackend = 'maya'
  const release = await gate.acquire('hyperinkling-local')
  assert.deepEqual(io.calls, [['unload', 'maya'], ['ensure', 'hyperinkling']])
  assert.equal(gate.currentBackend, 'hyperinkling')
  release()
})

test('offline HyperInkling is treated as idle during bootstrap', async () => {
  const io = createBackendClients({ fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.equal(await io.loaded('hyperinkling'), false)
})

test('HyperInkling starts on demand and wakes when the API is ready', async () => {
  let started = false
  let sleeping = true
  let warming = true
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push([url, init.method ?? 'GET'])
    if (!started) throw new TypeError('fetch failed')
    if (url.endsWith('/is_sleeping')) {
      if (warming) {
        warming = false
        return { ok: false, status: 503, json: async () => ({}) }
      }
      return { ok: true, json: async () => ({ is_sleeping: sleeping }) }
    }
    if (url.endsWith('/wake_up')) {
      sleeping = false
      return { ok: true, json: async () => ({ status: 'awake' }) }
    }
    throw new Error(`unexpected URL ${url}`)
  }
  const io = createBackendClients({
    fetchImpl,
    startService: async ({ distro, unit }) => {
      assert.equal(distro, 'Ubuntu')
      assert.equal(unit, 'hyperinkling.service')
      started = true
    },
    pollIntervalMs: 0,
  })
  await io.ensure('hyperinkling')
  assert.equal(sleeping, false)
  assert.deepEqual(calls.map(([url, method]) => [url.slice(url.lastIndexOf('/')), method]), [
    ['/is_sleeping', 'GET'], ['/is_sleeping', 'GET'], ['/is_sleeping', 'GET'],
    ['/wake_up', 'POST'], ['/is_sleeping', 'GET'],
  ])
})

test('HyperInkling level-1 sleep releases GPU weights and KV cache when switched away', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push([url, init.method ?? 'GET'])
    return { ok: true, json: async () => ({ status: 'sleeping' }) }
  }
  const io = createBackendClients({ fetchImpl })
  await io.unload('hyperinkling')
  assert.deepEqual(calls, [
    ['http://127.0.0.1:18023/sleep?level=1&mode=wait', 'POST'],
  ])
})
