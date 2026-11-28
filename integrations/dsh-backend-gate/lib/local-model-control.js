export const LOCAL_MODEL_ROUTE = '/api/dsh-local-model'
const BACKENDS = new Set(['all', 'qwen', 'maya', 'hyperinkling'])
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

function sameOrigin(request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() || request.headers.get('host') || new URL(request.url).host
  try {
    return Boolean(origin) && new URL(origin).host.toLowerCase() === host.toLowerCase()
      && request.headers.get('sec-fetch-site') !== 'cross-site'
  } catch { return false }
}

export function createLocalModelHandler(gate) {
  return async request => {
    if (new URL(request.url).search) return json({ ok: false, error: 'invalid_query' }, 400)
    if (request.method === 'GET') return json(await gate.localStatusSnapshot())
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
    if (!sameOrigin(request)) return json({ ok: false, error: 'same_origin_required' }, 403)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, error: 'json_required' }, 415)
    let body
    try {
      const text = await request.text()
      if (text.length > 1024) return json({ ok: false, error: 'request_too_large' }, 413)
      body = JSON.parse(text)
    } catch { return json({ ok: false, error: 'invalid_json' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['backend', 'sessionId'].includes(key))
      || (Object.hasOwn(body, 'backend') && typeof body.backend !== 'string')
      || !BACKENDS.has(body.backend ?? 'all')
      || (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || body.sessionId.length > 256)))
      return json({ ok: false, error: 'invalid_request' }, 400)
    try { return json(await gate.unloadIdle(body.backend ?? 'all', body.sessionId)) }
    catch (error) {
      const busy = error?.code === 'busy'
      return json({ ok: false, error: busy ? 'busy' : 'unload_failed', message: error?.message ?? String(error),
        activeRequests: gate.activeRequests, pendingRequests: gate.pendingRequests,
        transitioning: gate.transitioning, blockingSessionIds: [...gate.activeSessions.keys()] }, busy ? 409 : 502)
    }
  }
}
