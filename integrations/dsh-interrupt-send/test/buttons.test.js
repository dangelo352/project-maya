import test from 'node:test'
import assert from 'node:assert/strict'
import { mount } from '../client-src.js'

function setup(running, refuseCancel = false) {
  const snapshot = {sessionId: 'button-check', running}
  const input = {draft: 'LATEST_MESSAGE', phase: 'plain', attachmentIds: [], occurrences: []}
  const calls = []
  const face = {
    getSnapshot: () => snapshot,
    cancel: async () => { calls.push('cancel'); return refuseCancel ? {ok:false,error:{message:'cancel refused'}} : {ok:true} },
    beginSubmission: data => { calls.push(['echo',data.mode]); return {requestId:'one'} },
    prompt: async (parts, mode) => { calls.push(['prompt',parts[0].text,mode]); return {ok:true,value:{accepted:true}} },
  }
  const actions = {
    persistDraft: () => {}, submit: () => {calls.push('submit')},
    setDraft: text => { input.draft=text;calls.push(['draft',text]) },
  }
  const React = {
    createElement: (type, props, ...children) => ({type,props,children}),
    useState: value => [value, () => {}], useRef: current => ({current}),
  }
  let Component
  mount(React, {inject:(_,f)=>f(),register:(_,c)=>{Component=c}}, {cancel:()=>face.cancel()}, {binding:()=>({session:face})})
  const tree=Component({useSession:f=>f(snapshot),useInput:f=>f(input),inputActions:actions})
  const buttons=tree.children.filter(x=>x?.type==='button')
  return {calls,input,steer:buttons[0],override:buttons[1]}
}

test('steer sends once and clears the draft only after host acceptance', async()=>{
  const s=setup(true)
  assert.equal(s.steer.props.disabled,false)
  await Promise.all([s.steer.props.onClick(),s.steer.props.onClick()])
  assert.equal(s.calls.filter(x=>Array.isArray(x)&&x[0]==='prompt').length,1)
  assert.deepEqual(s.calls.find(x=>Array.isArray(x)&&x[0]==='prompt'),['prompt','LATEST_MESSAGE','steer'])
  assert.equal(s.input.draft,'')
})
test('override delivers after cancellation even if an auto-goal never stays idle', async()=>{
  const s=setup(true)
  await s.override.props.onClick()
  assert.equal(s.calls[0],'cancel')
  assert.deepEqual(s.calls.find(x=>Array.isArray(x)&&x[0]==='prompt'),['prompt','LATEST_MESSAGE','steer'])
  assert.equal(s.input.draft,'')
})
test('failed turn permits both buttons and refused cancellation retains the draft',async()=>{
  const idle=setup(false)
  assert.equal(idle.override.props.disabled,false)
  assert.equal(idle.steer.props.disabled,false)
  await idle.override.props.onClick()
  assert.equal(idle.calls.includes('cancel'),false)
  const denied=setup(true,true)
  await denied.override.props.onClick()
  assert.equal(denied.input.draft,'LATEST_MESSAGE')
  assert.equal(denied.calls.some(x=>Array.isArray(x)&&x[0]==='prompt'),false)
})

import { promoteQueuedMessage } from '../client-src.js'

test('queued steer promotes the existing message ID without copying attachments', async()=>{
  const calls=[]
  await promoteQueuedMessage({
    updateQueue: async(id,action)=>{calls.push([id,action]);return {ok:true}},
    cancel: async()=>{throw new Error('steer must not cancel')},
    prompt: async()=>{throw new Error('queued messages must never be resent')},
  },'queued-attachment-message')
  assert.deepEqual(calls,[['queued-attachment-message',{kind:'steer'}]])
})
test('queued Send now promotes the existing item then requests stop',async()=>{
  const calls=[]
  await promoteQueuedMessage({
    updateQueue:async(id,action)=>{calls.push(['promote',id,action.kind]);return {ok:true}},
    cancel:async()=>{calls.push(['cancel']);return {ok:true}},
  },'queued-two',true)
  assert.deepEqual(calls,[['promote','queued-two','steer'],['cancel']])
})
test('a queue item already consumed cannot cancel unrelated work',async()=>{
  await assert.rejects(promoteQueuedMessage({
    updateQueue:async()=>({ok:false,error:{message:'item no longer pending'}}),
    cancel:async()=>{throw new Error('must not cancel when promotion fails')},
  },'old-item',true),/no longer pending/)
})
