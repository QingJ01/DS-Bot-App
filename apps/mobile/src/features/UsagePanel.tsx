import { Text } from "../components/Typography";
import { dateLocale } from "../i18n";
import { tr } from "../i18n";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView, useWindowDimensions, View } from "react-native";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { Button, Busy, Card, Field, Notice } from "../components/UI";
import { BotAvatar, botColor, RoomAvatar } from "../components/BotAvatar";
import { useTheme } from "../theme";
import { errorText } from "../types";
import type { FeatureProps } from "./contracts";
import { ChoiceChips, FeatureTitle, SmallText, useRemoteView } from "./common";
import {
  activityDays,
  compact,
  customRange,
  rangeLabels,
  ranges,
  summarizeUsage,
} from "./usage-model";
import type { UsageRange, UsageSum, UsageView } from "./usage-model";
import { localZone } from "./schedule-model";

const colors = [
  "#5667ff",
  "#e99250",
  "#4b9e72",
  "#8c73cf",
  "#4d9cc7",
  "#cb7098",
  "#b09b36",
  "#48a4a6",
];
const kindLabel: Record<string, string> = {
  chat: "Conversations",
  group: "Group chats",
  compaction: "Compaction and handoff",
  image: "Image reading",
  memory: "Memory",
  "session-title": "Titles",
  other: "Other",
};
const ranked = (map: Map<number, UsageSum>) =>
  [...map].sort((a, b) => b[1].total - a[1].total);
const full = (n: number) => Math.round(n).toLocaleString(dateLocale());
const share = (n: number, total: number) =>
  total ? `${Math.round((n * 100) / total)}%` : "0%";

