import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mountUnload, requestLocalModels, unloadView, unloadSlot, pollIntervalMs, noticeDurationMs } from '../unload-client.js'

const snapshot = (state = 'ready', extra = {}) => ({ ok: true, activeRequests: 0, pendingRequests: 0,
  transitioning: false, unload: { phase: 'idle' }, currentBackend: 'qwen', csrfToken: 'test-nonce',
  backends: [{ backend: 'qwen', state, model: 'Qwen' }], ...extra })
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })

test('read-only status and explicit all-local unload use same-origin route and optional session', async () => {
  const calls = []
  const fetchImpl = async (...args) => { calls.push(args); return response({ ok: true, status: 'unloaded' }) }
  const controller = new AbortController()
  await requestLocalModels(fetchImpl, { signal: controller.signal })
  await requestLocalModels(fetchImpl, { unload: true, sessionId: 'session / one', csrfToken: 'passed-nonce' })
  await requestLocalModels(fetchImpl, { unload: true, csrfToken: 'passed-nonce' })
  assert.equal(calls[0][0], '/api/dsh-local-model')
  assert.equal(calls[0][1].method, 'GET')
  assert.equal(calls[0][1].body, undefined)
  assert.equal(calls[0][1].signal, controller.signal)
  assert.equal(calls[0][1].cache, 'no-store')
  assert.equal(calls[1][1].credentials, 'same-origin')
  assert.equal(calls[1][1].method, 'POST')
  assert.equal(calls[1][1].headers['Content-Type'], 'application/json')
  assert.equal(calls[1][1].headers['x-dsh-csrf-token'], 'passed-nonce')
  // Electron may omit Origin; browsers manage it themselves. Never force forbidden headers.
  for (const [, options] of calls) {
    assert.equal(Object.keys(options.headers || {}).some(name => ['origin', 'host', 'sec-fetch-site'].includes(name.toLowerCase())), false)
  }
  assert.deepEqual(JSON.parse(calls[1][1].body), { backend: 'all', sessionId: 'session / one' })
  assert.deepEqual(JSON.parse(calls[2][1].body), { backend: 'all' })
})

test('idle sessions still expose ready action; all actual backend states are labeled', () => {
  for (const state of ['ready', 'loading', 'sleeping', 'unknown', 'error']) {
    const view = unloadView(snapshot(state))
    assert.equal(view.visible, true)
    assert.equal(view.disabled, false)
    assert.match(view.label, new RegExp(`Qwen: ${state}`))
    assert.match(view.title, /requests and goals may reload/)
  }
  for (const state of ['offline', 'unloaded']) assert.equal(unloadView(snapshot(state)).visible, false)
  assert.equal(unloadView(snapshot('ready', { backends: [{ backend: 'cloud', state: 'ready' }] })).visible, false)
})

test('active, pending, transitioning and unloading disable control without canceling work', () => {
  for (const extra of [{ activeRequests: 1 }, { pendingRequests: 1 }, { backendBusy: true }, { transitioning: true }, { unload: { phase: 'unloading' } }]) {
    const view = unloadView(snapshot('ready', extra))
    assert.equal(view.disabled, true)
    assert.equal(view.busy, true)
  }
  assert.equal(unloadView(snapshot(), { inFlight: true }).disabled, true)
  assert.equal(unloadView(snapshot('ready', { backendBusy: false })).disabled, false)
  assert.equal(unloadView(snapshot(), { locked: true }).disabled, true)
  assert.equal(unloadView(null).disabled, true)
  assert.equal(unloadView(snapshot(), { statusError: 'Connection lost' }).disabled, true)
})

test('manual success/error stays visible briefly; fresh backend state supersedes success', () => {
  const notice = { kind: 'success', at: 100 }
  const view = unloadView(snapshot('unloaded'), { notice, now: 101 })
  assert.equal(view.visible, true)
  assert.equal(view.label, 'Model unloaded · next request reloads')
  assert.equal(view.disabled, true)
  assert.equal(unloadView(snapshot(), { notice, now: 101 }).label, 'Qwen: ready')
  assert.equal(unloadView(snapshot('unloaded'), { notice, now: 100 + noticeDurationMs }).visible, false)
  const failure = unloadView(snapshot('offline'), { notice: { kind: 'error', message: 'Busy; retry', at: 100 }, now: 101 })
  assert.equal(failure.visible, true)
  assert.match(failure.label, /Busy; retry/)
  assert.equal(failure.error, true)
  assert.match(unloadView(snapshot('ready', { unload: { phase: 'error', error: 'Backend failed' } })).label, /Backend failed/)
})

