const POLL_MS = 1000
const STALE_MS = 3200
const ROUTE = '/api/dsh-server-tps'

export function formatPill(snapshot, now = Date.now()) {
  if (!snapshot || !Number.isFinite(snapshot.timestamp)
    || !Number.isFinite(snapshot.tps)) {
    return { text: 'TPS unavailable', state: 'unavailable', title: 'Inference token counter unavailable' }
  }
  const age = now - snapshot.timestamp
  if (age < -2000 || age > STALE_MS) {
    return { text: 'TPS unavailable', state: 'stale', title: 'Inference token counter is stale' }
  }
  const speed = snapshot.tps.toFixed(1)
  return {
    text: `${speed} TPS`,
    state: snapshot.state === 'unavailable' ? 'unavailable' : snapshot.state,
    title: `Generated tokens per second, measured from local inference-engine counters over up to ${snapshot.window_ms || 2000} ms`,
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
      ? { text: 'TPS unavailable', state: 'stale', title: 'DSH inference token counter is unreachable' }
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
    name: 'conversation.composer.dock', id: 'dsh-server-tps', order: 20, label: 'DSH generated TPS',
  }, Pill))
}

export const pollIntervalMs = POLL_MS
