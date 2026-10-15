import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import {
  applyConversationEvent,
  Attachment,
  ConnectionStatus,
  mergeMessages,
  Message,
  MobileClient,
  Submission,
} from "@ds-bot/mobile-sdk";
import { cache, Host, readCache, writeCache, tokenStore } from "../storage";
import { errorText } from "../types";
import { confirmOrSubmit, definitelyRejected } from "../logic/submissions";
interface PendingSubmission extends Submission {
  deviceId?: string;
}
export interface QueueItem {
  id: string;
  requestId: string;
  text: string;
  target: string;
}
export function useConversation(client: MobileClient, host: Host, id: string) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueSession, setQueueSession] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const draftEdited = useRef(false);
  const draftRevision = useRef(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraftState] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState("");
  useEffect(() => {
    if (receipt !== "Sent") return;
    const timer = setTimeout(() => setReceipt(""), 3000);
    return () => clearTimeout(timer);
  }, [receipt]);
  const [pending, setPending] = useState<PendingSubmission | null>(null);
  const [previousDevice, setPreviousDevice] = useState(false);
  const [archived, setArchived] = useState<PendingSubmission[]>([]);
  const [rejected, setRejected] = useState(false);
  const alive = useRef(true);
  const sending = useRef(false);
  const lastSubmission = useRef<{ requestId: string; sessionId: string } | null>(null);
  const draftWrites = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    alive.current = true;
    let stream: { close(): void } | undefined;
    let active = true;
    let generation = 0;
    let foreground =
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive";
    async function start() {
      if (!active || !foreground) return;
      const run = ++generation;
      const current = () => active && foreground && generation === run;
      stream?.close();
      try {
        const page = await client.messages(id);
        if (!current()) return;
        setMessages((previous) => mergeMessages(previous, page.messages));
        setCursor(page.cursor);
        setHydrated(true);
      } catch (err) {
        if (current()) { setError(errorText(err)); setHydrated(true); }
      }
      if (!current()) return;
      stream = client.connect({
        conversationId: id,
        onStatus: (value) => {
          if (current()) setStatus(value);
        },
        onError: (err) => {
          if (current()) setError(errorText(err));
        },
        onEvent: (event) => {
          if (!current()) return;
          if (typeof event.busy === "boolean") setRunning(event.busy);
          else if (event.phase === "running") setRunning(true);
          else if (event.phase === "idle") setRunning(false);
          else if (event.type === "delta") setRunning(true);
          if (Array.isArray(event.queue)) {
            setQueue(event.queue as QueueItem[]);
            setQueueSession(event.sessionId || "");
          }
          if (event.type === "error")
            setError(event.error?.message || "Connection error.");
          else {
            setError("");
            setMessages((previous) => applyConversationEvent(previous, event));
            if (event.type === "reset")
              setCursor((previous) => previous ?? event.cursor ?? null);
          }
        },
      });
      void client
        .action<{ sessionId: string; items: QueueItem[] }>("queue", {
          conversationId: id,
        })
        .then((value) => {
          if (current()) {
            setQueue(value.items);
            setQueueSession(value.sessionId);
          }
        })
        .catch(() => {});
    }
    void Promise.all([
      cache.getMessages(host.serverId, id),
      cache.getDraft(host.serverId, id),
      readCache<PendingSubmission | null>(host.serverId, `pending:${id}`),
      tokenStore.get(),
      readCache<PendingSubmission[]>(host.serverId, `archive:${id}`),
    ])
      .then(([saved, text, submission, session, previous]) => {
        if (active) {
          setMessages(saved);
          if (!draftEdited.current) setDraftState(text);
          if (saved.length) setHydrated(true);
          setPending(submission);
          setPreviousDevice(
            !!submission && submission.deviceId !== session?.deviceId,
          );
          setArchived(previous || []);
        }
      })
      .catch((err) => {
        if (active)
          setError(`Local cache could not be loaded: ${errorText(err)}`);
      })
      .finally(() => {
        if (active) void start();
      });
    const sub = AppState.addEventListener("change", (value) => {
      foreground = value === "active";
      if (foreground) void start();
      else {
        generation++;
        stream?.close();
        setStatus("closed");
      }
    });
    return () => {
      active = false;
      generation++;
      alive.current = false;
      stream?.close();
      sub.remove();
    };
  }, [client, host.serverId, id]);
  const setDraft = useCallback(
    (text: string) => {
      draftEdited.current = true;
      draftRevision.current++;
      setDraftState(text);
      draftWrites.current = draftWrites.current
        .catch(() => {})
        .then(() => cache.setDraft(host.serverId, id, text));
      void draftWrites.current.catch((err) => {
        if (alive.current)
          setError(`Draft could not be saved: ${errorText(err)}`);
      });
    },
    [host.serverId, id],
  );
  async function older() {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const page = await client.messages(id, { cursor });
      setMessages((old) => mergeMessages(page.messages, old));
      setCursor(page.cursor);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function send(attachments: Attachment[] = [], sessionId?: string, voiceText?: string) {
    const outgoing = voiceText ?? draft;
    if (sending.current || (voiceText !== undefined && pending) || (!pending && !outgoing.trim() && !attachments.length))
      return false;
    const sendingRevision = draftRevision.current;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      if (voiceText !== undefined) {
        await draftWrites.current;
        await cache.setDraft(host.serverId, id, outgoing);
        setDraftState(outgoing);
      }
      const session = await tokenStore.get();
      if (!session)
        throw new Error("This device is not paired. Reconnect in Settings.");
      let payload = pending;
      if (!payload) {
        const target = await client.target(id);
        if (sessionId && sessionId !== target.sessionId)
          throw new Error(
            "The host moved to a new conversation part. Remove and attach the files again before sending.",
          );
        payload = {
          deviceId: session.deviceId,
          conversationId: id,
          sessionId: target.sessionId,
          requestId: Crypto.randomUUID(),
          text: outgoing.trim(),
          attachments,
        };
        await writeCache(host.serverId, `pending:${id}`, payload);
        setPending(payload);
      }
      const { deviceId, ...submission } = payload;
      const result = await confirmOrSubmit(client, submission, {
        storedDeviceId: deviceId,
        currentDeviceId: session.deviceId,
      });
      if (result.status === "rejected") {
        setRejected(true);
        throw new Error(
          "The host rejected this send. Keep your draft and prepare a new submission.",
        );
      }
      if (result.status !== "accepted")
        throw new Error(
          "The host cannot yet confirm this send. Keep the original request and check again; it will not be sent automatically.",
        );
      setRejected(false);
      lastSubmission.current = { requestId: payload.requestId, sessionId: payload.sessionId };
      setReceipt("Sent");
      if (draftRevision.current === sendingRevision) setDraft("");
      await draftWrites.current;
      await writeCache(host.serverId, `pending:${id}`, null);
      setPending(null);
      return true;
    } catch (err) {
      if (definitelyRejected(err)) setRejected(true);
      setError(errorText(err));
      return false;
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function cancel() {
    setError("");
    try {
      await client.cancel(id);
      setReceipt(
        "Stop requested. Queued messages are retained; send another message to resume them.",
      );
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function archivePrevious() {
    if (!previousDevice || !pending) return;
    const items = [...archived, pending];
    await writeCache(host.serverId, `archive:${id}`, items);
    await draftWrites.current;
    await cache.setDraft(host.serverId, id, "");
    await writeCache(host.serverId, `pending:${id}`, null);
    setArchived(items);
    setPending(null);
    setDraftState("");
    setPreviousDevice(false);
    setError("");
  }
  async function removeQueued(itemId: string) {
    try {
      await client.action("queue-remove", {
        conversationId: id,
        sessionId: queueSession,
        itemId,
      });
      setQueue((old) => old.filter((item) => item.id !== itemId));
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function recompose() {
    if (!rejected) return;
    await writeCache(host.serverId, `pending:${id}`, null);
    setPending(null);
    setRejected(false);
    setError("");
  }
  return {
    hydrated,
    previousDevice,
    archived,
    archivePrevious,
    queue,
    removeQueued,
    rejected,
    recompose,
    messages,
    draft,
    setDraft,
    cursor,
    status,
    running,
    error,
    setError,
    busy,
    receipt,
    pending,
    older,
    send,
    async sendVoice(text: string) { return await send([], undefined, text) ? lastSubmission.current : null; },
    cancel,
  };
}