test('409, 502, malformed responses and network errors never become success', async () => {
  for (const [status, data, expected] of [
    [409, { ok: false, error: 'busy', message: 'Active request' }, /busy.*Active request/],
    [502, { ok: false, message: 'Qwen unavailable' }, /Qwen unavailable/],
    [200, { ok: true }, /did not confirm/],
  ]) await assert.rejects(requestLocalModels(async () => response(data, status), { unload: true, csrfToken: 'test-nonce' }), expected)
  await assert.rejects(requestLocalModels(async () => ({ ok: false, status: 502, json: async () => { throw Error() } })), /HTTP 502/)
  await assert.rejects(requestLocalModels(async () => { throw Error('Network down') }), /Network down/)
  assert.equal((await requestLocalModels(async () => response({ ok: true, status: 'already_idle' }), { unload: true, csrfToken: 'test-nonce' })).status, 'already_idle')
})

test('missing cached nonce fetches read-only status before POST, preserving signal and session', async () => {
  const calls = []
  const controller = new AbortController()
  const result = await requestLocalModels(async (_, options) => {
    calls.push(options)
    return response(options.method === 'GET' ? snapshot() : { ok: true, status: 'unloaded' })
  }, { unload: true, sessionId: 'desktop-session', signal: controller.signal })
  assert.equal(result.status, 'unloaded')
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST'])
  assert.equal(calls[1].headers['x-dsh-csrf-token'], 'test-nonce')
  assert.equal(calls[1].headers.Origin, undefined)
  assert.equal(calls[1].signal, controller.signal)
  assert.equal(JSON.parse(calls[1].body).sessionId, 'desktop-session')
})

test('missing nonce in fresh status fails without dispatching POST', async () => {
  for (const csrfToken of [undefined, null, '', '  ', 123]) {
    const methods = []
    await assert.rejects(requestLocalModels(async (_, options) => {
      methods.push(options.method)
      return response(snapshot('ready', { csrfToken }))
    }, { unload: true }), /did not provide a CSRF token/)
    assert.deepEqual(methods, ['GET'])
  }
})

test('stale nonce rejection refreshes token and retries once only', async () => {
  for (const rejectAgain of [false, true]) {
    const calls = []
    const request = requestLocalModels(async (_, options) => {
      calls.push({ ...options, headers: { ...options.headers } })
      if (options.method === 'GET') return response(snapshot('ready', { csrfToken: 'fresh-nonce' }))
      if (calls.length === 1 || rejectAgain) return response({ ok: false, error: 'csrf_token_required' }, 403)
      return response({ ok: true, status: 'unloaded' })
    }, { unload: true, csrfToken: 'stale-nonce', sessionId: 'same-session' })
    if (rejectAgain) await assert.rejects(request, /csrf_token_required/)
    else assert.equal((await request).status, 'unloaded')
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'POST'])
    assert.equal(calls[0].headers['x-dsh-csrf-token'], 'stale-nonce')
    assert.equal(calls[2].headers['x-dsh-csrf-token'], 'fresh-nonce')
    assert.equal(calls[0].body, calls[2].body)
  }
})

test('failed token refresh after rejection never dispatches another POST', async () => {
  const methods = []
  await assert.rejects(requestLocalModels(async (_, options) => {
    methods.push(options.method)
    return options.method === 'POST' ? response({ ok: false, error: 'csrf_token_required' }, 403)
      : response({ ok: true })
  }, { unload: true, csrfToken: 'stale-nonce' }), /did not provide a CSRF token/)
  assert.deepEqual(methods, ['POST', 'GET'])
})

test('busy, foreign-origin, 502, malformed and network failures never retry unload', async () => {
  const failures = [
    () => response({ ok: false, error: 'busy' }, 409),
    () => response({ ok: false, error: 'same_origin_required' }, 403),
    () => response({ ok: false, error: 'csrf_token_required' }, 502),
    () => response({ ok: false, message: 'Backend failed' }, 502),
    () => ({ ok: false, status: 403, json: async () => { throw Error('Invalid JSON') } }),
    () => response({ ok: true }),
    () => { throw Error('Network down') },
  ]
  for (const failure of failures) {
    const methods = []
    await assert.rejects(requestLocalModels(async (_, options) => {
      methods.push(options.method)
      return failure()
    }, { unload: true, csrfToken: 'cached-nonce' }))
    assert.deepEqual(methods, ['POST'])
  }
})

