const ROUTE_PATH = '/api/dsh-server-tps'
const WINDOW_MS = 2000
const REQUEST_TIMEOUT_MS = 750

export const name = 'dsh-server-tps'
export const inject = ['connection']

// These are the local model servers installed in the desktop profile. Each
// vLLM exposes continuously updated cumulative output counters; Maya exposes
// a native live decode gauge. Neither counts arbitrary transport chunks.
export const METRIC_SOURCES = Object.freeze([
  { name: 'qwen', url: 'http://127.0.0.1:18020/metrics', kind: 'vllm' },
  { name: 'maya', url: 'http://127.0.0.1:18022/metrics', kind: 'maya-live' },
  { name: 'inkling', url: 'http://127.0.0.1:18023/metrics', kind: 'vllm' },
])

export function parseGeneratedTokens(text, kind) {
  if (typeof text !== 'string') return null
  const wanted = kind === 'maya'
    ? /^llamacpp:tokens_predicted_total(?:\{[^}]*\})?\s+([\d.eE+-]+)$/
    : /^vllm:generation_tokens_total(?:\{[^}]*\})?\s+([\d.eE+-]+)$/
  let total = 0
  let found = false
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(wanted)
    if (!match) continue
    const value = Number(match[1])
    if (!Number.isFinite(value) || value < 0) continue
    total += value
    found = true
  }
  return found ? total : null
}

// Maya's Prometheus output total is committed on request completion, so its
// delta is a burst, not live decode throughput. Use the engine's decode window.
export function parseMayaRate(metrics) {
  const live = metrics?.live
  if (!live || !['reading', 'generating', 'idle', 'unloaded'].includes(live.state)) return null
  if (live.state !== 'generating') return 0
  return typeof live.tok_s === 'number' && Number.isFinite(live.tok_s) && live.tok_s >= 0
    ? live.tok_s : null
}

/** Reports native live output rates, using counter windows where supported. */
export class EngineTokenRate {
  constructor({
    sources = METRIC_SOURCES,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    windowMs = WINDOW_MS,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
  } = {}) {
    this.sources = sources
    this.fetchImpl = fetchImpl
    this.now = now
    this.windowMs = windowMs
    this.requestTimeoutMs = requestTimeoutMs
    this.lastBySource = new Map()
    this.intervals = []
    this.lastSampleAt = null
    this.cachedSnapshot = null
    this.samplePromise = null
  }

  async readSource(source) {
    try {
      const response = await this.fetchImpl(source.url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      })
      if (!response.ok) return null
      if (source.kind === 'maya-live') return parseMayaRate(await response.json())
      return parseGeneratedTokens(await response.text(), source.kind)
    } catch {
      return null
    }
  }

  async snapshot() {
    const at = this.now()
    if (this.cachedSnapshot && at - this.cachedSnapshot.timestamp < 500) return this.cachedSnapshot
    if (this.samplePromise) return this.samplePromise
    this.samplePromise = this.sampleNow()
    try {
      this.cachedSnapshot = await this.samplePromise
      return this.cachedSnapshot
    } finally {
      this.samplePromise = null
    }
  }

  async sampleNow() {
    const sampledAt = this.now()
    const values = await Promise.all(this.sources.map(source => this.readSource(source)))
    let delta = 0
    let available = 0
    let liveRate = 0
    for (let i = 0; i < this.sources.length; i += 1) {
      const source = this.sources[i]
      const current = values[i]
      if (current === null) continue
      available += 1
      if (source.kind === 'maya-live') {
        liveRate += current
        continue
      }
      const previous = this.lastBySource.get(source.name)
      // A counter reset means the backend restarted; establish a fresh
      // baseline rather than treating its lifetime total as newly generated.
      if (previous !== undefined && current >= previous.value
        && sampledAt - previous.at <= this.windowMs) delta += current - previous.value
      this.lastBySource.set(source.name, { value: current, at: sampledAt })
    }

    if (this.lastSampleAt !== null && sampledAt > this.lastSampleAt) {
      this.intervals.push({ start: this.lastSampleAt, end: sampledAt, tokens: delta })
    }
    this.lastSampleAt = sampledAt
    const cutoff = sampledAt - this.windowMs
    this.intervals = this.intervals.filter(interval => interval.end > cutoff && interval.end - interval.start <= this.windowMs)
    const recent = this.intervals.filter(interval => interval.tokens > 0)
    const first = recent[0]
    const spanMs = first ? Math.max(1, sampledAt - Math.max(cutoff, first.start)) : 0
    const tokens = this.intervals.reduce((sum, interval) => {
      const overlap = Math.max(0, Math.min(sampledAt, interval.end) - Math.max(cutoff, interval.start))
      const duration = interval.end - interval.start
      return sum + (duration > 0 ? interval.tokens * overlap / duration : 0)
    }, 0)
    const tps = (spanMs ? tokens * 1000 / spanMs : 0) + liveRate
    return {
      tps: Math.round(tps * 10) / 10,
      timestamp: sampledAt,
      window_ms: this.windowMs,
      state: available ? (tokens > 0 || liveRate > 0 ? 'live' : 'idle') : 'unavailable',
    }
  }
}

export function createSnapshotHandler(rate) {
  return async function handle(request) {
    const url = new URL(request.url)
    if (url.search || url.searchParams.size) return new Response('{"error":"query_not_supported"}', {
      status: 400, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
    const snapshot = await rate.snapshot()
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

export function apply(ctx) {
  const rate = new EngineTokenRate()
  ctx.inject(['connection'], (connectionCtx) => {
    const fetchRegistry = connectionCtx.connection.fetch
    connectionCtx.effect(() => fetchRegistry.register({
      path: ROUTE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: createSnapshotHandler(rate),
    }), 'dsh-server-tps: measured local inference token rate')
  })
}

export default apply

export const constants = Object.freeze({ ROUTE_PATH, WINDOW_MS, REQUEST_TIMEOUT_MS })
