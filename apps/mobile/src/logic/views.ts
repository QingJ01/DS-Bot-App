import { asText as sharedAsText, checkShownView, resolve as sharedResolve, validateViewAnswer as sharedValidateViewAnswer, viewScope as sharedViewScope } from "../../../../ds-bot/src/shared/views.js";

export type ViewNode = { type: string; [key: string]: any };
export const viewScope = sharedViewScope as (view: ViewNode, values?: Record<string, unknown>) => (name: string) => unknown;
export const resolve = sharedResolve as (value: unknown, lookup: (name: string) => unknown, fallback?: unknown) => unknown;
export const asText = sharedAsText as (value: unknown) => string;
export const validateViewAnswer = sharedValidateViewAnswer as (view: ViewNode, action: string, values: Record<string, unknown>) => { error?: string };

export function readView(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const shown = value as { title?: unknown; view?: unknown };
  try {
    const checked = checkShownView(shown.title, shown.view);
    return checked.error || !checked.view ? null : { title: checked.title ?? "", view: checked.view, interactive: checked.interactive === true };
  } catch { return null; }
}

export function sideQuestion(text: string): string | null {
  const match = /^\/side(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? (match[1] ?? "").trim() : null;
}

export function sideRefusal(text: string, privateChat: boolean, supported: boolean, attachments: number, references: number): string | null {
  if (!supported) return "Update the host plugin to use side chats.";
  if (!privateChat) return "Side chat is only available in a Bot's private chat.";
  if (attachments || references) return "Side chats do not take attachments or chat references.";
  if (!text.trim()) return "Write a question after /side.";
  if (text.length > 12000) return "Use at most 12000 characters for a side question.";
  return null;
}