// Minimal hook host: exercises the registered component, effects and event handler without a live DSH/server.
function host(fetchImpl, sessionId = 'composer-session', owner = {}) {
  let component, cursor = 0
  const values = [], effects = [], cleanups = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const i = cursor++
      if (!(i in values)) values[i] = initial
      return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }]
    },
    useRef(initial) { const i = cursor++; return values[i] ||= { current: initial } },
    useEffect(effect, deps) {
      const i = cursor++
      if (!values[i] || deps.some((value, j) => value !== values[i][j])) {
        values[i] = deps
        effects.push(() => { cleanups[i]?.(); cleanups[i] = effect() })
      }
    },
  }
  mountUnload(React, {
    inject: (name, register) => { assert.equal(name, 'conversation.input.model.options'); register() },
    register: (options, value) => { assert.equal(options.name, unloadSlot); component = value },
  }, fetchImpl)
  return {
    render() { cursor = 0; const tree = component({ sessionId, useSession: selector => selector({ sessionId: 'bound-session' }), ...owner }); effects.splice(0).forEach(run => run()); return tree },
    cleanup() { cleanups.forEach(cleanup => cleanup?.()) },
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('component polls, unloads only on click, suppresses duplicate clicks, and cleans up', async () => {
  const calls = []
  let complete
  let current = snapshot()
  const ui = host(async (url, options) => {
    calls.push({ url, ...options })
    if (options.method === 'POST') return new Promise(resolve => { complete = () => { current = snapshot('unloaded'); resolve(response({ ok: true, status: 'unloaded' })) } })
    return response(current)
  }, undefined)
  try {
    ui.render(); await settle()
    assert.equal(calls.length, 1)
    const tree = ui.render()
    const button = tree.children[0]
    assert.equal(button.props.role, 'menuitem')
    assert.equal(button.props.disabled, false)
    assert.match(button.props['aria-label'], /all local GPU/)
    const pending = button.props.onClick()
    await button.props.onClick()
    assert.equal(calls.filter(call => call.method === 'POST').length, 1)
    assert.equal(calls.find(call => call.method === 'POST').headers['x-dsh-csrf-token'], 'test-nonce')
    assert.deepEqual(calls.map(call => call.method), ['GET', 'POST'])
    assert.equal(ui.render().props['aria-busy'], true)
    complete(); await pending; await settle()
    assert.equal(ui.render().children[1].children[0], 'Model unloaded · next request reloads')
    assert.equal(pollIntervalMs, 4000)
  } finally { ui.cleanup() }
  assert.equal(calls.at(-1).signal.aborted, true)
})

test('component shows POST errors and uses session hook when prop absent', async () => {
  let post
  const failures = []
  const ui = host(async (_, options) => {
    if (options.method === 'POST') { post = JSON.parse(options.body); return response({ ok: false, error: 'busy', message: 'Try after request' }, 409) }
    return response(snapshot())
  }, null, { reportFailure: message => failures.push(message) })
  try {
    ui.render(); await settle()
    await ui.render().children[0].props.onClick(); await settle()
    assert.deepEqual(post, { backend: 'all', sessionId: 'bound-session' })
    assert.match(ui.render().children[1].children[0], /busy.*Try after request/)
    assert.deepEqual(failures, ['Local models are busy. Try after request'])
  } finally { ui.cleanup() }
})

test('native menu lock prevents unload even when backend is ready and idle', async () => {
  const calls = []
  const ui = host(async (_, options) => { calls.push(options.method); return response(snapshot()) }, 'menu-session', { locked: true })
  try {
    ui.render(); await settle()
    const button = ui.render().children[0]
    assert.equal(button.props.disabled, true)
    await button.props.onClick()
    assert.deepEqual(calls, ['GET'])
  } finally { ui.cleanup() }
})

test('unmount aborts pending GET without issuing unload', async () => {
  let options
  const ui = host(async (_, value) => { options = value; return new Promise(() => {}) })
  ui.render(); ui.cleanup()
  assert.equal(options.method, 'GET')
  assert.equal(options.signal.aborted, true)
})

test('React bundle registers both native slots without changing tracked output', () => {
  const output = new URL('../lib/client.js', import.meta.url)
  const before = readFileSync(output)
  const result = execFileSync(process.execPath, ['scripts/bundle-client.mjs', '--check'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  assert.match(result, /smoke-checked composer card and model-menu slot/)
  assert.deepEqual(readFileSync(output), before)
})
