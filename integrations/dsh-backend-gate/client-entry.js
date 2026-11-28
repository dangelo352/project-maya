import React from 'react'
import { mount } from './client-src.js'
import { mountUnload } from './unload-client.js'

export const name = 'maya-model-switch-card'
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
    mount(React, clientCtx.slots, sessionActions, fetch, clientCtx.sessions)
    mountUnload(React, clientCtx.slots, fetch)
  })
}

export default apply