export function UsagePanel({
  client,
  team,
  online,
  initialOwnerId,
}: FeatureProps & { initialOwnerId?: string }) {
  const theme = useTheme(),
    { width } = useWindowDimensions();
  const loader = useCallback(
    () => client.action<UsageView>("usage", { timeZone: localZone() }),
    [client],
  );
  const remote = useRemoteView(loader, online);
  const [range, setRange] = useState<UsageRange>(ranges[1]),
    [ownerKey, setOwnerKey] = useState(initialOwnerId ?? ""),
    [modelKey, setModelKey] = useState("");
  const [by, setBy] = useState("bot"),
    [custom, setCustom] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [error, setError] = useState("");
  const [bucketKey, setBucketKey] = useState<string | null>(null),
    [day, setDay] = useState<string | null>(null);
  useEffect(() => {
    if (!online || !remote.value) return;
    const timer = setTimeout(
      () => void remote.load(),
      remote.value.scanning ? 3000 : 20000,
    );
    return () => clearTimeout(timer);
  }, [online, remote.value, remote.load]);
  useEffect(() => {
    setOwnerKey(initialOwnerId ?? "");
    setModelKey("");
  }, [client, initialOwnerId]);
  const data = useMemo(
    () =>
      remote.value
        ? summarizeUsage(remote.value, range, ownerKey, modelKey)
        : null,
    [remote.value, range, ownerKey, modelKey],
  );
  const days = useMemo(
    () => (remote.value && data ? activityDays(remote.value, data.keep) : []),
    [remote.value, data],
  );
  const view = remote.value;
  function chooseRange(value: string) {
    setError("");
    setBucketKey(null);
    if (value === "custom") {
      setFrom(range.from ?? view?.now.slice(0, 10) ?? "");
      setTo(range.to ?? view?.now.slice(0, 10) ?? "");
      setCustom(true);
    } else {
      setCustom(false);
      setRange(ranges.find((item) => item.id === value) ?? ranges[1]);
    }
  }
  function applyRange() {
    try {
      setRange(customRange(from, to));
      setCustom(false);
      setError("");
      setBucketKey(null);
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  const titleOf = (index: number) => {
    const owner = view?.owners[index];
    return (
      (owner?.kind === "bot"
        ? team.bots.find((bot) => bot.id === owner.id)?.name
        : owner?.kind === "room"
          ? team.rooms.find((room) => room.id === owner.id)?.name
          : undefined) ??
      owner?.name ??
      "Other"
    );
  };
  const ownerColor = (index: number) => {
    const owner = view?.owners[index];
    return owner?.kind === "bot"
      ? botColor(
          team.bots.find((bot) => bot.id === owner.id) ?? {
            id: owner.id ?? owner.key,
          },
          theme.dark,
        )
      : theme.muted;
  };
  const totals = data?.total;
  const previousChange = data?.previous
    ? ((data.total.total - data.previous) * 100) / data.previous
    : null;
  const chosen = data?.buckets.find((bucket) => bucket.key === bucketKey);
  const top = Math.max(
    1,
    ...(data?.buckets.map((bucket) => bucket.sum.total) ?? []),
  );
  const barWidth = Math.max(
    7,
    Math.min(
      32,
      Math.floor((Math.min(width, 760) - 86) / (data?.buckets.length ?? 1)) - 4,
    ),
  );
  const selectedOwner = view?.owners.find((owner) => owner.key === ownerKey),
    selectedModel = view?.models.find((model) => model.key === modelKey);
  const rankRows = (
    entries: [number, UsageSum][],
    type: "owner" | "model" | "kind",
  ) =>
    entries.map(([index, sum]) => {
      const title =
        type === "owner"
          ? titleOf(index)
          : type === "model"
            ? (view?.models[index]?.name ?? "Model")
            : (kindLabel[view?.kinds[index] ?? ""] ?? view?.kinds[index]);
      const owner = type === "owner" ? view?.owners[index] : undefined;
      const bot =
        owner?.kind === "bot"
          ? (team.bots.find((item) => item.id === owner.id) ?? {
              id: owner.id ?? owner.key,
              name: owner.name ?? "Deleted Bot",
            })
          : undefined;
      const room =
        owner?.kind === "room"
          ? team.rooms.find((item) => item.id === owner.id)
          : undefined;
      const paint =
        type === "owner" ? ownerColor(index) : colors[index % colors.length];
      const hint =
        type === "owner"
          ? view?.owners[index]?.deleted
            ? "Deleted"
            : view?.owners[index]?.kind === "room"
              ? "Group chat"
              : team.bots.find((bot) => bot.id === view?.owners[index]?.id)
                  ?.role
          : type === "model"
            ? (view?.models[index]?.providerName ??
              view?.models[index]?.provider)
            : `${full(sum.calls)} calls`;
      return (
        <Pressable
          key={index}
          accessibilityRole={type === "kind" ? undefined : "button"}
          accessibilityLabel={tr("{p0}: {p1} tokens", { p0: String(title), p1: String(full(sum.total)) })}
          disabled={type === "kind"}
          onPress={() => {
            if (type === "owner") setOwnerKey(view?.owners[index]?.key ?? "");
            else setModelKey(view?.models[index]?.key ?? "");
          }}
          style={{
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderColor: theme.line,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            {bot ? (
              <BotAvatar bot={bot} size={27} />
            ) : room ? (
              <RoomAvatar room={room} team={team} size={27} />
            ) : (
              <View
                style={{
                  width: 25,
                  height: 25,
                  borderRadius: 7,
                  backgroundColor: theme.soft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: paint, fontSize: 13, fontWeight: "600" }}>
                  {title?.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.ink, fontSize: 14 }}>{title}</Text>
              {hint ? <SmallText>{hint}</SmallText> : null}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text
                style={{
                  color: theme.ink,
                  fontSize: 14,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {compact(sum.total)}
              </Text>
              <SmallText>{share(sum.total, totals?.total ?? 0)}</SmallText>
            </View>
          </View>
          <View
            style={{ height: 3, borderRadius: 2, backgroundColor: theme.soft }}
          >
            <View
              style={{
                height: 3,
                borderRadius: 2,
                width: `${Math.min(100, (sum.total * 100) / (totals?.total || 1))}%`,
                backgroundColor: paint,
              }}
            />
          </View>
        </Pressable>
      );
    });
  return (
    <View style={{ gap: 16 }}>
      <FeatureTitle
        title={tr("Usage")}
        hint={
          view?.scanning
            ? tr("Reading older conversations…")
            : tr("Time zone: {p0}", { p0: String(localZone()) })
        }
      >
        <Button
          title={tr("Refresh")}
          secondary
          compact
          disabled={!online || remote.loading}
          onPress={() => void remote.load()}
        />
      </FeatureTitle>
      <Notice error text={error || remote.error} />
      <Notice
        text={
          !online ? tr("Connect to your host to load recorded usage.") : undefined
        }
      />
      {!view && remote.loading ? <Busy text={tr("Loading usage…")} /> : null}
      {view && !view.rows.length ? (
        <Card>
          <FeatureTitle
            title={tr("No usage yet.")}
            hint={tr("Token usage shows up here after a model is called.")}
          />
        </Card>
      ) : null}
      {view && data && view.rows.length > 0 ? (
        <>
          <ChoiceChips
            label={tr("Time range")}
            value={custom ? "custom" : range.id}
            onChange={chooseRange}
            options={[
              ...ranges.map((item) => ({
                value: item.id,
                label: tr(rangeLabels[item.id]),
              })),
              { value: "custom", label: tr("Custom") },
            ]}
          />
          {custom ? (
            <Card>
              <Field
                label={tr("From (YYYY-MM-DD)")}
                value={from}
                onChangeText={setFrom}
              />
              <Field label={tr("To (YYYY-MM-DD)")} value={to} onChangeText={setTo} />
              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                <Button
                  title={tr("Cancel")}
                  compact
                  secondary
                  onPress={() => setCustom(false)}
                />
                <Button title={tr("Apply range")} compact onPress={applyRange} />
              </View>
            </Card>
          ) : null}
          <ChoiceChips
            label={tr("Bot or group")}
            value={ownerKey}
            onChange={setOwnerKey}
            options={[
              { value: "", label: tr("All conversations") },
              ...view.owners.map((owner) => ({
                value: owner.key,
                label: `${owner.name ?? "Other"}${owner.deleted ? " · Deleted" : ""}`,
              })),
            ]}
          />
          <ChoiceChips
            label={tr("Model")}
            value={modelKey}
            onChange={setModelKey}
            options={[
              { value: "", label: tr("All models") },
              ...view.models.map((model) => ({
                value: model.key,
                label: model.name,
              })),
            ]}
          />
          {ownerKey || modelKey ? (
            <FeatureTitle
              title={[selectedOwner?.name, selectedModel?.name]
                .filter(Boolean)
                .join(" · ")}
            >
              <Button
                title={tr("Show all")}
                secondary
                compact
                onPress={() => {
                  setOwnerKey("");
                  setModelKey("");
                }}
              />
            </FeatureTitle>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {[
              [
                range.id === "custom" ? `${range.from} – ${range.to}` : tr("Last {range}", { range: tr(rangeLabels[range.id]) }),
                tr("{count} tokens", { count: compact(data.total.total) }),
                previousChange === null
                  ? ""
                  : tr("{change}% vs previous period", { change: `${previousChange >= 0 ? "↑" : "↓"} ${Math.abs(previousChange).toFixed(0)}` }),
              ],
              [
                tr("Cache hit rate"),
                share(
                  data.total.cacheRead,
                  data.total.input + data.total.cacheRead,
                ),
                tr("Of input tokens"),
              ],
              [tr("Output"), compact(data.total.output), "Token"],
              [tr("Calls"), full(data.total.calls), tr("Model calls")],
            ].map(([label, value, hint]) => (
              <View
                key={label}
                style={{
                  flexBasis: "46%",
                  flexGrow: 1,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.line,
                  borderRadius: 12,
                  padding: 13,
                  gap: 6,
                }}
              >
                <SmallText>{label}</SmallText>
                <Text
                  style={{
                    fontSize: 24,
                    fontWeight: "600",
                    color: theme.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {value}
                </Text>
                <SmallText>{hint}</SmallText>
              </View>
            ))}
          </View>
          <Card>
            <FeatureTitle title={tr("Tokens over time")} hint={tr("Per {p0}", { p0: String(range.unit) })} />
            <ChoiceChips
              label={tr("Group usage by")}
              options={[
                { value: "bot", label: tr("By Bot") },
                { value: "model", label: tr("By model") },
              ]}
              value={by}
              onChange={setBy}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                gap: 4,
                alignItems: "flex-end",
                paddingTop: 14,
                paddingBottom: 4,
              }}
            >
              {data.buckets.map((bucket, index) => (
                <Pressable
                  key={bucket.key}
                  accessibilityRole="button"
                  accessibilityLabel={tr("{p0}, {p1} tokens", { p0: String(bucket.key), p1: String(full(bucket.sum.total)) })}
                  onPress={() => setBucketKey(bucket.key)}
                  style={{
                    width: barWidth,
                    height: 148,
                    justifyContent: "flex-end",
                    gap: 7,
                  }}
                >
                  <View
                    style={{
                      height: Math.max(2, (bucket.sum.total / top) * 120),
                      opacity: bucketKey && bucketKey !== bucket.key ? 0.45 : 1,
                      borderRadius: 3,
                      overflow: "hidden",
                      backgroundColor: theme.line,
                      flexDirection: "column-reverse",
                    }}
                  >
                    {[...(by === "bot" ? bucket.owners : bucket.models)].map(
                      ([key, count]) => (
                        <View
                          key={key}
                          style={{
                            flex: count,
                            backgroundColor:
                              by === "bot"
                                ? ownerColor(key)
                                : colors[key % colors.length],
                          }}
                        />
                      ),
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 8, minHeight: 13, color: theme.muted }}
                  >
                    {index === 0 ||
                    index === data.buckets.length - 1 ||
                    index % Math.max(1, Math.round(data.buckets.length / 6)) ===
                      0
                      ? bucket.key.slice(range.unit === "hour" ? 11 : 5)
                      : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 7 }}
            >
              {ranked(by === "bot" ? data.owners : data.models).map(
                ([index]) => (
                  <Pressable
                    key={index}
                    accessibilityRole="button"
                    accessibilityLabel={tr("Filter {p0}", { p0: String(by === "bot" ? titleOf(index) : view.models[index]?.name) })}
                    onPress={() =>
                      by === "bot"
                        ? setOwnerKey(view.owners[index].key)
                        : setModelKey(view.models[index].key)
                    }
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      paddingHorizontal: 7,
                      minHeight: 30,
                      borderRadius: 8,
                      backgroundColor: theme.bg,
                    }}
                  >
                    <View
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 2,
                        backgroundColor:
                          by === "bot"
                            ? ownerColor(index)
                            : colors[index % colors.length],
                      }}
                    />
                    <SmallText>
                      {by === "bot" ? titleOf(index) : view.models[index]?.name}
                    </SmallText>
                  </Pressable>
                ),
              )}
            </ScrollView>
            {chosen ? (
              <View style={{ gap: 6 }}>
                <FeatureTitle
                  title={chosen.key}
                  hint={tr("{p0} tokens · {p1} calls", { p0: String(full(chosen.sum.total)), p1: String(full(chosen.sum.calls)) })}
                />
                {[...(by === "bot" ? chosen.owners : chosen.models)]
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, count]) => (
                    <SmallText key={key}>
                      {by === "bot" ? titleOf(key) : view.models[key]?.name}:{" "}
                      {full(count)}
                    </SmallText>
                  ))}
              </View>
            ) : (
              <SmallText>{tr("Tap a bar to inspect its usage.")}</SmallText>
            )}
          </Card>
          <Card>
            <FeatureTitle title={tr("Tokens by type")} />
            {(
              [
                ["Output", data.total.output],
                ["Input", data.total.input],
                ["Cache hit", data.total.cacheRead],
              ] as const
            ).map(([label, count], index) => (
              <View key={label} style={{ gap: 6 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <SmallText>{label}</SmallText>
                  <SmallText>
                    {compact(count)} · {share(count, data.total.total)}
                  </SmallText>
                </View>
                <View
                  style={{
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: theme.soft,
                  }}
                >
                  <View
                    style={{
                      height: 7,
                      borderRadius: 4,
                      width: `${Math.min(100, (count * 100) / (data.total.total || 1))}%`,
                      backgroundColor: theme.accent,
                      opacity: [1, 0.6, 0.32][index],
                    }}
                  />
                </View>
              </View>
            ))}
            <SmallText>{tr("Input includes cache writes.")}</SmallText>
          </Card>
          <Card>
            <FeatureTitle title={tr("By Bot")} />
            {data.owners.size ? (
              rankRows(ranked(data.owners), "owner")
            ) : (
              <SmallText>{tr("No calls in this range.")}</SmallText>
            )}
          </Card>
          <Card>
            <FeatureTitle title={tr("By model")} />
            {data.models.size ? (
              rankRows(ranked(data.models), "model")
            ) : (
              <SmallText>{tr("No calls in this range.")}</SmallText>
            )}
          </Card>
          <Card>
            <FeatureTitle title={tr("What the tokens went to")} />
            {data.kinds.size ? (
              rankRows(ranked(data.kinds), "kind")
            ) : (
              <SmallText>{tr("No calls in this range.")}</SmallText>
            )}
          </Card>
          <Card>
            <FeatureTitle
              title={tr("Activity")}
              hint={tr("Active on {p0} days in the last year", { p0: String(days.filter((item) => item.tokens > 0).length) })}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 3 }}>
                {Array.from(
                  { length: Math.ceil(days.length / 7) },
                  (_, week) => (
                    <View key={week} style={{ gap: 3 }}>
                      {days.slice(week * 7, week * 7 + 7).map((item) => (
                        <Pressable
                          key={item.day}
                          accessibilityRole="button"
                          accessibilityLabel={tr("{p0}, {p1} tokens", { p0: String(item.day), p1: String(full(item.tokens)) })}
                          onPress={() => setDay(item.day)}
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 2,
                            backgroundColor: item.tokens
                              ? theme.accent
                              : theme.line,
                            opacity: item.tokens
                              ? Math.max(
                                  0.25,
                                  Math.sqrt(
                                    item.tokens /
                                      Math.max(
                                        1,
                                        ...days.map((value) => value.tokens),
                                      ),
                                  ),
                                )
                              : 0.6,
                          }}
                        />
                      ))}
                    </View>
                  ),
                )}
              </View>
            </ScrollView>
            <SmallText>
              {day
                ? tr("{p0} · {p1} tokens", { p0: String(day), p1: String(full(days.find((item) => item.day === day)?.tokens ?? 0)) })
                : tr("Tap a day to inspect it.")}
            </SmallText>
          </Card>
        </>
      ) : null}
    </View>
  );
}
