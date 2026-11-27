/** DSH 0.2.2-rc.5 llm/stream gate for the Maya and Qwen loopback servers. */

export const name = 'maya-backend-gate'
export const inject = ['llm']

export const BACKENDS = Object.freeze({
  'maya-local': 'maya',
  'maya-local-compact': 'maya',
  'hyperqwen-local': 'qwen',
  'hyperqwen-local-compact': 'qwen',
})

export const BACKEND_URLS = Object.freeze({
  maya: 'http://127.0.0.1:18022',
  qwen: 'http://127.0.0.1:18021',
})

// Qwen may spend STOP_TIMEOUT_S terminating the CUDA process before replying.
const DEFAULT_TIMEOUT_MS = 310_000

async function requestJson(fetchImpl, url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = body?.error?.message ?? body?.error ?? `HTTP ${response.status}`
    throw new Error(`${url} failed: ${detail}`)
  }
  return body
}

function isMayaLoaded(status) {
  return Boolean(status?.models?.length || status?.loading)
}

function isQwenLoaded(status) {
  return Boolean(status?.engine_pid || status?.loading_model || status?.active_model)
}

export function createBackendClients({
  fetchImpl = globalThis.fetch,
  urls = BACKEND_URLS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return {
    async status(backend) {
      const path = backend === 'maya' ? '/api/ps' : '/status'
      return requestJson(fetchImpl, `${urls[backend]}${path}`, {}, timeoutMs)
    },
    async loaded(backend) {
      const status = await this.status(backend)
      return backend === 'maya' ? isMayaLoaded(status) : isQwenLoaded(status)
    },
    async unload(backend) {
      const path = backend === 'maya' ? '/models/unload' : '/unload'
      const body = backend === 'maya' ? {} : undefined
      const result = await requestJson(fetchImpl, `${urls[backend]}${path}`, {
        method: 'POST',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      }, timeoutMs)
      const state = result?.status?.value ?? result?.status
      if (result?.ok === false || result?.busy === true || state === 'busy' || state === 'error') {
        throw new Error(`${backend} unload failed: ${result.message ?? state ?? 'backend reported failure'}`)
      }
      return result
    },
  }
}

/**
 * Serializes backend transitions while allowing requests to the selected backend
 * to overlap. Unknown initial state is reconciled from both live status APIs.
 */
export class BackendGate {
  constructor({ clients, aliases = BACKENDS, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.clients = clients
    this.aliases = aliases
    this.timeoutMs = timeoutMs
    this.currentBackend = null
    this.activeRequests = 0
    this.transitioning = false
    this.waiters = new Set()
  }

  backendFor(provider) {
    return this.aliases[provider] ?? null
  }

  notify() {
    for (const wake of this.waiters) wake()
    this.waiters.clear()
  }

  async waitForChange() {
    await new Promise(resolve => this.waiters.add(resolve))
  }

  async reconcile(target) {
    const [mayaLoaded, qwenLoaded] = await Promise.all([
      this.clients.loaded('maya'),
      this.clients.loaded('qwen'),
    ])
    const loaded = { maya: mayaLoaded, qwen: qwenLoaded }
    const other = target === 'maya' ? 'qwen' : 'maya'
    if (loaded[other]) await this.clients.unload(other)
    this.currentBackend = target
  }

  async transition(target) {
    this.transitioning = true
    this.notify()
    try {
      if (this.currentBackend === null) {
        await this.reconcile(target)
      } else {
        const previous = this.currentBackend
        await this.clients.unload(previous)
        this.currentBackend = target
      }
    } finally {
      this.transitioning = false
      this.notify()
    }
  }

  async acquire(provider) {
    const target = this.backendFor(provider)
    if (target === null) return () => {}

    for (;;) {
      if (this.transitioning || (this.currentBackend !== target && this.activeRequests > 0)) {
        await this.waitForChange()
        continue
      }
      if (this.currentBackend === target) {
        this.activeRequests += 1
        return this.releaseOnce()
      }
      await this.transition(target)
      // Reserve before yielding, so a waiting switch cannot overtake this call.
      this.activeRequests += 1
      return this.releaseOnce()
    }
  }

  releaseOnce() {
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeRequests -= 1
      if (this.activeRequests === 0) this.notify()
    }
  }
}

function guardedStream(gate, provider, next) {
  return (async function* () {
    const release = await gate.acquire(provider)
    try {
      yield* next()
    } finally {
      release()
    }
  })()
}

export function apply(ctx, config = {}) {
  const clients = createBackendClients(config)
  const gate = new BackendGate({ clients, aliases: config.aliases ?? BACKENDS, timeoutMs: config.timeoutMs })
  ctx.on('llm/stream', (options, next) => guardedStream(gate, options.provider, next))
  return gate
}
