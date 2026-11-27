export const name = 'dsh-step-override'
export const inject = []
export const ROUTE = '/api/dsh-step-override'

export function overrideStep(ctx, request) {
  const agent = ctx.agents.get(request.sessionId)
  if (!agent) throw new Error('Session is not attached.')
  const goals = ctx.get('goals') || agent.ctx.get('goals')
  if (!goals) throw new Error('Goal service is not available; no step was interrupted.')
  const goal = goals.get(agent)
  if (request.inspect === true) return { accepted: true, inspection: true, goalPhase: goal?.phase || null, goalActivation: goal?.activation || null }
  const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
  const message = pending.find(item => request.itemId ? item.id === request.itemId
    : request.requestId && item.source?.rpcId === request.requestId)
  if (!message || message.source?.kind !== 'user') throw new Error('Message has already been consumed; no step was interrupted.')
  // Refresh continuation authority before aborting. The goal driver's old
  // attempt is revision-fenced, so it cannot pause this newly armed revision.
  if (goal?.phase === 'active' && goal.activation === 'armed') {
    if (goal.roundsStarted >= goal.maxGoalRounds) throw new Error('Goal round limit reached; no step was interrupted.')
    goals.disarm(agent)
    goals.resume(agent, { id: goal.id, revision: goal.revision })
  }
  // One synchronous Host operation: preserve the exact content/attachments,
  // abort the current activity, then wake the driver with this same message.
  agent.inbox.remove(message.id)
  if (agent.status === 'running') agent.cancel({ kind: 'hook', reason: 'user-step-override' }, { keepInbox: true })
  agent.steer(message)
  return { accepted: true, messageId: message.id, goalPreserved: goal?.phase === 'active' }
}

export function apply(ctx) {
  ctx.inject(['agents', 'connection'], owner => {
    owner.effect(() => owner.connection.fetch.register({
      path: ROUTE, methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        try {
          const data = await request.json()
          if (typeof data.sessionId !== 'string' || (!data.itemId && !data.requestId)) {
            return Response.json({error:'Missing session or pending message identity.'}, {status:400})
          }
          return Response.json(overrideStep(owner, data), {headers:{'cache-control':'no-store'}})
        } catch(error) { return Response.json({error:error.message}, {status:409}) }
      },
    }), 'Goal-preserving step override')
  })
}
export default apply
