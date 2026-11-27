import test from 'node:test'
import assert from 'node:assert/strict'
import { compactionLifecycle } from '../client-src.js'
const event=(type,time,id='c1',extra={})=>({type:'event',event:{type,time,data:{compactionId:id,...extra}}})
test('compaction status follows start, summary, and end events',()=>{
 const start=event('compaction/start',1000)
 assert.equal(compactionLifecycle([start]).phase,'compacting')
 const summary=event('compaction/summary',2000)
 assert.equal(compactionLifecycle([start,summary]).phase,'saving-summary')
 const end=event('compaction/end',3000)
 assert.deepEqual(compactionLifecycle([start,summary,end]),{id:'c1',phase:'compacted',startedAt:1000,finishedAt:3000})
})
test('failed compaction is shown as failed, never success',()=>{
 assert.equal(compactionLifecycle([event('compaction/start',1000),event('compaction/end',2000,'c1',{error:['failed']})]).phase,'compaction-error')
})
test('unrelated end cannot clear another compaction; aborted turn clears stale activity',()=>{
 assert.equal(compactionLifecycle([event('compaction/start',1000),event('compaction/end',2000,'other')]).phase,'compacting')
 assert.equal(compactionLifecycle([event('compaction/start',1000),event('turn/end',2000,'unused',{reason:{kind:'aborted'}})]),null)
})
