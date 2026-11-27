const POLL_MS = 1000
const STALE_MS = 3200
const ROUTE = '/api/dsh-server-tps'

export function formatPill(snapshot, now = Date.now()) {
  if (!snapshot || !Number.isFinite(snapshot.timestamp)
    || !Number.isFinite(snapshot.approx_tps) || !Number.isFinite(snapshot.active_streams)) {
    return { text: '~TPS · unavailable', state: 'unavailable', title: 'LLM stream rate unavailable' }
  }
  const age = now - snapshot.timestamp
  if (age < -2000 || age > STALE_MS) {
    return { text: '~TPS · stale', state: 'stale', title: 'LLM stream rate is stale' }
  }
  const speed = snapshot.approx_tps.toFixed(1)
  const activity = `${snapshot.active_streams} active stream${snapshot.active_streams === 1 ? '' : 's'}`
  return {
    text: `~${speed} TPS · ${activity}`,
    state: 'live',
    title: `Approximate output delta rate over ${snapshot.window_ms || 2000} ms across all DSH providers`,
  }
}

export function mount(React, slots, fetchImpl = fetch) {
  const h = React.createElement
  function Pill() {
    const [snapshot, setSnapshot] = React.useState(null)
    const [failed, setFailed] = React.useState(false)
    React.useEffect(() => {
      let active = true
      let timer
      let requestController
      const poll = async () => {
        try {
          requestController = new AbortController()
          const response = await fetchImpl(ROUTE, {
            cache: 'no-store',
            signal: requestController.signal,
          })
          if (!response.ok) throw new Error('unavailable')
          const data = await response.json()
          if (active) { setSnapshot(data); setFailed(false) }
        } catch {
          if (active) setFailed(true)
        } finally {
          requestController = undefined
          if (active) timer = setTimeout(poll, POLL_MS)
        }
      }
      poll()
      return () => { active = false; clearTimeout(timer); requestController?.abort() }
    }, [])

    const status = failed
      ? { text: '~TPS · disconnected', state: 'stale', title: 'DSH aggregate stream endpoint is unreachable' }
      : formatPill(snapshot)
    return h('span', {
      title: status.title,
      'aria-live': 'polite',
      'data-dsh-tps-state': status.state,
      style: {
        display: 'inline-flex', alignItems: 'center', maxWidth: '100%',
        padding: '3px 9px', borderRadius: '999px', fontSize: '12px', lineHeight: 1.4,
        color: status.state === 'live' && !failed ? 'var(--fg)' : 'var(--fg-muted)',
        background: 'var(--bg-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
    }, status.text)
  }
  slots.inject('conversation.composer.dock', () => slots.register({
    name: 'conversation.composer.dock', id: 'dsh-server-tps', order: 20, label: 'DSH approximate TPS',
  }, Pill))
}

export const pollIntervalMs = POLL_MS
