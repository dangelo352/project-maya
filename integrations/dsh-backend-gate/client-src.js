const POLL_MS = 1100
const ROUTE = '/api/dsh-model-switch-status'

const phaseLabels = {
  waiting: 'Preparing model switch',
  'waiting-for-active-request': 'Waiting for active DSH work',
  'checking-existing-models': 'Checking GPU model state',
  'checking-selected-backend': 'Checking selected model',
  unloading: 'Releasing current model from GPU',
  loading: 'Loading selected model',
  ready: 'Model is ready',
  error: 'Model switch failed',
  serving: 'Model loaded - waiting for engine output',
  'status-unavailable': 'Waiting for backend status - no engine reading available',
}

function elapsedLabel(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function statusUrl(sessionId) {
  return `${ROUTE}?sessionId=${encodeURIComponent(sessionId)}`
}

export function canStopForSwitch(snapshot, sessionId) {
  return snapshot?.sessionId === sessionId
    && snapshot?.phase === 'waiting-for-active-request'
    && Array.isArray(snapshot.blockingSessionIds)
    && snapshot.blockingSessionIds.length > 0
}

function backendDetail(snapshot) {
  const state = snapshot?.backendStatus?.state
  if (state === 'loading') return 'Backend reports that weights are loading.'
  if (state === 'unloaded') return 'Backend confirms the model is not resident yet.'
  if (state === 'ready') return 'Backend confirms the model is loaded and ready.'
  if (state === 'sleeping') return 'Backend reports the model is asleep; waking it now.'
  if (state === 'error') return snapshot.backendStatus.error || 'Backend reported a load error.'
  return 'Waiting for the local backend status endpoint.'
}

export function mount(React, slots, remoteSession, fetchImpl = fetch) {
  const h = React.createElement

  function SwitchCard({ sessionId, useSession }) {
    const running = useSession(value => value.running)
    const [rate, setRate] = React.useState(null)
    const [snapshot, setSnapshot] = React.useState(null)
    const [elapsed, setElapsed] = React.useState(0)
    const [cancelState, setCancelState] = React.useState('idle')

    React.useEffect(() => {
      if (!sessionId) { setSnapshot(null); return undefined }
      let active = true
      let timer
      let controller
      let requestTimeout
      const poll = async () => {
        controller = new AbortController()
        requestTimeout = setTimeout(() => controller?.abort(), 5000)
        try {
          const response = await fetchImpl(statusUrl(sessionId), {
            cache: 'no-store', signal: controller.signal,
          })
          if (!response.ok) throw new Error(`status endpoint returned HTTP ${response.status}`)
          const data = await response.json()
          let measured = null
          try {
            const r = await fetchImpl('/api/dsh-server-tps', { cache: 'no-store', signal: controller.signal })
            if (r.ok) measured = await r.json()
          } catch { /* Never substitute an estimated TPS for a missing engine sample. */ }
          if (active) {
            setRate(measured)
            setSnapshot(data?.sessionId === sessionId ? data : {
              sessionId, backend: 'local', model: 'Local inference engine',
              phase: measured && measured.state !== 'unavailable' ? 'serving' : 'status-unavailable',
              observed: true, startedAt: Date.now(), updatedAt: Date.now(),
            })
            if (!data || data.sessionId !== sessionId || ['ready', 'error'].includes(data.phase)) {
              setCancelState('idle')
            }
          }
        } catch {
          if (active) setSnapshot(previous => previous?.sessionId === sessionId
            ? { ...previous, statusUnavailable: true } : null)
        } finally {
          clearTimeout(requestTimeout)
          requestTimeout = undefined
          controller = undefined
          if (active) timer = setTimeout(poll, POLL_MS)
        }
      }
      void poll()
      return () => { active = false; clearTimeout(timer); clearTimeout(requestTimeout); controller?.abort() }
    }, [sessionId])

    React.useEffect(() => {
      if (!snapshot) return undefined
      const tick = () => setElapsed(Math.max(0, Date.now() - snapshot.startedAt))
      tick()
      const timer = setInterval(tick, 1000)
      return () => clearInterval(timer)
    }, [snapshot?.sessionId, snapshot?.startedAt])

    React.useEffect(() => { setCancelState('idle') }, [snapshot?.startedAt])

    const visible = snapshot?.sessionId === sessionId && (!snapshot.observed || running || snapshot.phase === 'loading')
    if (!visible) return null

    const phase = snapshot.phase
    const serving = phase === 'serving'
    const done = phase === 'ready' || serving
    const failed = phase === 'error'
    const waiting = phase === 'waiting-for-active-request'
    const blockers = [...new Set(snapshot.blockingSessionIds || [])]
    const modelName = snapshot.model || snapshot.backend
    const trackStyle = {
      height: 5, borderRadius: 99, overflow: 'hidden',
      background: 'var(--bg-soft, rgba(127,127,127,.2))',
      marginTop: 11,
    }
    const fillStyle = {
      height: '100%', width: done ? '100%' : failed ? '100%' : '38%',
      borderRadius: 99,
      background: failed ? 'var(--danger, #ef6262)' : 'var(--dsw-alias-state-business-primary)',
      transformOrigin: 'left center',
      animation: done || failed ? 'none' : 'maya-switch-travel 1.45s ease-in-out infinite',
      transition: 'width .28s ease',
    }

    const stopAndSwitch = async () => {
      if (cancelState !== 'idle' || blockers.length === 0) return
      setCancelState('stopping')
      try {
        const results = await Promise.all(blockers.map(id => remoteSession.cancel({ sessionId: id })))
        const failure = results.find(result => result?.ok === false)
        setCancelState(failure ? `failed:${failure.error?.message || 'DSH refused the stop request'}` : 'sent')
      } catch (error) {
        setCancelState(`failed:${error?.message || 'Could not contact DSH'}`)
      }
    }

    const textColor = failed ? 'var(--danger, #ef6262)' : 'var(--dsw-alias-label-primary)'
    const phaseLabel = serving ? (rate?.state === 'live' ? `Engine generating · ${rate.tps.toFixed(1)} tokens/sec` : 'Model loaded · no new engine tokens measured') : (phaseLabels[phase] || 'Switching local model')
    const duration = done || failed ? Math.max(0, (snapshot.finishedAt || Date.now()) - snapshot.startedAt) : elapsed

    return h('div', {
      'data-maya-model-switch': phase, role: 'status', 'aria-live': 'polite',
      title: snapshot.error || `${modelName}: ${phaseLabel}. Engine token readings are shared across sessions.`,
      style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 22,
        width: '100%', maxWidth: 'var(--dsh-composer-card-max-width)', boxSizing: 'border-box',
        padding: '0 12px', margin: '0 auto 3px', fontFamily: 'var(--dsw-font-family)',
        color: failed ? 'var(--dsw-alias-state-danger, #c33)' : 'var(--dsw-alias-label-secondary)',
        fontSize: 12, lineHeight: '20px',
      },
    },
      h('style', null, '[data-chat-running]{display:none!important}@keyframes maya-switch-travel{0%{transform:translateX(-110%)}100%{transform:translateX(285%)}}@media(prefers-reduced-motion:reduce){[data-maya-model-switch] i{animation:none!important}}'),
      !done && !failed ? h('span', {
        role: 'progressbar', 'aria-label': phaseLabel,
        style: { width: 42, height: 3, borderRadius: 4, overflow: 'hidden', flex: '0 0 auto', background: 'var(--dsw-alias-border-l2)' },
      }, h('i', { style: { display: 'block', width: '38%', height: '100%', background: 'var(--dsw-alias-state-business-primary)', animation: 'maya-switch-travel 1.45s ease-in-out infinite' } })) : null,
      h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        snapshot.error ? `Load failed: ${snapshot.error}` : phaseLabel),
      !snapshot.observed ? h('span', { style: { marginLeft: 'auto', flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' } }, elapsedLabel(duration)) : null,
    )
  }

  slots.inject('conversation.input.dock', () => slots.register({
    name: 'conversation.input.dock', id: 'maya-model-switch-card', order: -20,
    label: 'Live local-model switch status',
  }, SwitchCard))
}

export const pollIntervalMs = POLL_MS
