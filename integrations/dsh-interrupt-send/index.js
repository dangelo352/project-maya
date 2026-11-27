/**
 * Client-only composer extension. The bundle entry is kept deliberately inert;
 * the browser half uses DSH's public Session cancel and composer submit APIs.
 */
export const name = 'dsh-interrupt-send'
export const inject = []
export function apply() {}
export default apply
