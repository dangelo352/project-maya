import test from 'node:test'
import assert from 'node:assert/strict'
import { createBackendClients, summarizeBackendStatus } from '../lib/index.js'
import { mount, prefillView } from '../client-src.js'

const live = (extra = {}) => ({ state: 'reading', prompt_read: 6144, prompt_total: 10000,
  prompt_reused: 4096, prefill_tok_s_mean: 1024, ...extra })
const snapshot = (activity = live(), extra = {}) => ({ sessionId: 'current', backend: 'maya',
  model: 'Inkling', phase: 'serving', observed: true, startedAt: 100,
  backendStatus: { state: 'ready', activity }, ...extra })
const response = data => ({ ok: true, json: async () => data })

test('Maya health and metrics run concurrently and expose only sanitized live activity', async () => {
  const calls = []
  let finishHealth
  const health = new Promise(resolve => { finishHealth = () => resolve(response({ status: 'ok', model: 'Inkling' })) })
  const clients = createBackendClients({ fetchImpl: async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/health')) return health
    if (url.endsWith('/metrics')) return response({ live: { ...live(), prompt: 'secret', history: ['secret'] },
      history: ['private'], tail: 'private log' })
    throw Error(`unexpected ${url}`)
  } })
  const pending = clients.status('maya', 1000)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(([url]) => url.split('/').at(-1)), ['health', 'metrics'])
  assert.ok(calls.every(([, options]) => options.signal instanceof AbortSignal && !options.method))
  finishHealth()
  const result = await pending
  assert.deepEqual(result, { status: 'ok', model: 'Inkling', activity: live() })
  const summary = summarizeBackendStatus('maya', result)
  assert.equal(summary.state, 'ready')
  assert.deepEqual(summary.activity, live())
  assert.equal(JSON.stringify(summary).includes('secret'), false)
  assert.equal(JSON.stringify(summary).includes('private'), false)
})

test('unavailable or malformed Maya metrics preserve health without inventing activity', async () => {
  for (const metrics of [null, {}, { live: {} }, { live: { state: 'bogus' } }, new Error('offline')]) {
    const clients = createBackendClients({ fetchImpl: async url => {
      if (url.endsWith('/health')) return response({ status: 'ok' })
      if (metrics instanceof Error) throw metrics
      return response(metrics)
    } })
    assert.deepEqual(await clients.status('maya', 1000), { status: 'ok' })
  }
  const clients = createBackendClients({ fetchImpl: async url => {
    if (url.endsWith('/health')) throw Error('health offline')
    return response({ live: live() })
  } })
  await assert.rejects(clients.status('maya', 1000), /health offline/)
})

test('Maya summary drops arbitrary fields and invalid numeric readings; other backend summaries stay intact', () => {
  const summary = summarizeBackendStatus('maya', { status: 'ok', live: live({
    prompt_read: '100', prompt_total: -1, prompt_reused: Infinity, prefill_tok_s_mean: NaN, tail: 'secret',
  }) })
  assert.deepEqual(summary.activity, { state: 'reading', prompt_read: null, prompt_total: null,
    prompt_reused: null, prefill_tok_s_mean: null })
  assert.equal(summarizeBackendStatus('qwen', { parked_model: 'Qwen' }).state, 'parked')
  assert.deepEqual(summarizeBackendStatus('hyperinkling', { sleeping: true }), { state: 'sleeping' })
})

test('prefill uses actual processed/total and remaining measured rate without subtracting reuse twice', () => {
  const view = prefillView(snapshot())
  assert.equal(view.processed, 6144)
  assert.equal(view.total, 10000)
  assert.equal(view.percent, 61.44)
  assert.equal(view.etaSeconds, 4)
  assert.equal(view.label, 'Prefill 6K / 10K - ETA 4s')
  assert.equal(prefillView(snapshot(live({ prompt_read: 0 }))).percent, 0)
  assert.equal(prefillView(snapshot(live({ prompt_read: 10000 }))).percent, 100)
})

test('unknown, nonpositive or invalid rates never produce ETA', () => {
  for (const rate of [null, undefined, 0, -1, NaN, Infinity, '1024']) {
    const view = prefillView(snapshot(live({ prefill_tok_s_mean: rate })))
    assert.equal(view.etaSeconds, null)
    assert.equal(view.percent, 61.44)
    assert.doesNotMatch(view.label, /ETA/)
  }
})

test('invalid counts never produce a percentage or ETA; idle/generating/stale samples are not prefill', () => {
  for (const extra of [{ prompt_read: -1 }, { prompt_read: null }, { prompt_read: '10' },
    { prompt_read: 10001 }, { prompt_total: 0 }, { prompt_total: NaN }, { prompt_total: Infinity }]) {
    const view = prefillView(snapshot(live(extra)))
    assert.equal(view.percent, null)
    assert.equal(view.etaSeconds, null)
    assert.match(view.label, /progress unavailable/)
    assert.doesNotMatch(view.label, /ETA/)
  }
  for (const state of ['idle', 'generating', 'unknown']) assert.equal(prefillView(snapshot(live({ state }))), null)
  assert.equal(prefillView(snapshot(live(), { statusUnavailable: true })), null)
})

