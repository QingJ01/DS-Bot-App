import { Text } from "../components/Typography";
import { dateLocale } from "../i18n";
import { tr } from "../i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AnimatedPressable as Pressable } from "../components/Motion";
import type { Conversation, Message, MobileClient } from "@ds-bot/mobile-sdk";
import { Button, Busy, Card, Field, Notice } from "../components/UI";
import { useTheme } from "../theme";
import { errorText } from "../types";
import { FeatureTitle, SmallText, useRemoteView } from "./common";
import type { HistoryPanelProps } from "./contracts";

interface ConversationPart {
  sessionId: string;
  number: number;
  current: boolean;
  startedAt?: string | number;
  endedAt?: string | number;
  cursor?: string;
}
interface PartsView {
  conversationId: string;
  currentSessionId: string;
  parts: ConversationPart[];
}
interface SearchPage {
  messages: Message[];
  cursor: string | null;
  scannedPages: number;
  complete: boolean;
}
function dateText(value?: string | number) {
  if (value === undefined) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(dateLocale(), {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
export function ConversationPartsPanel({
  client,
  conversation,
  online,
  onSelectPart,
}: {
  client: MobileClient;
  conversation: Conversation;
  online: boolean;
  onSelectPart?: (sessionId: string) => void;
}) {
  const theme = useTheme();
  const loader = useCallback(
    () =>
      client.action<PartsView>("parts", { conversationId: conversation.id }),
    [client, conversation.id],
  );
  const remote = useRemoteView(loader, online);
  return (
    <View style={{ gap: 14 }}>
      <FeatureTitle
        title={tr("Conversation parts")}
        hint={tr("Earlier parts belong to the same ongoing conversation.")}
      />
      <Notice error text={remote.error} />
      <Notice
        text={
          !online
            ? tr("Connect to your host to read conversation parts.")
            : undefined
        }
      />
      {!remote.value && remote.loading ? <Busy /> : null}
      {remote.value ? (
        <Card>
          {[...remote.value.parts].reverse().map((part) => (
            <Pressable
              key={part.sessionId}
              accessibilityRole={onSelectPart ? "button" : undefined}
              accessibilityLabel={tr("Part {p0}{p1}", { p0: String(part.number), p1: String(part.current ? tr(", current") : "") })}
              disabled={!onSelectPart}
              onPress={() => onSelectPart?.(part.sessionId)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderColor: theme.line,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  justifyContent: "center",
                  alignItems: "center",
                  borderRadius: 10,
                  backgroundColor: part.current ? theme.soft : theme.bg,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: part.current ? theme.accent : theme.muted,
                  }}
                >
                  {part.number}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: theme.ink, fontSize: 14 }}>
                  {part.current ? tr("Current part") : tr("Part {p0}", { p0: String(part.number) })}
                </Text>
                <SmallText>
                  {[dateText(part.startedAt), dateText(part.endedAt)]
                    .filter(Boolean)
                    .join(" – ") ||
                    (part.current
                      ? tr("New messages continue here.")
                      : tr("Saved conversation history"))}
                </SmallText>
              </View>
              {onSelectPart ? (
                <Text style={{ fontSize: 20, color: theme.muted }}>›</Text>
              ) : null}
            </Pressable>
          ))}
        </Card>
      ) : null}
      <Button
        title={tr("Refresh parts")}
        secondary
        disabled={!online || remote.loading}
        onPress={() => void remote.load()}
      />
    </View>
  );
}

