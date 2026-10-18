import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatSessionReferenceMention, parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
import { createAdapter } from '../src/mobile/adapter.js'
import { projectEvent } from '../src/mobile/projection.js'
import { mergeGroupProgress } from '../../apps/mobile/src/logic/group-work.ts'
import { sessionMention } from '../../apps/mobile/src/logic/composer.ts'

function fixture() {
  const calls=[]
  const view={revision:1,bots:[{id:'a',name:'Alpha',sessionId:'a-chat',parts:[]},{id:'b',name:'Beta',sessionId:'b-chat',parts:[]}],rooms:[{id:'room',name:'Group',members:['a','b']}],models:[{ref:'p/m',name:'Model'}],permissions:{options:[{value:'workspace-write',name:'Workspace'}]},work:{bots:{a:{tool:'read_file',since:100},foreign:{tool:'private'}},approvals:[{id:'approval-1',botId:'a',roomId:'room',sessionId:'hidden-member',tool:'shell',reason:'ds-bot-test-key',detail:{code:'echo ds-bot-test-key'},at:200,answerable:true}]}}
  const items=[{sessionId:'a-chat',blank:false,updatedAt:20},{sessionId:'b-chat',blank:false,updatedAt:30},{sessionId:'outside',blank:false,updatedAt:40},{sessionId:'child',origin:'subagent',blank:false,updatedAt:50},{sessionId:'blank',blank:true,updatedAt:60},{sessionId:'hidden-member',blank:false,updatedAt:70}]
  const rt={state:{rooms:{room:{members:['a','b'],sessions:{a:'hidden-member'}}}},groupOwners:new Map([['hidden-member',{roomId:'room',botId:'a'}]]),readOnly:()=>undefined,redactSecrets:value=>String(value).replaceAll('ds-bot-test-key','[redacted]'),resolveAgent:async id=>({session:{id}}),answerApproval:(id,choice)=>{calls.push(['approval',id,choice]);view.work.approvals=[]},teamCall:async(endpoint,payload)=>{calls.push(['team',endpoint,payload]);if(endpoint==='state')return{ok:true,value:view};if(endpoint==='efforts')return{ok:true,value:{efforts:[{id:'low',name:'Low'}]}};return{ok:true,value:{id:payload?.id}}},ctx:{sessionReferenceResolver:{listCandidates:async()=>items.map(item=>({...item,label:item.sessionId,createdAt:10}))},sessionController:{list:async()=>({items}),prompt:async payload=>{calls.push(['prompt',payload]);return{accepted:true}}}}}
  const adapter=createAdapter(rt);adapter.setApprovalBroker({list:()=>({requests:[]}),dispose(){}},{authorizeDevice:()=>true});return{rt,adapter,view,calls,items}
}

