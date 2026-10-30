import { Text } from "./Typography";
import { tr } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AnimatedPressable as Pressable } from "./Motion";
import type { Attachment, Message, MobileClient } from "@ds-bot/mobile-sdk";
import { useTheme } from "../theme";
import { useI18n } from "../i18n";
import { errorText } from "../types";
import { saveDownload } from "../media/files";
import { blobBytes } from "../logic/blob";
import { Button, Label, Notice, Sheet } from "./UI";

const TEXT_LIMIT = 64 * 1024;
const isText = (name: string) => /\.(txt|md|markdown|csv|tsv|json|jsonl|log|yaml|yml|xml|html|css|js|ts|py|sh|sql)$/i.test(name);

export function FileAttachment({ attachment, message, client, conversationId, color }: {
  attachment: Attachment; message: Message; client: MobileClient; conversationId: string; color?: string;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const generation = useRef(0);
  const fetching = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; fetching.current?.abort(); }, []);
  async function load(download: boolean) {
    if (fetching.current || !attachment.id) return;
    const run = generation.current;
    const controller = new AbortController();
    fetching.current = controller;
    setBusy(true);
    setError("");
    try {
      const blob = await client.attachment(conversationId, message.sessionId, attachment.id, { seq: message.seq, signal: controller.signal });
      if (run !== generation.current) return;
      if (download) await saveDownload(attachment.name, blob);
      else {
        const bytes = await blobBytes(blob.slice(0, TEXT_LIMIT));
        if (run !== generation.current) return;
        const text = new TextDecoder().decode(bytes);
        if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new Error("This file is not plain text. Download it to open it in another app.");
        setPreview(text);
        setTruncated(blob.size > TEXT_LIMIT);
      }
    } catch (err) { if (run === generation.current) setError(errorText(err)); }
    finally { if (fetching.current === controller) fetching.current = null; if (run === generation.current) setBusy(false); }
  }
  function close() {
    generation.current++;
    fetching.current?.abort();
    fetching.current = null;
    setOpen(false);
    setBusy(false);
    setPreview(null);
    setError("");
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={tr("Open file {name}", { name: attachment.name })} onPress={() => setOpen(true)} style={{ borderWidth: 1, borderColor: color || t.line, borderRadius: 8, padding: 10, minHeight: 48, gap: 3 }}>
      <Text style={{ color: color || t.ink, fontSize: 13 }}>{attachment.name}</Text>
      <Text style={{ color: color || t.muted, fontSize: 11 }}>{attachment.mediaType || tr("File")}{typeof attachment.size === "number" ? " · " + Math.ceil(attachment.size / 1024) + tr(" KB") : ""} · ↓</Text>
    </Pressable>
    <Sheet title={attachment.name} visible={open} onClose={close}>
      <Label muted>{tr("Download this file to save it or open it in another app. Files up to 20 MiB are supported.")}</Label>
      <Notice error text={tr(error)} />
      <Button title={busy ? tr("Loading…") : tr("Download file")} disabled={busy || !attachment.id} onPress={() => void load(true)} />
      {isText(attachment.name) ? <Button title={tr("Preview text")} secondary disabled={busy || !attachment.id} onPress={() => void load(false)} /> : null}
      {preview !== null ? <Text selectable style={{ color: t.ink, fontSize: 13, lineHeight: 20 }}>{preview || tr("This file is empty.")}</Text> : null}
      {truncated ? <Notice text={tr("Showing the first 64 KiB. Download the file for its full content.")} /> : null}
    </Sheet>
  </>;
}
