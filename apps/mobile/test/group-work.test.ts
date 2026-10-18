import assert from "node:assert/strict";
import { test } from "node:test";
import { type GroupRound, groupWorkMembers, mergeGroupProgress, ownBotWork, waitingNames, workDescription } from "../src/logic/group-work.ts";
import type { Message } from "@ds-bot/mobile-sdk";
import type { Room, TeamState } from "../src/types.ts";

test("group progress prefers room work and includes only this group's members and approvals", () => {
  const room: Room = {id:"g",name:"Group",members:["a","b","c","missing"]};
  const team: TeamState = {
    rooms:[room],models:[],
    bots:[{id:"a",name:"Alpha"},{id:"b",name:"Beta"},{id:"c",name:"Gamma"},{id:"outside",name:"Other"}],
    work:{bots:{a:{roomId:"g",said:"old"},b:{roomId:"other",said:"private"},c:{roomId:"other",said:"private"}},
      rooms:{g:[{botId:"a",said:"live progress",switching:true},{botId:"outside",said:"hidden"}]},
      approvals:[{id:"wait-b",botId:"b",roomId:"g"},{id:"wait-c",botId:"c",roomId:"other"}]},
  };
  const rows = groupWorkMembers(room,team);
  assert.deepEqual(rows.map(row=>row.bot.id),["a","b"]);
  assert.equal(rows[0].work?.said,"live progress");
  assert.equal(rows[0].work?.switching,true);
  assert.equal(rows[1].waiting,true);
  assert.equal(rows[1].work,undefined);
  assert.deepEqual(groupWorkMembers(room,{...team,work:undefined}),[]);
  assert.equal(ownBotWork("a",team),undefined);
  assert.equal(ownBotWork("outside",team),undefined);
  const personal={said:"Reading my project",switching:true};
  team.work!.bots.a=personal;
  assert.equal(ownBotWork("a",team),personal);
});

test("work descriptions prefer actual progress and keep the compact status bounded", () => {
  assert.equal(workDescription({said:"Reading\n   project",note:"fallback",target:"file"}),"Reading project");
  assert.equal(workDescription({note:"Checking access",target:"file"}),"Checking access");
  assert.equal(workDescription({target:"notes.md"}),"notes.md");
  assert.equal(workDescription({said:"x".repeat(1000)}).length,180);
  assert.equal(workDescription({switching:true}),"");
  assert.equal(workDescription(),"");
});

test("waiting status combines only named Bot and group recipients", () => {
  assert.deepEqual(waitingNames({waiting:{bots:["Alpha","Beta"],rooms:["Beta","Group"]}}),["Alpha","Beta","Group"]);
  assert.deepEqual(waitingNames({waiting:{bots:Array.from({length:10},(_,i)=>`Bot ${i}`),rooms:Array.from({length:10},(_,i)=>`Group ${i}`)}}).length,20);
  assert.deepEqual(waitingNames({waiting:{bots:[],rooms:[]}}),[]);
  assert.deepEqual(waitingNames(),[]);
});

test("live group replies stay ordered and durable results replace them without rewriting cached messages", () => {
  const room: Room={id:"g",name:"Group",members:["a"]};
  const team: TeamState={bots:[{id:"a",name:"Alpha"},{id:"b",name:"Other"}],rooms:[room],models:[]};
  const before: Message={id:"user",sessionId:"g",seq:1,role:"user",text:"Please work",createdAt:100};
  const after: Message={id:"later",sessionId:"g",seq:4,role:"user",text:"Another task",createdAt:400};
  const rounds: GroupRound[]=[{callId:"relay",speaking:"a",replies:[{botId:"a",text:"Reading files",time:200},{botId:"a",text:"Indexing",time:300},{botId:"b",text:"private",time:250},{botId:"a",kind:"working",text:"status",time:250}]}];
  const original=[before,after];
  const live=mergeGroupProgress(original,rounds,room,team);
  assert.deepEqual(live.map(message=>message.text),["Please work","Reading files","Indexing","Another task"]);
  assert.deepEqual(original,[before,after]);
  assert.deepEqual(mergeGroupProgress(live,rounds,room,team),live);
  const durable: Message={...live[1],id:"durable",seq:3,createdAt:new Date(200).toISOString(),pending:false};
  const finished=mergeGroupProgress([before,durable,after],rounds,room,team);
  assert.equal(finished.filter(message=>message.text==="Reading files").length,1);
  assert.equal(finished[1].id,"durable");
  assert.deepEqual(mergeGroupProgress(original,rounds,{...room,members:[]},team),original);
});

test("reply identity survives formatting and keeps distinct same-time replies", () => {
  const room: Room={id:"g",name:"Group",members:["a"]};
  const team: TeamState={bots:[{id:"a",name:"Alpha"}],rooms:[room],models:[]};
  const durable: Message={id:"stored",groupReplyId:"relay:1",sessionId:"g",seq:10,role:"assistant",text:'{"ok":true}',createdAt:200,author:{id:"a",name:"Alpha"}};
  const rounds: GroupRound[]=[{callId:"relay",speaking:null,replies:[
    {botId:"a",groupReplyId:"relay:1",text:'{\n  "ok": true\n}',time:200},
    {botId:"a",groupReplyId:"relay:2",text:durable.text,time:200},
  ]}];
  const merged=mergeGroupProgress([durable],rounds,room,team);
  assert.equal(merged.length,2);
  assert.equal(merged[0],durable);
  assert.equal(merged[1].groupReplyId,"relay:2");
  assert.deepEqual(mergeGroupProgress(merged,rounds,room,team),merged);
});