test('mobile reference codec agrees with the public Harness codec for Unicode and escaped labels',()=>{
  for(const [sessionId,label] of [['plain','Chat with Beta'],['会话/🪄','Label ] \\ notes']]){
    const text=sessionMention(sessionId,label)
    assert.equal(text,formatSessionReferenceMention({sessionId,label}))
    assert.deepEqual(parseSessionReferenceText(text).references,[{sessionId,label}])
  }
})
test('reference discovery includes other Bots and recent ordinary chats, never hidden members, subagents or blank sessions',async()=>{
  const {adapter}=fixture();const result=await adapter.action('reference-chats',{conversationId:'a'})
  assert.equal(result.available,true);assert.deepEqual(result.chats.map(row=>row.sessionId),['b-chat','outside'])
})
test('references reach the public prompt unchanged, while forged or hidden references never submit',async()=>{
  const {adapter,calls}=fixture();const text=sessionMention('b-chat','Chat with Beta')+'\n\nRead this'
  await adapter.submit({conversationId:'a',sessionId:'a-chat',requestId:'valid',text})
  assert.equal(calls.find(([kind])=>kind==='prompt')[1].content[0].text,text)
  for(const id of ['hidden-member','child','foreign','a-chat']){
    await assert.rejects(adapter.submit({conversationId:'a',sessionId:'a-chat',requestId:'bad-'+id,text:sessionMention(id,id)}),error=>error.status===403)
  }
  assert.equal(calls.filter(([kind])=>kind==='prompt').length,1)
})
test('reference ownership is checked again after attachment admission yields',async()=>{
  const {adapter,rt,calls}=fixture();rt.ctx.fileUploads={uploadStream:async()=>{rt.groupOwners.set('outside',{roomId:'room',botId:'b'});return{receiptId:'file'}}}
  const file=await adapter.upload('a','a-chat',{name:'note.txt',mediaType:'text/plain'},Buffer.from('test'))
  await assert.rejects(adapter.submit({conversationId:'a',sessionId:'a-chat',requestId:'race',text:sessionMention('outside','Recent'),attachments:[file.receiptId]}),error=>error.status===403)
  assert.equal(calls.filter(([kind])=>kind==='prompt').length,0)
})
test('mobile exposes thinking levels and permission presets and forwards only supported update fields',async()=>{
  const {adapter,calls}=fixture();assert.equal((await adapter.state()).permissions.options[0].value,'workspace-write')
  assert.deepEqual(await adapter.action('efforts',{ref:'p/m'}),{efforts:[{id:'low',name:'Low'}]})
  await assert.rejects(adapter.action('efforts',{ref:'private/model'}),error=>error.status===400)
  await adapter.action('update-bot',{id:'a',effort:'low',permission:'workspace-write',untrusted:'drop'})
  assert.deepEqual(calls.find(([kind,endpoint])=>kind==='team'&&endpoint==='update-bot')[2],{id:'a',effort:'low',permission:'workspace-write'})
})
test('mobile update requests can select only a checked target and repair mode, never an arbitrary install source',async()=>{
  const {adapter,calls}=fixture()
  await adapter.action('update-install',{targetId:'verified-release:commit',repair:true,spec:'https://untrusted.invalid/plugin.tgz',registry:'https://untrusted.invalid'})
  assert.deepEqual(calls.find(([kind,endpoint])=>kind==='team'&&endpoint==='update-install')[2],{targetId:'verified-release:commit',repair:true})
})
test('mobile group permissions use only the host presets and can restore individual permissions',async()=>{
  const {adapter,calls,view}=fixture()
  view.rooms[0].permission='workspace-write'
  assert.equal((await adapter.state()).rooms[0].permission,'workspace-write')
  await adapter.action('update-room',{id:'room',permission:'workspace-write',untrusted:'drop'})
  await adapter.action('update-room',{id:'room',permission:null})
  assert.deepEqual(calls.filter(([kind,endpoint])=>kind==='team'&&endpoint==='update-room').map(([, , body])=>body),[
    {id:'room',permission:'workspace-write'},{id:'room',permission:null},
  ])
  for(const permission of ['auto','danger-full-access','unknown',false,{},123])
    await assert.rejects(adapter.action('update-room',{id:'room',permission}),error=>error.status===400)
  await assert.rejects(adapter.action('update-room',{id:'foreign',permission:'workspace-write'}),error=>error.status===404)
  assert.equal(calls.filter(([kind,endpoint])=>kind==='team'&&endpoint==='update-room').length,2)
})
test('mobile work status carries bounded redacted progress and switching without private or foreign fields',async()=>{
  const {adapter,view}=fixture()
  const progress={tool:'read_file',said:'Checking ds-bot-test-key',note:'ds-bot-test-key '+ 'x'.repeat(500),target:'ds-bot-test-key.txt',switching:true,since:100,private:'never expose'}
  view.work.bots.a={...progress,roomId:'room'}
  view.work.rooms={room:[{...progress,botId:'a',speaking:true},{botId:'foreign',said:'hidden'}],outside:[{botId:'b',said:'hidden'}]}
  const work=(await adapter.state()).work
  assert.equal(work.bots.a.said,'Checking [redacted]')
  assert.equal(work.bots.a.target,'[redacted].txt')
  assert.equal(work.bots.a.switching,true)
  assert.equal(work.bots.a.note,'[redacted] '+'x'.repeat(289)+'\n[Detail truncated]')
  assert.equal(work.rooms.room.length,1)
  assert.equal(work.rooms.room[0].said,work.bots.a.said)
  assert.equal(work.rooms.room[0].switching,true)
  assert.equal(work.rooms.room[0].speaking,true)
  assert.equal(work.bots.a.private,undefined)
  assert.equal(work.rooms.room[0].private,undefined)
  assert.equal(work.bots.foreign,undefined)
  assert.equal(work.rooms.outside,undefined)
  assert.ok(!JSON.stringify(work).includes('ds-bot-test-key'))
  view.work.bots.a.roomId='outside'
  assert.equal((await adapter.state()).work.bots.a,undefined)
})
test('mobile waiting status exposes only scoped redacted names and caps each recipient type',async()=>{
  const {adapter,view}=fixture()
  view.bots[1].name='Beta ds-bot-test-key'
  view.bots.push({id:'c',name:'Outside'},{id:'empty',name:'Empty'},
    ...Array.from({length:12},(_,i)=>({id:`bot-${i}`,name:`Bot ${i}`})))
  view.rooms.push({id:'other-room',name:'Other group',members:['c']},
    ...Array.from({length:12},(_,i)=>({id:`group-${i}`,name:`Group ${i}`,members:[]})))
  view.work.bots.a={roomId:'room',tool:'handoff'}
  view.work.bots.b={tool:'handoff'}
  view.work.bots.empty={tool:'read'}
  view.work.rooms={room:[{botId:'a'}]}
  view.work.waiting={
    a:{bots:['b','c','missing'],rooms:['room','other-room','missing'],for:['private-session']},
    b:{bots:Array.from({length:12},(_,i)=>`bot-${i}`),rooms:Array.from({length:12},(_,i)=>`group-${i}`),for:['private-session']},
    empty:{bots:['missing'],rooms:['missing'],for:['private-session']},
    foreign:{bots:['b'],rooms:['room'],for:['private-session']},
  }
  const work=(await adapter.state()).work
  assert.deepEqual(work.bots.a.waiting,{bots:['Beta [redacted]'],rooms:['Group']})
  assert.deepEqual(work.rooms.room[0].waiting,{bots:['Beta [redacted]'],rooms:['Group']})
  assert.deepEqual(work.bots.b.waiting.bots,Array.from({length:10},(_,i)=>`Bot ${i}`))
  assert.deepEqual(work.bots.b.waiting.rooms,Array.from({length:10},(_,i)=>`Group ${i}`))
  assert.equal(work.bots.empty.waiting,undefined)
  assert.equal(work.bots.foreign,undefined)
  assert.ok(!JSON.stringify(work).includes('private-session'))
  assert.ok(!JSON.stringify(work).includes('missing'))
})
test('live mobile group replies are scoped, redacted and bounded before being returned',async()=>{
  const {adapter,rt}=fixture()
  const oldCall=rt.teamCall
  rt.teamCall=async(endpoint,payload)=>endpoint==='room-progress'?{ok:true,value:[{callId:'relay',speaking:'foreign',private:'hidden',replies:[
    {botId:'a',name:'private metadata',text:'Working ds-bot-test-key',time:123,internal:'hidden'},
    {botId:'b',text:'x'.repeat(20000),time:124}, {botId:'foreign',text:'never show'},
  ]}]}:oldCall(endpoint,payload)
  const rounds=await adapter.action('room-progress',{roomId:'room'})
  assert.equal(rounds[0].speaking,null)
  assert.equal(rounds[0].private,undefined)
  assert.deepEqual(rounds[0].replies[0],{groupReplyId:'relay:0',botId:'a',text:'Working [redacted]',time:123})
  assert.equal(rounds[0].replies.length,2)
  assert.ok(rounds[0].replies[1].text.length<12100)
  await assert.rejects(adapter.action('room-progress',{roomId:'foreign'}),error=>error.status===404)
})
test('formatted live replies match durable identity after filtering earlier entries',async()=>{
  const {adapter,rt,view}=fixture()
  const replies=[{botId:'foreign',text:'hidden',time:100},{botId:'a',name:'Alpha',text:'{"count":1,"ok":true}',time:200}]
  const oldCall=rt.teamCall
  rt.teamCall=async(endpoint,payload)=>endpoint==='room-progress'?{ok:true,value:[{callId:'relay',speaking:null,replies}]}:oldCall(endpoint,payload)
  const rounds=await adapter.action('room-progress',{roomId:'room'})
  assert.equal(rounds[0].replies[0].groupReplyId,'relay:1')
  assert.notEqual(rounds[0].replies[0].text,replies[1].text)
  const durable=projectEvent({type:'tool/result',seq:10,time:300,data:{message:{source:{callId:'relay'},content:[{type:'text',text:JSON.stringify({replies})}]}}},
    {sessionId:'room',kind:'room',calls:new Map([['relay',{name:'group_relay'}]])}).filter(message=>message.author.id==='a')
  assert.equal(durable[0].groupReplyId,'relay:1')
  assert.deepEqual(mergeGroupProgress(durable,rounds,view.rooms[0],view),durable)
})