// Hook host renders the actual component without a browser, bundle, or server.
function host(fetchImpl, running = true) {
  let component, cursor = 0
  const values = [], effects = [], cleanups = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const i = cursor++
      if (!(i in values)) values[i] = initial
      return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value }]
    },
    useEffect(effect, deps) {
      const i = cursor++
      if (!values[i] || deps.some((value, j) => value !== values[i][j])) {
        values[i] = deps
        effects.push(() => { cleanups[i]?.(); cleanups[i] = effect() })
      }
    },
  }
  mount(React, { inject: (_, register) => register(), register: (_, value) => { component = value } }, {}, fetchImpl)
  return {
    render(nextRunning = running) {
      running = nextRunning
      cursor = 0
      const tree = component({ sessionId: 'current', useSession: selector => selector({ running }) })
      effects.splice(0).forEach(run => run())
      return tree
    },
    cleanup() { cleanups.forEach(cleanup => cleanup?.()) },
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

for (const globalFallback of [false, true]) test(`rendered prefill overrides TPS with a real progressbar (global fallback: ${globalFallback})`, async () => {
  const calls = []
  const ui = host(async (url, options) => {
    calls.push([url, options])
    if (url === '/api/dsh-server-tps') return response({ state: 'live', tps: 99 })
    if (url.includes('?')) return response(globalFallback ? null : snapshot())
    return response(snapshot(live(), { sessionId: 'other' }))
  })
  try {
    ui.render(); await settle()
    const tree = ui.render()
    assert.equal(tree.props['data-maya-model-switch'], 'prefill')
    const bar = tree.children.find(child => child?.props?.role === 'progressbar')
    assert.equal(bar.props['aria-valuemin'], 0)
    assert.equal(bar.props['aria-valuemax'], 10000)
    assert.equal(bar.props['aria-valuenow'], 6144)
    assert.match(bar.props['aria-label'], /shared engine/)
    assert.equal(bar.children[0].props.style.width, '61.44%')
    assert.equal(bar.children[0].props.style.animation, undefined)
    const label = tree.children.find(child => child?.type === 'span' && child.props.role !== 'progressbar')
    assert.match(label.children[0], /Prefill 6K \/ 10K - ETA 4s/)
    assert.doesNotMatch(label.children[0], /99|generating|shared engine/)
    assert.match(tree.props.title, /6144 \/ 10000 tokens/)
    assert.match(tree.props.title, /shared across sessions/)
    assert.equal(bar.props['aria-valuetext'], '6144 / 10000 tokens')
    assert.equal(calls.some(([url]) => url === '/api/dsh-model-switch-status'), globalFallback)
    assert.ok(calls.every(([, options]) => options.cache === 'no-store'))
  } finally { ui.cleanup() }
})

test('rendered reading state with missing totals suppresses TPS without fake progress or ETA', async () => {
  const ui = host(async url => response(url === '/api/dsh-server-tps'
    ? { state: 'live', tps: 99 } : snapshot(live({ prompt_total: null }))))
  try {
    ui.render(); await settle()
    const tree = ui.render()
    assert.equal(tree.props['data-maya-model-switch'], 'prefill')
    assert.equal(tree.children.some(child => child?.props?.role === 'progressbar'), false)
    const label = tree.children.find(child => child?.type === 'span')
    assert.match(label.children[0], /Prefill - progress unavailable/)
    assert.doesNotMatch(label.children[0], /ETA|generating/)
  } finally { ui.cleanup() }
})


test('large prefill label is compact while counts and ETA remain real', () => {
  const view = prefillView(snapshot(live({ prompt_read: 34000, prompt_total: 95000, prefill_tok_s_mean: 1000 })))
  assert.equal(view.label, 'Prefill 34K / 95K - ETA 1m 1s')
  assert.equal(view.processed, 34000)
  assert.equal(view.total, 95000)
  assert.match(view.title, /34000 \/ 95000 tokens/)
  assert.match(view.title, /shared across sessions/)
  assert.equal(prefillView(snapshot(live({ prompt_read: 25, prompt_total: 100 }))).label, 'Prefill 25 / 100 - ETA 1s')
})

for (const globalFallback of [false, true]) test(`idle chats hide shared prefill and stopping hides it immediately (global fallback: ${globalFallback})`, async () => {
  const ui = host(async url => {
    if (url === '/api/dsh-server-tps') return response({ state: 'live', tps: 99 })
    if (url.includes('?')) return response(globalFallback ? null : snapshot())
    return response(snapshot(live(), { sessionId: 'other' }))
  }, false)
  try {
    ui.render(); await settle()
    assert.equal(ui.render(), null)
    assert.equal(ui.render(true).props['data-maya-model-switch'], 'prefill')
    assert.equal(ui.render(false), null)
  } finally { ui.cleanup() }
})

for (const state of ['idle', 'unknown', undefined]) test(`ready waiting copy replaces misleading token message (activity: ${state})`, async () => {
  const ui = host(async url => response(url === '/api/dsh-server-tps'
    ? (state ? { state: 'live', tps: 99 } : { state: 'unavailable' })
    : snapshot(state ? live({ state }) : null)))
  try {
    ui.render(); await settle()
    const tree = ui.render()
    const label = tree.children.find(child => child?.type === 'span')
    assert.equal(label.children[0], 'Model ready - waiting for generation')
  } finally { ui.cleanup() }
})


for (const activity of [live({ state: 'generating' }), null]) test(`real decode TPS still displays (activity: ${activity?.state || 'unavailable'})`, async () => {
  const ui = host(async url => response(url === '/api/dsh-server-tps'
    ? { state: 'live', tps: 162 } : snapshot(activity)))
  try {
    ui.render(); await settle()
    const tree = ui.render()
    const label = tree.children.find(child => child?.type === 'span')
    assert.equal(label.children[0], 'Engine generating - 162.0 tokens/sec')
    assert.match(tree.props.title, /shared across sessions/)
    assert.equal(tree.children.some(child => child?.props?.role === 'progressbar'), false)
  } finally { ui.cleanup() }
})
