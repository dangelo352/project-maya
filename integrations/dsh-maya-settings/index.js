const ROUTE_PATH = '/api/maya-live-settings'
const MAYA_CONTEXT_URL = 'http://127.0.0.1:18022/api/context'

export const name = 'maya-live-settings'
export const inject = ['connection']

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

function sameHostOrigin(request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  let parsed
  try { parsed = new URL(origin) } catch { return false }
  const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim()
    || request.headers.get('host')
  if (!host || parsed.host.toLowerCase() !== host.toLowerCase()) return false
  return request.headers.get('sec-fetch-site') !== 'cross-site'
}

export function createContextHandler(fetchImpl = fetch) {
  return async function handle(request) {
    const url = new URL(request.url)
    if (url.search || url.searchParams.size) return json({ error: 'query_not_supported' }, 400)
    if (request.method === 'GET') {
      const [contextResult, healthResult] = await Promise.allSettled([
        fetchImpl(MAYA_CONTEXT_URL, { signal: AbortSignal.timeout(5000) }),
        fetchImpl('http://127.0.0.1:18022/health', { signal: AbortSignal.timeout(5000) }),
      ])
      let context = null
      let contextBounds = { min: 4096, max: 262144 }
      if (contextResult.status === 'fulfilled' && contextResult.value.ok) {
        const data = await contextResult.value.json()
        context = data.context ?? null
        contextBounds = { min: data.min ?? contextBounds.min, max: data.max ?? contextBounds.max }
      }
      let server = { status: 'offline' }
      if (healthResult.status === 'fulfilled' && healthResult.value.ok) {
        const health = await healthResult.value.json()
        server = {
          status: health.status ?? 'unknown',
          model: health.model ?? null,
          version: health.version ?? null,
          maxContext: health.max_context ?? null,
          images: health.images === true,
          videos: health.videos === true,
          unloaded: health.unloaded === true,
        }
        if (context === null) context = health.max_context ?? null
      }
      return json({ context, ...contextBounds, server })
    }
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
    if (!sameHostOrigin(request)) return json({ error: 'same_origin_required' }, 403)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json({ error: 'json_required' }, 415)
    }

    let body
    try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
    const context = body?.context
    if (!Number.isSafeInteger(context) || context < 4096 || context > 262144) {
      return json({ error: 'context_out_of_range', min: 4096, max: 262144 }, 400)
    }

    try {
      const currentResponse = await fetchImpl(MAYA_CONTEXT_URL, { signal: AbortSignal.timeout(5000) })
      if (!currentResponse.ok) return json({ error: 'maya_context_unavailable', status: currentResponse.status }, 502)
      const current = await currentResponse.json()
      if (context < current.min || context > current.max) {
        return json({ error: 'context_out_of_range', min: current.min, max: current.max, current: current.context }, 400)
      }
      const response = await fetchImpl(MAYA_CONTEXT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ max_context: context }),
        signal: AbortSignal.timeout(10000),
      })
      const data = await response.json().catch(() => ({}))
      return json(data, response.status)
    } catch {
      return json({ error: 'maya_context_unavailable' }, 502)
    }
  }
}

export function apply(ctx) {
  ctx.inject(['connection'], (connectionCtx) => {
    const registry = connectionCtx.connection.fetch
    connectionCtx.effect(() => registry.register({
      path: ROUTE_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: createContextHandler(),
    }), 'Maya live context controls (same-origin only)')
  })
}

export default apply
