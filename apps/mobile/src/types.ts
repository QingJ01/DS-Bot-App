export interface Bot {
  id: string;
  name: string;
  role?: string;
  color?: string;
  instructions?: string;
  model?: string;
  sessionId?: string;
  waiting?: boolean;
  avatar?: { shape?: string; image?: string; color?: string };
  appliedModel?: string;
  effort?: string;
  permission?: string;
  workDir?: string;
  pinned?: boolean;
  hidden?: boolean;
  capabilities?: string[];
}
export interface Room {
  id: string;
  name: string;
  members: string[];
  admin?: string | null;
  notice?: string;
  mode?: string;
  named?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  workDir?: string;
  permission?: string;
  paused?: { id: string; name?: string }[];
  relayLimit?: number;
  relayLimitDefault?: number;
}
export interface Model {
  ref: string;
  name: string;
  providerName?: string;
  input?: string[];
  provider?: string;
  contextWindow?: number;
  reasoning?: Reasoning;
}
export interface Question {
  id: string;
  sessionId?: string;
  conversationId?: string;
  question?: string;
  prompt?: string;
  text?: string;
  header?: string;
  detail?: string;
  multiSelect?: boolean;
  options?: Array<string | { label?: string; value?: string; description?: string }>;
  [key: string]: unknown;
}
export interface Reasoning { efforts: { id: string; name: string; description?: string }[]; defaultEffort?: string }
export interface WorkStatus { tool?: string; said?: string; note?: string; target?: string; switching?: boolean; since?: number; waiting?: { bots: string[]; rooms: string[] } }
export interface MemberWork extends WorkStatus { botId: string; speaking?: boolean }
export interface Capability { name: string; kind: "mcp" | "skill" | "pack"; description?: string; transport?: string; approved?: boolean; items?: string[] }
export interface CapabilityStatus { state: "ready" | "connecting" | "needs-approval" | "error"; error?: string }
export interface TeamWork { bots: Record<string, WorkStatus & { roomId?: string }>; rooms?: Record<string, MemberWork[]>; approvals: { id: string; botId: string; roomId?: string; sessionId?: string; answerable?: boolean }[] }
export interface TeamState {
  bots: Bot[];
  rooms: Room[];
  models: Model[];
  mainBotId?: string;
  mainBotIds?: string[];
  questions?: Record<string, Question>;
  activity?: Record<string, unknown>;
  memory?: boolean;
  readOnly?: string | null;
  workspaceId?: string;
  prefs?: Record<string, unknown>;
  colors?: string[];
  defaultModel?: string;
  modelsKey?: string;
  work?: TeamWork;
  permissions?: { defaultPreset?: string; options: { value: string; name?: string; description?: string }[] };
  agents?: Array<Record<string, unknown>>;
  connectors?: Array<Record<string, unknown>>;
  memoryNews?: Record<string, unknown>;
  memoryReviews?: Record<string, unknown>;
  capabilities?: Capability[];
  capabilityStatuses?: Record<string, Record<string, CapabilityStatus>>;
}
export function teamState(value: Record<string, unknown>): TeamState {
  return {
    ...value,
    bots: Array.isArray(value.bots) ? value.bots : [],
    rooms: Array.isArray(value.rooms) ? value.rooms : [],
    models: Array.isArray(value.models) ? value.models : [],
  } as TeamState;
}
export function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