function SearchExcerpt({ text, query }: { text: string; query: string }) {
  const theme = useTheme(),
    match = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = match < 0 ? 0 : Math.max(0, match - 70),
    end = Math.min(text.length, start + 260);
  if (match < 0)
    return (
      <Text
        numberOfLines={5}
        style={{ color: theme.ink, fontSize: 14, lineHeight: 21 }}
      >
        {text.slice(0, 260)}
      </Text>
    );
  return (
    <Text
      numberOfLines={5}
      style={{ color: theme.ink, fontSize: 14, lineHeight: 21 }}
    >
      {start ? "…" : ""}
      {text.slice(start, match)}
      <Text
        style={{
          backgroundColor: theme.soft,
          color: theme.accent,
          fontWeight: "600",
        }}
      >
        {text.slice(match, match + query.length)}
      </Text>
      {text.slice(match + query.length, end)}
      {end < text.length ? "…" : ""}
    </Text>
  );
}
export function HistorySearchPanel({
  client,
  conversation,
  online,
  onSelectMessage,
}: HistoryPanelProps) {
  const theme = useTheme();
  const [query, setQuery] = useState(""),
    [searched, setSearched] = useState(""),
    [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [complete, setComplete] = useState(false),
    [pages, setPages] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    live = useRef(false);
  useEffect(() => {
    live.current = true;
    ++generation.current;
    setMessages([]);
    setCursor(null);
    setSearched("");
    setQuery("");
    setPages(0);
    setComplete(false);
    setBusy(false);
    setError("");
    return () => {
      live.current = false;
      ++generation.current;
    };
  }, [client, conversation.id]);
  async function search(more = false) {
    const term = (more ? searched : query).trim();
    if (!term || busy || !online) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    if (!more) {
      setMessages([]);
      setCursor(null);
      setComplete(false);
      setPages(0);
      setSearched(term);
    }
    try {
      const result = await client.action<SearchPage>("search", {
        conversationId: conversation.id,
        query: term,
        ...(more && cursor ? { cursor } : {}),
        limit: 30,
      });
      if (!live.current || generation.current !== request) return;
      setMessages((previous) => {
        const found = new Map(
          (more ? previous : []).map((message) => [message.id, message]),
        );
        for (const message of result.messages) found.set(message.id, message);
        return [...found.values()];
      });
      setCursor(result.cursor);
      setComplete(result.complete);
      setPages((previous) => (more ? previous : 0) + result.scannedPages);
    } catch (failure) {
      if (live.current && generation.current === request)
        setError(errorText(failure));
    } finally {
      if (live.current && generation.current === request) setBusy(false);
    }
  }
  const parts = [
    ...(conversation.parts ?? []).filter(
      (part): part is string => typeof part === "string",
    ),
    conversation.sessionId,
  ];
  return (
    <View style={{ gap: 14 }}>
      <FeatureTitle
        title={tr("Search conversation")}
        hint={tr("Search all saved parts of {p0}.", { p0: String(conversation.name) })}
      />
      <Field
        label={tr("Search messages")}
        placeholder={tr("Find a word or phrase")}
        autoFocus
        value={query}
        maxLength={200}
        onChangeText={setQuery}
        returnKeyType="search"
        onSubmitEditing={() => void search()}
        editable={!busy && online}
      />
      <Button
        title={busy ? tr("Searching…") : tr("Search")}
        disabled={!online || busy || !query.trim()}
        onPress={() => void search()}
      />
      <Notice error text={error} />
      <Notice
        text={
          !online ? tr("Connect to your host to search saved history.") : undefined
        }
      />
      {searched ? (
        <SmallText>
          {tr(messages.length === 1 ? "{count} matching message" : "{count} matching messages",{count:messages.length})}
          {complete
            ? tr(" · Search complete")
            : pages
              ? tr(" · More history available")
              : ""}
        </SmallText>
      ) : null}
      {searched && !messages.length && !busy && !error ? (
        <Card>
          <SmallText>
            {complete
              ? tr("No messages found for “{p0}”.", { p0: String(searched) })
              : tr("No matches in the history searched so far. Continue to check earlier parts.")}
          </SmallText>
        </Card>
      ) : null}
      {messages.map((message) => {
        const part = parts.indexOf(message.sessionId) + 1,
          author =
            typeof message.author === "string"
              ? message.author
              : message.author?.name;
        return (
          <Pressable
            key={message.id}
            accessibilityRole={onSelectMessage ? "button" : undefined}
            accessibilityLabel={tr("Open {p0} message{p1}", { p0: String(message.role), p1: String(part ? ` in part ${part}` : "") })}
            disabled={!onSelectMessage}
            onPress={() => onSelectMessage?.(message)}
            style={{
              borderWidth: 1,
              borderColor: theme.line,
              borderRadius: 12,
              backgroundColor: theme.surface,
              padding: 13,
              gap: 8,
            }}
          >
            <SmallText>
              {[
                message.role === "user"
                  ? tr("You")
                  : typeof author === "string"
                    ? author
                    : conversation.name,
                part ? tr("Part {p0}", { p0: String(part) }) : null,
                dateText(message.createdAt),
              ]
                .filter(Boolean)
                .join(" · ")}
            </SmallText>
            <SearchExcerpt text={message.text} query={searched} />
            {onSelectMessage ? (
              <SmallText>{tr("Open in conversation ›")}</SmallText>
            ) : null}
          </Pressable>
        );
      })}
      {cursor ? (
        <Button
          title={busy ? tr("Searching earlier history…") : tr("Search more history")}
          secondary
          disabled={!online || busy}
          onPress={() => void search(true)}
        />
      ) : null}
    </View>
  );
}
