export const protocolVersion: 1;
export interface Session {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  serverId: string;
  expiresAt: number | string;
  /** Added by this SDK when pairing; binds credentials to the approved HTTPS origin. */
  serverUrl?: string;
  tlsPin?: string;
}
export interface TokenStore {
  get(): Promise<Session | null>;
  set(session: Session): Promise<void>;
  clear(): Promise<void>;
}
export interface Attachment {
  id?: string;
  type?: 'image' | 'file';
  receiptId?: string;
  name: string;
  mediaType?: string;
  size?: number;
  sessionId?: string;
  [key: string]: unknown;
}
export interface Message {
  groupReplyId?: string;
  id: string;
  sessionId: string;
  seq: number;
  role: string;
  text: string;
  createdAt: number | string;
  reasoning?: string;
  interrupted?: boolean;
  turn?: number;
  step?: number;
  requestId?: string;
  /** Last event represented by an updatable tool card; seq remains its call position. */
  updatedSeq?: number;
  systemEvent?: { kind: 'working' | 'approval' | 'resumed' | 'cut' | 'stopped' | 'retry'; name?: string };
  tool?: ToolActivity;
  attachments?: Attachment[];
  author?: string | Record<string, unknown>;
  pending?: boolean;
  attemptId?: string;
  [key: string]: unknown;
}
export interface ToolActivity {
  durationMs?: number;
  callId: string;
  name: string;
  state: 'running' | 'completed' | 'error';
  /** Bounded, redacted display details supplied by the host. */
  input?: string;
  output?: string;
  isError?: boolean;
  truncated?: boolean;
}
export interface Conversation {
  id: string;
  kind: string;
  name: string;
  role?: string;
  sessionId: string;
  parts?: unknown[];
  model?: unknown;
  waiting?: unknown;
  pinned?: boolean;
  hidden?: boolean;
  admin?: string | null;
  mode?: 'everyone' | 'admin';
  notice?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  [key: string]: unknown;
}
export interface HistoryPage { messages: Message[]; cursor: string | null; sessionId: string }
export interface ConversationPart { sessionId: string; number: number; current: boolean; cursor: string; startedAt?: number | string; endedAt?: number | string }
export interface PartsPage { conversationId: string; currentSessionId: string; parts: ConversationPart[] }
export interface SearchPage { messages: Message[]; cursor: string | null; scannedPages: number; complete: boolean }
export interface MessageContext extends HistoryPage { focusId?: string; focusSeq?: number }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface SettingsNamespace {
  ns: string;
  autoGenerate: boolean;
  /** Serialized Schemastery envelope, not JSON Schema. */
  schema: JsonValue;
  value: JsonValue;
  base?: JsonValue;
  user?: JsonValue;
  applies: 'live';
  secrets: { path: string[]; set: boolean }[];
  revision: number;
}
export interface SettingsDescription { writable: boolean; hasDocument: boolean; namespaces: SettingsNamespace[] }
export type SettingsPathOp = { op: 'set'; path: string[]; value: JsonValue } | { op: 'unset'; path: string[] };
export interface CredentialInfo { configured: boolean; source?: string; writable: boolean }
export interface ApprovalRequest {
  /** Ephemeral shared request ID; never reconstructed from audit events. */
  id: string;
  conversationId: string;
  sessionId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  displayReason?: Record<string, string>;
  createdAt: number;
}
export type ApprovalDecision = 'allowed-once' | 'rejected';
export interface PluginCatalog {
  writable: boolean;
  plugins: { entryId: string; moduleName?: string; enabled: boolean; fiberPhase: string | null; meta?: PluginMetadata; readOnlyReason?: string }[];
  bundles: { name: string; version?: string; description?: string; enabled: boolean; installed: boolean; optional: boolean; meta?: PluginMetadata; error?: { code?: string; diagnostic?: string }; readOnlyReason?: string }[];
}
export interface PluginMetadata { title?: string | Record<string, string>; description?: string | Record<string, string>; error?: string }
export interface PluginChange { changed: boolean; application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'; stage: 'install' | 'enable' | 'remove'; target?: string; enabled?: boolean; error?: { code?: string; diagnostic?: string }; warnings?: string[] }
export interface SkillCatalog { available: boolean; skills: { name: string; description?: string; whenToUse?: string; source?: string; provider?: string; invocation: { modelInvocable: boolean; userInvocable: boolean } }[] }
export interface Target { conversationId: string; sessionId: string; revision: string | number }
export interface ServerInfo {
  protocolVersion: number;
  serverId: string;
  name?: string;
  capabilities?: Record<string, unknown> | string[];
  [key: string]: unknown;
}
export interface Pairing { claimToken: string; requestId: string; status: 'pending' }
export type PairingResult = Session | { status: 'pending'; [key: string]: unknown };
export interface Submission {
  conversationId: string;
  sessionId: string;
  requestId: string;
  text: string;
  attachments?: Attachment[];
}
export interface SubmissionReceipt {
  requestId: string;
  status: string;
  conversationId?: string;
  sessionId?: string;
  [key: string]: unknown;
}
export interface Device { id: string; name?: string; deviceName?: string; [key: string]: unknown }
export interface QueueItem {
  id: string;
  requestId?: string;
  text: string;
  target: 'next-turn' | 'next-step';
  attachments?: Attachment[];
}
export interface MobileEvent {
  type: 'ready' | 'delta' | 'message' | 'reset' | 'status' | 'error';
  conversationId?: string;
  sessionId?: string;
  attemptId?: string;
  replaceAttemptId?: string;
  text?: string;
  reasoning?: string;
  index?: number;
  replace?: boolean;
  clearAttempt?: boolean;
  message?: Message;
  messages?: Message[];
  cursor?: string | null;
  eventSeq?: number;
  queue?: QueueItem[];
  error?: { code: string; message: string };
  [key: string]: unknown;
}
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'unauthorized';
export interface Cache {
  getMessages(serverId: string, conversationId: string): Promise<Message[]>;
  setMessages(serverId: string, conversationId: string, messages: Message[]): Promise<void>;
  getDraft(serverId: string, conversationId: string): Promise<string>;
  setDraft(serverId: string, conversationId: string, text: string): Promise<void>;
  clear(serverId?: string): Promise<void>;
}
export class MemoryTokenStore implements TokenStore {
  constructor(session?: Session | null);
  get(): Promise<Session | null>;
  set(session: Session): Promise<void>;
  clear(): Promise<void>;
}
export class MemoryCache implements Cache {
  getMessages(serverId: string, conversationId: string): Promise<Message[]>;
  setMessages(serverId: string, conversationId: string, messages: Message[]): Promise<void>;
  getDraft(serverId: string, conversationId: string): Promise<string>;
  setDraft(serverId: string, conversationId: string, text: string): Promise<void>;
  clear(serverId?: string): Promise<void>;
}
export class MobileError extends Error {
  constructor(code: string, message: string, status?: number);
  readonly code: string;
  readonly status: number;
}
/** Returns a normalized origin. HTTP requires explicit opt-in and a loopback host. */
export function validateServerUrl(value: string, options?: { allowInsecure?: boolean }): string;
/** Deduplicate by stable message id, preserving immutable messages from previous pages. */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[];
/** Merge reset pages and replace cumulative stream attempts with final messages. */
export function applyConversationEvent(messages: Message[], event: MobileEvent): Message[];
export function validateTlsPin(value: unknown): string;
export interface ClientOptions {
  tlsPin?: string;
  baseUrl: string;
  tokenStore: TokenStore;
  allowInsecure?: boolean;
  fetch?: typeof globalThis.fetch;
  WebSocket?: typeof globalThis.WebSocket;
  cache?: Cache;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  reconnectMaxDelayMs?: number;
}
export class MobileClient {
  constructor(options: ClientOptions);
  readonly baseUrl: string;
  readonly tlsPin?: string;
  readonly cache: Cache;
  info(): Promise<ServerInfo>;
  pair(code: string, deviceName: string): Promise<Pairing>;
  completePairing(claimToken: string): Promise<PairingResult>;
  state(): Promise<Record<string, unknown>>;
  conversations(): Promise<{ conversations: Conversation[] }>;
  parts(conversationId: string): Promise<PartsPage>;
  search(conversationId: string, query: string, options?: { cursor?: string | null; limit?: number }): Promise<SearchPage>;
  /** Loads and caches the host context around one scoped message. */
  context(conversationId: string, sessionId: string, seq?: number, options?: { limit?: number }): Promise<MessageContext>;
  settings(): Promise<SettingsDescription>;
  updateSettings(ns: string, patch: Record<string, JsonValue>, expectedRevision: number): Promise<SettingsNamespace>;
  mutateSettings(ns: string, ops: SettingsPathOp[], expectedRevision: number): Promise<SettingsNamespace>;
  credentials(refs: string[]): Promise<Record<string, CredentialInfo>>;
  setCredential(ref: string, value: string): Promise<unknown>;
  unsetCredential(ref: string): Promise<unknown>;
  approvals(): Promise<{ requests: ApprovalRequest[] }>;
  resolveApproval(id: string, decision: ApprovalDecision): Promise<{ accepted: true }>;
  plugins(): Promise<PluginCatalog>;
  setPluginEnabled(id: string, enabled: boolean): Promise<PluginChange>;
  setBundleEnabled(id: string, enabled: boolean): Promise<PluginChange>;
  skills(conversationId?: string): Promise<SkillCatalog>;
  messages(conversationId: string, options?: { cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<HistoryPage>;
  target(conversationId: string): Promise<Target>;
  /** requestId must be generated once and retained across all retries. */
  submit(submission: Submission): Promise<SubmissionReceipt>;
  submission(requestId: string): Promise<SubmissionReceipt>;
  cancel(conversationId: string): Promise<Record<string, unknown>>;
  action<T = Record<string, unknown>>(endpoint: string, payload?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<T>;
  upload(options: { conversationId: string; sessionId: string; name: string; mediaType: string; body: BodyInit }): Promise<Attachment>;
  transcribe(options: { name: string; mediaType: string; body: BodyInit; signal?: AbortSignal }): Promise<{ text: string; [key: string]: unknown }>;
  devices(): Promise<{ devices: Device[] }>;
  revokeDevice(deviceId: string): Promise<Record<string, unknown>>;
  markRead(conversationId: string, seq: number): Promise<Record<string, unknown>>;
  attachment(conversationId: string, sessionId: string, attachmentId: string, options?: { seq?: number; signal?: AbortSignal }): Promise<Blob>;
  download(path: string): Promise<Blob>;
  getCachedMessages(conversationId: string): Promise<Message[]>;
  /** Discards queued cache updates before clearing this server's cached messages and drafts. */
  clearCachedData(): Promise<void>;
  getDraft(conversationId: string): Promise<string>;
  setDraft(conversationId: string, text: string): Promise<void>;
  connect(options: {
    conversationId: string;
    after?: number | string;
    onEvent(event: MobileEvent): void;
    onStatus?(status: ConnectionStatus): void;
    onError?(error: Error): void;
  }): { close(): void };
  /** Clears local credentials and stops active connections; revokeDevice also revokes at the host. */
  logout(): Promise<void>;
  /** Stops all connections and requests without removing the stored session. */
  dispose(): void;
}

export function nameProblem(name: string): string | undefined;
export function mentionSpans<T extends { name: string }>(text: string, bots: T[], options?: { references?: string[] }): Array<{ start: number; end: number; bot?: T; all?: boolean }>;
