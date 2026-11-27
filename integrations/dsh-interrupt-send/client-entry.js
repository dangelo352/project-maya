import React from 'react'
import { mount } from './client-src.js'

export const name = 'dsh-interrupt-send'
export const inject = ['slots', 'remote.session', 'sessions']

export function apply(ctx) {
  ctx.inject(['slots', 'remote.session', 'sessions'], clientCtx => {
    mount(React, clientCtx.slots, clientCtx.remote.session, clientCtx.sessions)
  })
}

export default apply
