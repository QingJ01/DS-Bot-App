import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundNotificationLink, markConversationNotificationsRead } from '../src/logic/notifications.ts';

test('native notification links preserve encoded conversation IDs without allowing other link actions', () => {
  assert.deepEqual(backgroundNotificationLink('dsbot://notification?serverId=server-one&conversationId=agent%3Aone%3Asession%2Ftwo&notificationId=42'), {serverId:'server-one',conversationId:'agent:one:session/two',notificationId:42});
  for (const value of [null, 'https://notification?serverId=s&conversationId=c&notificationId=1', 'dsbot://pair?serverId=s&conversationId=c&notificationId=1', 'dsbot://notification/delete?serverId=s&conversationId=c&notificationId=1', 'dsbot://user:pass@notification?serverId=s&conversationId=c&notificationId=1', 'dsbot://notification?serverId=s&conversationId=c&notificationId=9007199254740992', 'dsbot://notification?serverId=s&notificationId=1', 'dsbot://notification?serverId=s&conversationId=c&notificationId=-1']) assert.equal(backgroundNotificationLink(value),null);
});


test('opening a conversation clears only its unread notifications after acknowledgement', async () => {
  const items = [{id:1,conversationId:'one',read:false},{id:2,conversationId:'two',read:false},{id:3,conversationId:'one',read:true}];
  let sent: number[] = [];
  const result = await markConversationNotificationsRead(items, 'bot:one', async ids => {sent=ids;});
  assert.deepEqual(sent,[1]);
  assert.deepEqual(result.map(item=>item.read),[true,false,true]);
  assert.equal(items[0].read,false);
  assert.equal(await markConversationNotificationsRead(items, undefined, async()=>{assert.fail('hidden conversations must stay unread');}),items);
});

test('a failed read acknowledgement preserves the blue dot for retry', async () => {
  const items = [{id:1,conversationId:'one',read:false}];
  await assert.rejects(markConversationNotificationsRead(items,'one',async()=>{throw new Error('offline');}),/offline/);
  assert.equal(items[0].read,false);
  assert.equal((await markConversationNotificationsRead(items,'one',async()=>{}))[0].read,true);
});
