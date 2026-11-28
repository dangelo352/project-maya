import test from 'node:test'
import assert from 'node:assert/strict'
import { canStopForSwitch, statusUrl, observedSnapshot, prefillView } from '../client-src.js'

test('client status polling stays scoped to the composer session', () => {
  assert.equal(statusUrl('session / one'), '/api/dsh-model-switch-status?sessionId=session%20%2F%20one')
})

test('interrupt is offered only for the matching session while active work blocks a switch', () => {
  const status = {
    sessionId: 'selected-session',
    phase: 'waiting-for-active-request',
    blockingSessionIds: ['running-session'],
  }
  assert.equal(canStopForSwitch(status, 'selected-session'), true)
  assert.equal(canStopForSwitch(status, 'other-session'), false)
  assert.equal(canStopForSwitch({ ...status, phase: 'loading' }, 'selected-session'), false)
  assert.equal(canStopForSwitch({ ...status, blockingSessionIds: [] }, 'selected-session'), false)
})


test('shared fallback retains backend activity but never copies another session controls', () => {
  const backendStatus = { state: 'ready', activity: { state: 'reading', prompt_read: 25, prompt_total: 100, prefill_tok_s_mean: 5 } }
  const observed = observedSnapshot({ sessionId: 'other', backend: 'maya', model: 'Inkling', backendStatus,
    phase: 'waiting-for-active-request', blockingSessionIds: ['other'], error: 'private session error' }, 'current', null, 100)
  assert.equal(observed.backendStatus, backendStatus)
  assert.equal(observed.sessionId, 'current')
  assert.equal(observed.observed, true)
  assert.equal(observed.backend, 'maya')
  assert.equal(observed.model, 'Inkling')
  assert.equal(observed.phase, 'serving')
  assert.equal(observed.blockingSessionIds, undefined)
  assert.equal(observed.error, undefined)
  assert.equal(canStopForSwitch(observed, 'current'), false)
  assert.match(prefillView(observed).title, /shared across sessions/)
})

test('matching status is preserved and missing observations never invent progress', () => {
  const data = { sessionId: 'current', phase: 'loading' }
  assert.equal(observedSnapshot(data, 'current', null), data)
  const empty = observedSnapshot(null, 'current', { state: 'unavailable' }, 100)
  assert.equal(empty.phase, 'status-unavailable')
  assert.equal(prefillView(empty), null)
})


test('shared fallback does not label an unloaded or failed backend as serving', () => {
  for (const state of ['unloaded', 'parked', 'sleeping', 'error']) {
    const view = observedSnapshot({ sessionId: 'other', backendStatus: { state } }, 'current', { state: 'live', tps: 99 })
    assert.equal(view.phase, 'status-unavailable')
    assert.equal(view.backendStatus.state, state)
  }
  assert.equal(observedSnapshot({ sessionId: 'other', backendStatus: { state: 'loading' } }, 'current', null).phase, 'loading')
})
