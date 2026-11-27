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

function buttonStyle() {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    flex: '0 0 auto', height: 28, padding: '0 8px', border: 'none',
    borderRadius: 'var(--dsw-radius-sm, 8px)',
    color: 'var(--dsw-alias-label-primary)', background: 'transparent',
    fontFamily: 'var(--dsw-font-family)', fontSize: 13, lineHeight: '20px',
    fontWeight: 500, whiteSpace: 'nowrap', transition: 'background-color 100ms ease',
  }
}

export function mount(React, slots, remoteSession, sessions) {
  const h = React.createElement

  function BusyDraftActions({ useSession, useInput, inputActions }) {
    const session = useSession(value => value)
    const input = useInput(value => value)
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
    const canSubmit = Boolean(sessionId && hasDraft(input)
      && ['plain', 'claimed'].includes(input?.phase)
      && typeof inputActions?.persistDraft === 'function'
      && typeof inputActions?.submit === 'function')
    if (!sessionId) return null

    const draft = input?.draft?.trim() || ''
    const canSteer = canSubmit && Boolean(draft)
      && (input?.attachmentIds?.length ?? 0) === 0
      && (input?.occurrences?.length ?? 0) === 0
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
        if (!before || before.sessionId !== sessionId || !text) {
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
        const face = sessions.binding(sessionId)?.session
        if (!face) throw new Error('The selected session is no longer available.')
        const plainText = canSteer
        const text = inputRef.current?.draft?.trim()
        if (face.getSnapshot().running) {
          const result = await face.cancel()
          if (!result?.ok) throw new Error(result?.error?.message || 'DSH refused to stop the turn.')
        }
        if (plainText && text) {
          // Enqueue through the native steer inbox after cancellation acceptance.
          // Waiting for a stable idle interval races auto-continuing goals.
          const submission = face.beginSubmission({ mode: 'steer', text, attachments: [] })
          const result = await face.prompt([{ type: 'text', text }], 'steer', undefined, submission.requestId)
          if (!result?.ok) throw new Error(result?.error?.message || 'DSH refused the new message.')
          if (sessionRef.current?.sessionId === sessionId && inputRef.current?.draft?.trim() === text) {
            actionsRef.current.setDraft('')
            actionsRef.current.persistDraft()
          }
          setNotice('Override accepted - stop requested and message delivered.')
        } else {
          await waitForIdle(() => face.getSnapshot(), sessionId)
          if (sessionRef.current?.sessionId !== sessionId) throw new Error('The selected session changed. Your draft is saved.')
          if (!hasDraft(inputRef.current)) throw new Error('The draft changed before sending.')
          actionsRef.current.submit()
          setNotice('Turn stopped - draft submitted.')
        }
      } catch (error) {
        setNotice(error?.message || 'Override failed; your draft remains in the composer.')
      } finally {
        actionRef.current = false
        setBusyAction('')
      }
    }

    const disabled = !canSubmit || Boolean(busyAction)
    return h('div', {
      'data-dsh-busy-draft-actions': '', role: 'group', 'aria-label': 'Message delivery',
      style: { display: 'inline-flex', alignItems: 'center', flex: '0 0 auto', gap: 2 },
    },
      h('style', null, `[data-dsh-busy-draft-actions] button:enabled{cursor:pointer}[data-dsh-busy-draft-actions] button:enabled:hover{background:var(--dsw-alias-interactive-bg-hover)}[data-dsh-busy-draft-actions] button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}[data-dsh-busy-draft-actions] button:disabled{cursor:default;color:var(--dsw-alias-label-secondary)}@media(pointer:coarse){[data-dsh-busy-draft-actions] button{min-height:36px}}`),
      notice ? h('span', { role: 'status', 'aria-live': 'polite', title: notice, style: { maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--dsw-alias-label-primary)' } }, notice) : null,
      h('button', {
        type: 'button', onClick: steer, disabled: disabled || !canSteer,
        title: canSteer
          ? 'Send this text into the current turn; it is picked up at the next step boundary.'
          : 'Steer supports plain text only. Use Override for attachments, references, or slash commands.',
        style: buttonStyle(),
      }, busyAction === 'steer' ? 'Steering…' : 'Steer'),
      h('button', {
        type: 'button', onClick: override, disabled,
        title: 'Stop the current turn, wait for DSH to become idle, then send the full composer draft as a new turn.',
        style: buttonStyle(),
      }, busyAction === 'override' ? 'Overriding…' : 'Override'),
    )
  }

  slots.inject('conversation.input.right', () => slots.register({
    name: 'conversation.input.right',
    id: 'dsh-busy-draft-actions',
    order: 100,
    label: 'Steer the active turn or stop it and send a new turn',
  }, BusyDraftActions))
}

export const timing = { pollMs: WAIT_POLL_MS, idleStableMs: IDLE_STABLE_MS, timeoutMs: CANCEL_TIMEOUT_MS }
