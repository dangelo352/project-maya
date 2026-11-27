/** DSH 0.2.2-rc.5 llm/stream gate for the local GPU model servers. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const name = 'maya-backend-gate'
export const inject = ['llm']

export const BACKENDS = Object.freeze({
  'maya-local': 'maya',
  'maya-local-compact': 'maya',
  'hyperqwen-local': 'qwen',
  'hyperqwen-local-compact': 'qwen',
  'hyperinkling-local': 'hyperinkling',
  'hyperinkling-local-compact': 'hyperinkling',
  // The Qwen QoL adapter registers this provider by default. Keep it behind
  // the same single-GPU handoff as the profile's named HyperQwen routes.
  qwen38: 'qwen',
})

export const BACKEND_URLS = Object.freeze({
  maya: 'http://127.0.0.1:18022',
  qwen: 'http://127.0.0.1:18021',
  hyperinkling: 'http://127.0.0.1:18023',
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

function isConnectionError(error) {
  return error instanceof TypeError && /fetch failed|failed to fetch/i.test(error.message)
}

function isTransientHttpError(error) {
  return error instanceof Error && /HTTP 5\d\d\b/.test(error.message)
}

async function startHyperInklingService({ distro, unit }) {
  if (process.platform !== 'win32') {
    throw new Error('automatic HyperInkling startup is configured for Windows + WSL only')
  }
  await execFileAsync('wsl.exe', ['-d', distro, '-u', 'root', '--', 'systemctl', 'start', unit], {
    timeout: 60_000,
    windowsHide: true,
  })
}

async function stopHyperInklingService({ distro, unit }) {
  if (process.platform !== 'win32') {
    throw new Error('automatic HyperInkling shutdown is configured for Windows + WSL only')
  }
  await execFileAsync('wsl.exe', ['-d', distro, '-u', 'root', '--', 'systemctl', 'stop', unit], {
    timeout: 120_000,
    windowsHide: true,
  })
}

export function createBackendClients({
  fetchImpl = globalThis.fetch,
  urls = BACKEND_URLS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  startTimeoutMs = 900_000,
  startService = startHyperInklingService,
  stopService = stopHyperInklingService,
  distro = 'Ubuntu',
  serviceUnit = 'hyperinkling.service',
  pollIntervalMs = 2_000,
} = {}) {
  async function hyperinklingState() {
    try {
      const status = await requestJson(fetchImpl, `${urls.hyperinkling}/is_sleeping`, {}, timeoutMs)
      if (typeof status?.is_sleeping !== 'boolean') {
        throw new Error('HyperInkling /is_sleeping returned no boolean is_sleeping field')
      }
      return { sleeping: status.is_sleeping }
    } catch (error) {
      // The lean profile disables vLLM sleep mode because its cuMem allocator
      // failed during WSL startup. A successful health probe is the loaded
      // state; switching away stops the service to release the single GPU.
      if (!/HTTP 404\b/.test(error.message)) throw error
      await requestJson(fetchImpl, `${urls.hyperinkling}/health`, {}, timeoutMs)
      return { sleeping: false }
    }
  }

  async function waitForHyperInkling() {
    const deadline = Date.now() + startTimeoutMs
    let lastError
    while (Date.now() < deadline) {
      try {
        return (await hyperinklingState()).sleeping
      } catch (error) {
        if (!isConnectionError(error) && !isTransientHttpError(error)) throw error
        lastError = error
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
    throw new Error(`HyperInkling did not become ready within ${startTimeoutMs} ms${lastError ? `: ${lastError.message}` : ''}`)
  }

  return {
    async status(backend) {
      if (backend === 'hyperinkling') return hyperinklingState()
      const path = backend === 'maya' ? '/api/ps' : '/status'
      return requestJson(fetchImpl, `${urls[backend]}${path}`, {}, timeoutMs)
    },
    async loaded(backend) {
      let status
      try {
        status = await this.status(backend)
      } catch (error) {
        // HyperInkling is deliberately launched only when selected. An offline
        // endpoint is an idle backend, not a reason to break Maya/Qwen routing.
        if (backend === 'hyperinkling' && isConnectionError(error)) return false
        throw error
      }
      if (backend === 'maya') return isMayaLoaded(status)
      if (backend === 'hyperinkling') return status.sleeping === false
      return isQwenLoaded(status)
    },
    async ensure(backend) {
      if (backend !== 'hyperinkling') return
      let sleeping
      try {
        sleeping = (await hyperinklingState()).sleeping
      } catch (error) {
        if (isConnectionError(error)) {
          await startService({ distro, unit: serviceUnit })
        } else if (!isTransientHttpError(error)) {
          throw error
        }
        sleeping = await waitForHyperInkling()
      }
      if (sleeping) {
        await requestJson(fetchImpl, `${urls.hyperinkling}/wake_up`, { method: 'POST' }, timeoutMs)
        if ((await hyperinklingState()).sleeping) throw new Error('HyperInkling remained asleep after wake_up')
      }
    },
    async unload(backend) {
      if (backend === 'hyperinkling') {
        try {
          await requestJson(fetchImpl, `${urls.hyperinkling}/sleep?level=1&mode=wait`, { method: 'POST' }, timeoutMs)
          return { status: 'sleeping' }
        } catch (error) {
          if (!/HTTP 404\b/.test(error.message)) throw error
          await stopService({ distro, unit: serviceUnit })
          return { status: 'stopped' }
        }
      }
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
    const backends = Object.keys(BACKEND_URLS)
    const states = await Promise.all(backends.map(async backend => [backend, await this.clients.loaded(backend)]))
    for (const [backend, loaded] of states) {
      if (backend !== target && loaded) await this.clients.unload(backend)
    }
    await this.clients.ensure?.(target)
    this.currentBackend = target
  }

  async transition(target) {
    if (this.currentBackend === null) {
      await this.reconcile(target)
    } else {
      const previous = this.currentBackend
      await this.clients.unload(previous)
      this.currentBackend = null
      await this.clients.ensure?.(target)
      this.currentBackend = target
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
      // Keep the transition lock held until this request owns a lease. If we
      // wake competing waiters inside transition(), one could switch backends
      // before this caller increments activeRequests.
      this.transitioning = true
      try {
        await this.transition(target)
        this.activeRequests += 1
        this.transitioning = false
        this.notify()
        return this.releaseOnce()
      } catch (error) {
        this.transitioning = false
        this.notify()
        throw error
      }
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
