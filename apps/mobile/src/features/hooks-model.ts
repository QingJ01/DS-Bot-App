import type { WebhookItem } from "./contracts";

export interface HookForm {
  name: string;
  target: string;
  template: string;
}
export function initialHook(target = ""): HookForm {
  return { name: "", target, template: "" };
}
// A webhook names either one Bot or one group, so the form holds a single value: a group id
// carries a mark the payload takes apart again.
export const ROOM_MARK = "room:";
export function targetValue(item: { botId?: string; roomId?: string }) {
  return item.roomId ? `${ROOM_MARK}${item.roomId}` : (item.botId ?? "");
}
export function hookPayload(form: HookForm) {
  const name = form.name.trim();
  if (!name) throw new Error("Give the webhook a name.");
  if (!form.target)
    throw new Error("Choose the Bot or the group this webhook reaches.");
  return {
    name,
    ...(form.target.startsWith(ROOM_MARK)
      ? { roomId: form.target.slice(ROOM_MARK.length) }
      : { botId: form.target }),
    template: form.template.trim(),
  };
}
// What the list calls a webhook's target. A Bot or group that is gone keeps its id, so the
// row still says where the webhook points.
export function hookTarget(
  item: { botId?: string; roomId?: string },
  bots: { id: string; name: string }[],
  rooms: { id: string; name: string }[],
): { kind: "bot" | "room" | "none"; name: string } {
  if (item.roomId)
    return {
      kind: "room",
      name: rooms.find((room) => room.id === item.roomId)?.name ?? item.roomId,
    };
  if (item.botId)
    return {
      kind: "bot",
      name: bots.find((bot) => bot.id === item.botId)?.name ?? item.botId,
    };
  return { kind: "none", name: "" };
}
// The two-tap confirmation a destructive row button uses, kept apart from the plain id so
// rotating a secret and deleting a webhook cannot confirm each other.
export function confirmKey(action: "delete" | "rotate", id: string) {
  return `${action}:${id}`;
}
export function deliveryCount(item: WebhookItem) {
  return Number.isFinite(item.deliveries) && item.deliveries > 0
    ? item.deliveries
    : 0;
}
