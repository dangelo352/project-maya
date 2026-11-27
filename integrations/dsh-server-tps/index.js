const ROUTE_PATH = '/api/dsh-server-tps'
const WINDOW_MS = 2000
const MAX_DELTAS = 8192
const PRUNE_INTERVAL_MS = 100

export const name = 'dsh-server-tps'
export const inject = ['llm', 'connection']

/** A bounded rolling counter. It stores only timestamps, never request or output content. */
export class StreamRateTracker {
  constructor({ now = Date.now, windowMs = WINDOW_MS, maxDeltas = MAX_DELTAS } = {}) {
    this.now = now
    this.windowMs = windowMs
    this.maxDeltas = maxDeltas
    this.timestamps = []
    this.activeStreams = 0
    this.lastPrune = 0
  }

  start() { this.activeStreams += 1 }

  finish() { this.activeStreams = Math.max(0, this.activeStreams - 1) }

  delta(nonEmpty) {
    if (!nonEmpty) return
    const at = this.now()
    if (at - this.lastPrune >= PRUNE_INTERVAL_MS) this.prune(at)
    if (this.timestamps.length >= this.maxDeltas) this.timestamps.shift()
    this.timestamps.push(at)
  }

  prune(at = this.now()) {
    const cutoff = at - this.windowMs
    let first = 0
    while (first < this.timestamps.length && this.timestamps[first] < cutoff) first += 1
    if (first) this.timestamps.splice(0, first)
    this.lastPrune = at
  }

  snapshot() {
    const at = this.now()
    this.prune(at)
    return {
      approx_tps: Math.round(this.timestamps.length * 1000 / this.windowMs * 10) / 10,
      active_streams: this.activeStreams,
      window_ms: this.windowMs,
      timestamp: at,
    }
  }
}

export function countOutputDelta(chunk) {
  if (!chunk || typeof chunk !== 'object') return false
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    return typeof chunk.text === 'string' && chunk.text.length > 0
  }
  if (chunk.type === 'tool-call-delta') {
    return typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta.length > 0
  }
  return false
}

export function trackStream(tracker, source) {
  return (async function* () {
    tracker.start()
    try {
      for await (const chunk of source) {
        tracker.delta(countOutputDelta(chunk))
        yield chunk
      }
    } finally {
      tracker.finish()
    }
  })()
}

export function createSnapshotHandler(tracker) {
  return async function handle(request) {
    const url = new URL(request.url)
    if (url.search || url.searchParams.size) return new Response('{"error":"query_not_supported"}', {
      status: 400, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
    return new Response(JSON.stringify(tracker.snapshot()), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

export function apply(ctx) {
  const tracker = new StreamRateTracker()
  ctx.on('llm/stream', (_options, next) => trackStream(tracker, next()))
  ctx.inject(['connection'], (connectionCtx) => {
    const fetchRegistry = connectionCtx.connection.fetch
    connectionCtx.effect(() => fetchRegistry.register({
      path: ROUTE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: createSnapshotHandler(tracker),
    }), 'dsh-server-tps: owner-only aggregate LLM stream rate')
  })
}

export default apply

export const constants = Object.freeze({ ROUTE_PATH, WINDOW_MS, MAX_DELTAS, PRUNE_INTERVAL_MS })
