import test from 'node:test'
import assert from 'node:assert/strict'
import { overrideStep } from '../step-override.js'
import { promoteQueuedMessage, requestStepOverride } from '../client-src.js'

function fixture() {
  const message={id:'queued-one',source:{kind:'user',rpcId:'receipt-one'},content:[{type:'text',text:'Latest direction'},{type:'image',attachment:{attachmentId:'image-one'}}]}
  const goal={id:'goal-one',revision:7,phase:'active',activation:'armed',roundsStarted:12,maxGoalRounds:256}
  const oldAttemptRevision=goal.revision
  const calls=[]
  const agent={status:'running',inbox:{nextTurn:[message],nextStep:[],remove(id){calls.push('remove');this.nextTurn=this.nextTurn.filter(x=>x.id!==id);this.nextStep=this.nextStep.filter(x=>x.id!==id)}},
    cancel(cause,options){calls.push(['cancel',cause,options]);if(goal.revision===oldAttemptRevision)goal.phase='paused';this.aborted=true},
    steer(item){calls.push('wake');assert.equal(this.aborted,true);this.delivered=item},
  }
  const ctx={agents:{get:()=>agent},goals:{get:()=>({...goal}),disarm:()=>{goal.activation='disarmed'},resume:(_,ref)=>{assert.equal(ref.revision,goal.revision);goal.revision++;goal.phase='active';goal.activation='armed'}}}
  ctx.get = name => name === 'goals' ? ctx.goals : undefined
  return {ctx,agent,goal,message,calls}
}
test('queued Override preserves goal, round count, message identity and attachments, then wakes',()=>{
  const s=fixture()
  const result=overrideStep(s.ctx,{sessionId:'session-one',itemId:'queued-one'})
  assert.equal(result.accepted,true)
  assert.equal(s.agent.delivered,s.message)
  assert.equal(s.goal.phase,'active')
  assert.equal(s.goal.activation,'armed')
  assert.equal(s.goal.roundsStarted,12)
  assert.deepEqual(s.calls,['remove',['cancel',{kind:'hook',reason:'user-step-override'},{keepInbox:true}],'wake'])
})
test('composer Override locates an already admitted message by request receipt',()=>{
  const s=fixture()
  overrideStep(s.ctx,{sessionId:'session-one',requestId:'receipt-one'})
  assert.equal(s.agent.delivered,s.message)
})
test('already consumed queued item cannot stop unrelated work or alter the goal',()=>{
  const s=fixture()
  assert.throws(()=>overrideStep(s.ctx,{sessionId:'session-one',itemId:'missing'}),/already been consumed/)
  assert.deepEqual(s.calls,[])
  assert.equal(s.goal.revision,7)
})
test('Send now uses the host step override and never user-cancels the goal',async()=>{
  await promoteQueuedMessage({cancel:()=>assert.fail('user cancel is forbidden')},'queued-one',true,async id=>assert.equal(id,'queued-one'))
})
test('regular queued Steer remains a normal inbox promotion',async()=>{
  await promoteQueuedMessage({updateQueue:async(id,action)=>{assert.equal(id,'queued-one');assert.deepEqual(action,{kind:'steer'});return{ok:true}}},'queued-one')
})
test('missing override service fails safely and does not stop the goal',async()=>{
  await assert.rejects(requestStepOverride('session-one',{itemId:'queued-one'},async()=>({ok:false,json:async()=>({error:'service not loaded'})})),/service not loaded/)
})

test('Cordis goal service is resolved without undeclared property access',()=>{
  const s=fixture()
  const goals=s.ctx.goals
  s.ctx.get=name=>name==='goals'?goals:undefined
  Object.defineProperty(s.ctx,'goals',{get(){throw new Error('cannot get property goals without inject')}})
  assert.equal(overrideStep(s.ctx,{sessionId:'session-one',itemId:'queued-one'}).accepted,true)
  assert.equal(s.goal.phase,'active')
})
