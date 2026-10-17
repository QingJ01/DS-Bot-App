import type { MobileClient, Conversation, Message } from "@ds-bot/mobile-sdk";
import type { TeamState, WebhookItem, WebhookView } from "../types";
export type { WebhookItem, WebhookView };

export interface FeatureProps {
  client: MobileClient;
  team: TeamState;
  online: boolean;
}
export interface ScheduleTask {
  id: string;
  sessionId: string;
  botId?: string;
  roomId?: string;
  title: string;
  prompt: string;
  status: string;
  kind: string;
  scheduledAt: string;
  time?: string;
  timeZone?: string;
  weekdays?: number[];
  everySeconds?: number;
  expression?: string;
}
export interface ScheduleView {
  available: boolean;
  tasks: ScheduleTask[];
}
export interface MemoryEntry {
  scope: "own" | "team";
  topic?: string | null;
  text: string;
  added?: string;
  source?: string;
  by?: string;
}
export interface MemoryView {
  botId: string;
  entries: MemoryEntry[];
  sizes: { own: number; team: number };
  limits: { main: number; entry: number; topic: number; topics: number };
  summary: { text: string; at: number } | null;
  fresh: boolean;
  summarizing: boolean;
  error?: string | null;
}
export interface MemoryAnswer {
  reply: string;
  changes: {
    op: string;
    scope: string;
    text: string;
    before?: string;
    ok: boolean;
    error?: string;
  }[];
  view: MemoryView;
}
export interface HistoryPanelProps {
  client: MobileClient;
  conversation: Conversation;
  online: boolean;
  onSelectMessage?: (message: Message) => void;
}
export interface Part {
  sessionId: string;
  number?: number;
  current?: boolean;
  title?: string;
  createdAt?: string | number;
}
