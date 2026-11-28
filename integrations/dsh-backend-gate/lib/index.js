/** DSH 0.2.2-rc.5 llm/stream gate for the local GPU model servers. */

import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLocalModelHandler, LOCAL_MODEL_ROUTE } from './local-model-control.js'

const execFileAsync = promisify(execFile)

export const name = 'maya-backend-gate'
export const inject = ['llm', 'connection']

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
export const SWITCH_STATUS_ROUTE = '/api/dsh-model-switch-status'

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
  return status?.status === 'ok' && status?.unloaded !== true
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

function startMayaProcess({ python, cwd, config, host, port }) {
  if (process.platform !== 'win32') {
    throw new Error('automatic Maya startup is configured for this Windows installation')
  }
  const child = spawn(python, [
    '-u', 'serve/server.py', '--engine', 'maya', '--config', config,
    '--host', host, '--port', String(port),
  ], { cwd, detached: true, stdio: 'ignore', windowsHide: true })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export function createBackendClients({
  fetchImpl = globalThis.fetch,
  urls = BACKEND_URLS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  startTimeoutMs = 900_000,
  loadTimeoutMs = 900_000,
  qwenModel = 'qwen3.8-27b',
  qwenModelAliases = {
    'qwen3.8-27b-mtp': 'qwen3.8-27b',
    'qwen3.8-27b-davidau': 'qwen3.8-27b',
    'qwen3.8-27b-davidau-mtp-long': 'qwen3.8-27b',
    'qwen3.8-27b-ektome': 'qwen3.8-27b',
  },
  startService = startHyperInklingService,
  stopService = stopHyperInklingService,
  distro = 'Ubuntu',
  serviceUnit = 'hyperinkling.service',
  startMaya = startMayaProcess,
  mayaPython = 'E:\\Project-Maya\\.venv\\Scripts\\python.exe',
  mayaCwd = 'E:\\Project-Maya',
  mayaConfig = 'build/maya-dsh-200k.json',
  mayaHost = '127.0.0.1',
  mayaPort = 18022,
  pollIntervalMs = 2_000,
  qwenMetricsUrl = 'http://127.0.0.1:18020/metrics',
  qwenQueueUrl = 'http://127.0.0.1:18026/priority/queue',
} = {}) {
  async function hyperinklingState(requestTimeoutMs = timeoutMs) {
    try {
      const status = await requestJson(fetchImpl, `${urls.hyperinkling}/is_sleeping`, {}, requestTimeoutMs)
      if (typeof status?.is_sleeping !== 'boolean') {
        throw new Error('HyperInkling /is_sleeping returned no boolean is_sleeping field')
      }
      return { sleeping: status.is_sleeping }
    } catch (error) {
      // The lean profile disables vLLM sleep mode because its cuMem allocator
      // failed during WSL startup. A successful health probe is the loaded
      // state; switching away stops the service to release the single GPU.
      if (!/HTTP 404\b/.test(error.message)) throw error
      await requestJson(fetchImpl, `${urls.hyperinkling}/health`, {}, requestTimeoutMs)
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

  async function waitForMaya() {
    const deadline = Date.now() + startTimeoutMs
    let lastError
    while (Date.now() < deadline) {
      try {
        const health = await requestJson(fetchImpl, `${urls.maya}/health`, {}, timeoutMs)
        if (health?.status === 'ok' && health?.unloaded !== true) return health
      } catch (error) {
        if (!isConnectionError(error) && !isTransientHttpError(error)) throw error
        lastError = error
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
    throw new Error(`Maya did not become ready within ${startTimeoutMs} ms${lastError ? `: ${lastError.message}` : ''}`)
  }

  async function waitForQwen() {
    const deadline = Date.now() + startTimeoutMs
    let lastError
    let sawLoading = false
    while (Date.now() < deadline) {
      try {
        const status = await requestJson(fetchImpl, `${urls.qwen}/status`, {}, Math.min(timeoutMs, 5_000))
        if (status?.loading_model) {
          sawLoading = true
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
          continue
        }
        // last_error may describe a failed switch followed by successful rollback.
        // The requested /load operation reports current failures; do not let a
        // historical error block a healthy active model or prevent a retry.
        return status
      } catch (error) {
        if (isConnectionError(error) && !sawLoading) throw new Error(`Qwen router is offline: ${error.message}`)
        if (!isConnectionError(error) && !isTransientHttpError(error)) throw error
        lastError = error
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
    throw new Error(`Qwen did not finish loading within ${startTimeoutMs} ms${lastError ? `: ${lastError.message}` : ''}`)
  }

  return {
    async activity(backend, requestTimeoutMs = 1500) {
      if (backend === 'maya') {
        const value = await requestJson(fetchImpl, `${urls.maya}/status`, {}, requestTimeoutMs)
        if (typeof value.busy !== 'boolean' || !Number.isFinite(value.queued)) throw new Error('Maya activity status is unavailable.')
        return { busy: value.busy || value.queued > 0 }
      }
      const response = await fetchImpl(backend === 'qwen' ? qwenMetricsUrl : `${urls.hyperinkling}/metrics`, { signal: AbortSignal.timeout(requestTimeoutMs) })
      if (!response.ok) throw new Error('Engine activity metrics are unavailable.')
      const activity = parseEngineActivity(await response.text())
      if (backend === 'qwen' && qwenQueueUrl) {
        try {
          const queue = await requestJson(fetchImpl, qwenQueueUrl, {}, requestTimeoutMs)
          if (!Array.isArray(queue.queue)) throw new Error('Qwen scheduler status is unavailable.')
          activity.busy ||= Boolean(queue.active) || queue.queue.length > 0
        } catch (error) {
          if (!isConnectionError(error) && !/HTTP 404\b/.test(error.message)) throw error
        }
      }
      return activity
    },
    async status(backend, requestTimeoutMs = timeoutMs) {
      if (backend === 'hyperinkling') return hyperinklingState(requestTimeoutMs)
      const path = backend === 'maya' ? '/health' : '/status'
      return requestJson(fetchImpl, `${urls[backend]}${path}`, {}, requestTimeoutMs)
    },
    async loaded(backend, requestTimeoutMs = timeoutMs) {
      let status
      try {
        status = await this.status(backend, requestTimeoutMs)
      } catch (error) {
        // Local backends may be stopped between sessions. Treat a refused
        // connection as idle so bootstrap can still route to another model.
        if (isConnectionError(error)) return false
        throw error
      }
      if (backend === 'maya') return isMayaLoaded(status)
      if (backend === 'hyperinkling') return status.sleeping === false
      return isQwenLoaded(status)
    },
    async ensure(backend, model) {
      if (backend === 'maya') {
        try {
          const health = await requestJson(fetchImpl, `${urls.maya}/health`, {}, timeoutMs)
          if (health?.status === 'ok' && health?.unloaded !== true) return
          if (health?.status !== 'ok') throw new Error('Maya /health did not report status=ok')
          await requestJson(fetchImpl, `${urls.maya}/models/load`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'inkling-2-mini' }),
          }, loadTimeoutMs)
        } catch (error) {
          if (!isConnectionError(error)) throw error
          await startMaya({ python: mayaPython, cwd: mayaCwd, config: mayaConfig, host: mayaHost, port: mayaPort })
        }
        await waitForMaya()
        return
      }
      if (backend === 'qwen') {
        const modelId = model || qwenModel
        const expectedModel = qwenModelAliases[modelId] ?? modelId
        let status = await waitForQwen()
        if (status?.active_model === expectedModel && status?.engine_pid && !status?.loading_model) return status
        await requestJson(fetchImpl, `${urls.qwen}/load`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: modelId }),
        }, loadTimeoutMs)
        status = await waitForQwen()
        if (status?.active_model !== expectedModel || !status?.engine_pid) {
          throw new Error(`Qwen load endpoint returned, but ${expectedModel} is not reported as the active model`)
        }
        return status
      }
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
      let result
      try {
        result = await requestJson(fetchImpl, `${urls[backend]}${path}`, {
          method: 'POST',
          ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        }, timeoutMs)
      } catch (error) {
        if (backend === 'maya' && isConnectionError(error)) return { status: 'stopped' }
        throw error
      }
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
    this.pendingRequests = 0
    this.manualUnload = { phase: 'idle' }
    this.transitioning = false
    this.waiters = new Set()
    this.selectionRevision = 0
    this.switchStatus = null
    this.activeSessions = new Map()
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

  updateSwitch(phase, detail = {}) {
    if (!this.switchStatus) return
    this.switchStatus = { ...this.switchStatus, phase, updatedAt: Date.now(), ...detail }
  }

  isStale(revision) {
    return revision !== undefined && revision !== this.selectionRevision
  }

  async reconcile(target, revision, model) {
    this.updateSwitch('checking-existing-models')
    const backends = Object.keys(BACKEND_URLS)
    const states = await Promise.all(backends.map(async backend => [backend, await this.clients.loaded(backend)]))
    for (const [backend, loaded] of states) {
      if (this.isStale(revision)) return false
      if (backend !== target && loaded) {
        this.updateSwitch('unloading', { from: backend })
        await this.clients.unload(backend)
      }
    }
    if (this.isStale(revision)) return false
    this.updateSwitch('loading')
    await this.clients.ensure?.(target, model)
    this.currentBackend = target
    return true
  }

  async transition(target, revision, model) {
    if (this.currentBackend === null) {
      return this.reconcile(target, revision, model)
    } else {
      const previous = this.currentBackend
      this.updateSwitch('unloading', { from: previous })
      await this.clients.unload(previous)
      this.currentBackend = null
      if (this.isStale(revision)) return false
      this.updateSwitch('loading')
      await this.clients.ensure?.(target, model)
      this.currentBackend = target
      return true
    }
  }

  /** Preload the selected local model before the next prompt, keeping the same GPU handoff lock as llm/stream. */
  async selectModel({ provider, model, sessionId }) {
    const target = this.backendFor(provider)
    const revision = ++this.selectionRevision
    if (!target || !model) {
      this.switchStatus = null
      this.notify()
      return
    }
    this.switchStatus = {
      sessionId: String(sessionId ?? ''), provider, model, backend: target,
      phase: 'waiting', startedAt: Date.now(), updatedAt: Date.now(),
    }
    this.notify()

    for (;;) {
      if (this.isStale(revision)) return
      if (this.transitioning || this.activeRequests > 0) {
        this.updateSwitch('waiting-for-active-request', {
          blockingSessionIds: [...this.activeSessions.keys()],
        })
        await this.waitForChange()
        continue
      }
      this.transitioning = true
      try {
        if (this.currentBackend === target) {
          this.updateSwitch('checking-selected-backend')
          await this.clients.ensure?.(target, model)
        } else {
          const completed = await this.transition(target, revision, model)
          if (!completed && !this.isStale(revision)) continue
        }
        if (this.isStale(revision)) return
        this.currentBackend = target
        this.updateSwitch('ready', { from: undefined, finishedAt: Date.now() })
        return
      } catch (error) {
        if (!this.isStale(revision)) {
          this.updateSwitch('error', { error: error?.message ?? String(error), finishedAt: Date.now() })
        }
        return
      } finally {
        this.transitioning = false
        this.notify()
      }
    }
  }

  async statusSnapshot(sessionId) {
    const current = this.switchStatus
    if (current && sessionId && current.sessionId !== sessionId) return null
    if (!current || (current.finishedAt && Date.now() - current.finishedAt > 12000)) {
      for (const backend of Object.keys(BACKEND_URLS)) {
        try {
          const raw = await this.clients.status(backend, 900)
          const status = summarizeBackendStatus(backend, raw)
          if (['ready', 'loading'].includes(status.state)) return {
            sessionId: String(sessionId ?? ''), backend,
            model: status.model || backend, phase: status.state === 'loading' ? 'loading' : 'serving',
            startedAt: Date.now(), updatedAt: Date.now(), backendStatus: status, observed: true,
          }
        } catch { /* An unavailable backend cannot report a lifecycle state. */ }
      }
      return null
    }
    const completedAt = current.finishedAt ?? current.updatedAt
    const active = !['ready', 'error'].includes(current.phase)
    const retentionMs = current.phase === 'error' ? 30_000 : 12_000
    if (!active && Date.now() - completedAt > retentionMs) return null
    let backend = null
    try { backend = await this.clients.status(current.backend, 1800) } catch { /* the phase remains visible while the backend is starting */ }
    return {
      ...current,
      blockingSessionIds: current.phase === 'waiting-for-active-request'
        ? [...this.activeSessions.keys()] : [],
      backendStatus: summarizeBackendStatus(current.backend, backend),
    }
  }

  async acquire(provider, sessionId, model) {
    if (this.backendFor(provider) === null) return () => {}
    this.pendingRequests += 1
    try { return await this.acquireLease(provider, sessionId, model) }
    finally { this.pendingRequests -= 1 }
  }

  async acquireLease(provider, sessionId, model) {
    const target = this.backendFor(provider)
    if (target === null) return () => {}

    for (;;) {
      if (this.transitioning || (this.currentBackend !== target && this.activeRequests > 0)) {
        await this.waitForChange()
        continue
      }
      if (this.currentBackend === target && this.activeRequests > 0) {
        this.activeRequests += 1
        return this.releaseOnce(sessionId)
      }
      // Keep the transition lock held until this request owns a lease. If we
      // wake competing waiters inside transition(), one could switch backends
      // before this caller increments activeRequests.
      this.transitioning = true
      let showRequestLoad = false
      try {
      showRequestLoad = this.currentBackend !== target
      if (showRequestLoad) {
        this.switchStatus = {
          sessionId: String(sessionId ?? ''), provider, model, backend: target,
          phase: 'loading', startedAt: Date.now(), updatedAt: Date.now(),
        }
      }
        if (this.currentBackend === target) await this.clients.ensure?.(target, model)
        else await this.transition(target, undefined, model)
        if (showRequestLoad) this.updateSwitch('ready', { finishedAt: Date.now() })
        this.activeRequests += 1
        this.addActiveSession(sessionId)
        this.transitioning = false
        this.notify()
        return this.releaseOnce(sessionId, true)
      } catch (error) {
        if (showRequestLoad) this.updateSwitch('error', { error: error?.message ?? String(error), finishedAt: Date.now() })
        this.transitioning = false
        this.notify()
        throw error
      }
    }
  }

  addActiveSession(sessionId) {
    if (sessionId === undefined || sessionId === null || sessionId === '') return
    const key = String(sessionId)
    this.activeSessions.set(key, (this.activeSessions.get(key) ?? 0) + 1)
  }

  async localStatusSnapshot() {
    const backends = await Promise.all(Object.keys(BACKEND_URLS).map(async backend => {
      try {
        const raw = await this.clients.status(backend, 1200)
        const info = summarizeBackendStatus(backend, raw)
        const idleQwen = backend === 'qwen' && !raw?.engine_pid && !raw?.loading_model && !raw?.active_model
        return { backend, ...info, state: idleQwen ? 'unloaded' : info.state === 'starting' ? 'unknown' : info.state, model: info.model ?? null }
      } catch (error) {
        return { backend, state: isConnectionError(error) ? 'offline' : 'unknown', model: null }
      }
    }))
    const activity = await Promise.all(backends.filter(item => ['ready', 'loading'].includes(item.state)).map(async item => {
      try { return (await this.clients.activity?.(item.backend, 1200))?.busy === true }
      catch { return true }
    }))
    const backendBusy = activity.some(Boolean)
    return { ok: true, currentBackend: this.currentBackend, activeRequests: this.activeRequests, backendBusy,
      pendingRequests: this.pendingRequests, transitioning: this.transitioning,
      unload: { ...this.manualUnload }, backends }
  }

  async unloadIdle(backend = 'all', sessionId) {
    if (backend !== 'all' && !Object.hasOwn(BACKEND_URLS, backend)) throw Object.assign(new Error('Unknown local backend.'), { code: 'invalid_backend' })
    if (this.activeRequests > 0 || this.pendingRequests > 0 || this.transitioning) {
      throw Object.assign(new Error('Local inference or a model switch is active. Wait for it to finish before unloading.'), { code: 'busy' })
    }
    // Acquire synchronously before any backend probe; new requests must wait for this handoff.
    this.transitioning = true
    ++this.selectionRevision
    this.manualUnload = { phase: 'unloading', startedAt: Date.now(), backend, sessionId }
    const unloaded = []
    try {
      const resident = []
      for (const target of backend === 'all' ? Object.keys(BACKEND_URLS) : [backend]) {
        if (!await this.clients.loaded(target, 5000)) continue
        resident.push(target)
        if ((await this.clients.activity?.(target, 2000))?.busy)
          throw Object.assign(new Error(`${target} is still processing or has queued work. Wait before unloading.`), { code: 'busy' })
      }
      for (const target of resident) {
        await this.clients.unload(target)
        if (await this.clients.loaded(target, 5000)) throw new Error(`${target} still reports a resident model after unload.`)
        unloaded.push(target)
        if (this.currentBackend === target) this.currentBackend = null
      }
      if (backend === 'all') this.currentBackend = null
      const status = unloaded.length ? 'unloaded' : 'already_idle'
      this.manualUnload = { ...this.manualUnload, phase: 'unloaded', finishedAt: Date.now(), status, unloaded }
      return { ok: true, status, unloaded }
    } catch (error) {
      this.manualUnload = { ...this.manualUnload, phase: 'error', error: error?.message ?? String(error), unloaded, finishedAt: Date.now() }
      throw error
    } finally {
      this.transitioning = false
      this.notify()
    }
  }

  releaseOnce(sessionId, alreadyAdded = false) {
    if (!alreadyAdded) this.addActiveSession(sessionId)
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeRequests -= 1
      if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
        const key = String(sessionId)
        const count = this.activeSessions.get(key) ?? 0
        if (count <= 1) this.activeSessions.delete(key)
        else this.activeSessions.set(key, count - 1)
      }
      if (this.activeRequests === 0) this.notify()
      else if (this.switchStatus?.phase === 'waiting-for-active-request') {
        this.updateSwitch('waiting-for-active-request', { blockingSessionIds: [...this.activeSessions.keys()] })
        this.notify()
      }
    }
  }
}

export function summarizeBackendStatus(name, status) {
  if (!status) return { state: 'starting' }
  if (name === 'maya') {
    return {
      state: status.unloaded === true ? 'unloaded'
        : status.status === 'reloading' || status.status === 'updating' ? status.status
          : status.status === 'ok' ? 'ready' : 'starting',
      model: status.model ?? null,
      version: status.version ?? null,
      unloaded: status.unloaded === true,
    }
  }
  if (name === 'qwen') {
    return {
      state: status.loading_model ? 'loading'
        : status.active_model && status.engine_pid ? 'ready'
          : status.last_error ? 'error' : 'starting',
      model: status.active_model ?? status.loading_model ?? null,
      loading: Boolean(status.loading_model),
      engine: Boolean(status.engine_pid),
      error: status.last_error ?? null,
    }
  }
  return { state: status.sleeping === false ? 'ready' : status.sleeping === true ? 'sleeping' : 'starting' }
}

export function parseEngineActivity(text) {
  const values = { running: null, waiting: null }
  for (const line of text.split(/\r?\n/)) {
    const match = /^vllm:num_requests_(running|waiting)(?:\{[^}]*\})?\s+([\d.eE+-]+)\s*$/.exec(line)
    if (!match) continue
    const value = Number(match[2])
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid engine activity metric.')
    values[match[1]] = (values[match[1]] ?? 0) + value
  }
  if (values.running === null || values.waiting === null) throw new Error('Engine activity metrics are incomplete.')
  return { ...values, busy: values.running > 0 || values.waiting > 0 }
}

