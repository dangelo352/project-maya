import test from 'node:test'
import assert from 'node:assert/strict'
import { createContextHandler } from '../index.js'
import { apply as applyClient, findNamespace, readMayaValues, updateCompactionPatch, updateProviderPatch } from '../client-src.js'

const request = (method, body, headers = {}) => new Request('http://dsh.local/api/maya-live-settings', {
  method,
  headers: { host: 'dsh.local', ...(body === undefined ? {} : { origin: 'http://dsh.local', 'content-type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

test('context bridge reads the bounded context status from Maya', async () => {
  const handle = createContextHandler(async () => Response.json({ context: 200704, min: 4096, max: 262144 }))
  const response = await handle(request('GET'))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).context, 200704)
})

test('context update validates bounds and sends only max_context to Maya', async () => {
  const calls = []
  const handle = createContextHandler(async (url, init = {}) => {
    calls.push({ url, init })
    return calls.length === 1
      ? Response.json({ context: 200704, min: 4096, max: 262144 })
      : Response.json({ accepted: true, context: 131072 }, { status: 202 })
  })
  const response = await handle(request('POST', { context: 131072 }))
  assert.equal(response.status, 202)
  assert.deepEqual(JSON.parse(calls[1].init.body), { max_context: 131072 })
})

test('context bridge rejects cross-origin writes and invalid sizes', async () => {
  let calls = 0
  const handle = createContextHandler(async () => { calls += 1; return Response.json({}) })
  const cross = await handle(request('POST', { context: 8192 }, { origin: 'https://attacker.example' }))
  assert.equal(cross.status, 403)
  const invalid = await handle(request('POST', { context: 999999 }))
  assert.equal(invalid.status, 400)
  assert.equal(calls, 0)
})

test('Maya settings helpers preserve unrelated provider and compaction rows', () => {
  const llm = { revision: 1, value: { providers: { 'maya-local': { models: [{ id: 'inkling-2-mini', contextWindow: 200704, maxTokens: 32768 }, { id: 'other', maxTokens: 10 }] }, other: { keep: true } } } }
  const compaction = { revision: 2, value: { modelPolicies: [{ provider: 'maya-local', model: 'inkling-2-mini', thresholdRatio: 0.65, maxTokens: 4096 }, { provider: 'other', model: 'other', thresholdRatio: 0.7 }] } }
  assert.deepEqual(readMayaValues(llm, compaction), { context: 200704, maxTokens: 32768, compactPct: 65 })
  assert.deepEqual(readMayaValues(llm, null), { context: 200704, maxTokens: 32768, compactPct: null })
  assert.equal(updateProviderPatch(llm, { maxTokens: 20000 }).providers.other.keep, true)
  assert.equal(updateCompactionPatch(compaction, 75).modelPolicies[1].thresholdRatio, 0.7)
  assert.throws(() => findNamespace({ ok: true, value: { namespaces: [] } }, 'missing'))
})

test('client settings page obtains slots and remote settings through injection', () => {
  const injected = []
  let registration
  const slots = {
    inject: (slot, factory) => {
      assert.equal(slot, 'settings.section')
      registration = factory()
    },
    register: (definition, component) => ({ definition, component }),
  }
  const ctx = {
    inject: (services, callback) => {
      injected.push(services)
      callback({ slots, remote: { settings: { describe() {}, update() {} } } })
    },
  }

  applyClient(ctx)
  assert.deepEqual(injected, [['slots', 'remote', 'remote.settings']])
  assert.equal(registration.definition.id, 'maya-live-settings')
  assert.equal(registration.definition.name, 'settings.section')
  assert.equal(typeof registration.component, 'function')
})
