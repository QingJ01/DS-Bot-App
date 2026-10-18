import type { Room, TeamState, WorkStatus } from "../types.ts";
import type { Message } from "@ds-bot/mobile-sdk";

export interface GroupRound {
  callId: string;
  speaking: string | null;
  replies: {botId: string; groupReplyId?: string; kind?: string; text?: string; time?: number}[];
}

const messageTime = (message: Message) => new Date(message.createdAt ?? 0).getTime();

// Keep durable IDs intact. Reply identity survives progress redaction/formatting;
// older hosts without that identity fall back to author, timestamp and text.
export function mergeGroupProgress(messages: Message[], rounds: GroupRound[], room: Room, team: TeamState) {
  const result = [...messages];
  for (const round of rounds) for (const [index, reply] of round.replies.entries()) {
    if (reply.kind || !reply.text || typeof reply.time !== "number" || !Number.isFinite(reply.time) || !room.members.includes(reply.botId)) continue;
    const bot = team.bots.find(bot => bot.id === reply.botId);
    if (!bot) continue;
    if (result.some(message => message.groupReplyId && reply.groupReplyId
      ? message.groupReplyId === reply.groupReplyId
      : typeof message.author === "object" && message.author?.id === bot.id && messageTime(message) === reply.time && message.text.slice(0, 160) === reply.text!.slice(0, 160))) continue;
    const message: Message = {id:`progress:${room.id}:${reply.groupReplyId ?? `${round.callId}:${index}`}`,sessionId:room.id,seq:0,role:"assistant",text:reply.text,createdAt:reply.time,author:{id:bot.id,name:bot.name},pending:true,...(reply.groupReplyId ? {groupReplyId:reply.groupReplyId} : {})};
    const next = result.findIndex(message => messageTime(message) > reply.time!);
    if (next < 0) result.push(message);
    else result.splice(next, 0, message);
  }
  return result;
}

export function ownBotWork(botId: string, team: TeamState) {
  const work = team.work?.bots[botId];
  return work && !work.roomId ? work : undefined;
}

export function groupWorkMembers(room: Room, team: TeamState) {
  return room.members.flatMap(botId => {
    const bot = team.bots.find(item => item.id === botId);
    if (!bot) return [];
    const local = team.work?.rooms?.[room.id]?.find(item => item.botId === botId);
    const own = team.work?.bots[botId];
    const work = local ?? (own?.roomId === room.id ? own : undefined);
    const waiting = team.work?.approvals.some(item => item.botId === botId && item.roomId === room.id) ?? false;
    return work || waiting ? [{ bot, work, waiting }] : [];
  });
}

export function workDescription(work?: WorkStatus) {
  return (work?.said || work?.note || work?.target || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function waitingNames(work?: WorkStatus) {
  return [...new Set([...(work?.waiting?.bots ?? []), ...(work?.waiting?.rooms ?? [])])]
    .filter(name => typeof name === "string" && name.trim())
    .slice(0, 20);
}