export function createSwitchStatusHandler(gate) {
  return async function handle(request) {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
    const url = new URL(request.url)
    if ([...url.searchParams.keys()].some(key => key !== 'sessionId')
      || url.searchParams.getAll('sessionId').length > 1) {
      return new Response('{"error":"invalid_query"}', {
        status: 400, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    const snapshot = await gate.statusSnapshot(url.searchParams.get('sessionId'))
    if (url.searchParams.has('sessionId') && snapshot?.sessionId !== url.searchParams.get('sessionId')) {
      return new Response('null', {
        status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response(JSON.stringify(snapshot), {
      status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

function guardedStream(gate, options, next) {
  return (async function* () {
    const release = await gate.acquire(options.provider, options.sessionId, options.model)
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
  ctx.on('llm/stream', (options, next) => guardedStream(gate, options, next))
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'model/selection') return
    void gate.selectModel({ ...event.data, sessionId: session.id })
  })
  ctx.inject(['connection'], (connectionCtx) => {
    const registry = connectionCtx.connection.fetch
    connectionCtx.effect(() => registry.register({
      path: SWITCH_STATUS_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: createSwitchStatusHandler(gate),
    }), 'Live local-model switch status')
    connectionCtx.effect(() => registry.register({
      path: LOCAL_MODEL_ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: createLocalModelHandler(gate),
    }), 'Local model unload controls')
  })
  return gate
}
