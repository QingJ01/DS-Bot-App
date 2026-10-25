import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { MobileClient } from "@ds-bot/mobile-sdk";
import { tr } from "../i18n";
import { errorText, SideChat } from "../types";
import { Button, Card, Field, Label, Notice } from "./UI";
import { MarkdownText } from "./MarkdownText";

export function SideChats({ client, sessionId, chats, disabled, refresh, openChatId }: { client: MobileClient; sessionId: string; chats: SideChat[]; disabled: boolean; refresh: () => Promise<void>; openChatId: string | null }) {
  const [selected, setSelected] = useState<string | null>(openChatId);
  useEffect(() => { if (openChatId) setSelected(openChatId); }, [openChatId]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState<string | null>(null);
  const locked = useRef(false);
  const current = chats.find(chat => chat.id === selected);
  const draftKey = current?.id ?? "new";
  const text = drafts[draftKey] ?? "";
  async function act(endpoint: string, payload: Record<string, unknown>) {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await client.action<{ chatId?: string }>(endpoint, { sessionId, ...payload });
      if (endpoint === "side-ask") {
        setDrafts(old => ({ ...old, [draftKey]: "" }));
        if (result.chatId) setSelected(result.chatId);
      }
      if (endpoint === "side-close") { setSelected(null); setClosing(null); }
      await refresh();
    } catch (err) { setError(errorText(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  const unavailable = disabled || busy;
  return <View style={{ gap: 14 }}>
    <Notice text={tr("Side questions stay outside the main conversation and cannot use tools.")} />
    <Button title={tr("New side chat")} secondary disabled={busy} onPress={() => { setSelected(null); setClosing(null); setError(""); }} />
    {chats.map(chat => <Button key={chat.id} title={chat.entries[0]?.question || tr("Side chat")} secondary={chat.id !== current?.id} disabled={busy} onPress={() => { setSelected(chat.id); setClosing(null); setError(""); }} />)}
    {current?.entries.map(entry => <Card key={entry.id}>
      <Label>{entry.question}</Label>
      {!!entry.answer && <MarkdownText text={entry.answer} />}
      {entry.status === "answering" && <><Label muted>{tr("Answering…")}</Label><Button title={tr("Cancel")} secondary disabled={unavailable} onPress={() => void act("side-cancel", { chatId: current.id, entryId: entry.id })} /></>}
      {entry.status === "failed" && <Notice error text={entry.error || tr("Failed")} />}
      {entry.status === "cancelled" && <Label muted>{tr("Cancelled")}</Label>}
      {(entry.status === "failed" || entry.status === "cancelled") && <Button title={tr("Retry")} secondary disabled={unavailable || current.entries.some(item => item.status === "answering")} onPress={() => setDrafts(old => ({ ...old, [draftKey]: entry.question }))} />}
    </Card>)}
    <Field label={current ? tr("Follow-up question") : tr("Side question")} multiline value={text} maxLength={12000} editable={!unavailable} onChangeText={text => setDrafts(old => ({ ...old, [draftKey]: text }))} />
    <Button title={busy ? tr("Submitting…") : tr("Ask aside")} disabled={unavailable || !text.trim() || current?.entries.some(entry => entry.status === "answering")} onPress={() => void act("side-ask", { ...(current ? { chatId: current.id } : {}), text: text.trim() })} />
    <Notice error text={error} />
    {current && (closing === current.id ? <><Notice text={tr("Delete this side chat and cancel its pending answer?")} /><Button title={tr("Delete side chat")} disabled={unavailable} onPress={() => void act("side-close", { chatId: current.id })} /><Button title={tr("Keep side chat")} secondary disabled={busy} onPress={() => setClosing(null)} /></> : <Button title={tr("Delete side chat")} secondary disabled={unavailable} onPress={() => setClosing(current.id)} />)}
  </View>;
}
