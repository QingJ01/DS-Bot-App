import { Text } from "./Typography";
import { language, tr } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Platform, View } from "react-native";
import type { Message, MobileClient } from "@ds-bot/mobile-sdk";
import { Button, Notice, styles } from "./UI";
import { useTheme } from "../theme";
import { errorText } from "../types";

interface ApprovalRequest {
  id: string;
  conversationId: string;
  sessionId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  displayReason?: Record<string, string>;
  createdAt: number;
}

export function ApprovalCards({ client, conversationId, online, messages }: {
  client: MobileClient;
  conversationId: string;
  online: boolean;
  messages: Message[];
}) {
  const t = useTheme();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const generation = useRef(0);
  const deciding = useRef(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    let loading = false;
    const epoch = ++generation.current;
    setRequests([]);
    setError("");
    setRefreshError("");
    async function update() {
      if (!active || !online || loading || AppState.currentState === "background" || AppState.currentState === "inactive") return;
      loading = true;
      try {
        const result = await client.action<{ requests: ApprovalRequest[] }>("approvals");
        if (active && generation.current === epoch) {
          setRequests(result.requests.filter(request => request.conversationId === conversationId));
          setRefreshError("");
        }
      } catch (err) {
        if (active && generation.current === epoch) setRefreshError(errorText(err));
      } finally { loading = false; }
    }
    refresh.current = update;
    void update();
    const timer = setInterval(() => void update(), 2000);
    const sub = AppState.addEventListener("change", state => { if (state === "active") void update(); });
    return () => { active = false; generation.current++; clearInterval(timer); sub.remove(); };
  }, [client, conversationId, online]);
  async function decide(id: string, decision: "allowed-once" | "rejected") {
    if (deciding.current || !online) return;
    deciding.current = true;
    const epoch = generation.current;
    setBusy(id);
    setError("");
    try {
      await client.action("approval-resolve", { id, decision });
      if (generation.current === epoch) setRequests(previous => previous.filter(request => request.id !== id));
    } catch (err) { if (generation.current === epoch) setError(errorText(err)); }
    finally {
      deciding.current = false;
      if (generation.current === epoch) { setBusy(""); await refresh.current(); }
    }
  }
  const visibleError = error || refreshError;
  if (!requests.length) return visibleError ? <Notice error text={visibleError} /> : null;
  return <View style={{ gap: 10, paddingVertical: 8 }}>
    {requests.map(request => {
      const tool = messages.find(message => message.sessionId === request.sessionId && message.tool?.callId === request.callId)?.tool;
      return <View key={request.id} accessibilityRole="alert" style={{ backgroundColor: t.surface, borderWidth: 1, borderColor: t.lineStrong, borderRadius: 16, padding: 14, gap: 10 }}>
        <Text style={{ color: t.ink, fontSize: 15, fontWeight: "600" }}>{tr("Approval required")}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>{request.toolName}</Text>
        <Text selectable style={{ color: t.ink, fontSize: 14, lineHeight: 22 }}>{request.displayReason?.[language()] || request.displayReason?.en || request.reason || tr("This tool needs your permission before it can continue.")}</Text>
        {tool?.input ? <Text selectable style={{ color: t.ink, backgroundColor: t.bubble, padding: 10, borderRadius: 8, fontSize: 12, lineHeight: 19, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{tool.input}</Text> : null}
        <View style={[styles.row, { justifyContent: "flex-end" }]}>
          <Button secondary danger title={tr("Reject")} disabled={!online || !!busy} onPress={() => void decide(request.id, "rejected")} />
          <Button title={busy === request.id ? tr("Submitting…") : tr("Allow once")} disabled={!online || !!busy} onPress={() => void decide(request.id, "allowed-once")} />
        </View>
      </View>;
    })}
    <Notice error text={visibleError} />
  </View>;
}
