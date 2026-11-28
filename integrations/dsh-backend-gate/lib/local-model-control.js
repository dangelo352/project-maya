export const LOCAL_MODEL_ROUTE = '/api/dsh-local-model'
const BACKENDS = new Set(['all', 'qwen', 'maya', 'hyperinkling'])
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

function sameOrigin(request) {
  const origin = request.headers.get('origin')
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  // Electron verifies the renderer, then deliberately removes Origin when it
  // forwards dsh-app://app requests with its private Host cookie. The separate
  // synchronizer token below authenticates the action in this missing-header case.
  if (!origin) return true
  const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() || request.headers.get('host') || new URL(request.url).host
  try {
    const parsed = new URL(origin)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host.toLowerCase() === host.toLowerCase()
  } catch { return false }
}

export function createLocalModelHandler(gate, { csrfToken = randomBytes(32).toString('base64url') } = {}) {
  const expected = Buffer.from(csrfToken)
  const validToken = request => {
    const supplied = Buffer.from(request.headers.get('x-dsh-csrf-token') ?? '')
    return supplied.length === expected.length && timingSafeEqual(supplied, expected)
  }
  return async request => {
    if (new URL(request.url).search) return json({ ok: false, error: 'invalid_query' }, 400)
    if (request.method === 'GET') return json({ ...await gate.localStatusSnapshot(), csrfToken })
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
    if (!sameOrigin(request)) return json({ ok: false, error: 'same_origin_required' }, 403)
    if (!validToken(request)) return json({ ok: false, error: 'csrf_token_required', message: 'Refresh model status before unloading.' }, 403)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, error: 'json_required' }, 415)
    let body
    try {
      const text = await request.text()
      if (text.length > 1024) return json({ ok: false, error: 'request_too_large' }, 413)
      body = JSON.parse(text)
    } catch { return json({ ok: false, error: 'invalid_json' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['backend', 'sessionId', 'mode'].includes(key))
      || (Object.hasOwn(body, 'backend') && typeof body.backend !== 'string')
      || !BACKENDS.has(body.backend ?? 'all')
      || (Object.hasOwn(body, 'mode') && !['normal', 'full'].includes(body.mode))
      || (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || body.sessionId.length > 256)))
      return json({ ok: false, error: 'invalid_request' }, 400)
    try { return json(await gate.unloadIdle(body.backend ?? 'all', body.sessionId, body.mode ?? 'normal')) }
    catch (error) {
      const busy = error?.code === 'busy'
      return json({ ok: false, error: busy ? 'busy' : 'unload_failed', message: error?.message ?? String(error),
        activeRequests: gate.activeRequests, pendingRequests: gate.pendingRequests,
        transitioning: gate.transitioning, blockingSessionIds: [...gate.activeSessions.keys()] }, busy ? 409 : 502)
    }
  }
}
import { randomBytes, timingSafeEqual } from 'node:crypto'