test('group approvals share the host promise, redact details and settle once without opening hidden history',async()=>{
  const {adapter,calls}=fixture();const requests=(await adapter.action('approvals')).requests;assert.equal(requests[0].conversationId,'room');assert.equal(requests[0].reason,'[redacted]\n\necho [redacted]')
  assert.deepEqual(await adapter.action('approval-resolve',{id:'group:approval-1',decision:'allowed-once'},undefined,{deviceId:'device'}),{accepted:true})
  await assert.rejects(adapter.action('approval-resolve',{id:'group:approval-1',decision:'rejected'},undefined,{deviceId:'device'}),error=>error.status===409)
  assert.deepEqual(calls.filter(([kind])=>kind==='approval'),[['approval','approval-1','allow']])
})
test('group approval cannot be answered by a revoked device or after its member leaves',async()=>{
  const first=fixture();let checks=0;first.adapter.setApprovalBroker({list:()=>({requests:[]})},{authorizeDevice:()=>++checks===1})
  await assert.rejects(first.adapter.action('approval-resolve',{id:'group:approval-1',decision:'allowed-once'},undefined,{deviceId:'device'}),error=>error.status===401)
  assert.equal(first.calls.filter(([kind])=>kind==='approval').length,0)
  const second=fixture();second.rt.state.rooms.room.members=['b']
  await assert.rejects(second.adapter.action('approval-resolve',{id:'group:approval-1',decision:'allowed-once'},undefined,{deviceId:'device'}),error=>error.status===409)
  assert.equal(second.calls.filter(([kind])=>kind==='approval').length,0)
})
