export const localModelRoute = '/api/dsh-local-model'
export const pollIntervalMs = 4000
export const noticeDurationMs = 15000
// Declared by dsh-client-ui-model-selection/src/client/slots.ts and rendered in ModelSelect's root menu.
export const unloadSlot = 'conversation.input.model.options'
const localBackends = new Set(['qwen', 'maya', 'hyperinkling'])
const warning = 'Unload all local GPU models. Normal requests and goals may reload them.'

export async function requestLocalModels(fetchImpl, { sessionId, signal, unload = false } = {}) {
  const options = { method: unload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal }
  if (unload) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify({ backend: 'all', ...(sessionId ? { sessionId } : {}) })
  }
  const response = await fetchImpl(localModelRoute, options)
  let data
  try { data = await response.json() } catch { /* Report invalid/error responses below. */ }
  if (!response.ok || data?.ok !== true) {
    const message = data?.message || data?.error || `Local model endpoint returned HTTP ${response.status}`
    throw new Error(response.status === 409 ? `Local models are busy. ${message}` : message)
  }
  if (unload && !['unloaded', 'already_idle'].includes(data.status)) {
    throw new Error('Local model endpoint did not confirm unload. Check status and retry.')
  }
  return data
}

export function unloadView(snapshot, { inFlight = false, locked = false, notice = null, statusError = null, now = Date.now() } = {}) {
  const backends = (snapshot?.backends || []).filter(item => localBackends.has(item.backend))
  const hidden = backends.length === 0 || backends.every(item => ['offline', 'unloaded'].includes(item.state))
  const busy = locked || inFlight || !!snapshot?.backendBusy || !!snapshot?.transitioning || snapshot?.unload?.phase === 'unloading'
    || snapshot?.activeRequests > 0 || snapshot?.pendingRequests > 0
  const recent = notice && now - notice.at < noticeDurationMs ? notice : null
  // A fresh ready/loading state supersedes a previous success: a request may have reloaded it.
  const success = recent?.kind === 'success' && backends.every(item => ['offline', 'unloaded', 'sleeping'].includes(item.state))
  const error = recent?.kind === 'error' ? recent.message : statusError ||
    (snapshot?.unload?.phase === 'error' ? snapshot.unload.error || 'Unload failed. Retry when idle.' : null)
  const states = backends.map(item => `${{ qwen: 'Qwen', maya: 'Maya', hyperinkling: 'Hyperinkling' }[item.backend]}: ${item.state || 'unknown'}`).join(' · ')
  return {
    visible: inFlight || !hidden || !!recent,
    disabled: busy || !!statusError || !snapshot || hidden,
    busy,
    label: error ? `Unload unavailable: ${error}` : inFlight || snapshot?.unload?.phase === 'unloading'
      ? 'Unloading local models…' : success ? 'Model unloaded · next request reloads' : states || 'Local models unavailable',
    error: !!error,
    title: `${error ? `${error} ` : ''}${warning}${busy ? ' Waiting for local backend work to finish.' : ''}`,
  }
}

export function mountUnload(React, slots, fetchImpl = fetch) {
  const h = React.createElement
  function UnloadControl({ sessionId, useSession, locked = false, reportFailure }) {
    const boundSessionId = useSession(value => value.sessionId)
    const [snapshot, setSnapshot] = React.useState(null)
    const [statusError, setStatusError] = React.useState(null)
    const [notice, setNotice] = React.useState(null)
    const [inFlight, setInFlight] = React.useState(false)
    const request = React.useRef(null)
    const mounted = React.useRef(false)
    const refresh = React.useRef(null)

    React.useEffect(() => {
      mounted.current = true
      let active = true
      let timer, controller, timeout
      const poll = async () => {
        clearTimeout(timer)
        controller?.abort()
        const current = new AbortController()
        controller = current
        clearTimeout(timeout)
        timeout = setTimeout(() => current.abort(), 8000)
        try {
          const data = await requestLocalModels(fetchImpl, { signal: current.signal })
          if (active && controller === current && !request.current) { setSnapshot(data); setStatusError(null) }
        } catch (error) {
          if (active && controller === current && !request.current) setStatusError(error?.message || 'Status unavailable. Retry shortly.')
        } finally {
          if (controller === current) {
            clearTimeout(timeout)
            if (active) timer = setTimeout(poll, pollIntervalMs)
          }
        }
      }
      refresh.current = poll
      void poll()
      return () => {
        active = false
        mounted.current = false
        refresh.current = null
        clearTimeout(timer)
        clearTimeout(timeout)
        controller?.abort()
        request.current?.abort()
      }
    }, [])

    React.useEffect(() => {
      if (!notice) return undefined
      const timer = setTimeout(() => setNotice(null), Math.max(0, notice.at + noticeDurationMs - Date.now()))
      return () => clearTimeout(timer)
    }, [notice])

    const view = unloadView(snapshot, { inFlight, locked, notice, statusError })
    const unload = async () => {
      if (request.current || view.disabled) return
      const controller = new AbortController()
      request.current = controller
      setInFlight(true)
      try {
        await requestLocalModels(fetchImpl, { unload: true, sessionId: sessionId || boundSessionId, signal: controller.signal })
        if (mounted.current) {
          setSnapshot(previous => ({ ...previous, unload: { phase: 'unloaded' },
            backends: (previous?.backends || []).map(item => localBackends.has(item.backend)
              ? { ...item, state: item.state === 'offline' ? 'offline' : 'unloaded' } : item) }))
          setNotice({ kind: 'success', at: Date.now() })
          setStatusError(null)
        }
      } catch (error) {
        if (mounted.current) {
          const message = error?.message || 'Unload failed. Retry when idle.'
          setNotice({ kind: 'error', message, at: Date.now() })
          reportFailure?.(message)
        }
      } finally {
        if (request.current === controller) request.current = null
        if (mounted.current) { setInFlight(false); void refresh.current?.() }
      }
    }
    if (!view.visible) return null
    return h('div', {
      'data-maya-model-unload': true, 'aria-busy': view.busy, title: view.title,
      style: { display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0,
        width: '100%', maxWidth: '100%', boxSizing: 'border-box',
        fontFamily: 'var(--dsw-font-family)',
        color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px' },
    },
    h('button', { type: 'button', role: 'menuitem', disabled: view.disabled, onClick: unload,
      'aria-label': 'Unload model — all local GPU backends', 'aria-busy': inFlight, title: view.title,
      style: { font: 'inherit', fontSize: 13, lineHeight: '20px', textAlign: 'left',
        color: view.disabled ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-label-primary)',
        border: 0, borderRadius: 'var(--dsw-radius-md)', padding: '7px 8px', minHeight: 34,
        width: '100%', maxWidth: '100%', cursor: view.disabled ? 'default' : 'pointer' },
    }, inFlight ? 'Unloading…' : 'Unload model'),
    h('span', { role: 'status', 'aria-live': 'polite', style: { minWidth: 0, padding: '0 8px 4px',
      overflowWrap: 'anywhere', color: view.error ? 'var(--dsw-alias-state-error-primary)' : 'inherit' } }, view.label),
    h('style', null, '[data-maya-model-unload] button{background:transparent}[data-maya-model-unload] button:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}[data-maya-model-unload] button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}'))
  }
  slots.inject(unloadSlot, () => slots.register({
    name: unloadSlot, id: 'maya-model-unload', order: 100, label: 'Unload local GPU models',
  }, UnloadControl))
}
