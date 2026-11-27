import test from 'node:test'
import assert from 'node:assert/strict'
import { canStopForSwitch, statusUrl } from '../client-src.js'

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
