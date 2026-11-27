import React from 'react'
import { mount } from './client-src.js'

export const name = 'dsh-server-tps'
export const inject = []

export function apply(ctx) {
  ctx.inject(['slots'], (clientCtx) => mount(React, clientCtx.slots))
}

export default apply
