const WAIT_POLL_MS = 100
const IDLE_STABLE_MS = 250
const CANCEL_TIMEOUT_MS = 120_000

export async function waitForIdle(readSession, sessionId, options = {}) {
  const pollMs = options.pollMs ?? WAIT_POLL_MS
  const stableMs = options.stableMs ?? IDLE_STABLE_MS
  const timeoutMs = options.timeoutMs ?? CANCEL_TIMEOUT_MS
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const started = now()
  let idleSince

  while (now() - started <= timeoutMs) {
    const session = readSession()
    if (!session || session.sessionId !== sessionId || session.removed) {
      throw new Error('The selected session changed while stopping; your draft is still saved.')
    }
    if (!session.running) {
      idleSince ??= now()
      if (now() - idleSince >= stableMs) return
    } else {
      idleSince = undefined
    }
    await sleep(pollMs)
  }

  throw new Error('DSH has not reached idle yet. Your draft is still in the composer; try again after the current tool finishes.')
}

function hasDraft(input) {
  return Boolean(input && (input.draft?.trim() || input.attachmentIds?.length))
}

function buttonStyle(primary = false) {
  return {
    flex: '0 0 auto', border: '1px solid var(--border, rgba(150,160,180,.24))',
    borderRadius: 9, minHeight: 30, padding: '5px 10px',
    color: 'var(--fg, #ededed)',
    background: primary ? 'var(--accent-soft, rgba(105,145,255,.16))' : 'var(--bg-soft, rgba(127,127,127,.1))',
    cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 600,
  }
}

export function mount(React, slots, remoteSession, sessions) {
  const h = React.createElement

  function BusyDraftActions({ session, input, inputActions }) {
    const [busyAction, setBusyAction] = React.useState('')
    const [notice, setNotice] = React.useState('')
    const sessionRef = React.useRef(session)
    const inputRef = React.useRef(input)
    const actionsRef = React.useRef(inputActions)
    const actionRef = React.useRef(false)
    sessionRef.current = session
    inputRef.current = input
    actionsRef.current = inputActions

    const sessionId = session?.sessionId
    const canSubmit = Boolean(session?.running && sessionId && hasDraft(input)
      && ['plain', 'claimed'].includes(input?.phase)
      && typeof inputActions?.persistDraft === 'function'
      && typeof inputActions?.submit === 'function')
    if (!canSubmit && !busyAction) return null

    const draft = input?.draft?.trim() || ''
    const canSteer = canSubmit && Boolean(draft)
      && input?.attachmentIds?.length === 0
      && input?.occurrences?.length === 0
      && !input?.claim
      && !draft.startsWith('/')
      && typeof sessions?.binding === 'function'

    const steer = async () => {
      if (actionRef.current || !canSteer) return
      actionRef.current = true
      setBusyAction('steer')
      setNotice('')
      try {
        const before = sessionRef.current
        const text = inputRef.current?.draft?.trim()
        if (!before?.running || before.sessionId !== sessionId || !text) {
          throw new Error('The active turn or draft changed. Nothing was sent.')
        }
        actionsRef.current.persistDraft()
        const binding = sessions.binding(sessionId)
        if (!binding?.session?.prompt || !binding.session.beginSubmission) {
          throw new Error('DSH could not access the active session. Your draft is still saved.')
        }
        const submission = binding.session.beginSubmission({ mode: 'steer', text, attachments: [] })
        const result = await binding.session.prompt(
          [{ type: 'text', text }], 'steer', undefined, submission.requestId,
        )
        if (!result?.ok) throw new Error(result?.error?.message || 'DSH did not accept the steer.')
        const latest = sessionRef.current
        const latestInput = inputRef.current
        if (latest?.sessionId !== sessionId || latestInput?.draft?.trim() !== text) {
          throw new Error('The steer was accepted, but the composer changed before it could be cleared. Check the conversation before resending.')
        }
        actionsRef.current.setDraft('')
        setNotice('Steer accepted · takes effect at the next step boundary.')
      } catch (error) {
        setNotice(error?.message || 'Steer failed; your draft remains in the composer.')
      } finally {
        actionRef.current = false
        setBusyAction('')
      }
    }

    const override = async () => {
      if (actionRef.current || !canSubmit || typeof remoteSession?.cancel !== 'function') return
      actionRef.current = true
      setBusyAction('override')
      setNotice('Saving draft and stopping the active turn…')
      try {
        actionsRef.current.persistDraft()
        const result = await remoteSession.cancel({ sessionId })
        if (result?.ok === false || result?.accepted === false) {
          throw new Error(result.error?.message || result.message || 'DSH did not accept the stop request.')
        }
        await waitForIdle(() => sessionRef.current, sessionId)
        const latestSession = sessionRef.current
        const latestInput = inputRef.current
        if (latestSession?.sessionId !== sessionId || latestSession.running) {
          throw new Error('The session started again before the draft could be sent. Your draft is still saved.')
        }
        if (!hasDraft(latestInput) || !['plain', 'claimed'].includes(latestInput?.phase)) {
          throw new Error('The composer changed while DSH was stopping. Your draft is still saved.')
        }
        actionsRef.current.submit()
        setNotice('Previous turn stopped · latest draft sent as a new turn.')
      } catch (error) {
        setNotice(error?.message || 'Override failed; your draft remains in the composer.')
      } finally {
        actionRef.current = false
        setBusyAction('')
      }
    }

    const disabled = !canSubmit || Boolean(busyAction)
    return h('div', {
      'data-dsh-busy-draft-actions': '',
      style: { display: 'flex', alignItems: 'center', gap: 6, minHeight: 30 },
    },
      notice ? h('span', {
        role: 'status', 'aria-live': 'polite',
        style: { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-muted, #9ca3af)', fontSize: 10 },
      }, notice) : null,
      h('button', {
        type: 'button', onClick: steer, disabled: disabled || !canSteer,
        title: canSteer
          ? 'Send this text into the current turn; it is picked up at the next step boundary.'
          : 'Steer supports plain text only. Use Override for attachments, references, or slash commands.',
        style: { ...buttonStyle(false), opacity: disabled || !canSteer ? .48 : 1 },
      }, busyAction === 'steer' ? 'Steering…' : 'Steer'),
      h('button', {
        type: 'button', onClick: override, disabled,
        title: 'Stop the current turn, wait for DSH to become idle, then send the full composer draft as a new turn.',
        style: { ...buttonStyle(true), opacity: disabled ? .55 : 1 },
      }, busyAction === 'override' ? 'Overriding…' : 'Override'),
    )
  }

  slots.inject('conversation.input.dock', () => slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-busy-draft-actions',
    order: 100,
    label: 'Steer the active turn or stop it and send a new turn',
  }, BusyDraftActions))
}

export const timing = { pollMs: WAIT_POLL_MS, idleStableMs: IDLE_STABLE_MS, timeoutMs: CANCEL_TIMEOUT_MS }
