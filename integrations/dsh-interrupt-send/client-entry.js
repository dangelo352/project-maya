import React from 'react'
import { mount } from './client-src.js'

export const name = 'dsh-interrupt-send'
export const inject = []

export function apply(ctx) {
  ctx.inject(['slots', 'sessions'], clientCtx => {
    const sessionActions = {
      cancel: ({ sessionId }) => {
        const session = clientCtx.sessions.binding(sessionId)?.session
        if (!session) throw new Error('The selected DSH session is no longer available.')
        return session.cancel()
      },
    }
    mount(React, clientCtx.slots, sessionActions, clientCtx.sessions)
  })
}

export default apply
