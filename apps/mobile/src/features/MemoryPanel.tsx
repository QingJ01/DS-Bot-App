import { Text } from "../components/Typography";
import { dateLocale } from "../i18n";
import { tr } from "../i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button, Busy, Card, Field, Notice } from "../components/UI";
import { MarkdownText } from "../components/MarkdownText";
import { useTheme } from "../theme";
import { errorText } from "../types";
import type {
  FeatureProps,
  MemoryAnswer,
  MemoryEntry,
  MemoryView,
} from "./contracts";
import { ChoiceChips, FeatureTitle, SmallText, useRemoteView } from "./common";

export function MemoryPanel({
  client,
  team,
  online,
  botId,
  onOpenBot,
}: FeatureProps & { botId: string; onOpenBot?: (botId: string) => void }) {
  const theme = useTheme(),
    bot = team.bots.find((item) => item.id === botId);
  const load = useCallback(
    () => client.action<MemoryView>("memory-view", { botId, summarize: true }),
    [client, botId],
  );
  const remote = useRemoteView(load, online && team.memory !== false);
  const [page, setPage] = useState("summary"),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [answer, setAnswer] = useState<MemoryAnswer | null>(null),
    [confirm, setConfirm] = useState<string | null>(null);
  const owner = useRef({ client, botId });
  owner.current = { client, botId };
  const active = () =>
    owner.current.client === client && owner.current.botId === botId;
  const editable = online && !team.readOnly;
  useEffect(() => {
    setAnswer(null);
    setText("");
    setConfirm(null);
    setError("");
    setBusy(false);
  }, [client, botId]);
  useEffect(() => {
    if (!online || !remote.value?.summarizing) return;
    const timer = setTimeout(() => void remote.load(), 1500);
    return () => clearTimeout(timer);
  }, [online, remote.value, remote.load]);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(null), 5000);
    return () => clearTimeout(timer);
  }, [confirm]);
  async function regenerate() {
    setError("");
    setBusy(true);
    try {
      const value = await client.action<MemoryView>("memory-view", {
        botId,
        regenerate: true,
      });
      if (active()) remote.show(value);
    } catch (failure) {
      if (active()) setError(errorText(failure));
    } finally {
      if (active()) setBusy(false);
    }
  }
  async function ask() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const result = await client.action<MemoryAnswer>("memory-ask", {
        botId,
        text: text.trim(),
      });
      if (active()) {
        setAnswer(result);
        setText("");
        remote.show(result.view);
        if (page === "summary") void remote.load();
      }
    } catch (failure) {
      if (active()) setError(errorText(failure));
    } finally {
      if (active()) setBusy(false);
    }
  }
  async function forget(entry: MemoryEntry) {
    const id = JSON.stringify([entry.scope, entry.topic ?? "", entry.text]);
    if (confirm !== id) {
      setConfirm(id);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await client.action<MemoryView>("memory-forget", {
        botId,
        scope: entry.scope,
        topic: entry.topic,
        text: entry.text,
      });
      if (active()) {
        remote.show(result);
        setConfirm(null);
      }
    } catch (failure) {
      if (active()) setError(errorText(failure));
    } finally {
      if (active()) setBusy(false);
    }
  }
  const view = remote.value;
  if (team.memory === false)
    return (
      <Card>
        <FeatureTitle
          title={tr("Memory is turned off")}
          hint={tr("Enable memory in the DS Bot configuration on your host.")}
        />
      </Card>
    );
  const status = view?.summarizing
    ? tr("Writing the summary…")
    : view?.fresh === false
      ? tr("Summary needs updating")
      : view?.summary
        ? tr("Updated {date}",{date:new Date(view.summary.at).toLocaleString(dateLocale())})
        : "";
  return (
    <View style={{ gap: 16 }}>
      <FeatureTitle
        title={page === "summary" ? tr("Memory summary") : tr("All entries")}
        hint={[bot?.name ?? tr("Bot"), status].filter(Boolean).join(" · ")}
      >
        <Button
          title={tr("Refresh")}
          secondary
          compact
          disabled={!online || remote.loading}
          onPress={() => void remote.load()}
        />
      </FeatureTitle>
      <ChoiceChips
        label={tr("Memory view")}
        value={page}
        onChange={(next) => {
          setPage(next);
          if (next === "summary" && remote.value?.fresh === false)
            void remote.load();
        }}
        options={[
          { value: "summary", label: tr("Summary") },
          {
            value: "entries",
            label: `All entries${view ? ` · ${view.entries.length}` : ""}`,
          },
        ]}
      />
      <Notice error text={error || remote.error} />
      <Notice
        text={
          !online
            ? tr("Connect to your host to read or change saved memory.")
            : team.readOnly
        }
      />
      {!view && remote.loading ? <Busy text={tr("Loading memory…")} /> : null}
      {view && page === "summary" ? (
        <Card>
          {!view.entries.length ? (
            <>
              <FeatureTitle
                title={tr("{p0} has not saved anything yet", { p0: String(bot?.name ?? tr("This Bot")) })}
                hint={tr("Bots keep lasting preferences, decisions, and what you ask them to remember. Tell {p0} below, or in its chat.", { p0: String(bot?.name ?? tr("your Bot")) })}
              />
              {onOpenBot ? (
                <Button
                  title={tr("Open conversation")}
                  secondary
                  onPress={() => onOpenBot(botId)}
                />
              ) : null}
            </>
          ) : (
            <>
              {view.error ? (
                <Notice
                  error
                  text={`${view.summary ? tr("The summary is out of date") : tr("The summary could not be written")}: ${view.error}`}
                />
              ) : null}
              {view.summary ? (
                <View style={{ opacity: view.fresh ? 1 : 0.7 }}>
                  <MarkdownText text={view.summary.text} />
                </View>
              ) : view.summarizing ? (
                <Busy text={tr("Writing the summary…")} />
              ) : (
                <SmallText>{tr("No summary has been written yet.")}</SmallText>
              )}
              <Button
                title={
                  view.summarizing
                    ? tr("Writing the summary…")
                    : tr("Regenerate summary")
                }
                secondary
                disabled={!editable || busy || view.summarizing}
                onPress={() => void regenerate()}
              />
            </>
          )}
        </Card>
      ) : null}
      {view && page === "entries"
        ? (["own", "team"] as const).map((scope) => {
            const entries = view.entries.filter(
                (entry) => entry.scope === scope,
              ),
              topics = [...new Set(entries.map((entry) => entry.topic ?? ""))];
            return (
              <View key={scope} style={{ gap: 8 }}>
                <FeatureTitle
                  title={
                    scope === "team"
                      ? tr("Team memory")
                      : tr("{p0}’s memory", { p0: String(bot?.name ?? tr("Bot")) })
                  }
                  hint={tr("{p0}{p1} of {p2} characters", { p0: String(scope === "team" ? tr("Every Bot reads it · ") : ""), p1: String(view.sizes[scope].toLocaleString(dateLocale())), p2: String(view.limits.main.toLocaleString(dateLocale())) })}
                />
                <Card>
                  {!entries.length ? (
                    <SmallText>{tr("Nothing saved yet.")}</SmallText>
                  ) : (
                    topics.map((topic) => (
                      <View key={topic} style={{ gap: 6 }}>
                        {topic ? <FeatureTitle title={topic} /> : null}
                        {entries
                          .filter((entry) => (entry.topic ?? "") === topic)
                          .map((entry) => {
                            const key = JSON.stringify([
                              scope,
                              topic,
                              entry.text,
                            ]);
                            return (
                              <View
                                key={key}
                                style={{
                                  borderBottomWidth: 1,
                                  borderColor: theme.line,
                                  paddingVertical: 10,
                                  gap: 6,
                                }}
                              >
                                <Text
                                  selectable
                                  style={{
                                    color: theme.ink,
                                    fontSize: 14,
                                    lineHeight: 21,
                                  }}
                                >
                                  {entry.text}
                                </Text>
                                <View
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                  }}
                                >
                                  <View style={{ flex: 1 }}>
                                    <SmallText>
                                      {[
                                        entry.added,
                                        entry.source === "memory panel"
                                          ? tr("by you")
                                          : entry.by
                                            ? tr("by {p0}", { p0: String(entry.by) })
                                            : null,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </SmallText>
                                  </View>
                                  <Button
                                    title={
                                      confirm === key
                                        ? tr("Confirm removal")
                                        : tr("Remove")
                                    }
                                    secondary
                                    danger
                                    compact
                                    disabled={!editable || busy}
                                    onPress={() => void forget(entry)}
                                  />
                                </View>
                              </View>
                            );
                          })}
                      </View>
                    ))
                  )}
                </Card>
              </View>
            );
          })
        : null}
      {answer ? (
        <Card>
          <FeatureTitle title={tr("Memory reply")}>
            <Button
              title={tr("Dismiss")}
              secondary
              compact
              onPress={() => setAnswer(null)}
            />
          </FeatureTitle>
          <Text
            selectable
            style={{ color: theme.ink, fontSize: 14, lineHeight: 22 }}
          >
            {answer.reply}
          </Text>
          {answer.changes.map((change, index) => (
            <SmallText key={index} error={!change.ok}>
              {change.ok
                ? change.op === "remove"
                  ? tr("Removed")
                  : change.op === "edit"
                    ? tr("Updated")
                    : tr("Added")
                : tr("Not changed")}
              {change.scope === "team" ? tr(" in team memory") : ""}: {change.text}
              {change.error ? ` (${change.error})` : ""}
            </SmallText>
          ))}
        </Card>
      ) : null}
      <View style={{ gap: 10 }}>
        <Field
          label={tr("Ask or update")}
          placeholder={tr("What do you remember? Remember that…")}
          value={text}
          maxLength={2000}
          multiline
          editable={editable && !busy && !!view}
          onChangeText={setText}
        />
        <Button
          title={busy ? tr("Thinking…") : tr("Send")}
          disabled={!editable || busy || !view || !text.trim()}
          onPress={() => void ask()}
        />
      </View>
    </View>
  );
}
